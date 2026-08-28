//! Question 工具：模型主动向用户提问（单选/多选/自由文本）。
//! 交互走与审批相同的 InteractionStore 闭环；取消/超时/中止以 is_error 收尾。

use std::sync::Arc;

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

use super::approval::denied_output;
use super::super::interactions::{
    new_interaction_id, now_ms, InteractionHub, InteractionResolution, DEFAULT_INTERACTION_TIMEOUT,
};
use super::super::types::{AgentInteraction, AgentInteractionReply, AgentQuestion, AgentQuestionOption};

pub struct QuestionTool {
    hub: Arc<InteractionHub>,
}

impl QuestionTool {
    #[must_use]
    pub fn new(hub: Arc<InteractionHub>) -> Self {
        Self { hub }
    }
}

#[async_trait]
impl Tool for QuestionTool {
    fn name(&self) -> &str {
        "question"
    }

    fn label(&self) -> &str {
        "Question"
    }

    fn description(&self) -> &str {
        "Clarify requirements or have the user choose between options. Prefer calling this tool over writing the questions as plain text when a task is too ambiguous to start, when choosing between approaches, or when a decision only the user can make is missing. Supports single-choice, multi-choice, and free-text answers; keep options to four or fewer. Never use this tool for pseudo-confirmation such as \"Shall I proceed?\" or \"Run it now?\" — just do the obvious next step, or rely on command approval if the action is risky."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "description": "一次最多提几个问题",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": {"type": "string", "description": "完整的问题"},
                            "header": {"type": "string", "description": "短标题（可选）"},
                            "options": {
                                "type": "array",
                                "description": "候选选项；为空时必须允许自由文本（custom=true）；最多 4 项",
                                "maxItems": 4,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "description": {"type": "string"}
                                    },
                                    "required": ["label"]
                                }
                            },
                            "multiple": {"type": "boolean", "description": "是否多选"},
                            "custom": {"type": "boolean", "description": "是否允许自由文本回答"}
                        },
                        "required": ["question"]
                    }
                }
            },
            "required": ["questions"]
        })
    }

    fn effects(&self) -> ToolEffects {
        // 不改变本地状态，仅等待用户输入
        ToolEffects::read()
    }

    async fn execute(
        &self,
        tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let questions = match parse_questions(&input) {
            Ok(questions) => questions,
            Err(message) => return Ok(invalid_output(message)),
        };
        let Some(context) = self.hub.run_context() else {
            return Ok(denied_output("question", "缺少运行上下文，无法发起提问"));
        };
        let interaction = AgentInteraction::Question {
            id: new_interaction_id(),
            session_id: context.session_id.clone(),
            run_id: context.run_id.clone(),
            tool_call_id: tool_call_id.to_string(),
            questions: questions.clone(),
            created_at_ms: now_ms(),
        };
        let resolution = self
            .hub
            .store()
            .request(interaction, &context, DEFAULT_INTERACTION_TIMEOUT)
            .await;
        match resolution {
            InteractionResolution::Reply(AgentInteractionReply::Answers { answers }) => {
                match validate_answers(&questions, &answers) {
                    Ok(()) => Ok(answered_output(&questions, &answers)),
                    Err(message) => Ok(invalid_output(message)),
                }
            }
            InteractionResolution::Reply(AgentInteractionReply::Cancel) => {
                Ok(denied_output("question", "用户取消了提问"))
            }
            InteractionResolution::Timeout => {
                Ok(denied_output("question", "等待回答超时"))
            }
            InteractionResolution::Aborted => Ok(denied_output("question", "任务已中止")),
            InteractionResolution::Shutdown => Ok(denied_output("question", "服务已关闭")),
            _ => Ok(denied_output("question", "无效的回答")),
        }
    }
}

fn parse_questions(input: &Value) -> std::result::Result<Vec<AgentQuestion>, String> {
    let items = input
        .get("questions")
        .and_then(Value::as_array)
        .ok_or_else(|| "缺少 questions 数组".to_string())?;
    if items.is_empty() {
        return Err("questions 不能为空".to_string());
    }
    let mut questions = Vec::with_capacity(items.len());
    for item in items {
        let question = item
            .get("question")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .ok_or_else(|| "question 不能为空".to_string())?
            .to_string();
        let header = item
            .get("header")
            .and_then(Value::as_str)
            .map(str::to_string);
        let options = item
            .get("options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .filter_map(|option| {
                        Some(AgentQuestionOption {
                            label: option.get("label")?.as_str()?.to_string(),
                            description: option
                                .get("description")
                                .and_then(Value::as_str)
                                .map(str::to_string),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let multiple = item
            .get("multiple")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let custom = item.get("custom").and_then(Value::as_bool).unwrap_or(true);
        if options.is_empty() && !custom {
            return Err(format!("问题「{question}」没有选项时必须允许自由文本回答"));
        }
        if options.len() > 4 {
            return Err(format!(
                "问题「{question}」的选项不能超过 4 个（收到 {}）",
                options.len()
            ));
        }
        questions.push(AgentQuestion {
            question,
            header,
            options,
            multiple,
            custom,
        });
    }
    Ok(questions)
}

fn validate_answers(
    questions: &[AgentQuestion],
    answers: &[Vec<String>],
) -> std::result::Result<(), String> {
    if answers.len() != questions.len() {
        return Err(format!(
            "回答数量（{}）与问题数量（{}）不一致",
            answers.len(),
            questions.len()
        ));
    }
    for (question, answers) in questions.iter().zip(answers) {
        if !question.multiple && answers.len() > 1 {
            return Err(format!("问题「{}」为单选，但收到多个回答", question.question));
        }
    }
    Ok(())
}

fn answered_output(questions: &[AgentQuestion], answers: &[Vec<String>]) -> ToolOutput {
    let mut lines = Vec::new();
    for (question, answers) in questions.iter().zip(answers) {
        let answer = if answers.is_empty() {
            "（未回答）".to_string()
        } else {
            answers.join("、")
        };
        lines.push(format!("问：{}\n答：{answer}", question.question));
    }
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            lines.join("\n\n"),
        ))],
        details: Some(serde_json::json!({
            "questions": questions,
            "answers": answers,
        })),
        is_error: false,
    }
}

fn invalid_output(message: String) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            format!("question 参数无效：{message}"),
        ))],
        details: None,
        is_error: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rejects_more_than_four_options() {
        let input = serde_json::json!({
            "questions": [{
                "question": "选哪个？",
                "options": [
                    {"label": "a"}, {"label": "b"}, {"label": "c"},
                    {"label": "d"}, {"label": "e"}
                ]
            }]
        });
        let error = parse_questions(&input).expect_err("five options should be rejected");
        assert!(error.contains('4'), "expected limit message, got: {error}");
    }

    #[test]
    fn parse_accepts_exactly_four_options() {
        let input = serde_json::json!({
            "questions": [{
                "question": "选哪个？",
                "options": [
                    {"label": "a"}, {"label": "b"}, {"label": "c"}, {"label": "d"}
                ],
                "custom": false
            }]
        });
        let questions = parse_questions(&input).expect("four options should parse");
        assert_eq!(questions[0].options.len(), 4);
    }

    #[test]
    fn parse_requires_non_empty_question_text() {
        let input = serde_json::json!({"questions": [{"options": [{"label": "a"}]}]});
        assert!(parse_questions(&input).is_err());
    }
}
