//! 工作区环境上下文：git 分支/状态、OS/shell、项目验证命令的会话级快照，
//! 拼入 append_system_prompt。pi 已自行注入日期与 cwd，此处不重复。
//!
//! 所有探测均带超时且失败静默降级——会话创建的关键路径不能被慢盘/
//! 网络挂载/缺失 git 拖慢，缺哪段就省略哪段。快照语义在末尾声明
//! （模型须自行 re-run git status），设计参考 Hermes 的 workspace
//! snapshot 与 Codex 的 `<environment_context>` 数据化注入。

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

/// git 探测超时：单命令设计下常态只跑 1 个子进程，1s 足够；探测在
/// 同步装配路径上执行，超时即 async 会话创建的阻塞上限。
const GIT_TIMEOUT: Duration = Duration::from_secs(1);

/// git 摘要缓存 TTL：同进程内同 repo 复用探测结果。动机：会话创建的
/// 同步装配路径上每个 session（含每个子代理）都会探测一次——批 3 个
/// plan 子代理就是串行 3×1s；缓存后同 repo 只有首个 session 付成本。
/// 快照本就声明过期（re-run git status），TTL 内的陈旧可接受。
const GIT_CACHE_TTL: Duration = Duration::from_secs(600);

/// 放行清单展示上限：超出部分计数折叠，避免快照被规则淹没。
const MAX_ALLOW_RULES_SHOWN: usize = 12;

/// 构建工作区环境上下文快照（markdown 小节，供 append_system_prompt 拼接）。
///
/// Platform 行无条件输出；git/项目类型探测失败时省略对应行。
/// `can_execute`：会话是否有 bash/edit/write 能力。放行清单只对能行使
/// 权限的会话注入——只读子代理（如 plan）收到 `Pre-approved: bash:...`
/// 只是指向不存在工具的诱导；验证命令对子代理是计划素材，措辞用名词化。
#[must_use]
pub fn build_workspace_context(repo_path: &Path, can_execute: bool) -> String {
    let mut lines: Vec<String> = vec![format!("- Platform: {}", platform_summary())];
    if let Some(git) = git_summary(repo_path) {
        lines.insert(0, format!("- Git: {git}"));
    }
    lines.extend(
        project_summaries(repo_path)
            .into_iter()
            .map(|summary| format!("- Project: {summary}")),
    );
    if can_execute {
        if let Some(preapproved) = preapproved_summary(repo_path) {
            lines.push(preapproved);
        }
    }

    format!(
        "## Workspace\n\n{}\n\nSnapshot taken {} ({}), when the session started — re-run `git status` before relying on it.",
        lines.join("\n"),
        chrono::Local::now().format("%Y-%m-%d"),
        weekday_name(),
    )
}

/// 星期名（快照时刻标记用）：让「周几」类相对表述有锚点，且天精度
/// 与 pi 的时间注入粒度一致，不会在会话生命周期内打爆前缀缓存。
fn weekday_name() -> &'static str {
    match chrono::Local::now().format("%u").to_string().as_str() {
        "1" => "Monday",
        "2" => "Tuesday",
        "3" => "Wednesday",
        "4" => "Thursday",
        "5" => "Friday",
        "6" => "Saturday",
        _ => "Sunday",
    }
}

/// 已放行规则摘要（`{repo}/.giteam/permissions.json`）。让模型知道哪些
/// 操作用户已授权可直行（参照 Codex 审批回执回注），同时声明 fail-open
/// 语义：清单外不是禁止，只是可能触发确认。空清单返回 `None`。
fn preapproved_summary(repo_path: &Path) -> Option<String> {
    let rules = super::permissions::load_allow_rules(repo_path);
    if rules.is_empty() {
        return None;
    }
    let shown: Vec<&str> = rules.iter().take(MAX_ALLOW_RULES_SHOWN).map(String::as_str).collect();
    let overflow = rules.len().saturating_sub(shown.len());
    let mut summary = format!(
        "- Pre-approved by the user (run without asking): {}",
        shown.join(", ")
    );
    if overflow > 0 {
        summary.push_str(&format!(" (+{overflow} more)"));
    }
    summary.push_str(
        ". Actions not listed are not forbidden — they may trigger a confirmation prompt.",
    );
    Some(summary)
}

fn git_summary(repo_path: &Path) -> Option<String> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (Option<String>, Instant)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some((cached, at)) = guard.get(repo_path) {
            if at.elapsed() < GIT_CACHE_TTL {
                return cached.clone();
            }
        }
    }
    let fresh = git_summary_probe(repo_path);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(repo_path.to_path_buf(), (fresh.clone(), Instant::now()));
    }
    fresh
}

/// git 分支与工作区概要，如 `main, ahead 1, 2 changed, 1 untracked` /
/// `main → origin/main, clean` / `detached at 1a2b3c4, clean`。
/// git 不可用或非 git 仓库时返回 `None`。
///
/// 单命令设计：`status --porcelain -b` 一趟拿分支/tracking/ahead-behind/dirty
/// （常态 1 个子进程，detached 时补一次 rev-parse）。探测在同步装配路径上
/// 执行且会阻塞 async 会话创建，子进程越少、超时越短越好。
fn git_summary_probe(repo_path: &Path) -> Option<String> {
    let status = git_output(repo_path, &["status", "--porcelain=v1", "--branch"])?;
    let mut lines = status.lines();
    // 首行形如 "## main...origin/main [ahead 1, behind 2]" / "## HEAD (no branch)"。
    let header = lines.next()?.trim().strip_prefix("## ")?.to_string();
    let mut parts: Vec<String> = Vec::new();
    match header.split_once(" [") {
        Some((branch_part, tracking)) => {
            parts.push(render_branch(repo_path, branch_part)?);
            // tracking 段原样嵌入（ahead 1 / behind 2 / ahead 1, behind 2 / gone）。
            let raw = tracking.trim_end_matches(']').trim();
            if !raw.is_empty() {
                parts.push(raw.to_string());
            }
        }
        None => parts.push(render_branch(repo_path, &header)?),
    }
    let mut changed = 0usize;
    let mut untracked = 0usize;
    for line in lines {
        if line.starts_with("??") {
            untracked += 1;
        } else {
            changed += 1;
        }
    }
    let dirty = match (changed, untracked) {
        (0, 0) => "clean".to_string(),
        (changed, 0) => format!("{changed} changed"),
        (0, untracked) => format!("{untracked} untracked"),
        (changed, untracked) => format!("{changed} changed, {untracked} untracked"),
    };
    parts.push(dirty);
    Some(parts.join(", "))
}

/// 解析 `-b` 头的分支段：`main...origin/main` → `main → origin/main`；
/// `HEAD (no branch)` 等 detached 形态 → 补一次 rev-parse 短 hash。
fn render_branch(repo_path: &Path, branch_part: &str) -> Option<String> {
    if let Some((local, remote)) = branch_part.split_once("...") {
        return Some(format!("{local} → {remote}"));
    }
    if branch_part.starts_with("HEAD") {
        let hash = git_output(repo_path, &["rev-parse", "--short", "HEAD"])?
            .trim()
            .to_string();
        return Some(format!("detached at {hash}"));
    }
    Some(branch_part.to_string())
}

/// 带超时执行 git 子进程；失败/超时/非零退出码一律 `None`（静默降级）。
fn git_output(repo_path: &Path, args: &[&str]) -> Option<String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    match child.wait_timeout(GIT_TIMEOUT) {
        Ok(Some(status)) if status.success() => {
            let mut buf = String::new();
            child.stdout?.read_to_string(&mut buf).ok()?;
            Some(buf)
        }
        _ => {
            // 超时或失败：回收进程，不让孤儿 git 残留。
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// OS 与默认 shell（`$SHELL` 的 basename；Windows 无 SHELL 时仅 OS）。
fn platform_summary() -> String {
    let os = std::env::consts::OS;
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())
        .map(|shell| {
            let name = Path::new(&shell)
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or(shell);
            format!("{os} ({name})")
        })
        .unwrap_or_else(|| os.to_string())
}

/// 按清单文件探测项目类型与验证命令（把验证循环在会话开始递给模型，
/// 免去每轮重新发现）。monorepo 多类型并存时全部列出。措辞名词化
/// （verification: …）——对主会话是执行参考，对只读子代理是计划素材，
/// 均不构成「现在就去跑」的祈使诱导。
fn project_summaries(repo_path: &Path) -> Vec<String> {
    let mut summaries = Vec::new();
    if repo_path.join("Cargo.toml").is_file() {
        summaries.push("Rust (cargo) — verification: cargo build && cargo test".to_string());
    }
    if repo_path.join("package.json").is_file() {
        let pm = if repo_path.join("pnpm-lock.yaml").is_file() {
            "pnpm"
        } else if repo_path.join("yarn.lock").is_file() {
            "yarn"
        } else {
            "npm"
        };
        summaries.push(format!(
            "Node.js ({pm}) — verification: {pm} run build && {pm} test"
        ));
    }
    if repo_path.join("pyproject.toml").is_file() || repo_path.join("setup.py").is_file() {
        summaries.push("Python — verification: pytest".to_string());
    }
    if repo_path.join("go.mod").is_file() {
        summaries.push("Go — verification: go build ./... && go test ./...".to_string());
    }
    summaries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_line_always_present_with_snapshot_notice() {
        let ctx = build_workspace_context(Path::new("/definitely/not/a/repo"), true);
        assert!(ctx.contains("## Workspace"));
        assert!(ctx.contains("- Platform: "));
        assert!(ctx.contains("re-run `git status` before relying on it"));
        // 非 git 目录：不应出现 Git 行（git 探测失败静默降级）。
        assert!(!ctx.contains("- Git: "));
    }

    #[test]
    fn detects_project_types_from_manifest_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"x\"\n")
            .expect("write Cargo.toml");
        std::fs::write(dir.path().join("package.json"), "{}").expect("write package.json");
        std::fs::write(dir.path().join("pnpm-lock.yaml"), "").expect("write pnpm lockfile");

        let ctx = build_workspace_context(dir.path(), true);
        assert!(ctx.contains("Rust (cargo) — verification: cargo build && cargo test"));
        assert!(ctx.contains("Node.js (pnpm) — verification: pnpm run build && pnpm test"));
    }

    #[test]
    fn readonly_session_gets_no_preapproved_list() {
        // 会话能力感知：只读子代理（无 bash/edit/write）不注入放行清单，
        // 即便 permissions.json 存在——指向不存在工具的清单只是诱导。
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".giteam")).expect("create .giteam");
        std::fs::write(
            dir.path().join(".giteam").join("permissions.json"),
            r#"{"allow":["bash:cargo test","edit:src/main.rs"]}"#,
        )
        .expect("write permissions");

        let ctx = build_workspace_context(dir.path(), false);
        assert!(!ctx.contains("Pre-approved"));
        assert!(!ctx.contains("bash:cargo test"));
        // 主会话语义（can_execute=true）下仍注入。
        assert!(build_workspace_context(dir.path(), true).contains("Pre-approved"));
    }

    #[test]
    fn no_project_lines_for_bare_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let ctx = build_workspace_context(dir.path(), true);
        assert!(!ctx.contains("- Project: "));
        // 无 permissions.json：无放行行。
        assert!(!ctx.contains("Pre-approved"));
    }

    #[test]
    fn preapproved_rules_surface_with_fail_open_notice() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".giteam")).expect("create .giteam");
        std::fs::write(
            dir.path().join(".giteam").join("permissions.json"),
            r#"{"allow":["bash:npm run build","edit:src/main.rs"]}"#,
        )
        .expect("write permissions");

        let ctx = build_workspace_context(dir.path(), true);
        assert!(ctx.contains("Pre-approved by the user"));
        assert!(ctx.contains("bash:npm run build"));
        assert!(ctx.contains("edit:src/main.rs"));
        // fail-open 语义声明：清单外≠禁止。
        assert!(ctx.contains("not forbidden"));
    }

    #[test]
    fn preapproved_rules_fold_overflow_with_count() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join(".giteam")).expect("create .giteam");
        let rules: Vec<String> = (0..15).map(|i| format!("bash:cmd-{i}")).collect();
        let json = format!(
            r#"{{"allow":{}}}"#,
            serde_json::to_string(&rules).expect("serialize")
        );
        std::fs::write(dir.path().join(".giteam").join("permissions.json"), json)
            .expect("write permissions");

        let ctx = build_workspace_context(dir.path(), true);
        assert!(ctx.contains("bash:cmd-11"));
        assert!(!ctx.contains("bash:cmd-12"));
        assert!(ctx.contains("(+3 more)"));
    }

    #[cfg(unix)]
    #[test]
    fn git_summary_reports_branch_and_dirty_state() {
        // 需要 git 可用；CI/dev 机都有。git 缺失时 skip 而非 fail。
        if which::which("git").is_err() {
            return;
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let run = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
                .expect("run git")
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "test@giteam.local"]);
        run(&["config", "user.name", "test"]);
        run(&["checkout", "-q", "-b", "feature-x"]);
        std::fs::write(dir.path().join("README.md"), "hi").expect("write README");
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "init"]);
        std::fs::write(dir.path().join("dirty.txt"), "x").expect("write dirty file");

        let ctx = build_workspace_context(dir.path(), true);
        assert!(ctx.contains("- Git: feature-x, 1 untracked"), "got: {ctx}");
    }

    #[cfg(unix)]
    #[test]
    fn git_summary_reuses_cache_within_ttl() {
        // 同 repo 两次快照：TTL 内命中缓存，dirty 状态变化不触发重新探测。
        // 这是子代理批量 spawn 场景的行为契约——只有首个 session 付探测成本。
        if which::which("git").is_err() {
            return;
        }
        let dir = tempfile::tempdir().expect("tempdir");
        let run = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
                .expect("run git")
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@l"]);
        run(&["config", "user.name", "t"]);
        run(&["checkout", "-q", "-b", "cache-probe"]);
        std::fs::write(dir.path().join("a.txt"), "a").expect("write");
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "init"]);

        let first = build_workspace_context(dir.path(), true);
        assert!(first.contains("- Git: cache-probe, clean"), "got: {first}");
        // 首次探测后工作区变 dirty；TTL 内第二次快照仍返回缓存值。
        std::fs::write(dir.path().join("late.txt"), "x").expect("write dirty");
        let second = build_workspace_context(dir.path(), true);
        assert!(
            second.contains("- Git: cache-probe, clean"),
            "expected cached (pre-dirty) summary, got: {second}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn git_summary_parses_tracking_and_ahead_behind() {
        if which::which("git").is_err() {
            return;
        }
        // bare 仓库充当 remote，clone 后本地多提交 → ahead 计数出现。
        let remote = tempfile::tempdir().expect("remote dir");
        let run_in = |dir: &Path, args: &[&str]| {
            Command::new("git").args(args).current_dir(dir).output().expect("git")
        };
        run_in(remote.path(), &["init", "-q", "--bare"]);
        run_in(remote.path(), &["symbolic-ref", "HEAD", "refs/heads/main"]);
        let clone = tempfile::tempdir().expect("clone dir");
        run_in(clone.path(), &["clone", "-q", remote.path().to_str().unwrap(), "."]);
        run_in(clone.path(), &["config", "user.email", "t@l"]);
        run_in(clone.path(), &["config", "user.name", "t"]);
        run_in(clone.path(), &["checkout", "-q", "-b", "main"]);
        std::fs::write(clone.path().join("a.txt"), "a").expect("write");
        run_in(clone.path(), &["add", "."]);
        run_in(clone.path(), &["commit", "-q", "-m", "one"]);
        run_in(clone.path(), &["push", "-q", "-u", "origin", "main"]);
        std::fs::write(clone.path().join("b.txt"), "b").expect("write");
        run_in(clone.path(), &["add", "."]);
        run_in(clone.path(), &["commit", "-q", "-m", "two"]);
        // 未 push 的第二个提交 → ahead 1。

        let ctx = build_workspace_context(clone.path(), true);
        assert!(
            ctx.contains("main → origin/main") && ctx.contains("ahead 1"),
            "tracking/ahead missing: {ctx}"
        );
    }
}



