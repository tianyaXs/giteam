//! 对生产 DB 做与 `/api/v1/graph/*` 等价的 query 层验证。
use std::path::PathBuf;
use giteam_core::asset_graph;

fn main() {
    let repo = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from("/Users/tianya/Documents/project/giteam")
    });
    asset_graph::attach_repo(&repo).expect("attach");
    let graph = asset_graph::attached(&repo).expect("mounted");
    let g = graph.lock().expect("lock");
    let q = g.query();
    let counts = q.counts();
    println!("[summary] {}", serde_json::to_string_pretty(&counts).unwrap());
    let hits = q.search("sqlite", None, 20);
    println!("[search sqlite] hits={}", hits.len());
    for h in &hits {
        println!(
            "  - type={} id={} label={}",
            h.node_type, h.node_id, h.label
        );
    }
    let hits2 = q.search("decision-sqlite", None, 10);
    println!("[search decision-sqlite] hits={}", hits2.len());
    for h in &hits2 {
        println!("  - {} | {}", h.node_id, h.label);
    }
    if let Some(center) = hits2.first().map(|h| h.node_id.clone()) {
        let view = q.subgraph(&center, 1, 50, None);
        println!(
            "[subgraph] center={} nodes={} edges={}",
            view.center,
            view.nodes.len(),
            view.edges.len()
        );
        for e in view.edges.iter().take(12) {
            println!("  edge {} {} -> {}", e.edge_type, e.src_id, e.dst_id);
        }
    }
    let ok = hits
        .iter()
        .any(|h| h.node_type == "decision" && h.label.to_lowercase().contains("sqlite"));
    if ok {
        println!("[PASS] query layer sees sqlite decision");
    } else {
        println!("[FAIL]");
        std::process::exit(1);
    }
}
