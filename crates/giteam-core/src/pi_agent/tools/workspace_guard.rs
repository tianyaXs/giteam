//! 工作区围栏装饰器：在执行前按当前会话 SandboxPolicy 校验 path 参数。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

use super::approval::denied_output;
use crate::pi_agent::interactions::InteractionHub;
use crate::pi_agent::path_guard::resolve_within_workspace;
use crate::pi_agent::sandbox_policy::SandboxExecutionPolicy;

pub struct WorkspacePathGuardTool {
    inner: Box<dyn Tool>,
    hub: Arc<InteractionHub>,
    fallback_cwd: PathBuf,
}

impl WorkspacePathGuardTool {
    #[must_use]
    pub fn new(inner: Box<dyn Tool>, hub: Arc<InteractionHub>, fallback_cwd: &Path) -> Self {
        Self {
            inner,
            hub,
            fallback_cwd: fallback_cwd.to_path_buf(),
        }
    }

    fn policy(&self) -> SandboxExecutionPolicy {
        self.hub.sandbox_policy_for(&self.fallback_cwd)
    }
}

fn is_write_tool(name: &str) -> bool {
    matches!(
        name,
        "edit"
            | "write"
            | "hashline_edit"
            | "write_xlsx"
            | "write_docx"
            | "write_pptx"
            | "edit_xlsx"
            | "edit_docx"
            | "edit_pptx"
    )
}

#[async_trait]
impl Tool for WorkspacePathGuardTool {
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
        mut input: Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let policy = self.policy();
        if !policy.allows_file_writes() && is_write_tool(self.inner.name()) {
            return Ok(denied_output(
                self.inner.name(),
                "file policy is read-only (writes denied under standing mode)",
            ));
        }
        if let Some(path) = input.get("path").and_then(Value::as_str) {
            match resolve_within_workspace(&policy.workspace_root, path, policy.mode) {
                Ok(resolved) => {
                    if let Some(obj) = input.as_object_mut() {
                        obj.insert(
                            "path".to_string(),
                            Value::String(resolved.to_string_lossy().into_owned()),
                        );
                    }
                }
                Err(reason) => {
                    return Ok(denied_output(self.inner.name(), &reason));
                }
            }
        }
        self.inner.execute(tool_call_id, input, on_update).await
    }
}

/// 仅用于类型擦除时保持 Arc 友好（当前未共享状态）。
#[allow(dead_code)]
pub type SharedWorkspace = Arc<SandboxExecutionPolicy>;
