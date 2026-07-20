from pathlib import Path

import asyncio
import subprocess
from unittest.mock import patch

import pytest

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.git_ops import GitCommandError, GitOps


def run_git(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, check=True, text=True, capture_output=True)


def test_sync_resolve_and_create_worktree(tmp_path: Path, local_remote_repo: Path) -> None:
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

    cache_path = git_ops.sync_repo(settings.repos["demo"])
    commit = git_ops.resolve_ref(cache_path, "main")
    workspace = settings.workspace_root / "ws_1"

    git_ops.create_worktree(cache_path, workspace, commit)

    assert (workspace / "README.md").read_text(encoding="utf-8") == "# Demo\n"
    assert git_ops.status_porcelain(workspace) == ""


def test_sync_fetches_all_remote_branches_for_existing_single_branch_cache(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    run_git(["git", "init", "-b", "main"], source)
    run_git(["git", "config", "user.email", "test@example.com"], source)
    run_git(["git", "config", "user.name", "Test User"], source)
    (source / "README.md").write_text("# Demo\n", encoding="utf-8")
    run_git(["git", "add", "README.md"], source)
    run_git(["git", "commit", "-m", "initial"], source)

    remote = tmp_path / "remote.git"
    run_git(["git", "clone", "--bare", str(source), str(remote)], tmp_path)
    run_git(["git", "remote", "add", "origin", str(remote)], source)

    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo",
                remote_url=str(remote),
                default_ref="main",
            )
        },
    )
    settings.ensure_directories()
    cache_path = settings.repo_cache_root / "demo.git"
    run_git(["git", "clone", "--single-branch", "--branch", "main", str(remote), str(cache_path)], tmp_path)

    run_git(["git", "checkout", "-b", "debug"], source)
    (source / "debug.txt").write_text("debug branch\n", encoding="utf-8")
    run_git(["git", "add", "debug.txt"], source)
    run_git(["git", "commit", "-m", "add debug branch"], source)
    run_git(["git", "push", "origin", "debug"], source)

    git_ops = GitOps(settings)

    git_ops.sync_repo(settings.repos["demo"])
    branches = git_ops.list_branches(settings.repos["demo"])

    assert [(branch.name, branch.is_default) for branch in branches] == [("main", True), ("debug", False)]
    assert git_ops.resolve_ref(cache_path, "debug") == run_git(["git", "rev-parse", "debug"], source).stdout.strip()


def test_git_command_timeout_becomes_a_repo_error(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "storage", command_timeout_seconds=7)
    git_ops = GitOps(settings)

    with patch("remote_repo_service.git_ops.subprocess.run", side_effect=subprocess.TimeoutExpired(["git", "fetch"], 7)):
        with pytest.raises(GitCommandError, match="timed out after 7 seconds"):
            git_ops._run(["git", "fetch"])


def test_ensure_worktree_reuses_existing_checkout(tmp_path: Path, local_remote_repo: Path) -> None:
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
    cache_path = git_ops.sync_repo(settings.repos["demo"])
    commit = git_ops.resolve_ref(cache_path, "main")
    workspace = settings.graph_worktree_root / f"demo-{commit[:12]}"

    first = git_ops.ensure_worktree(cache_path, workspace, commit)
    second = git_ops.ensure_worktree(cache_path, workspace, commit)

    assert first == second
    assert (second / "README.md").exists()


def test_ensure_worktree_can_clean_service_owned_checkout(tmp_path: Path, local_remote_repo: Path) -> None:
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
    cache_path = git_ops.sync_repo(settings.repos["demo"])
    commit = git_ops.resolve_ref(cache_path, "main")
    workspace = settings.graph_worktree_root / f"demo-{commit[:12]}"
    git_ops.ensure_worktree(cache_path, workspace, commit)
    (workspace / "AGENTS.md").write_text("generated\n", encoding="utf-8")
    (workspace / ".gitnexus").mkdir()
    (workspace / ".gitnexus" / "meta.json").write_text("{}\n", encoding="utf-8")

    git_ops.ensure_worktree(cache_path, workspace, commit, clean=True)

    assert not (workspace / "AGENTS.md").exists()
    assert (workspace / ".gitnexus" / "meta.json").exists()


@pytest.mark.anyio
async def test_queue_clone_schedules_background_task(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "storage")
    git_ops = GitOps(settings)
    repo = RepoConfig(repo_id="demo", name="Demo", remote_url=str(tmp_path / "remote.git"))

    git_ops.queue_clone(repo)

    assert len(git_ops._clone_tasks) == 1


@pytest.mark.anyio
async def test_schedule_clone_swallows_exceptions(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "storage")
    git_ops = GitOps(settings)
    repo = RepoConfig(repo_id="demo", name="Demo", remote_url=str(tmp_path / "remote.git"))

    with patch.object(git_ops, "sync_repo", side_effect=RuntimeError("boom")):
        await git_ops.schedule_clone(repo)

    # Should not raise.


@pytest.mark.anyio
async def test_cancel_clones_cancels_pending_tasks(tmp_path: Path) -> None:
    settings = Settings(storage_root=tmp_path / "storage")
    git_ops = GitOps(settings)
    repo = RepoConfig(repo_id="demo", name="Demo", remote_url=str(tmp_path / "remote.git"))

    started = asyncio.Event()

    async def slow_clone(_repo: RepoConfig) -> None:
        started.set()
        await asyncio.sleep(60)

    with patch.object(git_ops, "schedule_clone", slow_clone):
        git_ops.queue_clone(repo)
        await started.wait()

    await git_ops.cancel_clones(timeout=1.0)

    assert len(git_ops._clone_tasks) == 0
