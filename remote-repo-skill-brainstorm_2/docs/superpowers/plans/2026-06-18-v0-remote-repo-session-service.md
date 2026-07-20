# V0 Remote Repo Session Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V0 OpenCode remote repository session service described in `docs/superpowers/specs/2026-06-18-v0-remote-repo-session-service-design.md`.

**Architecture:** Implement a small FastAPI service with an in-memory session registry, server-side Git cache/worktree management, bounded shell execution, bounded file slice reads, and a GitNexus analysis adapter. OpenCode never directly accesses code or execution environments; it calls server APIs that operate on commit-pinned session workspaces.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, pytest, httpx TestClient, Git CLI, GitNexus CLI invoked through a configurable subprocess command.

---

## File Structure

- `pyproject.toml`: package metadata, dependencies, pytest configuration.
- `src/remote_repo_service/__init__.py`: package marker.
- `src/remote_repo_service/config.py`: environment-driven service settings and configured repo definitions.
- `src/remote_repo_service/models.py`: Pydantic request/response models and shared enums.
- `src/remote_repo_service/git_ops.py`: safe Git subprocess wrapper, repo cache sync, ref resolution, reusable worktree creation, status/diff summaries.
- `src/remote_repo_service/session_store.py`: in-memory repo/session/workspace state.
- `src/remote_repo_service/shell_runner.py`: bounded workspace shell execution.
- `src/remote_repo_service/file_reader.py`: bounded repo-relative file slice reads.
- `src/remote_repo_service/graph.py`: GitNexus target/status tracking and analyze command adapter.
- `src/remote_repo_service/app.py`: FastAPI app and route handlers.
- `tests/conftest.py`: temp Git repository fixtures and app fixtures.
- `tests/test_config.py`: settings tests.
- `tests/test_models.py`: model serialization and validation tests.
- `tests/test_git_ops.py`: Git cache, ref resolution, and worktree tests.
- `tests/test_session_store.py`: session creation and immutable base commit tests.
- `tests/test_shell_runner.py`: command execution, workspace dirty state, and bounds tests.
- `tests/test_file_reader.py`: file slice and path boundary tests.
- `tests/test_graph.py`: graph target version binding tests.
- `tests/test_app.py`: end-to-end API tests with FastAPI TestClient.

## Task 1: Project Skeleton And Settings

**Files:**
- Create: `pyproject.toml`
- Create: `src/remote_repo_service/__init__.py`
- Create: `src/remote_repo_service/config.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: Write the failing settings test**

Create `tests/test_config.py`:

```python
from pathlib import Path

from remote_repo_service.config import RepoConfig, Settings


def test_settings_create_storage_directories(tmp_path: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        command_timeout_seconds=3,
        max_stdout_bytes=100,
        max_stderr_bytes=100,
        max_diff_bytes=100,
        max_file_slice_bytes=100,
        max_file_slice_lines=10,
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo",
                remote_url=str(tmp_path / "remote.git"),
                default_ref="main",
            )
        },
    )

    settings.ensure_directories()

    assert settings.repo_cache_root.exists()
    assert settings.workspace_root.exists()
    assert settings.graph_worktree_root.exists()
```

- [ ] **Step 2: Run the settings test and verify it fails**

Run: `pytest tests/test_config.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service'`.

- [ ] **Step 3: Add package metadata**

Create `pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "remote-repo-service"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "pydantic>=2.8",
  "uvicorn>=0.30",
]

[project.optional-dependencies]
dev = [
  "httpx>=0.27",
  "pytest>=8.2",
]

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 4: Add settings implementation**

Create `src/remote_repo_service/__init__.py`:

```python
__all__ = ["__version__"]

__version__ = "0.1.0"
```

Create `src/remote_repo_service/config.py`:

```python
from pathlib import Path

from pydantic import BaseModel, Field


class RepoConfig(BaseModel):
    repo_id: str
    name: str
    remote_url: str
    default_ref: str = "main"


class Settings(BaseModel):
    storage_root: Path = Field(default=Path(".remote-repo-service"))
    command_timeout_seconds: int = 30
    max_stdout_bytes: int = 64_000
    max_stderr_bytes: int = 64_000
    max_diff_bytes: int = 64_000
    max_file_slice_bytes: int = 24_000
    max_file_slice_lines: int = 120
    gitnexus_analyze_command: list[str] = Field(default_factory=lambda: ["npx", "gitnexus", "analyze"])
    repos: dict[str, RepoConfig] = Field(default_factory=dict)

    @property
    def repo_cache_root(self) -> Path:
        return self.storage_root / "repos"

    @property
    def workspace_root(self) -> Path:
        return self.storage_root / "workspaces"

    @property
    def graph_worktree_root(self) -> Path:
        return self.storage_root / "graph-worktrees"

    def ensure_directories(self) -> None:
        self.repo_cache_root.mkdir(parents=True, exist_ok=True)
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.graph_worktree_root.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 5: Run the settings test and verify it passes**

Run: `pytest tests/test_config.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml src/remote_repo_service/__init__.py src/remote_repo_service/config.py tests/test_config.py
git commit -m "feat: add service settings"
```

## Task 2: Shared API Models

**Files:**
- Create: `src/remote_repo_service/models.py`
- Test: `tests/test_models.py`

- [ ] **Step 1: Write model tests**

Create `tests/test_models.py`:

```python
from remote_repo_service.models import (
    ApiError,
    ErrorResponse,
    GraphStatus,
    GraphTargetType,
    RunShellRequest,
    SuccessResponse,
)


def test_success_response_contains_state_summary() -> None:
    response = SuccessResponse(
        request_id="req_1",
        session_id="sess_1",
        state={"workspace_version": 2},
        data={"ok": True},
    )

    assert response.ok is True
    assert response.state["workspace_version"] == 2


def test_error_response_contains_retryable_flag() -> None:
    response = ErrorResponse(
        request_id="req_1",
        session_id="sess_1",
        state={"workspace_version": 2},
        error=ApiError(code="command_timed_out", message="Command timed out", retryable=True),
    )

    assert response.ok is False
    assert response.error.retryable is True


def test_run_shell_request_requires_command() -> None:
    request = RunShellRequest(request_id="req_1", session_id="sess_1", command="git status")

    assert request.command == "git status"


def test_graph_enums_match_spec() -> None:
    assert GraphTargetType.repo_head.value == "repo_head"
    assert GraphTargetType.session_workspace.value == "session_workspace"
    assert GraphStatus.ready.value == "READY"
```

- [ ] **Step 2: Run model tests and verify they fail**

Run: `pytest tests/test_models.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.models'`.

- [ ] **Step 3: Add models**

Create `src/remote_repo_service/models.py`:

```python
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class GraphStatus(str, Enum):
    ready = "READY"
    stale = "STALE"
    indexing = "INDEXING"
    failed = "FAILED"


class GraphTargetType(str, Enum):
    repo_head = "repo_head"
    session_workspace = "session_workspace"


class ApiError(BaseModel):
    code: str
    message: str
    retryable: bool
    details: dict[str, Any] = Field(default_factory=dict)


class SuccessResponse(BaseModel):
    ok: Literal[True] = True
    request_id: str
    repo_id: str | None = None
    session_id: str | None = None
    state: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    ok: Literal[False] = False
    request_id: str
    repo_id: str | None = None
    session_id: str | None = None
    state: dict[str, Any] = Field(default_factory=dict)
    error: ApiError


class ListReposRequest(BaseModel):
    request_id: str


class SyncRepoRequest(BaseModel):
    request_id: str
    repo_id: str


class CreateSessionRequest(BaseModel):
    request_id: str
    repo_id: str
    ref_or_commit: str


class SessionRequest(BaseModel):
    request_id: str
    session_id: str


class RunShellRequest(SessionRequest):
    command: str
    cwd: str = "."


class ReadFileSliceRequest(SessionRequest):
    path: str
    start_line: int = 1
    max_lines: int | None = None


class AnalyzeGraphRequest(BaseModel):
    request_id: str
    repo_id: str | None = None
    session_id: str | None = None
    target_type: GraphTargetType = GraphTargetType.repo_head


class GetGraphStatusRequest(AnalyzeGraphRequest):
    pass
```

- [ ] **Step 4: Run model tests and verify they pass**

Run: `pytest tests/test_models.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/models.py tests/test_models.py
git commit -m "feat: add API models"
```

## Task 3: Git Cache And Worktree Operations

**Files:**
- Create: `src/remote_repo_service/git_ops.py`
- Create: `tests/conftest.py`
- Test: `tests/test_git_ops.py`

- [ ] **Step 1: Write Git operation tests**

Create `tests/conftest.py`:

```python
import subprocess
from pathlib import Path

import pytest


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, check=True, text=True, capture_output=True)


@pytest.fixture
def local_remote_repo(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    run(["git", "init", "-b", "main"], source)
    run(["git", "config", "user.email", "test@example.com"], source)
    run(["git", "config", "user.name", "Test User"], source)
    (source / "README.md").write_text("# Demo\n", encoding="utf-8")
    run(["git", "add", "README.md"], source)
    run(["git", "commit", "-m", "initial"], source)

    remote = tmp_path / "remote.git"
    run(["git", "clone", "--bare", str(source), str(remote)], tmp_path)
    return remote
```

Create `tests/test_git_ops.py`:

```python
from pathlib import Path

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.git_ops import GitOps


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
```

- [ ] **Step 2: Run Git operation tests and verify they fail**

Run: `pytest tests/test_git_ops.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.git_ops'`.

- [ ] **Step 3: Add Git operation implementation**

Create `src/remote_repo_service/git_ops.py`:

```python
import subprocess
from pathlib import Path

from remote_repo_service.config import RepoConfig, Settings


class GitCommandError(RuntimeError):
    def __init__(self, command: list[str], stderr: str) -> None:
        super().__init__(f"Git command failed: {' '.join(command)}\n{stderr}")
        self.command = command
        self.stderr = stderr


class GitOps:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _run(self, args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        completed = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
        if completed.returncode != 0:
            raise GitCommandError(args, completed.stderr)
        return completed

    def cache_path(self, repo_id: str) -> Path:
        return self.settings.repo_cache_root / f"{repo_id}.git"

    def sync_repo(self, repo: RepoConfig) -> Path:
        cache_path = self.cache_path(repo.repo_id)
        if cache_path.exists():
            self._run(["git", "fetch", "--prune", "origin"], cache_path)
        else:
            self._run(["git", "clone", "--mirror", repo.remote_url, str(cache_path)])
        return cache_path

    def resolve_ref(self, cache_path: Path, ref_or_commit: str) -> str:
        completed = self._run(["git", "rev-parse", f"{ref_or_commit}^{{commit}}"], cache_path)
        return completed.stdout.strip()

    def create_worktree(self, cache_path: Path, workspace_path: Path, commit: str) -> None:
        workspace_path.parent.mkdir(parents=True, exist_ok=True)
        self._run(["git", "worktree", "add", "--detach", str(workspace_path), commit], cache_path)

    def ensure_worktree(self, cache_path: Path, workspace_path: Path, commit: str) -> Path:
        if workspace_path.exists():
            current = self._run(["git", "rev-parse", "HEAD"], workspace_path).stdout.strip()
            if current == commit:
                return workspace_path
            raise GitCommandError(["git", "worktree", "add", str(workspace_path), commit], "existing worktree has a different HEAD")
        self.create_worktree(cache_path, workspace_path, commit)
        return workspace_path

    def status_porcelain(self, workspace_path: Path) -> str:
        completed = self._run(["git", "status", "--porcelain"], workspace_path)
        return completed.stdout

    def diff_summary(self, workspace_path: Path, max_bytes: int) -> tuple[str, bool]:
        completed = self._run(["git", "diff", "--stat"], workspace_path)
        data = completed.stdout.encode("utf-8")
        truncated = len(data) > max_bytes
        if truncated:
            data = data[:max_bytes]
        return data.decode("utf-8", errors="replace"), truncated
```

- [ ] **Step 4: Run Git operation tests and verify they pass**

Run: `pytest tests/test_git_ops.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/git_ops.py tests/conftest.py tests/test_git_ops.py
git commit -m "feat: add git cache operations"
```

## Task 4: Session Store And Immutable Workspace Baseline

**Files:**
- Create: `src/remote_repo_service/session_store.py`
- Test: `tests/test_session_store.py`

- [ ] **Step 1: Write session store tests**

Create `tests/test_session_store.py`:

```python
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
```

- [ ] **Step 2: Run session tests and verify they fail**

Run: `pytest tests/test_session_store.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.session_store'`.

- [ ] **Step 3: Add session store implementation**

Create `src/remote_repo_service/session_store.py`:

```python
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from remote_repo_service.config import Settings
from remote_repo_service.git_ops import GitOps


@dataclass
class WorkspaceState:
    workspace_id: str
    repo_id: str
    base_commit: str
    workspace_path: Path
    workspace_version: int
    dirty: bool
    last_command_id: str | None = None


@dataclass
class SessionState:
    session_id: str
    repo_id: str
    workspace_id: str
    base_commit: str
    workspace_path: Path
    workspace_version: int
    dirty: bool
    last_command_id: str | None = None


class SessionStore:
    def __init__(self, settings: Settings, git_ops: GitOps) -> None:
        self.settings = settings
        self.git_ops = git_ops
        self.sessions: dict[str, SessionState] = {}
        self.workspaces: dict[str, WorkspaceState] = {}

    def create_session(self, repo_id: str, ref_or_commit: str) -> SessionState:
        repo = self.settings.repos[repo_id]
        cache_path = self.git_ops.cache_path(repo_id)
        base_commit = self.git_ops.resolve_ref(cache_path, ref_or_commit)
        session_id = f"sess_{uuid4().hex}"
        workspace_id = f"ws_{uuid4().hex}"
        workspace_path = self.settings.workspace_root / workspace_id
        self.git_ops.create_worktree(cache_path, workspace_path, base_commit)
        workspace = WorkspaceState(
            workspace_id=workspace_id,
            repo_id=repo_id,
            base_commit=base_commit,
            workspace_path=workspace_path,
            workspace_version=1,
            dirty=False,
        )
        session = SessionState(
            session_id=session_id,
            repo_id=repo_id,
            workspace_id=workspace_id,
            base_commit=base_commit,
            workspace_path=workspace_path,
            workspace_version=1,
            dirty=False,
        )
        self.workspaces[workspace_id] = workspace
        self.sessions[session_id] = session
        return session

    def get_session_state(self, session_id: str) -> SessionState:
        return self.sessions[session_id]

    def mark_after_command(self, session_id: str, command_id: str, dirty: bool, changed: bool) -> SessionState:
        session = self.sessions[session_id]
        version = session.workspace_version + 1 if changed else session.workspace_version
        updated = SessionState(
            session_id=session.session_id,
            repo_id=session.repo_id,
            workspace_id=session.workspace_id,
            base_commit=session.base_commit,
            workspace_path=session.workspace_path,
            workspace_version=version,
            dirty=dirty,
            last_command_id=command_id,
        )
        self.sessions[session_id] = updated
        workspace = self.workspaces[session.workspace_id]
        self.workspaces[session.workspace_id] = WorkspaceState(
            workspace_id=workspace.workspace_id,
            repo_id=workspace.repo_id,
            base_commit=workspace.base_commit,
            workspace_path=workspace.workspace_path,
            workspace_version=version,
            dirty=dirty,
            last_command_id=command_id,
        )
        return updated
```

- [ ] **Step 4: Run session tests and verify they pass**

Run: `pytest tests/test_session_store.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/session_store.py tests/test_session_store.py
git commit -m "feat: add session workspaces"
```

## Task 5: Bounded Shell Runner

**Files:**
- Create: `src/remote_repo_service/shell_runner.py`
- Test: `tests/test_shell_runner.py`

- [ ] **Step 1: Write shell runner tests**

Create `tests/test_shell_runner.py`:

```python
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

    result = runner.run(session.session_id, "printf 'changed\\n' > new.txt")

    assert result.exit_code == 0
    assert result.status_after != ""
    assert result.workspace_version == 2


def test_run_shell_truncates_stdout(tmp_path: Path, local_remote_repo: Path) -> None:
    settings, git_ops, store, session = make_session(tmp_path, local_remote_repo)
    runner = ShellRunner(settings, git_ops, store)

    result = runner.run(session.session_id, "printf '1234567890'")

    assert result.stdout == "12345678"
    assert result.stdout_truncated is True
```

- [ ] **Step 2: Run shell runner tests and verify they fail**

Run: `pytest tests/test_shell_runner.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.shell_runner'`.

- [ ] **Step 3: Add shell runner implementation**

Create `src/remote_repo_service/shell_runner.py`:

```python
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from remote_repo_service.config import Settings
from remote_repo_service.git_ops import GitOps
from remote_repo_service.session_store import SessionStore


@dataclass
class ShellResult:
    command_id: str
    cwd: str
    exit_code: int
    stdout: str
    stderr: str
    elapsed_ms: int
    timed_out: bool
    stdout_truncated: bool
    stderr_truncated: bool
    diff_truncated: bool
    status_before: str
    status_after: str
    diff_summary: str
    workspace_version: int


class ShellRunner:
    def __init__(self, settings: Settings, git_ops: GitOps, store: SessionStore) -> None:
        self.settings = settings
        self.git_ops = git_ops
        self.store = store

    def _resolve_cwd(self, workspace_path: Path, cwd: str) -> Path:
        resolved = (workspace_path / cwd).resolve()
        root = workspace_path.resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError("cwd escaped workspace")
        return resolved

    def _bound(self, value: str, max_bytes: int) -> tuple[str, bool]:
        data = value.encode("utf-8")
        truncated = len(data) > max_bytes
        if truncated:
            data = data[:max_bytes]
        return data.decode("utf-8", errors="replace"), truncated

    def run(self, session_id: str, command: str, cwd: str = ".") -> ShellResult:
        session = self.store.get_session_state(session_id)
        command_id = f"cmd_{uuid4().hex}"
        run_cwd = self._resolve_cwd(session.workspace_path, cwd)
        status_before = self.git_ops.status_porcelain(session.workspace_path)
        started = time.monotonic()
        timed_out = False
        try:
            completed = subprocess.run(
                command,
                cwd=run_cwd,
                shell=True,
                text=True,
                capture_output=True,
                timeout=self.settings.command_timeout_seconds,
            )
            exit_code = completed.returncode
            stdout = completed.stdout
            stderr = completed.stderr
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            exit_code = 124
            stdout = exc.stdout or ""
            stderr = exc.stderr or "command timed out"
        elapsed_ms = int((time.monotonic() - started) * 1000)
        status_after = self.git_ops.status_porcelain(session.workspace_path)
        diff_summary, diff_truncated = self.git_ops.diff_summary(session.workspace_path, self.settings.max_diff_bytes)
        bounded_stdout, stdout_truncated = self._bound(stdout, self.settings.max_stdout_bytes)
        bounded_stderr, stderr_truncated = self._bound(stderr, self.settings.max_stderr_bytes)
        changed = status_before != status_after
        dirty = status_after != ""
        updated = self.store.mark_after_command(session_id, command_id, dirty=dirty, changed=changed)
        return ShellResult(
            command_id=command_id,
            cwd=str(run_cwd.relative_to(session.workspace_path)),
            exit_code=exit_code,
            stdout=bounded_stdout,
            stderr=bounded_stderr,
            elapsed_ms=elapsed_ms,
            timed_out=timed_out,
            stdout_truncated=stdout_truncated,
            stderr_truncated=stderr_truncated,
            diff_truncated=diff_truncated,
            status_before=status_before,
            status_after=status_after,
            diff_summary=diff_summary,
            workspace_version=updated.workspace_version,
        )
```

- [ ] **Step 4: Run shell runner tests and verify they pass**

Run: `pytest tests/test_shell_runner.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/shell_runner.py tests/test_shell_runner.py
git commit -m "feat: add bounded shell runner"
```

## Task 6: Bounded File Slice Reader

**Files:**
- Create: `src/remote_repo_service/file_reader.py`
- Test: `tests/test_file_reader.py`

- [ ] **Step 1: Write file reader tests**

Create `tests/test_file_reader.py`:

```python
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
    (session.workspace_path / "multi.txt").write_text("a\\nb\\nc\\n", encoding="utf-8")
    return FileReader(settings, store), session


def test_read_file_slice_is_bounded(tmp_path: Path, local_remote_repo: Path) -> None:
    reader, session = make_reader(tmp_path, local_remote_repo)

    result = reader.read(session.session_id, "multi.txt", start_line=1, max_lines=10)

    assert result.content == "a\\nb\\n"
    assert result.truncated is True


def test_read_file_slice_rejects_path_escape(tmp_path: Path, local_remote_repo: Path) -> None:
    reader, session = make_reader(tmp_path, local_remote_repo)

    with pytest.raises(ValueError, match="path escaped workspace"):
        reader.read(session.session_id, "../outside.txt", start_line=1, max_lines=1)
```

- [ ] **Step 2: Run file reader tests and verify they fail**

Run: `pytest tests/test_file_reader.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.file_reader'`.

- [ ] **Step 3: Add file reader implementation**

Create `src/remote_repo_service/file_reader.py`:

```python
import hashlib
from dataclasses import dataclass
from pathlib import Path

from remote_repo_service.config import Settings
from remote_repo_service.session_store import SessionStore


@dataclass
class FileSlice:
    path: str
    start_line: int
    end_line: int
    content: str
    truncated: bool
    sha256: str
    workspace_version: int


class FileReader:
    def __init__(self, settings: Settings, store: SessionStore) -> None:
        self.settings = settings
        self.store = store

    def _resolve_path(self, workspace_path: Path, path: str) -> Path:
        if Path(path).is_absolute():
            raise ValueError("path escaped workspace")
        resolved = (workspace_path / path).resolve()
        root = workspace_path.resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError("path escaped workspace")
        return resolved

    def read(self, session_id: str, path: str, start_line: int, max_lines: int | None) -> FileSlice:
        session = self.store.get_session_state(session_id)
        file_path = self._resolve_path(session.workspace_path, path)
        raw = file_path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        text = raw.decode("utf-8", errors="replace")
        requested_lines = max_lines if max_lines is not None else self.settings.max_file_slice_lines
        effective_lines = min(requested_lines, self.settings.max_file_slice_lines)
        lines = text.splitlines(keepends=True)
        start_index = max(start_line - 1, 0)
        selected = lines[start_index : start_index + effective_lines]
        content = "".join(selected)
        encoded = content.encode("utf-8")
        byte_truncated = len(encoded) > self.settings.max_file_slice_bytes
        if byte_truncated:
            encoded = encoded[: self.settings.max_file_slice_bytes]
            content = encoded.decode("utf-8", errors="replace")
        line_truncated = start_index + effective_lines < len(lines)
        return FileSlice(
            path=path,
            start_line=start_line,
            end_line=start_line + len(selected) - 1,
            content=content,
            truncated=line_truncated or byte_truncated,
            sha256=digest,
            workspace_version=session.workspace_version,
        )
```

- [ ] **Step 4: Run file reader tests and verify they pass**

Run: `pytest tests/test_file_reader.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/file_reader.py tests/test_file_reader.py
git commit -m "feat: add bounded file slice reader"
```

## Task 7: GitNexus Graph Status Adapter

**Files:**
- Create: `src/remote_repo_service/graph.py`
- Test: `tests/test_graph.py`

- [ ] **Step 1: Write graph tests**

Create `tests/test_graph.py`:

```python
from pathlib import Path

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
```

- [ ] **Step 2: Run graph tests and verify they fail**

Run: `pytest tests/test_graph.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.graph'`.

- [ ] **Step 3: Add graph service implementation**

Create `src/remote_repo_service/graph.py`:

```python
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from remote_repo_service.config import Settings
from remote_repo_service.models import GraphStatus, GraphTargetType
from remote_repo_service.session_store import SessionStore


@dataclass(frozen=True)
class GraphTarget:
    target_type: GraphTargetType
    repo_id: str | None = None
    commit: str | None = None
    session_id: str | None = None
    workspace_id: str | None = None
    workspace_version: int | None = None

    @staticmethod
    def repo(repo_id: str, commit: str) -> "GraphTarget":
        return GraphTarget(target_type=GraphTargetType.repo_head, repo_id=repo_id, commit=commit)

    @staticmethod
    def workspace(session_id: str, workspace_id: str, workspace_version: int) -> "GraphTarget":
        return GraphTarget(
            target_type=GraphTargetType.session_workspace,
            session_id=session_id,
            workspace_id=workspace_id,
            workspace_version=workspace_version,
        )


@dataclass
class GraphState:
    target: GraphTarget
    status: GraphStatus
    last_indexed_at: str | None
    error: str | None = None

    @property
    def target_type(self) -> GraphTargetType:
        return self.target.target_type


class GraphService:
    def __init__(self, settings: Settings, store: SessionStore) -> None:
        self.settings = settings
        self.store = store
        self.states: dict[GraphTarget, GraphState] = {}

    def analyze(self, target: GraphTarget, cwd: Path) -> GraphState:
        self.states[target] = GraphState(target=target, status=GraphStatus.indexing, last_indexed_at=None)
        completed = subprocess.run(self.settings.gitnexus_analyze_command, cwd=cwd, text=True, capture_output=True)
        if completed.returncode == 0:
            state = GraphState(
                target=target,
                status=GraphStatus.ready,
                last_indexed_at=datetime.now(timezone.utc).isoformat(),
            )
        else:
            state = GraphState(
                target=target,
                status=GraphStatus.failed,
                last_indexed_at=None,
                error=completed.stderr,
            )
        self.states[target] = state
        return state

    def status(self, target: GraphTarget) -> GraphState:
        exact = self.states.get(target)
        if exact is not None:
            return exact
        if target.target_type == GraphTargetType.session_workspace and target.workspace_id is not None:
            previous = [
                state
                for state in self.states.values()
                if state.target.target_type == GraphTargetType.session_workspace
                and state.target.workspace_id == target.workspace_id
            ]
            if previous:
                return GraphState(target=target, status=GraphStatus.stale, last_indexed_at=previous[-1].last_indexed_at)
        return GraphState(target=target, status=GraphStatus.stale, last_indexed_at=None)
```

- [ ] **Step 4: Run graph tests and verify they pass**

Run: `pytest tests/test_graph.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/graph.py tests/test_graph.py
git commit -m "feat: add GitNexus graph adapter"
```

## Task 8: FastAPI Routes And End-To-End API

**Files:**
- Create: `src/remote_repo_service/app.py`
- Test: `tests/test_app.py`

- [ ] **Step 1: Write API tests**

Create `tests/test_app.py`:

```python
from pathlib import Path

from fastapi.testclient import TestClient

from remote_repo_service.app import create_app
from remote_repo_service.config import RepoConfig, Settings


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
        json={"request_id": "req_shell", "session_id": session_id, "command": "printf 'hello\\n' > hello.txt"},
    ).json()
    assert shell["ok"] is True
    assert shell["data"]["workspace_version"] == 2

    file_response = client.post(
        "/v1/files/read",
        json={"request_id": "req_file", "session_id": session_id, "path": "hello.txt", "start_line": 1},
    ).json()
    assert file_response["ok"] is True
    assert file_response["data"]["content"] == "hello\\n"


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
```

- [ ] **Step 2: Run API tests and verify they fail**

Run: `pytest tests/test_app.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.app'`.

- [ ] **Step 3: Add FastAPI application**

Create `src/remote_repo_service/app.py`:

```python
from dataclasses import asdict, is_dataclass
from typing import Any

from fastapi import FastAPI

from remote_repo_service.config import Settings
from remote_repo_service.file_reader import FileReader
from remote_repo_service.git_ops import GitOps
from remote_repo_service.graph import GraphService, GraphTarget
from remote_repo_service.models import (
    AnalyzeGraphRequest,
    ApiError,
    CreateSessionRequest,
    ErrorResponse,
    GetGraphStatusRequest,
    ListReposRequest,
    ReadFileSliceRequest,
    RunShellRequest,
    SessionRequest,
    SuccessResponse,
    SyncRepoRequest,
)
from remote_repo_service.session_store import SessionStore
from remote_repo_service.shell_runner import ShellRunner


def encode(value: Any) -> Any:
    if is_dataclass(value):
        return {key: encode(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: encode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [encode(item) for item in value]
    return value


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.ensure_directories()
    git_ops = GitOps(settings)
    store = SessionStore(settings, git_ops)
    shell_runner = ShellRunner(settings, git_ops, store)
    file_reader = FileReader(settings, store)
    graph_service = GraphService(settings, store)
    app = FastAPI(title="Remote Repo Service", version="0.1.0")

    def success(request_id: str, data: dict[str, Any], repo_id: str | None = None, session_id: str | None = None) -> dict[str, Any]:
        return SuccessResponse(
            request_id=request_id,
            repo_id=repo_id,
            session_id=session_id,
            data=data,
        ).model_dump()

    def failure(request_id: str, code: str, message: str, retryable: bool, repo_id: str | None = None, session_id: str | None = None) -> dict[str, Any]:
        return ErrorResponse(
            request_id=request_id,
            repo_id=repo_id,
            session_id=session_id,
            error=ApiError(code=code, message=message, retryable=retryable),
        ).model_dump()

    @app.post("/v1/repos")
    def list_repos(request: ListReposRequest) -> dict[str, Any]:
        repos = [
            {
                "repo_id": repo.repo_id,
                "name": repo.name,
                "provider": "gitlab",
                "default_ref": repo.default_ref,
            }
            for repo in settings.repos.values()
        ]
        return success(request.request_id, {"repos": repos})

    @app.post("/v1/repos/sync")
    def sync_repo(request: SyncRepoRequest) -> dict[str, Any]:
        repo = settings.repos.get(request.repo_id)
        if repo is None:
            return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
        cache_path = git_ops.sync_repo(repo)
        return success(request.request_id, {"cache_path": str(cache_path)}, repo_id=request.repo_id)

    @app.post("/v1/sessions")
    def create_session(request: CreateSessionRequest) -> dict[str, Any]:
        try:
            session = store.create_session(request.repo_id, request.ref_or_commit)
        except KeyError:
            return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
        except Exception as exc:
            return failure(request.request_id, "workspace_creation_failed", str(exc), True, repo_id=request.repo_id)
        return success(request.request_id, encode(session), repo_id=request.repo_id, session_id=session.session_id)

    @app.post("/v1/sessions/state")
    def get_session_state(request: SessionRequest) -> dict[str, Any]:
        try:
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        return success(request.request_id, encode(session), repo_id=session.repo_id, session_id=session.session_id)

    @app.post("/v1/shell/run")
    def run_shell(request: RunShellRequest) -> dict[str, Any]:
        try:
            result = shell_runner.run(request.session_id, request.command, request.cwd)
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        except ValueError as exc:
            return failure(request.request_id, "cwd_escaped_workspace", str(exc), False, session_id=request.session_id)
        return success(request.request_id, encode(result), repo_id=session.repo_id, session_id=request.session_id)

    @app.post("/v1/files/read")
    def read_file_slice(request: ReadFileSliceRequest) -> dict[str, Any]:
        try:
            result = file_reader.read(request.session_id, request.path, request.start_line, request.max_lines)
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        except ValueError as exc:
            return failure(request.request_id, "path_escaped_workspace", str(exc), False, session_id=request.session_id)
        return success(request.request_id, encode(result), repo_id=session.repo_id, session_id=request.session_id)

    @app.post("/v1/graph/analyze")
    def analyze_graph(request: AnalyzeGraphRequest) -> dict[str, Any]:
        if request.session_id is not None:
            session = store.get_session_state(request.session_id)
            target = GraphTarget.workspace(session.session_id, session.workspace_id, session.workspace_version)
            state = graph_service.analyze(target, session.workspace_path)
            return success(request.request_id, encode(state), repo_id=session.repo_id, session_id=session.session_id)
        if request.repo_id is not None:
            repo = settings.repos.get(request.repo_id)
            if repo is None:
                return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
            cache_path = git_ops.cache_path(request.repo_id)
            try:
                commit = git_ops.resolve_ref(cache_path, repo.default_ref)
                graph_worktree = settings.graph_worktree_root / f"{request.repo_id}-{commit[:12]}"
                git_ops.ensure_worktree(cache_path, graph_worktree, commit)
                target = GraphTarget.repo(request.repo_id, commit)
                state = graph_service.analyze(target, graph_worktree)
            except Exception as exc:
                return failure(request.request_id, "graph_analysis_failed", str(exc), True, repo_id=request.repo_id)
            return success(request.request_id, encode(state), repo_id=request.repo_id)
        return failure(request.request_id, "graph_target_required", "repo_id or session_id is required", False)

    @app.post("/v1/graph/status")
    def get_graph_status(request: GetGraphStatusRequest) -> dict[str, Any]:
        if request.session_id is not None:
            session = store.get_session_state(request.session_id)
            target = GraphTarget.workspace(session.session_id, session.workspace_id, session.workspace_version)
            state = graph_service.status(target)
            return success(request.request_id, encode(state), repo_id=session.repo_id, session_id=session.session_id)
        if request.repo_id is not None:
            repo = settings.repos.get(request.repo_id)
            if repo is None:
                return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
            cache_path = git_ops.cache_path(request.repo_id)
            try:
                commit = git_ops.resolve_ref(cache_path, repo.default_ref)
                target = GraphTarget.repo(request.repo_id, commit)
                state = graph_service.status(target)
            except Exception as exc:
                return failure(request.request_id, "graph_status_failed", str(exc), True, repo_id=request.repo_id)
            return success(request.request_id, encode(state), repo_id=request.repo_id)
        return failure(request.request_id, "graph_target_required", "repo_id or session_id is required", False)

    return app
```

- [ ] **Step 4: Run full test suite**

Run: `pytest -q`

Expected: PASS for all tests.

- [ ] **Step 5: Run the service manually**

Run: `uvicorn remote_repo_service.app:create_app --factory --reload`

Expected: Uvicorn starts and reports an HTTP server address.

- [ ] **Step 6: Commit**

```bash
git add src/remote_repo_service/app.py tests/test_app.py
git commit -m "feat: expose V0 remote repo API"
```

## Final Verification

- [ ] **Step 1: Run all automated tests**

Run: `pytest -q`

Expected: PASS.

- [ ] **Step 2: Review API surface against the spec**

Confirm these V0 routes exist and have tests:

- `/v1/repos`
- `/v1/repos/sync`
- `/v1/sessions`
- `/v1/sessions/state`
- `/v1/shell/run`
- `/v1/files/read`
- `/v1/graph/analyze`
- `/v1/graph/status`

- [ ] **Step 3: Confirm deferred items remain absent**

Run: `rg -n "push|merge|rebase|force|authorization|semantic search|symbol context" src tests`

Expected: no implementation of commit, push, merge, rebase, multi-user authorization, semantic search, or symbol context.
