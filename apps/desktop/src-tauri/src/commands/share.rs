//! 项目分享 Tauri 命令：包装 giteam-core share 模块（导出上传 / 导入初始化）。

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// 冷启动深链可能早于前端挂载；暂存最近一次 `giteam://import…` 供前端拉取。
static PENDING_IMPORT_URL: Mutex<Option<String>> = Mutex::new(None);

/// 当前进行中的导入取消标志。
static ACTIVE_IMPORT_CANCEL: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

pub fn stash_pending_import_url(url: String) {
    if let Ok(mut slot) = PENDING_IMPORT_URL.lock() {
        *slot = Some(url);
    }
}

/// 取出并清空冷启动深链（前端挂载后调用一次）。
#[tauri::command]
pub fn share_take_pending_import() -> Option<String> {
    PENDING_IMPORT_URL.lock().ok().and_then(|mut slot| slot.take())
}

/// 取消正在进行的分享导入（若无进行中任务则为空操作）。
#[tauri::command]
pub fn share_import_cancel() {
    if let Ok(guard) = ACTIVE_IMPORT_CANCEL.lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareCreateResult {
    share_id: String,
    share_url: String,
    git_url: String,
    /// 代码 + 上下文合计。
    size_bytes: u64,
    repo_size_bytes: u64,
    context_size_bytes: u64,
    sessions: usize,
    memory: bool,
    attachments: bool,
    reviews: usize,
    redactions: u64,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareImportResult {
    target_dir: String,
    repo_name: String,
    sessions_imported: usize,
    catalog_records_merged: usize,
    memory_imported: bool,
    attachments_imported: u64,
    reviews_imported: usize,
    warnings: Vec<String>,
}

/// 导出当前项目快照并上传到云端，返回分享地址。
#[tauri::command]
pub async fn share_create(repo_path: String) -> Result<ShareCreateResult, String> {
    if repo_path.trim().is_empty() {
        return Err("repo path is empty".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let opts = giteam_core::share::ExportOptions::default();
        giteam_core::share::create_share(std::path::Path::new(&repo_path), &opts)
    })
    .await
    .map_err(|e| format!("share task failed: {e}"))?
    .map(|created| {
        let repo = created.manifest.package.size_bytes;
        let context = created.manifest.package.context_size_bytes;
        ShareCreateResult {
            share_id: created.share_id,
            share_url: created.share_url,
            git_url: created.git_url,
            size_bytes: repo.saturating_add(context),
            repo_size_bytes: repo,
            context_size_bytes: context,
            sessions: created.manifest.context.session_count,
            memory: created.manifest.context.has_memory_db,
            attachments: created.manifest.context.has_attachments,
            reviews: created.manifest.context.review_record_count,
            redactions: created.manifest.context.redactions,
            warnings: created.warnings,
        }
    })
    .map_err(|e: giteam_core::share::ShareError| e.to_string())
}

/// 凭分享地址导入项目（下载 → clone → rekey → 注册）。
/// 进度经 `giteam://share-import-progress` 事件推送；可用 `share_import_cancel` 取消。
#[tauri::command]
pub async fn share_import(
    app: AppHandle,
    url: String,
    dir: Option<String>,
    attach: Option<String>,
    name: Option<String>,
) -> Result<ShareImportResult, String> {
    if url.trim().is_empty() {
        return Err("share url is empty".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut slot) = ACTIVE_IMPORT_CANCEL.lock() {
        *slot = Some(Arc::clone(&cancel));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let app_for_progress = app.clone();
        let on_progress: giteam_core::share::ImportProgressHook = Arc::new(move |progress| {
            let _ = app_for_progress.emit("giteam://share-import-progress", progress);
        });
        let opts = giteam_core::share::ImportOptions {
            dir: dir.map(PathBuf::from),
            attach: attach.map(PathBuf::from),
            name,
            on_progress: Some(on_progress),
            cancel: Some(cancel),
        };
        giteam_core::share::import_share(&url, &opts)
    })
    .await;
    if let Ok(mut slot) = ACTIVE_IMPORT_CANCEL.lock() {
        *slot = None;
    }
    result
        .map_err(|e| format!("import task failed: {e}"))?
        .map(|outcome| ShareImportResult {
            target_dir: outcome.target_dir.to_string_lossy().to_string(),
            repo_name: outcome.repo_name,
            sessions_imported: outcome.sessions_imported,
            catalog_records_merged: outcome.catalog_records_merged,
            memory_imported: outcome.memory_imported,
            attachments_imported: outcome.attachments_imported,
            reviews_imported: outcome.reviews_imported,
            warnings: outcome.warnings,
        })
        .map_err(|e: giteam_core::share::ShareError| e.to_string())
}
