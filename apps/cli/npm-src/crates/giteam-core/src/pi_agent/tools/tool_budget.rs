//! 工具结果预算：截断超大输出并可选落盘，避免上下文被连续 read 撑爆。
//!
//! 对齐社区 harness（DeepSeek / Deep Agents / Claude Code）的
//! tool-result eviction / spill-to-file：上下文只保留预览 + 落盘路径，
//! 需要全文时再按路径/offset 继续读。

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use pi::sdk::{ContentBlock, Result, TextContent, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

/// 子 agent 默认更紧：单次 read 默认 200 行、硬顶 400；结果超阈值落盘。
#[derive(Debug, Clone)]
pub struct ToolBudgetConfig {
    /// `read` 未传 `limit` 时注入的默认行数。
    pub default_read_limit: Option<u32>,
    /// `read` 的 `limit` 硬顶（超过则钳制）。
    pub max_read_limit: Option<u32>,
    /// 单次工具结果写入模型上下文的最大字符数（按 Unicode 字符计）。
    pub max_result_chars: usize,
    /// 落盘目录；None 时只截断不落盘。
    pub spill_dir: Option<PathBuf>,
}

impl ToolBudgetConfig {
    /// 子 agent 紧预算：防连续 `limit:2000` 把上下文堆到 10 万+ token。
    #[must_use]
    pub fn for_subagent(spill_dir: Option<PathBuf>) -> Self {
        Self {
            default_read_limit: Some(200),
            max_read_limit: Some(400),
            max_result_chars: 24_000,
            spill_dir,
        }
    }

    /// 主会话轻预算：仍限制单次结果体积，但允许较大 read 窗口。
    #[must_use]
    pub fn for_primary(spill_dir: Option<PathBuf>) -> Self {
        Self {
            default_read_limit: None,
            max_read_limit: Some(800),
            max_result_chars: 48_000,
            spill_dir,
        }
    }
}

/// 包裹任意工具：读参数钳制 + 结果截断/落盘。
pub struct ToolBudgetTool {
    inner: Box<dyn Tool>,
    config: Arc<ToolBudgetConfig>,
}

impl ToolBudgetTool {
    #[must_use]
    pub fn new(inner: Box<dyn Tool>, config: Arc<ToolBudgetConfig>) -> Self {
        Self { inner, config }
    }
}

#[async_trait]
impl Tool for ToolBudgetTool {
    fn name(&self) -> &str {
        self.inner.name()
    }
    fn label(&self) -> &str {
        self.inner.label()
    }
    fn description(&self) -> &str {
        // read：覆盖描述，引导小窗口分页，避免模型默认拉 2000 行。
        if self.inner.name() == "read"
            && (self.config.default_read_limit.is_some() || self.config.max_read_limit.is_some())
        {
            return "Read file contents (text/images). Prefer small windows: \
use offset/limit to page. Large outputs are truncated; spilled full text \
is saved under the session tool-outputs directory — continue with a later \
offset instead of re-reading the whole file.";
        }
        self.inner.description()
    }
    fn parameters(&self) -> Value {
        let mut params = self.inner.parameters();
        if self.inner.name() != "read" {
            return params;
        }
        let Some(props) = params.get_mut("properties").and_then(Value::as_object_mut) else {
            return params;
        };
        if let Some(limit) = props.get_mut("limit") {
            let mut hint = String::from("Maximum number of lines to read");
            if let Some(default) = self.config.default_read_limit {
                hint.push_str(&format!(" (default {default}"));
                if let Some(max) = self.config.max_read_limit {
                    hint.push_str(&format!(", max {max})"));
                } else {
                    hint.push(')');
                }
            } else if let Some(max) = self.config.max_read_limit {
                hint.push_str(&format!(" (max {max})"));
            }
            if let Some(obj) = limit.as_object_mut() {
                obj.insert("description".to_string(), Value::String(hint));
            }
        }
        params
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
        if self.inner.name() == "read" {
            clamp_read_limit(&mut input, &self.config);
        }
        let output = self.inner.execute(tool_call_id, input, on_update).await?;
        Ok(apply_result_budget(output, tool_call_id, self.inner.name(), &self.config))
    }
}

fn clamp_read_limit(input: &mut Value, config: &ToolBudgetConfig) {
    let Some(obj) = input.as_object_mut() else {
        return;
    };
    let current = obj.get("limit").and_then(Value::as_i64);
    match (current, config.default_read_limit, config.max_read_limit) {
        (None, Some(default), _) => {
            obj.insert("limit".to_string(), Value::from(default));
        }
        (Some(n), _, Some(max)) if n > i64::from(max) => {
            obj.insert("limit".to_string(), Value::from(max));
        }
        (Some(n), _, Some(max)) if n <= 0 => {
            // 非法 limit 交给内层校验；此处不改写。
            let _ = (n, max);
        }
        _ => {}
    }
}

fn apply_result_budget(
    mut output: ToolOutput,
    tool_call_id: &str,
    tool_name: &str,
    config: &ToolBudgetConfig,
) -> ToolOutput {
    let max_chars = config.max_result_chars;
    if max_chars == 0 {
        return output;
    }

    let total_chars: usize = output
        .content
        .iter()
        .map(|block| match block {
            ContentBlock::Text(text) => text.text.chars().count(),
            _ => 0,
        })
        .sum();
    if total_chars <= max_chars {
        return output;
    }

    let full_text = collect_text(&output.content);
    let spill_path = spill_full_text(config.spill_dir.as_ref(), tool_call_id, tool_name, &full_text);

    let preview = head_tail_preview(&full_text, max_chars);
    let footer = match &spill_path {
        Some(path) => format!(
            "\n\n…[tool result truncated: {total_chars} chars → preview {preview_chars}; \
full output saved to {path}. Re-read that path or the original file with a smaller \
offset/limit if you need more.]…",
            preview_chars = preview.chars().count(),
            path = path.display(),
        ),
        None => format!(
            "\n\n…[tool result truncated: {total_chars} chars → preview {preview_chars}. \
Re-read with a smaller offset/limit if you need more.]…",
            preview_chars = preview.chars().count(),
        ),
    };

    output.content = vec![ContentBlock::Text(TextContent::new(format!(
        "{preview}{footer}"
    )))];
    let mut details = output.details.take().unwrap_or_else(|| Value::Object(Default::default()));
    if let Some(obj) = details.as_object_mut() {
        obj.insert("giteamToolBudget".to_string(), Value::Bool(true));
        obj.insert(
            "giteamOriginalChars".to_string(),
            Value::from(total_chars as u64),
        );
        if let Some(path) = &spill_path {
            obj.insert(
                "giteamSpillPath".to_string(),
                Value::String(path.display().to_string()),
            );
        }
    }
    output.details = Some(details);
    output
}

fn collect_text(blocks: &[ContentBlock]) -> String {
    let mut out = String::new();
    for block in blocks {
        if let ContentBlock::Text(text) = block {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&text.text);
        }
    }
    out
}

fn head_tail_preview(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    // 预留 footer 空间：预览用预算的 90%。
    let budget = max_chars.saturating_mul(9) / 10;
    let half = budget / 2;
    let head: String = chars[..half].iter().collect();
    let tail: String = chars[chars.len() - half..].iter().collect();
    format!("{head}\n\n…\n\n{tail}")
}

fn spill_full_text_path_hint(spill_dir: Option<&PathBuf>, tool_call_id: &str) -> Option<PathBuf> {
    let dir = spill_dir?;
    let safe_id: String = tool_call_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    Some(dir.join(format!("{safe_id}.txt")))
}

fn spill_full_text(
    spill_dir: Option<&PathBuf>,
    tool_call_id: &str,
    tool_name: &str,
    text: &str,
) -> Option<PathBuf> {
    let path = spill_full_text_path_hint(spill_dir, tool_call_id)?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let header = format!("# giteam tool output spill\ntool: {tool_name}\nid: {tool_call_id}\n\n");
    if std::fs::write(&path, format!("{header}{text}")).is_ok() {
        Some(path)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct StubTool {
        tool_name: &'static str,
        body: String,
        last_input: Arc<std::sync::Mutex<Option<Value>>>,
        calls: Arc<AtomicUsize>,
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
            "stub"
        }
        fn parameters(&self) -> Value {
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "limit": { "type": "integer", "description": "Maximum number of lines to read" }
                }
            })
        }
        fn effects(&self) -> ToolEffects {
            ToolEffects::read()
        }
        async fn execute(
            &self,
            _: &str,
            input: Value,
            _: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
        ) -> Result<ToolOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.last_input.lock().expect("lock") = Some(input);
            Ok(ToolOutput {
                content: vec![ContentBlock::Text(TextContent::new(self.body.clone()))],
                details: None,
                is_error: false,
            })
        }
    }

    #[test]
    fn clamps_read_limit_and_injects_default() {
        let last_input = Arc::new(std::sync::Mutex::new(None));
        let tool = ToolBudgetTool::new(
            Box::new(StubTool {
                tool_name: "read",
                body: "ok".into(),
                last_input: Arc::clone(&last_input),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(ToolBudgetConfig::for_subagent(None)),
        );

        futures::executor::block_on(tool.execute(
            "c1",
            serde_json::json!({"path": "a.rs", "limit": 2000}),
            None,
        ))
        .expect("execute");
        let input = last_input.lock().expect("lock").clone().expect("input");
        assert_eq!(input["limit"], 400);

        futures::executor::block_on(tool.execute(
            "c2",
            serde_json::json!({"path": "a.rs"}),
            None,
        ))
        .expect("execute");
        let input = last_input.lock().expect("lock").clone().expect("input");
        assert_eq!(input["limit"], 200);
    }

    #[test]
    fn spills_and_truncates_oversized_result() {
        let dir = tempfile::tempdir().expect("tempdir");
        let body: String = (0..3_000).map(|i| format!("line{i}\n")).collect();
        let tool = ToolBudgetTool::new(
            Box::new(StubTool {
                tool_name: "read",
                body: body.clone(),
                last_input: Arc::new(std::sync::Mutex::new(None)),
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(ToolBudgetConfig {
                default_read_limit: Some(200),
                max_read_limit: Some(400),
                max_result_chars: 500,
                spill_dir: Some(dir.path().to_path_buf()),
            }),
        );

        let out = futures::executor::block_on(tool.execute(
            "call-1",
            serde_json::json!({"path": "big.rs"}),
            None,
        ))
        .expect("execute");
        let ContentBlock::Text(text) = &out.content[0] else {
            panic!("expected text");
        };
        assert!(text.text.contains("truncated"));
        assert!(text.text.chars().count() < body.chars().count());
        let spill = dir.path().join("call-1.txt");
        assert!(spill.exists(), "spill missing");
        let spilled = std::fs::read_to_string(&spill).expect("read spill");
        assert!(spilled.contains("line0"));
        assert!(spilled.contains("line2999"));
    }
}
