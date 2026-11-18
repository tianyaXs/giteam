//! 工作区路径围栏：写/编辑类工具只允许触碰 repo 内路径；
//! bash 命令中的绝对/逃逸路径同样校验（系统可执行目录与 /dev 除外）。
//! 是否强制逃逸检查由 [`SandboxMode`] 决定（`DangerFullAccess` 跳过）。

use std::path::{Component, Path, PathBuf};

use super::sandbox_policy::{allows_path_escape, SandboxMode};

/// 将用户输入路径解析为绝对路径（相对 cwd 拼接），并按 mode 拒绝跳出工作区。
#[must_use]
pub fn resolve_within_workspace(
    cwd: &Path,
    raw: &str,
    mode: SandboxMode,
) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("path is empty".to_string());
    }
    let candidate = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        cwd.join(trimmed)
    };
    let normalized = normalize_path(&candidate);
    if allows_path_escape(mode) {
        return Ok(normalized);
    }
    let workspace = normalize_path(cwd);
    if !path_is_within(&normalized, &workspace) {
        return Err(format!(
            "path escapes workspace: {} (workspace {})",
            normalized.display(),
            workspace.display()
        ));
    }
    Ok(normalized)
}

/// 扫描 bash 命令中的路径 token：区外数据路径一律拒绝。
///
/// 允许：工作区内路径、相对路径（解析后仍在区内）、系统可执行目录、`/dev/*`、
/// 常见临时目录前缀（编译器/包管理器会用）。不试图完整解析 shell 语法，
/// 只抓绝对路径与 `..` 逃逸片段——与 read/write 围栏对齐的最小闭环。
/// `DangerFullAccess` 跳过扫描。
pub fn reject_shell_command_escaping_workspace(
    cwd: &Path,
    command: &str,
    mode: SandboxMode,
) -> Result<(), String> {
    if allows_path_escape(mode) {
        return Ok(());
    }
    let workspace = normalize_path(cwd);
    for token in shell_path_tokens(command) {
        if token_is_system_allowlisted(&token) {
            continue;
        }
        let candidate = if token.starts_with('~') {
            expand_tilde(&token)
        } else if Path::new(&token).is_absolute() {
            PathBuf::from(&token)
        } else if token.contains("..") {
            cwd.join(&token)
        } else {
            // 普通相对路径默认落在 cwd 下，交由 shell 执行；不在此拦截。
            continue;
        };
        let normalized = normalize_path(&candidate);
        if path_is_within(&normalized, &workspace) {
            continue;
        }
        return Err(format!(
            "path escapes workspace: {} (workspace {})",
            normalized.display(),
            workspace.display()
        ));
    }
    Ok(())
}

fn expand_tilde(token: &str) -> PathBuf {
    if token == "~" || token.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let rest = token.trim_start_matches('~').trim_start_matches('/');
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(token)
}

fn token_is_system_allowlisted(token: &str) -> bool {
    let path = if token.starts_with('~') {
        // home 下默认不放行（含 ~/.ssh）；仅当展开后落入其它 allow 前缀才行。
        let expanded = expand_tilde(token);
        return token_is_system_allowlisted(&expanded.to_string_lossy());
    } else {
        Path::new(token)
    };
    if !path.is_absolute() {
        return false;
    }
    const PREFIXES: &[&str] = &[
        "/bin/",
        "/sbin/",
        "/usr/bin/",
        "/usr/sbin/",
        "/usr/local/bin/",
        "/usr/local/sbin/",
        "/opt/homebrew/",
        "/opt/local/",
        "/Library/Developer/",
        "/System/",
        "/nix/",
        "/dev/",
        // 临时目录：mktemp、编译器、包管理器缓存常用。
        "/tmp/",
        "/var/tmp/",
        "/var/folders/",
        "/private/tmp/",
        "/private/var/folders/",
        "/private/var/tmp/",
    ];
    let text = path.to_string_lossy();
    // 精确命中目录根（无尾斜杠形式）。
    const EXACT: &[&str] = &[
        "/bin",
        "/sbin",
        "/usr/bin",
        "/usr/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/dev",
        "/tmp",
        "/var/tmp",
        "/private/tmp",
    ];
    if EXACT.iter().any(|p| text.as_ref() == *p) {
        return true;
    }
    PREFIXES.iter().any(|prefix| text.starts_with(prefix))
}

/// 粗粒度抽出命令里像路径的 token（去掉引号；按空白与常见分隔符切开）。
/// 同时扫描 token 内部嵌入的绝对路径（如 `python -c "open('/etc/shadow')"`）。
fn shell_path_tokens(command: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;
    let flush = |buf: &mut String, out: &mut Vec<String>| {
        let trimmed = buf.trim().trim_matches(|c| matches!(c, '"' | '\''));
        if !trimmed.is_empty() {
            // URL 整段跳过。
            if trimmed.contains("://") {
                buf.clear();
                return;
            }
            // `VAR=value` → 优先检查 value。
            let token = if let Some((_, value)) = trimmed.split_once('=') {
                if value.starts_with('/') || value.starts_with('~') || value.contains("..") {
                    value
                } else {
                    trimmed
                }
            } else {
                trimmed
            };
            if token.starts_with('/')
                || token.starts_with('~')
                || token.split('/').any(|part| part == "..")
            {
                out.push(token.to_string());
            }
            push_embedded_abs_paths(token, out);
        }
        buf.clear();
    };
    while let Some(ch) = chars.next() {
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                buf.push(ch);
            }
            continue;
        }
        match ch {
            '\'' | '"' => {
                quote = Some(ch);
            }
            ' ' | '\t' | '\n' | '\r' | ';' | '|' | '&' | '<' | '>' | '(' | ')' | '`' => {
                flush(&mut buf, &mut out);
            }
            _ => buf.push(ch),
        }
    }
    flush(&mut buf, &mut out);
    out
}

fn push_embedded_abs_paths(token: &str, out: &mut Vec<String>) {
    let bytes = token.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'/' {
            // 仅在「绝对路径起点」扫描：前面不是路径字符，避免把 `src/main.rs`
            // 里的 `/main.rs` 误判为绝对路径。
            let abs_start = i == 0 || !is_path_byte(bytes[i - 1]);
            if abs_start {
                let start = i;
                i += 1;
                while i < bytes.len() && is_path_byte(bytes[i]) {
                    i += 1;
                }
                if i > start + 1 {
                    let path = &token[start..i];
                    if !path.contains("://") {
                        out.push(path.to_string());
                    }
                }
                continue;
            }
        }
        i += 1;
    }
}

fn is_path_byte(b: u8) -> bool {
    matches!(
        b,
        b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'/'
            | b'.'
            | b'_'
            | b'-'
            | b'+'
            | b'%'
            | b'~'
    )
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix.as_os_str()),
            Component::RootDir => out.push(Component::RootDir.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = out.pop();
            }
            Component::Normal(part) => out.push(part),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

fn path_is_within(path: &Path, workspace: &Path) -> bool {
    if path == workspace {
        return true;
    }
    path.starts_with(workspace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_agent::sandbox_policy::SandboxMode;

    #[test]
    fn accepts_relative_and_absolute_inside_workspace() {
        let cwd = PathBuf::from("/repo/project");
        assert_eq!(
            resolve_within_workspace(&cwd, "src/main.rs", SandboxMode::WorkspaceWrite).unwrap(),
            PathBuf::from("/repo/project/src/main.rs")
        );
        assert_eq!(
            resolve_within_workspace(&cwd, "/repo/project/a.rs", SandboxMode::WorkspaceWrite)
                .unwrap(),
            PathBuf::from("/repo/project/a.rs")
        );
    }

    #[test]
    fn rejects_parent_escape_and_outside_absolute() {
        let cwd = PathBuf::from("/repo/project");
        assert!(
            resolve_within_workspace(&cwd, "../secret", SandboxMode::WorkspaceWrite).is_err()
        );
        assert!(
            resolve_within_workspace(&cwd, "/etc/passwd", SandboxMode::WorkspaceWrite).is_err()
        );
        assert!(
            resolve_within_workspace(&cwd, "/etc/passwd", SandboxMode::DangerFullAccess).is_ok()
        );
    }

    #[test]
    fn bash_rejects_etc_passwd_but_allows_system_bins_and_in_repo() {
        let cwd = PathBuf::from("/repo/project");
        let mode = SandboxMode::WorkspaceWrite;
        assert!(reject_shell_command_escaping_workspace(
            &cwd,
            "cat /etc/passwd | head -3",
            mode
        )
        .is_err());
        assert!(reject_shell_command_escaping_workspace(&cwd, "cargo test", mode).is_ok());
        assert!(
            reject_shell_command_escaping_workspace(&cwd, "/usr/bin/env bash -lc 'ls'", mode)
                .is_ok()
        );
        assert!(reject_shell_command_escaping_workspace(&cwd, "cat src/main.rs", mode).is_ok());
        assert!(reject_shell_command_escaping_workspace(
            &cwd,
            "cat /repo/project/README.md",
            mode
        )
        .is_ok());
        assert!(
            reject_shell_command_escaping_workspace(&cwd, "cat ../../etc/passwd", mode).is_err()
        );
        assert!(reject_shell_command_escaping_workspace(
            &cwd,
            "python -c \"open('/etc/shadow').read()\"",
            mode
        )
        .is_err());
        assert!(reject_shell_command_escaping_workspace(
            &cwd,
            "cat /etc/passwd",
            SandboxMode::DangerFullAccess
        )
        .is_ok());
    }

    #[test]
    fn bash_allows_tmp_and_dev_null() {
        let cwd = PathBuf::from("/repo/project");
        let mode = SandboxMode::WorkspaceWrite;
        assert!(
            reject_shell_command_escaping_workspace(&cwd, "echo hi > /tmp/out.txt", mode).is_ok()
        );
        assert!(reject_shell_command_escaping_workspace(&cwd, "cat /dev/null", mode).is_ok());
    }
}
