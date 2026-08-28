//! 资产图谱 Tauri 命令：桌面面板直连内核（移动端/Web 走 Control HTTP 端点）。
//!
//! 查询类命令走 spawn_blocking，避免同步 IPC 拖住 UI 线程（刚进应用/切项目转圈）。
//! 图谱实例由会话创建时挂载（control.rs / service 层 attach）；
//! 未挂载时返回空结果而不是错误——面板显示引导态。

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCountsDto {
    pub nodes: i64,
    pub edges: i64,
    pub sessions: i64,
    pub files: i64,
    pub tool_calls: i64,
    pub errors: i64,
    pub commits: i64,
    pub mounted: bool,
}

fn empty_counts() -> GraphCountsDto {
    GraphCountsDto {
        nodes: 0,
        edges: 0,
        sessions: 0,
        files: 0,
        tool_calls: 0,
        errors: 0,
        commits: 0,
        mounted: false,
    }
}

fn summary_sync(repo_path: &str) -> GraphCountsDto {
    let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(repo_path)) else {
        return empty_counts();
    };
    let Ok(graph) = graph.lock() else {
        return empty_counts();
    };
    let counts = graph.query().counts();
    GraphCountsDto {
        nodes: counts.nodes,
        edges: counts.edges,
        sessions: counts.sessions,
        files: counts.files,
        tool_calls: counts.tool_calls,
        errors: counts.errors,
        commits: counts.commits,
        mounted: true,
    }
}

#[tauri::command]
pub async fn asset_graph_summary(repo_path: String) -> GraphCountsDto {
    tauri::async_runtime::spawn_blocking(move || summary_sync(&repo_path))
        .await
        .unwrap_or_else(|_| empty_counts())
}

#[tauri::command]
pub async fn asset_graph_search(
    repo_path: String,
    query: String,
    node_type: Option<String>,
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(&repo_path))
        else {
            return serde_json::json!({ "hits": [] });
        };
        let Ok(graph) = graph.lock() else {
            return serde_json::json!({ "hits": [] });
        };
        let hits = graph.query().search(&query, node_type.as_deref(), 30);
        serde_json::json!({ "hits": hits })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "hits": [] }))
}

#[tauri::command]
pub async fn asset_graph_subgraph(
    repo_path: String,
    center: String,
    hops: Option<u32>,
    limit: Option<usize>,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(&repo_path))
        else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let Ok(graph) = graph.lock() else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let view = graph.query().subgraph(
            &center,
            hops.unwrap_or(2),
            limit.unwrap_or(150),
            time_range(from_ms, to_ms),
        );
        serde_json::json!({
            "center": view.center,
            "nodes": view.nodes,
            "edges": view.edges,
        })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "center": "", "nodes": [], "edges": [] }))
}

/// 按应用会话 id 反查会话节点 id：面板打开时相机飞到当前会话附近用。
/// 未挂载/未收录该会话时返回 null（前端回退到全图 fit）。
#[tauri::command]
pub async fn asset_graph_session_node(
    repo_path: String,
    session_id: String,
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(&repo_path))
        else {
            return serde_json::json!({ "nodeId": null });
        };
        let Ok(graph) = graph.lock() else {
            return serde_json::json!({ "nodeId": null });
        };
        serde_json::json!({ "nodeId": graph.query().session_focus_node_id(&session_id) })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "nodeId": null }))
}

#[tauri::command]
pub async fn asset_graph_sessions(repo_path: String, limit: Option<usize>) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(&repo_path))
        else {
            return serde_json::json!({ "sessions": [] });
        };
        let Ok(graph) = graph.lock() else {
            return serde_json::json!({ "sessions": [] });
        };
        serde_json::json!({ "sessions": graph.query().recent_sessions(limit.unwrap_or(20)) })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "sessions": [] }))
}

#[tauri::command]
pub async fn asset_graph_full(
    repo_path: String,
    limit: Option<usize>,
    compact: Option<bool>,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(&repo_path))
        else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let Ok(graph) = graph.lock() else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let view = graph.query().full_graph_with_mode(
            limit.unwrap_or(1000),
            compact.unwrap_or(true),
            time_range(from_ms, to_ms),
        );
        serde_json::json!({
            "center": view.center,
            "nodes": view.nodes,
            "edges": view.edges,
        })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "center": "", "nodes": [], "edges": [] }))
}

/// from/to 同时存在才构成过滤区间；缺任一视为不筛选（默认）。
fn time_range(from_ms: Option<i64>, to_ms: Option<i64>) -> Option<(i64, i64)> {
    match (from_ms, to_ms) {
        (Some(from), Some(to)) => Some((from.min(to), from.max(to))),
        _ => None,
    }
}

/// 抽取队列摘要：图谱顶栏「沉淀中」指示器；pending+claimed=0 时前端隐藏。
/// 未挂载时也会直接读记忆库，避免轮询总是看到空队列。
#[tauri::command]
pub async fn asset_graph_extraction_queue(repo_path: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let s = giteam_core::asset_graph::extraction_queue_summary(std::path::Path::new(&repo_path));
        serde_json::json!({
            "pending": s.pending,
            "claimed": s.claimed,
            "updatedAtMs": s.updated_at_ms,
        })
    })
    .await
    .unwrap_or_else(|_| {
        serde_json::json!({
            "pending": 0,
            "claimed": 0,
            "updatedAtMs": 0,
        })
    })
}

/// 手动触发存量回放（面板「重建索引」按钮；会话创建时也会自动增量回放）。
/// 用 reattach_repo 保留已挂载实例的语义抽取宿主，避免重建后抽取静默停止。
#[tauri::command]
pub async fn asset_graph_rebuild(repo_path: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        match giteam_core::asset_graph::reattach_repo(std::path::Path::new(&repo_path)) {
            Ok((indexed, skipped)) => {
                serde_json::json!({ "ok": true, "indexed": indexed, "unchanged": skipped })
            }
            Err(error) => serde_json::json!({ "ok": false, "error": error }),
        }
    })
    .await
    .unwrap_or_else(|error| serde_json::json!({ "ok": false, "error": error.to_string() }))
}
