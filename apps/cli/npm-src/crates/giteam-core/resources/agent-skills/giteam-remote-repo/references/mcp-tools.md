# Remote Repo MCP Tools

The MCP server is configured as `remote_repo`. Agent hosts may display names with a server prefix; use the definitions exposed by that server.

| Tool | Required arguments | Purpose |
| --- | --- | --- |
| `capabilities` | none | List supported remote service capabilities. |
| `list_repos` | none | List configured remote repositories. |
| `sync_repo` | `repo_id` | Refresh the server mirror cache. |
| `add_repo` | `repo_id`, `name`, `remote_url` | Register a new repository and queue an initial clone. |
| `remove_repo` | `repo_id` | Remove a repository from the configuration. |
| `update_repo` | `repo_id` | Update repository fields (name, remote_url, default_ref, auth_method, credential_id). |
| `reload_config` | none | Reload the service configuration from disk. |
| `create_session` | `repo_id`, `ref_or_commit` | Create a commit-pinned workspace. |
| `get_session_state` | `session_id` | Recover current remote workspace state. |
| `run_shell` | `session_id`, `command` | Run a bounded command in the remote workspace. |
| `read_file` | `session_id`, `path` | Read a bounded file slice. |
| `list_files` | `session_id` | List workspace paths. |
| `find_files` | `session_id`, `query` | Find files by glob or substring. |
| `grep` | `session_id`, `pattern` | Search workspace text with a regular expression. |
| `write_file` | `session_id`, `path`, `content` | Write a remote workspace file. |
| `edit_file` | `session_id`, `path`, `old_text`, `new_text` | Replace exact text in a remote file. |
| `apply_patch` | `session_id`, `patch` | Apply a unified Git patch in the workspace. |
| `graph_analyze` | target-dependent | Analyze `repo_head` or `session_workspace`. |
| `graph_status` | target-dependent | Check graph state for the same target types. |

For `graph_analyze` and `graph_status`, pass `target_type: "repo_head"` with `repo_id`, or `target_type: "session_workspace"` with `session_id`.
