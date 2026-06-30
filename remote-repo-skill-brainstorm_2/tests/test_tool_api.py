from pathlib import Path

from fastapi.testclient import TestClient

from remote_repo_service.app import create_app
from remote_repo_service.config import RepoConfig, Settings


def make_client(tmp_path: Path, local_remote_repo: Path) -> tuple[TestClient, str]:
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
    client.post("/v1/repos/sync", json={"request_id": "req_sync", "repo_id": "demo"})
    created = client.post(
        "/v1/sessions",
        json={"request_id": "req_session", "repo_id": "demo", "ref_or_commit": "main"},
    ).json()
    return client, created["data"]["session_id"]


def test_tool_capabilities_api_lists_opencode_tool_mapping(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(storage_root=tmp_path / "storage")))

    response = client.post("/v1/tools", json={"request_id": "req_tools"}).json()

    assert response["ok"] is True
    tool_ids = {tool["id"] for tool in response["data"]["tools"]}
    assert {"bash", "read", "glob", "grep", "write", "edit", "apply_patch"}.issubset(tool_ids)


def test_file_find_and_grep_apis(tmp_path: Path, local_remote_repo: Path) -> None:
    client, session_id = make_client(tmp_path, local_remote_repo)

    listed = client.post(
        "/v1/files/list",
        json={"request_id": "req_list", "session_id": session_id, "path": "."},
    ).json()
    found = client.post(
        "/v1/find/files",
        json={"request_id": "req_find", "session_id": session_id, "query": "README"},
    ).json()
    grep = client.post(
        "/v1/find/text",
        json={"request_id": "req_grep", "session_id": session_id, "pattern": "Demo"},
    ).json()

    assert listed["ok"] is True
    assert any(entry["path"] == "README.md" for entry in listed["data"]["entries"])
    assert found["data"]["paths"] == ["README.md"]
    assert grep["data"]["matches"][0]["line_number"] == 1


def test_write_edit_and_apply_patch_apis(tmp_path: Path, local_remote_repo: Path) -> None:
    client, session_id = make_client(tmp_path, local_remote_repo)

    written = client.post(
        "/v1/files/write",
        json={"request_id": "req_write", "session_id": session_id, "path": "note.txt", "content": "alpha\n"},
    ).json()
    edited = client.post(
        "/v1/files/edit",
        json={
            "request_id": "req_edit",
            "session_id": session_id,
            "path": "note.txt",
            "old_text": "alpha",
            "new_text": "beta",
        },
    ).json()
    patch = """diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# Demo
+# API Patched Demo
"""
    patched = client.post(
        "/v1/files/apply-patch",
        json={"request_id": "req_patch", "session_id": session_id, "patch": patch},
    ).json()

    assert written["data"]["workspace_version"] == 2
    assert edited["data"]["workspace_version"] == 3
    assert patched["data"]["workspace_version"] == 4

    note = client.post(
        "/v1/files/read",
        json={"request_id": "req_read_note", "session_id": session_id, "path": "note.txt"},
    ).json()
    readme = client.post(
        "/v1/files/read",
        json={"request_id": "req_read_readme", "session_id": session_id, "path": "README.md"},
    ).json()

    assert note["data"]["content"] == "beta\n"
    assert readme["data"]["content"] == "# API Patched Demo\n"
