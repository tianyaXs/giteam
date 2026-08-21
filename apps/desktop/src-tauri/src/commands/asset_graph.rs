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
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(&repo_path))
        else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let Ok(graph) = graph.lock() else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let view = graph
            .query()
            .subgraph(&center, hops.unwrap_or(2), limit.unwrap_or(150));
        serde_json::json!({
            "center": view.center,
            "nodes": view.nodes,
            "edges": view.edges,
        })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "center": "", "nodes": [], "edges": [] }))
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
) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(graph) = giteam_core::asset_graph::attached(std::path::Path::new(&repo_path))
        else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let Ok(graph) = graph.lock() else {
            return serde_json::json!({ "center": "", "nodes": [], "edges": [] });
        };
        let view = graph
            .query()
            .full_graph_with_mode(limit.unwrap_or(1000), compact.unwrap_or(true));
        serde_json::json!({
            "center": view.center,
            "nodes": view.nodes,
            "edges": view.edges,
        })
    })
    .await
    .unwrap_or_else(|_| serde_json::json!({ "center": "", "nodes": [], "edges": [] }))
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
