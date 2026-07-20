# Phase A: CLI and Dynamic Repository Management Design

## Purpose

Eliminate the manual `export REMOTE_REPO_SERVICE_CONFIG=...` + `uvicorn ...` startup dance for the Remote Repo Service, and lay the foundation for the eventual Docker + MCP deployment by adding runtime repository management.

## Goals

1. Provide a first-class Python package CLI: `python -m remote_repo_service`.
2. Support dynamic repository addition without editing `service.json` by hand.
3. Keep configuration discovery simple but flexible for local dev, env-driven deploys, and container mounts.
4. Persist runtime configuration changes safely (atomic writes, file locking).
5. Add authentication method reservation for future GitLab/GitHub credential handling.
6. Manage background clone lifecycle responsibly (exception handling, graceful shutdown, concurrency limits).

## Non-Goals

- Implementing actual credential injection for SSH keys, PATs, or other auth methods.
- Multi-user authorization.
- MCP adapter (deferred to Phase C).
- Docker image build scripts (deferred to Phase B).

## Design

### CLI Structure

```bash
python -m remote_repo_service start [--config PATH] [--host HOST] [--port PORT]
python -m remote_repo_service repo add <repo_id> <remote_url> [--name NAME] [--default-ref REF] [--auth-method METHOD] [--credential-id ID] [--config PATH]
python -m remote_repo_service repo list [--config PATH]
python -m remote_repo_service repo sync <repo_id> [--base-url URL]
```

- `start` loads settings and launches uvicorn.
- `repo add` writes the new repository to `service.json` directly, then optionally notifies a running service to reload its configuration.
- `repo list` prints configured repositories.
- `repo sync` triggers a sync via the running service's HTTP API.

### Configuration Path Resolution

Priority (highest to lowest):

1. Explicit `--config` argument.
2. `REMOTE_REPO_SERVICE_CONFIG` environment variable.
3. `./service.json` in the current working directory.

The resolved path is converted to an absolute path before use.

### Settings Model Changes

`RepoConfig` gains two optional fields to future-proof authentication handling:

```python
class RepoConfig(BaseModel):
    repo_id: str
    name: str
    remote_url: str
    default_ref: str = "main"
    auth_method: str | None = None
    credential_id: str | None = None
```

Valid `auth_method` values in Phase A are advisory only: `"none"`, `"ssh_key"`, `"pat"`, `"token"`. The service does not enforce or implement them yet.

### Atomic Configuration Persistence

A utility function writes `service.json` safely:

1. Acquire a `filelock` on the target file (or a sibling lock file if the target does not exist).
2. Serialize settings to JSON with indentation.
3. Write to a temporary file in the same directory as the target.
4. `fsync` the temporary file.
5. `os.replace` the temporary file over the target.
6. Release the lock.

This protects against concurrent CLI/API writes and reduces the risk of partial writes on crash.

### Runtime Configuration Reload

The service keeps the loaded `Settings` object in memory. When the configuration file changes, the service should be able to reload it without restarting.

Approaches considered:

1. **Polling mtime**: Simple, works everywhere, but adds a small delay.
2. **SIGHUP signal**: Unix-only, not Windows-friendly.
3. **Explicit reload endpoint (`POST /v1/config/reload`)**: Clean and explicit, but requires callers to know the service is running.

**Chosen approach**: explicit `POST /v1/config/reload` plus CLI `repo add` optionally calling it when `--base-url` points to a running service. This avoids cross-platform signal issues and gives predictable behavior in Docker containers.

### New API Endpoint: `POST /v1/repos/add`

Request body:

```json
{
  "request_id": "req_1",
  "repo_id": "my-gitlab",
  "name": "my-org/my-repo",
  "remote_url": "https://gitlab.com/my-org/my-repo.git",
  "default_ref": "main",
  "auth_method": "pat",
  "credential_id": "gitlab-pat-1"
}
```

Behavior:

1. Validate that `repo_id` is unique among configured repositories.
2. Build a `RepoConfig` and add it to the in-memory settings.
3. Persist the updated settings to disk atomically.
4. Return a success response immediately.
5. Queue a background clone task (subject to semaphore limit).

Response:

```json
{
  "ok": true,
  "request_id": "req_1",
  "data": {
    "repo_id": "my-gitlab",
    "sync_queued": true
  }
}
```

### Background Clone Lifecycle

- Use `asyncio.Semaphore(max_concurrent_clones=3)` to limit simultaneous clones.
- Track active clone tasks in a set stored on `GitOps` or a dedicated clone manager.
- Each clone task wraps `git_ops.sync_repo` in `asyncio.to_thread` and includes:
  - try/except around the clone
  - logging of success/failure
  - no re-raise (failure is swallowed to avoid crashing the event loop)
- On application shutdown, cancel all pending clone tasks and await them with a timeout.

### CLI `repo add` Behavior

1. Resolve config path.
2. Acquire lock with a 5-second timeout.
3. Load existing settings, validate `repo_id` uniqueness.
4. Add repository, persist atomically.
5. If `--notify-base-url` is provided, call `POST /v1/config/reload`.
6. Print confirmation.

If the lock cannot be acquired within the timeout, print:

```
Config file is locked by running service, please retry.
```

### CLI `repo sync` Behavior

1. Determine base URL (default `http://127.0.0.1:8765`, overridable by `--base-url` or `REMOTE_REPO_SERVICE_URL`).
2. POST to `/v1/repos/sync` with `repo_id`.
3. Print JSON response.

This reuses the existing client helper logic in `skills/opencode-remote-repo/scripts/remote_repo_client.py`.

## File Changes

- `src/remote_repo_service/__main__.py`: CLI entry point.
- `src/remote_repo_service/cli.py`: Argument parsing and command handlers.
- `src/remote_repo_service/config.py`: Add `auth_method`/`credential_id`, add atomic save and reload helpers.
- `src/remote_repo_service/app.py`: Add `/v1/repos/add` and `/v1/config/reload`, wire background clone tracking and shutdown.
- `src/remote_repo_service/git_ops.py`: Add async clone wrapper and task tracking.
- `src/remote_repo_service/models.py`: Add `AddRepoRequest` and `ReloadConfigRequest`.
- `pyproject.toml`: Add `filelock` dependency and console script entry point.
- `tests/test_cli.py`: CLI tests.
- `tests/test_app.py`: Add tests for new endpoints.
- `tests/test_config.py`: Add atomic save/reload tests.

## Dependencies

- `filelock>=3.0` for cross-process configuration locking.
- Existing dependencies remain unchanged.

## Verification

1. `pytest -q` passes, including new tests.
2. Manual check:
   - `python -m remote_repo_service start` starts the server from `./service.json`.
   - `python -m remote_repo_service repo add gitlab-demo https://gitlab.com/org/repo.git` updates `service.json`.
   - `python -m remote_repo_service repo list` shows the new repository.
   - `curl -X POST http://127.0.0.1:8765/v1/repos/add -d '{...}'` succeeds and queues a clone.
3. Stop signal cancels pending clone tasks without orphan git processes.

## Deferred to Phase B / Phase C

- Docker image and compose setup.
- Credential injection implementation.
- MCP server adapter.
- Repository removal and update endpoints.
- Persistent clone status store beyond in-memory state.
