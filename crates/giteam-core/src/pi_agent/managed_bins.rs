//! Agent 私有工具二进制（rg / fd）。
//!
//! 对齐 OpenCode / pi coding-agent：系统 PATH 已有则复用；否则下载到
//! `~/.giteam/bin`（或 `$GITEAM_HOME/bin`）并注入进程 PATH，供 pi 的 grep/find
//! 与 bash 子进程解析。须在首次调用 grep/find **之前**完成（pi 内部 OnceLock
//! 会缓存探测结果）。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use super::secrets::ensure_data_dir;

/// 钉扎版本：可复现、避免 GitHub latest 漂移。
const RG_VERSION: &str = "14.1.1";
const FD_VERSION: &str = "10.2.0";

const USER_AGENT: &str = "giteam-agent-bins/1.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedBin {
    Rg,
    Fd,
}

impl ManagedBin {
    fn binary_name(self) -> &'static str {
        match self {
            Self::Rg => {
                if cfg!(windows) {
                    "rg.exe"
                } else {
                    "rg"
                }
            }
            Self::Fd => {
                if cfg!(windows) {
                    "fd.exe"
                } else {
                    "fd"
                }
            }
        }
    }

    fn system_names(self) -> &'static [&'static str] {
        match self {
            Self::Rg => &["rg", "ripgrep"],
            Self::Fd => &["fd", "fdfind"],
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Rg => "ripgrep",
            Self::Fd => "fd",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinEnsureReport {
    pub name: String,
    pub source: BinSource,
    pub path: Option<PathBuf>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinSource {
    System,
    Managed,
    Missing,
}

/// `~/.giteam/bin`（或 `$GITEAM_HOME/bin`）。
#[must_use]
pub fn agent_bin_dir() -> Option<PathBuf> {
    ensure_data_dir().map(|dir| dir.join("bin"))
}

/// 确保 rg/fd 可用，并把私有 bin 目录前置到进程 PATH（幂等）。
///
/// 桌面 setup / service 初始化应尽早调用。下载失败不致命：返回报告即可。
pub fn ensure_agent_bins() -> Vec<BinEnsureReport> {
    let reports: Vec<BinEnsureReport> = [ManagedBin::Rg, ManagedBin::Fd]
        .into_iter()
        .map(ensure_one)
        .collect();
    prepend_agent_bin_to_path();
    reports
}

/// 仅把已存在的私有 bin 目录注入 PATH（不做下载）。
pub fn prepend_agent_bin_to_path() {
    let Some(bin) = agent_bin_dir() else {
        return;
    };
    if !bin.is_dir() {
        return;
    }
    let bin_str = bin.to_string_lossy();
    let sep = if cfg!(windows) { ';' } else { ':' };
    let current = std::env::var_os("PATH").unwrap_or_default();
    let current_str = current.to_string_lossy();
    let already = std::env::split_paths(&current).any(|p| p == bin);
    if already {
        return;
    }
    let mut new_path = String::with_capacity(bin_str.len() + current_str.len() + 1);
    new_path.push_str(&bin_str);
    if !current_str.is_empty() {
        new_path.push(sep);
        new_path.push_str(&current_str);
    }
    std::env::set_var("PATH", new_path);
}

fn ensure_one(bin: ManagedBin) -> BinEnsureReport {
    let name = bin.display_name().to_string();

    if let Some(path) = find_system(bin) {
        return BinEnsureReport {
            name,
            source: BinSource::System,
            path: Some(path),
            error: None,
        };
    }

    let Some(dir) = agent_bin_dir() else {
        return BinEnsureReport {
            name,
            source: BinSource::Missing,
            path: None,
            error: Some("cannot resolve Giteam data directory".into()),
        };
    };
    if let Err(err) = fs::create_dir_all(&dir) {
        return BinEnsureReport {
            name,
            source: BinSource::Missing,
            path: None,
            error: Some(format!("create bin dir: {err}")),
        };
    }

    let target = dir.join(bin.binary_name());
    if binary_works(&target) {
        return BinEnsureReport {
            name,
            source: BinSource::Managed,
            path: Some(target),
            error: None,
        };
    }

    if offline_mode() {
        return BinEnsureReport {
            name,
            source: BinSource::Missing,
            path: None,
            error: Some("offline mode: skip download".into()),
        };
    }

    match download_and_install(bin, &dir, &target) {
        Ok(()) => BinEnsureReport {
            name,
            source: BinSource::Managed,
            path: Some(target),
            error: None,
        },
        Err(err) => BinEnsureReport {
            name,
            source: BinSource::Missing,
            path: None,
            error: Some(err),
        },
    }
}

fn offline_mode() -> bool {
    matches!(
        std::env::var("GITEAM_OFFLINE")
            .or_else(|_| std::env::var("PI_OFFLINE"))
            .ok()
            .as_deref(),
        Some("1" | "true" | "TRUE" | "yes" | "YES")
    )
}

fn find_system(bin: ManagedBin) -> Option<PathBuf> {
    for name in bin.system_names() {
        if let Ok(path) = which::which(name) {
            if binary_works(&path) {
                return Some(path);
            }
        }
        // GUI 冷启动 PATH 可能不完整；再试裸命令名。
        if binary_works(Path::new(name)) {
            return which::which(name).ok().or_else(|| Some(PathBuf::from(name)));
        }
    }
    None
}

fn binary_works(path: &Path) -> bool {
    if path.components().count() > 1 && !path.is_file() {
        return false;
    }
    Command::new(path)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn download_and_install(bin: ManagedBin, bin_dir: &Path, target: &Path) -> Result<(), String> {
    let (url, archive_name) = release_asset(bin)?;
    let archive_path = bin_dir.join(&archive_name);
    let extract_dir = bin_dir.join(format!(".extract-{}-{}", bin.display_name(), std::process::id()));

    download_file(&url, &archive_path)?;
    let _ = fs::remove_dir_all(&extract_dir);
    fs::create_dir_all(&extract_dir).map_err(|e| format!("extract dir: {e}"))?;

    let extract_result = extract_archive(&archive_path, &extract_dir, &archive_name);
    let _ = fs::remove_file(&archive_path);
    extract_result?;

    let found = find_file_named(&extract_dir, bin.binary_name())
        .ok_or_else(|| format!("binary {} not found in archive", bin.binary_name()))?;

    if target.exists() {
        let _ = fs::remove_file(target);
    }
    fs::copy(&found, target).map_err(|e| format!("install {}: {e}", bin.binary_name()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(target, fs::Permissions::from_mode(0o755));
    }
    let _ = fs::remove_dir_all(&extract_dir);

    if !binary_works(target) {
        let _ = fs::remove_file(target);
        return Err(format!("installed {} failed --version", bin.binary_name()));
    }
    Ok(())
}

fn release_asset(bin: ManagedBin) -> Result<(String, String), String> {
    let (os, arch) = platform_key()?;
    match bin {
        ManagedBin::Rg => {
            let (triple, ext) = match (os, arch) {
                ("darwin", "aarch64") => ("aarch64-apple-darwin", "tar.gz"),
                ("darwin", "x86_64") => ("x86_64-apple-darwin", "tar.gz"),
                ("linux", "aarch64") => ("aarch64-unknown-linux-gnu", "tar.gz"),
                ("linux", "x86_64") => ("x86_64-unknown-linux-musl", "tar.gz"),
                ("windows", "aarch64") => ("aarch64-pc-windows-msvc", "zip"),
                ("windows", "x86_64") => ("x86_64-pc-windows-msvc", "zip"),
                _ => return Err(format!("unsupported platform for rg: {os}-{arch}")),
            };
            let name = format!("ripgrep-{RG_VERSION}-{triple}.{ext}");
            let url = format!(
                "https://github.com/BurntSushi/ripgrep/releases/download/{RG_VERSION}/{name}"
            );
            Ok((url, name))
        }
        ManagedBin::Fd => {
            let (triple, ext) = match (os, arch) {
                ("darwin", "aarch64") => ("aarch64-apple-darwin", "tar.gz"),
                ("darwin", "x86_64") => ("x86_64-apple-darwin", "tar.gz"),
                ("linux", "aarch64") => ("aarch64-unknown-linux-gnu", "tar.gz"),
                ("linux", "x86_64") => ("x86_64-unknown-linux-gnu", "tar.gz"),
                ("windows", "aarch64") => ("aarch64-pc-windows-msvc", "zip"),
                ("windows", "x86_64") => ("x86_64-pc-windows-msvc", "zip"),
                _ => return Err(format!("unsupported platform for fd: {os}-{arch}")),
            };
            let name = format!("fd-v{FD_VERSION}-{triple}.{ext}");
            let url = format!(
                "https://github.com/sharkdp/fd/releases/download/v{FD_VERSION}/{name}"
            );
            Ok((url, name))
        }
    }
}

fn platform_key() -> Result<(&'static str, &'static str), String> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(windows) {
        "windows"
    } else {
        return Err(format!("unsupported OS: {}", std::env::consts::OS));
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => return Err(format!("unsupported arch: {other}")),
    };
    Ok((os, arch))
}

fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    });
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("download {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download {url}: HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("download body: {e}"))?;
    if bytes.is_empty() {
        return Err(format!("download {url}: empty body"));
    }
    let tmp = dest.with_extension(" partial");
    {
        let mut file = fs::File::create(&tmp).map_err(|e| format!("create temp: {e}"))?;
        file.write_all(&bytes).map_err(|e| format!("write temp: {e}"))?;
    }
    fs::rename(&tmp, dest).map_err(|e| format!("finalize download: {e}"))?;
    Ok(())
}

fn extract_archive(archive: &Path, dest: &Path, archive_name: &str) -> Result<(), String> {
    let status = if archive_name.ends_with(".zip") {
        #[cfg(windows)]
        let tar = windows_tar();
        #[cfg(not(windows))]
        let tar = "tar";
        Command::new(tar)
            .args(["xf", &archive.to_string_lossy(), "-C", &dest.to_string_lossy()])
            .status()
    } else {
        Command::new("tar")
            .args([
                "xzf",
                &archive.to_string_lossy(),
                "-C",
                &dest.to_string_lossy(),
            ])
            .status()
    }
    .map_err(|e| format!("extract {archive_name}: {e}"))?;
    if !status.success() {
        return Err(format!("extract {archive_name}: exit {status}"));
    }
    Ok(())
}

#[cfg(windows)]
fn windows_tar() -> String {
    if let Ok(root) = std::env::var("SystemRoot").or_else(|_| std::env::var("WINDIR")) {
        let candidate = PathBuf::from(root).join("System32").join("tar.exe");
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    "tar.exe".into()
}

fn find_file_named(root: &Path, file_name: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if entry.file_name() == file_name {
                return Some(path);
            }
        }
    }
    None
}

/// 供 `command_runner` 等拼 PATH 时插入私有 bin（若存在）。
#[must_use]
pub fn agent_bin_dir_string() -> Option<String> {
    let dir = agent_bin_dir()?;
    dir.is_dir().then(|| dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_asset_urls_are_well_formed() {
        let (url, name) = release_asset(ManagedBin::Rg).expect("rg asset");
        assert!(url.contains("BurntSushi/ripgrep"));
        assert!(name.starts_with("ripgrep-"));
        let (url, name) = release_asset(ManagedBin::Fd).expect("fd asset");
        assert!(url.contains("sharkdp/fd"));
        assert!(name.starts_with("fd-v"));
    }

    #[test]
    fn binary_names_match_platform() {
        if cfg!(windows) {
            assert_eq!(ManagedBin::Rg.binary_name(), "rg.exe");
            assert_eq!(ManagedBin::Fd.binary_name(), "fd.exe");
        } else {
            assert_eq!(ManagedBin::Rg.binary_name(), "rg");
            assert_eq!(ManagedBin::Fd.binary_name(), "fd");
        }
    }
}
