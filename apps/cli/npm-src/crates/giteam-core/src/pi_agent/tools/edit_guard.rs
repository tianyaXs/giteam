//! 编辑护栏：ReadRecorderTool 登记 read 历史，EditGuardTool 强制 edit 前必须 read。
//!
//! pi edit 已内置 old_string 唯一性校验；本装饰器补 Claude Code 风格的
//! "Read-before-edit" 约束——未在本会话 read 过的文件直接拒绝编辑，避免盲改。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

use super::approval::denied_output;
use super::super::interactions::InteractionHub;

/// 包裹 read 工具：执行成功后把读取的路径登记到 hub 的 read 历史。
/// 失败的读取不登记，避免模型把"读失败"误当作"已读"。
pub struct ReadRecorderTool {
    inner: Box<dyn Tool>,
    hub: Arc<InteractionHub>,
}

impl ReadRecorderTool {
    #[must_use]
    pub fn new(inner: Box<dyn Tool>, hub: Arc<InteractionHub>) -> Self {
        Self { inner, hub }
    }
}

#[async_trait]
impl Tool for ReadRecorderTool {
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
        let path = input
            .get("path")
            .and_then(Value::as_str)
            .map(PathBuf::from);
        let output = self.inner.execute(tool_call_id, input, on_update).await?;
        if !output.is_error {
            if let Some(path) = path {
                self.hub.mark_read(path);
            }
        }
        Ok(output)
    }
}

/// 包裹 edit 工具：执行前校验目标文件本会话已被 read 过，否则拒绝。
pub struct EditGuardTool {
    inner: Box<dyn Tool>,
    hub: Arc<InteractionHub>,
}

impl EditGuardTool {
    #[must_use]
    pub fn new(inner: Box<dyn Tool>, hub: Arc<InteractionHub>) -> Self {
        Self { inner, hub }
    }
}

#[async_trait]
impl Tool for EditGuardTool {
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
        if let Some(path) = input.get("path").and_then(Value::as_str) {
            if !self.hub.was_read(Path::new(path)) {
                return Ok(denied_output(
                    self.inner.name(),
                    "请先用 read 工具读取该文件再编辑",
                ));
            }
        }
        self.inner.execute(tool_call_id, input, on_update).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_agent::interactions::{InteractionHub, InteractionStore};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// 最小 inner 工具桩：记录调用次数，可控 is_error。
    struct StubTool {
        tool_name: &'static str,
        calls: Arc<AtomicUsize>,
        fail: bool,
    }

    #[async_trait]
    impl Tool for StubTool {
        fn name(&self) -> &str {
            self.tool_name
        }
        fn label(&self) -> &str {
            self.tool_name
        }
        fn description(&self) -> &str {
            ""
        }
        fn parameters(&self) -> Value {
            serde_json::json!({})
        }
        fn effects(&self) -> ToolEffects {
            ToolEffects::read()
        }
        async fn execute(
            &self,
            _: &str,
            _: Value,
            _: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
        ) -> Result<ToolOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput {
                content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                    "ok".to_string(),
                ))],
                details: None,
                is_error: self.fail,
            })
        }
    }

    fn temp_file() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "giteam-edit-guard-{}.txt",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, "hello").expect("write temp file");
        path
    }

    #[test]
    fn edit_guard_blocks_until_read_then_allows() {
        let file = temp_file();
        let hub = Arc::new(InteractionHub::new(Arc::new(InteractionStore::new())));
        let calls = Arc::new(AtomicUsize::new(0));
        let guard = EditGuardTool::new(
            Box::new(StubTool {
                tool_name: "edit",
                calls: Arc::clone(&calls),
                fail: false,
            }),
            Arc::clone(&hub),
        );

        // 未 read：拒绝，inner 不执行。
        let out = futures::executor::block_on(guard.execute("c1", serde_json::json!({"path": file}), None))
            .expect("execute");
        assert!(out.is_error);
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        // read 后：放行。
        hub.mark_read(file.clone());
        let out = futures::executor::block_on(guard.execute("c2", serde_json::json!({"path": file}), None))
            .expect("execute");
        assert!(!out.is_error);
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn read_recorder_marks_only_successful_reads() {
        let file = temp_file();
        let hub = Arc::new(InteractionHub::new(Arc::new(InteractionStore::new())));
        let calls = Arc::new(AtomicUsize::new(0));

        // 失败的 read 不登记。
        let failing = ReadRecorderTool::new(
            Box::new(StubTool {
                tool_name: "read",
                calls: Arc::clone(&calls),
                fail: true,
            }),
            Arc::clone(&hub),
        );
        futures::executor::block_on(failing.execute("c1", serde_json::json!({"path": file.clone()}), None))
            .expect("execute");
        assert!(!hub.was_read(&file));

        // 成功的 read 登记。
        let ok = ReadRecorderTool::new(
            Box::new(StubTool {
                tool_name: "read",
                calls: Arc::clone(&calls),
                fail: false,
            }),
            Arc::clone(&hub),
        );
        futures::executor::block_on(ok.execute("c2", serde_json::json!({"path": file.clone()}), None))
            .expect("execute");
        assert!(hub.was_read(&file));

        let _ = std::fs::remove_file(&file);
    }
}
