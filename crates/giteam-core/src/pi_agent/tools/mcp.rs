//! MCP 工具的 Pi `Tool` 包装：把 `McpToolSpec` 快照注册进 Pi ToolRegistry。
//!
//! 执行链路：`MCPStore::start_tool_execution` → 消费 `next_update()`
//! （Progress → `ToolUpdate`；Finished → `ToolOutput`）。MCP content block
//! 映射：text 原样、image 转 Pi image，resource/resource_link/audio 序列化为
//! JSON 文本。`is_error` 映射为 `ToolOutput::is_error`（可读错误，不 panic）。
//!
//! 取消：Pi abort 会 drop 本 execute future，`McpStoreToolExecutionHandle`
//! 的 Drop 会向远端发送 cancel——无需额外钩子。
//! 审批：`InteractionRisk::for_tool` 对未知工具（含 `mcp__*`）fail-closed 归
//! Write，注册时经 wrap 自动套 ApprovalTool（首阶段所有 MCP 工具默认审批）。

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use mcpstore::{ContentItem, McpExecutionOptions, McpStoreExecutionUpdate, McpToolExecution};
use pi::sdk::{ContentBlock, ImageContent, Result, TextContent, Tool, ToolOutput, ToolUpdate};
use serde_json::Value;

use crate::pi_agent::mcp::{McpRuntime, McpToolSpec};

/// 单次 MCP 工具调用的空闲超时（有 progress 会重置）。
const MCP_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
/// 单次 MCP 工具调用的总时长上限。
const MCP_MAX_TOTAL_TIMEOUT: Duration = Duration::from_secs(600);

pub struct McpTool {
    spec: McpToolSpec,
    runtime: Arc<McpRuntime>,
}

impl McpTool {
    #[must_use]
    pub fn new(spec: McpToolSpec, runtime: Arc<McpRuntime>) -> Self {
        Self { spec, runtime }
    }

    fn error_output(&self, message: impl std::fmt::Display) -> ToolOutput {
        ToolOutput {
            content: vec![ContentBlock::Text(TextContent::new(format!(
                "MCP tool {}/{} failed: {message}",
                self.spec.service_name, self.spec.tool_name
            )))],
            details: Some(serde_json::json!({
                "kind": "mcp",
                "service": self.spec.service_name,
                "tool": self.spec.tool_name,
            })),
            is_error: true,
        }
    }
}

#[async_trait]
impl Tool for McpTool {
    fn name(&self) -> &str {
        &self.spec.exposed_name
    }

    fn label(&self) -> &str {
        &self.spec.exposed_name
    }

    fn description(&self) -> &str {
        if self.spec.description.trim().is_empty() {
            // description 缺失时给模型一个可定位的兜底。
            &self.spec.tool_name
        } else {
            &self.spec.description
        }
    }

    fn parameters(&self) -> Value {
        self.spec.input_schema.clone()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let mut handle = match self.runtime.store.start_tool_execution(
            self.spec.instance_id,
            &self.spec.tool_name,
            input,
            None,
            McpExecutionOptions::default()
                .with_idle_timeout(MCP_IDLE_TIMEOUT)
                .with_max_total_timeout(MCP_MAX_TOTAL_TIMEOUT),
        )
        .await
        {
            Ok(handle) => handle,
            // 服务断开/未连接等：可读错误返回给模型，不打断 run。
            Err(error) => return Ok(self.error_output(error)),
        };
        loop {
            match handle.next_update().await {
                Some(McpStoreExecutionUpdate::Progress(progress)) => {
                    if let Some(on_update) = &on_update {
                        on_update(ToolUpdate {
                            content: Vec::new(),
                            details: Some(serde_json::json!({
                                "kind": "mcp_progress",
                                "service": self.spec.service_name,
                                "tool": self.spec.tool_name,
                                "progress": progress.progress,
                                "total": progress.total,
                                "message": progress.message,
                            })),
                        });
                    }
                }
                Some(McpStoreExecutionUpdate::Finished(Ok(execution))) => {
                    return Ok(self.execution_output(execution));
                }
                Some(McpStoreExecutionUpdate::Finished(Err(error))) => {
                    return Ok(self.error_output(error));
                }
                None => {
                    return Ok(self.error_output("execution ended without a result"));
                }
            }
        }
    }
}

impl McpTool {
    fn execution_output(&self, execution: McpToolExecution) -> ToolOutput {
        let result = match execution {
            McpToolExecution::Immediate { result } => result,
            McpToolExecution::Task { task } => {
                return ToolOutput {
                    content: vec![ContentBlock::Text(TextContent::new(
                        serde_json::to_string_pretty(&task)
                            .unwrap_or_else(|_| "{}".to_string()),
                    ))],
                    details: Some(serde_json::json!({
                        "kind": "mcp_task",
                        "service": self.spec.service_name,
                        "tool": self.spec.tool_name,
                    })),
                    is_error: false,
                };
            }
        };
        let content = result
            .content
            .into_iter()
            .map(|item| match item {
                ContentItem::Text { text, .. } => ContentBlock::Text(TextContent::new(text)),
                ContentItem::Image { data, mime_type, .. } => {
                    ContentBlock::Image(ImageContent { data, mime_type })
                }
                ContentItem::Resource { resource, .. }
                | ContentItem::ResourceLink { resource, .. } => ContentBlock::Text(
                    TextContent::new(serde_json::to_string_pretty(&resource).unwrap_or_else(
                        |_| "\"(unserializable MCP resource)\"".to_string(),
                    )),
                ),
                ContentItem::Audio { data, mime_type, .. } => {
                    ContentBlock::Text(TextContent::new(format!(
                        "(MCP audio content: {mime_type}, {} bytes, not displayable)",
                        data.len() / 4 * 3 // base64 → 原始字节近似
                    )))
                }
            })
            .collect();
        ToolOutput {
            content,
            details: Some(serde_json::json!({
                "kind": "mcp",
                "service": self.spec.service_name,
                "tool": self.spec.tool_name,
            })),
            is_error: result.is_error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn runtime_with_fast_echo_server() -> Option<Arc<McpRuntime>> {
        // 用一个极简 stdio MCP 服务（echo）验证注册与调用链路。
        // 服务器脚本：JSON-RPC initialize + tools/list + tools/call。
        let script = std::env::temp_dir().join("giteam-mcp-echo-test.py");
        std::fs::write(
            &script,
            r#"import json, sys
def send(msg): print(json.dumps(msg), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    method, mid = req.get("method"), req.get("id")
    if method == "initialize":
        send({"jsonrpc":"2.0","id":mid,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"echo","version":"1.0"}}})
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send({"jsonrpc":"2.0","id":mid,"result":{"tools":[{"name":"echo","description":"Echo the input","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}]}})
    elif method == "tools/call":
        text = req["params"]["arguments"].get("text","")
        send({"jsonrpc":"2.0","id":mid,"result":{"content":[{"type":"text","text":f"echo: {text}"}],"isError":False}})
    else:
        send({"jsonrpc":"2.0","id":mid,"error":{"code":-32601,"message":"unknown"}})
"#,
        )
        .ok()?;
        let base = std::env::temp_dir().join(format!(
            "giteam-mcp-tool-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ));
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).ok()?;
        let runtime =
            crate::pi_agent::mcp::load_with_base(&base, &repo).await.ok()?;
        crate::pi_agent::mcp::add_service(
            &runtime,
            &crate::pi_agent::mcp::McpServiceInput {
                name: "echo".into(),
                enabled: true,
                url: None,
                command: Some("python3".into()),
                args: vec![script.to_string_lossy().into_owned()],
                env: Default::default(),
                headers: Default::default(),
                description: None,
            },
        )
        .await
        .ok()?;
        let runtime = crate::pi_agent::mcp::load_with_base(&base, &repo).await.ok()?;
        Some(runtime)
    }

    #[tokio::test]
    async fn registers_and_calls_echo_tool() {
        let Some(runtime) = runtime_with_fast_echo_server().await else {
            eprintln!("echo server setup failed; skipping");
            return;
        };
        let spec = runtime
            .tools
            .iter()
            .find(|spec| spec.exposed_name == "mcp__echo__echo")
            .cloned();
        let Some(spec) = spec else {
            panic!("echo tool not discovered; tools: {:?}", runtime.tools.len());
        };
        assert_eq!(spec.description, "Echo the input");
        assert_eq!(
            spec.input_schema["properties"]["text"]["type"],
            serde_json::json!("string")
        );
        let tool = McpTool::new(spec, Arc::clone(&runtime));
        assert_eq!(tool.name(), "mcp__echo__echo");
        let output = tool
            .execute(
                "call-1",
                serde_json::json!({"text": "hello"}),
                None,
            )
            .await
            .expect("execute ok");
        assert!(!output.is_error);
        let ContentBlock::Text(text) = &output.content[0] else {
            panic!("expected text content");
        };
        assert_eq!(text.text, "echo: hello");
    }
}
