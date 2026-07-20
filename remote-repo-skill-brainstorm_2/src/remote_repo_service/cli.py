import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from remote_repo_service.config import RepoConfig, Settings, resolve_config_path


DEFAULT_BASE_URL = "http://127.0.0.1:8765"


def request_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}"


def post_json(base_url: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}{path}"
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    api_key = os.environ.get("REMOTE_REPO_SERVICE_API_KEY", "").strip()
    if api_key:
        headers["X-API-Key"] = api_key
    request = urllib.request.Request(
        url,
        data=body,
        headers=headers,
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


def cmd_start(args: argparse.Namespace) -> int:
    import uvicorn

    config_path = resolve_config_path(args.config)
    if config_path:
        import os

        os.environ["REMOTE_REPO_SERVICE_CONFIG"] = config_path
    host = args.host
    port = args.port
    uvicorn.run(
        "remote_repo_service.app:create_app",
        factory=True,
        host=host,
        port=port,
    )
    return 0


def add_repo(
    config_path: str,
    repo_id: str,
    name: str,
    remote_url: str,
    default_ref: str = "main",
    auth_method: str | None = None,
    credential_id: str | None = None,
    notify_base_url: str | None = None,
) -> int:
    config_path_obj = Path(config_path)
    try:
        settings = Settings.from_file(config_path_obj) if config_path_obj.exists() else Settings()
    except Exception as exc:
        raise SystemExit(f"Failed to load config: {exc}") from exc

    repo = RepoConfig(
        repo_id=repo_id,
        name=name or repo_id,
        remote_url=remote_url,
        default_ref=default_ref,
        auth_method=auth_method,
        credential_id=credential_id,
    )
    try:
        settings.add_repo(repo)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    try:
        settings.save_to(config_path_obj)
    except TimeoutError:
        raise SystemExit("Config file is locked by running service, please retry.")
    except Exception as exc:
        raise SystemExit(f"Failed to save config: {exc}") from exc

    if notify_base_url:
        try:
            post_json(notify_base_url, "/v1/config/reload", {"request_id": request_id("reload")})
        except SystemExit:
            print(f"Warning: could not notify service at {notify_base_url}", file=sys.stderr)

    print(json.dumps({"ok": True, "repo_id": repo.repo_id}, indent=2))
    return 0


def cmd_repo_add(args: argparse.Namespace) -> int:
    config_path_value = resolve_config_path(args.config)
    if config_path_value is None:
        raise SystemExit("Could not resolve config path. Use --config or create ./service.json")
    return add_repo(
        config_path=config_path_value,
        repo_id=args.repo_id,
        name=args.name,
        remote_url=args.remote_url,
        default_ref=args.default_ref,
        auth_method=args.auth_method,
        credential_id=args.credential_id,
        notify_base_url=args.notify_base_url,
    )


def cmd_repo_list(args: argparse.Namespace) -> int:
    config_path_value = resolve_config_path(args.config)
    if config_path_value is None:
        raise SystemExit("Could not resolve config path. Use --config or create ./service.json")
    config_path = Path(config_path_value)
    settings = Settings.from_file(config_path) if config_path.exists() else Settings()
    repos = [
        {
            "repo_id": repo.repo_id,
            "name": repo.name,
            "remote_url": repo.remote_url,
            "default_ref": repo.default_ref,
            "auth_method": repo.auth_method,
            "credential_id": repo.credential_id,
        }
        for repo in settings.repos.values()
    ]
    print(json.dumps({"repos": repos}, indent=2))
    return 0


def cmd_repo_sync(args: argparse.Namespace) -> int:
    base_url = args.base_url or os.environ.get("REMOTE_REPO_SERVICE_URL", DEFAULT_BASE_URL)
    response = post_json(base_url, "/v1/repos/sync", {"request_id": request_id("sync"), "repo_id": args.repo_id})
    print(json.dumps(response, indent=2))
    return 0 if response.get("ok") is True else 2


def cmd_repo_remove(args: argparse.Namespace) -> int:
    base_url = args.base_url or os.environ.get("REMOTE_REPO_SERVICE_URL", DEFAULT_BASE_URL)
    response = post_json(base_url, "/v1/repos/remove", {"request_id": request_id("remove"), "repo_id": args.repo_id})
    print(json.dumps(response, indent=2))
    return 0 if response.get("ok") is True else 2


def cmd_repo_update(args: argparse.Namespace) -> int:
    base_url = args.base_url or os.environ.get("REMOTE_REPO_SERVICE_URL", DEFAULT_BASE_URL)
    payload: dict[str, Any] = {"request_id": request_id("update"), "repo_id": args.repo_id}
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
    response = post_json(base_url, "/v1/repos/update", payload)
    print(json.dumps(response, indent=2))
    return 0 if response.get("ok") is True else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="remote-repo-service", description="Remote Repo Service CLI")
    parser.add_argument("--config", help="Path to service.json (overrides env and default)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start", help="Start the HTTP service")
    start.add_argument("--host", default="127.0.0.1")
    start.add_argument("--port", type=int, default=8765)
    start.set_defaults(func=cmd_start)

    repo = subparsers.add_parser("repo", help="Manage configured repositories")
    repo_subparsers = repo.add_subparsers(dest="repo_command", required=True)

    repo_add = repo_subparsers.add_parser("add", help="Add a repository")
    repo_add.add_argument("repo_id")
    repo_add.add_argument("remote_url")
    repo_add.add_argument("--name")
    repo_add.add_argument("--default-ref", default="main")
    repo_add.add_argument("--auth-method")
    repo_add.add_argument("--credential-id")
    repo_add.add_argument("--notify-base-url", default=DEFAULT_BASE_URL, help="Base URL of running service to notify for reload")
    repo_add.set_defaults(func=cmd_repo_add)

    repo_list = repo_subparsers.add_parser("list", help="List configured repositories")
    repo_list.add_argument("--config", help="Path to service.json (overrides env and default)")
    repo_list.set_defaults(func=cmd_repo_list)

    repo_sync = repo_subparsers.add_parser("sync", help="Trigger repository sync")
    repo_sync.add_argument("repo_id")
    repo_sync.add_argument("--base-url")
    repo_sync.set_defaults(func=cmd_repo_sync)

    repo_remove = repo_subparsers.add_parser("remove", help="Remove a configured repository")
    repo_remove.add_argument("repo_id")
    repo_remove.add_argument("--base-url")
    repo_remove.set_defaults(func=cmd_repo_remove)

    repo_update = repo_subparsers.add_parser("update", help="Update a configured repository")
    repo_update.add_argument("repo_id")
    repo_update.add_argument("--name")
    repo_update.add_argument("--remote-url")
    repo_update.add_argument("--default-ref")
    repo_update.add_argument("--auth-method")
    repo_update.add_argument("--credential-id")
    repo_update.add_argument("--base-url")
    repo_update.set_defaults(func=cmd_repo_update)

    return parser


def main(args: list[str] | None = None) -> int:
    parser = build_parser()
    parsed = parser.parse_args(args)
    return parsed.func(parsed)


if __name__ == "__main__":
    sys.exit(main())
