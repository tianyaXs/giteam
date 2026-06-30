from pathlib import Path

from fastapi.testclient import TestClient

from remote_repo_service.app import create_app
from remote_repo_service.config import RepoConfig, Settings


def test_server_state_survives_a_service_restart(
    tmp_path: Path,
    local_remote_repo: Path,
) -> None:
    settings = Settings(
        storage_root=tmp_path / "persistent-service-data",
        gitnexus_analyze_command=["python", "-c", "import sys; sys.exit(0)"],
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Persistent Demo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )

    first = TestClient(create_app(settings))
    assert first.post("/v1/repos/sync", json={"request_id": "sync-1", "repo_id": "demo"}).json()["ok"] is True
    created = first.post(
        "/v1/sessions",
        json={"request_id": "create-1", "repo_id": "demo", "ref_or_commit": "main"},
    ).json()["data"]
    session_id = created["session_id"]
    workspace_id = created["workspace_id"]

    assert first.post(
        "/v1/files/write",
        json={"request_id": "write-1", "session_id": session_id, "path": "notes/persisted.txt", "content": "survives restart\n"},
    ).json()["ok"] is True
    assert first.post(
        "/v1/graph/analyze",
        json={"request_id": "graph-1", "session_id": session_id, "target_type": "session_workspace"},
    ).json()["data"]["status"] == "READY"

    # A fresh app object stands in for stopping and starting the server process
    # while retaining the same persistent server disk.
    # This deliberately omits `repos`: the restarted service must restore the
    # connection itself from storage_root/state.db, not reuse the first app's
    # Settings object or in-process repo map.
    restarted_settings = Settings(
        storage_root=settings.storage_root,
        gitnexus_analyze_command=settings.gitnexus_analyze_command,
    )
    second = TestClient(create_app(restarted_settings))
    repos = second.post("/v1/repos", json={"request_id": "repos-2"}).json()["data"]["repos"]
    restored = second.post("/v1/sessions/state", json={"request_id": "state-2", "session_id": session_id}).json()["data"]
    workspaces = second.get("/v1/repos/demo/workspaces").json()["data"]["workspaces"]
    workspace = second.get(f"/v1/workspaces/{workspace_id}").json()["data"]
    resumed = second.post(f"/v1/workspaces/{workspace_id}/resume", json={"request_id": "resume-2"}).json()["data"]
    contents = second.post(
        "/v1/files/read",
        json={"request_id": "read-2", "session_id": session_id, "path": "notes/persisted.txt", "start_line": 1},
    ).json()["data"]
    workspace_graph = second.post(
        "/v1/graph/status",
        json={"request_id": "graph-state-2", "session_id": session_id, "target_type": "session_workspace"},
    ).json()["data"]
    graph = second.get("/v1/repos/demo/gitnexus/status").json()["data"]
    activities = second.get("/v1/repos/demo/activities").json()["data"]["activities"]

    assert (settings.storage_root / "state.db").exists()
    assert repos[0]["sync_status"] == "connected"
    assert restored["workspace_id"] == workspace_id
    assert restored["dirty"] is True
    assert restored["workspace_version"] == 2
    assert workspaces[0]["workspace_id"] == workspace_id
    assert workspace["workspace_id"] == workspace_id
    assert resumed["session_id"] == session_id
    assert contents["content"] == "survives restart\n"
    assert workspace_graph["status"] == "READY"
    assert graph["status"] == "STALE"
    assert graph["target"]["target_type"] == "repo_head"
    assert any(activity["kind"] == "workspace_changed" for activity in activities)
    assert any(activity["kind"] == "gitnexus_analyzed" for activity in activities)


def test_workspace_operations_survive_a_service_restart(
    tmp_path: Path,
    local_remote_repo: Path,
) -> None:
    settings = Settings(
        storage_root=tmp_path / "persistent-service-data",
        gitnexus_analyze_command=["python", "-c", "import sys; sys.exit(0)"],
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Persistent Demo",
                remote_url=str(local_remote_repo),
                default_ref="main",
            )
        },
    )

    first = TestClient(create_app(settings))
    assert first.post("/v1/repos/sync", json={"request_id": "sync-ops", "repo_id": "demo"}).json()["ok"] is True
    created = first.post(
        "/v1/sessions",
        json={"request_id": "create-ops", "repo_id": "demo", "ref_or_commit": "main"},
    ).json()["data"]
    session_id = created["session_id"]
    workspace_id = created["workspace_id"]

    assert first.post(
        "/v1/shell/run",
        json={"request_id": "shell-ops", "session_id": session_id, "command": "printf 'hello ops\\n'"},
    ).json()["ok"] is True
    assert first.post(
        "/v1/files/read",
        json={"request_id": "read-ops", "session_id": session_id, "path": "README.md"},
    ).json()["ok"] is True
    assert first.post(
        "/v1/files/write",
        json={"request_id": "write-ops", "session_id": session_id, "path": "notes/ops.txt", "content": "logged\n"},
    ).json()["ok"] is True
    assert first.post(
        "/v1/graph/analyze",
        json={"request_id": "graph-ops", "session_id": session_id, "target_type": "session_workspace"},
    ).json()["ok"] is True

    restarted_settings = Settings(
        storage_root=settings.storage_root,
        gitnexus_analyze_command=settings.gitnexus_analyze_command,
    )
    second = TestClient(create_app(restarted_settings))
    payload = second.post(
        "/v1/workspaces/operations",
        json={"request_id": "ops-after-restart", "workspace_id": workspace_id},
    ).json()

    assert payload["ok"] is True
    operations = payload["data"]["operations"]
    kinds = {operation["kind"] for operation in operations}
    assert {"create_session", "shell", "read_file", "write_file", "gitnexus_analyze"} <= kinds
    assert all(operation["workspace_id"] == workspace_id for operation in operations)
    assert all(operation["session_id"] == session_id for operation in operations)

    shell = next(operation for operation in operations if operation["kind"] == "shell")
    assert shell["command"] == "printf 'hello ops\\n'"
    assert shell["stdout"] == "hello ops\n"
    assert shell["exit_code"] == 0

    write = next(operation for operation in operations if operation["kind"] == "write_file")
    assert write["path"] == "notes/ops.txt"
    assert write["workspace_version"] == 2
