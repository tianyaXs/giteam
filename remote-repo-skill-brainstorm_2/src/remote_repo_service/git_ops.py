import asyncio
import hashlib
import logging
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable

from remote_repo_service.config import RepoConfig, Settings

logger = logging.getLogger(__name__)


class GitCommandError(RuntimeError):
    def __init__(self, command: list[str], stderr: str) -> None:
        super().__init__(f"Git command failed: {' '.join(command)}\n{stderr}")
        self.command = command
        self.stderr = stderr


@dataclass(frozen=True)
class RepoSyncState:
    status: str
    error_message: str | None = None
    last_synced_at_ms: int | None = None


class RepoNotSyncedError(RuntimeError):
    pass


@dataclass(frozen=True)
class RepoBranch:
    name: str
    short_sha: str
    is_default: bool


@dataclass(frozen=True)
class RepoTreeEntry:
    name: str
    path: str
    kind: str
    short_sha: str


@dataclass(frozen=True)
class RepoFileSlice:
    path: str
    commit: str
    start_line: int
    end_line: int
    content: str
    truncated: bool
    sha256: str


class GitOps:
    def __init__(self, settings: Settings, on_sync_state: Callable[[str, RepoSyncState], None] | None = None) -> None:
        self.settings = settings
        self.on_sync_state = on_sync_state
        self._clone_semaphore = asyncio.Semaphore(3)
        self._clone_tasks: set[asyncio.Task[None]] = set()
        self._sync_states: dict[str, RepoSyncState] = {}

    def _set_sync_state(self, repo_id: str, state: RepoSyncState) -> None:
        self._sync_states[repo_id] = state
        if self.on_sync_state is None:
            return
        try:
            self.on_sync_state(repo_id, state)
        except Exception:
            logger.exception("failed to persist sync state for repo %s", repo_id)

    def restore_sync_state(self, repo_id: str, state: RepoSyncState) -> None:
        self._sync_states[repo_id] = state

    def _run(self, args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        try:
            completed = subprocess.run(
                args,
                cwd=cwd,
                text=True,
                capture_output=True,
                timeout=self.settings.command_timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise GitCommandError(args, f"timed out after {self.settings.command_timeout_seconds} seconds") from exc
        if completed.returncode != 0:
            raise GitCommandError(args, completed.stderr)
        return completed

    def cache_path(self, repo_id: str) -> Path:
        return self.settings.repo_cache_root / f"{repo_id}.git"

    def _require_cache(self, repo_id: str) -> Path:
        cache_path = self.cache_path(repo_id)
        if not cache_path.exists():
            raise RepoNotSyncedError("Repository metadata is not available yet. Synchronize the connection first.")
        return cache_path

    @staticmethod
    def _repo_relative_path(path: str, *, allow_root: bool) -> str:
        raw = path.strip()
        if raw in {"", "."}:
            if allow_root:
                return ""
            raise ValueError("path must name a file")
        parsed = PurePosixPath(raw)
        if parsed.is_absolute() or ".." in parsed.parts:
            raise ValueError("path escaped repository")
        normalized = "/".join(part for part in parsed.parts if part not in {"", "."})
        if not normalized and not allow_root:
            raise ValueError("path must name a file")
        return normalized

    @staticmethod
    def _safe_ref(ref_or_commit: str) -> str:
        ref = ref_or_commit.strip()
        if not ref or ref.startswith("-") or ".." in ref or not all(char.isalnum() or char in "._/-" for char in ref):
            raise ValueError("invalid repository ref")
        return ref

    @staticmethod
    def _is_auth_failure(error: Exception) -> bool:
        message = str(error).lower()
        return any(fragment in message for fragment in ("authentication", "authorization", "permission denied", "could not read username"))

    def sync_state(self, repo_id: str) -> RepoSyncState:
        known = self._sync_states.get(repo_id)
        if known is not None:
            return known
        if self.cache_path(repo_id).exists():
            return RepoSyncState(status="connected")
        return RepoSyncState(status="stale")

    def mark_stale(self, repo_id: str) -> None:
        self._set_sync_state(repo_id, RepoSyncState(status="stale"))

    def forget_repo(self, repo_id: str) -> None:
        self._sync_states.pop(repo_id, None)

    def sync_repo(self, repo: RepoConfig) -> Path:
        cache_path = self.cache_path(repo.repo_id)
        self._set_sync_state(repo.repo_id, RepoSyncState(status="syncing"))
        try:
            if cache_path.exists():
                # The config is canonical: a changed remote URL takes effect on the next explicit sync.
                self._run(["git", "remote", "set-url", "origin", repo.remote_url], cache_path)
                self._run(["git", "fetch", "--prune", "origin"], cache_path)
                self._run(["git", "fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"], cache_path)
            else:
                self._run(["git", "clone", "--mirror", repo.remote_url, str(cache_path)])
        except Exception as exc:
            self._set_sync_state(repo.repo_id, RepoSyncState(
                status="auth_required" if self._is_auth_failure(exc) else "failed",
                error_message=str(exc),
            ))
            raise

        self._set_sync_state(repo.repo_id, RepoSyncState(
            status="connected",
            last_synced_at_ms=int(time.time() * 1000),
        ))
        return cache_path

    async def schedule_clone(self, repo: RepoConfig) -> None:
        async with self._clone_semaphore:
            try:
                await asyncio.to_thread(self.sync_repo, repo)
                logger.info("clone completed for repo %s", repo.repo_id)
            except Exception as exc:
                logger.exception("background clone failed for repo %s", repo.repo_id)

    def queue_clone(self, repo: RepoConfig) -> None:
        self._set_sync_state(repo.repo_id, RepoSyncState(status="syncing"))
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
                except (asyncio.CancelledError, Exception):
                    pass

    @staticmethod
    def _branch_name_from_ref(refname: str) -> str | None:
        if refname == "refs/remotes/origin/HEAD":
            return None
        for prefix in ("refs/remotes/origin/", "refs/heads/"):
            if refname.startswith(prefix):
                return refname.removeprefix(prefix)
        return None

    @staticmethod
    def _default_branch_name(default_ref: str) -> str:
        return (
            default_ref
            .removeprefix("refs/remotes/origin/")
            .removeprefix("refs/heads/")
            .removeprefix("origin/")
        )

    @classmethod
    def _ref_candidates(cls, ref: str) -> list[str]:
        default_name = cls._default_branch_name(ref)
        candidates: list[str] = []
        if ref.startswith("refs/remotes/origin/"):
            candidates.extend([ref, f"refs/heads/{default_name}"])
        elif ref.startswith("refs/heads/"):
            candidates.extend([f"refs/remotes/origin/{default_name}", ref])
        elif ref.startswith("origin/"):
            candidates.extend([f"refs/remotes/origin/{default_name}", f"refs/heads/{default_name}", ref])
        elif ref.startswith("refs/"):
            candidates.append(ref)
        else:
            candidates.extend([f"refs/remotes/origin/{default_name}", f"refs/heads/{default_name}"])
        candidates.append(ref)
        deduped: list[str] = []
        for candidate in candidates:
            if candidate not in deduped:
                deduped.append(candidate)
        return deduped

    def resolve_ref(self, cache_path: Path, ref_or_commit: str) -> str:
        ref = self._safe_ref(ref_or_commit)
        last_error: GitCommandError | None = None
        for candidate in self._ref_candidates(ref):
            try:
                completed = self._run(["git", "rev-parse", "--verify", f"{candidate}^{{commit}}"], cache_path)
                return completed.stdout.strip()
            except GitCommandError as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise GitCommandError(["git", "rev-parse", "--verify", f"{ref}^{{commit}}"], "")

    def list_branches(self, repo: RepoConfig) -> list[RepoBranch]:
        cache_path = self._require_cache(repo.repo_id)
        completed = self._run(
            [
                "git",
                "for-each-ref",
                "--format=%(refname)%00%(objectname)",
                "refs/heads",
                "refs/remotes/origin",
            ],
            cache_path,
        )
        default_name = self._default_branch_name(repo.default_ref)
        branches: dict[str, RepoBranch] = {}
        for row in completed.stdout.splitlines():
            refname, separator, sha = row.partition("\0")
            name = self._branch_name_from_ref(refname)
            if not separator or not name or not sha:
                continue
            branches[name] = RepoBranch(name=name, short_sha=sha[:7], is_default=name == default_name)
        return sorted(branches.values(), key=lambda branch: (not branch.is_default, branch.name.casefold()))

    def list_repo_tree(
        self,
        repo: RepoConfig,
        ref_or_commit: str | None,
        path: str,
        max_entries: int,
    ) -> tuple[str, str, list[RepoTreeEntry]]:
        cache_path = self._require_cache(repo.repo_id)
        commit = self.resolve_ref(cache_path, ref_or_commit or repo.default_ref)
        normalized_path = self._repo_relative_path(path, allow_root=True)
        treeish = commit if not normalized_path else f"{commit}:{normalized_path}"
        completed = self._run(["git", "ls-tree", "-z", treeish], cache_path)
        entries: list[RepoTreeEntry] = []
        for record in completed.stdout.split("\0"):
            if not record:
                continue
            metadata, separator, name = record.partition("\t")
            fields = metadata.split(" ")
            if not separator or len(fields) != 3:
                continue
            _mode, object_type, sha = fields
            if object_type not in {"blob", "tree"}:
                continue
            entries.append(
                RepoTreeEntry(
                    name=name,
                    path=f"{normalized_path}/{name}" if normalized_path else name,
                    kind="directory" if object_type == "tree" else "file",
                    short_sha=sha[:7],
                )
            )
        entries.sort(key=lambda entry: (entry.kind != "directory", entry.name.casefold()))
        return commit, normalized_path or ".", entries[:max_entries]

    def read_repo_file(
        self,
        repo: RepoConfig,
        ref_or_commit: str | None,
        path: str,
        start_line: int,
        max_lines: int | None,
    ) -> RepoFileSlice:
        cache_path = self._require_cache(repo.repo_id)
        commit = self.resolve_ref(cache_path, ref_or_commit or repo.default_ref)
        normalized_path = self._repo_relative_path(path, allow_root=False)
        completed = self._run(["git", "show", f"{commit}:{normalized_path}"], cache_path)
        raw = completed.stdout.encode("utf-8")
        digest = hashlib.sha256(raw).hexdigest()
        requested_lines = max_lines if max_lines is not None else self.settings.max_file_slice_lines
        effective_lines = min(requested_lines, self.settings.max_file_slice_lines)
        lines = completed.stdout.splitlines(keepends=True)
        start_index = start_line - 1
        selected = lines[start_index : start_index + effective_lines]
        content = "".join(selected)
        encoded = content.encode("utf-8")
        byte_truncated = len(encoded) > self.settings.max_file_slice_bytes
        if byte_truncated:
            content = encoded[: self.settings.max_file_slice_bytes].decode("utf-8", errors="replace")
        return RepoFileSlice(
            path=normalized_path,
            commit=commit,
            start_line=start_line,
            end_line=start_line + len(selected) - 1,
            content=content,
            truncated=byte_truncated or start_index + effective_lines < len(lines),
            sha256=digest,
        )

    def create_worktree(self, cache_path: Path, workspace_path: Path, commit: str) -> None:
        workspace_path.parent.mkdir(parents=True, exist_ok=True)
        self._run(["git", "worktree", "add", "--detach", str(workspace_path), commit], cache_path)

    def clean_worktree(self, workspace_path: Path) -> None:
        self._run(["git", "reset", "--hard", "HEAD"], workspace_path)
        self._run(["git", "clean", "-fdx", "-e", ".gitnexus/"], workspace_path)

    def ensure_worktree(self, cache_path: Path, workspace_path: Path, commit: str, *, clean: bool = False) -> Path:
        if workspace_path.exists():
            current = self._run(["git", "rev-parse", "HEAD"], workspace_path).stdout.strip()
            if current == commit:
                if clean:
                    self.clean_worktree(workspace_path)
                return workspace_path
            raise GitCommandError(
                ["git", "worktree", "add", str(workspace_path), commit],
                "existing worktree has a different HEAD",
            )
        self.create_worktree(cache_path, workspace_path, commit)
        if clean:
            self.clean_worktree(workspace_path)
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
