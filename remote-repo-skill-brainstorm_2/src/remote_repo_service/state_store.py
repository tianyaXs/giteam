"""Durable server-side state for remote repository workspaces.

The service intentionally keeps this SQLite database under ``storage_root`` so
that a mounted server volume contains both code worktrees and the metadata
needed to reopen them after a process restart.
"""

from __future__ import annotations

import sqlite3
import time
import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from remote_repo_service.config import RepoConfig, Settings

if TYPE_CHECKING:
    from remote_repo_service.git_ops import RepoSyncState
    from remote_repo_service.session_store import SessionState, WorkspaceState


@dataclass(frozen=True)
class PersistedWorkspace:
    workspace_id: str
    repo_id: str
    base_commit: str
    workspace_path: Path
    created_at_ms: int
    updated_at_ms: int
    workspace_version: int
    dirty: bool
    status: str
    last_command_id: str | None


@dataclass(frozen=True)
class PersistedSession:
    session_id: str
    workspace_id: str
    repo_id: str
    status: str
    created_at_ms: int
    last_accessed_at_ms: int


class StateStore:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.path = settings.storage_root / "state.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @staticmethod
    def now_ms() -> int:
        return int(time.time() * 1000)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _migrate(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS repos (
                    repo_id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    remote_url TEXT NOT NULL,
                    default_ref TEXT NOT NULL,
                    auth_method TEXT,
                    credential_id TEXT,
                    connection_status TEXT NOT NULL DEFAULT 'stale',
                    error_message TEXT,
                    last_synced_at_ms INTEGER,
                    updated_at_ms INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workspaces (
                    workspace_id TEXT PRIMARY KEY,
                    repo_id TEXT NOT NULL,
                    base_commit TEXT NOT NULL,
                    workspace_path TEXT NOT NULL UNIQUE,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL,
                    workspace_version INTEGER NOT NULL,
                    dirty INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    last_command_id TEXT
                );
                CREATE INDEX IF NOT EXISTS workspaces_repo_updated_idx
                    ON workspaces(repo_id, updated_at_ms DESC);

                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    repo_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at_ms INTEGER NOT NULL,
                    last_accessed_at_ms INTEGER NOT NULL,
                    FOREIGN KEY(workspace_id) REFERENCES workspaces(workspace_id)
                );
                CREATE INDEX IF NOT EXISTS sessions_workspace_access_idx
                    ON sessions(workspace_id, last_accessed_at_ms DESC);

                CREATE TABLE IF NOT EXISTS gitnexus_indexes (
                    target_type TEXT NOT NULL,
                    repo_id TEXT NOT NULL DEFAULT '',
                    commit_sha TEXT NOT NULL DEFAULT '',
                    session_id TEXT NOT NULL DEFAULT '',
                    workspace_id TEXT NOT NULL DEFAULT '',
                    workspace_version INTEGER NOT NULL DEFAULT -1,
                    status TEXT NOT NULL,
                    last_indexed_at TEXT,
                    error_message TEXT,
                    updated_at_ms INTEGER NOT NULL,
                    PRIMARY KEY(target_type, repo_id, commit_sha, session_id, workspace_id, workspace_version)
                );
                CREATE INDEX IF NOT EXISTS gitnexus_repo_idx
                    ON gitnexus_indexes(repo_id, updated_at_ms DESC);

                CREATE TABLE IF NOT EXISTS activities (
                    activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    repo_id TEXT NOT NULL,
                    workspace_id TEXT,
                    session_id TEXT,
                    kind TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    occurred_at_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS activities_repo_time_idx
                    ON activities(repo_id, occurred_at_ms DESC);

                CREATE TABLE IF NOT EXISTS workspace_operations (
                    operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    repo_id TEXT NOT NULL,
                    workspace_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    status TEXT NOT NULL,
                    command TEXT,
                    cwd TEXT,
                    path TEXT,
                    exit_code INTEGER,
                    stdout TEXT,
                    stderr TEXT,
                    diff_summary TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    workspace_version INTEGER,
                    started_at_ms INTEGER NOT NULL,
                    finished_at_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS workspace_operations_workspace_time_idx
                    ON workspace_operations(workspace_id, started_at_ms DESC, operation_id DESC);
                CREATE INDEX IF NOT EXISTS workspace_operations_session_time_idx
                    ON workspace_operations(session_id, started_at_ms DESC, operation_id DESC);
                """
            )

    def load_repo_configs(self) -> list[RepoConfig]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT repo_id, display_name, remote_url, default_ref, auth_method, credential_id FROM repos ORDER BY updated_at_ms ASC"
            ).fetchall()
        return [
            RepoConfig(
                repo_id=row["repo_id"],
                name=row["display_name"],
                remote_url=row["remote_url"],
                default_ref=row["default_ref"],
                auth_method=row["auth_method"],
                credential_id=row["credential_id"],
            )
            for row in rows
        ]

    def upsert_repo_config(self, repo: RepoConfig) -> None:
        now = self.now_ms()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO repos (repo_id, display_name, remote_url, default_ref, auth_method, credential_id, updated_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(repo_id) DO UPDATE SET
                    display_name=excluded.display_name,
                    remote_url=excluded.remote_url,
                    default_ref=excluded.default_ref,
                    auth_method=excluded.auth_method,
                    credential_id=excluded.credential_id,
                    updated_at_ms=excluded.updated_at_ms
                """,
                (repo.repo_id, repo.name, repo.remote_url, repo.default_ref, repo.auth_method, repo.credential_id, now),
            )

    def replace_repo_configs(self, repos: list[RepoConfig]) -> None:
        now = self.now_ms()
        repo_ids = [repo.repo_id for repo in repos]
        with self._connect() as connection:
            for repo in repos:
                connection.execute(
                    """
                    INSERT INTO repos (repo_id, display_name, remote_url, default_ref, auth_method, credential_id, updated_at_ms)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(repo_id) DO UPDATE SET
                        display_name=excluded.display_name,
                        remote_url=excluded.remote_url,
                        default_ref=excluded.default_ref,
                        auth_method=excluded.auth_method,
                        credential_id=excluded.credential_id,
                        updated_at_ms=excluded.updated_at_ms
                    """,
                    (repo.repo_id, repo.name, repo.remote_url, repo.default_ref, repo.auth_method, repo.credential_id, now),
                )
            if repo_ids:
                placeholders = ", ".join("?" for _ in repo_ids)
                connection.execute(f"DELETE FROM repos WHERE repo_id NOT IN ({placeholders})", repo_ids)
            else:
                connection.execute("DELETE FROM repos")

    def delete_repo_config(self, repo_id: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM repos WHERE repo_id = ?", (repo_id,))

    def record_sync_state(self, repo_id: str, state: "RepoSyncState") -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE repos
                SET connection_status = ?, error_message = ?, last_synced_at_ms = COALESCE(?, last_synced_at_ms), updated_at_ms = ?
                WHERE repo_id = ?
                """,
                (state.status, state.error_message, state.last_synced_at_ms, self.now_ms(), repo_id),
            )

    def sync_state(self, repo_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT connection_status, error_message, last_synced_at_ms FROM repos WHERE repo_id = ?", (repo_id,)
            ).fetchone()
        return dict(row) if row is not None else None

    def save_workspace_and_session(self, workspace: "WorkspaceState", session: "SessionState") -> None:
        now = self.now_ms()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO workspaces (workspace_id, repo_id, base_commit, workspace_path, created_at_ms, updated_at_ms, workspace_version, dirty, status, last_command_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
                """,
                (
                    workspace.workspace_id,
                    workspace.repo_id,
                    workspace.base_commit,
                    str(workspace.workspace_path),
                    now,
                    now,
                    workspace.workspace_version,
                    int(workspace.dirty),
                    workspace.last_command_id,
                ),
            )
            connection.execute(
                """
                INSERT INTO sessions (session_id, workspace_id, repo_id, status, created_at_ms, last_accessed_at_ms)
                VALUES (?, ?, ?, 'active', ?, ?)
                """,
                (session.session_id, session.workspace_id, session.repo_id, now, now),
            )

    def update_workspace(self, workspace: "WorkspaceState") -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE workspaces
                SET updated_at_ms = ?, workspace_version = ?, dirty = ?, status = 'active', last_command_id = ?
                WHERE workspace_id = ?
                """,
                (self.now_ms(), workspace.workspace_version, int(workspace.dirty), workspace.last_command_id, workspace.workspace_id),
            )

    def touch_session(self, session_id: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE sessions SET status = 'active', last_accessed_at_ms = ? WHERE session_id = ?",
                (self.now_ms(), session_id),
            )

    def restore_workspaces_and_sessions(self) -> list[tuple[PersistedWorkspace, PersistedSession]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    w.workspace_id, w.repo_id, w.base_commit, w.workspace_path, w.created_at_ms, w.updated_at_ms,
                    w.workspace_version, w.dirty, w.status AS workspace_status, w.last_command_id,
                    s.session_id, s.status AS session_status, s.created_at_ms AS session_created_at_ms,
                    s.last_accessed_at_ms
                FROM workspaces w
                JOIN sessions s ON s.workspace_id = w.workspace_id
                WHERE w.status != 'removed' AND s.status != 'removed'
                ORDER BY s.last_accessed_at_ms DESC
                """
            ).fetchall()
        restored: list[tuple[PersistedWorkspace, PersistedSession]] = []
        for row in rows:
            path = Path(row["workspace_path"])
            try:
                path.resolve().relative_to(self.settings.workspace_root.resolve())
            except ValueError:
                self._mark_workspace_expired(row["workspace_id"])
                continue
            if not path.exists():
                self._mark_workspace_expired(row["workspace_id"])
                continue
            workspace = PersistedWorkspace(
                workspace_id=row["workspace_id"],
                repo_id=row["repo_id"],
                base_commit=row["base_commit"],
                workspace_path=path,
                created_at_ms=row["created_at_ms"],
                updated_at_ms=row["updated_at_ms"],
                workspace_version=row["workspace_version"],
                dirty=bool(row["dirty"]),
                status=row["workspace_status"],
                last_command_id=row["last_command_id"],
            )
            session = PersistedSession(
                session_id=row["session_id"],
                workspace_id=row["workspace_id"],
                repo_id=row["repo_id"],
                status=row["session_status"],
                created_at_ms=row["session_created_at_ms"],
                last_accessed_at_ms=row["last_accessed_at_ms"],
            )
            restored.append((workspace, session))
        return restored

    def _mark_workspace_expired(self, workspace_id: str) -> None:
        """Keep a historical row but make an unavailable workspace non-resumable."""
        with self._connect() as connection:
            connection.execute("UPDATE workspaces SET status = 'expired', updated_at_ms = ? WHERE workspace_id = ?", (self.now_ms(), workspace_id))
            connection.execute("UPDATE sessions SET status = 'expired' WHERE workspace_id = ?", (workspace_id,))

    def list_workspaces(self, repo_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT w.*, s.session_id, s.status AS session_status, s.last_accessed_at_ms
                FROM workspaces w
                LEFT JOIN sessions s ON s.workspace_id = w.workspace_id
                WHERE w.repo_id = ? AND w.status != 'removed'
                ORDER BY w.updated_at_ms DESC, s.last_accessed_at_ms DESC
                """,
                (repo_id,),
            ).fetchall()
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        for row in rows:
            if row["workspace_id"] in seen:
                continue
            seen.add(row["workspace_id"])
            result.append(dict(row))
        return result

    def get_workspace(self, workspace_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT w.*, s.session_id, s.status AS session_status, s.last_accessed_at_ms
                FROM workspaces w
                LEFT JOIN sessions s ON s.workspace_id = w.workspace_id
                WHERE w.workspace_id = ? AND w.status != 'removed'
                ORDER BY s.last_accessed_at_ms DESC
                LIMIT 1
                """,
                (workspace_id,),
            ).fetchone()
        return dict(row) if row is not None else None

    def latest_session_for_workspace(self, workspace_id: str) -> PersistedSession | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT session_id, workspace_id, repo_id, status, created_at_ms, last_accessed_at_ms
                FROM sessions
                WHERE workspace_id = ? AND status != 'removed'
                ORDER BY status = 'active' DESC, last_accessed_at_ms DESC
                LIMIT 1
                """,
                (workspace_id,),
            ).fetchone()
        if row is None:
            return None
        return PersistedSession(**dict(row))

    def save_graph_state(self, target: Any, state: Any) -> None:
        repo_id = target.repo_id or ""
        if not repo_id and target.session_id:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT repo_id FROM sessions WHERE session_id = ?", (target.session_id,)
                ).fetchone()
            repo_id = row["repo_id"] if row is not None else ""
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO gitnexus_indexes
                (target_type, repo_id, commit_sha, session_id, workspace_id, workspace_version, status, last_indexed_at, error_message, updated_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(target_type, repo_id, commit_sha, session_id, workspace_id, workspace_version) DO UPDATE SET
                    status=excluded.status,
                    last_indexed_at=excluded.last_indexed_at,
                    error_message=excluded.error_message,
                    updated_at_ms=excluded.updated_at_ms
                """,
                (
                    str(target.target_type.value),
                    repo_id,
                    target.commit or "",
                    target.session_id or "",
                    target.workspace_id or "",
                    target.workspace_version if target.workspace_version is not None else -1,
                    str(state.status.value),
                    state.last_indexed_at,
                    state.error,
                    self.now_ms(),
                ),
            )

    def load_graph_states(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM gitnexus_indexes ORDER BY updated_at_ms ASC").fetchall()
        return [dict(row) for row in rows]

    def latest_graph_state(self, repo_id: str) -> dict[str, Any] | None:
        """Return the newest persisted repo-head index for a repository."""
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM gitnexus_indexes
                WHERE repo_id = ? AND target_type = 'repo_head'
                ORDER BY updated_at_ms DESC
                LIMIT 1
                """,
                (repo_id,),
            ).fetchone()
        return dict(row) if row is not None else None

    def append_activity(
        self,
        repo_id: str,
        kind: str,
        summary: str,
        workspace_id: str | None = None,
        session_id: str | None = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO activities (repo_id, workspace_id, session_id, kind, summary, occurred_at_ms)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (repo_id, workspace_id, session_id, kind, summary, self.now_ms()),
            )

    def list_activities(self, repo_id: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT activity_id, repo_id, workspace_id, session_id, kind, summary, occurred_at_ms
                FROM activities WHERE repo_id = ? ORDER BY occurred_at_ms DESC, activity_id DESC LIMIT ?
                """,
                (repo_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def append_workspace_operation(
        self,
        *,
        repo_id: str,
        workspace_id: str,
        session_id: str,
        kind: str,
        summary: str,
        status: str = "completed",
        command: str | None = None,
        cwd: str | None = None,
        path: str | None = None,
        exit_code: int | None = None,
        stdout: str | None = None,
        stderr: str | None = None,
        diff_summary: str | None = None,
        metadata: dict[str, Any] | None = None,
        workspace_version: int | None = None,
        started_at_ms: int | None = None,
        finished_at_ms: int | None = None,
    ) -> int:
        now = self.now_ms()
        started = started_at_ms or now
        finished = finished_at_ms or now
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True)
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO workspace_operations
                (repo_id, workspace_id, session_id, kind, summary, status, command, cwd, path, exit_code,
                 stdout, stderr, diff_summary, metadata_json, workspace_version, started_at_ms, finished_at_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    repo_id,
                    workspace_id,
                    session_id,
                    kind,
                    summary,
                    status,
                    command,
                    cwd,
                    path,
                    exit_code,
                    stdout,
                    stderr,
                    diff_summary,
                    metadata_json,
                    workspace_version,
                    started,
                    finished,
                ),
            )
        return int(cursor.lastrowid)

    def list_workspace_operations(self, workspace_id: str, limit: int = 100) -> list[dict[str, Any]]:
        bounded_limit = min(max(limit, 1), 200)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT operation_id, repo_id, workspace_id, session_id, kind, summary, status, command, cwd, path,
                       exit_code, stdout, stderr, diff_summary, metadata_json, workspace_version,
                       started_at_ms, finished_at_ms
                FROM workspace_operations
                WHERE workspace_id = ?
                ORDER BY started_at_ms DESC, operation_id DESC
                LIMIT ?
                """,
                (workspace_id, bounded_limit),
            ).fetchall()
        operations: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            raw_metadata = item.pop("metadata_json", "{}")
            try:
                item["metadata"] = json.loads(raw_metadata)
            except json.JSONDecodeError:
                item["metadata"] = {}
            operations.append(item)
        return operations
