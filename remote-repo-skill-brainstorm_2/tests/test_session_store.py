from pathlib import Path

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.git_ops import GitOps
from remote_repo_service.session_store import SessionStore


def test_create_session_pins_base_commit(tmp_path: Path, local_remote_repo: Path) -> None:
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
    state = store.get_session_state(session.session_id)

    assert state.base_commit == session.base_commit
    assert state.workspace_version == 1
    assert state.workspace_path.exists()
    assert state.dirty is False


def test_resume_workspace_reactivates_a_dormant_session(tmp_path: Path, local_remote_repo: Path) -> None:
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
    with store.state_store._connect() as connection:
        connection.execute("UPDATE sessions SET status = 'expired' WHERE session_id = ?", (session.session_id,))

    resumed = store.resume_workspace(session.workspace_id)

    assert resumed.session_id == session.session_id
    with store.state_store._connect() as connection:
        row = connection.execute("SELECT status FROM sessions WHERE session_id = ?", (session.session_id,)).fetchone()
    assert row is not None
    assert row["status"] == "active"
