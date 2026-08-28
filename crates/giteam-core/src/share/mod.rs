//! 项目分享（Project Share）P2：代码走云端 git remote，上下文独立上传。
//!
//! 设计文档：`docs/superpowers/specs/2026-08-26-project-share-design.md`。
//!
//! - 导出：`git bundle` 与上下文包（会话 / 记忆 / 附件 / review）分别分块上传；
//!   Gateway finalize 后物化 bare `repo.git`（dumb-HTTP），返回 `https://<cloud>/s/<shareId>`。
//! - 导入：`git clone` 云端 remote（失败则回退 bundle）+ 下载上下文 → rekey →
//!   注册进 `~/.giteam/client.db`。
//!
//! 安全边界：收集器只扫 `~/.giteam` 与 `<repo>/.giteam`，绝不打包
//! `client.db` 整库、`pi-agent/` 凭据、`updater.key`；平台目录下的
//! `cloud-link.json` / `control-auth.json` 天然不在收集范围内。

mod client;
mod export;
mod import;
mod manifest;
mod pack;
mod redact;

pub use client::{
    create_share_record, download_share, download_share_artifact,
    download_share_artifact_with_progress, fetch_share_meta, finalize_share, list_shares,
    parse_share_url, revoke_share, upload_share_parts, CreateShareRequest, ShareMeta,
};
pub use export::{create_share, export_package, ExportOptions, ExportOutcome, ShareCreated};
pub use import::{
    import_share, ImportCancelFlag, ImportOptions, ImportOutcome, ImportProgress,
    ImportProgressHook,
};
pub use manifest::{ShareManifest, SharePackageInfo, ShareRepoInfo, MANIFEST_SCHEMA_VERSION};
pub use redact::{redact_text, RedactionStats};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ShareError {
    #[error("已取消")]
    Cancelled,
    #[error("{0}")]
    InvalidInput(String),
    #[error("不是 Git 仓库，无法分享：{0}（请先在该目录 git init 并至少提交一次）")]
    NotARepo(String),
    #[error("cloud link incomplete: {0}")]
    CloudLink(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("package error: {0}")]
    Package(String),
    #[error("git error: {0}")]
    Git(String),
    #[error("persistence error: {0}")]
    Persistence(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type ShareResult<T> = Result<T, ShareError>;

/// 上传分块大小（≤ Gateway 8MiB body 上限，留出余量）。
pub const UPLOAD_PART_SIZE: usize = 4 * 1024 * 1024;
