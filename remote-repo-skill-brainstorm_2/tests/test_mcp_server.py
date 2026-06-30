import io
import json

from remote_repo_service.mcp_server import HttpRemoteRepoApiClient, McpServer, serve_stdio


class FakeApiClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def post(self, path: str, payload: dict[str, object]) -> dict[str, object]:
        self.calls.append((path, payload))
        if path == "/v1/sessions":
            return {"ok": True, "data": {"session_id": "sess_mcp", "workspace_version": 1}}
        if path == "/v1/files/read":
            return {"ok": True, "data": {"content": "# Remote README\n"}}
        return {"ok": True, "data": {}}


def request(request_id: int, method: str, params: dict[str, object] | None = None) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}


def test_mcp_initialize_and_tool_list_advertise_remote_repo_tools() -> None:
    server = McpServer(FakeApiClient())

    initialized = server.handle(
        request(
            1,
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "opencode", "version": "1.15.5"},
            },
        )
    )
    listed = server.handle(request(2, "tools/list"))

    assert initialized["result"]["protocolVersion"] == "2025-06-18"
    assert initialized["result"]["capabilities"]["tools"] == {"listChanged": False}
    tools = {tool["name"]: tool for tool in listed["result"]["tools"]}
    assert {
        "list_repos",
        "add_repo",
        "remove_repo",
        "update_repo",
        "reload_config",
        "create_session",
        "run_shell",
        "read_file",
        "apply_patch",
    }.issubset(tools)
    assert tools["run_shell"]["inputSchema"]["required"] == ["session_id", "command"]
    assert tools["add_repo"]["inputSchema"]["required"] == ["repo_id", "name", "remote_url"]
    assert tools["remove_repo"]["inputSchema"]["required"] == ["repo_id"]
    assert tools["update_repo"]["inputSchema"]["required"] == ["repo_id"]
    assert "required" not in tools["reload_config"]["inputSchema"]


def test_mcp_tool_calls_forward_arguments_to_the_rest_service() -> None:
    client = FakeApiClient()
    server = McpServer(client)

    created = server.handle(
        request(1, "tools/call", {"name": "create_session", "arguments": {"repo_id": "smoke", "ref_or_commit": "main"}})
    )
    read = server.handle(
        request(
            2,
            "tools/call",
            {"name": "read_file", "arguments": {"session_id": "sess_mcp", "path": "README.md", "start_line": 1}},
        )
    )

    assert client.calls[0][0] == "/v1/sessions"
    assert client.calls[0][1]["repo_id"] == "smoke"
    assert "request_id" in client.calls[0][1]
    assert client.calls[1][0] == "/v1/files/read"
    assert client.calls[1][1]["session_id"] == "sess_mcp"
    assert created["result"]["structuredContent"]["data"]["session_id"] == "sess_mcp"
    assert "Remote README" in read["result"]["content"][0]["text"]

    add_repo = server.handle(
        request(
            3,
            "tools/call",
            {
                "name": "add_repo",
                "arguments": {
                    "repo_id": "new",
                    "name": "New Repo",
                    "remote_url": "https://example.com/new.git",
                    "default_ref": "main",
                },
            },
        )
    )
    reloaded = server.handle(request(4, "tools/call", {"name": "reload_config", "arguments": {}}))

    assert client.calls[2][0] == "/v1/repos/add"
    assert client.calls[2][1]["repo_id"] == "new"
    assert client.calls[2][1]["default_ref"] == "main"
    assert add_repo["result"]["isError"] is False
    assert client.calls[3][0] == "/v1/config/reload"
    assert reloaded["result"]["isError"] is False

    removed = server.handle(
        request(5, "tools/call", {"name": "remove_repo", "arguments": {"repo_id": "old"}})
    )
    updated = server.handle(
        request(
            6,
            "tools/call",
            {
                "name": "update_repo",
                "arguments": {
                    "repo_id": "existing",
                    "name": "Renamed",
                    "default_ref": "develop",
                },
            },
        )
    )

    assert client.calls[4][0] == "/v1/repos/remove"
    assert client.calls[4][1]["repo_id"] == "old"
    assert removed["result"]["isError"] is False
    assert client.calls[5][0] == "/v1/repos/update"
    assert client.calls[5][1]["repo_id"] == "existing"
    assert client.calls[5][1]["name"] == "Renamed"
    assert client.calls[5][1]["default_ref"] == "develop"
    assert updated["result"]["isError"] is False


def test_mcp_reports_service_and_unknown_tool_failures_as_tool_visible_errors() -> None:
    class FailingApiClient:
        def post(self, path: str, payload: dict[str, object]) -> dict[str, object]:
            return {
                "ok": False,
                "error": {"code": "session_not_found", "message": "Session not found", "retryable": False},
            }

    server = McpServer(FailingApiClient())

    service_failure = server.handle(
        request(1, "tools/call", {"name": "get_session_state", "arguments": {"session_id": "sess_missing"}})
    )
    unknown_tool = server.handle(request(2, "tools/call", {"name": "missing", "arguments": {}}))

    assert service_failure["result"]["isError"] is True
    assert "session_not_found" in service_failure["result"]["content"][0]["text"]
    assert unknown_tool["error"]["code"] == -32602


def test_stdio_server_writes_one_json_rpc_response_per_request_line() -> None:
    server = McpServer(FakeApiClient())
    stdin = io.StringIO(json.dumps(request(1, "ping")) + "\n" + json.dumps({"method": "notifications/initialized"}) + "\n")
    stdout = io.StringIO()

    serve_stdio(server, stdin, stdout)

    lines = stdout.getvalue().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0]) == {"jsonrpc": "2.0", "id": 1, "result": {}}


def test_mcp_notifications_do_not_receive_responses_even_when_an_id_is_present() -> None:
    server = McpServer(FakeApiClient())

    response = server.handle({"jsonrpc": "2.0", "id": 99, "method": "notifications/initialized"})

    assert response is None


def test_http_mcp_client_sends_configured_api_key(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self) -> bytes:
            return b'{"ok": true, "data": {}}'

    def fake_urlopen(request, timeout):
        captured["headers"] = dict(request.header_items())
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    client = HttpRemoteRepoApiClient("http://remote.example", api_key="server-secret")
    response = client.post("/v1/repos", {"request_id": "test"})

    assert response["ok"] is True
    assert captured["headers"]["X-api-key"] == "server-secret"
    assert captured["timeout"] == 30
