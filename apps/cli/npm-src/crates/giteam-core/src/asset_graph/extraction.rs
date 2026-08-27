//! 语义抽取管道：turn 入队后由 [`super::stage1`] 在 idle/startup 批处理，
//! 把实体/关系写进图谱（对齐 Codex memories Phase 1：deferred + no-op）。
//!
//! 流程（设计文档 §3 / M4，经 Codex 式改造）：
//! 1. `ExtractionInput` 在 turn flush 时从累积器收集：用户意图 + 助手结论
//!    + 工具动作摘要（edit 的文件 / bash 的命令 / 错误首行）——不喂原始
//!    工具输出，控制 token 成本。
//! 2. 热路径只 [`super::stage1::enqueue_job`]（真空 turn 不入队）；
//!    **是否值得沉淀由 Stage-1 抽取 agent 判定**（minimum-signal / no-op），
//!    不用寒暄正则替模型做主。Stage-1 worker 调 [`run_extraction_job`]：
//!    组装 prompt → ephemeral 无工具 completion。默认 Silent（不绑父 run UI）；
//!    空产出 = `NoOutput`。
//! 3. 完成后 `parse_extraction` 解析 summary JSON → `write_batch` 入图。
//!    任何失败不阻断主流程（§7 失败隔离）。
//!
//! 幂等：turn 节点 props 标 `semExtracted` + `extraction_jobs` durable claim。
//! 抽取质量：同一 EXTRACT_ROLE_RULES、父会话同模型；slug 稳定靠 known-entities 注入。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::semantic::{self, ExtractionAnchors};
use super::store;
use crate::pi_agent::{ExtractionCompletionFallback, ExtractionCompletionRequest, SubagentHost};

/// 抽取子代理会话的首行用户消息前缀：这类会话是管道内部产物，
/// 不进图谱（live 已拦，回放/查询层据此兜底）。
pub const EXTRACTION_USER_PROMPT_PREFIX: &str = "Extract semantic entities and relations";

/// 单次抽取的输入（turn 级摘要）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExtractionInput {
    pub session_id: String,
    pub run_id: String,
    pub turn_key: Option<String>,
    pub session_key: String,
    /// 本轮用户消息文本（意图）。
    pub user_text: String,
    /// 本轮助手结论文本。
    pub assistant_text: String,
    /// (相对路径, file 节点 key)：本轮读过/改过的文件。
    pub file_keys: Vec<(String, String)>,
    /// 本轮执行过的命令（归一化，去重）。
    pub commands: Vec<String>,
    /// 本轮错误首行。
    pub error_lines: Vec<String>,
    pub timestamp_ms: u64,
    pub sequence: u64,
    /// 仓库根（Stage-1 延迟跑时父 session 可能已销毁）。
    #[serde(default)]
    pub repo_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

impl ExtractionInput {
    /// 真空 turn（无文本、无文件、无命令）→ 不入队。
    /// 有内容一律入队；值不值得记交给 Stage-1 抽取 agent（Codex no-op 门控）。
    #[must_use]
    pub fn worth_extracting(&self) -> bool {
        !self.user_text.trim().is_empty()
            || !self.assistant_text.trim().is_empty()
            || !self.file_keys.is_empty()
            || !self.commands.is_empty()
    }

    /// 是否应进入 Stage-1 队列（= 非真空；价值判定不在此层）。
    #[must_use]
    pub fn should_enqueue(&self) -> bool {
        self.worth_extracting()
    }

    /// 组装抽取 prompt（附实体边界由系统提示承载，此处只给数据）。
    #[must_use]
    pub fn build_prompt(&self, known_entities: &[String]) -> String {
        let mut lines = vec![
            format!("{EXTRACTION_USER_PROMPT_PREFIX} from this coding-agent turn. Reply with the JSON object only."),
            String::new(),
            "## Quality grade (LLM judgment — not keyword lists)".to_string(),
            "Set top-level \"quality\": \"high\" | \"medium\" | \"low\" and optional \"priority\": \
             \"high\" | \"normal\" | \"low\"."
                .to_string(),
            "- low: no durable repo knowledge (pure social chatter, empty ack). Return empty \
             entities/relations, quality=low — but ALWAYS still emit session_intent as a short graph-node title for this turn."
                .to_string(),
            "- medium: some durable facts/decisions worth storing; write entities; do not treat as \
             urgent."
                .to_string(),
            "- high (or priority=high): important decisions/preferences/repo facts a future agent \
             should see prominently."
                .to_string(),
            "If the same social theme is worth a durable concept (e.g. recurring greeting pattern), \
             you MAY emit a tech_concept/open_task with a clear title — still set quality honestly."
                .to_string(),
            String::new(),
            "## Minimum-signal gate (Codex-style)".to_string(),
            "Ask: will a future agent plausibly act better because of what you extract?".to_string(),
            "If NO — return {\"entities\":[],\"relations\":[],\"quality\":\"low\"} and \
             STILL emit session_intent (title only). Reply length is never evidence of extractable content."
                .to_string(),
            String::new(),
            "## User intent".to_string(),
            snippet(&self.user_text, 1200),
        ];
        if !self.assistant_text.trim().is_empty() {
            lines.push("\n## Assistant conclusion".to_string());
            lines.push(snippet(&self.assistant_text, 1500));
        }
        if !self.file_keys.is_empty() {
            lines.push("\n## Files touched (repo-relative paths usable as relation endpoints)".to_string());
            let paths: Vec<String> =
                self.file_keys.iter().map(|(p, _)| p.clone()).take(15).collect();
            lines.push(paths.join("\n"));
        }
        if !self.commands.is_empty() {
            lines.push("\n## Commands executed".to_string());
            let cmds: Vec<String> = self.commands.iter().take(12).cloned().collect();
            lines.push(cmds.join("\n"));
        }
        if !self.error_lines.is_empty() {
            lines.push("\n## Errors encountered (first lines)".to_string());
            let errs: Vec<String> = self.error_lines.iter().take(6).cloned().collect();
            lines.push(errs.join("\n"));
        }
        if !known_entities.is_empty() {
            lines.push(
                "\n## Existing entities (REUSE these ids when the same concept appears; do not invent parallel slugs)"
                    .to_string(),
            );
            lines.push(known_entities.iter().take(40).cloned().collect::<Vec<_>>().join("\n"));
        }
        lines.push(
            "\nRemember: entity types decision/feature/module/tech_concept/error_pattern/api/tradeoff/open_task; \
             relation subjects/objects may be entity slugs, the file paths above, or \"session\". \
             Emit entity↔entity relations when concepts are related (do not invent). \
             When you emit 2+ entities, include at least one typed relation linking them \
             (do not leave co-mentioned concepts as orphans). \
             Every entity needs a human-readable title (never the slug) and every entity/relation \
             must carry \"confidence\" (0.0-1.0) and \"evidence\" \
             (a verbatim quote copied exactly from the text above, <= 100 chars — required; \
             fabricated evidence is discarded; omit the entity rather than inventing evidence). \
             Prefer dense, typed relations \
             (decided/rationale/implements/located_in/affects/pattern_of/involves/supersedes/closes). \
             Prefer reusing ## Existing entities (and near-duplicate titles like \"X\" vs \"X (useTimer)\") \
             over inventing parallel slugs — same concept, one node. \
             Schema mechanisms (not examples): \
             decision MUST include chose/rejected/because fields — otherwise it is a feature. \
             error_pattern MUST be anchored to code (path or compile/test failure evidence) and \
             prefer pattern_of → file|module|feature; unanchored environment noise is dropped. \
             open_task: ONLY for incomplete work / known issues still open. At most one per turn. \
             Do NOT emit an open_task that merely restates a decision/feature/tradeoff already in \
             this turn — session_intent is a label, not an automatic open_task entity. \
             REUSE Existing-entities when content overlaps; never invent parallel slugs for the same goal. \
             Lifecycle (Graphiti-style): conclusion flip / replacement → supersedes(new, old); \
             open_task done/fixed → closes(closer, open_task). Reuse Existing ids; never silent overwrite. \
             Relation schema: subjects/objects must match typed endpoints \
             (open_task —involves→ module|feature; module/feature —located_in→ file; \
             feature —implements→ file; error_pattern —pattern_of→ file|module|feature; \
             closes → open_task; supersedes between decision|feature|open_task|tech_concept|tradeoff). \
             Density: prefer 3–8 entities per turn; omit facts already implied by a kept module. \
             Always include top-level \"quality\". ALWAYS output a top-level \"session_intent\": \
             one concise line (<= 40 chars, same language as the user) naming this turn for the \
             memory graph — even when quality=low and entities are empty. Distill what the user \
             wants; resolve shorthand like \"继续\" / \"好的\" from context into a concrete title; \
             never copy opaque ids; never use placeholders like \"会话\" / \"session\"."
                .to_string(),
        );
        lines.join("\n")
    }

    /// 构建语义锚点。
    #[must_use]
    pub fn anchors(&self) -> ExtractionAnchors {
        ExtractionAnchors {
            session_key: self.session_key.clone(),
            turn_key: self.turn_key.clone(),
            file_keys: self.file_keys.clone(),
            timestamp_ms: self.timestamp_ms,
            session_id: self.session_id.clone(),
            run_id: self.run_id.clone(),
            sequence: self.sequence,
            event_id: format!("extract-{}-{}", self.session_id, self.sequence),
            source_text: format!(
                "{}\n{}",
                snippet(&self.user_text, 1200),
                snippet(&self.assistant_text, 1500)
            ),
        }
    }
}

/// UI 事件发布策略。Stage-1 默认 Silent（不绑父 run，聊天流不闪「记录中」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtractionPublishMode {
    /// 不发 `memory.extraction.*`。
    Silent,
    /// 发完整 started/completed/failed（仅遗留/调试路径）。
    Full,
    /// 仅在有实体/关系/intent 写入时发 completed（无 started 闪烁）。
    OnWrite,
}

/// 单次 Stage-1 job 结果。
#[derive(Debug, Clone)]
pub enum ExtractionJobOutcome {
    Wrote {
        entity_count: usize,
        relation_count: usize,
        intent: Option<String>,
    },
    /// 有效跑完但无沉淀（Codex `succeeded_no_output`）。
    NoOutput,
    Failed(String),
}

fn triggered_turns() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static TURNS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    TURNS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// 登记该 turn 的抽取：首次登记（应触发）返回 true；已登记过返回 false。
#[must_use]
pub fn claim_turn_extraction(turn_key: &str) -> bool {
    let Ok(mut set) = triggered_turns().lock() else {
        return true;
    };
    if set.len() > 512 {
        let drop: Vec<String> = set.iter().take(256).cloned().collect();
        for key in drop {
            set.remove(&key);
        }
    }
    set.insert(turn_key.to_string())
}

fn extract_sessions() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SESSIONS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    SESSIONS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// 注册一个 extract 子代理的 session id。
pub fn register_extract_session(session_id: &str) {
    if let Ok(mut set) = extract_sessions().lock() {
        set.insert(session_id.to_string());
        if set.len() > 64 {
            let oldest: Vec<String> = set.iter().take(set.len() - 64).cloned().collect();
            for id in oldest {
                set.remove(&id);
            }
        }
    }
}

/// 该 session 是否为 extract 子代理。
#[must_use]
pub fn is_extract_session(session_id: &str) -> bool {
    extract_sessions()
        .lock()
        .map(|set| set.contains(session_id))
        .unwrap_or(false)
}

/// 异步旁路抽取（遗留兼容：Full UI）。生产路径请走 [`super::stage1`]。
pub fn spawn_extraction(
    host: std::sync::Arc<dyn SubagentHost>,
    input: ExtractionInput,
    db_path: std::path::PathBuf,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let repo_path = if input.repo_path.trim().is_empty() {
            std::path::PathBuf::from(".")
        } else {
            std::path::PathBuf::from(&input.repo_path)
        };
        let _ = run_extraction_job(host, input, db_path, repo_path, ExtractionPublishMode::Full).await;
    })
}

fn default_extraction_provider() -> Option<String> {
    std::env::var("GITEAM_EXTRACT_PROVIDER")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("GITEAM_RP_PROVIDER").ok().filter(|s| !s.trim().is_empty()))
}

fn default_extraction_model() -> Option<String> {
    std::env::var("GITEAM_EXTRACT_MODEL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("GITEAM_RP_MODEL").ok().filter(|s| !s.trim().is_empty()))
}

/// 执行一次抽取 job（Stage-1 worker 调用）。
pub async fn run_extraction_job(
    host: std::sync::Arc<dyn SubagentHost>,
    input: ExtractionInput,
    db_path: std::path::PathBuf,
    repo_path: std::path::PathBuf,
    publish: ExtractionPublishMode,
) -> ExtractionJobOutcome {
    let extraction_id = format!("asset-graph-extract-{}", input.sequence);
    let publisher = match publish {
        ExtractionPublishMode::Silent => None,
        ExtractionPublishMode::Full | ExtractionPublishMode::OnWrite => {
            host.memory_extraction_publisher(&input.session_id, &extraction_id)
        }
    };
    if publish == ExtractionPublishMode::Full {
        if let Some(pubber) = &publisher {
            pubber.started();
        }
    }
    let started = std::time::Instant::now();
    let known_catalog = load_entity_catalog(&db_path);
    let known = format_known_entities(&known_catalog);
    let fallback_repo = if input.repo_path.trim().is_empty() {
        repo_path.to_string_lossy().into_owned()
    } else {
        input.repo_path.clone()
    };
    let fallback_provider = input.provider.clone().or_else(default_extraction_provider);
    let fallback_model = input.model.clone().or_else(default_extraction_model);
    let request = ExtractionCompletionRequest {
        parent_session_id: input.session_id.clone(),
        extraction_id: extraction_id.clone(),
        prompt: input.build_prompt(&known),
        fallback: Some(ExtractionCompletionFallback {
            repo_path: fallback_repo,
            provider: fallback_provider,
            model: fallback_model,
            thinking: input.thinking.clone(),
        }),
    };
    let result = match host.run_extraction_completion(request).await {
        Ok(result) => result,
        Err(error) => {
            eprintln!(
                "[asset-graph] extraction completion failed (session {}): {error}",
                input.session_id
            );
            if publish != ExtractionPublishMode::Silent {
                if let Some(pubber) = &publisher {
                    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
                    pubber.failed(error.to_string(), elapsed_ms);
                }
            }
            return ExtractionJobOutcome::Failed(error.to_string());
        }
    };
    let anchors = input.anchors();
    let extraction = semantic::parse_extraction(&result.summary, &anchors, &known_catalog);
    let db = match store::open(&db_path) {
        Ok(db) => db,
        Err(error) => {
            eprintln!("[asset-graph] extraction db open failed: {error}");
            if publish != ExtractionPublishMode::Silent {
                if let Some(pubber) = &publisher {
                    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
                    pubber.failed(format!("db open failed: {error}"), elapsed_ms);
                }
            }
            return ExtractionJobOutcome::Failed(format!("db open failed: {error}"));
        }
    };
    // 无论是否落实体，都把 LLM 质量档写回 session（compact 过滤 / 摘要用）。
    let _ = db.execute(
        "UPDATE nodes SET props = json_set(
             json_set(COALESCE(props, '{}'), '$.quality', ?1),
             '$.priority', ?2)
         WHERE key = ?3 AND type = 'session'",
        rusqlite::params![
            extraction.quality.as_str(),
            extraction.priority.as_str(),
            anchors.session_key
        ],
    );
    if extraction.should_write_semantics() && !extraction.batch.is_empty() {
        if let Err(error) = store::write_batch(&db, &extraction.batch) {
            eprintln!("[asset-graph] extraction write failed: {error}");
            if publish != ExtractionPublishMode::Silent {
                if let Some(pubber) = &publisher {
                    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
                    pubber.failed(format!("write failed: {error}"), elapsed_ms);
                }
            }
            return ExtractionJobOutcome::Failed(format!("write failed: {error}"));
        }
    }
    mark_turn_extracted(&db, input.turn_key.as_deref());
    let mut titled = false;
    if let Some(intent) = extraction.intent.as_deref().filter(|s| !s.trim().is_empty()) {
        // 强 intent 覆盖；弱 intent（如「继续」）不覆盖已有好标题。
        titled = try_apply_session_intent(
            &db,
            &anchors.session_key,
            input.turn_key.as_deref(),
            intent,
        );
    }
    // LLM 省略 session_intent 时：用用户原文确定性回填，避免落成「未命名会话」。
    if !titled {
        if let Some(fallback) = fallback_session_title(&input.user_text) {
            if session_title_is_weak(&db, &anchors.session_key) {
                apply_intent_labels(&db, &anchors.session_key, input.turn_key.as_deref(), &fallback);
            }
        }
    }
    let elapsed_ms = started
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
        .max(result.elapsed_ms);
    let wrote = extraction.should_write_semantics()
        && (extraction.entity_count > 0
            || extraction.relation_count > 0
            || extraction.intent.as_ref().is_some_and(|s| !s.trim().is_empty()));
    // 仅高质量或高优先才发记忆完成卡（低质量不渲染事件）。
    let emit_event = wrote && extraction.should_emit_memory_event();
    if wrote {
        if emit_event
            && matches!(
                publish,
                ExtractionPublishMode::Full | ExtractionPublishMode::OnWrite
            )
        {
            if let Some(pubber) = &publisher {
                let entities = extraction
                    .entity_summaries
                    .iter()
                    .map(|(etype, title)| crate::pi_agent::MemoryExtractionEntity {
                        entity_type: etype.clone(),
                        title: title.clone(),
                    })
                    .collect();
                pubber.completed(
                    extraction.entity_count as u32,
                    extraction.relation_count as u32,
                    extraction.intent.clone(),
                    entities,
                    Some(extraction.quality.as_str().to_string()),
                    Some(extraction.priority.as_str().to_string()),
                    elapsed_ms,
                );
            }
        }
        eprintln!(
            "[asset-graph] semantic extraction: +{} entities, +{} relations quality={} (session {})",
            extraction.entity_count,
            extraction.relation_count,
            extraction.quality.as_str(),
            input.session_id
        );
        ExtractionJobOutcome::Wrote {
            entity_count: extraction.entity_count,
            relation_count: extraction.relation_count,
            intent: extraction.intent,
        }
    } else {
        if publish == ExtractionPublishMode::Full {
            if let Some(pubber) = &publisher {
                pubber.completed(0, 0, None, Vec::new(), None, None, elapsed_ms);
            }
        }
        eprintln!(
            "[asset-graph] semantic extraction: no-op quality={} (session {})",
            extraction.quality.as_str(),
            input.session_id
        );
        ExtractionJobOutcome::NoOutput
    }
}

/// 加载语义实体目录（供 resolve + prompt）。
/// 默认排除已废止实体（superseded_by / closed_by / status 终态），对齐
/// Graphiti「当前有效事实」视图；历史仍在图中可经边追溯。
pub fn load_entity_catalog(db_path: &std::path::Path) -> Vec<crate::asset_graph::entity::CatalogEntity> {
    use crate::asset_graph::entity::{catalog_from_node, is_retired_status, CatalogEntity};

    let Ok(db) = store::open(db_path) else {
        return Vec::new();
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT type, key, label, props FROM nodes
         WHERE key LIKE 'sem:%'
           AND id NOT IN (
             SELECT DISTINCT src_id FROM edges
             WHERE type IN ('sem/superseded_by', 'sem/closed_by')
           )
         ORDER BY last_seen_ms DESC
         LIMIT 120",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        let etype: String = row.get(0)?;
        let key: String = row.get(1)?;
        let label: String = row.get(2)?;
        let props_text: String = row.get(3)?;
        Ok((etype, key, label, props_text))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };
    let mut out: Vec<CatalogEntity> = Vec::new();
    for row in rows.flatten() {
        let (etype, key, label, props_text) = row;
        let props: serde_json::Value =
            serde_json::from_str(&props_text).unwrap_or_else(|_| serde_json::json!({}));
        if is_retired_status(&props) {
            continue;
        }
        out.push(catalog_from_node(&etype, &key, &label, &props));
        if out.len() >= 80 {
            break;
        }
    }
    out
}

/// prompt 用：`type\tslug\ttitle`（行为兼容旧 known_entities）。
#[must_use]
pub fn format_known_entities(catalog: &[crate::asset_graph::entity::CatalogEntity]) -> Vec<String> {
    catalog
        .iter()
        .take(40)
        .map(|e| {
            let slug = e
                .key
                .strip_prefix("sem:")
                .and_then(|rest| rest.split_once(':'))
                .map(|(_, slug)| slug)
                .unwrap_or(e.key.as_str());
            let title = if e.label.trim().is_empty() {
                slug
            } else {
                e.label.as_str()
            };
            format!("{}\t{slug}\t{title}", e.entity_type)
        })
        .collect()
}

/// 占位/弱标题：需要被 session_intent 或用户原文覆盖。
fn is_weak_session_title(label: &str) -> bool {
    let t = label.trim();
    if t.is_empty() || t.chars().count() < 2 {
        return true;
    }
    if t == "会话" || t.eq_ignore_ascii_case("session") || t == "未命名会话" {
        return true;
    }
    // 口头承接/寒暄：留给 LLM session_intent 提炼，不当作最终标题锁死。
    const WEAK: &[&str] = &[
        "继续", "好的", "好", "嗯", "嗯嗯", "谢谢", "你好", "在吗",
        "ok", "okay", "yes", "y", "hi", "hello", "thanks", "thx",
    ];
    let lower = t.to_lowercase();
    WEAK.iter().any(|w| lower == *w || t == *w)
}

fn fallback_session_title(user_text: &str) -> Option<String> {
    let line = user_text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())?;
    let title = snippet(line, 40);
    if is_weak_session_title(&title) {
        return None;
    }
    Some(title)
}

fn session_title_is_weak(db: &rusqlite::Connection, session_key: &str) -> bool {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT label, props FROM nodes WHERE key = ?1 AND type = 'session' LIMIT 1",
            [session_key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((label, props)) = row else {
        return true;
    };
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&props) {
        if let Some(intent) = v.get("intent").and_then(|x| x.as_str()) {
            if !is_weak_session_title(intent) {
                return false;
            }
        }
    }
    is_weak_session_title(&label)
}

/// 写回会话标题，并决定是否跳过用户原文兜底。
///
/// - 强 `session_intent`：始终写回，返回 true
/// - 弱 intent（「继续」「好的」等）：仅当当前标题也弱时写回；若已有好标题则保留并返回 true（跳过兜底）
/// - 空 intent：返回 false，允许走用户原文兜底
fn try_apply_session_intent(
    db: &rusqlite::Connection,
    session_key: &str,
    turn_key: Option<&str>,
    intent: &str,
) -> bool {
    let intent = intent.trim();
    if intent.is_empty() {
        return false;
    }
    if is_weak_session_title(intent) && !session_title_is_weak(db, session_key) {
        // 例如本轮 LLM 把「继续」当成 session_intent，不能盖掉「修复登录超时」。
        return true;
    }
    apply_intent_labels(db, session_key, turn_key, intent);
    true
}

/// 将 LLM 提炼的 session_intent 写回 session/turn 的 label 与 props.intent。
pub fn apply_intent_labels(
    db: &rusqlite::Connection,
    session_key: &str,
    turn_key: Option<&str>,
    intent: &str,
) {
    let label = snippet(intent, 80);
    let _ = db.execute(
        "UPDATE nodes SET label = ?1, props = json_set(COALESCE(props, '{}'), '$.intent', ?2)
         WHERE key = ?3 AND type = 'session'",
        rusqlite::params![label, intent, session_key],
    );
    if let Some(key) = turn_key {
        let _ = db.execute(
            "UPDATE nodes SET label = ?1, props = json_set(COALESCE(props, '{}'), '$.intent', ?2)
             WHERE key = ?3 AND type = 'turn'",
            rusqlite::params![label, intent, key],
        );
    }
}

/// turn 节点打 `semExtracted` 标记（幂等）。
pub fn mark_turn_extracted(db: &rusqlite::Connection, turn_key: Option<&str>) {
    let Some(key) = turn_key else { return };
    let _ = db.execute(
        "UPDATE nodes SET props = json_set(props, '$.semExtracted', json('true'))
         WHERE key = ?1 AND type = 'turn'",
        [key],
    );
}

/// turn 是否已抽过。
#[must_use]
pub fn turn_already_extracted(db: &rusqlite::Connection, turn_key: &str) -> bool {
    db.query_row(
        "SELECT json_extract(props, '$.semExtracted') FROM nodes
         WHERE key = ?1 AND type = 'turn'",
        [turn_key],
        |row| row.get::<_, Option<bool>>(0),
    )
    .ok()
    .flatten()
    .unwrap_or(false)
}

fn snippet(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

/// 从 Value 工具入参提取文件相对路径。
#[must_use]
pub fn file_paths_from_input(tool_name: &str, input: &Value) -> Vec<String> {
    if !matches!(tool_name, "edit" | "write" | "read" | "multiedit" | "create" | "ls") {
        return Vec::new();
    }
    for field in ["file_path", "path", "notebook_path"] {
        if let Some(path) = input.get(field).and_then(Value::as_str) {
            if !path.trim().is_empty() {
                return vec![path.to_string()];
            }
            break;
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ExtractionInput {
        ExtractionInput {
            session_id: "sess-1".into(),
            run_id: "run-1".into(),
            turn_key: Some("turn:k".into()),
            session_key: "session:k".into(),
            user_text: "用 SQLite 存资产图谱，别上 Neo4j，我们要零运维".into(),
            assistant_text: "已决定采用 rusqlite + 属性图 schema。".into(),
            file_keys: vec![("src/store.rs".into(), "file:aaa".into())],
            commands: vec!["cargo test".into()],
            error_lines: vec![],
            timestamp_ms: 1,
            sequence: 5,
            repo_path: "/repo".into(),
            provider: None,
            model: None,
            thinking: None,
        }
    }

    #[test]
    fn hello_still_enqueued_for_agent_gate() {
        // 寒暄也入队：值不值得记由 Stage-1 抽取 agent no-op，不用正则替模型判定。
        let mut hi = input();
        hi.user_text = "你好".into();
        hi.assistant_text = "你好！有什么可以帮你的？".into();
        hi.file_keys.clear();
        hi.commands.clear();
        assert!(hi.worth_extracting());
        assert!(hi.should_enqueue());
    }

    #[test]
    fn steer_with_files_still_enqueued() {
        let mut steer = input();
        steer.user_text = "继续".into();
        assert!(steer.should_enqueue());
    }

    #[test]
    fn thanks_still_enqueued_for_agent_gate() {
        let mut thanks = input();
        thanks.user_text = "谢谢，今天辛苦啦，回复得真快".into();
        thanks.assistant_text = "不客气".into();
        thanks.file_keys.clear();
        thanks.commands.clear();
        assert!(thanks.should_enqueue());
    }

    #[test]
    fn vacuum_not_worth() {
        let mut empty = input();
        empty.user_text.clear();
        empty.assistant_text.clear();
        empty.file_keys.clear();
        empty.commands.clear();
        assert!(!empty.worth_extracting());
        assert!(!empty.should_enqueue());
    }

    #[test]
    fn prompt_carries_gate_and_data() {
        let prompt = input().build_prompt(&[]);
        assert!(prompt.contains("Minimum-signal"));
        assert!(prompt.contains("SQLite"));
        assert!(prompt.contains("src/store.rs"));
        assert!(prompt.contains("cargo test"));
    }

    #[test]
    fn extracted_marker_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        store::write_batch(
            &db,
            &store::FactBatch {
                nodes: vec![store::NodeFact {
                    node_type: "turn",
                    key: "turn:k".into(),
                    label: "turn 1".into(),
                    props: serde_json::json!({}),
                    timestamp_ms: 1,
                }],
                edges: vec![],
            },
        )
        .unwrap();
        assert!(!turn_already_extracted(&db, "turn:k"));
        mark_turn_extracted(&db, Some("turn:k"));
        assert!(turn_already_extracted(&db, "turn:k"));
        assert!(!turn_already_extracted(&db, "turn:missing"));
    }

    #[test]
    fn weak_session_intent_does_not_overwrite_strong_title() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        store::write_batch(
            &db,
            &store::FactBatch {
                nodes: vec![store::NodeFact {
                    node_type: "session",
                    key: "session:k".into(),
                    label: "修复登录超时".into(),
                    props: serde_json::json!({
                        "sessionId": "s1",
                        "intent": "修复登录超时"
                    }),
                    timestamp_ms: 1,
                }],
                edges: vec![],
            },
        )
        .unwrap();

        assert!(try_apply_session_intent(
            &db,
            "session:k",
            None,
            "继续",
        ));
        let (label, props): (String, String) = db
            .query_row(
                "SELECT label, props FROM nodes WHERE key = 'session:k' AND type = 'session'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(label, "修复登录超时");
        let intent = serde_json::from_str::<serde_json::Value>(&props)
            .unwrap()
            .get("intent")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();
        assert_eq!(intent, "修复登录超时");
    }

    #[test]
    fn strong_session_intent_overwrites_weak_title() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        store::write_batch(
            &db,
            &store::FactBatch {
                nodes: vec![store::NodeFact {
                    node_type: "session",
                    key: "session:k".into(),
                    label: "你好".into(),
                    props: serde_json::json!({
                        "sessionId": "s1",
                        "intent": "你好"
                    }),
                    timestamp_ms: 1,
                }],
                edges: vec![],
            },
        )
        .unwrap();

        assert!(try_apply_session_intent(
            &db,
            "session:k",
            None,
            "修复登录超时",
        ));
        let label: String = db
            .query_row(
                "SELECT label FROM nodes WHERE key = 'session:k' AND type = 'session'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(label, "修复登录超时");
    }
}
