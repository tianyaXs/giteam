import json
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from remote_repo_service.app import create_app
from remote_repo_service.config import RepoConfig, Settings


def test_root_serves_frontend_page(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "storage")
    app = create_app(settings)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "Remote Workspace Console" in response.text
    assert "id=\"repo-catalog\"" in response.text
    assert "id=\"sync-selected\"" in response.text
    assert "id=\"workspace-summary\"" in response.text
    assert "data-operation=\"shell\"" in response.text
    assert "data-operation=\"files\"" in response.text
    assert "data-operation=\"graph\"" in response.text
    assert "fetch(\"/v1/dashboard\")" in response.text
    assert "dirty: Boolean(payload.data.status_after)" in response.text
    assert "API Test Matrix" not in response.text


def test_dashboard_endpoint_lists_connected_repositories(tmp_path: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo Repo",
                remote_url="git@gitlab.example:team/demo.git",
                default_ref="main",
            )
        },
    )
    client = TestClient(create_app(settings))

    response = client.get("/v1/dashboard").json()

    assert response["service"]["status"] == "ready"
    assert response["repos"] == [
        {
            "repo_id": "demo",
            "name": "Demo Repo",
            "provider": "gitlab",
            "origin": "gitlab.example/team/demo",
            "default_ref": "main",
            "default_commit": None,
            "sync_status": "stale",
            "error_message": None,
            "last_synced_at_ms": None,
            "auth_method": None,
        }
    ]


def test_configured_api_key_protects_service_endpoints(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "storage", api_keys=["server-secret"])
    client = TestClient(create_app(settings))

    denied = client.get("/v1/dashboard")
    allowed = client.get("/v1/dashboard", headers={"X-API-Key": "server-secret"})

    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "authentication_required"
    assert allowed.status_code == 200
    assert allowed.json()["service"]["status"] == "ready"


def test_service_allows_a_configured_giteam_web_origin(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(
        storage_root=tmp_path / "storage",
        cors_allowed_origins=["https://app.giteam.example"],
    )))

    response = client.options(
        "/v1/dashboard",
        headers={
            "Origin": "https://app.giteam.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://app.giteam.example"


def test_repo_list_exposes_safe_connection_metadata(tmp_path: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo Repo",
                remote_url="https://token:secret@github.com/acme/demo.git?private=1#fragment",
                default_ref="trunk",
            )
        },
    )
    client = TestClient(create_app(settings))

    payload = client.post("/v1/repos", json={"request_id": "req_repos"}).json()

    assert payload["ok"] is True
    assert payload["data"]["repos"] == [
        {
            "repo_id": "demo",
            "name": "Demo Repo",
            "provider": "github",
            "origin": "github.com/acme/demo",
            "default_ref": "trunk",
            "default_commit": None,
            "sync_status": "stale",
            "error_message": None,
            "last_synced_at_ms": None,
            "auth_method": None,
        }
    ]


def test_repo_list_reports_commit_and_last_sync_after_sync(tmp_path: Path, local_remote_repo: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo Repo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )
    client = TestClient(create_app(settings))

    synced = client.post("/v1/repos/sync", json={"request_id": "req_sync", "repo_id": "demo"}).json()
    repo = client.post("/v1/repos", json={"request_id": "req_repos"}).json()["data"]["repos"][0]

    assert synced["ok"] is True
    assert repo["sync_status"] == "connected"
    assert len(repo["default_commit"]) == 40
    assert repo["last_synced_at_ms"] is not None


def test_repo_code_resource_endpoints_read_branches_and_files_without_creating_a_session(
    tmp_path: Path,
    local_remote_repo: Path,
) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo Repo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )
    client = TestClient(create_app(settings))

    assert client.post("/v1/repos/sync", json={"request_id": "req_sync", "repo_id": "demo"}).json()["ok"] is True

    branches = client.post("/v1/repos/branches", json={"request_id": "req_branches", "repo_id": "demo"}).json()
    tree = client.post("/v1/repos/files/list", json={"request_id": "req_tree", "repo_id": "demo", "path": "."}).json()
    read = client.post(
        "/v1/repos/files/read",
        json={"request_id": "req_read", "repo_id": "demo", "path": "README.md", "start_line": 1},
    ).json()

    assert branches["ok"] is True
    assert branches["data"]["branches"] == [{
        "name": "main",
        "short_sha": branches["data"]["branches"][0]["short_sha"],
        "is_default": True,
    }]
    assert len(branches["data"]["branches"][0]["short_sha"]) == 7
    assert tree["ok"] is True
    assert tree["data"]["entries"] == [{
        "name": "README.md",
        "path": "README.md",
        "kind": "file",
        "short_sha": tree["data"]["entries"][0]["short_sha"],
    }]
    assert read["ok"] is True
    assert read["data"]["content"] == "# Demo\n"
    assert "session_id" not in branches["data"]
    assert "workspace_version" not in read["data"]


def test_repo_code_resource_endpoints_require_an_existing_mirror(tmp_path: Path, local_remote_repo: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(repo_id="demo", name="Demo Repo", remote_url=str(local_remote_repo)),
        },
    )
    client = TestClient(create_app(settings))

    response = client.post("/v1/repos/branches", json={"request_id": "req_branches", "repo_id": "demo"}).json()

    assert response["ok"] is False
    assert response["error"]["code"] == "repo_not_synced"


def test_create_app_loads_default_settings_from_env(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(tmp_path / "storage"),
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo Repo",
                        "remote_url": str(tmp_path / "remote.git"),
                        "default_ref": "main",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("REMOTE_REPO_SERVICE_CONFIG", str(config_path))
    app = create_app()
    client = TestClient(app)

    repos = client.post("/v1/repos", json={"request_id": "req_repos"}).json()

    assert repos["ok"] is True
    assert repos["data"]["repos"][0]["repo_id"] == "demo"


def test_session_shell_and_file_api(tmp_path: Path, local_remote_repo: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )
    app = create_app(settings)
    client = TestClient(app)

    sync = client.post("/v1/repos/sync", json={"request_id": "req_sync", "repo_id": "demo"})
    assert sync.json()["ok"] is True

    created = client.post(
        "/v1/sessions",
        json={"request_id": "req_create", "repo_id": "demo", "ref_or_commit": "main"},
    ).json()
    assert created["ok"] is True
    session_id = created["data"]["session_id"]

    shell = client.post(
        "/v1/shell/run",
        json={"request_id": "req_shell", "session_id": session_id, "command": "printf 'hello\n' > hello.txt"},
    ).json()
    assert shell["ok"] is True
    assert shell["data"]["workspace_version"] == 2

    file_response = client.post(
        "/v1/files/read",
        json={"request_id": "req_file", "session_id": session_id, "path": "hello.txt", "start_line": 1},
    ).json()
    assert file_response["ok"] is True
    assert file_response["data"]["content"] == "hello\n"


def test_create_session_reports_a_missing_ref_without_disguising_it_as_workspace_failure(
    tmp_path: Path,
    local_remote_repo: Path,
) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={"demo": RepoConfig(repo_id="demo", name="Demo", remote_url=str(local_remote_repo))},
    )
    client = TestClient(create_app(settings))
    assert client.post("/v1/repos/sync", json={"request_id": "req_sync", "repo_id": "demo"}).json()["ok"] is True

    response = client.post(
        "/v1/sessions",
        json={"request_id": "req_session", "repo_id": "demo", "ref_or_commit": "workspace-demo"},
    ).json()

    assert response["ok"] is False
    assert response["error"]["code"] == "ref_not_found"
    assert "workspace-demo" in response["error"]["message"]


def test_repo_head_graph_api_uses_repo_commit_target(tmp_path: Path, local_remote_repo: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        gitnexus_analyze_command=["python", "-c", "import sys; sys.exit(0)"],
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )
    app = create_app(settings)
    client = TestClient(app)

    client.post("/v1/repos/sync", json={"request_id": "req_sync", "repo_id": "demo"})

    analyzed = client.post(
        "/v1/graph/analyze",
        json={"request_id": "req_graph", "repo_id": "demo", "target_type": "repo_head"},
    ).json()
    status = client.post(
        "/v1/graph/status",
        json={"request_id": "req_status", "repo_id": "demo", "target_type": "repo_head"},
    ).json()

    assert analyzed["ok"] is True
    assert analyzed["data"]["status"] == "READY"
    assert status["ok"] is True
    assert status["data"]["target"]["target_type"] == "repo_head"


def test_repo_head_graph_status_is_scoped_to_requested_ref(tmp_path: Path, local_remote_repo: Path) -> None:
    work = tmp_path / "work"
    subprocess.run(["git", "clone", str(local_remote_repo), str(work)], check=True, text=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=work, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=work, check=True)
    subprocess.run(["git", "checkout", "-b", "web-dev"], cwd=work, check=True, text=True, capture_output=True)
    (work / "feature.txt").write_text("web-dev\n", encoding="utf-8")
    subprocess.run(["git", "add", "feature.txt"], cwd=work, check=True)
    subprocess.run(["git", "commit", "-m", "web dev"], cwd=work, check=True, text=True, capture_output=True)
    subprocess.run(["git", "push", "origin", "web-dev"], cwd=work, check=True, text=True, capture_output=True)

    settings = Settings(
        storage_root=tmp_path / "storage",
        gitnexus_analyze_command=["python", "-c", "import sys; sys.exit(0)"],
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )
    client = TestClient(create_app(settings))
    client.post("/v1/repos/sync", json={"request_id": "req_sync", "repo_id": "demo"})

    analyzed_main = client.post(
        "/v1/graph/analyze",
        json={"request_id": "req_graph_main", "repo_id": "demo", "target_type": "repo_head", "ref_or_commit": "main"},
    ).json()
    web_status = client.post(
        "/v1/graph/status",
        json={"request_id": "req_graph_web", "repo_id": "demo", "target_type": "repo_head", "ref_or_commit": "web-dev"},
    ).json()

    assert analyzed_main["ok"] is True
    assert analyzed_main["data"]["status"] == "READY"
    assert web_status["ok"] is True
    assert web_status["data"]["status"] == "STALE"
    assert web_status["data"]["target"]["commit"] != analyzed_main["data"]["target"]["commit"]


def test_add_repo_persists_config_and_queues_clone(tmp_path: Path, local_remote_repo: Path) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(tmp_path / "storage"),
                "repos": {},
            }
        ),
        encoding="utf-8",
    )
    settings = Settings.from_file(config_path)
    app = create_app(settings)
    client = TestClient(app)

    response = client.post(
        "/v1/repos/add",
        json={
            "request_id": "req_add",
            "repo_id": "demo",
            "name": "Demo",
            "remote_url": str(local_remote_repo),
            "default_ref": "main",
            "auth_method": "ssh_key",
        },
    ).json()

    assert response["ok"] is True
    assert response["data"]["repo_id"] == "demo"
    assert response["data"]["sync_queued"] is True

    reloaded = Settings.from_file(config_path)
    assert reloaded.repos["demo"].remote_url == str(local_remote_repo)
    assert reloaded.repos["demo"].auth_method == "ssh_key"


def test_add_repo_rejects_duplicate_repo_id(tmp_path: Path, local_remote_repo: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )
    app = create_app(settings)
    client = TestClient(app)

    response = client.post(
        "/v1/repos/add",
        json={
            "request_id": "req_add",
            "repo_id": "demo",
            "name": "Demo",
            "remote_url": str(local_remote_repo),
            "default_ref": "main",
        },
    ).json()

    assert response["ok"] is False
    assert response["error"]["code"] == "repo_id_exists"


def test_reload_config_updates_in_memory_settings_from_disk(tmp_path: Path, local_remote_repo: Path) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(tmp_path / "storage"),
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    settings = Settings.from_file(config_path)
    app = create_app(settings, config_path=config_path)
    client = TestClient(app)

    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(tmp_path / "storage"),
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    },
                    "extra": {
                        "repo_id": "extra",
                        "name": "Extra",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    response = client.post("/v1/config/reload", json={"request_id": "req_reload"}).json()

    assert response["ok"] is True
    assert any(repo["repo_id"] == "extra" for repo in response["data"]["repos"])

    dashboard = client.get("/v1/dashboard").json()
    assert any(repo["repo_id"] == "extra" for repo in dashboard["repos"])


def test_reload_config_removes_deleted_repo_from_persisted_state(tmp_path: Path, local_remote_repo: Path) -> None:
    config_path = tmp_path / "service.json"
    storage_root = tmp_path / "storage"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(storage_root),
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    },
                    "extra": {
                        "repo_id": "extra",
                        "name": "Extra",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    client = TestClient(create_app(Settings.from_file(config_path), config_path=config_path))

    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(storage_root),
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    response = client.post("/v1/config/reload", json={"request_id": "req_reload"}).json()
    restarted = TestClient(create_app(Settings(storage_root=storage_root)))
    repos_after_restart = restarted.post("/v1/repos", json={"request_id": "req_repos"}).json()["data"]["repos"]

    assert response["ok"] is True
    assert [repo["repo_id"] for repo in response["data"]["repos"]] == ["demo"]
    assert [repo["repo_id"] for repo in repos_after_restart] == ["demo"]


def test_remove_repo_persists_config_and_returns_removed_repo(tmp_path: Path, local_remote_repo: Path) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(tmp_path / "storage"),
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    settings = Settings.from_file(config_path)
    app = create_app(settings, config_path=config_path)
    client = TestClient(app)

    response = client.post("/v1/repos/remove", json={"request_id": "req_remove", "repo_id": "demo"}).json()

    assert response["ok"] is True
    assert response["data"]["repo_id"] == "demo"
    assert response["data"]["removed"] is True
    reloaded = Settings.from_file(config_path)
    assert "demo" not in reloaded.repos


def test_remove_repo_returns_error_for_unknown_repo_id(tmp_path: Path) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(json.dumps({"storage_root": str(tmp_path / "storage"), "repos": {}}), encoding="utf-8")
    settings = Settings.from_file(config_path)
    app = create_app(settings, config_path=config_path)
    client = TestClient(app)

    response = client.post("/v1/repos/remove", json={"request_id": "req_remove", "repo_id": "missing"}).json()

    assert response["ok"] is False
    assert response["error"]["code"] == "repo_not_found"


def test_update_repo_persists_config_changes(tmp_path: Path, local_remote_repo: Path) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(tmp_path / "storage"),
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo",
                        "remote_url": str(local_remote_repo),
                        "default_ref": "main",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    settings = Settings.from_file(config_path)
    app = create_app(settings, config_path=config_path)
    client = TestClient(app)

    response = client.post(
        "/v1/repos/update",
        json={
            "request_id": "req_update",
            "repo_id": "demo",
            "name": "Updated Demo",
            "default_ref": "develop",
            "auth_method": "ssh_key",
        },
    ).json()

    assert response["ok"] is True
    assert response["data"]["repo_id"] == "demo"
    assert response["data"]["updated"] is True
    reloaded = Settings.from_file(config_path)
    assert reloaded.repos["demo"].name == "Updated Demo"
    assert reloaded.repos["demo"].default_ref == "develop"
    assert reloaded.repos["demo"].auth_method == "ssh_key"


def test_update_repo_returns_error_for_unknown_repo_id(tmp_path: Path) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(json.dumps({"storage_root": str(tmp_path / "storage"), "repos": {}}), encoding="utf-8")
    settings = Settings.from_file(config_path)
    app = create_app(settings, config_path=config_path)
    client = TestClient(app)

    response = client.post(
        "/v1/repos/update",
        json={"request_id": "req_update", "repo_id": "missing", "name": "X"},
    ).json()

    assert response["ok"] is False
    assert response["error"]["code"] == "repo_not_found"


def test_reload_config_without_config_path_returns_error(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "storage")
    app = create_app(settings)
    client = TestClient(app)

    response = client.post("/v1/config/reload", json={"request_id": "req_reload"}).json()

    assert response["ok"] is False
    assert response["error"]["code"] == "config_path_not_set"
