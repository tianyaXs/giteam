//! 自研 compaction 预算钩子：在依赖 pi AutoCompaction 的同时提供可观测阈值。
//!
//! 当前不替换 pi 压缩实现，只暴露预算判断与摘要指令模板，便于后续接入
//! `compact_with_instructions`（把摘要请求放在 user 尾部以复用暖前缀）。

/// 触发压缩建议的粗估 token 阈值（输入侧）。
pub const DEFAULT_COMPACTION_INPUT_TOKEN_BUDGET: u64 = 80_000;

/// 压缩后希望保留的最近消息条数（指导 first_kept 选择，非硬裁剪）。
pub const DEFAULT_KEEP_RECENT_MESSAGES: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompactionBudget {
    pub input_token_budget: u64,
    pub keep_recent_messages: usize,
}

impl Default for CompactionBudget {
    fn default() -> Self {
        Self {
            input_token_budget: DEFAULT_COMPACTION_INPUT_TOKEN_BUDGET,
            keep_recent_messages: DEFAULT_KEEP_RECENT_MESSAGES,
        }
    }
}

#[must_use]
pub fn should_compact(estimated_input_tokens: u64, budget: CompactionBudget) -> bool {
    estimated_input_tokens >= budget.input_token_budget
}

/// 供 `compact_with_instructions` 使用的摘要提示：放在 user 角色以利前缀缓存复用。
#[must_use]
pub fn compaction_summary_instructions() -> &'static str {
    "Summarize the conversation so far for continued work. Preserve: user goals, \
key decisions, file paths touched, unresolved errors, and open TODOs. Omit tool \
noise and duplicated runtime context. Write the summary in the user's language."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_triggers_at_threshold() {
        let budget = CompactionBudget::default();
        assert!(!should_compact(budget.input_token_budget - 1, budget));
        assert!(should_compact(budget.input_token_budget, budget));
    }

    #[test]
    fn instructions_ask_to_preserve_goals() {
        assert!(compaction_summary_instructions().contains("user goals"));
    }
}
