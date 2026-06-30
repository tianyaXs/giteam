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
        if Path(cwd).is_absolute():
            raise ValueError("cwd escaped workspace")
        resolved = (workspace_path / cwd).resolve()
        root = workspace_path.resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError("cwd escaped workspace")
        return resolved

    def _bound(self, value: str | bytes | None, max_bytes: int) -> tuple[str, bool]:
        if value is None:
            return "", False
        data = value if isinstance(value, bytes) else value.encode("utf-8")
        truncated = len(data) > max_bytes
        if truncated:
            data = data[:max_bytes]
        return data.decode("utf-8", errors="replace"), truncated

    def run(self, session_id: str, command: str, cwd: str = ".") -> ShellResult:
        session = self.store.get_session_state(session_id)
        command_id = f"cmd_{uuid4().hex}"
        run_cwd = self._resolve_cwd(session.workspace_path, cwd)
        status_before = self.git_ops.status_porcelain(session.workspace_path)
        started_at_ms = self.store.state_store.now_ms()
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
            stdout = exc.stdout
            stderr = exc.stderr or "command timed out"
        elapsed_ms = int((time.monotonic() - started) * 1000)
        status_after = self.git_ops.status_porcelain(session.workspace_path)
        diff_summary, diff_truncated = self.git_ops.diff_summary(session.workspace_path, self.settings.max_diff_bytes)
        bounded_stdout, stdout_truncated = self._bound(stdout, self.settings.max_stdout_bytes)
        bounded_stderr, stderr_truncated = self._bound(stderr, self.settings.max_stderr_bytes)
        changed = status_before != status_after
        dirty = status_after != ""
        updated = self.store.mark_after_command(session_id, command_id, dirty=dirty, changed=changed)
        operation_status = "timeout" if timed_out else "failed" if exit_code != 0 else "completed"
        first_line = command.strip().splitlines()[0] if command.strip() else "(empty command)"
        self.store.state_store.append_workspace_operation(
            repo_id=updated.repo_id,
            workspace_id=updated.workspace_id,
            session_id=updated.session_id,
            kind="shell",
            summary=f"Ran shell: {first_line[:120]}",
            status=operation_status,
            command=command,
            cwd=str(run_cwd.relative_to(session.workspace_path)),
            exit_code=exit_code,
            stdout=bounded_stdout,
            stderr=bounded_stderr,
            diff_summary=diff_summary,
            metadata={
                "command_id": command_id,
                "elapsed_ms": elapsed_ms,
                "timed_out": timed_out,
                "stdout_truncated": stdout_truncated,
                "stderr_truncated": stderr_truncated,
                "diff_truncated": diff_truncated,
                "status_before": status_before,
                "status_after": status_after,
            },
            workspace_version=updated.workspace_version,
            started_at_ms=started_at_ms,
            finished_at_ms=self.store.state_store.now_ms(),
        )
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
