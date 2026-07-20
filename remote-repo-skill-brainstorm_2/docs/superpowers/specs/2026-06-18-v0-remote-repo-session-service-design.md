# V0 Remote Repo Session Service Design

## Purpose

V0 is an OpenCode remote execution and repository session service.

OpenCode remains the local conversation and decision layer, but it does not directly access code or execution environments. All code access and execution operations must happen indirectly through server APIs. The server is the only component that touches business repository files, Git checkouts or worktrees, shell execution environments, GitLab synchronization, and GitNexus analysis.

The first version is optimized for a single-user or internal-network prototype. It should prove that OpenCode can operate on server-hosted repositories without a local checkout, while leaving a clear path toward a small-team shared service.

## Core Boundaries

The server owns repository state and execution state. OpenCode sends requests and receives structured results.

V0 is not a read-only repository browser. It supports remote command execution through `run_shell(command: string)`, and those commands may produce read or write side effects. All side effects are limited to the session workspace worktree. `run_shell` must not directly modify the GitLab remote repository, and it does not imply commit, push, merge, or remote branch updates.

V0 does not implement a full command risk gateway. It enforces only the prototype boundary:

- Commands run inside the selected workspace.
- Current working directory must stay inside the workspace.
- Commands have a timeout.
- stdout, stderr, and diff summaries are bounded.
- Results include structured state before and after execution.

This is acceptable only for the single-user/internal prototype. Before moving to a shared-team service, command execution must move behind stricter policy, confirmation, sandboxing, and audit controls.

## Core Objects

### Repo

`Repo` represents a configured GitLab repository on the server.

It stores provider configuration, default branch, local server cache location, last sync state, and available refs. `sync_repo` updates the server's local GitLab cache only. It does not create a workspace and does not change the base commit of any existing workspace.

### Session

`Session` represents one OpenCode interaction context.

OpenCode creates a session with `repo_id` plus a `ref` or `commit`. The server resolves the ref to an exact commit before creating the workspace. After that, OpenCode can send `session_id` on subsequent requests, and the server resolves it to the repository, workspace, base commit, and current workspace version.

### Workspace

`Workspace` is a server-side worktree created for a session.

The workspace baseline is a commit-level immutable snapshot. Once created, the workspace belongs to one fixed `base_commit`; it never silently follows a floating branch HEAD. Later remote branch updates affect future sessions only, not existing workspaces.

The workspace has two important version markers:

- `base_commit`: immutable baseline commit.
- `workspace_version`: mutable server-side version that increments when `run_shell` changes files.

The server tracks whether the workspace is dirty by collecting status and diff summaries before and after command execution.

### GraphTarget

`GraphTarget` identifies what GitNexus analyzed.

V0 supports two graph targets:

- `repo_head`: analysis for a repository commit, normally the current cached repo head.
- `session_workspace`: analysis for a specific workspace state.

The default target is `repo_head`. OpenCode must explicitly request `session_workspace` analysis when it needs GitNexus results for command-modified workspace content.

Graph results are version-bound. A `repo_head` graph is bound to a commit. A `session_workspace` graph is bound to `workspace_id` plus `workspace_version`.

## V0 API Surface

### `list_repos`

Returns repositories configured on the server and visible to the caller.

The V0 caller model can be a single API key, but response fields should preserve the future shape for a shared service: provider, default branch, last sync state, and known refs.

### `sync_repo`

Fetches or updates the server's local cache from GitLab.

This operation only changes server cache state. It does not create sessions, does not update existing workspace baselines, and does not implicitly rebase any workspace onto a newer branch head.

### `create_session`

Creates an OpenCode session and server-side workspace.

Request input includes `repo_id` and `ref` or `commit`. The server resolves this input to a fixed `base_commit`, creates a workspace from that commit, and returns `session_id`, `workspace_id`, `base_commit`, `workspace_version`, and dirty state.

### `get_session_state`

Returns the stable state checkpoint for a session.

It includes session, repository, workspace, base commit, current workspace version, dirty state, local cache state, graph summaries, and the most recent command summary when available.

OpenCode should call this before important operations when it needs to re-establish remote state.

### `run_shell`

Runs a shell command string in the session workspace.

Request input includes `session_id` and `command`. The server executes the command with the workspace as the default root. Optional cwd values must be repository-relative and must not escape the workspace.

The response includes:

- `command_id`
- cwd
- exit code
- stdout
- stderr
- elapsed time
- timeout flag
- truncation flags
- status before execution
- status after execution
- diff summary
- updated `workspace_version` when files changed

Commands may change workspace files. Those changes are limited to the workspace worktree and do not affect GitLab remote state.

### `read_file_slice`

Reads a bounded file slice from the session workspace.

Request input includes `session_id`, repo-relative path, and a line or byte range. The server rejects absolute paths, path traversal, and paths outside the workspace.

The response includes file content, truncation information, file identity metadata, and the current `workspace_version`.

### `analyze_graph`

Runs GitNexus analysis for a graph target.

The default target is `repo_head`. A request can explicitly choose `session_workspace` to analyze the current workspace state. The resulting graph state is bound to the target commit or workspace version.

### `get_graph_status`

Returns GitNexus status for a graph target.

The status includes target type, target commit or workspace version, `READY`, `STALE`, `INDEXING`, or `FAILED`, last indexed time, and error details when analysis failed.

## Key Flows

### Session Startup

OpenCode calls `list_repos`. If needed, it calls `sync_repo` to update the server cache. It then calls `create_session(repo_id, ref_or_commit)`.

The server resolves `ref_or_commit` to a fixed commit, creates the workspace from that commit, and returns session and workspace state. The session does not follow later branch updates.

### Remote Command Execution

OpenCode calls `run_shell(session_id, command)`.

The server executes inside the session workspace, applies timeout and output limits, captures status before and after, and returns structured command output and state summaries.

If files changed, the workspace becomes dirty and `workspace_version` increments. The changes remain local to that workspace.

### Code Context Reading

OpenCode can use `run_shell` for exploratory commands and `read_file_slice` for stable, bounded context reads.

`read_file_slice` is preferred when OpenCode needs file content with clear path checks, range limits, metadata, and future auditability.

### GitNexus Analysis

V0 proves that the server can run real GitNexus analysis and maintain graph state. It does not need to expose semantic search or symbol context yet.

By default, analysis targets `repo_head`. Workspace analysis must be explicit. If a workspace is modified after analysis, the workspace graph becomes `STALE` because the graph no longer matches the current `workspace_version`.

### State Recovery

OpenCode calls `get_session_state` before important follow-up operations or after ambiguous output.

This lets OpenCode recover the server-side truth even when command output was truncated, a command failed, or the session context needs to be reloaded.

## Error Model

Every API returns a structured envelope with request identity and relevant state.

Successful responses include:

- `ok: true`
- `request_id`
- `repo_id` or `session_id`
- current state summary
- `data`
- warnings

Failed responses include:

- `ok: false`
- `request_id`
- `repo_id` or `session_id` when available
- current state summary when available
- `error.code`
- `error.message`
- `error.retryable`
- `error.details`

Important V0 error codes include:

- repo not found
- ref resolution failed
- workspace creation failed
- command timed out
- command output truncated
- cwd escaped workspace
- path escaped workspace
- file range too large
- graph analysis failed
- graph target version mismatch

## Limits

V0 should define conservative defaults:

- Command timeout.
- Maximum stdout bytes.
- Maximum stderr bytes.
- Maximum diff summary bytes.
- Maximum file slice lines or bytes.
- Maximum response bytes.

The exact values can be configuration defaults, but responses must always report truncation so OpenCode knows when it has incomplete output.

## GitNexus Version Rules

Graph state must never float across versions.

For `repo_head`, graph status is tied to a commit. For `session_workspace`, graph status is tied to `workspace_id` and `workspace_version`.

If the workspace changes after graph analysis, the previous workspace graph is no longer current and must be reported as `STALE`.

## V0 Verification

The prototype should verify at least these flows:

1. `sync_repo` can fetch or update a configured GitLab repository into the server cache.
2. `create_session` resolves a ref to a fixed commit and creates a workspace from that commit.
3. `run_shell` executes in the workspace, returns structured output, and reports state before and after execution.
4. `run_shell` file changes are limited to the workspace and update `workspace_version`.
5. `read_file_slice` returns bounded content and rejects paths outside the workspace.
6. `analyze_graph` and `get_graph_status` can distinguish `repo_head` from `session_workspace`.
7. Workspace graph status becomes `STALE` when the workspace changes after analysis.

## Deferred From V0

These are intentionally deferred:

- Multi-user authorization.
- Full command risk classification.
- Confirmation gates for dangerous commands.
- Strict sandbox runner.
- Commit, push, merge, or review artifact creation.
- Semantic GitNexus APIs such as search by intent or symbol context.
- MCP adapter.
- Long-running command task polling and paginated logs.
