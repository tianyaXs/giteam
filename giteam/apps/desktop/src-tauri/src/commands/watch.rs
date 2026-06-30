use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const WORKTREE_CHANGED_EVENT: &str = "git-worktree-changed";

#[derive(Default)]
pub struct GitWorktreeWatcherState {
    watcher: Mutex<Option<GitWorktreeWatcher>>,
}

struct GitWorktreeWatcher {
    repo_path: String,
    _watcher: RecommendedWatcher,
    stop_tx: mpsc::Sender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for GitWorktreeWatcher {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[derive(Clone, Serialize)]
struct GitWorktreeChangedPayload {
    repo_path: String,
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn should_ignore_path(path: &Path) -> bool {
    let text = normalize_path(path);
    let parts: Vec<&str> = text.split('/').filter(|part| !part.is_empty()).collect();

    for part in &parts {
        if matches!(
            *part,
            "node_modules" | "dist" | "target" | ".next" | ".turbo" | ".expo" | ".gradle"
        ) {
            return true;
        }
    }

    if let Some(pos) = parts.iter().position(|part| *part == ".git") {
        let rest = &parts[pos + 1..];
        if rest.is_empty() {
            return false;
        }
        return !matches!(
            rest[0],
            "index" | "HEAD" | "refs" | "packed-refs" | "MERGE_HEAD"
        );
    }

    false
}

fn is_relevant_event(event: &Event) -> bool {
    event.paths.iter().any(|path| !should_ignore_path(path))
}

#[tauri::command]
pub fn start_git_worktree_watcher(
    app: AppHandle,
    state: State<'_, GitWorktreeWatcherState>,
    repo_path: String,
) -> Result<(), String> {
    let repo = repo_path.trim().to_string();
    if repo.is_empty() {
        return Err("repo_path is empty".to_string());
    }
    let repo_buf = PathBuf::from(&repo);
    if !repo_buf.exists() {
        return Err(format!("repo path does not exist: {repo}"));
    }

    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    if guard
        .as_ref()
        .is_some_and(|current| current.repo_path == repo)
    {
        return Ok(());
    }

    let (event_tx, event_rx) = mpsc::channel();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            let _ = event_tx.send(result);
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&repo_buf, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let (stop_tx, stop_rx) = mpsc::channel();
    let app_handle = app.clone();
    let emit_repo = repo.clone();
    let thread = thread::spawn(move || loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        match event_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(Ok(event)) if is_relevant_event(&event) => {
                let _ = app_handle.emit(
                    WORKTREE_CHANGED_EVENT,
                    GitWorktreeChangedPayload {
                        repo_path: emit_repo.clone(),
                    },
                );
            }
            Ok(Ok(_)) => {}
            Ok(Err(_)) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    });

    *guard = Some(GitWorktreeWatcher {
        repo_path: repo,
        _watcher: watcher,
        stop_tx,
        thread: Some(thread),
    });

    Ok(())
}

#[tauri::command]
pub fn stop_git_worktree_watcher(state: State<'_, GitWorktreeWatcherState>) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}
