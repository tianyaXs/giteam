# OpenCode MCP Integration

OpenCode uses two separate pieces:

```text
OpenCode Skill -> chooses the workflow and MCP tools
OpenCode MCP client -> stdio JSON-RPC -> Remote Repo MCP bridge -> HTTP /v1/* -> Remote Repo Session Service
```

The MCP bridge does not access repository files. It translates MCP tool calls into requests to the existing Remote Repo Session Service.

## Register the MCP Server

Add these entries to `~/.config/opencode/opencode.jsonc`. Keep the existing configuration fields. The `skills.paths` entry lets OpenCode load the Skill directly from this repository.

```jsonc
{
  "mcp": {
    "remote_repo": {
      "type": "local",
      "command": [
        "/path/to/python3",
        "/path/to/remote-repo-skill-brainstorm_2/src/remote_repo_service/mcp_server.py",
        "--base-url",
        "http://127.0.0.1:8765"
      ],
      "timeout": 30000
    }
  },
  "skills": {
    "paths": [
      "/path/to/remote-repo-skill-brainstorm_2/skills"
    ]
  }
}
```

Use the reachable service URL as `--base-url` when OpenCode and the session service run on different machines. The configured Python must be version 3.10 or newer.

Restart OpenCode and verify that it starts the bridge:

```bash
opencode mcp list
```

The `remote_repo` entry should show as connected. This is a local stdio MCP server, so it is not a network endpoint.

Restart OpenCode after saving. Invoke `$opencode-remote-repo` explicitly in the first message so the Agent receives the required remote-only workflow.

## Start the Service

Start the HTTP service before using the MCP tools:

```bash
REMOTE_REPO_SERVICE_CONFIG=/absolute/path/service.json \
python -m remote_repo_service start --host 127.0.0.1 --port 8765
```

Or use uvicorn directly:

```bash
REMOTE_REPO_SERVICE_CONFIG=/absolute/path/service.json \
python -m uvicorn --app-dir src remote_repo_service.app:create_app --factory \
  --host 127.0.0.1 --port 8765
```

## First Agent Request

```text
$opencode-remote-repo
List configured remote repositories, sync smoke, create a session from main,
then read README.md. Use only the remote_repo MCP tools for this repository.
```

The expected order is:

1. `list_repos`
2. `sync_repo(repo_id)`
3. `create_session(repo_id, ref_or_commit)`
4. Save the returned `session_id`
5. `read_file(session_id, path)`

MCP is stateless with respect to an OpenCode conversation. The Agent must preserve and pass `session_id` on every session-scoped call. This is deliberate: it prevents a shared MCP process from silently applying a command to the wrong remote workspace.

## Tool Surface

The `remote_repo` MCP server exposes `capabilities`, `list_repos`, `sync_repo`, `add_repo`, `remove_repo`, `update_repo`, `reload_config`, `create_session`, `get_session_state`, `run_shell`, `read_file`, `list_files`, `find_files`, `grep`, `write_file`, `edit_file`, `apply_patch`, `graph_analyze`, and `graph_status`.

`add_repo`, `remove_repo`, and `update_repo` let you manage configured repositories without restarting the service. `reload_config` picks up changes made to the configuration file by external tools.

OpenCode may display the tool names with the server name as a prefix. The exact JSON schemas are returned by MCP `tools/list`; the Skill includes the intended workflow and guardrails.

## Strict Remote-Only Mode

In a dedicated remote-console OpenCode configuration, disable built-in local project tools so the Agent cannot fall back to them:

```jsonc
{
  "tools": {
    "bash": false,
    "read": false,
    "glob": false,
    "grep": false,
    "edit": false,
    "write": false,
    "apply_patch": false
  }
}
```

Do not disable the `remote_repo` MCP server. The MCP tools remain available and operate only through the remote service.
