from pathlib import Path

import pytest

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.file_reader import FileReader
from remote_repo_service.git_ops import GitOps
from remote_repo_service.session_store import SessionStore


def make_reader(tmp_path: Path, local_remote_repo: Path):
    settings = Settings(
        storage_root=tmp_path / "storage",
        max_file_slice_lines=2,
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
    (session.workspace_path / "multi.txt").write_text("a\nb\nc\n", encoding="utf-8")
    return FileReader(settings, store), session


def test_read_file_slice_is_bounded(tmp_path: Path, local_remote_repo: Path) -> None:
    reader, session = make_reader(tmp_path, local_remote_repo)

    result = reader.read(session.session_id, "multi.txt", start_line=1, max_lines=10)

    assert result.content == "a\nb\n"
    assert result.truncated is True


def test_read_file_slice_rejects_path_escape(tmp_path: Path, local_remote_repo: Path) -> None:
    reader, session = make_reader(tmp_path, local_remote_repo)

    with pytest.raises(ValueError, match="path escaped workspace"):
        reader.read(session.session_id, "../outside.txt", start_line=1, max_lines=1)
