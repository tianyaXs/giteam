from pathlib import Path
import subprocess

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.git_ops import GitOps
from remote_repo_service.graph import GraphService, GraphTarget
from remote_repo_service.models import GraphStatus, GraphTargetType
from remote_repo_service.session_store import SessionStore


def test_workspace_graph_becomes_stale_after_version_change(tmp_path: Path, local_remote_repo: Path) -> None:
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
    settings.ensure_directories()
    git_ops = GitOps(settings)
    git_ops.sync_repo(settings.repos["demo"])
    store = SessionStore(settings, git_ops)
    session = store.create_session("demo", "main")
    graph = GraphService(settings, store)
    target = GraphTarget.workspace(session.session_id, session.workspace_id, session.workspace_version)

    graph.analyze(target, session.workspace_path)
    store.mark_after_command(session.session_id, "cmd_1", dirty=True, changed=True)

    status = graph.status(GraphTarget.workspace(session.session_id, session.workspace_id, 2))

    assert status.status == GraphStatus.stale
    assert status.target_type == GraphTargetType.session_workspace


def test_gitnexus_analysis_command_is_service_safe(tmp_path: Path, local_remote_repo: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        gitnexus_analyze_command=["gitnexus", "analyze"],
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
    graph = GraphService(settings, store)

    command = graph._analyze_command(GraphTarget.repo("demo", "abcdef1234567890"), tmp_path)

    assert command == [
        "gitnexus",
        "analyze",
        "--index-only",
        "--name",
        "giteam-demo-abcdef123456",
        "--allow-duplicate-name",
    ]


def test_non_gitnexus_analysis_command_is_left_alone(tmp_path: Path, local_remote_repo: Path) -> None:
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
    settings.ensure_directories()
    git_ops = GitOps(settings)
    git_ops.sync_repo(settings.repos["demo"])
    store = SessionStore(settings, git_ops)
    graph = GraphService(settings, store)

    command = graph._analyze_command(GraphTarget.repo("demo", "abcdef1234567890"), tmp_path)

    assert command == ["python", "-c", "import sys; sys.exit(0)"]


def test_graph_analysis_retries_after_incomplete_gitnexus_index(
    tmp_path: Path,
    local_remote_repo: Path,
    monkeypatch,
) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        gitnexus_analyze_command=["gitnexus", "analyze"],
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
    graph = GraphService(settings, store)
    cwd = tmp_path / "repo"
    (cwd / ".gitnexus").mkdir(parents=True)
    calls: list[list[str]] = []

    def fake_run(command, cwd, text, capture_output):
        calls.append(command)
        if len(calls) == 1:
            return subprocess.CompletedProcess(command, 1, "", "Analysis did not finalize: registry entry was not added")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr("remote_repo_service.graph.subprocess.run", fake_run)

    state = graph.analyze(GraphTarget.repo("demo", "abcdef1234567890"), cwd)

    assert state.status == GraphStatus.ready
    assert len(calls) == 2
    assert not (cwd / ".gitnexus").exists()
