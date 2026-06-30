# Phase A: CLI and Dynamic Repository Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Python CLI (`python -m remote_repo_service`), dynamic repository addition via API/CLI, atomic config persistence, and safe background clone lifecycle management.

**Architecture:** Extend `Settings`/`RepoConfig` with auth reservation and atomic save/reload helpers; add `POST /v1/repos/add` and `POST /v1/config/reload` to the FastAPI app; add async clone scheduling with semaphore/concurrency tracking in `GitOps`; expose CLI commands under `start` and `repo` subcommand groups.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, uvicorn, filelock, pytest, httpx TestClient.

---

## File Structure

- **Create:**
  - `src/remote_repo_service/__main__.py`: package entry point delegating to CLI parser.
  - `src/remote_repo_service/cli.py`: argument parsing and command implementations.
  - `tests/test_cli.py`: CLI command tests.

- **Modify:**
  - `pyproject.toml`: add `filelock` dependency and `[project.scripts]` entry point.
  - `src/remote_repo_service/config.py`: add `auth_method`/`credential_id`, atomic save, reload, and config path resolution helpers.
  - `src/remote_repo_service/models.py`: add `AddRepoRequest` and `ReloadConfigRequest`.
  - `src/remote_repo_service/git_ops.py`: add async clone scheduling with semaphore and task tracking.
  - `src/remote_repo_service/app.py`: add `/v1/repos/add`, `/v1/config/reload`, shutdown cleanup, and wire reload into settings.
  - `tests/test_config.py`: add atomic save and reload tests.
  - `tests/test_app.py`: add tests for new endpoints.

---

## Task 1: Add `filelock` Dependency and Console Script

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add dependency and script entry**

```toml
[project]
name = "remote-repo-service"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "pydantic>=2.8",
  "uvicorn>=0.30",
  "filelock>=3.0",
]

[project.optional-dependencies]
dev = [
  "httpx>=0.27",
  "pytest>=8.2",
]

[project.scripts]
remote-repo-service = "remote_repo_service.cli:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 2: Install updated dependencies**

Run: `pip install -e .`

Expected: installs `filelock` and console script.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml
git commit -m "chore: add filelock dependency and console script entry"
```

---

## Task 2: Extend Config Model with Auth Fields and Atomic Save

**Files:**
- Modify: `src/remote_repo_service/config.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: Write failing test for atomic save**

```python
def test_settings_save_is_atomic_and_re_loadable(tmp_path: Path) -> None:
    config_path = tmp_path / "service.json"
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo Repo",
                remote_url=str(tmp_path / "remote.git"),
                default_ref="main",
                auth_method="ssh_key",
                credential_id="default",
            )
        },
    )

    settings.save_to(config_path)

    assert config_path.exists()
    loaded = Settings.from_file(config_path)
    assert loaded.repos["demo"].auth_method == "ssh_key"
    assert loaded.repos["demo"].credential_id == "default"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_config.py::test_settings_save_is_atomic_and_re_loadable -v`

Expected: FAIL with `AttributeError: 'Settings' object has no attribute 'save_to'`.

- [ ] **Step 3: Implement config changes**

```python
import json
import os
import tempfile
from pathlib import Path

from filelock import FileLock
from pydantic import BaseModel, Field


class RepoConfig(BaseModel):
    repo_id: str
    name: str
    remote_url: str
    default_ref: str = "main"
    auth_method: str | None = None
    credential_id: str | None = None


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

    @classmethod
    def from_env(cls) -> "Settings":
        config_path = resolve_config_path()
        if config_path is None:
            return cls()
        return cls.from_file(Path(config_path))

    @classmethod
    def from_file(cls, config_path: Path) -> "Settings":
        data = json.loads(config_path.read_text(encoding="utf-8"))
        return cls.model_validate(data)

    def save_to(self, config_path: Path, lock_timeout: float = 5.0) -> None:
        config_path = config_path.resolve()
        lock_path = config_path.with_suffix(config_path.suffix + ".lock")
        lock = FileLock(str(lock_path), timeout=lock_timeout)
        with lock:
            data = self.model_dump(mode="json")
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=str(config_path.parent),
                prefix=config_path.name + ".tmp",
                delete=False,
            ) as handle:
                json.dump(data, handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(handle.name, config_path)

    def add_repo(self, repo: RepoConfig) -> None:
        if repo.repo_id in self.repos:
            raise ValueError(f"repo_id already exists: {repo.repo_id}")
        self.repos[repo.repo_id] = repo

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


def resolve_config_path(
    explicit: str | None = None,
    env_var: str = "REMOTE_REPO_SERVICE_CONFIG",
    default: str = "service.json",
) -> str | None:
    if explicit:
        return str(Path(explicit).resolve())
    env_path = os.environ.get(env_var)
    if env_path:
        return str(Path(env_path).resolve())
    default_path = Path(default).resolve()
    if default_path.exists():
        return str(default_path)
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_config.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/config.py tests/test_config.py
git commit -m "feat: add auth fields, atomic config save, and config path resolution"
```

---

## Task 3: Add Request Models for New Endpoints

**Files:**
- Modify: `src/remote_repo_service/models.py`

- [ ] **Step 1: Add `AddRepoRequest` and `ReloadConfigRequest`**

Append to `src/remote_repo_service/models.py`:

```python
class AddRepoRequest(BaseModel):
    request_id: str
    repo_id: str
    name: str
    remote_url: str
    default_ref: str = "main"
    auth_method: str | None = None
    credential_id: str | None = None


class ReloadConfigRequest(BaseModel):
    request_id: str
```

- [ ] **Step 2: Commit**

```bash
git add src/remote_repo_service/models.py
git commit -m "feat: add AddRepoRequest and ReloadConfigRequest models"
```

---

## Task 4: Add Async Clone Scheduling to GitOps

**Files:**
- Modify: `src/remote_repo_service/git_ops.py`

- [ ] **Step 1: Implement async clone wrapper and task tracking**

```python
import asyncio
import logging
import subprocess
from pathlib import Path

from remote_repo_service.config import RepoConfig, Settings

logger = logging.getLogger(__name__)


class GitCommandError(RuntimeError):
    def __init__(self, command: list[str], stderr: str) -> None:
        super().__init__(f"Git command failed: {' '.join(command)}\n{stderr}")
        self.command = command
        self.stderr = stderr


class GitOps:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._clone_semaphore = asyncio.Semaphore(3)
        self._clone_tasks: set[asyncio.Task[None]] = set()

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

    async def schedule_clone(self, repo: RepoConfig) -> None:
        async with self._clone_semaphore:
            try:
                await asyncio.to_thread(self.sync_repo, repo)
                logger.info("clone completed for repo %s", repo.repo_id)
            except Exception as exc:
                logger.exception("background clone failed for repo %s: %s", repo.repo_id, exc)

    def queue_clone(self, repo: RepoConfig) -> None:
        task = asyncio.create_task(self.schedule_clone(repo))
        self._clone_tasks.add(task)
        task.add_done_callback(self._clone_tasks.discard)

    async def cancel_clones(self, timeout: float = 5.0) -> None:
        for task in list(self._clone_tasks):
            task.cancel()
        if self._clone_tasks:
            done, _pending = await asyncio.wait(
                self._clone_tasks, timeout=timeout, return_when=asyncio.ALL_COMPLETED
            )
            for task in done:
                try:
                    task.result()
                except asyncio.CancelledError:
                    pass

- [ ] **Step 2: Write async clone lifecycle tests**

Append to `tests/test_git_ops.py`:

```python
import asyncio
from unittest.mock import patch

import pytest

from remote_repo_service.config import RepoConfig, Settings
from remote_repo_service.git_ops import GitOps


def test_queue_clone_schedules_background_task(tmp_path: Path) -> None:
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
```

Note: `pytest-asyncio` or `anyio` is required. Add `pytest-asyncio` to `[project.optional-dependencies]` dev list in Task 1 if not already available:

```toml
[project.optional-dependencies]
dev = [
  "httpx>=0.27",
  "pytest>=8.2",
  "pytest-asyncio>=0.23",
]
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pytest tests/test_git_ops.py -v`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/remote_repo_service/git_ops.py tests/test_git_ops.py pyproject.toml
git commit -m "feat: add async clone scheduling with lifecycle tests"
```

    def resolve_ref(self, cache_path: Path, ref_or_commit: str) -> str:
        completed = self._run(["git", "rev-parse", f"{ref_or_commit}^{{commit}}"], cache_path)
        return completed.stdout.strip()

    def create_worktree(self, cache_path: Path, workspace_path: Path, commit: str) -> None:
        workspace_path = workspace_path.resolve()
        workspace_path.parent.mkdir(parents=True, exist_ok=True)
        self._run(["git", "worktree", "add", "--detach", str(workspace_path), commit], cache_path)

    def ensure_worktree(self, cache_path: Path, workspace_path: Path, commit: str) -> Path:
        if workspace_path.exists():
            current = self._run(["git", "rev-parse", "HEAD"], workspace_path).stdout.strip()
            if current == commit:
                return workspace_path
            raise GitCommandError(
                ["git", "worktree", "add", str(workspace_path), commit],
                "existing worktree has a different HEAD",
            )
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

- [ ] **Step 2: Commit**

```bash
git add src/remote_repo_service/git_ops.py tests/test_git_ops.py pyproject.toml
git commit -m "feat: add async clone scheduling with lifecycle tests"
```

---

## Task 5: Add `/v1/repos/add` and `/v1/config/reload` Endpoints

**Files:**
- Modify: `src/remote_repo_service/app.py`
- Test: `tests/test_app.py`

- [ ] **Step 1: Write failing test for add repo endpoint**

Append to `tests/test_app.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_app.py::test_add_repo_persists_config_and_queues_clone -v`

Expected: FAIL with `404 Not Found`.

- [ ] **Step 3: Implement endpoints and config reload**

Modify `src/remote_repo_service/app.py`:

1. Update imports to include new models:

```python
from remote_repo_service.models import (
    AddRepoRequest,
    AnalyzeGraphRequest,
    ApplyPatchRequest,
    ApiError,
    CreateSessionRequest,
    EditFileRequest,
    ErrorResponse,
    FindFilesRequest,
    FindTextRequest,
    GetGraphStatusRequest,
    ListFilesRequest,
    ListReposRequest,
    ListToolsRequest,
    ReadFileSliceRequest,
    ReloadConfigRequest,
    RunShellRequest,
    SessionRequest,
    SuccessResponse,
    SyncRepoRequest,
    WriteFileRequest,
)
```

2. Add a helper to load config path inside `create_app`:

```python
def create_app(settings: Settings | None = None) -> FastAPI:
    config_path: Path | None = None
    if settings is None:
        config_path_value = resolve_config_path()
        if config_path_value:
            config_path = Path(config_path_value)
            settings = Settings.from_file(config_path)
        else:
            settings = Settings()
    settings.ensure_directories()
    git_ops = GitOps(settings)
    store = SessionStore(settings, git_ops)
    shell_runner = ShellRunner(settings, git_ops, store)
    file_reader = FileReader(settings, store)
    workspace_tools = WorkspaceTools(settings, git_ops, store)
    graph_service = GraphService(settings, store)
    app = FastAPI(title="Remote Repo Service", version="0.1.0")
```

3. Add reload helper:

```python
    def reload_settings() -> None:
        """Reload settings from disk and update in-memory service references.

        Limitations:
        - GitOps is reused; its ._clone_semaphore and other internal state are
          not recreated. If settings ever expose clone concurrency limits, this
          helper must either rebuild GitOps or migrate live task state.
        - All dependent components receive the new Settings reference, but any
          state derived from the old settings (e.g. already-created sessions)
          keeps the old reference. This is intentional: existing sessions must
          remain stable.
        """
        nonlocal settings
        if config_path is None:
            return
        new_settings = Settings.from_file(config_path)
        new_settings.ensure_directories()
        settings = new_settings
        git_ops.settings = settings
        store.settings = settings
        shell_runner.settings = settings
        file_reader.settings = settings
        workspace_tools.settings = settings
        graph_service.settings = settings
```

4. Add endpoints:

```python
    @app.post("/v1/repos/add")
    def add_repo(request: AddRepoRequest) -> dict[str, Any]:
        if request.repo_id in settings.repos:
            return failure(
                request.request_id,
                "repo_id_exists",
                f"Repository already exists: {request.repo_id}",
                False,
            )
        repo = RepoConfig(
            repo_id=request.repo_id,
            name=request.name,
            remote_url=request.remote_url,
            default_ref=request.default_ref,
            auth_method=request.auth_method,
            credential_id=request.credential_id,
        )
        settings.add_repo(repo)
        if config_path is not None:
            try:
                settings.save_to(config_path)
            except Exception as exc:
                return failure(
                    request.request_id,
                    "config_persist_failed",
                    str(exc),
                    True,
                )
        git_ops.queue_clone(repo)
        return success(
            request.request_id,
            {"repo_id": repo.repo_id, "sync_queued": True},
            repo_id=repo.repo_id,
        )

    @app.post("/v1/config/reload")
    def reload_config(request: ReloadConfigRequest) -> dict[str, Any]:
        try:
            reload_settings()
        except Exception as exc:
            return failure(
                request.request_id,
                "config_reload_failed",
                str(exc),
                True,
            )
        return success(
            request.request_id,
            {"repos": [repo_summary(repo_id) for repo_id in settings.repos]},
        )
```

5. Register shutdown event to cancel clones:

```python
    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        await git_ops.cancel_clones()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_app.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/app.py tests/test_app.py
git commit -m "feat: add /v1/repos/add and /v1/config/reload endpoints"
```

---

## Task 6: Implement CLI Module

**Files:**
- Create: `src/remote_repo_service/cli.py`
- Create: `src/remote_repo_service/__main__.py`
- Test: `tests/test_cli.py`

- [ ] **Step 1: Write failing CLI tests**

Create `tests/test_cli.py`:

```python
import json
from pathlib import Path

from remote_repo_service.cli import resolve_config_path
from remote_repo_service.config import RepoConfig, Settings


def test_cli_repo_add_writes_config(tmp_path: Path) -> None:
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

    from remote_repo_service.cli import add_repo

    add_repo(
        config_path=str(config_path),
        repo_id="demo",
        name="Demo",
        remote_url=str(tmp_path / "remote.git"),
        default_ref="main",
        auth_method=None,
        credential_id=None,
        notify_base_url=None,
    )

    loaded = Settings.from_file(config_path)
    assert loaded.repos["demo"].repo_id == "demo"


def test_cli_config_path_resolution_explicit_over_env(tmp_path: Path, monkeypatch) -> None:
    explicit = tmp_path / "explicit.json"
    env = tmp_path / "env.json"
    explicit.write_text("{}", encoding="utf-8")
    env.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("REMOTE_REPO_SERVICE_CONFIG", str(env))

    assert resolve_config_path(explicit=str(explicit)) == str(explicit.resolve())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_cli.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'remote_repo_service.cli'`.

- [ ] **Step 3: Implement CLI module**

Create `src/remote_repo_service/cli.py`:

```python
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from remote_repo_service.config import RepoConfig, Settings, resolve_config_path


DEFAULT_BASE_URL = "http://127.0.0.1:8765"


def request_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}"


def post_json(base_url: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code} from {url}: {raw}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not connect to {url}: {exc.reason}") from exc


def cmd_start(args: argparse.Namespace) -> int:
    import uvicorn

    config_path = resolve_config_path(args.config)
    if config_path:
        import os

        os.environ["REMOTE_REPO_SERVICE_CONFIG"] = config_path
    host = args.host
    port = args.port
    uvicorn.run(
        "remote_repo_service.app:create_app",
        factory=True,
        host=host,
        port=port,
    )
    return 0


def cmd_repo_add(args: argparse.Namespace) -> int:
    config_path_value = resolve_config_path(args.config)
    if config_path_value is None:
        raise SystemExit("Could not resolve config path. Use --config or create ./service.json")
    config_path = Path(config_path_value)

    try:
        settings = Settings.from_file(config_path) if config_path.exists() else Settings()
    except Exception as exc:
        raise SystemExit(f"Failed to load config: {exc}") from exc

    repo = RepoConfig(
        repo_id=args.repo_id,
        name=args.name or args.repo_id,
        remote_url=args.remote_url,
        default_ref=args.default_ref,
        auth_method=args.auth_method,
        credential_id=args.credential_id,
    )
    try:
        settings.add_repo(repo)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    try:
        settings.save_to(config_path)
    except TimeoutError:
        raise SystemExit("Config file is locked by running service, please retry.")
    except Exception as exc:
        raise SystemExit(f"Failed to save config: {exc}") from exc

    if args.notify_base_url:
        try:
            post_json(args.notify_base_url, "/v1/config/reload", {"request_id": request_id("reload")})
        except SystemExit:
            print(f"Warning: could not notify service at {args.notify_base_url}", file=sys.stderr)

    print(json.dumps({"ok": True, "repo_id": repo.repo_id}, indent=2))
    return 0


def cmd_repo_list(args: argparse.Namespace) -> int:
    config_path_value = resolve_config_path(args.config)
    if config_path_value is None:
        raise SystemExit("Could not resolve config path. Use --config or create ./service.json")
    config_path = Path(config_path_value)
    settings = Settings.from_file(config_path) if config_path.exists() else Settings()
    repos = [
        {
            "repo_id": repo.repo_id,
            "name": repo.name,
            "remote_url": repo.remote_url,
            "default_ref": repo.default_ref,
            "auth_method": repo.auth_method,
            "credential_id": repo.credential_id,
        }
        for repo in settings.repos.values()
    ]
    print(json.dumps({"repos": repos}, indent=2))
    return 0


def cmd_repo_sync(args: argparse.Namespace) -> int:
    base_url = args.base_url or os.environ.get("REMOTE_REPO_SERVICE_URL", DEFAULT_BASE_URL)
    response = post_json(base_url, "/v1/repos/sync", {"request_id": request_id("sync"), "repo_id": args.repo_id})
    print(json.dumps(response, indent=2))
    return 0 if response.get("ok") is True else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="remote-repo-service", description="Remote Repo Service CLI")
    parser.add_argument("--config", help="Path to service.json (overrides env and default)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start", help="Start the HTTP service")
    start.add_argument("--host", default="127.0.0.1")
    start.add_argument("--port", type=int, default=8765)
    start.set_defaults(func=cmd_start)

    repo = subparsers.add_parser("repo", help="Manage configured repositories")
    repo_subparsers = repo.add_subparsers(dest="repo_command", required=True)

    repo_add = repo_subparsers.add_parser("add", help="Add a repository")
    repo_add.add_argument("repo_id")
    repo_add.add_argument("remote_url")
    repo_add.add_argument("--name")
    repo_add.add_argument("--default-ref", default="main")
    repo_add.add_argument("--auth-method")
    repo_add.add_argument("--credential-id")
    repo_add.add_argument("--notify-base-url", default=DEFAULT_BASE_URL, help="Base URL of running service to notify for reload")
    repo_add.set_defaults(func=cmd_repo_add)

    repo_list = repo_subparsers.add_parser("list", help="List configured repositories")
    repo_list.set_defaults(func=cmd_repo_list)

    repo_sync = repo_subparsers.add_parser("sync", help="Trigger repository sync")
    repo_sync.add_argument("repo_id")
    repo_sync.add_argument("--base-url")
    repo_sync.set_defaults(func=cmd_repo_sync)

    return parser


def main(args: list[str] | None = None) -> int:
    parser = build_parser()
    parsed = parser.parse_args(args)
    return parsed.func(parsed)


if __name__ == "__main__":
    sys.exit(main())
```

Create `src/remote_repo_service/__main__.py`:

```python
import sys

from remote_repo_service.cli import main

sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_cli.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote_repo_service/cli.py src/remote_repo_service/__main__.py tests/test_cli.py
git commit -m "feat: add CLI with start, repo add, repo list, and repo sync commands"
```

---

## Task 7: Verify Full Test Suite

**Files:**
- All of the above

- [ ] **Step 1: Run all tests**

Run: `pytest -q`

Expected: PASS for all tests.

- [ ] **Step 2: Manual smoke test**

In one terminal:

```bash
python -m remote_repo_service start --config service.json
```

In another terminal, test API add:

```bash
curl -X POST http://127.0.0.1:8765/v1/repos/add \
  -H "Content-Type: application/json" \
  -d '{"request_id":"r1","repo_id":"demo2","name":"Demo 2","remote_url":"/path/to/repo.git"}'
```

Test CLI add while service is running (should write config and notify service to reload):

```bash
python -m remote_repo_service repo add demo3 /path/to/repo.git --config service.json
python -m remote_repo_service repo list --config service.json
```

Verify the service's in-memory `/v1/dashboard` or `/v1/repos` now includes `demo3`, proving the reload notification worked.

Test sync:

```bash
python -m remote_repo_service repo sync demo2
```

- [ ] **Step 3: Commit any final fixes**

```bash
git commit -a -m "fix: final adjustments after integration testing"
```

---

## Self-Review

- **Spec coverage:**
  - CLI `start` command: Task 6.
  - CLI `repo add/list/sync`: Task 6.
  - Config path resolution priority: Task 2.
  - `auth_method`/`credential_id`: Task 2.
  - Atomic config save with file lock: Task 2.
  - Runtime config reload endpoint: Task 5.
  - `POST /v1/repos/add` endpoint: Task 5.
  - Background clone lifecycle (semaphore, exception handling, graceful shutdown): Task 4 and Task 5.

- **Placeholder scan:** no TBD/TODO/vague steps. Each step contains concrete code or commands.

- **Type consistency:**
  - `Settings.from_file` used consistently.
  - `resolve_config_path` signature matches usage.
  - `AddRepoRequest` and `ReloadConfigRequest` match endpoint usage.
  - `GitOps` task tracking uses `asyncio.Task[None]` consistently.
