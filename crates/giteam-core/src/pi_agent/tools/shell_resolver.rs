//! 跨平台默认 shell 解析。统一解决 Windows 上 pi 的 bash 工具与 giteam 后台
//! shell 都硬编码找 Unix bash、回落 `"sh"`，而 `"sh"` 在 Windows 不存在导致的
//! `Failed to spawn shell: program not found`。
//!
//! 探测优先级：
//! - Unix：`$SHELL` → `/bin/bash` → `/usr/bin/bash` → `/bin/sh` → `/usr/bin/sh`
//! - Windows：`bash`（Git Bash / WSL git，POSIX 兼容，pi 前台 bash 的 `trap`/`-c`
//!   能直接跑）→ `pwsh` → `powershell` → `%COMSPEC%` → `cmd.exe`
//!
//! `background`（后台 `run_in_background`）与 `GiteamBashTool::new`（前台注入
//! pi `BashTool`）复用本模块。

use std::path::Path;

/// 解析当前平台默认可用的 shell 绝对路径。返回 `None` 表示未探到（调用方回落）。
pub fn resolve_default_shell() -> Option<String> {
    #[cfg(unix)]
    {
        let candidates: [Option<String>; 5] = [
            std::env::var("SHELL").ok().filter(|s| !s.is_empty()),
            Some("/bin/bash".to_string()),
            Some("/usr/bin/bash".to_string()),
            Some("/bin/sh".to_string()),
            Some("/usr/bin/sh".to_string()),
        ];
        candidates
            .into_iter()
            .flatten()
            .find(|p| Path::new(p).exists())
    }
    #[cfg(windows)]
    {
        // 优先 bash（POSIX 兼容，pi 前台 run_bash_command 的 trap + -c 可直接跑），
        // 再 PowerShell，最后 cmd。which 按 PATHEXT 解析，传不带后缀的名字即可。
        for exe in ["bash", "sh", "pwsh", "powershell"] {
            if let Ok(path) = which::which(exe) {
                return Some(path.to_string_lossy().into_owned());
            }
        }
        // %COMSPEC% 通常是 cmd.exe 的绝对路径。
        if let Some(comspec) = std::env::var("COMSPEC").ok().filter(|s| !s.is_empty()) {
            if Path::new(&comspec).exists() {
                return Some(comspec);
            }
        }
        Some("cmd.exe".to_string())
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellKind {
    /// bash / sh / 未知 → 按 POSIX 处理（`-c` + 兼容 trap / command_prefix）。
    Bash,
    Cmd,
    PowerShell,
}

fn shell_kind(shell: &str) -> ShellKind {
    let stem = Path::new(shell)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match stem.as_str() {
        "cmd" => ShellKind::Cmd,
        "powershell" | "pwsh" => ShellKind::PowerShell,
        _ => ShellKind::Bash,
    }
}

/// 是否 POSIX 兼容（bash/sh）。决定是否拼接 `command_prefix`（如 `set -euo pipefail`）
/// 与 pi 的 `trap`——cmd/powershell 不兼容这些语法，必须跳过，否则整条命令变语法错。
pub fn is_bash_like(shell: &str) -> bool {
    matches!(shell_kind(shell), ShellKind::Bash)
}

/// 按 shell 类型返回执行单条脚本的 argv 前缀（调用方再 `.arg(script)`）。
/// - bash/sh：`["-c"]`
/// - cmd：`["/C"]`
/// - powershell/pwsh：`["-NoProfile", "-Command"]`
pub fn shell_invoke_args(shell: &str) -> &'static [&'static str] {
    match shell_kind(shell) {
        ShellKind::Cmd => &["/C"],
        ShellKind::PowerShell => &["-NoProfile", "-Command"],
        ShellKind::Bash => &["-c"],
    }
}
