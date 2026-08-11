---
name: giteam-remote-repo
description: Use when the agent needs to inspect, test, or modify a server-hosted remote repository through the `remote_repo` MCP server. Trigger for GitLab-backed remote workspaces, commit-pinned repository sessions, remote shell or file operations, and GitNexus graph operations when no local checkout may be used.
---

# Giteam Remote Repo

Use tools supplied by the `remote_repo` MCP server. Do not use local `bash`, `read`, `glob`, `grep`, `edit`, `write`, or `apply_patch` for the target repository.

## Giteam Startup Contract

When this Skill is used from Giteam's embedded agent, do not search local config files, SQLite databases, `service.json`, or environment variables for the Remote Repo Service URL or API key. Giteam starts the `remote_repo` MCP server through its launcher, and that launcher resolves `service_url` and `api_key` from the Giteam desktop settings before the MCP tools are available.

The repository list and repository URLs come from the Remote Repo Service configuration managed by Giteam. Use `list_repos` to discover them. If a repository is missing or needs a changed URL, use `add_repo`, `update_repo`, or ask the user to change it in Giteam; do not hard-code repository URLs in agent config.

## Required Workflow

1. Call `list_repos` and select a configured `repo_id`. If the repository is not configured, call `add_repo` with `repo_id`, `name`, and `remote_url` first. Use `remove_repo` or `update_repo` if the repository needs to be removed or reconfigured.
2. Call `sync_repo` before creating a new session.
3. Call `create_session` with `repo_id` and `ref_or_commit`.
4. Preserve the returned `session_id` and provide it to every session-scoped MCP call.
5. Prefer `read_file`, `list_files`, `find_files`, and `grep` for code context.
6. Use `run_shell`, `write_file`, `edit_file`, or `apply_patch` only when the requested operation needs it.
7. Call `get_session_state` after an ambiguous result, failure, truncation, or before an important follow-up operation.
8. Call `reload_config` if the service configuration may have been changed outside this conversation and `list_repos` looks stale.

## State Rules

- A created session is pinned to its resolved `base_commit`; it never follows a moving branch.
- Treat `workspace_version` as mutable state. File-changing tools and `run_shell` can increment it.
- Use `repo_head` graph targets with `repo_id`; use `session_workspace` graph targets with `session_id`.
- Never use these tools for commit, push, merge, rebase, or remote branch updates. Those operations are outside V0.

Read `references/mcp-tools.md` before choosing an unfamiliar tool or graph target. Read `references/api.md` only when the raw HTTP envelope matters for debugging the bridge.
