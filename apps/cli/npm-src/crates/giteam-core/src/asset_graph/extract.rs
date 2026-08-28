//! 确定性抽取层：把事件（live）与会话 JSONL（回放）映射为图谱事实。
//!
//! 不调 LLM、100% 可复现（semantica 的核心主张）。三类规则：
//! 1. 结构链：Session ─has_run→ Run ─has_turn→ Turn ─has_message/used_tool→ …
//! 2. 资产边：ToolCall ─read/modified/executed/failed_with/produced→ File/Command/Error/Commit
//! 3. 修复启发：同一 turn 内 failed 调用之后的首个同工具成功调用 → Error ─resolved_by→ ToolCall
//!
//! 实体归一（跨会话命中同一节点的关键）：
//! - 文件路径 → 仓库相对 posix 路径
//! - 命令 → 压缩空白后的全文（同命令幂等合并）
//! - 错误 → 首个非空行、数字抹平后的指纹（同类编译错误跨会话同节点）

use std::path::Path;

use serde_json::Value;

use super::store::{EdgeFact, FactBatch, NodeFact};
use crate::pi_agent::{AgentEvent, AgentEventEnvelope};
use crate::pi_agent::{AgentMessage, AgentPart, AgentRole};

/// 会话内单 run 的增量累积器：completed 级事件先进内存，
/// TurnCompleted/RunCompleted 时成批产出（写放大控制）。
#[derive(Debug, Default)]
pub struct SessionAccumulator {
    pub repo_path: String,
    pub session_id: String,
    pub run_id: String,
    turn_key: Option<String>,
    turn_index: u64,
    sequence: u64,
    nodes: Vec<NodeFact>,
    edges: Vec<EdgeFact>,
    /// 本 run 内的（序号, 工具名, 是否失败, tool_call key）序列，turn 收尾做修复配对。
    tool_timeline: Vec<(u64, String, bool, String)>,
    /// 已产出的 failed_with 边（error_key, tool 序号），修复配对用。
    failures: Vec<(String, u64)>,
    /// 会话基底节点是否已写入。多 turn 会话只写一次——后续 turn 重推
    /// 无 intent 的基底会把首条用户消息写入的 intent 版 props 覆盖掉。
    session_base_written: bool,
    // ---- 语义抽取输入收集（turn 级摘要，见 extraction.rs） ----
    turn_user_text: String,
    turn_assistant_text: String,
    turn_file_keys: Vec<(String, String)>,
    turn_commands: Vec<String>,
    turn_error_lines: Vec<String>,
    /// 会话是否已观察到工具动作（文件/命令）——跨 turn 累计，用于 chitchat 标记。
    session_had_tool_actions: bool,
    intent_recorded: bool,
}

impl SessionAccumulator {
    #[must_use]
    pub fn new(repo_path: &str, session_id: &str, run_id: &str) -> Self {
        Self {
            repo_path: repo_path.to_string(),
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            ..Self::default()
        }
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    #[must_use]
    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    #[must_use]
    pub fn repo_path(&self) -> &str {
        &self.repo_path
    }

    /// 摄入一条 completed 级事件；返回 true 表示应 flush（turn/run 边界）。
    pub fn ingest(&mut self, envelope: &AgentEventEnvelope) -> bool {
        self.sequence = self.sequence.max(envelope.sequence);
        match &envelope.event {
            AgentEvent::TurnStarted { index } => {
                self.turn_index = *index as u64;
                // 必须含 run_id：每个 prompt run 的 turnIndex 都会从 0 重计，
                // 若只按 session+index 哈希，后一次 run 会撞上第一次的 turn/job，
                // 导致「已 done 不再入队」或长时间复用同一 pending，顶栏看不到新队列。
                let key = turn_key(&self.session_id, &self.run_id, self.turn_index);
                let session = session_key(&self.session_id);
                if !self.session_base_written {
                    self.session_base_written = true;
                    self.push_node(session_node(&self.session_id, &self.repo_path, envelope.timestamp_ms));
                }
                self.push_edge(&session, &key, "has_turn", envelope, serde_json::json!({}));
                self.push_node(NodeFact {
                    node_type: "turn",
                    key: key.clone(),
                    label: format!("turn {}", self.turn_index),
                    props: serde_json::json!({}),
                    timestamp_ms: envelope.timestamp_ms,
                });
                let run_key = run_key(&self.session_id, &self.run_id);
                self.push_node(NodeFact {
                    node_type: "run",
                    key: run_key.clone(),
                    label: short(&self.run_id),
                    props: serde_json::json!({"runId": self.run_id}),
                    timestamp_ms: envelope.timestamp_ms,
                });
                self.push_edge(&key, &run_key, "in_run", envelope, serde_json::json!({}));
                self.turn_key = Some(key);
                false
            }
            AgentEvent::TurnCompleted { .. } => {
                // turn 边界：用本轮用户首句作可读标签（替代裸 "turn N"）。
                if let Some(turn_key) = self.turn_key.clone() {
                    let user = self.turn_user_text.trim();
                    let label = if user.is_empty() {
                        format!("turn {}", self.turn_index)
                    } else {
                        snippet(user, 80)
                    };
                    let mut props = serde_json::json!({ "turnIndex": self.turn_index });
                    if !user.is_empty() {
                        props["intent"] = serde_json::json!(snippet(user, 120));
                    }
                    self.push_node(NodeFact {
                        node_type: "turn",
                        key: turn_key,
                        label,
                        props,
                        timestamp_ms: envelope.timestamp_ms,
                    });
                }
                true
            }
            AgentEvent::RunCompleted | AgentEvent::RunFailed { .. } => true,
            AgentEvent::MessageCompleted { message } => {
                self.ingest_message(message, envelope);
                false
            }
            AgentEvent::ToolStarted {
                tool_call_id,
                tool_name,
                input,
            } => {
                self.ingest_tool_started(tool_call_id, tool_name, input, envelope);
                false
            }
            AgentEvent::ToolCompleted {
                tool_call_id,
                tool_name,
                output,
                is_error,
            } => {
                self.ingest_tool_completed(tool_call_id, tool_name, output, *is_error, envelope);
                false
            }
            _ => false, // delta/interaction 等中间态不进图
        }
    }

    fn ingest_message(&mut self, message: &AgentMessage, envelope: &AgentEventEnvelope) {
        let text = message_text(message);
        // 语义抽取输入：本轮用户意图 / 助手结论（截断防爆）。
        match message.role {
            AgentRole::User => {
                if self.turn_user_text.is_empty() {
                    self.turn_user_text = snippet(&text, 1200);
                } else {
                    self.turn_user_text.push('\n');
                    self.turn_user_text.push_str(&snippet(&text, 400));
                }
            }
            AgentRole::Assistant => {
                if !text.trim().is_empty() {
                    if !self.turn_assistant_text.is_empty() {
                        self.turn_assistant_text.push('\n');
                    }
                    self.turn_assistant_text.push_str(&snippet(&text, 1500));
                }
            }
            _ => {}
        }
        // 空正文不进图：流式占位 / 空 Tool 结果只会变成一堆无信息的「消息」节点。
        // 用户意图仍已写入 turn_user_text，供 turn 标签与抽取使用。
        if text.trim().is_empty() {
            return;
        }
        let role = format!("{:?}", message.role);
        let label = {
            let snip = snippet(&text, 80);
            if snip.is_empty() {
                match message.role {
                    AgentRole::User => "用户消息".into(),
                    AgentRole::Assistant => "助手回复".into(),
                    AgentRole::Tool => "工具输出".into(),
                    _ => "消息".into(),
                }
            } else {
                snip
            }
        };
        let node = NodeFact {
            node_type: "message",
            key: message_key(&self.session_id, &message.id),
            label,
            props: serde_json::json!({
                "role": role,
                "text": snippet(&text, 2000),
                "messageId": message.id,
            }),
            timestamp_ms: envelope.timestamp_ms,
        };
        self.push_node(node.clone());
        match self.turn_key.clone() {
            Some(turn) => {
                self.push_edge(&turn, &node.key, "has_message", envelope, serde_json::json!({}));
            }
            None => {
                let session = session_key(&self.session_id);
                self.push_edge(&session, &node.key, "has_message", envelope, serde_json::json!({}));
            }
        }
        // 首条用户消息 = 会话意图（跨会话感知的关键字段）。
        // 注意 props 必须带上 sessionId/repoPath：会话节点可能先于意图写入，
        // upsert 的 props 是整对象替换，丢了 sessionId 会破坏按 id 反查。
        // intent 兜底只存 120 字符首句：完整提炼由 extract 子代理的
        // session_intent 写回（每轮覆盖），不再 dump 2000 字符原文。
        if message.role == AgentRole::User && !self.intent_recorded && !text.trim().is_empty() {
            let title = snippet(&text, 80);
            let weak = is_weak_user_title(&title);
            // 弱标题（继续/你好…）先写入但不锁死，留给后续实意消息或 LLM session_intent 覆盖。
            if !weak {
                self.intent_recorded = true;
            }
            // 已发生工具动作（文件/命令）→ 保留 intent；否则标 chitchat，紧凑图聚合。
            let has_tool_actions = self.session_had_tool_actions;
            let mut props = serde_json::json!({
                "sessionId": self.session_id,
                "repoPath": self.repo_path,
                "intent": snippet(&text, 120),
            });
            if !has_tool_actions {
                // 无资产动作的会话视为闲聊：不进启动摘要、图谱聚合为闲聊组。
                props["chitchat"] = serde_json::json!(true);
            }
            self.push_node(NodeFact {
                node_type: "session",
                key: session_key(&self.session_id),
                label: title,
                props,
                timestamp_ms: envelope.timestamp_ms,
            });
        }
    }

    fn ingest_tool_started(
        &mut self,
        tool_call_id: &str,
        tool_name: &str,
        input: &Value,
        envelope: &AgentEventEnvelope,
    ) {
        let tool_key = toolcall_key(&self.session_id, tool_call_id);
        self.push_node(NodeFact {
            node_type: "tool_call",
            key: tool_key.clone(),
            label: format!("{tool_name}({})", snippet(&input.to_string(), 48)),
            props: serde_json::json!({
                "toolName": tool_name,
                "input": snippet(&input.to_string(), 1000),
            }),
            timestamp_ms: envelope.timestamp_ms,
        });
        let anchor = self
            .turn_key
            .clone()
            .unwrap_or_else(|| session_key(&self.session_id));
        self.push_edge(&anchor, &tool_key, "used_tool", envelope, serde_json::json!({"toolName": tool_name}));

        // 资产边：从工具入参确定性地抽路径/命令。
        let mut saw_asset = false;
        for (path, action) in extract_paths_from_input(tool_name, input) {
            saw_asset = true;
            let normalized = normalize_file_path(&self.repo_path, &path);
            let file_key = file_key(&self.repo_path, &path);
            if !self
                .turn_file_keys
                .iter()
                .any(|(existing, _)| existing == &normalized)
            {
                self.turn_file_keys.push((normalized.clone(), file_key.clone()));
            }
            self.push_node(NodeFact {
                node_type: "file",
                key: file_key.clone(),
                label: normalized,
                props: serde_json::json!({}),
                timestamp_ms: envelope.timestamp_ms,
            });
            self.push_edge(&tool_key, &file_key, action, envelope, serde_json::json!({}));
        }
        if let Some(command) = extract_command_from_input(tool_name, input) {
            saw_asset = true;
            let normalized = normalize_command(&command);
            if !self.turn_commands.contains(&normalized) {
                self.turn_commands.push(snippet(&normalized, 200));
            }
            let command_key = super::store::node_id("command", &normalized);
            self.push_node(NodeFact {
                node_type: "command",
                key: command_key.clone(),
                label: snippet(&normalized, 64),
                props: serde_json::json!({"normalized": snippet(&normalized, 500)}),
                timestamp_ms: envelope.timestamp_ms,
            });
            self.push_edge(&tool_key, &command_key, "executed", envelope, serde_json::json!({}));
        }
        if saw_asset {
            self.session_had_tool_actions = true;
        }
    }

    fn ingest_tool_completed(
        &mut self,
        tool_call_id: &str,
        tool_name: &str,
        output: &Value,
        is_error: bool,
        envelope: &AgentEventEnvelope,
    ) {
        let tool_key = toolcall_key(&self.session_id, tool_call_id);
        let seq = self.bump_sequence(envelope);
        self.tool_timeline.push((seq, tool_name.to_string(), is_error, tool_key.clone()));
        if is_error {
            let raw_output = output_text(output);
            if let Some(first) = raw_output.lines().map(str::trim).find(|l| !l.is_empty()) {
                let line = snippet(first, 200);
                if !self.turn_error_lines.contains(&line) {
                    self.turn_error_lines.push(line);
                }
            }
            let fingerprint = error_fingerprint(&raw_output);
            if fingerprint.is_empty() {
                return;
            }
            let error_key = super::store::node_id("error", &fingerprint);
            let first_line = fingerprint.lines().next().unwrap_or_default();
            self.push_node(NodeFact {
                node_type: "error",
                key: error_key.clone(),
                label: snippet(first_line, 80),
                props: serde_json::json!({"fingerprint": fingerprint}),
                timestamp_ms: envelope.timestamp_ms,
            });
            self.push_edge(&tool_key, &error_key, "failed_with", envelope, serde_json::json!({"toolName": tool_name}));
            self.failures.push((error_key, seq));
            return;
        }
        // 成功的 bash 输出里解析 commit（`[main abc1234]` / `commit abc1234`）。
        if let Some(sha) = extract_commit_sha(tool_name, &output_text(output)) {
            let commit_key = format!("commit:{sha}");
            self.push_node(NodeFact {
                node_type: "commit",
                key: commit_key.clone(),
                label: sha.clone(),
                props: serde_json::json!({"sha": sha}),
                timestamp_ms: envelope.timestamp_ms,
            });
            self.push_edge(&tool_key, &commit_key, "produced", envelope, serde_json::json!({}));
        }
    }

    /// 产出并清空累积事实（turn/run 边界调用）。附带做修复配对。
    #[must_use]
    pub fn take_batch(&mut self) -> FactBatch {
        let mut batch = FactBatch {
            nodes: std::mem::take(&mut self.nodes),
            edges: std::mem::take(&mut self.edges),
        };
        // 修复启发：每个失败之后、同工具的首个成功调用 = resolved_by。
        let timeline = std::mem::take(&mut self.tool_timeline);
        for (error_key, failed_seq) in std::mem::take(&mut self.failures) {
            for (seq, _tool, failed, tool_key) in &timeline {
                if *failed || *seq <= failed_seq {
                    continue;
                }
                // 同指纹错误只连一条 resolved_by（首个成功者）。
                let already = batch
                    .edges
                    .iter()
                    .any(|e| e.edge_type == "resolved_by" && e.src_key == error_key);
                if already {
                    break;
                }
                batch.edges.push(EdgeFact {
                    src_key: error_key.clone(),
                    dst_key: tool_key.clone(),
                    edge_type: "resolved_by",
                    props: serde_json::json!({}),
                    session_id: self.session_id.clone(),
                    run_id: self.run_id.clone(),
                    event_id: format!("resolve-{}", self.sequence),
                    sequence: self.sequence,
                    timestamp_ms: 0,
                });
                break;
            }
        }
        // intent 不在此重置：每个 run 的首条用户消息记录一次会话意图，
        // run 内后续 steer 消息不覆盖；新 run 的首条消息会更新为最新任务。
        batch
    }

    /// 产出本轮的语义抽取输入并重置收集器（turn 边界调用）。
    #[must_use]
    pub fn take_extraction_input(&mut self, timestamp_ms: u64, sequence: u64) -> super::extraction::ExtractionInput {
        super::extraction::ExtractionInput {
            session_id: self.session_id.clone(),
            run_id: self.run_id.clone(),
            turn_key: self.turn_key.clone(),
            session_key: session_key(&self.session_id),
            user_text: std::mem::take(&mut self.turn_user_text),
            assistant_text: std::mem::take(&mut self.turn_assistant_text),
            file_keys: std::mem::take(&mut self.turn_file_keys),
            commands: std::mem::take(&mut self.turn_commands),
            error_lines: std::mem::take(&mut self.turn_error_lines),
            timestamp_ms,
            sequence,
            repo_path: self.repo_path.clone(),
            provider: None,
            model: None,
            thinking: None,
        }
    }

    fn push_node(&mut self, node: NodeFact) {
        self.nodes.push(node);
    }

    fn push_edge(
        &mut self,
        src_key: &str,
        dst_key: &str,
        edge_type: &'static str,
        envelope: &AgentEventEnvelope,
        props: Value,
    ) {
        self.edges.push(EdgeFact {
            src_key: src_key.to_string(),
            dst_key: dst_key.to_string(),
            edge_type,
            props,
            session_id: self.session_id.clone(),
            run_id: self.run_id.clone(),
            event_id: envelope.event_id.clone(),
            sequence: envelope.sequence,
            timestamp_ms: envelope.timestamp_ms,
        });
    }

    fn bump_sequence(&mut self, envelope: &AgentEventEnvelope) -> u64 {
        self.sequence = self.sequence.max(envelope.sequence);
        envelope.sequence
    }
}

// ---------- 键构造 ----------

fn session_key(session_id: &str) -> String {
    super::store::node_id("session", session_id)
}

fn run_key(session_id: &str, run_id: &str) -> String {
    super::store::node_id("run", &format!("{session_id}/{run_id}"))
}

fn turn_key(session_id: &str, run_id: &str, index: u64) -> String {
    super::store::node_id("turn", &format!("{session_id}/{run_id}/turn/{index}"))
}

fn message_key(session_id: &str, message_id: &str) -> String {
    super::store::node_id("message", &format!("{session_id}/{message_id}"))
}

fn toolcall_key(session_id: &str, tool_call_id: &str) -> String {
    super::store::node_id("tool_call", &format!("{session_id}/{tool_call_id}"))
}


fn is_weak_user_title(title: &str) -> bool {
    let t = title.trim();
    if t.is_empty() || t.chars().count() < 2 {
        return true;
    }
    const WEAK: &[&str] = &[
        "继续", "好的", "好", "嗯", "嗯嗯", "谢谢", "你好", "在吗",
        "ok", "okay", "yes", "y", "hi", "hello", "thanks", "thx",
    ];
    let lower = t.to_lowercase();
    WEAK.iter().any(|w| lower == *w || t == *w)
}

fn session_node(session_id: &str, repo_path: &str, timestamp_ms: u64) -> NodeFact {
    NodeFact {
        node_type: "session",
        key: session_key(session_id),
        // 空 label：upsert 保留已有意图标题，避免每次 TurnStarted 把「修复登录…」盖成「会话」。
        // 展示名由首条用户消息 / LLM session_intent 回填 props.intent + label。
        label: String::new(),
        props: serde_json::json!({"sessionId": session_id, "repoPath": repo_path}),
        timestamp_ms,
    }
}

// ---------- 归一化与抽取 ----------

/// 文件路径归一：绝对路径在仓库内则相对化，统一 posix 分隔。
/// key 与 label 共用（查询按 label 精确匹配文件）。
#[must_use]
pub fn normalize_file_path(repo_path: &str, path: &str) -> String {
    let trimmed = path.trim();
    let repo = Path::new(repo_path);
    let candidate = Path::new(trimmed);
    let relative = if candidate.is_absolute() {
        candidate
            .strip_prefix(repo)
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|_| candidate.to_path_buf())
    } else {
        candidate.to_path_buf()
    };
    relative
        .components()
        .filter_map(|c| {
            let part = c.as_os_str().to_string_lossy().to_string();
            if part.is_empty() { None } else { Some(part) }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 文件 canonical key：绝对路径在仓库内则相对化，统一 posix 分隔。
#[must_use]
pub fn file_key(repo_path: &str, path: &str) -> String {
    super::store::node_id("file", &normalize_file_path(repo_path, path))
}

/// 从工具入参确定性抽取 (路径, 动作) 列表。
/// edit/write/ls/grep 等：`file_path`/`path`/`notebook_path`；多目标工具（edit all）取首个。
#[must_use]
pub fn extract_paths_from_input(tool_name: &str, input: &Value) -> Vec<(String, &'static str)> {
    let action = match tool_name {
        "edit" | "write" | "multiedit" | "create" => "modified",
        "read" | "ls" | "grep" | "glob" => "read",
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    for field in ["file_path", "path", "notebook_path"] {
        if let Some(path) = input.get(field).and_then(Value::as_str) {
            if !path.trim().is_empty() {
                out.push((path.to_string(), action));
            }
            break;
        }
    }
    out
}

/// bash 类工具：取 `command` 入参。
#[must_use]
pub fn extract_command_from_input(tool_name: &str, input: &Value) -> Option<String> {
    if !matches!(tool_name, "bash" | "shell" | "terminal") {
        return None;
    }
    input
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// 命令归一：压缩空白。同命令反复执行命中同一节点（幂等合并）。
#[must_use]
pub fn normalize_command(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 错误指纹：首个非空行，数字抹平为 `#`，截 200 字节。
/// 同类编译/运行错误跨会话命中同一 Error 节点 → resolved_by 可传承。
#[must_use]
pub fn error_fingerprint(text: &str) -> String {
    let first_line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if first_line.is_empty() {
        return String::new();
    }
    let mut fingerprint = String::with_capacity(first_line.len());
    let mut in_digits = false;
    for ch in first_line.chars() {
        if ch.is_ascii_digit() {
            if !in_digits {
                fingerprint.push('#');
                in_digits = true;
            }
        } else {
            in_digits = false;
            fingerprint.push(ch);
        }
    }
    snippet(&fingerprint, 200)
}

/// git commit 成功输出中的 sha：`[main abc1234] …` 或 `commit abc1234…`。
/// 无 regex 依赖，手写扫描（只对 bash 工具调用）。
#[must_use]
pub fn extract_commit_sha(tool_name: &str, output_text: &str) -> Option<String> {
    if !matches!(tool_name, "bash" | "shell" | "terminal") {
        return None;
    }
    for line in output_text.lines().take(20) {
        let line = line.trim();
        // 形如 [branch abc1234] 或 [branch abc1234 subject]
        if line.starts_with('[') {
            if let Some(close) = line.find(']') {
                let inner = &line[1..close];
                if let Some((_, sha)) = inner.rsplit_once(' ') {
                    if is_hex_sha(sha) {
                        return Some(sha.to_string());
                    }
                }
            }
        }
        // 形如 "commit abc1234…"（git log/rev-parse 风格输出也可命中）
        if let Some(rest) = line.strip_prefix("commit ") {
            let sha = rest.split_whitespace().next().unwrap_or("");
            if is_hex_sha(sha) {
                return Some(sha.to_string());
            }
        }
    }
    None
}

fn is_hex_sha(text: &str) -> bool {
    (7..=40).contains(&text.len())
        && text.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// 从 tool output（pi 的 content blocks 或纯文本）提取可读文本。
#[must_use]
pub fn output_text(output: &Value) -> String {
    match output {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .get("content")
            .map(|content| output_text(content))
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn message_text(message: &AgentMessage) -> String {
    message
        .parts
        .iter()
        .filter_map(|part| match part {
            AgentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn snippet(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let cut: String = trimmed.chars().take(max_chars).collect();
    format!("{cut}…")
}

fn short(text: &str) -> String {
    snippet(text, 24)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_agent::{AgentMessage, AgentPart, AgentRole};

    fn envelope(sequence: u64, event: AgentEvent) -> AgentEventEnvelope {
        AgentEventEnvelope {
            schema_version: 1,
            event_id: format!("evt-{sequence}"),
            sequence,
            repo_path: "/repo".into(),
            session_id: "sess-1".into(),
            run_id: Some("run-1".into()),
            timestamp_ms: 1_000 + sequence,
            event,
        }
    }

    fn user_message(id: &str, text: &str) -> AgentEvent {
        AgentEvent::MessageCompleted {
            message: AgentMessage {
                id: id.into(),
                role: AgentRole::User,
                created_at_ms: 1,
                parts: vec![AgentPart::Text { text: text.into() }],
            },
        }
    }

    #[test]
    fn intent_and_chain_are_extracted() {
        let mut acc = SessionAccumulator::new("/repo", "sess-1", "run-1");
        acc.ingest(&envelope(1, AgentEvent::TurnStarted { index: 0 }));
        acc.ingest(&envelope(2, user_message("m1", "修复登录超时")));
        acc.ingest(&envelope(
            3,
            AgentEvent::ToolStarted {
                tool_call_id: "tc1".into(),
                tool_name: "edit".into(),
                input: serde_json::json!({"file_path": "/repo/src/auth.rs"}),
            },
        ));
        acc.ingest(&envelope(
            4,
            AgentEvent::ToolCompleted {
                tool_call_id: "tc1".into(),
                tool_name: "edit".into(),
                output: serde_json::json!("ok"),
                is_error: false,
            },
        ));
        let flush = acc.ingest(&envelope(5, AgentEvent::TurnCompleted { index: 0 }));
        assert!(flush);
        let batch = acc.take_batch();

        let types: Vec<&str> = batch.nodes.iter().map(|n| n.node_type).collect();
        assert!(types.contains(&"session"));
        assert!(types.contains(&"turn"));
        assert!(types.contains(&"message"));
        assert!(types.contains(&"tool_call"));
        assert!(types.contains(&"file"));
        // 批次里会话节点有两份（TurnStarted 的基底 + intent 合并版），落库 upsert 合并。
        let session = batch
            .nodes
            .iter()
            .find(|n| n.node_type == "session" && n.props.get("intent").is_some())
            .expect("session with intent");
        assert_eq!(session.props["intent"], "修复登录超时");
        assert!(session.props.get("sessionId").is_some(), "sessionId must survive props merge");
        let turn = batch
            .nodes
            .iter()
            .filter(|n| n.node_type == "turn")
            .find(|n| n.props.get("intent").is_some())
            .or_else(|| batch.nodes.iter().rfind(|n| n.node_type == "turn"))
            .unwrap();
        assert_eq!(turn.label, "修复登录超时");
        assert_eq!(turn.props["intent"], "修复登录超时");
        let file = batch.nodes.iter().find(|n| n.node_type == "file").unwrap();
        assert_eq!(file.label, "src/auth.rs");
        let edge_types: Vec<&str> = batch.edges.iter().map(|e| e.edge_type).collect();
        assert!(edge_types.contains(&"has_turn"));
        assert!(edge_types.contains(&"has_message"));
        assert!(edge_types.contains(&"used_tool"));
        assert!(edge_types.contains(&"modified"));
    }

    #[test]
    #[test]
    fn turn_keys_diverge_across_runs_with_same_index() {
        let mut a = SessionAccumulator::new("/repo", "sess-1", "run-a");
        a.ingest(&envelope(1, AgentEvent::TurnStarted { index: 0 }));
        let key_a = a.take_extraction_input(1, 1).turn_key.clone();

        let mut b = SessionAccumulator::new("/repo", "sess-1", "run-b");
        b.ingest(&envelope(1, AgentEvent::TurnStarted { index: 0 }));
        let key_b = b.take_extraction_input(1, 1).turn_key.clone();

        assert_ne!(key_a, key_b, "same session turnIndex must not collide across runs");
        assert!(key_a.as_ref().unwrap().starts_with("turn:"));
        assert!(key_b.as_ref().unwrap().starts_with("turn:"));
    }

    fn error_fingerprinting_and_resolution() {
        let mut acc = SessionAccumulator::new("/repo", "sess-1", "run-1");
        acc.ingest(&envelope(1, AgentEvent::TurnStarted { index: 0 }));
        acc.ingest(&envelope(
            2,
            AgentEvent::ToolStarted {
                tool_call_id: "t1".into(),
                tool_name: "bash".into(),
                input: serde_json::json!({"command": "cargo build"}),
            },
        ));
        acc.ingest(&envelope(
            3,
            AgentEvent::ToolCompleted {
                tool_call_id: "t1".into(),
                tool_name: "bash".into(),
                output: serde_json::json!("error[E0308]: mismatched types at line 42"),
                is_error: true,
            },
        ));
        acc.ingest(&envelope(
            4,
            AgentEvent::ToolStarted {
                tool_call_id: "t2".into(),
                tool_name: "bash".into(),
                input: serde_json::json!({"command": "cargo build"}),
            },
        ));
        acc.ingest(&envelope(
            5,
            AgentEvent::ToolCompleted {
                tool_call_id: "t2".into(),
                tool_name: "bash".into(),
                output: serde_json::json!("[main 8c1e2f3] fix"),
                is_error: false,
            },
        ));
        acc.ingest(&envelope(6, AgentEvent::TurnCompleted { index: 0 }));
        let batch = acc.take_batch();

        let types: Vec<&str> = batch.nodes.iter().map(|n| n.node_type).collect();
        assert!(types.contains(&"error"), "error node missing: {types:?}");
        assert!(types.contains(&"commit"), "commit node missing: {types:?}");
        let errors = batch.nodes.iter().filter(|n| n.node_type == "error").count();
        assert_eq!(errors, 1);
        // 同错误同节点：指纹数字抹平
        assert_eq!(
            error_fingerprint("error[E0308]: mismatched types at line 99"),
            error_fingerprint("error[E0308]: mismatched types at line 42")
        );
        let edge_types: Vec<&str> = batch.edges.iter().map(|e| e.edge_type).collect();
        assert!(edge_types.contains(&"failed_with"));
        assert!(edge_types.contains(&"resolved_by"), "edges: {edge_types:?}");
        assert!(edge_types.contains(&"produced"));
    }

    #[test]
    fn command_normalizes_idempotently() {
        assert_eq!(
            normalize_command("cargo   build\n  --release"),
            normalize_command("cargo build --release")
        );
        assert_ne!(
            normalize_command("cargo build"),
            normalize_command("cargo build --release")
        );
    }

    #[test]
    fn file_keys_relativize() {
        let a = file_key("/repo", "/repo/src/main.rs");
        let b = file_key("/repo", "src/main.rs");
        assert_eq!(a, b);
        let outside = file_key("/repo", "/etc/hosts");
        assert_ne!(a, outside);
    }

    #[test]
    fn commit_sha_parsing() {
        assert_eq!(
            extract_commit_sha("bash", "[main 8c1e2f3] fix login"),
            Some("8c1e2f3".into())
        );
        assert_eq!(extract_commit_sha("bash", "commit deadbeef1234567"), Some("deadbeef1234567".into()));
        assert_eq!(extract_commit_sha("read", "[main 8c1e2f3]"), None);
        assert_eq!(extract_commit_sha("bash", "nothing here"), None);
    }
}
