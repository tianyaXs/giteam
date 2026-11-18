//! 用户可见权限预设（对齐 dsh permission-presets）。
//!
//! 每个预设同时绑定 `SandboxMode` 与 `auto_approve`（approval ask/never）。

use super::sandbox_policy::{default_mode, SandboxMode};

/// Composer / 设置暴露的三档预设。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PermissionPreset {
    /// 工作区可写 + 敏感操作需审批。
    #[default]
    Default,
    /// 工作区可写 + 自动放行审批。
    AutoReview,
    /// 放开工作区围栏 + 自动放行审批。
    FullAccess,
}

/// 预设对应的执行旋钮。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermissionPresetSpec {
    pub sandbox: SandboxMode,
    pub auto_approve: bool,
}

impl PermissionPreset {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::AutoReview => "auto_review",
            Self::FullAccess => "full_access",
        }
    }

    /// 解析预设 id；兼容 Deep Agent / 旧调用的 `auto` / `full`。
    #[must_use]
    pub fn parse(input: &str) -> Option<Self> {
        match input.trim().to_ascii_lowercase().as_str() {
            "default" | "workspace-write" | "workspace_write" => Some(Self::Default),
            "auto" | "auto_review" | "auto-review" => Some(Self::AutoReview),
            "full" | "full_access" | "full-access" | "danger-full-access" | "danger_full_access" => {
                Some(Self::FullAccess)
            }
            _ => None,
        }
    }

    #[must_use]
    pub fn spec(self) -> PermissionPresetSpec {
        match self {
            Self::Default => PermissionPresetSpec {
                sandbox: default_mode(),
                auto_approve: false,
            },
            Self::AutoReview => PermissionPresetSpec {
                sandbox: SandboxMode::WorkspaceWrite,
                auto_approve: true,
            },
            Self::FullAccess => PermissionPresetSpec {
                sandbox: SandboxMode::DangerFullAccess,
                auto_approve: true,
            },
        }
    }

    /// 由当前旋钮反推预设；无法匹配时退回 Default。
    #[must_use]
    pub fn from_knobs(sandbox: SandboxMode, auto_approve: bool) -> Self {
        if sandbox == SandboxMode::DangerFullAccess && auto_approve {
            return Self::FullAccess;
        }
        if sandbox == SandboxMode::WorkspaceWrite && auto_approve {
            return Self::AutoReview;
        }
        if sandbox == SandboxMode::WorkspaceWrite && !auto_approve {
            return Self::Default;
        }
        Self::Default
    }

    /// `set_auto_approve(true/false)` 在 Default↔AutoReview 间切换时使用；
    /// 已处于 FullAccess 时保持 FullAccess（仅改 auto 不会降级 sandbox）。
    #[must_use]
    pub fn with_auto_approve(self, enabled: bool) -> Self {
        match (self, enabled) {
            (Self::FullAccess, true) => Self::FullAccess,
            (Self::FullAccess, false) => Self::Default,
            (_, true) => Self::AutoReview,
            (_, false) => Self::Default,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_aliases() {
        assert_eq!(PermissionPreset::parse("default"), Some(PermissionPreset::Default));
        assert_eq!(PermissionPreset::parse("auto"), Some(PermissionPreset::AutoReview));
        assert_eq!(PermissionPreset::parse("full"), Some(PermissionPreset::FullAccess));
        assert_eq!(
            PermissionPreset::parse("danger-full-access"),
            Some(PermissionPreset::FullAccess)
        );
        assert_eq!(PermissionPreset::parse("nope"), None);
    }

    #[test]
    fn specs_match_dsh_style_bundles() {
        let def = PermissionPreset::Default.spec();
        assert_eq!(def.sandbox, SandboxMode::WorkspaceWrite);
        assert!(!def.auto_approve);

        let auto = PermissionPreset::AutoReview.spec();
        assert_eq!(auto.sandbox, SandboxMode::WorkspaceWrite);
        assert!(auto.auto_approve);

        let full = PermissionPreset::FullAccess.spec();
        assert_eq!(full.sandbox, SandboxMode::DangerFullAccess);
        assert!(full.auto_approve);
    }

    #[test]
    fn auto_approve_toggle_does_not_invent_full() {
        assert_eq!(
            PermissionPreset::Default.with_auto_approve(true),
            PermissionPreset::AutoReview
        );
        assert_eq!(
            PermissionPreset::AutoReview.with_auto_approve(false),
            PermissionPreset::Default
        );
        assert_eq!(
            PermissionPreset::FullAccess.with_auto_approve(true),
            PermissionPreset::FullAccess
        );
        assert_eq!(
            PermissionPreset::FullAccess.with_auto_approve(false),
            PermissionPreset::Default
        );
    }
}
