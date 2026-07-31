//! 对指定 provider 执行一次实时 `/v1/models` 刷新（Giteam 后端真实链路：
//! vault 取 key → pi model_fetch live fetch → diff 静态快照 → 合并进
//! models.json），打印新增的模型 id。用于排查"已连接 provider 模型列表不更新"。
//! 凭据只经由 vault 读取，绝不打印。
//!
//! 用法：cargo run --example refresh_models -- <provider>

use giteam_core::pi_agent::PiAgentService;

fn main() {
    let provider = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: refresh_models <provider>");
        std::process::exit(2);
    });
    let service = PiAgentService::global();
    if !service.has_credential(&provider) {
        eprintln!("provider {provider} has no credential in vault");
        std::process::exit(1);
    }
    match service.refresh_provider_models(&provider) {
        Ok(added) => {
            if added.is_empty() {
                println!("no new models merged for {provider} (already up to date or live fetch fell back)");
            } else {
                println!("merged {} new models for {provider}:", added.len());
                for id in added {
                    println!("  {id}");
                }
            }
        }
        Err(error) => {
            eprintln!("refresh failed: {error}");
            std::process::exit(1);
        }
    }
}
