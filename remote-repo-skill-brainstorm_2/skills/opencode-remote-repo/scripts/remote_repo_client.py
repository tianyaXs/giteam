#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


DEFAULT_BASE_URL = "http://127.0.0.1:8765"


def request_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}"


def post_json(base_url: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code} from {url}: {raw}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not connect to {url}: {exc.reason}") from exc


def print_response(response: dict[str, Any]) -> int:
    print(json.dumps(response, indent=2, sort_keys=True))
    return 0 if response.get("ok") is True else 2


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--base-url",
        default=os.environ.get("REMOTE_REPO_SERVICE_URL", DEFAULT_BASE_URL),
        help=f"Remote repo service URL. Defaults to {DEFAULT_BASE_URL} or REMOTE_REPO_SERVICE_URL.",
    )


def command_add_repo(args: argparse.Namespace) -> int:
    payload: dict[str, Any] = {
        "request_id": request_id("add_repo"),
        "repo_id": args.repo_id,
        "name": args.name,
        "remote_url": args.remote_url,
    }
    if args.default_ref is not None:
        payload["default_ref"] = args.default_ref
    if args.auth_method is not None:
        payload["auth_method"] = args.auth_method
    if args.credential_id is not None:
        payload["credential_id"] = args.credential_id
    response = post_json(args.base_url, "/v1/repos/add", payload)
    return print_response(response)


def command_reload_config(args: argparse.Namespace) -> int:
    response = post_json(args.base_url, "/v1/config/reload", {"request_id": request_id("reload_config")})
    return print_response(response)


def command_remove_repo(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/repos/remove",
        {"request_id": request_id("remove_repo"), "repo_id": args.repo_id},
    )
    return print_response(response)


def command_update_repo(args: argparse.Namespace) -> int:
    payload: dict[str, Any] = {"request_id": request_id("update_repo"), "repo_id": args.repo_id}
    if args.name is not None:
        payload["name"] = args.name
    if args.remote_url is not None:
        payload["remote_url"] = args.remote_url
    if args.default_ref is not None:
        payload["default_ref"] = args.default_ref
    if args.auth_method is not None:
        payload["auth_method"] = args.auth_method
    if args.credential_id is not None:
        payload["credential_id"] = args.credential_id
    response = post_json(args.base_url, "/v1/repos/update", payload)
    return print_response(response)


def command_list_repos(args: argparse.Namespace) -> int:
    response = post_json(args.base_url, "/v1/repos", {"request_id": request_id("repos")})
    return print_response(response)


def command_tools(args: argparse.Namespace) -> int:
    response = post_json(args.base_url, "/v1/tools", {"request_id": request_id("tools")})
    return print_response(response)


def command_sync(args: argparse.Namespace) -> int:
    response = post_json(args.base_url, "/v1/repos/sync", {"request_id": request_id("sync"), "repo_id": args.repo_id})
    return print_response(response)


def command_create_session(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/sessions",
        {"request_id": request_id("session"), "repo_id": args.repo_id, "ref_or_commit": args.ref},
    )
    return print_response(response)


def command_state(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/sessions/state",
        {"request_id": request_id("state"), "session_id": args.session_id},
    )
    return print_response(response)


def command_run_shell(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/shell/run",
        {
            "request_id": request_id("shell"),
            "session_id": args.session_id,
            "command": args.command,
            "cwd": args.cwd,
        },
    )
    return print_response(response)


def command_read_file(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/files/read",
        {
            "request_id": request_id("file"),
            "session_id": args.session_id,
            "path": args.path,
            "start_line": args.start_line,
            "max_lines": args.max_lines,
        },
    )
    return print_response(response)


def command_list_files(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/files/list",
        {
            "request_id": request_id("files_list"),
            "session_id": args.session_id,
            "path": args.path,
            "max_entries": args.max_entries,
        },
    )
    return print_response(response)


def command_find_files(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/find/files",
        {
            "request_id": request_id("find_files"),
            "session_id": args.session_id,
            "query": args.query,
            "max_results": args.max_results,
        },
    )
    return print_response(response)


def command_grep(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/find/text",
        {
            "request_id": request_id("grep"),
            "session_id": args.session_id,
            "pattern": args.pattern,
            "path": args.path,
            "max_results": args.max_results,
        },
    )
    return print_response(response)


def content_arg(value: str | None, file_path: str | None, label: str) -> str:
    if value is not None and file_path is not None:
        raise SystemExit(f"Use only one of --{label} or --{label}-file")
    if file_path is not None:
        return open(file_path, "r", encoding="utf-8").read()
    if value is not None:
        return value
    raise SystemExit(f"--{label} or --{label}-file is required")


def command_write_file(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/files/write",
        {
            "request_id": request_id("write"),
            "session_id": args.session_id,
            "path": args.path,
            "content": content_arg(args.content, args.content_file, "content"),
            "create_dirs": not args.no_create_dirs,
        },
    )
    return print_response(response)


def command_edit_file(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/files/edit",
        {
            "request_id": request_id("edit"),
            "session_id": args.session_id,
            "path": args.path,
            "old_text": args.old_text,
            "new_text": args.new_text,
            "replace_all": args.replace_all,
        },
    )
    return print_response(response)


def command_apply_patch(args: argparse.Namespace) -> int:
    response = post_json(
        args.base_url,
        "/v1/files/apply-patch",
        {
            "request_id": request_id("apply_patch"),
            "session_id": args.session_id,
            "patch": content_arg(args.patch, args.patch_file, "patch"),
        },
    )
    return print_response(response)


def graph_payload(args: argparse.Namespace, prefix: str) -> dict[str, Any]:
    payload: dict[str, Any] = {"request_id": request_id(prefix), "target_type": args.target_type}
    if args.target_type == "session_workspace":
        if not args.session_id:
            raise SystemExit("--session-id is required for session_workspace graph targets")
        payload["session_id"] = args.session_id
    else:
        if not args.repo_id:
            raise SystemExit("--repo-id is required for repo_head graph targets")
        payload["repo_id"] = args.repo_id
    return payload


def command_graph_analyze(args: argparse.Namespace) -> int:
    response = post_json(args.base_url, "/v1/graph/analyze", graph_payload(args, "graph_analyze"))
    return print_response(response)


def command_graph_status(args: argparse.Namespace) -> int:
    response = post_json(args.base_url, "/v1/graph/status", graph_payload(args, "graph_status"))
    return print_response(response)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Client for the V0 Remote Repo Session Service API.")
    add_common(parser)
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_repos = subparsers.add_parser("list-repos", help="List configured repositories.")
    list_repos.set_defaults(func=command_list_repos)

    add_repo = subparsers.add_parser("add-repo", help="Add a repository and queue an initial clone.")
    add_repo.add_argument("--repo-id", required=True)
    add_repo.add_argument("--name", required=True)
    add_repo.add_argument("--remote-url", required=True)
    add_repo.add_argument("--default-ref")
    add_repo.add_argument("--auth-method")
    add_repo.add_argument("--credential-id")
    add_repo.set_defaults(func=command_add_repo)

    reload_config = subparsers.add_parser("reload-config", help="Reload service configuration from disk.")
    reload_config.set_defaults(func=command_reload_config)

    remove_repo = subparsers.add_parser("remove-repo", help="Remove a configured repository.")
    remove_repo.add_argument("--repo-id", required=True)
    remove_repo.set_defaults(func=command_remove_repo)

    update_repo = subparsers.add_parser("update-repo", help="Update a configured repository.")
    update_repo.add_argument("--repo-id", required=True)
    update_repo.add_argument("--name")
    update_repo.add_argument("--remote-url")
    update_repo.add_argument("--default-ref")
    update_repo.add_argument("--auth-method")
    update_repo.add_argument("--credential-id")
    update_repo.set_defaults(func=command_update_repo)

    tools = subparsers.add_parser("tools", help="List supported OpenCode-style tool adapters.")
    tools.set_defaults(func=command_tools)

    sync = subparsers.add_parser("sync", help="Sync a repository mirror cache.")
    sync.add_argument("--repo-id", required=True)
    sync.set_defaults(func=command_sync)

    create_session = subparsers.add_parser("create-session", help="Create a commit-pinned session workspace.")
    create_session.add_argument("--repo-id", required=True)
    create_session.add_argument("--ref", required=True, help="Ref or commit to resolve before workspace creation.")
    create_session.set_defaults(func=command_create_session)

    state = subparsers.add_parser("state", help="Get current session state.")
    state.add_argument("--session-id", required=True)
    state.set_defaults(func=command_state)

    run_shell = subparsers.add_parser("run-shell", help="Run a bounded shell command in a session workspace.")
    run_shell.add_argument("--session-id", required=True)
    run_shell.add_argument("--command", required=True)
    run_shell.add_argument("--cwd", default=".")
    run_shell.set_defaults(func=command_run_shell)

    read_file = subparsers.add_parser("read-file", help="Read a bounded file slice from a session workspace.")
    read_file.add_argument("--session-id", required=True)
    read_file.add_argument("--path", required=True)
    read_file.add_argument("--start-line", type=int, default=1)
    read_file.add_argument("--max-lines", type=int, default=None)
    read_file.set_defaults(func=command_read_file)

    list_files = subparsers.add_parser("list-files", help="List files/directories under a workspace path.")
    list_files.add_argument("--session-id", required=True)
    list_files.add_argument("--path", default=".")
    list_files.add_argument("--max-entries", type=int, default=200)
    list_files.set_defaults(func=command_list_files)

    find_files = subparsers.add_parser("find-files", help="Find files by substring or glob.")
    find_files.add_argument("--session-id", required=True)
    find_files.add_argument("--query", required=True)
    find_files.add_argument("--max-results", type=int, default=100)
    find_files.set_defaults(func=command_find_files)

    grep = subparsers.add_parser("grep", help="Find text matches in workspace files.")
    grep.add_argument("--session-id", required=True)
    grep.add_argument("--pattern", required=True)
    grep.add_argument("--path", default=".")
    grep.add_argument("--max-results", type=int, default=100)
    grep.set_defaults(func=command_grep)

    write_file = subparsers.add_parser("write-file", help="Write a file in the session workspace.")
    write_file.add_argument("--session-id", required=True)
    write_file.add_argument("--path", required=True)
    write_file.add_argument("--content")
    write_file.add_argument("--content-file")
    write_file.add_argument("--no-create-dirs", action="store_true")
    write_file.set_defaults(func=command_write_file)

    edit_file = subparsers.add_parser("edit-file", help="Replace text in a workspace file.")
    edit_file.add_argument("--session-id", required=True)
    edit_file.add_argument("--path", required=True)
    edit_file.add_argument("--old-text", required=True)
    edit_file.add_argument("--new-text", required=True)
    edit_file.add_argument("--replace-all", action="store_true")
    edit_file.set_defaults(func=command_edit_file)

    apply_patch = subparsers.add_parser("apply-patch", help="Apply a unified git patch in the workspace.")
    apply_patch.add_argument("--session-id", required=True)
    apply_patch.add_argument("--patch")
    apply_patch.add_argument("--patch-file")
    apply_patch.set_defaults(func=command_apply_patch)

    for name, handler, help_text in [
        ("graph-analyze", command_graph_analyze, "Run GitNexus analysis for a graph target."),
        ("graph-status", command_graph_status, "Get GitNexus graph target status."),
    ]:
        graph = subparsers.add_parser(name, help=help_text)
        graph.add_argument("--target-type", choices=["repo_head", "session_workspace"], default="repo_head")
        graph.add_argument("--repo-id")
        graph.add_argument("--session-id")
        graph.set_defaults(func=handler)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
