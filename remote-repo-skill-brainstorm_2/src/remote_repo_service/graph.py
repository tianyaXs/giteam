import subprocess
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from remote_repo_service.config import Settings
from remote_repo_service.models import GraphStatus, GraphTargetType
from remote_repo_service.session_store import SessionStore
from remote_repo_service.state_store import StateStore


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
    def __init__(self, settings: Settings, store: SessionStore, state_store: StateStore | None = None) -> None:
        self.settings = settings
        self.store = store
        self.state_store = state_store or store.state_store
        self.states: dict[GraphTarget, GraphState] = {}
        self._restore_persisted_states()

    def _restore_persisted_states(self) -> None:
        for row in self.state_store.load_graph_states():
            try:
                target_type = GraphTargetType(row["target_type"])
                target = GraphTarget(
                    target_type=target_type,
                    # Workspace targets are keyed by session/workspace/version.
                    # `repo_id` is stored only for server-side listing, so do
                    # not add it to the in-memory workspace key on restore.
                    repo_id=(row["repo_id"] or None) if target_type == GraphTargetType.repo_head else None,
                    commit=row["commit_sha"] or None,
                    session_id=row["session_id"] or None,
                    workspace_id=row["workspace_id"] or None,
                    workspace_version=None if row["workspace_version"] == -1 else row["workspace_version"],
                )
                self.states[target] = GraphState(
                    target=target,
                    status=GraphStatus(row["status"]),
                    last_indexed_at=row["last_indexed_at"],
                    error=row["error_message"],
                )
            except (KeyError, ValueError):
                # A malformed historical row must not prevent service boot.
                continue

    def _analysis_name(self, target: GraphTarget, cwd: Path) -> str:
        if target.target_type == GraphTargetType.repo_head:
            raw = f"giteam-{target.repo_id or cwd.name}-{(target.commit or 'head')[:12]}"
        else:
            raw = f"giteam-{target.workspace_id or cwd.name}-v{target.workspace_version or 0}"
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", raw).strip("-")
        return safe or "giteam-workspace"

    def _analyze_command(self, target: GraphTarget, cwd: Path) -> list[str]:
        command = list(self.settings.gitnexus_analyze_command)
        if not command:
            return command
        executable = Path(command[0]).name
        invokes_gitnexus = executable == "gitnexus" or (executable == "npx" and "gitnexus" in command[1:])
        if not invokes_gitnexus:
            return command
        next_command = list(command)
        if "--index-only" not in next_command:
            next_command.append("--index-only")
        if "--name" not in next_command:
            next_command.extend(["--name", self._analysis_name(target, cwd)])
        if "--allow-duplicate-name" not in next_command:
            next_command.append("--allow-duplicate-name")
        return next_command

    @staticmethod
    def _is_incomplete_index_error(stderr: str) -> bool:
        return "Analysis did not finalize" in stderr or "registry entry" in stderr

    def _run_analyze_command(self, target: GraphTarget, cwd: Path) -> subprocess.CompletedProcess[str]:
        command = self._analyze_command(target, cwd)
        completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
        if completed.returncode == 0 or not self._is_incomplete_index_error(completed.stderr):
            return completed
        index_path = cwd / ".gitnexus"
        if index_path.exists():
            shutil.rmtree(index_path)
            completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
        return completed

    def analyze(self, target: GraphTarget, cwd: Path) -> GraphState:
        self.states[target] = GraphState(target=target, status=GraphStatus.indexing, last_indexed_at=None)
        completed = self._run_analyze_command(target, cwd)
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
        self.state_store.save_graph_state(target, state)
        repo_id = target.repo_id
        if repo_id is None and target.session_id is not None:
            try:
                repo_id = self.store.get_session_state(target.session_id).repo_id
            except KeyError:
                repo_id = None
        if repo_id is not None:
            self.state_store.append_activity(
                repo_id,
                "gitnexus_analyzed",
                f"GitNexus analysis finished with {state.status.value}",
                workspace_id=target.workspace_id,
                session_id=target.session_id,
            )
        if target.session_id is not None and target.workspace_id is not None:
            self.state_store.append_workspace_operation(
                repo_id=repo_id or "",
                workspace_id=target.workspace_id,
                session_id=target.session_id,
                kind="gitnexus_analyze",
                summary=f"GitNexus analysis finished with {state.status.value}",
                status="completed" if state.status == GraphStatus.ready else "failed",
                stderr=state.error,
                metadata={"last_indexed_at": state.last_indexed_at},
                workspace_version=target.workspace_version,
            )
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
