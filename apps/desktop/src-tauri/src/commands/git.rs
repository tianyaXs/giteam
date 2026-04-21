use super::command_runner;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeEntry {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeOverview {
    pub branch: String,
    pub tracking: String,
    pub ahead: u32,
    pub behind: u32,
    pub clean: bool,
    pub staged_count: u32,
    pub unstaged_count: u32,
    pub untracked_count: u32,
    pub entries: Vec<GitWorktreeEntry>,
    pub raw: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUserIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub sha: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchSummary {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphNode {
    pub graph: String,
    pub sha: String,
    pub parents: Vec<String>,
    pub date: String,
    pub author: String,
    pub refs: String,
    pub subject: String,
    pub is_connector: bool,
}

fn run_git(args: &[&str], repo_path: &str) -> Result<String, String> {
    command_runner::run_and_capture_in_dir("git", args, repo_path)
}

fn run_git_with_timeout(args: &[&str], repo_path: &str, timeout_secs: u64) -> Result<String, String> {
    command_runner::run_and_capture_in_dir_with_timeout("git", args, repo_path, timeout_secs)
}

fn split_fields<'a>(line: &'a str, sep: char) -> Vec<&'a str> {
    if line.contains(sep) {
        return line.split(sep).collect();
    }
    if line.contains("%x1f") {
        return line.split("%x1f").collect();
    }
    if line.contains("^_") {
        return line.split("^_").collect();
    }
    vec![line]
}

#[tauri::command]
pub fn run_git_head_commit(repo_path: &str) -> Result<String, String> {
    run_git(&["rev-parse", "HEAD"], repo_path)
}

#[tauri::command]
pub fn run_git_pull(repo_path: &str) -> Result<String, String> {
    // Network operations can take longer than local reads.
    run_git_with_timeout(&["pull", "--ff-only"], repo_path, 90)
}

#[tauri::command]
pub fn run_git_push(repo_path: &str) -> Result<String, String> {
    // Network operations can take longer than local reads.
    run_git_with_timeout(&["push"], repo_path, 90)
}

#[tauri::command]
pub fn run_git_show_patch(commit_sha: &str, repo_path: &str) -> Result<String, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    run_git(&["show", "--patch", "--format=fuller", commit_sha], repo_path)
}

#[tauri::command]
pub fn run_git_recent_commits(repo_path: &str, limit: Option<u32>) -> Result<Vec<GitCommitSummary>, String> {
    let n = limit.unwrap_or(30).clamp(1, 200);
    let sep = '\u{1f}';
    let pretty = format!("%H{sep}%an{sep}%ad{sep}%s");
    let raw = run_git(
        &[
            "log",
            &format!("-n{n}"),
            "--date=iso-strict",
            &format!("--pretty=format:{pretty}"),
        ],
        repo_path,
    )?;

    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts = split_fields(line, sep);
        let sha = parts.first().copied().unwrap_or("").trim().to_string();
        let author = parts.get(1).copied().unwrap_or("").trim().to_string();
        let date = parts.get(2).copied().unwrap_or("").trim().to_string();
        let subject = parts.get(3).copied().unwrap_or("").trim().to_string();
        if sha.is_empty() {
            continue;
        }
        commits.push(GitCommitSummary {
            sha,
            author,
            date,
            subject,
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn run_git_local_branches(repo_path: &str) -> Result<Vec<GitBranchSummary>, String> {
    // Branch names list (plain, one per line).
    let names_raw = run_git(&["for-each-ref", "--format=%(refname:short)", "refs/heads"], repo_path)
        .or_else(|_| run_git(&["branch", "--list"], repo_path))?;

    // Current branch name from HEAD.
    let current = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let mut branches = Vec::new();
    for line in names_raw.lines() {
        let mut name = line.trim().to_string();
        // `git branch --list` fallback may include marker like "* main"
        if name.starts_with('*') {
            name = name.trim_start_matches('*').trim().to_string();
        }
        if name.is_empty() || name.starts_with("entire/") {
            continue;
        }
        branches.push(GitBranchSummary {
            is_current: name == current,
            name,
        });
    }

    // Guarantee at least one branch when HEAD is valid.
    if branches.is_empty() && !current.is_empty() && current != "HEAD" && !current.starts_with("entire/") {
        branches.push(GitBranchSummary {
            name: current,
            is_current: true,
        });
    }

    Ok(branches)
}

#[tauri::command]
pub fn run_git_branch_commits(
    repo_path: &str,
    branch_name: &str,
    limit: Option<u32>,
) -> Result<Vec<GitCommitSummary>, String> {
    let n = limit.unwrap_or(30).clamp(1, 200);
    let sep = '\u{1f}';
    let pretty = format!("%H{sep}%an{sep}%ad{sep}%s");
    let raw = run_git(
        &[
            "log",
            branch_name,
            &format!("-n{n}"),
            "--date=iso-strict",
            &format!("--pretty=format:{pretty}"),
        ],
        repo_path,
    )?;

    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts = split_fields(line, sep);
        let sha = parts.first().copied().unwrap_or("").trim().to_string();
        let author = parts.get(1).copied().unwrap_or("").trim().to_string();
        let date = parts.get(2).copied().unwrap_or("").trim().to_string();
        let subject = parts.get(3).copied().unwrap_or("").trim().to_string();
        if sha.is_empty() {
            continue;
        }
        commits.push(GitCommitSummary {
            sha,
            author,
            date,
            subject,
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn run_git_commit_graph(repo_path: &str, limit: Option<u32>) -> Result<Vec<GitGraphNode>, String> {
    let n = limit.unwrap_or(120).clamp(20, 300);
    let sep = '\u{1f}';
    // Include parents so frontend can compute proper lanes/merge links.
    let pretty = format!("{sep}%H{sep}%P{sep}%ad{sep}%an{sep}%d{sep}%s");
    let raw = run_git(
        &[
            "log",
            "--graph",
            "--decorate=short",
            "--date-order",
            "--all",
            &format!("-n{n}"),
            "--date=short",
            &format!("--pretty=format:{pretty}"),
        ],
        repo_path,
    )?;

    let mut nodes = Vec::new();
    for line in raw.lines() {
        let parts = split_fields(line, sep);
        // `git log --graph` may emit connector-only rows that still include the pretty-format field
        // separators, yielding `parts.len() == 6` but with an empty sha/date/author/etc.
        // Keep those rows to preserve lane continuity for the UI.
        if parts.len() < 7 {
            // Preserve trailing spaces for stable column alignment in the UI.
            let graph = parts.first().copied().unwrap_or("").to_string();
            if graph.is_empty() {
                continue;
            }
            nodes.push(GitGraphNode {
                graph,
                sha: String::new(),
                parents: Vec::new(),
                date: String::new(),
                author: String::new(),
                refs: String::new(),
                subject: String::new(),
                is_connector: true,
            });
            continue;
        }

        // Preserve trailing spaces for stable column alignment in the UI.
        let graph = parts.first().copied().unwrap_or("").to_string();
        let sha = parts.get(1).copied().unwrap_or("").trim().to_string();
        if sha.is_empty() {
            if graph.is_empty() {
                continue;
            }
            nodes.push(GitGraphNode {
                graph,
                sha: String::new(),
                parents: Vec::new(),
                date: String::new(),
                author: String::new(),
                refs: String::new(),
                subject: String::new(),
                is_connector: true,
            });
            continue;
        }
        let parents_raw = parts.get(2).copied().unwrap_or("").trim();
        let parents: Vec<String> = parents_raw
            .split_whitespace()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        nodes.push(GitGraphNode {
            graph,
            sha,
            parents,
            date: parts.get(3).copied().unwrap_or("").trim().to_string(),
            author: parts.get(4).copied().unwrap_or("").trim().to_string(),
            refs: parts.get(5).copied().unwrap_or("").trim().to_string(),
            subject: parts.get(6).copied().unwrap_or("").trim().to_string(),
            is_connector: false,
        });
    }
    Ok(nodes)
}

#[tauri::command]
pub fn run_git_commit_changed_files(repo_path: &str, commit_sha: &str) -> Result<Vec<String>, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    let raw = run_git(
        &["show", "--pretty=format:", "--name-only", commit_sha],
        repo_path,
    )?;
    let mut files = Vec::new();
    for line in raw.lines() {
        let name = line.trim();
        if !name.is_empty() {
            files.push(name.to_string());
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn run_git_commit_file_patch(
    repo_path: &str,
    commit_sha: &str,
    file_path: &str,
) -> Result<String, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    if file_path.trim().is_empty() {
        return Err("file path is empty".to_string());
    }
    if file_path.contains('\n') || file_path.contains('\r') {
        return Err("file path contains invalid line breaks".to_string());
    }
    run_git(
        &["show", "--format=", "--patch", commit_sha, "--", file_path],
        repo_path,
    )
}

#[tauri::command]
pub fn run_git_worktree_overview(repo_path: &str) -> Result<GitWorktreeOverview, String> {
    let raw = run_git(&["status", "--short", "--branch"], repo_path)?;
    let mut branch = String::new();
    let mut tracking = String::new();
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut staged_count = 0u32;
    let mut unstaged_count = 0u32;
    let mut untracked_count = 0u32;
    let mut entries = Vec::new();

    for (idx, line) in raw.lines().enumerate() {
        if idx == 0 && line.starts_with("## ") {
            let head = line.trim_start_matches("## ").trim();
            let mut branch_part = head;
            let mut meta_part = "";
            if let Some((lhs, rhs)) = head.split_once("...") {
                branch_part = lhs.trim();
                meta_part = rhs.trim();
            }
            branch = branch_part.to_string();
            if !meta_part.is_empty() {
                if let Some((tracking_name, rest)) = meta_part.split_once(' ') {
                    tracking = tracking_name.trim().to_string();
                    let meta = rest.trim();
                    if let Some(start) = meta.find('[') {
                        if let Some(end) = meta.rfind(']') {
                            let body = &meta[start + 1..end];
                            for item in body.split(',') {
                                let it = item.trim();
                                if let Some(v) = it.strip_prefix("ahead ") {
                                    ahead = v.trim().parse::<u32>().unwrap_or(0);
                                } else if let Some(v) = it.strip_prefix("behind ") {
                                    behind = v.trim().parse::<u32>().unwrap_or(0);
                                }
                            }
                        }
                    }
                } else {
                    tracking = meta_part.to_string();
                }
            }
            continue;
        }

        let index_status = line.chars().next().unwrap_or(' ');
        let worktree_status = line.chars().nth(1).unwrap_or(' ');
        let path = line.get(3..).unwrap_or("").trim().to_string();
        if path.is_empty() {
            continue;
        }
        let staged = index_status != ' ' && index_status != '?';
        let unstaged = worktree_status != ' ' && worktree_status != '?';
        let untracked = index_status == '?' || worktree_status == '?';
        if staged {
            staged_count += 1;
        }
        if unstaged {
            unstaged_count += 1;
        }
        if untracked {
            untracked_count += 1;
        }
        entries.push(GitWorktreeEntry {
            path,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
            staged,
            unstaged,
            untracked,
        });
    }

    if branch.is_empty() {
        branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path)
            .unwrap_or_default()
            .trim()
            .to_string();
    }

    Ok(GitWorktreeOverview {
        branch,
        tracking,
        ahead,
        behind,
        clean: entries.is_empty(),
        staged_count,
        unstaged_count,
        untracked_count,
        entries,
        raw,
    })
}

#[tauri::command]
pub fn run_git_worktree_file_patch(repo_path: &str, file_path: &str) -> Result<String, String> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err("file path is empty".to_string());
    }
    if path.contains('\n') || path.contains('\r') {
        return Err("file path contains invalid line breaks".to_string());
    }

    let staged = run_git(&["diff", "--cached", "--", path], repo_path)?;
    let unstaged = run_git(&["diff", "--", path], repo_path)?;
    let mut parts = Vec::new();
    if !staged.trim().is_empty() {
        parts.push(format!("# Staged\n\n{}", staged.trim_end()));
    }
    if !unstaged.trim().is_empty() {
        parts.push(format!("# Working Tree\n\n{}", unstaged.trim_end()));
    }
    if parts.is_empty() {
        return Ok("No staged or unstaged patch available for this file.".to_string());
    }
    Ok(parts.join("\n\n"))
}

#[tauri::command]
pub fn run_repo_terminal_command(repo_path: &str, command: &str) -> Result<String, String> {
    let script = command.trim();
    if script.is_empty() {
        return Err("command is empty".to_string());
    }
    if script.contains('\0') {
        return Err("command contains invalid null byte".to_string());
    }
    command_runner::run_and_capture_in_dir_with_timeout("/bin/zsh", &["-lc", script], repo_path, 30)
}

#[tauri::command]
pub fn run_git_user_identity(repo_path: &str) -> Result<GitUserIdentity, String> {
    let name = run_git(&["config", "user.name"], repo_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let email = run_git(&["config", "user.email"], repo_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(GitUserIdentity { name, email })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn local_branches_smoke_test() {
        let repo_path = "/Users/tianya/Documents/project/giteam/test";
        if !Path::new(repo_path).exists() {
            return;
        }
        let branches = run_git_local_branches(repo_path).expect("run_git_local_branches should succeed");
        // At least one regular branch should be visible for a valid repo.
        assert!(
            !branches.is_empty(),
            "expected at least one local branch, got empty: {:?}",
            branches
        );
    }
}
