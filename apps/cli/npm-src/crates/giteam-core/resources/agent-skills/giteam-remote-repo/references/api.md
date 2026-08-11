# Remote Repo Session Service API

Base URL defaults to `http://127.0.0.1:8765`.

Every endpoint accepts a caller-provided `request_id`. Successful responses use:

```json
{"ok": true, "request_id": "...", "repo_id": "...", "session_id": "...", "state": {}, "data": {}, "warnings": []}
```

Failed responses use:

```json
{"ok": false, "request_id": "...", "repo_id": "...", "session_id": "...", "state": {}, "error": {"code": "...", "message": "...", "retryable": false, "details": {}}}
```

## Endpoints

### `POST /v1/tools`

Request:

```json
{"request_id": "req_1"}
```

Returns agent-style tool adapters. Implemented mappings include `bash`, `read`, `glob`, `grep`, `write`, `edit`, and `apply_patch`.

### `POST /v1/repos`

Request:

```json
{"request_id": "req_1"}
```

Returns configured repositories in `data.repos[]`, including `repo_id`, `name`, `provider`, and `default_ref`.

### `POST /v1/repos/sync`

Request:

```json
{"request_id": "req_1", "repo_id": "demo"}
```

Fetches or creates the server-side mirror cache. It does not create or mutate sessions.

### `POST /v1/repos/add`

Request:

```json
{"request_id": "req_1", "repo_id": "demo", "name": "Demo", "remote_url": "https://gitlab.example/team/demo.git", "default_ref": "main", "auth_method": "ssh_key", "credential_id": "default"}
```

Registers a new repository, persists it to the service configuration file, and queues an initial background clone. `default_ref`, `auth_method`, and `credential_id` are optional. Returns `data.repo_id` and `data.sync_queued`.

### `POST /v1/repos/remove`

Request:

```json
{"request_id": "req_1", "repo_id": "demo"}
```

Removes a repository from the service configuration. Returns `data.repo_id` and `data.removed`.

### `POST /v1/repos/update`

Request:

```json
{"request_id": "req_1", "repo_id": "demo", "name": "Renamed", "default_ref": "develop"}
```

Updates repository fields. Only provided fields are changed. Returns `data.repo_id` and `data.updated`.

### `POST /v1/config/reload`

Request:

```json
{"request_id": "req_1"}
```

Reloads the service configuration from disk. Use this when the configuration file has been changed externally (for example, by `remote-repo-service repo add`). Returns the current list of configured repositories in `data.repos`.

### `POST /v1/sessions`

Request:

```json
{"request_id": "req_1", "repo_id": "demo", "ref_or_commit": "main"}
```

Returns `session_id`, `workspace_id`, `base_commit`, `workspace_path`, `workspace_version`, and `dirty`.

### `POST /v1/sessions/state`

Request:

```json
{"request_id": "req_1", "session_id": "sess_..."}
```

Returns the current server-side session state.

### `POST /v1/shell/run`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "command": "git status --short", "cwd": "."}
```

Runs a bounded shell command inside the session workspace. Response data includes `command_id`, `cwd`, `exit_code`, `stdout`, `stderr`, `elapsed_ms`, `timed_out`, truncation booleans, `status_before`, `status_after`, `diff_summary`, and `workspace_version`.

### `POST /v1/files/read`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "path": "README.md", "start_line": 1, "max_lines": 80}
```

Reads a bounded repo-relative file slice. Rejects absolute paths and path traversal.

### `POST /v1/files/list`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "path": ".", "max_entries": 200}
```

Lists direct child files/directories under a workspace-relative path.

### `POST /v1/find/files`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "query": "*.py", "max_results": 100}
```

Finds files by glob when the query contains glob characters, otherwise by case-insensitive substring.

### `POST /v1/find/text`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "pattern": "class .*Service", "path": ".", "max_results": 100}
```

Searches UTF-8 text files with a regular expression.

### `POST /v1/files/write`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "path": "notes/todo.txt", "content": "hello\n", "create_dirs": true}
```

Writes content inside the workspace. Increments `workspace_version` when content changes.

### `POST /v1/files/edit`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "path": "notes/todo.txt", "old_text": "hello", "new_text": "goodbye", "replace_all": false}
```

Replaces text in a workspace file. Returns replacement count and updated workspace version.

### `POST /v1/files/apply-patch`

Request:

```json
{"request_id": "req_1", "session_id": "sess_...", "patch": "diff --git ..."}
```

Applies a unified git patch with `git apply --whitespace=nowarn -` inside the workspace.

### `POST /v1/graph/analyze`

Repo-head target:

```json
{"request_id": "req_1", "repo_id": "demo", "target_type": "repo_head"}
```

Workspace target:

```json
{"request_id": "req_1", "session_id": "sess_...", "target_type": "session_workspace"}
```

Runs GitNexus analysis for the target. `repo_head` is bound to a commit. `session_workspace` is bound to the current workspace version.

### `POST /v1/graph/status`

Uses the same target fields as graph analyze. Returns `READY`, `STALE`, `INDEXING`, or `FAILED`.
