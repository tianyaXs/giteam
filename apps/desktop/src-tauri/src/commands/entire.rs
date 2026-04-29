use super::command_runner;

const EXPLAIN_TIMEOUT_SECS: u64 = 120;

fn run_entire(args: &[&str], repo_path: &str) -> Result<String, String> {
    command_runner::run_and_capture_in_dir_with_timeout(
        "entire",
        args,
        repo_path,
        EXPLAIN_TIMEOUT_SECS,
    )
}

#[tauri::command]
pub fn run_entire_status_detailed(repo_path: &str) -> Result<String, String> {
    run_entire(&["status", "--detailed"], repo_path)
}

#[tauri::command]
pub fn run_entire_explain_commit(commit_sha: &str, repo_path: &str) -> Result<String, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    run_entire(
        &["explain", "--commit", commit_sha, "--no-pager"],
        repo_path,
    )
}

#[tauri::command]
pub fn run_entire_explain_commit_short(
    commit_sha: &str,
    repo_path: &str,
) -> Result<String, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    run_entire(
        &["explain", "--commit", commit_sha, "--short", "--no-pager"],
        repo_path,
    )
}

#[tauri::command]
pub fn run_entire_explain_checkpoint(
    checkpoint_id: &str,
    repo_path: &str,
) -> Result<String, String> {
    if checkpoint_id.trim().is_empty() {
        return Err("checkpoint id is empty".to_string());
    }
    run_entire(
        &["explain", "--checkpoint", checkpoint_id, "--no-pager"],
        repo_path,
    )
}

#[tauri::command]
pub fn run_entire_explain_checkpoint_raw_transcript(
    checkpoint_id: &str,
    repo_path: &str,
) -> Result<String, String> {
    if checkpoint_id.trim().is_empty() {
        return Err("checkpoint id is empty".to_string());
    }
    run_entire(
        &[
            "explain",
            "--checkpoint",
            checkpoint_id,
            "--raw-transcript",
            "--no-pager",
        ],
        repo_path,
    )
}
