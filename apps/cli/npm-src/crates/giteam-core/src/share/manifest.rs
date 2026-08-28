use serde::{Deserialize, Serialize};

/// P2：代码与上下文分存（`git+context`）。
pub const MANIFEST_SCHEMA_VERSION: u32 = 2;

/// 分享产物内的清单文件（位于 `context.tar.zst` 根目录的 `manifest.json`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareManifest {
    pub schema_version: u32,
    #[serde(default)]
    pub share_id: String,
    pub created_at: String,
    pub source: ShareSourceInfo,
    pub repo: ShareRepoInfo,
    pub context: ShareContextInfo,
    pub package: SharePackageInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSourceInfo {
    pub app: String,
    pub version: String,
    pub os: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRepoInfo {
    pub name: String,
    pub default_branch: String,
    pub head_commit: String,
    #[serde(default)]
    pub upstream_url: String,
    pub bundle_refs: Vec<String>,
    /// 导出端仓库绝对路径，导入端做字符串级路径重写的依据（不是安全边界）。
    pub origin_path_hint: String,
    /// 是否存在未提交变更（bundle 不含 working tree，仅提示）。
    #[serde(default)]
    pub dirty_worktree: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareContextInfo {
    pub session_count: usize,
    #[serde(default)]
    pub session_files: Vec<String>,
    /// 导出端会话目录绝对路径（`~/.giteam/pi-sessions/repos/<oldKey>/`），
    /// 导入端据此重写 memory.db `replay_state.path`。
    #[serde(default)]
    pub sessions_dir_hint: String,
    #[serde(default)]
    pub has_catalog: bool,
    #[serde(default)]
    pub has_memory_db: bool,
    #[serde(default)]
    pub has_attachments: bool,
    #[serde(default)]
    pub review_record_count: usize,
    #[serde(default)]
    pub redactions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageInfo {
    /// `git+context`：代码走 repo.git / repo.bundle，上下文为独立 tar.zst。
    pub format: String,
    /// 代码包（repo.bundle）sha256。
    pub sha256: String,
    /// 代码包字节数。
    pub size_bytes: u64,
    /// 上下文包（含 manifest）sha256。
    #[serde(default)]
    pub context_sha256: String,
    /// 上下文包字节数。
    #[serde(default)]
    pub context_size_bytes: u64,
    /// P1/P2 恒为 false；E2E 加密（密钥在 URL fragment）属 P3。
    pub encrypted: bool,
}

impl ShareManifest {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let manifest: ShareManifest =
            serde_json::from_slice(bytes).map_err(|e| format!("manifest parse failed: {e}"))?;
        if manifest.schema_version != MANIFEST_SCHEMA_VERSION && manifest.schema_version != 1 {
            return Err(format!(
                "unsupported manifest schemaVersion {} (expect {MANIFEST_SCHEMA_VERSION} or 1)",
                manifest.schema_version
            ));
        }
        Ok(manifest)
    }

    #[must_use]
    pub fn is_split_layout(&self) -> bool {
        self.package.format == "git+context"
            || self.schema_version >= 2
            || !self.package.context_sha256.is_empty()
    }
}
