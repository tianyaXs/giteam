//! 批量 live 抽取：清语义库 → 按序跑**框架无关** case → 写 outputs → 看实体效果。
//!
//! Case 刻意不绑定番茄钟/某一业务仓库，只验证机制：
//! 寒暄空抽、决策沉淀、supersedes、open_task、closes、默认行为翻转。
//!
//! ```text
//! cargo run -p giteam-core --example extraction_batch_live -- \
//!   --repo /Users/tianya/Documents/project/test \
//!   --reset \
//!   --provider kimi-coding --model k3
//! ```

use std::path::{Path, PathBuf};
use std::time::Duration;

use giteam_core::asset_graph::extraction::{self, ExtractionInput};
use giteam_core::asset_graph::semantic::{self, SemanticExtraction};
use giteam_core::asset_graph::store;
use giteam_core::pi_agent::{
    ExtractionCompletionFallback, ExtractionCompletionRequest, PiAgentService,
};
use serde::Deserialize;

#[tokio::main]
async fn main() {
    let args = parse_args();
    let service = PiAgentService::global();
    let host = service.asset_graph_subagent_host().unwrap_or_else(|| {
        eprintln!("no asset_graph subagent host (provider catalog?)");
        std::process::exit(1);
    });

    let db_path = giteam_core::pi_agent::memory_db_path_for_repo(&args.repo).unwrap_or_else(|| {
        eprintln!("cannot resolve memory db for {}", args.repo.display());
        std::process::exit(1);
    });
    println!("[ok] db {}", db_path.display());

    if args.reset {
        reset_semantics(&db_path);
        println!("[ok] reset sem:* + extraction_jobs");
    }

    let cases_dir = args
        .cases_dir
        .clone()
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("eval/extraction"));
    let out_dir = cases_dir.join("outputs");
    let _ = std::fs::create_dir_all(&out_dir);

    let case_names = if args.cases.is_empty() {
        default_cases()
    } else {
        args.cases.clone()
    };

    println!(
        "[ok] provider={} model={} cases={}",
        args.provider,
        args.model,
        case_names.len()
    );

    let mut report: Vec<CaseReport> = Vec::new();
    for (idx, name) in case_names.iter().enumerate() {
        let path = cases_dir.join(format!("{name}.json"));
        if !path.exists() {
            eprintln!("[skip] missing {}", path.display());
            continue;
        }
        let case = match load_case(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[skip] {}: {e}", path.display());
                continue;
            }
        };
        println!(
            "\n======== [{}/{}] {} ========",
            idx + 1,
            case_names.len(),
            case.name
        );
        if !case.note.is_empty() {
            println!("note: {}", case.note);
        }

        let catalog = extraction::load_entity_catalog(&db_path);
        let known = extraction::format_known_entities(&catalog);
        println!("known_entities={}", known.len());

        let input = to_input(&case, &args, idx as u64);
        let prompt = input.build_prompt(&known);
        let request = ExtractionCompletionRequest {
            parent_session_id: format!("batch-live-{}", std::process::id()),
            extraction_id: format!("batch-{}-{idx}", case.name),
            prompt,
            fallback: Some(ExtractionCompletionFallback {
                repo_path: args.repo.to_string_lossy().into_owned(),
                provider: Some(args.provider.clone()),
                model: Some(args.model.clone()),
                thinking: Some("off".into()),
            }),
        };

        let started = std::time::Instant::now();
        let result = match host.run_extraction_completion(request).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[fail] completion: {e}");
                report.push(CaseReport {
                    name: case.name.clone(),
                    ok: false,
                    entities: 0,
                    relations: 0,
                    note: format!("completion error: {e}"),
                    titles: Vec::new(),
                    edge_types: Vec::new(),
                });
                continue;
            }
        };
        println!(
            "[ok] completion {}ms summary_chars={}",
            started.elapsed().as_millis(),
            result.summary.len()
        );

        let out_path = out_dir.join(format!("{}.txt", case.name));
        let _ = std::fs::write(&out_path, &result.summary);
        println!("[ok] wrote {}", out_path.display());

        let anchors = input.anchors();
        let parsed = semantic::parse_extraction(&result.summary, &anchors, &catalog);
        println!(
            "parsed entities={} relations={} quality={:?} intent={:?}",
            parsed.entity_count, parsed.relation_count, parsed.quality, parsed.intent
        );
        for (t, title) in &parsed.entity_summaries {
            println!("  entity  {t}: {title}");
        }
        let mut edge_types = Vec::new();
        for edge in &parsed.batch.edges {
            if edge.edge_type.starts_with("sem/") {
                println!(
                    "  edge    {}  {} → {}",
                    edge.edge_type, edge.src_key, edge.dst_key
                );
                edge_types.push(edge.edge_type.to_string());
            }
        }

        if !parsed.batch.is_empty() {
            match store::open(&db_path) {
                Ok(db) => {
                    if let Err(e) = store::write_batch(&db, &parsed.batch) {
                        eprintln!("[warn] write_batch: {e}");
                    } else {
                        println!("[ok] wrote batch to db");
                    }
                }
                Err(e) => eprintln!("[warn] open db: {e}"),
            }
        }

        let titles: Vec<String> = parsed
            .entity_summaries
            .iter()
            .map(|(t, title)| format!("{t}:{title}"))
            .collect();
        let ok = evaluate(&case, &parsed, &edge_types);
        report.push(CaseReport {
            name: case.name.clone(),
            ok,
            entities: parsed.entity_count,
            relations: parsed.relation_count,
            note: if ok {
                "pass".into()
            } else {
                "weak/miss".into()
            },
            titles,
            edge_types,
        });

        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    println!("\n======== SUMMARY ========");
    for r in &report {
        println!(
            "[{}] {}  entities={} relations={}  {}",
            if r.ok { "PASS" } else { "WEAK" },
            r.name,
            r.entities,
            r.relations,
            r.note
        );
        for t in &r.titles {
            println!("         · {t}");
        }
        for e in &r.edge_types {
            println!("         → {e}");
        }
    }
    print_db_sem_summary(&db_path);

    let weak = report.iter().filter(|r| !r.ok).count();
    println!(
        "\n[done] {}/{} weak — inspect eval/extraction/outputs/",
        weak,
        report.len()
    );
}

/// 默认序列：寒暄 → 决策种子 → 取代 → 任务种子 → 关闭 → 事实翻转 → 若干类型 case。
fn default_cases() -> Vec<String> {
    vec![
        // 门控
        "chitchat-probe".into(),
        // 生命周期：seed → supersedes / closes
        "lifecycle-seed-store".into(),
        "lifecycle-supersedes".into(),
        "lifecycle-seed-task".into(),
        "lifecycle-closes".into(),
        "lifecycle-fact-flip".into(),
        // 类型覆盖（框架无关）
        "decision-basic".into(),
        "tradeoff".into(),
        "open-task".into(),
        "error-pattern".into(),
        "feature-implements".into(),
        "module-located".into(),
        "api-exposes".into(),
        "tech-concept-i18n".into(),
    ]
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    #[serde(default)]
    note: String,
    input: CaseInput,
    #[serde(default)]
    expect: Expect,
}

#[derive(Debug, Deserialize)]
struct CaseInput {
    #[serde(default)]
    user_text: String,
    #[serde(default)]
    assistant_text: String,
    #[serde(default)]
    file_paths: Vec<String>,
    #[serde(default)]
    commands: Vec<String>,
    #[serde(default)]
    error_lines: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Expect {
    #[serde(default)]
    entities: Vec<ExpectEntity>,
    #[serde(default)]
    relations: Vec<ExpectRelation>,
    min_entities: Option<usize>,
    max_entities: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct ExpectEntity {
    #[serde(rename = "type")]
    entity_type: Option<String>,
    #[serde(default, rename = "type_any")]
    type_any: Vec<String>,
    #[serde(default)]
    slug_contains: String,
    #[serde(default)]
    props_required: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ExpectRelation {
    #[serde(rename = "type")]
    relation_type: String,
    #[serde(default)]
    subject_contains: String,
    #[serde(default)]
    object_contains: String,
}

struct CaseReport {
    name: String,
    ok: bool,
    entities: usize,
    relations: usize,
    note: String,
    titles: Vec<String>,
    edge_types: Vec<String>,
}

struct Args {
    provider: String,
    model: String,
    repo: PathBuf,
    cases_dir: Option<PathBuf>,
    cases: Vec<String>,
    reset: bool,
}

fn parse_args() -> Args {
    let mut provider =
        std::env::var("GITEAM_RP_PROVIDER").unwrap_or_else(|_| "kimi-coding".into());
    let mut model = std::env::var("GITEAM_RP_MODEL").unwrap_or_else(|_| "k3".into());
    let mut repo = PathBuf::from("/Users/tianya/Documents/project/test");
    let mut cases_dir = None;
    let mut cases = Vec::new();
    let mut reset = false;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--provider" => provider = args.next().expect("--provider"),
            "--model" => model = args.next().expect("--model"),
            "--repo" => repo = PathBuf::from(args.next().expect("--repo")),
            "--cases-dir" => {
                cases_dir = Some(PathBuf::from(args.next().expect("--cases-dir")))
            }
            "--case" => cases.push(args.next().expect("--case")),
            "--reset" => reset = true,
            other => {
                eprintln!("unknown arg: {other}");
                std::process::exit(2);
            }
        }
    }
    Args {
        provider,
        model,
        repo,
        cases_dir,
        cases,
        reset,
    }
}

fn load_case(path: &Path) -> Result<Case, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        if !obj.contains_key("name") {
            if let Some(n) = obj.remove("title") {
                obj.insert("name".into(), n);
            }
        }
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn to_input(case: &Case, args: &Args, seq: u64) -> ExtractionInput {
    ExtractionInput {
        session_id: format!("batch-{}", std::process::id()),
        run_id: format!("run-{}", case.name),
        turn_key: Some(format!("turn:batch/{}/{}", case.name, seq)),
        session_key: format!("session:batch-{}", case.name),
        user_text: case.input.user_text.clone(),
        assistant_text: case.input.assistant_text.clone(),
        file_keys: case
            .input
            .file_paths
            .iter()
            .map(|p| (p.clone(), format!("file:{p}")))
            .collect(),
        commands: case.input.commands.clone(),
        error_lines: case.input.error_lines.clone(),
        timestamp_ms: now_ms(),
        sequence: 1000 + seq,
        repo_path: args.repo.to_string_lossy().into_owned(),
        provider: Some(args.provider.clone()),
        model: Some(args.model.clone()),
        thinking: Some("off".into()),
    }
}

fn evaluate(case: &Case, parsed: &SemanticExtraction, edge_types: &[String]) -> bool {
    let n = parsed.entity_count;
    if let Some(min) = case.expect.min_entities {
        if n < min {
            return false;
        }
    }
    if let Some(max) = case.expect.max_entities {
        if n > max {
            return false;
        }
    }
    if case.expect.max_entities == Some(0) {
        return n == 0;
    }
    for want in &case.expect.entities {
        let type_ok = |t: &str| {
            if let Some(ref single) = want.entity_type {
                t == single
            } else if !want.type_any.is_empty() {
                want.type_any.iter().any(|x| x == t)
            } else {
                true
            }
        };
        let needle = want.slug_contains.to_ascii_lowercase();
        let hit = parsed.entity_summaries.iter().any(|(t, title)| {
            if !type_ok(t) {
                return false;
            }
            if needle.is_empty() {
                return true;
            }
            t.to_ascii_lowercase().contains(&needle)
                || title.to_ascii_lowercase().contains(&needle)
                || parsed.batch.nodes.iter().any(|node| {
                    node.node_type == *t
                        && (node.key.to_ascii_lowercase().contains(&needle)
                            || node.label.to_ascii_lowercase().contains(&needle))
                })
        });
        if !hit {
            return false;
        }
        let _ = &want.props_required;
    }
    for rel in &case.expect.relations {
        let edge_name = match rel.relation_type.as_str() {
            "supersedes" => "sem/superseded_by",
            "closes" => "sem/closed_by",
            other => {
                if edge_types.iter().any(|e| e.contains(other)) {
                    continue;
                }
                return false;
            }
        };
        let found = parsed.batch.edges.iter().any(|e| {
            if e.edge_type != edge_name {
                return false;
            }
            let subj_ok = rel.subject_contains.is_empty()
                || e.dst_key
                    .to_ascii_lowercase()
                    .contains(&rel.subject_contains.to_ascii_lowercase())
                || e.src_key
                    .to_ascii_lowercase()
                    .contains(&rel.subject_contains.to_ascii_lowercase());
            let obj_ok = rel.object_contains.is_empty()
                || e.src_key
                    .to_ascii_lowercase()
                    .contains(&rel.object_contains.to_ascii_lowercase())
                || e.dst_key
                    .to_ascii_lowercase()
                    .contains(&rel.object_contains.to_ascii_lowercase());
            subj_ok && obj_ok
        });
        if !found {
            return false;
        }
    }
    true
}

fn reset_semantics(db_path: &Path) {
    let Ok(db) = store::open(db_path) else {
        eprintln!("[warn] cannot open db for reset");
        return;
    };
    let _ = db.execute_batch(
        r#"
        DELETE FROM edges
        WHERE type LIKE 'sem/%'
           OR src_id IN (SELECT id FROM nodes WHERE key LIKE 'sem:%')
           OR dst_id IN (SELECT id FROM nodes WHERE key LIKE 'sem:%');
        DELETE FROM nodes WHERE key LIKE 'sem:%';
        DELETE FROM extraction_jobs;
        PRAGMA wal_checkpoint(TRUNCATE);
        "#,
    );
}

fn print_db_sem_summary(db_path: &Path) {
    let Ok(db) = store::open(db_path) else {
        return;
    };
    println!("\n----- DB semantic nodes -----");
    let Ok(mut stmt) = db.prepare(
        "SELECT type, label, key, json_extract(props, '$.status')
         FROM nodes WHERE key LIKE 'sem:%'
         ORDER BY type, last_seen_ms DESC",
    ) else {
        return;
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    });
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            let (ty, label, key, status) = row;
            match status.as_deref().filter(|s| !s.is_empty()) {
                Some(st) => println!("  [{ty}] {label}  status={st}  ({key})"),
                None => println!("  [{ty}] {label}  ({key})"),
            }
        }
    }
    println!("----- DB lifecycle edges -----");
    let Ok(mut stmt) = db.prepare(
        "SELECT e.type, s.key, d.key
         FROM edges e
         JOIN nodes s ON s.id = e.src_id
         JOIN nodes d ON d.id = e.dst_id
         WHERE e.type IN ('sem/superseded_by', 'sem/closed_by')
         ORDER BY e.type",
    ) else {
        return;
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    });
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            println!("  {}  {} → {}", row.0, row.1, row.2);
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
