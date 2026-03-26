use super::command_runner;
use serde::{Deserialize, Serialize};

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
