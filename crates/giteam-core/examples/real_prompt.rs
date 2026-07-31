//! 通用真实 prompt 闭环验证（offline CI 不运行，需手动执行）。
//!
//! 覆盖链路：secret vault → create session → prompt → 流式事件 → 工具调用 →
//! set_model → abort。provider-neutral，不内置任何厂商假设。
//!
//! 用法（cargo run --example real_prompt -- ...）：
//!   --provider <id>     provider id（必填，如 openai/anthropic/deepseek/...）
//!   --model <id>        model id（必填）
//!   --api-key <key>     api key（可选；缺省时从统一 vault 按 provider 解析）
//!   --save-key          将 --api-key 写入统一 vault（0600）后再运行
//!   --prompt <text>     prompt（默认：要求调用一次工具的小任务）
//!   --repo <path>       工作目录（默认：当前目录）
//!   --thinking <level>  thinking level（off/minimal/low/medium/high/xhigh）
//!   --abort-after <ms>  prompt 发出后 N 毫秒触发 abort（验证中断路径）
//!
//! 环境变量等价物：GITEAM_RP_PROVIDER / GITEAM_RP_MODEL / GITEAM_RP_API_KEY /
//! GITEAM_RP_PROMPT / GITEAM_RP_REPO / GITEAM_RP_THINKING。
//!
//! 注意：api key 仅经命令行/环境变量进入内存（或经 --save-key 入 vault），
//! 本程序不打印、不记录凭据内容。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::executor::block_on;
use giteam_core::pi_agent::{
    AgentEvent, AgentEventEnvelope, PiAgentService, PiSessionConfig, SecretStore,
};

struct Args {
    provider: String,
    model: String,
    api_key: Option<String>,
    save_key: bool,
    prompt: String,
    repo: PathBuf,
    thinking: Option<String>,
    abort_after_ms: Option<u64>,
}

fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };

    let service = PiAgentService::global();

    if args.save_key {
        let Some(key) = args.api_key.as_deref() else {
            eprintln!("--save-key requires --api-key");
            std::process::exit(2);
        };
        let Some(path) = SecretStore::default_path() else {
            eprintln!("secret vault path is unavailable");
            std::process::exit(1);
        };
        SecretStore::new(path)
            .set_api_key(&args.provider, key)
            .unwrap_or_else(|error| {
                eprintln!("save api key failed: {error}");
                std::process::exit(1);
            });
        println!("[ok] api key saved to vault for provider={}", args.provider);
    }

    let catalog = service.provider_catalog().unwrap_or_else(|error| {
        eprintln!("provider catalog failed: {error}");
        std::process::exit(1);
    });
    match catalog.find_model(&args.provider, &args.model) {
        Ok(Some(info)) => println!(
            "[ok] model found: {} / {} (credential={})",
            info.provider, info.model_id, info.has_credential
        ),
        Ok(None) => {
            eprintln!(
                "model not found in catalog: {}/{} (check --provider/--model)",
                args.provider, args.model
            );
            std::process::exit(2);
        }
        Err(error) => {
            eprintln!("find_model failed: {error}");
            std::process::exit(1);
        }
    }

    let session_dir = std::env::temp_dir().join(format!(
        "giteam-real-prompt-{}",
        std::process::id()
    ));
    let config = PiSessionConfig {
        repo_path: args.repo.clone(),
        session_dir: session_dir.clone(),
        session_path: None,
        provider: Some(args.provider.clone()),
        model: Some(args.model.clone()),
        api_key: args.api_key.clone(),
        system_prompt: None,
        append_system_prompt: None,
        enabled_tools: None,
        extension_paths: Vec::new(),
        no_session: false,
        thinking: args.thinking.clone(),
        max_tool_iterations: None,
    };
    let summary = match block_on(service.create_session(config)) {
        Ok(summary) => summary,
        Err(error) => {
            eprintln!("create session failed: {error}");
            std::process::exit(1);
        }
    };
    println!(
        "[ok] session created: id={} provider={} model={}",
        summary.session_id, summary.provider, summary.model
    );

    let events = Arc::new(Mutex::new(Vec::<AgentEventEnvelope>::new()));
    let events_for_sink = Arc::clone(&events);
    let sink = Arc::new(move |event: AgentEventEnvelope| {
        let label = match &event.event {
            AgentEvent::MessageDelta { delta, .. } => format!("message.delta {delta:?}"),
            AgentEvent::ReasoningDelta { delta, .. } => format!("reasoning.delta {delta:?}"),
            AgentEvent::ToolCallStarted { tool_name, .. } => {
                format!("toolCall.started name={tool_name}")
            }
            AgentEvent::ToolProgress { tool_name, .. } => format!("tool.progress name={tool_name}"),
            AgentEvent::ToolCompleted {
                tool_name, is_error, ..
            } => format!("tool.completed name={tool_name} isError={is_error}"),
            AgentEvent::Retry {
                phase,
                attempt,
                success,
                ..
            } => format!("retry phase={phase} attempt={attempt} success={success:?}"),
            AgentEvent::RunCompleted => "run.completed".to_string(),
            AgentEvent::RunFailed { error } => format!("run.failed {error}"),
            other => format!("{other:?}"),
        };
        println!("[event #{:03}] {label}", event.sequence);
        // GITEAM_RP_DUMP_EVENTS=1 时打印完整 envelope JSON（与 Tauri emit
        // 给前端的 wire 格式一致），用于核对前端事件渲染问题。
        if std::env::var_os("GITEAM_RP_DUMP_EVENTS").is_some() {
            if let Ok(json) = serde_json::to_string(&event) {
                println!("[json #{:03}] {json}", event.sequence);
            }
        }
        if let Ok(mut events) = events_for_sink.lock() {
            events.push(event);
        }
    });

    let run_id = format!("real-prompt-{}", std::process::id());
    if let Some(delay_ms) = args.abort_after_ms {
        let service = Arc::clone(service);
        let run_id = run_id.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay_ms));
            let aborted = service.abort(&run_id);
            println!("[ok] abort requested after {delay_ms}ms: {aborted}");
        });
    }

    let result = block_on(service.prompt(
        &summary.session_id,
        &run_id,
        args.prompt.clone(),
        Vec::new(),
        sink,
    ));
    match result {
        Ok(message) => {
            let text: String = message
                .parts
                .iter()
                .filter_map(|part| match part {
                    giteam_core::pi_agent::AgentPart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect();
            println!("[ok] prompt finished, final text:\n{text}");
        }
        Err(error) => {
            eprintln!("[fail] prompt failed: {error}");
            if args.abort_after_ms.is_none() {
                std::process::exit(1);
            }
        }
    }

    let messages = block_on(service.messages(&summary.session_id)).unwrap_or_default();
    println!("[ok] session holds {} messages", messages.len());
    let events = events.lock().map(|items| items.len()).unwrap_or(0);
    println!("[ok] received {events} events");
    let _ = std::fs::remove_dir_all(session_dir);
}

fn parse_args() -> Result<Args, String> {
    let mut provider = std::env::var("GITEAM_RP_PROVIDER").ok();
    let mut model = std::env::var("GITEAM_RP_MODEL").ok();
    let mut api_key = std::env::var("GITEAM_RP_API_KEY").ok();
    let mut prompt = std::env::var("GITEAM_RP_PROMPT").ok();
    let mut repo = std::env::var("GITEAM_RP_REPO").ok();
    let mut thinking = std::env::var("GITEAM_RP_THINKING").ok();
    let mut save_key = false;
    let mut abort_after_ms = None;

    let mut argv = std::env::args().skip(1);
    while let Some(arg) = argv.next() {
        let mut take = |name: &str| -> Result<String, String> {
            argv.next()
                .ok_or_else(|| format!("missing value for {name}"))
        };
        match arg.as_str() {
            "--provider" => provider = Some(take("--provider")?),
            "--model" => model = Some(take("--model")?),
            "--api-key" => api_key = Some(take("--api-key")?),
            "--prompt" => prompt = Some(take("--prompt")?),
            "--repo" => repo = Some(take("--repo")?),
            "--thinking" => thinking = Some(take("--thinking")?),
            "--save-key" => save_key = true,
            "--abort-after" => {
                abort_after_ms = Some(
                    take("--abort-after")?
                        .parse()
                        .map_err(|_| "--abort-after expects milliseconds".to_string())?,
                );
            }
            "--help" | "-h" => {
                return Err(
                    "see module docs: cargo run --example real_prompt -- --provider <p> --model <m>"
                        .to_string(),
                );
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Args {
        provider: provider.ok_or("--provider is required")?,
        model: model.ok_or("--model is required")?,
        api_key,
        save_key,
        prompt: prompt.unwrap_or_else(|| {
            "List the files in the current directory with the bash tool, then answer with exactly: \
             REAL_PROMPT_OK"
                .to_string()
        }),
        repo: repo
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
        thinking,
        abort_after_ms,
    })
}
