//! 统一文件效果策略（对齐 dsh SandboxMode）。
//!
//! 本模块只定义策略与模型可见文案；执行层（path_guard / bash）按 mode 决定
//! 是否强制工作区围栏。OS 级 sandbox（Seatbelt/bwrap）另开。

use std::path::{Path, PathBuf};

/// 文件效果模式：与 dsh 词汇对齐。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SandboxMode {
    /// 围栏内只读：文件写/编辑工具拒绝；bash 仍受工作区路径扫描约束。
    ReadOnly,
    /// 默认可写工作区，拒绝区外数据路径。
    #[default]
    WorkspaceWrite,
    /// 不强制路径逃逸检查（测试 / 显式放开入口）。
    DangerFullAccess,
}

/// 单次执行解析出的完整策略。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxExecutionPolicy {
    pub mode: SandboxMode,
    pub workspace_root: PathBuf,
}

impl SandboxExecutionPolicy {
    #[must_use]
    pub fn allows_path_escape(&self) -> bool {
        allows_path_escape(self.mode)
    }

    #[must_use]
    pub fn allows_file_writes(&self) -> bool {
        allows_file_writes(self.mode)
    }

    #[must_use]
    pub fn model_facing_text(&self) -> String {
        model_facing_text(self)
    }
}

/// 默认模式：`WorkspaceWrite`（与现网「区内可写、区外拒绝」一致）。
#[must_use]
pub fn default_mode() -> SandboxMode {
    SandboxMode::WorkspaceWrite
}

#[must_use]
pub fn allows_path_escape(mode: SandboxMode) -> bool {
    matches!(mode, SandboxMode::DangerFullAccess)
}

#[must_use]
pub fn allows_file_writes(mode: SandboxMode) -> bool {
    !matches!(mode, SandboxMode::ReadOnly)
}

/// 用会话 cwd 解析策略；本切片无 per-session 覆盖，固定默认 mode。
#[must_use]
pub fn resolve(session_cwd: &Path) -> SandboxExecutionPolicy {
    resolve_with_mode(session_cwd, default_mode())
}

#[must_use]
pub fn resolve_with_mode(session_cwd: &Path, mode: SandboxMode) -> SandboxExecutionPolicy {
    SandboxExecutionPolicy {
        mode,
        workspace_root: session_cwd.to_path_buf(),
    }
}

/// 模型可见策略段（进 runtime snapshot，不进 system）。
#[must_use]
pub fn model_facing_text(policy: &SandboxExecutionPolicy) -> String {
    let root = policy.workspace_root.display();
    match policy.mode {
        SandboxMode::ReadOnly => format!(
            "Current Giteam file policy: read-only. File write/edit tools cannot modify files \
             under this standing mode. Workspace root: \"{root}\". Do not refuse a required \
             modification from this policy alone: try an available tool normally and follow any \
             denial guidance it returns."
        ),
        SandboxMode::WorkspaceWrite => format!(
            "Current Giteam file policy: workspace-write. File and shell operations may modify \
             files under the session workspace: \"{root}\". Paths outside the workspace are denied. \
             Some platform temporary areas may also be reachable from shell."
        ),
        SandboxMode::DangerFullAccess => format!(
            "Current Giteam file policy: danger-full-access. Workspace path confinement is not \
             enforced for this session (workspace recorded as \"{root}\")."
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_workspace_write() {
        let policy = resolve(Path::new("/repo/project"));
        assert_eq!(policy.mode, SandboxMode::WorkspaceWrite);
        assert_eq!(policy.workspace_root, PathBuf::from("/repo/project"));
        assert!(!policy.allows_path_escape());
        assert!(policy.allows_file_writes());
    }

    #[test]
    fn escape_only_under_danger() {
        assert!(!allows_path_escape(SandboxMode::ReadOnly));
        assert!(!allows_path_escape(SandboxMode::WorkspaceWrite));
        assert!(allows_path_escape(SandboxMode::DangerFullAccess));
        assert!(!allows_file_writes(SandboxMode::ReadOnly));
        assert!(allows_file_writes(SandboxMode::WorkspaceWrite));
        assert!(allows_file_writes(SandboxMode::DangerFullAccess));
    }

    #[test]
    fn model_text_is_stable_per_mode() {
        let root = Path::new("/repo/project");
        let ro = resolve_with_mode(root, SandboxMode::ReadOnly).model_facing_text();
        let ww = resolve_with_mode(root, SandboxMode::WorkspaceWrite).model_facing_text();
        let danger = resolve_with_mode(root, SandboxMode::DangerFullAccess).model_facing_text();
        assert!(ro.contains("read-only"));
        assert!(ro.contains("/repo/project"));
        assert!(ww.contains("workspace-write"));
        assert!(ww.contains("/repo/project"));
        assert!(danger.contains("danger-full-access"));
        assert_eq!(
            resolve_with_mode(root, SandboxMode::WorkspaceWrite).model_facing_text(),
            ww
        );
    }
}
