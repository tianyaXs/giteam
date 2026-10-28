//! office 回合清单：非 git 工作区的「本轮修改文件」追踪。
//!
//! 参照 DSH 检查点快照的 manifest 模式：回合开始写基线清单（路径 + sha256），
//! 结束时扫描当前状态与基线逐文件比较——差集即本轮实际落盘的文件，
//! **bash 间接写入也覆盖，且不依赖 git 仓库**。
//!
//! 排除依赖/构建目录，单文件 >20MB 跳过哈希（记 mtime 伪哈希，保持可比）。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeManifestFile {
    pub path: String,
    pub sha256: String,
    /// 文本文件基线内容（≤64KB 且扩展名在文本白名单内才有）：结束时与当前内容 diff，
    /// 让 write 覆盖写 / bash 间接改写也能得到真实 +/-（而非假 −0）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficeFileDiff {
    pub path: String,
    pub before: String,
    pub after: String,
}

/// 参与内容 diff 的文本扩展名（office 二进制不在列）。
const TEXT_EXTS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "py", "rs", "go", "java", "kt",
    "html", "htm", "css", "scss", "less", "json", "jsonc", "md", "txt", "yml", "yaml", "toml",
    "sh", "bash", "c", "h", "cpp", "hpp", "sql", "xml", "svg", "env", "gitignore", "csv",
];
/// 单文件内容上限（字节）。
const CONTENT_CAP_PER_FILE: u64 = 64 * 1024;
/// 基线内容总量上限（字节），超出后不再记录内容（仍记录哈希）。
const CONTENT_CAP_TOTAL: u64 = 24 * 1024 * 1024;

fn is_text_candidate(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| TEXT_EXTS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeRunManifestDiff {
    pub changed: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    /// 变更文本文件的 before/after 全文（write 覆盖写与 bash 改写的真实 diff 源）。
    /// 序列化为 camelCase（fileDiffs）——与前端契约一致（曾在此断裂：snake_case 导致
    /// 前端 undefined.length 抛错，manifest 通道整轮静默失效）。
    pub file_diffs: Vec<OfficeFileDiff>,
}

const EXCLUDED_DIRS: &[&str] = &[
    ".git", "node_modules", "dist", "build", "target", ".next", ".nuxt", ".venv", "venv",
    "__pycache__", ".cache", "coverage", ".idea", ".vscode",
];
const MAX_SCAN_FILE_SIZE: u64 = 20 * 1024 * 1024;
const MAX_SCAN_FILES: usize = 20_000;

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(bytes))
}

/// mtime+size 伪哈希：超过大小上限的文件用元数据参与比较（降级但可比）。
fn pseudo_sha256(meta: &std::fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("pseudo:{}:{}", mtime, meta.len())
}

fn scan_workspace(root: &Path, with_content: bool) -> Vec<OfficeManifestFile> {
    let mut content_budget = CONTENT_CAP_TOTAL;
    fn walk(
        dir: &Path,
        root: &Path,
        out: &mut Vec<OfficeManifestFile>,
        depth: usize,
        with_content: bool,
        content_budget: &mut u64,
    ) {
        if depth > 15 || out.len() >= MAX_SCAN_FILES {
            return;
        }
        let Ok(reads) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = reads.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if !EXCLUDED_DIRS.contains(&name.as_str()) && !name.starts_with(".giteam") {
                    walk(&path, root, out, depth + 1, with_content, content_budget);
                }
                continue;
            }
            if !meta.is_file() || meta.len() > MAX_SCAN_FILE_SIZE {
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string_lossy().to_string());
            let digest = if meta.len() <= 1024 * 1024 {
                // 小文件直接哈希内容。
                match std::fs::read(&path) {
                    Ok(bytes) => sha256_hex(&bytes),
                    Err(_) => continue,
                }
            } else {
                pseudo_sha256(&meta)
            };
            // 文本基线内容：write 覆盖写 / bash 改写的真实 diff 依据。
            let mut content = None;
            if with_content
                && *content_budget > 0
                && meta.len() <= CONTENT_CAP_PER_FILE
                && is_text_candidate(&path)
            {
                if let Ok(bytes) = std::fs::read(&path) {
                    // 二进制守卫：前 1KB 含 NUL 则跳过。
                    let head_nul = bytes.iter().take(1024).any(|b| *b == 0);
                    if !head_nul {
                        if let Ok(text) = String::from_utf8(bytes) {
                            *content_budget = content_budget.saturating_sub(text.len() as u64);
                            content = Some(text);
                        }
                    }
                }
            }
            out.push(OfficeManifestFile { path: rel, sha256: digest, content });
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out, 0, with_content, &mut content_budget);
    out
}

fn runs_dir(repo_path: &str, run_token: &str) -> Result<PathBuf, String> {
    let sanitized: String = run_token
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if sanitized.is_empty() {
        return Err("run_token 无效".to_string());
    }
    let root = std::path::PathBuf::from(repo_path.trim());
    if !root.is_dir() {
        return Err(format!("工作区不存在：{}", root.display()));
    }
    Ok(root.join(".giteam").join("runs").join(sanitized))
}

/// 回合开始：写基线清单（路径 + sha256）。返回扫描的文件数。
/// 后台执行（全仓哈希扫描可能秒级，同步命令会阻塞主线程）。
#[tauri::command]
pub async fn office_run_manifest_begin(
    repo_path: String,
    run_token: String,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = runs_dir(&repo_path, &run_token)?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建清单目录失败：{e}"))?;
        let files = scan_workspace(&std::path::PathBuf::from(repo_path.trim()), true);
        let text = serde_json::to_string(&files).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("begin.json"), text).map_err(|e| format!("写基线失败：{e}"))?;
        Ok(files.len())
    })
    .await
    .unwrap_or_else(|e| Err(format!("基线任务失败：{e}")))
}

/// 回合结束：扫描当前状态与基线逐文件比较（路径 + 哈希），
/// 返回本轮实际修改的文件路径（新增/修改；删除的文件不含）。
#[tauri::command]
pub async fn office_run_manifest_diff(
    repo_path: String,
    run_token: String,
    session_id: String,
    turn_seq: u32,
) -> Result<OfficeRunManifestDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let dir = runs_dir(&repo_path, &run_token)?;
    let begin_text = std::fs::read_to_string(dir.join("begin.json"))
        .map_err(|_| "基线清单不存在".to_string())?;
    let begin: Vec<OfficeManifestFile> =
        serde_json::from_str(&begin_text).map_err(|e| format!("基线解析失败：{e}"))?;
    let current = scan_workspace(&std::path::PathBuf::from(repo_path.trim()), true);

    let mut begin_by_path = std::collections::HashMap::new();
    for file in &begin {
        begin_by_path.insert(file.path.clone(), file.sha256.clone());
    }
    let mut current_by_path = std::collections::HashMap::new();
    for file in &current {
        current_by_path.insert(file.path.clone(), file.sha256.clone());
    }

    let mut changed = Vec::new();
    for file in &current {
        match begin_by_path.get(&file.path) {
            Some(old) if old == &file.sha256 => {}
            _ => changed.push(file.path.clone()),
        }
    }
    let mut deleted = Vec::new();
    for file in &begin {
        if !current_by_path.contains_key(&file.path) {
            deleted.push(file.path.clone());
        }
    }

    // 变更文本文件：基线有内容且当前可读且仍为文本候选 → 产出真实 before/after。
    let mut file_diffs = Vec::new();
    for file in &current {
        if !changed.contains(&file.path) {
            continue;
        }
        let after = match &file.content {
            Some(after) => after,
            None => continue,
        };
        // 基线有内容 → 真实前后对比；基线无此条目（本轮新建）→ before 为空（真新增口径）。
        let before = begin
            .iter()
            .find(|entry| entry.path == file.path)
            .and_then(|entry| entry.content.clone())
            .unwrap_or_default();
        file_diffs.push(OfficeFileDiff {
            path: file.path.clone(),
            before,
            after: after.clone(),
        });
    }
    let diff = OfficeRunManifestDiff { changed, added: Vec::new(), deleted, file_diffs };
    let _ = std::fs::remove_dir_all(&dir);
    // DSH 检查点式持久化：快照文件落盘（原子写），跨重启保留、按轮次归属。
    let _ = save_turn_snapshot(&session_id, turn_seq, &diff);
    Ok(diff)
    })
    .await
    .unwrap_or_else(|e| Err(format!("差集任务失败：{e}")))
}

// ── 轮次快照持久化（DSH 检查点式设计：独立根目录、版本化清单、有界保留、启动自愈）──

const TURN_SNAPSHOT_VERSION: u32 = 1;
/// 每会话保留的最近轮次数（DSH 三槽位轮转 oldest 的推广：有界即轮转）。
const TURN_SNAPSHOT_KEEP_PER_SESSION: usize = 50;
/// 快照滑动 TTL：7 天未保留即回收。
const TURN_SNAPSHOT_TTL_MS: u64 = 7 * 24 * 3600 * 1000;
/// 快照根全局预算：512MB，超出按最旧优先回收。
const TURN_SNAPSHOT_BUDGET_BYTES: u64 = 512 * 1024 * 1024;
/// 单轮快照体积上限：8MB（超限轮不持久化，前端回落片段模式——降级而非失败）。
const TURN_SNAPSHOT_MAX_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSnapshotFile {
    pub version: u32,
    pub session_id: String,
    pub turn_seq: u32,
    pub saved_at_ms: u64,
    pub changed: Vec<String>,
    pub file_diffs: Vec<OfficeFileDiff>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSnapshotMeta {
    pub turn_seq: u32,
    pub saved_at_ms: u64,
    pub changed_count: usize,
    pub size_bytes: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn sanitize_id(value: &str) -> String {
    let out: String = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if out.is_empty() { "unknown".to_string() } else { out }
}

fn turn_snapshots_root() -> Option<PathBuf> {
    giteam_core::pi_agent::giteam_data_dir().map(|dir| dir.join("turn-snapshots"))
}

fn snapshot_path(session_id: &str, turn_seq: u32) -> Option<PathBuf> {
    turn_snapshots_root().map(|root| {
        root.join(sanitize_id(session_id)).join(format!("{turn_seq}.json"))
    })
}

/// 原子写（tmp + rename = 提交点）：崩溃残留 tmp 文件由 GC 清理。
fn save_turn_snapshot(session_id: &str, turn_seq: u32, diff: &OfficeRunManifestDiff) -> Result<(), String> {
    let file = snapshot_path(session_id, turn_seq).ok_or("数据目录不可用")?;
    let payload = TurnSnapshotFile {
        version: TURN_SNAPSHOT_VERSION,
        session_id: session_id.to_string(),
        turn_seq,
        saved_at_ms: now_ms(),
        changed: diff.changed.clone(),
        file_diffs: diff.file_diffs.clone(),
    };
    let text = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    if text.len() as u64 > TURN_SNAPSHOT_MAX_BYTES {
        eprintln!("[turn-snapshot] 跳过保存：超过单轮上限 {} > {} 字节", text.len(), TURN_SNAPSHOT_MAX_BYTES);
        return Err("超过单轮快照上限".to_string());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn office_turn_snapshots_list(session_id: String) -> Result<Vec<TurnSnapshotMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(root) = turn_snapshots_root() else { return Ok(Vec::new()) };
        let dir = root.join(sanitize_id(&session_id));
        let mut out = Vec::new();
        let Ok(reads) = std::fs::read_dir(&dir) else { return Ok(out) };
        for entry in reads.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
            let Ok(snap) = serde_json::from_str::<TurnSnapshotFile>(&text) else { continue };
            out.push(TurnSnapshotMeta {
                turn_seq: snap.turn_seq,
                saved_at_ms: snap.saved_at_ms,
                changed_count: snap.changed.len(),
                size_bytes: meta.len(),
            });
        }
        out.sort_by_key(|m| m.turn_seq);
        Ok(out)
    })
    .await
    .unwrap_or_else(|e| Err(format!("列快照失败：{e}")))
}

#[tauri::command]
pub async fn office_turn_snapshots_read(
    session_id: String,
    turn_seq: u32,
) -> Result<Option<TurnSnapshotFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = snapshot_path(&session_id, turn_seq) else { return Ok(None) };
        let Ok(text) = std::fs::read_to_string(&file) else { return Ok(None) };
        serde_json::from_str(&text).map(Some).map_err(|e| e.to_string())
    })
    .await
    .unwrap_or_else(|e| Err(format!("读快照失败：{e}")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSnapshotGcResult {
    pub removed_files: u32,
    pub freed_bytes: u64,
}

/// 启动自愈 GC（DSH recoverOrphaned 同款语义）：
/// 1) 级联清理已删除会话的目录（前端提供现存会话 id 列表）；
/// 2) TTL：超过 7 天未保留的快照回收；
/// 3) 每会话只留最近 KEEP 轮（轮转最旧）；
/// 4) 全局预算 LRU：按 savedAt 最旧优先回收至预算内；
/// 5) 清理原子写残留的 *.tmp。
#[tauri::command]
pub async fn office_turn_snapshots_gc(valid_session_ids: Vec<String>) -> Result<TurnSnapshotGcResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut removed = 0u32;
        let mut freed = 0u64;
        let Some(root) = turn_snapshots_root() else {
            return Ok(TurnSnapshotGcResult { removed_files: 0, freed_bytes: 0 });
        };
        // 防御：会话列表为空（启动未加载完成）时禁止级联——空列表 ≠ 全部会话已删除。
        let cascade_allowed = !valid_session_ids.is_empty();
        let valid: std::collections::HashSet<String> =
            valid_session_ids.iter().map(|id| sanitize_id(id)).collect();
        let now = now_ms();

        let mut survivors: Vec<(PathBuf, u64, String)> = Vec::new(); // (path, savedAt, sessionDir)
        if let Ok(sessions) = std::fs::read_dir(&root) {
            for session_dir in sessions.flatten() {
                let dir_name = session_dir.file_name().to_string_lossy().to_string();
                if cascade_allowed && !valid.contains(&dir_name) {
                    // 级联：会话已删除。
                    let size = dir_size(&session_dir.path());
                    let _ = std::fs::remove_dir_all(session_dir.path());
                    removed += 1;
                    freed += size;
                    continue;
                }
                let mut keep: Vec<(PathBuf, u64)> = Vec::new();
                if let Ok(files) = std::fs::read_dir(&session_dir.path()) {
                    for file in files.flatten() {
                        let name = file.file_name().to_string_lossy().to_string();
                        if name.ends_with(".tmp") {
                            let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                            let _ = std::fs::remove_file(file.path());
                            removed += 1;
                            freed += size;
                            continue;
                        }
                        let Ok(text) = std::fs::read_to_string(file.path()) else { continue };
                        let Ok(snap) = serde_json::from_str::<TurnSnapshotFile>(&text) else { continue };
                        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                        if now.saturating_sub(snap.saved_at_ms) > TURN_SNAPSHOT_TTL_MS {
                            let _ = std::fs::remove_file(file.path());
                            removed += 1;
                            freed += size;
                            continue;
                        }
                        keep.push((file.path(), snap.saved_at_ms));
                    }
                }
                // 每会话有界保留：按时间留最新 N 轮（轮转最旧）。
                keep.sort_by_key(|(_, at)| *at);
                while keep.len() > TURN_SNAPSHOT_KEEP_PER_SESSION {
                    if let Some((path, _)) = keep.first().cloned() {
                        let size = path.metadata().map(|m| m.len()).unwrap_or(0);
                        let _ = std::fs::remove_file(&path);
                        removed += 1;
                        freed += size;
                        keep.remove(0);
                    } else {
                        break;
                    }
                }
                for (path, at) in keep {
                    survivors.push((path, at, dir_name.clone()));
                }
            }
        }
        // 全局预算 LRU：最旧优先回收至预算内。
        let mut total: u64 = survivors
            .iter()
            .map(|(p, _, _)| p.metadata().map(|m| m.len()).unwrap_or(0))
            .sum();
        survivors.sort_by_key(|(_, at, _)| *at);
        for (path, _, _) in survivors {
            if total <= TURN_SNAPSHOT_BUDGET_BYTES {
                break;
            }
            let size = path.metadata().map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
                freed += size;
                total = total.saturating_sub(size);
            }
        }
        Ok(TurnSnapshotGcResult { removed_files: removed, freed_bytes: freed })
    })
    .await
    .unwrap_or_else(|e| Err(format!("GC 失败：{e}")))
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += dir_size(&entry.path());
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 端到端：begin 存文本内容 → 覆盖写 → diff 产出真实 before/after（write 覆盖写的真 diff）。
    #[test]
    fn manifest_diff_returns_real_before_after_for_overwrite() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("repo");
        std::fs::create_dir_all(root.join("src")).expect("mkdir");
        std::fs::write(root.join("src/app.ts"), "line1\nline2\nline3\n").expect("write base");

        let token = "test-turn-1";
        let count = tauri::async_runtime::block_on(office_run_manifest_begin(
            root.to_string_lossy().to_string(),
            token.to_string(),
        ))
        .expect("begin");
        assert!(count >= 1);

        // 覆盖写：改一行、加一行。
        std::fs::write(root.join("src/app.ts"), "line1\nline2-changed\nline3\nline4\n").expect("overwrite");

        let diff = tauri::async_runtime::block_on(office_run_manifest_diff(
            root.to_string_lossy().to_string(),
            token.to_string(),
            "test-session".to_string(),
            1,
        ))
        .expect("diff");
        assert_eq!(diff.changed, vec!["src/app.ts".to_string()]);
        let file_diff = diff.file_diffs.iter().find(|d| d.path == "src/app.ts").expect("file_diffs 含 app.ts");
        assert!(file_diff.before.contains("line2\n"), "before 是覆盖前完整内容");
        assert!(file_diff.after.contains("line2-changed"), "after 是覆盖后完整内容");
    }

    /// 新建文件：file_diffs 的 before 为空（真新增口径）。
    #[test]
    fn manifest_diff_marks_new_file_with_empty_before() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path().join("repo");
        std::fs::create_dir_all(&root).expect("mkdir");

        let token = "test-turn-2";
        tauri::async_runtime::block_on(office_run_manifest_begin(
            root.to_string_lossy().to_string(),
            token.to_string(),
        ))
        .expect("begin");
        std::fs::write(root.join("new.vue"), "<template>hi</template>\n").expect("new file");

        let diff = tauri::async_runtime::block_on(office_run_manifest_diff(
            root.to_string_lossy().to_string(),
            token.to_string(),
            "test-session".to_string(),
            1,
        ))
        .expect("diff");
        let file_diff = diff.file_diffs.iter().find(|d| d.path == "new.vue").expect("file_diffs 含 new.vue");
        assert_eq!(file_diff.before, "");
        assert!(file_diff.after.contains("<template>"));
    }
}
