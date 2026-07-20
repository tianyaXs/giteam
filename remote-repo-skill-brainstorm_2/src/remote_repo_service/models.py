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


class ListRepoBranchesRequest(BaseModel):
    request_id: str
    repo_id: str


class ListRepoTreeRequest(BaseModel):
    request_id: str
    repo_id: str
    ref_or_commit: str | None = None
    path: str = "."
    max_entries: int = Field(default=200, ge=1, le=500)


class ReadRepoFileRequest(BaseModel):
    request_id: str
    repo_id: str
    ref_or_commit: str | None = None
    path: str
    start_line: int = Field(default=1, ge=1)
    max_lines: int | None = Field(default=None, ge=1, le=500)


class CreateSessionRequest(BaseModel):
    request_id: str
    repo_id: str
    ref_or_commit: str


class SessionRequest(BaseModel):
    request_id: str
    session_id: str


class WorkspaceRequest(BaseModel):
    """Request scoped to one durable server workspace."""

    request_id: str
    workspace_id: str


class ListWorkspaceOperationsRequest(WorkspaceRequest):
    limit: int = Field(default=100, ge=1, le=200)


class ListToolsRequest(BaseModel):
    request_id: str


class RunShellRequest(SessionRequest):
    command: str
    cwd: str = "."


class ListFilesRequest(SessionRequest):
    path: str = "."
    max_entries: int = 200


class ReadFileSliceRequest(SessionRequest):
    path: str
    start_line: int = 1
    max_lines: int | None = None


class FindFilesRequest(SessionRequest):
    query: str
    max_results: int = 100


class FindTextRequest(SessionRequest):
    pattern: str
    path: str = "."
    max_results: int = 100


class WriteFileRequest(SessionRequest):
    path: str
    content: str
    create_dirs: bool = True


class EditFileRequest(SessionRequest):
    path: str
    old_text: str
    new_text: str
    replace_all: bool = False


class ApplyPatchRequest(SessionRequest):
    patch: str


class AnalyzeGraphRequest(BaseModel):
    request_id: str
    repo_id: str | None = None
    session_id: str | None = None
    target_type: GraphTargetType = GraphTargetType.repo_head
    ref_or_commit: str | None = None


class AddRepoRequest(BaseModel):
    request_id: str
    repo_id: str
    name: str
    remote_url: str
    default_ref: str = "main"
    auth_method: str | None = None
    credential_id: str | None = None


class RemoveRepoRequest(BaseModel):
    request_id: str
    repo_id: str


class UpdateRepoRequest(BaseModel):
    request_id: str
    repo_id: str
    name: str | None = None
    remote_url: str | None = None
    default_ref: str | None = None
    auth_method: str | None = None
    credential_id: str | None = None


class ReloadConfigRequest(BaseModel):
    request_id: str


class GetGraphStatusRequest(AnalyzeGraphRequest):
    pass
