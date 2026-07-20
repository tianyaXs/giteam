from pathlib import Path

import pytest

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.git_ops import GitOps
from remote_repo_service.session_store import SessionStore
from remote_repo_service.workspace_tools import WorkspaceTools


def make_tools(tmp_path: Path, local_remote_repo: Path):
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
    settings.ensure_directories()
    git_ops = GitOps(settings)
    git_ops.sync_repo(settings.repos["demo"])
    store = SessionStore(settings, git_ops)
    session = store.create_session("demo", "main")
    return WorkspaceTools(settings, git_ops, store), store, session


def test_workspace_tools_list_find_and_grep(tmp_path: Path, local_remote_repo: Path) -> None:
    tools, _, session = make_tools(tmp_path, local_remote_repo)

    files = tools.list_files(session.session_id, ".", max_entries=20)
    found = tools.find_files(session.session_id, "README", max_results=20)
    matches = tools.grep(session.session_id, "Demo", ".", max_results=20)

    assert any(entry.path == "README.md" and entry.type == "file" for entry in files)
    assert found == ["README.md"]
    assert matches[0].path == "README.md"
    assert matches[0].line_number == 1


def test_workspace_tools_write_and_edit_increment_version(tmp_path: Path, local_remote_repo: Path) -> None:
    tools, store, session = make_tools(tmp_path, local_remote_repo)

    written = tools.write_file(session.session_id, "notes/todo.txt", "first\n")
    edited = tools.edit_file(session.session_id, "notes/todo.txt", "first", "second", replace_all=False)

    assert written.workspace_version == 2
    assert edited.workspace_version == 3
    assert (session.workspace_path / "notes" / "todo.txt").read_text(encoding="utf-8") == "second\n"
    assert store.get_session_state(session.session_id).dirty is True


def test_workspace_tools_edit_rejects_missing_text(tmp_path: Path, local_remote_repo: Path) -> None:
    tools, _, session = make_tools(tmp_path, local_remote_repo)

    with pytest.raises(ValueError, match="old_text not found"):
        tools.edit_file(session.session_id, "README.md", "missing", "replacement", replace_all=False)


def test_workspace_tools_apply_patch_updates_tracked_file(tmp_path: Path, local_remote_repo: Path) -> None:
    tools, _, session = make_tools(tmp_path, local_remote_repo)
    patch = """diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# Demo
+# Patched Demo
"""

    result = tools.apply_patch(session.session_id, patch)

    assert result.applied is True
    assert result.workspace_version == 2
    assert (session.workspace_path / "README.md").read_text(encoding="utf-8") == "# Patched Demo\n"
