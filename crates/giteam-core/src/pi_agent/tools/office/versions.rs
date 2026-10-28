//! office 文件版本栈：写/改落盘前自动快照上一版，支持一键回退。
//!
//! **磁盘持久化**：快照存于 `<giteam 数据根>/office-versions/<sha256(绝对路径)>/`，
//! 每文件保留最近 [`MAX_VERSIONS_PER_FILE`] 版（v1.bin…vN.bin + index.json）。
//! 进程重启后依然可恢复。恢复采用「交换」语义：栈顶（修改前内容）写回磁盘，
//! 当前内容压回栈中——连续恢复在相邻历史版本间往返，兼具 undo/redo。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 每文件保留的历史版本数。
const MAX_VERSIONS_PER_FILE: usize = 5;
/// 版本栈全局预算（DSH 检查点式设计：有界存储，超限按最旧优先逐出）。
const STORE_BUDGET_BYTES: u64 = 512 * 1024 * 1024;

/// 全局预算 LRU：所有文件的版本镜像总大小超限时，按 savedAt 最旧逐出单个版本，
/// 直至回到预算内（版本栈共享额度，防无限增长）。
fn enforce_store_budget(base: &Path) {
    fn version_files(base: &Path) -> Vec<(PathBuf, u64, u64)> {
        // (版本文件路径, savedAtMs, 大小)
        let mut out = Vec::new();
        let Ok(sessions) = std::fs::read_dir(base) else { return out };
        for dir in sessions.flatten() {
            let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
            for file in files.flatten() {
                let name = file.file_name().to_string_lossy().to_string();
                let Some(num) = name
                    .strip_prefix('v')
                    .and_then(|n| n.strip_suffix(".bin"))
                    .and_then(|n| n.parse::<u32>().ok())
                else {
                    continue;
                };
                let Ok(meta) = file.metadata() else { continue };
                let saved_at = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let _ = num;
                out.push((file.path(), saved_at, meta.len()));
            }
        }
        out
    }
    fn store_total(base: &Path) -> u64 {
        version_files(base).iter().map(|(_, _, size)| *size).sum()
    }
    let mut total = store_total(base);
    if total <= STORE_BUDGET_BYTES {
        return;
    }
    let mut files = version_files(base);
    files.sort_by_key(|(_, at, _)| *at);
    for (path, _, size) in files {
        if total <= STORE_BUDGET_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
            // 同步索引：该文件的 manifest 去掉对应条目（孤儿镜像由启动恢复重建/清理）。
            if let Some(dir) = path.parent() {
                let mut index = read_index(dir);
                let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                let n: u32 = stem.trim_start_matches('v').parse().unwrap_or(0);
                index.versions.retain(|entry| entry.n != n);
                let _ = write_index(dir, &index);
            }
        }
    }
}

fn versions_base() -> Option<PathBuf> {
    crate::pi_agent::secrets::default_data_dir().map(|dir| dir.join("office-versions"))
}

/// 绝对路径 → 版本目录键（sha256 十六进制，避免文件系统非法字符/长度问题）。
fn version_key(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    let absolute = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let digest = Sha256::digest(absolute.to_string_lossy().as_bytes());
    Some(hex::encode(digest))
}

#[derive(Debug, Serialize, Deserialize)]
struct VersionIndexEntry {
    n: u32,
    #[serde(default)]
    saved_at_ms: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct VersionIndex {
    versions: Vec<VersionIndexEntry>,
}

fn version_dir(base: &Path, key: &str) -> PathBuf {
    base.join(key)
}

fn read_index(dir: &Path) -> VersionIndex {
    let Ok(text) = std::fs::read_to_string(dir.join("index.json")) else {
        return VersionIndex::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_index(dir: &Path, index: &VersionIndex) -> std::result::Result<(), String> {
    let text = serde_json::to_string(index).map_err(|e| format!("序列化索引失败：{e}"))?;
    std::fs::write(dir.join("index.json"), text).map_err(|e| format!("写索引失败：{e}"))
}

fn push_version_in(base: &Path, path: &Path, previous: &[u8]) -> std::result::Result<(), String> {
    if previous.is_empty() {
        return Ok(());
    }
    let Some(key) = version_key(path) else {
        return Ok(());
    };
    let dir = version_dir(base, &key);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建版本目录失败：{e}"))?;
    let mut index = read_index(&dir);
    // 下一个版本号：现有最大 n + 1（淘汰后仍单调，避免覆盖）。
    let next = index.versions.last().map(|entry| entry.n + 1).unwrap_or(1);
    let file = dir.join(format!("v{next}.bin"));
    std::fs::write(&file, previous).map_err(|e| format!("写版本失败：{e}"))?;
    index.versions.push(VersionIndexEntry {
        n: next,
        saved_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    });
    // 淘汰最旧（>5 版时删文件 + 索引项）。
    while index.versions.len() > MAX_VERSIONS_PER_FILE {
        let dropped = index.versions.remove(0);
        let _ = std::fs::remove_file(dir.join(format!("v{}.bin", dropped.n)));
    }
    write_index(&dir, &index)?;
    // 全局预算 LRU（跨文件共享额度）。
    enforce_store_budget(base);
    Ok(())
}

fn restore_previous_version_in(base: &Path, path: &Path) -> std::result::Result<bool, String> {
    let Some(key) = version_key(path) else {
        return Ok(false);
    };
    let dir = version_dir(base, &key);
    let mut index = read_index(&dir);
    let Some(latest) = index.versions.pop() else {
        return Ok(false);
    };
    let current = std::fs::read(path).unwrap_or_default();
    let latest_file = dir.join(format!("v{}.bin", latest.n));
    // 复制版本内容到目标（保留版本文件本身，往返语义依赖它）。
    std::fs::copy(&latest_file, path).map_err(|e| format!("恢复写盘失败：{e}"))?;
    // 交换语义：当前内容压回栈（可再次恢复形成往返）。
    if !current.is_empty() {
        let next = index.versions.last().map(|entry| entry.n + 1).unwrap_or(1);
        std::fs::write(dir.join(format!("v{next}.bin")), &current)
            .map_err(|e| format!("压回当前内容失败：{e}"))?;
        index.versions.push(VersionIndexEntry {
            n: next,
            saved_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        });
    }
    write_index(&dir, &index);
    Ok(true)
}

fn previous_version_count_in(base: &Path, path: &Path) -> usize {
    let Some(key) = version_key(path) else {
        return 0;
    };
    read_index(&version_dir(base, &key)).versions.len()
}

/// 修改前快照（文件存在才入栈；超出上限淘汰最旧）。
pub(crate) fn push_version(path: &Path, previous: &[u8]) {
    if previous.is_empty() {
        return;
    }
    let Some(base) = versions_base() else { return };
    let _ = push_version_in(&base, path, previous);
}

/// 恢复上一版：栈顶内容写回磁盘，当前内容压回栈（可再次恢复形成往返）。
/// 返回是否发生了恢复。磁盘持久化——进程重启后依然可恢复。
pub fn restore_previous_version(path: &Path) -> Result<bool, String> {
    let Some(base) = versions_base() else {
        return Err("数据目录不可用".to_string());
    };
    restore_previous_version_in(&base, path)
}

/// 剩余可回退版本数（前端按钮显隐用）。
pub fn previous_version_count(path: &Path) -> usize {
    let Some(base) = versions_base() else { return 0 };
    previous_version_count_in(&base, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base() -> PathBuf {
        let dir = tempfile::tempdir().expect("tempdir");
        let base = dir.path().join("office-versions");
        std::fs::create_dir_all(&base).expect("mkdir");
        // 泄漏 tempdir 让版本文件在测试期间存活（路径唯一，无并行冲突）。
        std::mem::forget(dir);
        base
    }

    #[test]
    fn restore_swaps_between_versions() {
        let base = temp_base();
        let path = base.parent().unwrap().join(format!("doc-{}.xlsx", std::process::id()));
        std::fs::write(&path, b"v1").expect("write");

        push_version_in(&base, &path, b"v1");
        std::fs::write(&path, b"v2").expect("write v2");
        push_version_in(&base, &path, b"v2");
        std::fs::write(&path, b"v3").expect("write v3");
        assert_eq!(previous_version_count_in(&base, &path), 2);

        assert!(restore_previous_version_in(&base, &path).expect("restore"));
        assert_eq!(std::fs::read(&path).expect("read"), b"v2");
        assert!(restore_previous_version_in(&base, &path).expect("restore"));
        assert_eq!(std::fs::read(&path).expect("read"), b"v3");
    }

    #[test]
    fn overflow_drops_oldest() {
        let base = temp_base();
        let path = base.parent().unwrap().join(format!("doc-{}.xlsx", std::process::id()));
        std::fs::write(&path, b"seed").expect("seed");
        for round in 0..8u8 {
            push_version_in(&base, &path, &[round]);
        }
        assert!(previous_version_count_in(&base, &path) <= MAX_VERSIONS_PER_FILE);
    }

    #[test]
    fn unknown_file_has_no_versions() {
        let base = temp_base();
        let path = base.parent().unwrap().join("none.xlsx");
        assert_eq!(previous_version_count_in(&base, &path), 0);
        assert!(!restore_previous_version_in(&base, &path).expect("restore"));
    }

    #[test]
    fn persists_across_reopen() {
        // 磁盘持久化核心：模拟进程重启（重新解析 index）后仍可恢复。
        let base = temp_base();
        let path = base.parent().unwrap().join(format!("doc-{}.docx", std::process::id()));
        std::fs::write(&path, b"before").expect("write");
        push_version_in(&base, &path, b"before");
        std::fs::write(&path, b"after").expect("write after");
        // 不做任何内存缓存——直接走磁盘恢复。
        assert!(restore_previous_version_in(&base, &path).expect("restore"));
        assert_eq!(std::fs::read(&path).expect("read"), b"before");
    }
}
