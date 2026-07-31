//! 审批包装工具：把写/执行类 pi 内置工具包装为"先审批、后执行"。
//! 审批通过前内部工具绝不执行；拒绝/超时/中止一律以 is_error 结果收尾，
//! 让模型感知失败并调整策略。

use std::sync::Arc;

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

use super::super::interactions::{
    new_interaction_id, now_ms, redact_tool_input, InteractionHub, InteractionResolution,
    InteractionRisk, DEFAULT_INTERACTION_TIMEOUT,
};
use super::super::types::{AgentInteraction, AgentInteractionReply};

pub struct ApprovalTool {
    inner: Box<dyn Tool>,
    hub: Arc<InteractionHub>,
    risk: InteractionRisk,
}

impl ApprovalTool {
    #[must_use]
    pub fn new(inner: Box<dyn Tool>, hub: Arc<InteractionHub>) -> Self {
        let risk = InteractionRisk::for_tool(inner.name());
        Self { inner, hub, risk }
    }
}

#[async_trait]
impl Tool for ApprovalTool {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn label(&self) -> &str {
        self.inner.label()
    }

    fn description(&self) -> &str {
        self.inner.description()
    }

    fn parameters(&self) -> Value {
        self.inner.parameters()
    }

    fn effects(&self) -> ToolEffects {
        self.inner.effects()
    }

    async fn execute(
        &self,
        tool_call_id: &str,
        input: Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let tool = self.inner.name().to_string();
        // 快路径：显式自动接受或命中 session 级 always 规则。审计事件照常发布。
        if self.hub.is_allowed(&tool, &input) {
            if let Some(context) = self.hub.run_context() {
                publish_auto_approval(&context, &tool, tool_call_id, &input, self.risk);
            }
            return self.inner.execute(tool_call_id, input, on_update).await;
        }
        let Some(context) = self.hub.run_context() else {
            // 无运行上下文属异常状态，fail-closed 拒绝执行。
            return Ok(denied_output(&tool, "缺少运行上下文，无法发起审批"));
        };
        let interaction = AgentInteraction::Permission {
            id: new_interaction_id(),
            session_id: context.session_id.clone(),
            run_id: context.run_id.clone(),
            tool_call_id: tool_call_id.to_string(),
            tool: tool.clone(),
            risk: self.risk.as_str().to_string(),
            input: redact_tool_input(&input),
            created_at_ms: now_ms(),
        };
        let resolution = self
            .hub
            .store()
            .request(interaction, &context, DEFAULT_INTERACTION_TIMEOUT)
            .await;
        match resolution {
            InteractionResolution::Reply(AgentInteractionReply::Once) => {
                self.inner.execute(tool_call_id, input, on_update).await
            }
            InteractionResolution::Reply(AgentInteractionReply::Always) => {
                self.hub.remember_always(&tool, &input);
                self.inner.execute(tool_call_id, input, on_update).await
            }
            InteractionResolution::Reply(AgentInteractionReply::Reject) => {
                Ok(denied_output(&tool, "用户拒绝了本次调用"))
            }
            InteractionResolution::Timeout => {
                Ok(denied_output(&tool, "等待审批超时，已自动拒绝"))
            }
            InteractionResolution::Aborted => Ok(denied_output(&tool, "任务已中止")),
            InteractionResolution::Shutdown => Ok(denied_output(&tool, "服务已关闭")),
            // 种类不匹配的回复按拒绝处理（fail-closed）
            _ => Ok(denied_output(&tool, "无效的审批回复")),
        }
    }
}

/// 自动接受也要留下审计轨迹：requested 后紧跟 resolved(auto)。
fn publish_auto_approval(
    context: &super::super::interactions::InteractionRunContext,
    tool: &str,
    tool_call_id: &str,
    input: &Value,
    risk: InteractionRisk,
) {
    let id = new_interaction_id();
    context.publish(super::super::events::AgentEvent::InteractionRequested {
        interaction: AgentInteraction::Permission {
            id: id.clone(),
            session_id: context.session_id.clone(),
            run_id: context.run_id.clone(),
            tool_call_id: tool_call_id.to_string(),
            tool: tool.to_string(),
            risk: risk.as_str().to_string(),
            input: redact_tool_input(input),
            created_at_ms: now_ms(),
        },
    });
    context.publish(super::super::events::AgentEvent::InteractionResolved {
        id,
        resolution: "auto".to_string(),
        automatic: true,
    });
}

#[must_use]
pub fn denied_output(tool: &str, reason: &str) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            format!("{tool} 未执行：{reason}。"),
        ))],
        details: None,
        is_error: true,
    }
}
