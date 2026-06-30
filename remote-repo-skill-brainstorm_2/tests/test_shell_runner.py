from pathlib import Path

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.git_ops import GitOps
from remote_repo_service.session_store import SessionStore
from remote_repo_service.shell_runner import ShellRunner


def make_session(tmp_path: Path, local_remote_repo: Path):
    settings = Settings(
        storage_root=tmp_path / "storage",
        max_stdout_bytes=8,
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
    return settings, git_ops, store, session


def test_run_shell_updates_workspace_version_when_files_change(tmp_path: Path, local_remote_repo: Path) -> None:
    settings, git_ops, store, session = make_session(tmp_path, local_remote_repo)
    runner = ShellRunner(settings, git_ops, store)

    result = runner.run(session.session_id, "printf 'changed\n' > new.txt")

    assert result.exit_code == 0
    assert result.status_after != ""
    assert result.workspace_version == 2


def test_run_shell_truncates_stdout(tmp_path: Path, local_remote_repo: Path) -> None:
    settings, git_ops, store, session = make_session(tmp_path, local_remote_repo)
    runner = ShellRunner(settings, git_ops, store)

    result = runner.run(session.session_id, "printf '1234567890'")

    assert result.stdout == "12345678"
    assert result.stdout_truncated is True
