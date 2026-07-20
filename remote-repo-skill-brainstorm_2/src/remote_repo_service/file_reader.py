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
        result = FileSlice(
            path=path,
            start_line=start_line,
            end_line=start_line + len(selected) - 1,
            content=content,
            truncated=line_truncated or byte_truncated,
            sha256=digest,
            workspace_version=session.workspace_version,
        )
        self.store.state_store.append_workspace_operation(
            repo_id=session.repo_id,
            workspace_id=session.workspace_id,
            session_id=session.session_id,
            kind="read_file",
            summary=f"Read file {path}",
            path=path,
            metadata={
                "start_line": result.start_line,
                "end_line": result.end_line,
                "truncated": result.truncated,
                "sha256": result.sha256,
            },
            workspace_version=session.workspace_version,
        )
        return result
