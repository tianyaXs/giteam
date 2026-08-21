//! 用真实 catalog 复现 list_sessions：打印后端实际返回的会话列表，
//! 以及恢复失败的会话（list_sessions 的恢复循环会逐条记 stderr）。

#[tokio::main]
async fn main() {
    let service = giteam_core::pi_agent::PiAgentService::global();
    let sessions = service.list_sessions().await.expect("list_sessions");
    println!("\n===== list_sessions 返回 {} 个会话 =====", sessions.len());
    let target = std::env::args().nth(1);
    for s in &sessions {
        let mark = target
            .as_deref()
            .map(|t| if s.session_id.starts_with(t) { " <<<" } else { "" })
            .unwrap_or("");
        println!(
            "{} kind={} updated={} title={}{}",
            &s.session_id[..8.min(s.session_id.len())],
            s.session_kind,
            s.updated_at_ms,
            s.title.clone().unwrap_or_default().chars().take(40).collect::<String>(),
            mark
        );
    }
    if let Some(t) = &target {
        let found = sessions.iter().any(|s| s.session_id.starts_with(t));
        println!("\n目标会话 {t} 在列表中: {found}");
    }
}
