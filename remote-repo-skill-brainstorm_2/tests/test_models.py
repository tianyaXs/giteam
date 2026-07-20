from remote_repo_service.models import (
    ApiError,
    ErrorResponse,
    GraphStatus,
    GraphTargetType,
    RunShellRequest,
    SuccessResponse,
)


def test_success_response_contains_state_summary() -> None:
    response = SuccessResponse(
        request_id="req_1",
        session_id="sess_1",
        state={"workspace_version": 2},
        data={"ok": True},
    )

    assert response.ok is True
    assert response.state["workspace_version"] == 2


def test_error_response_contains_retryable_flag() -> None:
    response = ErrorResponse(
        request_id="req_1",
        session_id="sess_1",
        state={"workspace_version": 2},
        error=ApiError(code="command_timed_out", message="Command timed out", retryable=True),
    )

    assert response.ok is False
    assert response.error.retryable is True


def test_run_shell_request_requires_command() -> None:
    request = RunShellRequest(request_id="req_1", session_id="sess_1", command="git status")

    assert request.command == "git status"


def test_graph_enums_match_spec() -> None:
    assert GraphTargetType.repo_head.value == "repo_head"
    assert GraphTargetType.session_workspace.value == "session_workspace"
    assert GraphStatus.ready.value == "READY"
