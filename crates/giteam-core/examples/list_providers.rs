//! 打印 Pi SDK 内置 provider/model catalog（Giteam 后端视角），用于核对
//! "配置里到底加载的是哪套供应商"。不触碰任何用户会话数据。
//!
//! 用法：cargo run --example list_providers

use giteam_core::pi_agent::PiAgentService;

fn main() {
    let service = PiAgentService::global();
    let providers = service.list_providers().unwrap_or_else(|error| {
        eprintln!("list providers failed: {error}");
        std::process::exit(1);
    });
    let total_models: usize = providers.iter().map(|p| p.model_count).sum();
    println!("provider (credential) — models");
    for provider in &providers {
        println!(
            "  {} ({}) — {} models",
            provider.provider, provider.has_credential, provider.model_count
        );
        // 传入 provider id 作为参数时打印其模型 id 明细，便于核对合并结果。
        if std::env::args().nth(1).as_deref() == Some(provider.provider.as_str()) {
            for model in &provider.models {
                println!("    - {}", model.model_id);
            }
        }
    }
    println!("total: {} providers, {} models", providers.len(), total_models);
}
