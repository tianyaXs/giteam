from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
import secrets
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from remote_repo_service.config import RepoConfig, Settings, resolve_config_path
from remote_repo_service.file_reader import FileReader
from remote_repo_service.git_ops import GitCommandError, GitOps, RepoNotSyncedError, RepoSyncState
from remote_repo_service.graph import GraphService, GraphTarget
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
    ListRepoBranchesRequest,
    ListRepoTreeRequest,
    ListFilesRequest,
    ListWorkspaceOperationsRequest,
    ListReposRequest,
    ListToolsRequest,
    ReadFileSliceRequest,
    ReadRepoFileRequest,
    ReloadConfigRequest,
    RemoveRepoRequest,
    RunShellRequest,
    SessionRequest,
    SuccessResponse,
    SyncRepoRequest,
    UpdateRepoRequest,
    WorkspaceRequest,
    WriteFileRequest,
)
from remote_repo_service.session_store import SessionStore
from remote_repo_service.state_store import StateStore
from remote_repo_service.shell_runner import ShellRunner
from remote_repo_service.workspace_tools import WorkspaceTools


INDEX_PATH = Path(__file__).parent / "static" / "index.html"
PUBLIC_PATHS = {"/", "/v1/health"}


def safe_origin(remote_url: str) -> str:
    """Return a host/path identifier without credentials or local filesystem paths."""
    source = remote_url.strip()
    if not source or source.startswith("/") or source.startswith("file://"):
        return "local"

    if "://" not in source:
        # SSH clone URLs: git@github.com:owner/repo.git.
        source = source.split("@", 1)[-1]
        if ":" in source:
            host, path = source.split(":", 1)
            return f"{host}/{path.lstrip('/').removesuffix('.git')}"
        return source.removesuffix(".git")

    parsed = urlparse(source)
    if not parsed.hostname:
        return "configured remote"
    path = parsed.path.strip("/").removesuffix(".git")
    return f"{parsed.hostname}/{path}".rstrip("/")


def provider_for_origin(origin: str) -> str:
    host = origin.split("/", 1)[0].lower()
    if "github" in host:
        return "github"
    if "gitlab" in host:
        return "gitlab"
    if "gitea" in host or "forgejo" in host:
        return "gitea"
    if origin == "local":
        return "local"
    return "git"


def encode(value: Any) -> Any:
    if is_dataclass(value):
        return {key: encode(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: encode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [encode(item) for item in value]
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    return value


def create_app(settings: Settings | None = None, config_path: Path | None = None) -> FastAPI:
    if settings is None:
        config_path_value = resolve_config_path()
        if config_path_value:
            config_path = Path(config_path_value)
            settings = Settings.from_file(config_path)
        else:
            settings = Settings()
    elif config_path is None:
        config_path = getattr(settings, '_source_path', None)
    settings.ensure_directories()
    state_store = StateStore(settings)
    # Configuration file bootstraps a new server. Once a state database
    # exists, its repo rows are the durable source for service CRUD, avoiding
    # a second browser- or process-local connection registry.
    persisted_repos = state_store.load_repo_configs()
    if persisted_repos:
        settings.repos = {repo.repo_id: repo for repo in persisted_repos}

    def persist_sync_state(repo_id: str, state: RepoSyncState) -> None:
        state_store.record_sync_state(repo_id, state)

    git_ops = GitOps(settings, on_sync_state=persist_sync_state)
    for repo in settings.repos.values():
        state_store.upsert_repo_config(repo)
        persisted_sync = state_store.sync_state(repo.repo_id)
        if persisted_sync is not None:
            git_ops.restore_sync_state(
                repo.repo_id,
                RepoSyncState(
                    status=persisted_sync["connection_status"],
                    error_message=persisted_sync["error_message"],
                    last_synced_at_ms=persisted_sync["last_synced_at_ms"],
                ),
            )
    store = SessionStore(settings, git_ops, state_store)
    shell_runner = ShellRunner(settings, git_ops, store)
    file_reader = FileReader(settings, store)
    workspace_tools = WorkspaceTools(settings, git_ops, store)
    graph_service = GraphService(settings, store, state_store)
    app = FastAPI(title="Remote Repo Service", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key"],
    )

    @app.middleware("http")
    async def require_api_key(request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS:
            return await call_next(request)
        valid_keys = settings.effective_api_keys()
        if not valid_keys:
            return await call_next(request)
        supplied = request.headers.get("X-API-Key", "").strip()
        if supplied and any(secrets.compare_digest(supplied, key) for key in valid_keys):
            return await call_next(request)
        request_id = request.headers.get("X-Request-ID", "auth")
        return JSONResponse(
            status_code=401,
            content=ErrorResponse(
                request_id=request_id,
                error=ApiError(
                    code="authentication_required",
                    message="Remote Repo Service API key is required.",
                    retryable=False,
                ),
            ).model_dump(),
        )

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
        state_store.settings = settings
        state_store.replace_repo_configs(list(settings.repos.values()))

    @app.get("/", response_class=HTMLResponse)
    def frontend() -> str:
        return INDEX_PATH.read_text(encoding="utf-8")

    @app.get("/v1/health")
    def health() -> dict[str, Any]:
        return {"service": {"status": "ready", "version": app.version}}

    def success(
        request_id: str,
        data: dict[str, Any],
        repo_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        return SuccessResponse(
            request_id=request_id,
            repo_id=repo_id,
            session_id=session_id,
            data=data,
        ).model_dump()

    def failure(
        request_id: str,
        code: str,
        message: str,
        retryable: bool,
        repo_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        return ErrorResponse(
            request_id=request_id,
            repo_id=repo_id,
            session_id=session_id,
            error=ApiError(code=code, message=message, retryable=retryable),
        ).model_dump()

    def repo_summary(repo_id: str) -> dict[str, Any]:
        repo = settings.repos[repo_id]
        origin = safe_origin(repo.remote_url)
        sync_state = git_ops.sync_state(repo.repo_id)
        default_commit = None
        cache_path = git_ops.cache_path(repo.repo_id)
        if cache_path.exists():
            try:
                default_commit = git_ops.resolve_ref(cache_path, repo.default_ref)
            except Exception:
                default_commit = None
        return {
            "repo_id": repo.repo_id,
            "name": repo.name,
            "provider": provider_for_origin(origin),
            "origin": origin,
            "default_ref": repo.default_ref,
            "default_commit": default_commit,
            "sync_status": sync_state.status,
            "error_message": sync_state.error_message,
            "last_synced_at_ms": sync_state.last_synced_at_ms,
            "auth_method": repo.auth_method,
        }

    def workspace_payload(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "workspace_id": row["workspace_id"],
            "repo_id": row["repo_id"],
            "base_commit": row["base_commit"],
            "workspace_path": row["workspace_path"],
            "created_at_ms": row["created_at_ms"],
            "updated_at_ms": row["updated_at_ms"],
            "workspace_version": row["workspace_version"],
            "dirty": bool(row["dirty"]),
            "status": row["status"],
            "last_command_id": row["last_command_id"],
            "session_id": row.get("session_id"),
            "session_status": row.get("session_status"),
            "last_accessed_at_ms": row.get("last_accessed_at_ms"),
        }

    def get_workspace_or_failure(workspace_id: str, request_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        workspace = state_store.get_workspace(workspace_id)
        if workspace is None:
            return None, failure(
                request_id,
                "workspace_not_found",
                "Workspace not found",
                False,
            )
        return workspace, None

    def list_workspaces_response(repo_id: str, request_id: str) -> dict[str, Any]:
        if repo_id not in settings.repos:
            return failure(request_id, "repo_not_found", "Repository not found", False, repo_id=repo_id)
        workspaces = [workspace_payload(row) for row in state_store.list_workspaces(repo_id)]
        return success(request_id, {"workspaces": workspaces}, repo_id=repo_id)

    def workspace_response(workspace_id: str, request_id: str) -> dict[str, Any]:
        workspace, error = get_workspace_or_failure(workspace_id, request_id)
        if error is not None:
            return error
        assert workspace is not None
        return success(
            request_id,
            workspace_payload(workspace),
            repo_id=workspace["repo_id"],
            session_id=workspace.get("session_id"),
        )

    def operation_payload(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "operation_id": str(row["operation_id"]),
            "repo_id": row["repo_id"],
            "workspace_id": row["workspace_id"],
            "session_id": row["session_id"],
            "kind": row["kind"],
            "summary": row["summary"],
            "status": row["status"],
            "command": row["command"],
            "cwd": row["cwd"],
            "path": row["path"],
            "exit_code": row["exit_code"],
            "stdout": row["stdout"],
            "stderr": row["stderr"],
            "diff_summary": row["diff_summary"],
            "metadata": row["metadata"],
            "workspace_version": row["workspace_version"],
            "started_at_ms": row["started_at_ms"],
            "finished_at_ms": row["finished_at_ms"],
        }

    def workspace_operations_response(workspace_id: str, request_id: str, limit: int = 100) -> dict[str, Any]:
        workspace, error = get_workspace_or_failure(workspace_id, request_id)
        if error is not None:
            return error
        assert workspace is not None
        operations = [
            operation_payload(row)
            for row in state_store.list_workspace_operations(workspace_id, limit)
        ]
        return success(
            request_id,
            {"operations": operations},
            repo_id=workspace["repo_id"],
            session_id=workspace.get("session_id"),
        )

    def resume_workspace_response(workspace_id: str, request_id: str) -> dict[str, Any]:
        workspace = state_store.get_workspace(workspace_id)
        if workspace is None:
            return failure(request_id, "workspace_not_found", "Workspace not found", False)
        if workspace["status"] != "active":
            return failure(request_id, "workspace_unavailable", "Workspace is no longer available on this server", False)
        try:
            session = store.resume_workspace(workspace_id)
        except KeyError:
            return failure(request_id, "workspace_not_found", "Workspace not found", False)
        return success(request_id, encode(session), repo_id=session.repo_id, session_id=session.session_id)

    def activities_response(repo_id: str, request_id: str) -> dict[str, Any]:
        if repo_id not in settings.repos:
            return failure(request_id, "repo_not_found", "Repository not found", False, repo_id=repo_id)
        return success(
            request_id,
            {"activities": state_store.list_activities(repo_id)},
            repo_id=repo_id,
        )

    def gitnexus_status_response(repo_id: str, request_id: str) -> dict[str, Any]:
        if repo_id not in settings.repos:
            return failure(request_id, "repo_not_found", "Repository not found", False, repo_id=repo_id)
        persisted = state_store.latest_graph_state(repo_id)
        if persisted is None:
            return success(
                request_id,
                {
                    "status": "STALE",
                    "last_indexed_at": None,
                    "error": None,
                    "target": {"target_type": "repo_head", "repo_id": repo_id},
                },
                repo_id=repo_id,
            )
        return success(
            request_id,
            {
                "status": persisted["status"],
                "last_indexed_at": persisted["last_indexed_at"],
                "error": persisted["error_message"],
                "target": {
                    "target_type": persisted["target_type"],
                    "repo_id": persisted["repo_id"] or None,
                    "commit": persisted["commit_sha"] or None,
                    "session_id": persisted["session_id"] or None,
                    "workspace_id": persisted["workspace_id"] or None,
                    "workspace_version": None if persisted["workspace_version"] == -1 else persisted["workspace_version"],
                },
            },
            repo_id=repo_id,
            session_id=persisted["session_id"] or None,
        )

    @app.get("/v1/dashboard")
    def dashboard() -> dict[str, Any]:
        return {
            "service": {"status": "ready", "version": app.version},
            "repos": [repo_summary(repo_id) for repo_id in settings.repos],
        }

    @app.post("/v1/repos")
    def list_repos(request: ListReposRequest) -> dict[str, Any]:
        repos = [repo_summary(repo_id) for repo_id in settings.repos]
        return success(request.request_id, {"repos": repos})

    @app.get("/v1/repos/{repo_id}/workspaces")
    @app.get("/repos/{repo_id}/workspaces")
    def list_persisted_workspaces(repo_id: str, request_id: str = "server") -> dict[str, Any]:
        return list_workspaces_response(repo_id, request_id)

    # POST aliases support the existing Tauri command bridge, while the GET
    # routes above remain the canonical resource-oriented API.
    @app.post("/v1/workspaces/list")
    def list_persisted_workspaces_for_client(request: SyncRepoRequest) -> dict[str, Any]:
        return list_workspaces_response(request.repo_id, request.request_id)

    @app.get("/v1/workspaces/{workspace_id}")
    @app.get("/workspaces/{workspace_id}")
    def get_persisted_workspace(workspace_id: str, request_id: str = "server") -> dict[str, Any]:
        return workspace_response(workspace_id, request_id)

    @app.post("/v1/workspaces/get")
    def get_persisted_workspace_for_client(request: WorkspaceRequest) -> dict[str, Any]:
        return workspace_response(request.workspace_id, request.request_id)

    @app.get("/v1/workspaces/{workspace_id}/operations")
    @app.get("/workspaces/{workspace_id}/operations")
    def list_workspace_operations(workspace_id: str, request_id: str = "server", limit: int = 100) -> dict[str, Any]:
        return workspace_operations_response(workspace_id, request_id, limit)

    @app.post("/v1/workspaces/operations")
    def list_workspace_operations_for_client(request: ListWorkspaceOperationsRequest) -> dict[str, Any]:
        return workspace_operations_response(request.workspace_id, request.request_id, request.limit)

    @app.post("/v1/workspaces/{workspace_id}/resume")
    @app.post("/workspaces/{workspace_id}/resume")
    def resume_persisted_workspace(workspace_id: str, request: ListReposRequest) -> dict[str, Any]:
        return resume_workspace_response(workspace_id, request.request_id)

    @app.post("/v1/workspaces/resume")
    def resume_persisted_workspace_for_client(request: WorkspaceRequest) -> dict[str, Any]:
        return resume_workspace_response(request.workspace_id, request.request_id)

    @app.get("/v1/repos/{repo_id}/activities")
    @app.get("/repos/{repo_id}/activities")
    def list_activities(repo_id: str, request_id: str = "server") -> dict[str, Any]:
        return activities_response(repo_id, request_id)

    @app.post("/v1/activities/list")
    def list_activities_for_client(request: SyncRepoRequest) -> dict[str, Any]:
        return activities_response(request.repo_id, request.request_id)

    @app.get("/v1/repos/{repo_id}/gitnexus/status")
    @app.get("/repos/{repo_id}/gitnexus/status")
    def get_repo_gitnexus_status(repo_id: str, request_id: str = "server") -> dict[str, Any]:
        return gitnexus_status_response(repo_id, request_id)

    @app.post("/v1/gitnexus/repo-status")
    def get_repo_gitnexus_status_for_client(request: SyncRepoRequest) -> dict[str, Any]:
        return gitnexus_status_response(request.repo_id, request.request_id)

    @app.post("/v1/repos/add")
    async def add_repo(request: AddRepoRequest) -> dict[str, Any]:
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
                settings.repos.pop(request.repo_id, None)
                return failure(
                    request.request_id,
                    "config_persist_failed",
                    str(exc),
                    True,
                )
        state_store.upsert_repo_config(repo)
        state_store.append_activity(repo.repo_id, "repo_added", "Added repository connection")
        git_ops.queue_clone(repo)
        return success(
            request.request_id,
            {"repo_id": repo.repo_id, "sync_queued": True},
            repo_id=repo.repo_id,
        )

    @app.post("/v1/repos/remove")
    def remove_repo(request: RemoveRepoRequest) -> dict[str, Any]:
        if request.repo_id not in settings.repos:
            return failure(
                request.request_id,
                "repo_not_found",
                f"Repository not found: {request.repo_id}",
                False,
                repo_id=request.repo_id,
            )
        try:
            removed = settings.remove_repo(request.repo_id)
        except ValueError as exc:
            return failure(request.request_id, "repo_not_found", str(exc), False, repo_id=request.repo_id)
        if config_path is not None:
            try:
                settings.save_to(config_path)
            except Exception as exc:
                settings.repos[removed.repo_id] = removed
                return failure(
                    request.request_id,
                    "config_persist_failed",
                    str(exc),
                    True,
                    repo_id=removed.repo_id,
                )
        git_ops.forget_repo(removed.repo_id)
        state_store.delete_repo_config(removed.repo_id)
        state_store.append_activity(removed.repo_id, "repo_removed", "Removed repository connection")
        return success(
            request.request_id,
            {"repo_id": removed.repo_id, "removed": True},
            repo_id=removed.repo_id,
        )

    @app.post("/v1/repos/update")
    def update_repo(request: UpdateRepoRequest) -> dict[str, Any]:
        if request.repo_id not in settings.repos:
            return failure(
                request.request_id,
                "repo_not_found",
                f"Repository not found: {request.repo_id}",
                False,
                repo_id=request.repo_id,
            )
        try:
            repo = settings.update_repo(
                request.repo_id,
                name=request.name,
                remote_url=request.remote_url,
                default_ref=request.default_ref,
                auth_method=request.auth_method,
                credential_id=request.credential_id,
            )
        except ValueError as exc:
            return failure(request.request_id, "repo_update_failed", str(exc), False, repo_id=request.repo_id)
        if config_path is not None:
            try:
                settings.save_to(config_path)
            except Exception as exc:
                return failure(
                    request.request_id,
                    "config_persist_failed",
                    str(exc),
                    True,
                    repo_id=repo.repo_id,
                )
        if request.remote_url is not None or request.default_ref is not None:
            git_ops.mark_stale(repo.repo_id)
        state_store.upsert_repo_config(repo)
        state_store.append_activity(repo.repo_id, "repo_updated", "Updated repository connection")
        return success(
            request.request_id,
            {
                "repo_id": repo.repo_id,
                "updated": True,
                "requires_sync": request.remote_url is not None or request.default_ref is not None,
            },
            repo_id=repo.repo_id,
        )

    @app.post("/v1/config/reload")
    def reload_config(request: ReloadConfigRequest) -> dict[str, Any]:
        if config_path is None:
            return failure(
                request.request_id,
                "config_path_not_set",
                "No config file path is configured",
                False,
            )
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

    @app.post("/v1/tools")
    def list_tools(request: ListToolsRequest) -> dict[str, Any]:
        return success(request.request_id, {"tools": encode(workspace_tools.list_tools())})

    @app.post("/v1/repos/sync")
    def sync_repo(request: SyncRepoRequest) -> dict[str, Any]:
        repo = settings.repos.get(request.repo_id)
        if repo is None:
            return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
        try:
            cache_path = git_ops.sync_repo(repo)
        except Exception as exc:
            sync_state = git_ops.sync_state(repo.repo_id)
            return failure(
                request.request_id,
                sync_state.status if sync_state.status in {"auth_required", "failed"} else "sync_failed",
                sync_state.error_message or str(exc),
                True,
                repo_id=request.repo_id,
            )
        state_store.append_activity(request.repo_id, "repo_synced", "Synchronized remote repository metadata")
        return success(request.request_id, {"cache_path": str(cache_path)}, repo_id=request.repo_id)

    @app.post("/v1/repos/branches")
    def list_repo_branches(request: ListRepoBranchesRequest) -> dict[str, Any]:
        repo = settings.repos.get(request.repo_id)
        if repo is None:
            return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
        try:
            branches = git_ops.list_branches(repo)
        except RepoNotSyncedError as exc:
            return failure(request.request_id, "repo_not_synced", str(exc), True, repo_id=request.repo_id)
        except Exception as exc:
            return failure(request.request_id, "repository_read_failed", str(exc), True, repo_id=request.repo_id)
        return success(request.request_id, {"branches": encode(branches)}, repo_id=request.repo_id)

    @app.post("/v1/repos/files/list")
    def list_repo_files(request: ListRepoTreeRequest) -> dict[str, Any]:
        repo = settings.repos.get(request.repo_id)
        if repo is None:
            return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
        try:
            commit, path, entries = git_ops.list_repo_tree(
                repo,
                request.ref_or_commit,
                request.path,
                request.max_entries,
            )
        except RepoNotSyncedError as exc:
            return failure(request.request_id, "repo_not_synced", str(exc), True, repo_id=request.repo_id)
        except ValueError as exc:
            return failure(request.request_id, "invalid_repository_path", str(exc), False, repo_id=request.repo_id)
        except Exception as exc:
            return failure(request.request_id, "repository_read_failed", str(exc), True, repo_id=request.repo_id)
        return success(
            request.request_id,
            {"ref": request.ref_or_commit or repo.default_ref, "commit": commit, "path": path, "entries": encode(entries)},
            repo_id=request.repo_id,
        )

    @app.post("/v1/repos/files/read")
    def read_repo_file(request: ReadRepoFileRequest) -> dict[str, Any]:
        repo = settings.repos.get(request.repo_id)
        if repo is None:
            return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
        try:
            result = git_ops.read_repo_file(
                repo,
                request.ref_or_commit,
                request.path,
                request.start_line,
                request.max_lines,
            )
        except RepoNotSyncedError as exc:
            return failure(request.request_id, "repo_not_synced", str(exc), True, repo_id=request.repo_id)
        except ValueError as exc:
            return failure(request.request_id, "invalid_repository_path", str(exc), False, repo_id=request.repo_id)
        except Exception as exc:
            return failure(request.request_id, "repository_read_failed", str(exc), True, repo_id=request.repo_id)
        return success(
            request.request_id,
            {"ref": request.ref_or_commit or repo.default_ref, **encode(result)},
            repo_id=request.repo_id,
        )

    @app.post("/v1/sessions")
    def create_session(request: CreateSessionRequest) -> dict[str, Any]:
        try:
            session = store.create_session(request.repo_id, request.ref_or_commit)
        except KeyError:
            return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
        except GitCommandError as exc:
            if len(exc.command) > 1 and exc.command[1] == "rev-parse":
                return failure(
                    request.request_id,
                    "ref_not_found",
                    f"Ref or commit not found: {request.ref_or_commit}",
                    False,
                    repo_id=request.repo_id,
                )
            return failure(request.request_id, "workspace_creation_failed", str(exc), True, repo_id=request.repo_id)
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

    @app.post("/v1/files/list")
    def list_files(request: ListFilesRequest) -> dict[str, Any]:
        try:
            result = workspace_tools.list_files(request.session_id, request.path, request.max_entries)
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        except ValueError as exc:
            return failure(request.request_id, "path_escaped_workspace", str(exc), False, session_id=request.session_id)
        return success(request.request_id, {"entries": encode(result)}, repo_id=session.repo_id, session_id=request.session_id)

    @app.post("/v1/find/files")
    def find_files(request: FindFilesRequest) -> dict[str, Any]:
        try:
            paths = workspace_tools.find_files(request.session_id, request.query, request.max_results)
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        return success(request.request_id, {"paths": paths}, repo_id=session.repo_id, session_id=request.session_id)

    @app.post("/v1/find/text")
    def find_text(request: FindTextRequest) -> dict[str, Any]:
        try:
            matches = workspace_tools.grep(request.session_id, request.pattern, request.path, request.max_results)
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        except ValueError as exc:
            return failure(request.request_id, "path_escaped_workspace", str(exc), False, session_id=request.session_id)
        return success(request.request_id, {"matches": encode(matches)}, repo_id=session.repo_id, session_id=request.session_id)

    @app.post("/v1/files/write")
    def write_file(request: WriteFileRequest) -> dict[str, Any]:
        try:
            result = workspace_tools.write_file(request.session_id, request.path, request.content, request.create_dirs)
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        except ValueError as exc:
            return failure(request.request_id, "path_escaped_workspace", str(exc), False, session_id=request.session_id)
        return success(request.request_id, encode(result), repo_id=session.repo_id, session_id=request.session_id)

    @app.post("/v1/files/edit")
    def edit_file(request: EditFileRequest) -> dict[str, Any]:
        try:
            result = workspace_tools.edit_file(
                request.session_id,
                request.path,
                request.old_text,
                request.new_text,
                request.replace_all,
            )
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        except ValueError as exc:
            return failure(request.request_id, "file_edit_failed", str(exc), False, session_id=request.session_id)
        return success(request.request_id, encode(result), repo_id=session.repo_id, session_id=request.session_id)

    @app.post("/v1/files/apply-patch")
    def apply_patch(request: ApplyPatchRequest) -> dict[str, Any]:
        try:
            result = workspace_tools.apply_patch(request.session_id, request.patch)
            session = store.get_session_state(request.session_id)
        except KeyError:
            return failure(request.request_id, "session_not_found", "Session not found", False, session_id=request.session_id)
        except RuntimeError as exc:
            return failure(request.request_id, "patch_apply_failed", str(exc), False, session_id=request.session_id)
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
                commit = git_ops.resolve_ref(cache_path, request.ref_or_commit or repo.default_ref)
                graph_worktree = settings.graph_worktree_root / f"{request.repo_id}-{commit[:12]}"
                git_ops.ensure_worktree(cache_path, graph_worktree, commit, clean=True)
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
            state_store.append_workspace_operation(
                repo_id=session.repo_id,
                workspace_id=session.workspace_id,
                session_id=session.session_id,
                kind="gitnexus_status",
                summary=f"Checked GitNexus status: {state.status.value}",
                metadata={"last_indexed_at": state.last_indexed_at, "graph_status": state.status.value},
                workspace_version=session.workspace_version,
            )
            return success(request.request_id, encode(state), repo_id=session.repo_id, session_id=session.session_id)
        if request.repo_id is not None:
            repo = settings.repos.get(request.repo_id)
            if repo is None:
                return failure(request.request_id, "repo_not_found", "Repository not found", False, repo_id=request.repo_id)
            cache_path = git_ops.cache_path(request.repo_id)
            try:
                commit = git_ops.resolve_ref(cache_path, request.ref_or_commit or repo.default_ref)
                target = GraphTarget.repo(request.repo_id, commit)
                state = graph_service.status(target)
            except Exception as exc:
                return failure(request.request_id, "graph_status_failed", str(exc), True, repo_id=request.repo_id)
            return success(request.request_id, encode(state), repo_id=request.repo_id)
        return failure(request.request_id, "graph_target_required", "repo_id or session_id is required", False)

    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        await git_ops.cancel_clones()

    return app
