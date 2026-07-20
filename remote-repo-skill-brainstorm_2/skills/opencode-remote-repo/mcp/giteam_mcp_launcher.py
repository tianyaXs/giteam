from __future__ import annotations

import json
import os
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_BASE_URL = "http://127.0.0.1:8765"
DB_ENV_VAR = "GITEAM_REMOTE_REPO_CLIENT_DB"
MCP_SERVER_ENV_VAR = "GITEAM_REMOTE_REPO_MCP_SERVER"


@dataclass(frozen=True)
class RemoteRepoServiceSetting:
    service_url: str
    api_key: str
    source: str
    db_path: str


def normalize_service_url(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    if value.startswith("/"):
        raise ValueError("giteam remote repo MCP requires an absolute http(s) service URL")

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("giteam remote repo service URL must be http(s)")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("giteam remote repo service URL must not include credentials, query, or fragment")
    return value.rstrip("/")


def candidate_db_paths(env: dict[str, str] | None = None) -> list[Path]:
    env = env or os.environ
    paths: list[Path] = []
    explicit = env.get(DB_ENV_VAR, "").strip()
    if explicit:
        paths.append(Path(explicit).expanduser())

    home = Path(env.get("HOME", str(Path.home()))).expanduser()
    if sys.platform == "darwin":
        app_support = home / "Library" / "Application Support"
        paths.extend(
            [
                app_support / "io.giteam.desktop" / ".giteam" / "client.db",
                app_support / "giteam" / ".giteam" / "client.db",
            ]
        )
    elif os.name == "nt":
        appdata = env.get("APPDATA", "").strip()
        if appdata:
            root = Path(appdata)
            paths.extend(
                [
                    root / "io.giteam.desktop" / ".giteam" / "client.db",
                    root / "giteam" / ".giteam" / "client.db",
                ]
            )
    else:
        data_home = Path(env.get("XDG_DATA_HOME", home / ".local" / "share")).expanduser()
        paths.extend(
            [
                data_home / "io.giteam.desktop" / ".giteam" / "client.db",
                data_home / "giteam" / ".giteam" / "client.db",
            ]
        )

    deduped: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path)
        if key not in seen:
            deduped.append(path)
            seen.add(key)
    return deduped


def read_setting_from_db(db_path: Path) -> RemoteRepoServiceSetting | None:
    if not db_path.is_file():
        return None
    uri = f"file:{db_path}?mode=ro"
    try:
        with sqlite3.connect(uri, uri=True, timeout=2) as conn:
            row = conn.execute(
                "SELECT service_url, api_key FROM remote_repo_service_settings WHERE id = 1 LIMIT 1"
            ).fetchone()
    except sqlite3.Error:
        return None
    if row is None:
        return None
    service_url = str(row[0] or "").strip()
    api_key = str(row[1] or "").strip()
    if not service_url and not api_key:
        return None
    return RemoteRepoServiceSetting(
        service_url=service_url,
        api_key=api_key,
        source="giteam-desktop-db",
        db_path=str(db_path),
    )


def env_api_key(env: dict[str, str]) -> str:
    for name in ("REMOTE_REPO_API_KEY", "REMOTE_REPO_SERVICE_API_KEY"):
        value = env.get(name, "").strip()
        if value:
            return value
    return ""


def resolve_setting(
    env: dict[str, str] | None = None,
    db_paths: list[Path] | None = None,
) -> RemoteRepoServiceSetting:
    env = env or os.environ
    for db_path in db_paths if db_paths is not None else candidate_db_paths(env):
        setting = read_setting_from_db(db_path)
        if setting is None:
            continue
        service_url = normalize_service_url(setting.service_url) if setting.service_url else ""
        if not service_url:
            service_url = normalize_service_url(env.get("REMOTE_REPO_SERVICE_URL", "") or DEFAULT_BASE_URL)
        api_key = setting.api_key or env_api_key(env)
        return RemoteRepoServiceSetting(
            service_url=service_url,
            api_key=api_key,
            source=setting.source,
            db_path=setting.db_path,
        )

    service_url = normalize_service_url(env.get("REMOTE_REPO_SERVICE_URL", "") or DEFAULT_BASE_URL)
    return RemoteRepoServiceSetting(
        service_url=service_url,
        api_key=env_api_key(env),
        source="environment" if env.get("REMOTE_REPO_SERVICE_URL", "").strip() else "default",
        db_path="",
    )


def mcp_server_path(env: dict[str, str] | None = None) -> Path:
    env = env or os.environ
    explicit = env.get(MCP_SERVER_ENV_VAR, "").strip()
    if explicit:
        return Path(explicit).expanduser()
    return Path(__file__).resolve().with_name("mcp_server.py")


def masked_api_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    setting = resolve_setting()
    server_path = mcp_server_path()

    if "--print-resolved" in argv:
        print(
            json.dumps(
                {
                    "service_url": setting.service_url,
                    "api_key": masked_api_key(setting.api_key),
                    "source": setting.source,
                    "db_path": setting.db_path,
                    "mcp_server": str(server_path),
                },
                indent=2,
            )
        )
        return 0

    if not server_path.is_file():
        raise SystemExit(f"remote repo MCP server not found: {server_path}")

    child_env = os.environ.copy()
    if setting.api_key:
        child_env["REMOTE_REPO_SERVICE_API_KEY"] = setting.api_key
    args = [sys.executable, str(server_path), "--base-url", setting.service_url, *argv]
    os.execve(sys.executable, args, child_env)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
