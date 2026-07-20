from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from remote_repo_service.config import Settings
from remote_repo_service.git_ops import GitOps
from remote_repo_service.state_store import StateStore


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
    def __init__(self, settings: Settings, git_ops: GitOps, state_store: StateStore | None = None) -> None:
        self.settings = settings
        self.git_ops = git_ops
        self.state_store = state_store or StateStore(settings)
        self.sessions: dict[str, SessionState] = {}
        self.workspaces: dict[str, WorkspaceState] = {}
        self._restore_persisted_state()

    def _restore_persisted_state(self) -> None:
        """Rebuild in-memory indexes from the server's durable workspace disk."""
        for workspace, session in self.state_store.restore_workspaces_and_sessions():
            dirty = workspace.dirty
            try:
                dirty = self.git_ops.status_porcelain(workspace.workspace_path) != ""
            except Exception:
                # Keep the last durable value when a workspace cannot be
                # inspected during boot; API actions will still report a real
                # Git error if the server filesystem is unavailable.
                pass
            restored_workspace = WorkspaceState(
                workspace_id=workspace.workspace_id,
                repo_id=workspace.repo_id,
                base_commit=workspace.base_commit,
                workspace_path=workspace.workspace_path,
                workspace_version=workspace.workspace_version,
                dirty=dirty,
                last_command_id=workspace.last_command_id,
            )
            restored_session = SessionState(
                session_id=session.session_id,
                repo_id=session.repo_id,
                workspace_id=session.workspace_id,
                base_commit=workspace.base_commit,
                workspace_path=workspace.workspace_path,
                workspace_version=workspace.workspace_version,
                dirty=dirty,
                last_command_id=workspace.last_command_id,
            )
            self.workspaces[restored_workspace.workspace_id] = restored_workspace
            self.sessions[restored_session.session_id] = restored_session
            self.state_store.update_workspace(restored_workspace)

    def create_session(self, repo_id: str, ref_or_commit: str) -> SessionState:
        self.settings.repos[repo_id]
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
        self.state_store.save_workspace_and_session(workspace, session)
        self.state_store.append_activity(
            repo_id,
            "workspace_created",
            f"Created workspace at {base_commit[:7]}",
            workspace_id=workspace_id,
            session_id=session_id,
        )
        self.state_store.append_workspace_operation(
            repo_id=repo_id,
            workspace_id=workspace_id,
            session_id=session_id,
            kind="create_session",
            summary=f"Created workspace at {base_commit[:7]}",
            workspace_version=1,
            metadata={"base_commit": base_commit},
        )
        return session

    def get_session_state(self, session_id: str) -> SessionState:
        session = self.sessions[session_id]
        self.state_store.touch_session(session_id)
        return session

    def resume_workspace(self, workspace_id: str) -> SessionState:
        session = self.state_store.latest_session_for_workspace(workspace_id)
        if session is None:
            raise KeyError(workspace_id)
        restored = self.get_session_state(session.session_id)
        self.state_store.append_activity(
            restored.repo_id,
            "workspace_resumed",
            "Resumed persisted workspace",
            workspace_id=restored.workspace_id,
            session_id=restored.session_id,
        )
        self.state_store.append_workspace_operation(
            repo_id=restored.repo_id,
            workspace_id=restored.workspace_id,
            session_id=restored.session_id,
            kind="resume_workspace",
            summary="Resumed persisted workspace",
            workspace_version=restored.workspace_version,
        )
        return restored

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
        self.state_store.update_workspace(self.workspaces[session.workspace_id])
        self.state_store.touch_session(session_id)
        if changed:
            self.state_store.append_activity(
                updated.repo_id,
                "workspace_changed",
                "Updated files in workspace",
                workspace_id=updated.workspace_id,
                session_id=updated.session_id,
            )
        return updated
