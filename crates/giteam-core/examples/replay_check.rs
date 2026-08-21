//! 端到端验证：对真实仓库的存量会话跑资产图谱回放。
//!
//! 用法：cargo run --example replay_check -- <repo_path>
//! 输出图谱统计 + 近期会话摘要（验证跨会话意图/文件/错误链是否成立）。

use std::path::Path;

fn main() {
    let repo = std::env::args()
        .nth(1)
        .unwrap_or_else(|| ".".to_string());
    let repo = Path::new(&repo).canonicalize().expect("canonicalize repo");
    let mut graph = giteam_core::asset_graph::AssetGraph::open(&repo).expect("open graph");
    let (indexed, skipped) = graph.replay_backlog();
    println!("replayed {indexed} files ({skipped} unchanged)");

    let query = graph.query();
    println!("counts: {:?}", query.counts());
    println!("\n--- recent sessions ---");
    for session in query.recent_sessions(8) {
        println!(
            "「{}」files={:?} commits={:?} unresolved={:?}",
            session.intent,
            session.files_modified.iter().take(4).cloned().collect::<Vec<_>>(),
            session.commits.iter().take(2).cloned().collect::<Vec<_>>(),
            session.unresolved_errors.iter().take(1).cloned().collect::<Vec<_>>()
        );
    }
    println!("\n--- digest ---");
    println!("{}", query.recent_changes_digest(5));

    // 定向验证：有改动史的会话应带出文件列表（跨会话文件修改史闭环）。
    println!("\n--- file history probe ---");
    for file in ["docs/desktop-user-guide.html", "crates/giteam-core/Cargo.toml"] {
        let history = query.file_history(file);
        println!("{file}: {} entries", history.len());
        for entry in history.iter().take(3) {
            println!("  intent={} ts={}", entry.intent.chars().take(40).collect::<String>(), entry.timestamp_ms);
        }
    }
    let with_files: Vec<_> = query
        .recent_sessions(50)
        .into_iter()
        .filter(|s| !s.files_modified.is_empty())
        .collect();
    println!("sessions with modified files: {}", with_files.len());
    for s in with_files.iter().take(3) {
        println!("  「{}」-> {:?}", s.intent.chars().take(30).collect::<String>(), s.files_modified.iter().take(3).cloned().collect::<Vec<_>>());
    }
    let precedents = query.find_precedents("App.tsx(412,7): error TS2322: Type '() => void' is not assignable");
    println!("precedents probe: {} hits", precedents.len());
    for hit in precedents.iter().take(2) {
        println!("  fixed by: {} (intent: {})", hit.resolved_by_label.chars().take(60).collect::<String>(), hit.intent.chars().take(30).collect::<String>());
    }

    // 关键回归：以 sessions 接口返回的 sessionKey（key 而非 id）为中心——
    // id 与 key 双 hash 不一致，resolve_center 必须走 key 通道命中。
    println!("\n--- sessionKey-as-center regression ---");
    if let Some(latest) = query.recent_sessions(1).first() {
        let by_key = query.subgraph(&latest.session_key, 2, 60);
        println!(
            "center via sessionKey: nodes={} edges={}",
            by_key.nodes.len(),
            by_key.edges.len()
        );
        assert!(
            !by_key.nodes.is_empty(),
            "sessionKey center must resolve (id/key double-hash regression)"
        );
    }

    // 子图（可视化数据路径）：以会话为中心展开。
    println!("\n--- subgraph probe ---");
    let view = query.subgraph("docs/desktop-user-guide.html", 2, 60);
    println!(
        "center={} nodes={} edges={}",
        view.center,
        view.nodes.len(),
        view.edges.len()
    );
    let types: std::collections::HashMap<&str, usize> =
        view.nodes.iter().map(|n| (n.node_type.as_str(), 1)).fold(
            std::collections::HashMap::new(),
            |mut acc, (k, v)| {
                *acc.entry(k).or_insert(0) += v;
                acc
            },
        );
    println!("node types: {:?}", types);
    let edge_types: std::collections::HashSet<&str> =
        view.edges.iter().map(|e| e.edge_type.as_str()).collect();
    println!("edge types: {:?}", edge_types);

    // 搜索冒烟：仓库内高频文件应可命中。
    for probe in ["control", "login", "cargo"] {
        let hits = query.search(probe, None, 3);
        println!("search({probe:?}) -> {} hits: {:?}", hits.len(),
            hits.iter().map(|h| (h.node_type.clone(), h.label.clone())).collect::<Vec<_>>());
    }
}
