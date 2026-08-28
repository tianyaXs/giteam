//! 分享闭环集成测试：导出（脱敏）→ mock gateway 分块上传 → finalize →
//! 下载上下文 + clone（回退 bundle）→ rekey → 校验。

use giteam_core::share;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

fn run_git(dir: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(status.status.success(), "git {:?} failed", args);
}

fn init_repo(dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    let status = std::process::Command::new("git")
        .arg("init")
        .arg("-b")
        .arg("main")
        .arg(dir)
        .output()
        .expect("git init");
    assert!(status.status.success());
    run_git(dir, &["config", "user.email", "share@test.dev"]);
    run_git(dir, &["config", "user.name", "Share Test"]);
    fs::write(dir.join("README.md"), "# demo\n").unwrap();
    run_git(dir, &["add", "."]);
    run_git(dir, &["commit", "-m", "init"]);
}

/// 极简 mock gateway：按 artifact 分存 repo / context。
struct MockGateway {
    base_url: String,
    /// key = `{shareId}:{artifact}` → bytes
    blobs: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

fn start_mock_gateway() -> MockGateway {
    let server = tiny_http::Server::http("127.0.0.1:0").expect("bind mock gateway");
    let port = server.server_addr().to_ip().unwrap().port();
    let blobs: Arc<Mutex<HashMap<String, Vec<u8>>>> = Arc::new(Mutex::new(HashMap::new()));
    let blobs2 = Arc::clone(&blobs);
    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let url = request.url().to_string();
            let method = request.method().as_str().to_string();
            let mut body = Vec::new();
            request
                .as_reader()
                .read_to_end(&mut body)
                .unwrap_or_default();
            let (status, payload, content_type): (u16, Vec<u8>, &str) =
                handle(&blobs2, &method, &url, &body);
            let response = tiny_http::Response::from_data(payload)
                .with_status_code(status)
                .with_header(
                    tiny_http::Header::from_bytes("Content-Type", content_type).unwrap(),
                );
            let _ = request.respond(response);
        }
    });
    MockGateway {
        base_url: format!("http://127.0.0.1:{port}"),
        blobs,
    }
}

fn artifact_from_query(url: &str) -> String {
    url.split('?')
        .nth(1)
        .unwrap_or("")
        .split('&')
        .find_map(|pair| pair.strip_prefix("artifact="))
        .unwrap_or("repo")
        .to_string()
}

fn handle(
    blobs: &Arc<Mutex<HashMap<String, Vec<u8>>>>,
    method: &str,
    url: &str,
    body: &[u8],
) -> (u16, Vec<u8>, &'static str) {
    let path = url.split('?').next().unwrap_or(url);
    if method == "POST" && path == "/cloud/v1/shares" {
        let share_id = "shr_testshare0001";
        return (
            200,
            serde_json::to_vec(&serde_json::json!({
                "shareId": share_id,
                "uploadPartSize": 4 * 1024 * 1024,
                "expiresAt": "2027-01-01T00:00:00Z",
            }))
            .unwrap(),
            "application/json",
        );
    }
    if let Some(rest) = path.strip_prefix("/cloud/v1/shares/") {
        let mut segments = rest.split('/');
        let share_id = segments.next().unwrap_or("");
        match (method, segments.next()) {
            ("PUT", Some("blob")) => {
                let artifact = artifact_from_query(url);
                let key = format!("{share_id}:{artifact}");
                let mut store = blobs.lock().unwrap();
                store.entry(key).or_default().extend_from_slice(body);
                return (200, b"{}".to_vec(), "application/json");
            }
            ("POST", Some("finalize")) => {
                let payload = serde_json::json!({
                    "shareId": share_id,
                    "shareUrl": format!("http://mock/s/{share_id}"),
                    "gitUrl": format!("http://mock/s/{share_id}/repo.git"),
                });
                return (
                    200,
                    serde_json::to_vec(&payload).unwrap(),
                    "application/json",
                );
            }
            ("GET", None) => {
                let store = blobs.lock().unwrap();
                let repo = store.get(&format!("{share_id}:repo")).cloned().unwrap_or_default();
                let context = store
                    .get(&format!("{share_id}:context"))
                    .cloned()
                    .unwrap_or_default();
                if repo.is_empty() && context.is_empty() {
                    return (404, b"{}".to_vec(), "application/json");
                }
                let repo_digest = {
                    use sha2::Digest;
                    let mut h = sha2::Sha256::new();
                    h.update(&repo);
                    hex::encode(h.finalize())
                };
                let context_digest = {
                    use sha2::Digest;
                    let mut h = sha2::Sha256::new();
                    h.update(&context);
                    hex::encode(h.finalize())
                };
                let payload = serde_json::json!({
                    "shareId": share_id,
                    "name": "demo",
                    "repoName": "demo",
                    "defaultBranch": "main",
                    "headCommit": "abc123",
                    "sizeBytes": repo.len(),
                    "contentSha256": repo_digest,
                    "contextSha256": context_digest,
                    "contextSizeBytes": context.len(),
                    "encrypted": false,
                    "status": "active",
                    "downloadCount": 0,
                    "createdAt": "2026-08-26T00:00:00Z",
                    "expiresAt": "2027-01-01T00:00:00Z",
                    "gitUrl": format!("http://mock/s/{share_id}/repo.git"),
                    "meta": { "layout": "split-v1" },
                });
                return (
                    200,
                    serde_json::to_vec(&payload).unwrap(),
                    "application/json",
                );
            }
            ("GET", Some("download")) => {
                let artifact = artifact_from_query(url);
                let key = format!("{share_id}:{artifact}");
                let store = blobs.lock().unwrap();
                let Some(blob) = store.get(&key) else {
                    return (404, b"{}".to_vec(), "application/json");
                };
                return (200, blob.clone(), "application/octet-stream");
            }
            _ => {}
        }
    }
    (404, b"{}".to_vec(), "application/json")
}

#[test]
fn share_roundtrip_export_upload_download_import() {
    let tmp = tempfile::tempdir().unwrap();
    let giteam_home = tmp.path().join("giteam-home");
    fs::create_dir_all(&giteam_home).unwrap();
    // 本测试进程内独占该环境变量。
    std::env::set_var("GITEAM_HOME", &giteam_home);

    // 1) 源仓库 + 会话 + catalog + 记忆
    let repo = tmp.path().join("demo-repo");
    init_repo(&repo);
    let repo_canonical = fs::canonicalize(&repo).unwrap();
    let repo_str = repo_canonical.to_string_lossy().to_string();

    let sessions_dir = giteam_core::pi_agent::ensure_repo_pi_sessions_dir(&repo).unwrap();
    let session_file = sessions_dir.join("session-1000-1.jsonl");
    fs::write(
        &session_file,
        concat!(
            "{\"type\":\"session\",\"version\":3,\"id\":\"sess-1\",\"cwd\":\"REPO\"}\n",
            "{\"type\":\"message\",\"text\":\"token sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa at REPO\"}\n"
        )
        .replace("REPO", &repo_str),
    )
    .unwrap();
    let catalog = serde_json::json!([{
        "schemaVersion": 1,
        "sessionId": "sess-1",
        "repoPath": repo_str,
        "sessionDir": sessions_dir.to_string_lossy(),
        "sessionPath": session_file.to_string_lossy(),
        "provider": "openai",
        "model": "gpt",
        "noSession": false,
        "updatedAtMs": 1
    }]);
    let pi_sessions = giteam_home.join("pi-sessions");
    fs::create_dir_all(&pi_sessions).unwrap();
    fs::write(
        pi_sessions.join("catalog.json"),
        serde_json::to_vec_pretty(&catalog).unwrap(),
    )
    .unwrap();

    let memory_path = giteam_core::pi_agent::memory_db_path_for_repo(&repo).unwrap();
    fs::create_dir_all(memory_path.parent().unwrap()).unwrap();
    {
        let conn = rusqlite::Connection::open(&memory_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE replay_state (path TEXT PRIMARY KEY, size_bytes INTEGER NOT NULL DEFAULT 0,
                modified_ms INTEGER NOT NULL DEFAULT 0, session_id TEXT NOT NULL DEFAULT '',
                indexed_at INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE extraction_jobs (turn_key TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                run_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
                input_json TEXT NOT NULL DEFAULT '', enqueued_at_ms INTEGER NOT NULL DEFAULT 0,
                updated_at_ms INTEGER NOT NULL DEFAULT 0, claimed_at_ms INTEGER,
                attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
             CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT NOT NULL, key TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '', props TEXT NOT NULL DEFAULT '{}',
                first_seen_ms INTEGER NOT NULL DEFAULT 0, last_seen_ms INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE edges (id INTEGER PRIMARY KEY AUTOINCREMENT, src_id TEXT NOT NULL,
                dst_id TEXT NOT NULL, type TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}',
                session_id TEXT NOT NULL DEFAULT '', run_id TEXT NOT NULL DEFAULT '',
                event_id TEXT NOT NULL DEFAULT '', sequence INTEGER NOT NULL DEFAULT 0,
                timestamp_ms INTEGER NOT NULL DEFAULT 0);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO replay_state (path, session_id) VALUES (?1, 'sess-1')",
            rusqlite::params![session_file.to_string_lossy().as_ref()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO extraction_jobs (turn_key, session_id, input_json) VALUES ('k1', 'sess-1', ?1)",
            rusqlite::params![format!("{{\"repo_path\":\"{repo_str}\"}}")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO nodes (id, type, key, props) VALUES ('file:1', 'file', 'file:README.md', ?1)",
            rusqlite::params![format!("{{\"origin\":\"{repo_str}\"}}")],
        )
        .unwrap();
    }

    // 2) 导出（拆成 repo.bundle + context.tar.zst）
    let outcome = share::export_package(&repo, &share::ExportOptions::default()).unwrap();
    assert_eq!(outcome.manifest.context.session_count, 1);
    assert!(outcome.manifest.context.has_memory_db);
    assert!(outcome.manifest.context.redactions >= 1, "secret must be redacted");
    assert_eq!(outcome.manifest.package.format, "git+context");
    assert!(outcome.repo_bundle_path.exists());
    assert!(outcome.context_package_path.exists());

    // 3) mock gateway 上传闭环
    let gateway = start_mock_gateway();
    let manifest = &outcome.manifest;
    let created = share::create_share_record(
        &gateway.base_url,
        "device-token",
        &share::CreateShareRequest {
            name: manifest.repo.name.clone(),
            repo_name: manifest.repo.name.clone(),
            default_branch: manifest.repo.default_branch.clone(),
            head_commit: manifest.repo.head_commit.clone(),
            size_bytes: manifest.package.size_bytes,
            content_sha256: manifest.package.sha256.clone(),
            context_sha256: manifest.package.context_sha256.clone(),
            context_size_bytes: manifest.package.context_size_bytes,
            encrypted: false,
            meta: serde_json::json!({ "layout": "split-v1" }),
        },
    )
    .unwrap();
    share::upload_share_parts(
        &gateway.base_url,
        "device-token",
        &created.share_id,
        &outcome.repo_bundle_path,
        share::UPLOAD_PART_SIZE,
        "repo",
    )
    .unwrap();
    share::upload_share_parts(
        &gateway.base_url,
        "device-token",
        &created.share_id,
        &outcome.context_package_path,
        share::UPLOAD_PART_SIZE,
        "context",
    )
    .unwrap();
    share::finalize_share(&gateway.base_url, "device-token", &created.share_id).unwrap();
    {
        let store = gateway.blobs.lock().unwrap();
        let repo_blob = store.get(&format!("{}:repo", created.share_id)).unwrap();
        let ctx_blob = store.get(&format!("{}:context", created.share_id)).unwrap();
        assert_eq!(repo_blob.len() as u64, manifest.package.size_bytes);
        assert_eq!(ctx_blob.len() as u64, manifest.package.context_size_bytes);
    }

    // 4) 导入到新目录（切到接收方的 GITEAM_HOME，模拟另一台机器）
    let receiver_home = tmp.path().join("receiver-home");
    fs::create_dir_all(&receiver_home).unwrap();
    std::env::set_var("GITEAM_HOME", &receiver_home);

    let target = tmp.path().join("imported").join("demo-repo");
    let share_url = format!("{}/s/{}", gateway.base_url, created.share_id);
    let imported = share::import_share(
        &share_url,
        &share::ImportOptions {
            dir: Some(target.clone()),
            attach: None,
            name: None,
            on_progress: None,
            cancel: None,
        },
    )
    .unwrap();

    // 代码（clone remote 失败后回退 bundle）
    assert!(target.join(".git").exists());
    assert_eq!(imported.sessions_imported, 1);
    assert_eq!(imported.catalog_records_merged, 1);
    assert!(imported.memory_imported);
    assert!(imported.rekeyed_entries >= 1);

    // origin 指向分享地址；giteam.shareId 记录
    let origin = std::process::Command::new("git")
        .arg("-C")
        .arg(&target)
        .args(["config", "--get", "remote.origin.url"])
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&origin.stdout).contains("/s/shr_testshare0001/repo.git"));

    // 会话文件 rekey 到新 key 目录，路径已重写
    let new_sessions_dir = giteam_core::pi_agent::pi_sessions_dir_for_repo(&target).unwrap();
    let new_session = new_sessions_dir.join("session-1000-1.jsonl");
    assert!(new_session.exists());
    let content = fs::read_to_string(&new_session).unwrap();
    let new_repo_str = fs::canonicalize(&target).unwrap().to_string_lossy().to_string();
    assert!(content.contains(&new_repo_str), "session must reference new path");
    assert!(!content.contains(&repo_str), "old path must be rewritten");
    assert!(!content.contains("sk-aaaaaaaa"), "secret must stay redacted");

    // 全局 catalog 合并 + 重写（接收方数据根）
    let receiver_catalog = receiver_home.join("pi-sessions").join("catalog.json");
    let catalog_bytes = fs::read(receiver_catalog).unwrap();
    let records: Vec<serde_json::Value> = serde_json::from_slice(&catalog_bytes).unwrap();
    let record = records
        .iter()
        .find(|r| r.get("sessionId").and_then(|v| v.as_str()) == Some("sess-1"))
        .expect("sess-1 in catalog");
    assert_eq!(
        record.get("repoPath").and_then(|v| v.as_str()),
        Some(new_repo_str.as_str())
    );
    assert!(record
        .get("sessionPath")
        .and_then(|v| v.as_str())
        .unwrap()
        .starts_with(&new_sessions_dir.to_string_lossy().as_ref()));

    // 记忆库 rekey
    let new_memory = giteam_core::pi_agent::memory_db_path_for_repo(&target).unwrap();
    assert!(new_memory.exists());
    let conn = rusqlite::Connection::open(&new_memory).unwrap();
    let replay_path: String = conn
        .query_row("SELECT path FROM replay_state", [], |row| row.get(0))
        .unwrap();
    assert!(replay_path.starts_with(&new_sessions_dir.to_string_lossy().as_ref()));
    let input_json: String = conn
        .query_row("SELECT input_json FROM extraction_jobs", [], |row| row.get(0))
        .unwrap();
    assert!(input_json.contains(&new_repo_str));
    let props: String = conn
        .query_row("SELECT props FROM nodes", [], |row| row.get(0))
        .unwrap();
    assert!(props.contains(&new_repo_str));

    // 仓库注册（接收方 client.db）
    let client_db = receiver_home.join("client.db");
    let conn = rusqlite::Connection::open(&client_db).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM repositories WHERE path = ?1",
            rusqlite::params![new_repo_str],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}
