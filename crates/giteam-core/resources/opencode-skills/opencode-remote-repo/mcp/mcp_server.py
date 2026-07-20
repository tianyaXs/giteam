from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol, TextIO
from uuid import uuid4


DEFAULT_BASE_URL = "http://127.0.0.1:8765"
LATEST_PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOL_VERSIONS = {LATEST_PROTOCOL_VERSION, "2025-03-26", "2024-11-05", "2024-10-07"}


class RemoteRepoApiClient(Protocol):
    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]: ...


class HttpRemoteRepoApiClient:
    def __init__(self, base_url: str, timeout_seconds: int = 30, api_key: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.api_key = (api_key if api_key is not None else os.environ.get("REMOTE_REPO_SERVICE_API_KEY", "")).strip()

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                return decode_json(response.read(), url)
        except urllib.error.HTTPError as exc:
            body = exc.read()
            try:
                return decode_json(body, url)
            except ValueError as decode_error:
                raise RuntimeError(f"Remote repo service returned HTTP {exc.code} from {url}") from decode_error
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Could not connect to {url}: {exc.reason}") from exc


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    endpoint: str
    input_schema: dict[str, Any]
    payload: Callable[[dict[str, Any]], dict[str, Any]]


def object_schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = required
    return schema


def string(description: str) -> dict[str, str]:
    return {"type": "string", "description": description}


def positive_integer(description: str) -> dict[str, Any]:
    return {"type": "integer", "minimum": 1, "description": description}


def optional_payload(*keys: str) -> Callable[[dict[str, Any]], dict[str, Any]]:
    return lambda arguments: {key: arguments[key] for key in keys if key in arguments}


def graph_payload(arguments: dict[str, Any]) -> dict[str, Any]:
    target_type = arguments.get("target_type", "repo_head")
    if target_type == "repo_head":
        repo_id = arguments.get("repo_id")
        if not repo_id:
            raise ValueError("repo_id is required when target_type is repo_head")
        return {"target_type": target_type, "repo_id": repo_id}
    session_id = arguments.get("session_id")
    if not session_id:
        raise ValueError("session_id is required when target_type is session_workspace")
    return {"target_type": target_type, "session_id": session_id}


TOOLS = {
    spec.name: spec
    for spec in [
        ToolSpec("capabilities", "List the remote repository service capabilities.", "/v1/tools", object_schema({}), lambda _: {}),
        ToolSpec("list_repos", "List repositories configured on the remote repository service.", "/v1/repos", object_schema({}), lambda _: {}),
        ToolSpec(
            "sync_repo",
            "Fetch a configured repository into the server mirror cache.",
            "/v1/repos/sync",
            object_schema({"repo_id": string("Configured repository id.")}, ["repo_id"]),
            optional_payload("repo_id"),
        ),
        ToolSpec(
            "add_repo",
            "Add a new repository to the remote service configuration and queue an initial clone.",
            "/v1/repos/add",
            object_schema(
                {
                    "repo_id": string("Unique repository identifier."),
                    "name": string("Display name."),
                    "remote_url": string("Git clone URL."),
                    "default_ref": string("Default branch or tag. Defaults to main."),
                    "auth_method": string("Optional authentication method."),
                    "credential_id": string("Optional credential identifier."),
                },
                ["repo_id", "name", "remote_url"],
            ),
            optional_payload("repo_id", "name", "remote_url", "default_ref", "auth_method", "credential_id"),
        ),
        ToolSpec(
            "reload_config",
            "Reload the service configuration from disk.",
            "/v1/config/reload",
            object_schema({}),
            lambda _: {},
        ),
        ToolSpec(
            "remove_repo",
            "Remove a repository from the remote service configuration.",
            "/v1/repos/remove",
            object_schema({"repo_id": string("Configured repository id.")}, ["repo_id"]),
            optional_payload("repo_id"),
        ),
        ToolSpec(
            "update_repo",
            "Update an existing repository configuration.",
            "/v1/repos/update",
            object_schema(
                {
                    "repo_id": string("Configured repository id."),
                    "name": string("New display name."),
                    "remote_url": string("New Git clone URL."),
                    "default_ref": string("New default branch or tag."),
                    "auth_method": string("New authentication method."),
                    "credential_id": string("New credential identifier."),
                },
                ["repo_id"],
            ),
            optional_payload("repo_id", "name", "remote_url", "default_ref", "auth_method", "credential_id"),
        ),
        ToolSpec(
            "create_session",
            "Create a commit-pinned remote workspace. Save the returned session_id for later calls.",
            "/v1/sessions",
            object_schema(
                {
                    "repo_id": string("Configured repository id."),
                    "ref_or_commit": string("Branch, tag, or commit to pin."),
                },
                ["repo_id", "ref_or_commit"],
            ),
            optional_payload("repo_id", "ref_or_commit"),
        ),
        ToolSpec(
            "get_session_state",
            "Get the current state of a remote session workspace.",
            "/v1/sessions/state",
            object_schema({"session_id": string("Remote session id.")}, ["session_id"]),
            optional_payload("session_id"),
        ),
        ToolSpec(
            "run_shell",
            "Run a bounded shell command in a remote session workspace.",
            "/v1/shell/run",
            object_schema(
                {
                    "session_id": string("Remote session id."),
                    "command": string("Shell command to run remotely."),
                    "cwd": string("Workspace-relative directory. Defaults to '.'."),
                },
                ["session_id", "command"],
            ),
            optional_payload("session_id", "command", "cwd"),
        ),
        ToolSpec(
            "read_file",
            "Read a bounded text slice from a remote workspace file.",
            "/v1/files/read",
            object_schema(
                {
                    "session_id": string("Remote session id."),
                    "path": string("Workspace-relative file path."),
                    "start_line": positive_integer("First line. Defaults to 1."),
                    "max_lines": positive_integer("Maximum number of lines to return."),
                },
                ["session_id", "path"],
            ),
            optional_payload("session_id", "path", "start_line", "max_lines"),
        ),
        ToolSpec(
            "list_files",
            "List files and directories under a remote workspace path.",
            "/v1/files/list",
            object_schema(
                {
                    "session_id": string("Remote session id."),
                    "path": string("Workspace-relative directory. Defaults to '.'."),
                    "max_entries": positive_integer("Maximum entries. Defaults to 200."),
                },
                ["session_id"],
            ),
            optional_payload("session_id", "path", "max_entries"),
        ),
        ToolSpec(
            "find_files",
            "Find remote workspace files by glob or case-insensitive substring.",
            "/v1/find/files",
            object_schema(
                {
                    "session_id": string("Remote session id."),
                    "query": string("Glob or substring to find."),
                    "max_results": positive_integer("Maximum matches. Defaults to 100."),
                },
                ["session_id", "query"],
            ),
            optional_payload("session_id", "query", "max_results"),
        ),
        ToolSpec(
            "grep",
            "Search remote workspace text files with a regular expression.",
            "/v1/find/text",
            object_schema(
                {
                    "session_id": string("Remote session id."),
                    "pattern": string("Regular expression pattern."),
                    "path": string("Workspace-relative search path. Defaults to '.'."),
                    "max_results": positive_integer("Maximum matches. Defaults to 100."),
                },
                ["session_id", "pattern"],
            ),
            optional_payload("session_id", "pattern", "path", "max_results"),
        ),
        ToolSpec(
            "write_file",
            "Write complete file content in a remote workspace.",
            "/v1/files/write",
            object_schema(
                {
                    "session_id": string("Remote session id."),
                    "path": string("Workspace-relative file path."),
                    "content": string("Complete new file content."),
                    "create_dirs": {"type": "boolean", "description": "Create parent directories. Defaults to true."},
                },
                ["session_id", "path", "content"],
            ),
            optional_payload("session_id", "path", "content", "create_dirs"),
        ),
        ToolSpec(
            "edit_file",
            "Replace exact text in a remote workspace file.",
            "/v1/files/edit",
            object_schema(
                {
                    "session_id": string("Remote session id."),
                    "path": string("Workspace-relative file path."),
                    "old_text": string("Exact text to replace."),
                    "new_text": string("Replacement text."),
                    "replace_all": {"type": "boolean", "description": "Replace every occurrence. Defaults to false."},
                },
                ["session_id", "path", "old_text", "new_text"],
            ),
            optional_payload("session_id", "path", "old_text", "new_text", "replace_all"),
        ),
        ToolSpec(
            "apply_patch",
            "Apply a unified Git patch to a remote workspace.",
            "/v1/files/apply-patch",
            object_schema(
                {"session_id": string("Remote session id."), "patch": string("Unified diff patch content.")},
                ["session_id", "patch"],
            ),
            optional_payload("session_id", "patch"),
        ),
        ToolSpec(
            "graph_analyze",
            "Run GitNexus analysis for a repository head or session workspace.",
            "/v1/graph/analyze",
            object_schema(
                {
                    "target_type": {"type": "string", "enum": ["repo_head", "session_workspace"], "description": "Graph target type."},
                    "repo_id": string("Required for repo_head."),
                    "session_id": string("Required for session_workspace."),
                },
            ),
            graph_payload,
        ),
        ToolSpec(
            "graph_status",
            "Get GitNexus status for a repository head or session workspace.",
            "/v1/graph/status",
            object_schema(
                {
                    "target_type": {"type": "string", "enum": ["repo_head", "session_workspace"], "description": "Graph target type."},
                    "repo_id": string("Required for repo_head."),
                    "session_id": string("Required for session_workspace."),
                },
            ),
            graph_payload,
        ),
    ]
}


class McpServer:
    def __init__(self, api_client: RemoteRepoApiClient) -> None:
        self.api_client = api_client

    def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {})
        if method in {"notifications/initialized", "notifications/cancelled"}:
            return None
        if request_id is None:
            return None
        if not isinstance(params, dict):
            return rpc_error(request_id, -32602, "Invalid params")
        if method == "initialize":
            return rpc_result(request_id, self.initialize(params))
        if method == "ping":
            return rpc_result(request_id, {})
        if method == "tools/list":
            return rpc_result(request_id, {"tools": [tool_definition(tool) for tool in TOOLS.values()]})
        if method == "tools/call":
            return self.call_tool(request_id, params)
        if method == "logging/setLevel":
            return rpc_result(request_id, {})
        return rpc_error(request_id, -32601, "Method not found")

    def initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        requested = params.get("protocolVersion")
        protocol_version = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else LATEST_PROTOCOL_VERSION
        return {
            "protocolVersion": protocol_version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "remote-repo-service", "version": "0.2.0"},
        }

    def call_tool(self, request_id: Any, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        arguments = params.get("arguments", {})
        tool = TOOLS.get(name)
        if tool is None:
            return rpc_error(request_id, -32602, "Unknown tool")
        if not isinstance(arguments, dict):
            return rpc_error(request_id, -32602, "Tool arguments must be an object")
        missing = [key for key in tool.input_schema.get("required", []) if key not in arguments]
        if missing:
            return tool_error(request_id, {"error": {"code": "invalid_tool_arguments", "message": f"Missing required arguments: {', '.join(missing)}"}})
        try:
            payload = tool.payload(arguments)
            payload["request_id"] = mcp_request_id(name)
            response = self.api_client.post(tool.endpoint, payload)
        except Exception as exc:
            return tool_error(request_id, {"error": {"code": "mcp_bridge_error", "message": str(exc)}})
        if response.get("ok") is True:
            return rpc_result(request_id, tool_result(response, is_error=False))
        return tool_error(request_id, response)


def decode_json(body: bytes, url: str) -> dict[str, Any]:
    try:
        decoded = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Remote repo service returned non-JSON content from {url}") from exc
    if not isinstance(decoded, dict):
        raise ValueError(f"Remote repo service returned a JSON value instead of an object from {url}")
    return decoded


def tool_definition(tool: ToolSpec) -> dict[str, Any]:
    return {"name": tool.name, "description": tool.description, "inputSchema": tool.input_schema}


def tool_result(response: dict[str, Any], is_error: bool) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(response, ensure_ascii=True, indent=2, sort_keys=True)}],
        "structuredContent": response,
        "isError": is_error,
    }


def tool_error(request_id: Any, response: dict[str, Any]) -> dict[str, Any]:
    return rpc_result(request_id, tool_result(response, is_error=True))


def rpc_result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def mcp_request_id(tool_name: str) -> str:
    return f"mcp_{tool_name}_{int(time.time() * 1000)}_{uuid4().hex[:8]}"


def serve_stdio(server: McpServer, stdin: TextIO, stdout: TextIO) -> None:
    for line in stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("JSON-RPC request must be an object")
            response = server.handle(request)
        except (ValueError, json.JSONDecodeError) as exc:
            response = rpc_error(None, -32700, str(exc))
        if response is not None:
            stdout.write(json.dumps(response, ensure_ascii=True) + "\n")
            stdout.flush()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Expose the Remote Repo Session Service as a stdio MCP server.")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("REMOTE_REPO_SERVICE_URL", DEFAULT_BASE_URL),
        help=f"Remote Repo Session Service URL. Defaults to {DEFAULT_BASE_URL} or REMOTE_REPO_SERVICE_URL.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("REMOTE_REPO_SERVICE_API_KEY", ""),
        help="Remote Repo Session Service API key. Defaults to REMOTE_REPO_SERVICE_API_KEY.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    serve_stdio(McpServer(HttpRemoteRepoApiClient(args.base_url, api_key=args.api_key)), sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
