//! 对生产 DB 做与 `/api/v1/graph/*` 等价的 query 层验证，并冒烟新 context/trace。
use std::path::PathBuf;
use giteam_core::asset_graph;

fn main() {
    let repo = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from("/Users/tianya/Documents/project/test")
    });
    asset_graph::attach_repo(&repo).expect("attach");
    let graph = asset_graph::attached(&repo).expect("mounted");
    let g = graph.lock().expect("lock");
    let q = g.query();
    let counts = q.counts();
    println!("[summary] {}", serde_json::to_string_pretty(&counts).unwrap());

    let hits = q.search("sqlite", None, 20);
    println!("[search sqlite] hits={}", hits.len());
    for h in hits.iter().take(8) {
        println!("  - type={} id={} label={}", h.node_type, h.node_id, h.label);
    }

    let bundle = q.build_context("sqlite 存储选型");
    println!(
        "[build_context] matched={} neighbors={} open_loops={} precedents={} file_history={}",
        bundle.matched_nodes.len(),
        bundle.neighbors.len(),
        bundle.open_loops.len(),
        bundle.precedents.len(),
        bundle.file_history.len()
    );
    for n in bundle.neighbors.iter().take(8) {
        println!(
            "  neighbor {} -[{}]-> [{}] {}",
            n.from_label, n.edge_type, n.neighbor_type, n.neighbor_label
        );
    }
    for loop_hit in bundle.open_loops.iter().take(6) {
        println!(
            "  open_loop [{}] {} — {}",
            loop_hit.kind, loop_hit.label, loop_hit.detail
        );
    }

    // path-anchor search (codegraph-style)
    let anchored = q.search("refactor SessionAccumulator module", None, 10);
    println!("[search path-anchor] hits={}", anchored.len());
    for h in anchored.iter().take(5) {
        println!("  - [{}] {}", h.node_type, h.label);
    }

    // trace between a decision and sqlite concept if present
    let from = bundle
        .matched_nodes
        .iter()
        .find(|h| h.node_type == "decision")
        .map(|h| h.label.clone())
        .or_else(|| bundle.matched_nodes.first().map(|h| h.label.clone()));
    let to = "SQLite";
    if let Some(from) = from {
        let hops = q.trace_path(&from, to, 5);
        println!("[trace] {} -> {} hops={}", from, to, hops.len());
        for (i, hop) in hops.iter().enumerate() {
            if i == 0 {
                println!("  1. [{}] {}", hop.node_type, hop.label);
            } else {
                println!(
                    "  {}. -[{}]-> [{}] {}",
                    i + 1,
                    hop.via_edge.as_deref().unwrap_or("?"),
                    hop.node_type,
                    hop.label
                );
            }
        }
    }

    let ok = hits
        .iter()
        .any(|h| {
            (h.node_type == "decision" || h.node_type == "tech_concept")
                && h.label.to_lowercase().contains("sqlite")
        })
        && !bundle.matched_nodes.is_empty();
    if ok {
        println!("[PASS] thickened context + search + optional trace look healthy");
    } else {
        println!("[FAIL]");
        std::process::exit(1);
    }
}
