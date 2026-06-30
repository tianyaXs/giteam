import fnmatch
import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from remote_repo_service.config import Settings
from remote_repo_service.git_ops import GitOps
from remote_repo_service.session_store import SessionStore, SessionState


@dataclass
class ToolDescriptor:
    id: str
    opencode_tool: str
    endpoint: str
    description: str
    implemented: bool = True


@dataclass
class FileEntry:
    path: str
    type: str
    size: int | None


@dataclass
class TextMatch:
    path: str
    line_number: int
    line: str


@dataclass
class FileMutationResult:
    path: str
    sha256: str
    bytes: int
    workspace_version: int
    status_after: str


@dataclass
class EditResult(FileMutationResult):
    replacements: int


@dataclass
class PatchResult:
    applied: bool
    stdout: str
    stderr: str
    workspace_version: int
    status_after: str


TOOL_DESCRIPTORS = [
    ToolDescriptor("bash", "bash", "/v1/shell/run", "Run a bounded shell command in a session workspace."),
    ToolDescriptor("read", "read", "/v1/files/read", "Read a bounded file slice from a session workspace."),
    ToolDescriptor("glob", "glob", "/v1/find/files", "Find files by glob or substring within a session workspace."),
    ToolDescriptor("grep", "grep", "/v1/find/text", "Find text matches within workspace files."),
    ToolDescriptor("write", "write", "/v1/files/write", "Write a file inside the session workspace."),
    ToolDescriptor("edit", "edit", "/v1/files/edit", "Replace text in a workspace file."),
    ToolDescriptor("apply_patch", "apply_patch", "/v1/files/apply-patch", "Apply a unified git patch to the workspace."),
    ToolDescriptor("task", "task", "/v1/shell/run", "Use shell/read/find APIs for delegated remote exploration.", False),
    ToolDescriptor("webfetch", "webfetch", "", "Network fetch is intentionally not proxied by this service.", False),
    ToolDescriptor("websearch", "websearch", "", "Web search is intentionally not proxied by this service.", False),
    ToolDescriptor("todowrite", "todowrite", "", "Conversation-local todo state is not stored by this service.", False),
    ToolDescriptor("skill", "skill", "", "Skill loading remains local to OpenCode/Codex.", False),
]


class WorkspaceTools:
    def __init__(self, settings: Settings, git_ops: GitOps, store: SessionStore) -> None:
        self.settings = settings
        self.git_ops = git_ops
        self.store = store

    def list_tools(self) -> list[ToolDescriptor]:
        return TOOL_DESCRIPTORS

    def _session(self, session_id: str) -> SessionState:
        return self.store.get_session_state(session_id)

    def _resolve_path(self, workspace_path: Path, path: str) -> Path:
        if Path(path).is_absolute():
            raise ValueError("path escaped workspace")
        resolved = (workspace_path / path).resolve()
        root = workspace_path.resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError("path escaped workspace")
        return resolved

    def _rel(self, workspace_path: Path, path: Path) -> str:
        return path.resolve().relative_to(workspace_path.resolve()).as_posix()

    def _iter_files(self, workspace_path: Path, root: Path):
        if root.is_file():
            yield root
            return
        for path in root.rglob("*"):
            rel = path.relative_to(workspace_path)
            if ".git" in rel.parts:
                continue
            if path.is_file():
                yield path

    def _digest(self, path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def _mark_mutation(self, session_id: str, status_before: str, status_after: str, changed: bool):
        command_id = f"tool_{uuid4().hex}"
        dirty = status_after != ""
        return self.store.mark_after_command(
            session_id,
            command_id,
            dirty=dirty,
            changed=changed or status_before != status_after,
        )

    def list_files(self, session_id: str, path: str, max_entries: int) -> list[FileEntry]:
        session = self._session(session_id)
        target = self._resolve_path(session.workspace_path, path)
        entries: list[FileEntry] = []
        if target.is_file():
            entries = [FileEntry(path=self._rel(session.workspace_path, target), type="file", size=target.stat().st_size)]
        else:
            for child in sorted(target.iterdir(), key=lambda item: (not item.is_dir(), item.name)):
                if child.name == ".git":
                    continue
                entries.append(
                    FileEntry(
                        path=self._rel(session.workspace_path, child),
                        type="directory" if child.is_dir() else "file",
                        size=None if child.is_dir() else child.stat().st_size,
                    )
                )
                if len(entries) >= max_entries:
                    break
        self.store.state_store.append_workspace_operation(
            repo_id=session.repo_id,
            workspace_id=session.workspace_id,
            session_id=session.session_id,
            kind="list_files",
            summary=f"Listed files in {path}",
            path=path,
            metadata={"entries": len(entries), "max_entries": max_entries},
            workspace_version=session.workspace_version,
        )
        return entries

    def find_files(self, session_id: str, query: str, max_results: int) -> list[str]:
        session = self._session(session_id)
        has_glob = any(char in query for char in "*?[]")
        matches: list[str] = []
        for file_path in self._iter_files(session.workspace_path, session.workspace_path):
            rel = self._rel(session.workspace_path, file_path)
            if (has_glob and fnmatch.fnmatch(rel, query)) or (not has_glob and query.lower() in rel.lower()):
                matches.append(rel)
                if len(matches) >= max_results:
                    break
        results = sorted(matches)
        self.store.state_store.append_workspace_operation(
            repo_id=session.repo_id,
            workspace_id=session.workspace_id,
            session_id=session.session_id,
            kind="find_files",
            summary=f"Found {len(results)} files for {query}",
            metadata={"query": query, "results": len(results), "max_results": max_results},
            workspace_version=session.workspace_version,
        )
        return results

    def grep(self, session_id: str, pattern: str, path: str, max_results: int) -> list[TextMatch]:
        session = self._session(session_id)
        root = self._resolve_path(session.workspace_path, path)
        regex = re.compile(pattern)
        matches: list[TextMatch] = []
        limit_reached = False
        for file_path in self._iter_files(session.workspace_path, root):
            try:
                lines = file_path.read_text(encoding="utf-8").splitlines()
            except UnicodeDecodeError:
                continue
            for index, line in enumerate(lines, start=1):
                if regex.search(line):
                    matches.append(TextMatch(path=self._rel(session.workspace_path, file_path), line_number=index, line=line))
                    if len(matches) >= max_results:
                        limit_reached = True
                        break
            if limit_reached:
                break
        self.store.state_store.append_workspace_operation(
            repo_id=session.repo_id,
            workspace_id=session.workspace_id,
            session_id=session.session_id,
            kind="grep",
            summary=f"Searched text in {path}",
            path=path,
            metadata={"pattern": pattern, "matches": len(matches), "max_results": max_results},
            workspace_version=session.workspace_version,
        )
        return matches

    def write_file(self, session_id: str, path: str, content: str, create_dirs: bool = True) -> FileMutationResult:
        session = self._session(session_id)
        file_path = self._resolve_path(session.workspace_path, path)
        if create_dirs:
            file_path.parent.mkdir(parents=True, exist_ok=True)
        before = file_path.read_bytes() if file_path.exists() else None
        status_before = self.git_ops.status_porcelain(session.workspace_path)
        file_path.write_text(content, encoding="utf-8")
        after = file_path.read_bytes()
        status_after = self.git_ops.status_porcelain(session.workspace_path)
        updated = self._mark_mutation(session_id, status_before, status_after, changed=before != after)
        diff_summary, diff_truncated = self.git_ops.diff_summary(session.workspace_path, self.settings.max_diff_bytes)
        self.store.state_store.append_workspace_operation(
            repo_id=updated.repo_id,
            workspace_id=updated.workspace_id,
            session_id=updated.session_id,
            kind="write_file",
            summary=f"Wrote file {path}",
            path=path,
            diff_summary=diff_summary,
            metadata={
                "bytes": len(after),
                "sha256": hashlib.sha256(after).hexdigest(),
                "created": before is None,
                "diff_truncated": diff_truncated,
                "status_after": status_after,
            },
            workspace_version=updated.workspace_version,
        )
        return FileMutationResult(
            path=path,
            sha256=hashlib.sha256(after).hexdigest(),
            bytes=len(after),
            workspace_version=updated.workspace_version,
            status_after=status_after,
        )

    def edit_file(self, session_id: str, path: str, old_text: str, new_text: str, replace_all: bool) -> EditResult:
        session = self._session(session_id)
        file_path = self._resolve_path(session.workspace_path, path)
        before_text = file_path.read_text(encoding="utf-8")
        if old_text not in before_text:
            raise ValueError("old_text not found")
        replacements = before_text.count(old_text) if replace_all else 1
        after_text = before_text.replace(old_text, new_text) if replace_all else before_text.replace(old_text, new_text, 1)
        status_before = self.git_ops.status_porcelain(session.workspace_path)
        file_path.write_text(after_text, encoding="utf-8")
        status_after = self.git_ops.status_porcelain(session.workspace_path)
        encoded = after_text.encode("utf-8")
        updated = self._mark_mutation(session_id, status_before, status_after, changed=before_text != after_text)
        diff_summary, diff_truncated = self.git_ops.diff_summary(session.workspace_path, self.settings.max_diff_bytes)
        self.store.state_store.append_workspace_operation(
            repo_id=updated.repo_id,
            workspace_id=updated.workspace_id,
            session_id=updated.session_id,
            kind="edit_file",
            summary=f"Edited file {path}",
            path=path,
            diff_summary=diff_summary,
            metadata={
                "bytes": len(encoded),
                "sha256": hashlib.sha256(encoded).hexdigest(),
                "replacements": replacements,
                "replace_all": replace_all,
                "diff_truncated": diff_truncated,
                "status_after": status_after,
            },
            workspace_version=updated.workspace_version,
        )
        return EditResult(
            path=path,
            sha256=hashlib.sha256(encoded).hexdigest(),
            bytes=len(encoded),
            workspace_version=updated.workspace_version,
            status_after=status_after,
            replacements=replacements,
        )

    def apply_patch(self, session_id: str, patch: str) -> PatchResult:
        session = self._session(session_id)
        status_before = self.git_ops.status_porcelain(session.workspace_path)
        completed = subprocess.run(
            ["git", "apply", "--whitespace=nowarn", "-"],
            cwd=session.workspace_path,
            input=patch,
            text=True,
            capture_output=True,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr or "git apply failed")
        status_after = self.git_ops.status_porcelain(session.workspace_path)
        updated = self._mark_mutation(session_id, status_before, status_after, changed=status_before != status_after)
        diff_summary, diff_truncated = self.git_ops.diff_summary(session.workspace_path, self.settings.max_diff_bytes)
        self.store.state_store.append_workspace_operation(
            repo_id=updated.repo_id,
            workspace_id=updated.workspace_id,
            session_id=updated.session_id,
            kind="apply_patch",
            summary="Applied patch",
            stdout=completed.stdout,
            stderr=completed.stderr,
            diff_summary=diff_summary,
            metadata={
                "patch_bytes": len(patch.encode("utf-8")),
                "diff_truncated": diff_truncated,
                "status_after": status_after,
            },
            workspace_version=updated.workspace_version,
        )
        return PatchResult(
            applied=True,
            stdout=completed.stdout,
            stderr=completed.stderr,
            workspace_version=updated.workspace_version,
            status_after=status_after,
        )
