//! 旁路语义抽取 live 验证：kimi-coding/k3 → completion → parse → 写库。
//!
//! ```text
//! cargo run -p giteam-core --example extraction_live -- \
//!   --provider kimi-coding --model k3 \
//!   --repo /Users/tianya/Documents/project/giteam
//! ```

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use giteam_core::asset_graph::extraction::ExtractionInput;
use giteam_core::asset_graph::semantic;
use giteam_core::asset_graph::store;
use giteam_core::pi_agent::{
    AgentEvent, AgentEventEnvelope, ExtractionCompletionRequest, PiAgentService, PiSessionConfig,
};

#[tokio::main]
async fn main() {
    let args = parse_args();
    let service = PiAgentService::global();

    let catalog = service.provider_catalog().unwrap_or_else(|e| {
        eprintln!("provider catalog failed: {e}");
        std::process::exit(1);
    });
    match catalog.find_model(&args.provider, &args.model) {
        Ok(Some(info)) => println!(
            "[ok] model {}/{} credential={}",
            info.provider, info.model_id, info.has_credential
        ),
        Ok(None) => {
            eprintln!("model not found: {}/{}", args.provider, args.model);
            std::process::exit(2);
        }
        Err(e) => {
            eprintln!("find_model failed: {e}");
            std::process::exit(1);
        }
    }

    let session_dir = std::env::temp_dir().join(format!(
        "giteam-extraction-live-{}",
        std::process::id()
    ));
    let _ = std::fs::create_dir_all(&session_dir);

    let config = PiSessionConfig {
        repo_path: args.repo.clone(),
        session_dir: session_dir.clone(),
        session_path: None,
        provider: Some(args.provider.clone()),
        model: Some(args.model.clone()),
        api_key: None,
        system_prompt: None,
        append_system_prompt: None,
        enabled_tools: Some(vec!["ls".into()]),
        extension_paths: Vec::new(),
        no_session: false,
        thinking: Some("off".into()),
        max_tool_iterations: Some(1),
        browser_controller: None,
        parent_session_id: None,
        parent_tool_call_id: None,
        session_kind: "primary".to_string(),
    };

    let summary = service.create_session(config).await.unwrap_or_else(|e| {
        eprintln!("create_session failed: {e}");
        std::process::exit(1);
    });
    println!(
        "[ok] parent session {} provider={} model={}",
        summary.session_id, summary.provider, summary.model
    );

    let db_path = giteam_core::pi_agent::memory_db_path_for_repo(&args.repo).unwrap_or_else(|| {
        args.repo.join(".giteam").join("asset-graph.db")
    });
    let before = count_sem_nodes(&db_path);
    println!("[ok] db {} sem_nodes_before={}", db_path.display(), before);

    let parent_id = summary.session_id.clone();
    let run_id = format!("extract-live-{}", now_ms());

    // 开一条短 run：一边保持 run_context，一边抓 memory.extraction.* 事件。
    let events: Arc<std::sync::Mutex<Vec<AgentEventEnvelope>>> =
        Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink_events = Arc::clone(&events);
    let sink = Arc::new(move |envelope: AgentEventEnvelope| {
        if let Ok(mut guard) = sink_events.lock() {
            guard.push(envelope);
        }
    });

    let prompt_task = {
        let service = Arc::clone(&PiAgentService::global());
        let parent_id = parent_id.clone();
        let run_id = run_id.clone();
        let sink = Arc::clone(&sink);
        tokio::spawn(async move {
            // 用可等待的长一点指令，给抽取留出窗口挂 publisher。
            let result = service
                .prompt(
                    &parent_id,
                    &run_id,
                    "请只回复两个字：好的。不要调用工具。",
                    Vec::new(),
                    sink,
                )
                .await;
            match result {
                Ok(msg) => {
                    let text: String = msg
                        .parts
                        .iter()
                        .filter_map(|p| match p {
                            giteam_core::pi_agent::AgentPart::Text { text } => Some(text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join("");
                    println!(
                        "[ok] parent prompt done: {}",
                        text.chars().take(80).collect::<String>()
                    );
                }
                Err(e) => eprintln!("[warn] parent prompt failed: {e}"),
            }
        })
    };

    // 等 run_context 就绪
    tokio::time::sleep(Duration::from_millis(800)).await;

    let host = service.asset_graph_subagent_host().unwrap_or_else(|| {
        eprintln!("no subagent host");
        std::process::exit(1);
    });

    let input = ExtractionInput {
        session_id: parent_id.clone(),
        run_id: run_id.clone(),
        turn_key: Some(format!("turn:live-{}", now_ms())),
        session_key: format!(
            "session:live-{}",
            &parent_id[..8.min(parent_id.len())]
        ),
        user_text: args.user_text.clone(),
        assistant_text: args.assistant_text.clone(),
        file_keys: args
            .file_paths
            .iter()
            .map(|p| (p.clone(), format!("file:{p}")))
            .collect(),
        commands: args.commands.clone(),
        error_lines: Vec::new(),
        timestamp_ms: now_ms(),
        sequence: 900_001,
        repo_path: args.repo.to_string_lossy().into_owned(),
        provider: Some(args.provider.clone()),
        model: Some(args.model.clone()),
        thinking: Some("off".into()),
    };

    let known_lines = load_known_entity_lines(&db_path);
    println!(
        "[run] run_extraction_completion via host (known_entities={})",
        known_lines.len()
    );

    let extraction_id = format!("asset-graph-extract-{}", input.sequence);
    let publisher = host.memory_extraction_publisher(&parent_id, &extraction_id);
    if let Some(p) = &publisher {
        p.started();
        println!("[ok] memory.extraction.started published");
    } else {
        println!("[warn] no memory publisher (parent run may not be active yet)");
    }

    let started = std::time::Instant::now();
    let result = host
        .run_extraction_completion(ExtractionCompletionRequest {
            parent_session_id: parent_id.clone(),
            extraction_id: extraction_id.clone(),
            prompt: input.build_prompt(&known_lines),
            fallback: Some(giteam_core::pi_agent::ExtractionCompletionFallback {
                repo_path: args.repo.to_string_lossy().into_owned(),
                provider: Some(args.provider.clone()),
                model: Some(args.model.clone()),
                thinking: Some("off".into()),
            }),
        })
        .await;

    let result = match result {
        Ok(r) => r,
        Err(e) => {
            if let Some(p) = &publisher {
                p.failed(
                    e.clone(),
                    started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
                );
            }
            eprintln!("[fail] completion: {e}");
            let _ = prompt_task.await;
            std::process::exit(1);
        }
    };

    println!(
        "[ok] completion elapsed_ms={} summary_chars={}",
        result.elapsed_ms,
        result.summary.len()
    );
    println!("----- raw summary -----");
    println!("{}", result.summary);
    println!("----- end raw -----");

    let anchors = input.anchors();
    let parsed = semantic::parse_extraction(&result.summary, &anchors, &[]);
    println!(
        "[ok] parsed entities={} relations={} intent={:?}",
        parsed.entity_count, parsed.relation_count, parsed.intent
    );
    for (t, title) in &parsed.entity_summaries {
        println!("  - {t}: {title}");
    }

    // 写入生产库（与桌面同一 db）
    let db = store::open(&db_path).unwrap_or_else(|e| {
        eprintln!("open db failed: {e}");
        std::process::exit(1);
    });
    if !parsed.batch.is_empty() {
        store::write_batch(&db, &parsed.batch).unwrap_or_else(|e| {
            eprintln!("write_batch failed: {e}");
            std::process::exit(1);
        });
    }
    if let Some(intent) = &parsed.intent {
        let _ = db.execute(
            "UPDATE nodes SET props = json_set(props, '$.intent', ?1)
             WHERE key = ?2 AND type = 'session'",
            rusqlite::params![intent, anchors.session_key],
        );
    }
    if let Some(turn) = &input.turn_key {
        let _ = db.execute(
            "UPDATE nodes SET props = json_set(props, '$.semExtracted', json('true'))
             WHERE key = ?1 AND type = 'turn'",
            [turn],
        );
    }

    if let Some(p) = &publisher {
        let entities = parsed
            .entity_summaries
            .iter()
            .map(|(etype, title)| giteam_core::pi_agent::MemoryExtractionEntity {
                entity_type: etype.clone(),
                title: title.clone(),
            })
            .collect();
        p.completed(
            parsed.entity_count as u32,
            parsed.relation_count as u32,
            parsed.intent.clone(),
            entities,
            Some(parsed.quality.as_str().to_string()),
            Some(parsed.priority.as_str().to_string()),
            result.elapsed_ms,
        );
        println!("[ok] memory.extraction.completed published");
    }

    let _ = prompt_task.await;

    let after = count_sem_nodes(&db_path);
    println!(
        "[ok] sem_nodes_after={after} delta={}",
        after as i64 - before as i64
    );

    // 直接 SQL 核对
    println!("----- recent semantic nodes -----");
    print_recent_sem(&db_path, 12);

    let has_decision = query_has(
        &db_path,
        "SELECT COUNT(*) FROM nodes WHERE type='decision' AND (lower(key) LIKE '%sqlite%' OR lower(label) LIKE '%sqlite%')",
    );
    let has_tradeoff = query_has(
        &db_path,
        "SELECT COUNT(*) FROM nodes WHERE type='tradeoff' AND (lower(props) LIKE '%neo4j%' OR lower(label) LIKE '%neo4j%' OR lower(props) LIKE '%neo4j%')",
    );
    println!("[check] decision(sqlite) present={has_decision}");
    println!("[check] tradeoff(neo4j-ish) present={has_tradeoff}");

    let memory_events: Vec<_> = events
        .lock()
        .map(|g| {
            g.iter()
                .filter(|e| {
                    matches!(
                        e.event,
                        AgentEvent::MemoryExtractionStarted { .. }
                            | AgentEvent::MemoryExtractionCompleted { .. }
                            | AgentEvent::MemoryExtractionFailed { .. }
                    )
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    println!(
        "[check] memory.extraction events on parent stream={}",
        memory_events.len()
    );
    for e in &memory_events {
        match &e.event {
            AgentEvent::MemoryExtractionStarted { extraction_id } => {
                println!("  started id={extraction_id}");
            }
            AgentEvent::MemoryExtractionCompleted {
                extraction_id,
                entity_count,
                relation_count,
                intent,
                ..
            } => println!(
                "  completed id={extraction_id} entities={entity_count} relations={relation_count} intent={intent:?}"
            ),
            AgentEvent::MemoryExtractionFailed {
                extraction_id,
                error,
                ..
            } => println!("  failed id={extraction_id} error={error}"),
            _ => {}
        }
    }

    // Control HTTP（若本机 4100 在跑）再查一层
    let repo_q = urlencoding_path(args.repo.to_string_lossy().as_ref());
    for path in [
        format!("http://127.0.0.1:4100/api/v1/graph/search?repoPath={repo_q}&q=sqlite"),
        format!("http://127.0.0.1:4100/api/v1/graph/summary?repoPath={repo_q}"),
    ] {
        match reqwest_get(&path).await {
            Ok(body) => {
                let preview: String = body.chars().take(500).collect();
                println!("[api] GET {} => {}", path.split('?').next().unwrap_or(&path), preview);
            }
            Err(e) => println!("[api] skip ({e})"),
        }
    }

    let ok = parsed.entity_count > 0 && has_decision;
    if ok {
        println!("[PASS] k3 bypass completion + db verification succeeded");
        std::process::exit(0);
    }
    println!("[FAIL] expected parsed decision entity and sqlite decision in db");
    std::process::exit(1);
}

struct Args {
    provider: String,
    model: String,
    repo: PathBuf,
    user_text: String,
    assistant_text: String,
    file_paths: Vec<String>,
    commands: Vec<String>,
}

fn parse_args() -> Args {
    let mut provider = std::env::var("GITEAM_RP_PROVIDER").unwrap_or_else(|_| "kimi-coding".into());
    let mut model = std::env::var("GITEAM_RP_MODEL").unwrap_or_else(|_| "k3".into());
    let mut repo = std::env::var("GITEAM_RP_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--provider" => provider = args.next().expect("--provider value"),
            "--model" => model = args.next().expect("--model value"),
            "--repo" => repo = PathBuf::from(args.next().expect("--repo value")),
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
        user_text: "资产图谱的存储我们定一下：用 SQLite，不上 Neo4j。理由是我们要零运维，团队没人愿意维护一个图数据库，而且 rusqlite 已经捆绑进二进制了。".into(),
        assistant_text: "已按该决策落地：在 crates/giteam-core/src/asset_graph/store.rs 用 rusqlite 实现属性图 schema，开启 WAL 模式。".into(),
        file_paths: vec!["crates/giteam-core/src/asset_graph/store.rs".into()],
        commands: vec!["cargo test -p giteam-core".into()],
    }
}

fn count_sem_nodes(db_path: &Path) -> i64 {
    let Ok(db) = store::open(db_path) else {
        return 0;
    };
    db.query_row(
        "SELECT COUNT(*) FROM nodes WHERE key LIKE 'sem:%'",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

fn query_has(db_path: &Path, sql: &str) -> bool {
    let Ok(db) = store::open(db_path) else {
        return false;
    };
    db.query_row(sql, [], |r| r.get::<_, i64>(0))
        .map(|n| n > 0)
        .unwrap_or(false)
}

fn print_recent_sem(db_path: &Path, limit: i64) {
    let Ok(db) = store::open(db_path) else {
        return;
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT type, key, label, substr(props,1,120)
         FROM nodes WHERE key LIKE 'sem:%'
         ORDER BY last_seen_ms DESC LIMIT ?1",
    ) else {
        return;
    };
    let rows = stmt.query_map([limit], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    });
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            println!("  [{}] {} | {} | {}", row.0, row.1, row.2, row.3);
        }
    }
}

fn load_known_entity_lines(db_path: &Path) -> Vec<String> {
    let Ok(db) = store::open(db_path) else {
        return Vec::new();
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT type, key, label FROM nodes WHERE key LIKE 'sem:%' ORDER BY last_seen_ms DESC LIMIT 40",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for row in rows.flatten() {
        let (etype, key, label) = row;
        let slug = key
            .strip_prefix("sem:")
            .and_then(|rest| rest.split_once(':'))
            .map(|(_, slug)| slug)
            .unwrap_or(key.as_str());
        let title = if label.trim().is_empty() {
            slug.to_string()
        } else {
            label
        };
        out.push(format!("{etype}\t{slug}\t{title}"));
    }
    out
}

fn urlencoding_path(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

async fn reqwest_get(url: &str) -> Result<String, String> {
    let url = url.to_string();
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("curl")
            .args(["-sS", "-m", "3", &url])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!("curl exit {}", output.status));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
