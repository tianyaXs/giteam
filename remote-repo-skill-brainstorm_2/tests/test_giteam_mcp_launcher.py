from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from remote_repo_service.giteam_mcp_launcher import (
    DB_ENV_VAR,
    DEFAULT_BASE_URL,
    candidate_db_paths,
    normalize_service_url,
    resolve_setting,
)


def create_giteam_db(path: Path, service_url: str, api_key: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE remote_repo_service_settings ("
            "id INTEGER PRIMARY KEY CHECK (id = 1), "
            "service_url TEXT NOT NULL DEFAULT '', "
            "api_key TEXT NOT NULL DEFAULT '', "
            "updated_at_ms INTEGER NOT NULL"
            ")"
        )
        conn.execute(
            "INSERT INTO remote_repo_service_settings (id, service_url, api_key, updated_at_ms) "
            "VALUES (1, ?1, ?2, 123)",
            (service_url, api_key),
        )


def test_resolve_setting_reads_giteam_desktop_database(tmp_path: Path) -> None:
    db_path = tmp_path / "client.db"
    create_giteam_db(db_path, "http://127.0.0.1:9876/", "secret")

    setting = resolve_setting(env={"HOME": str(tmp_path)}, db_paths=[db_path])

    assert setting.service_url == "http://127.0.0.1:9876"
    assert setting.api_key == "secret"
    assert setting.source == "giteam-desktop-db"
    assert setting.db_path == str(db_path)


def test_resolve_setting_uses_environment_when_database_is_missing(tmp_path: Path) -> None:
    setting = resolve_setting(
        env={
            "HOME": str(tmp_path),
            "REMOTE_REPO_SERVICE_URL": "https://giteam.example.com/remote/",
            "REMOTE_REPO_SERVICE_API_KEY": "env-secret",
        },
        db_paths=[tmp_path / "missing.db"],
    )

    assert setting.service_url == "https://giteam.example.com/remote"
    assert setting.api_key == "env-secret"
    assert setting.source == "environment"


def test_resolve_setting_uses_default_service_url_without_configuration(tmp_path: Path) -> None:
    setting = resolve_setting(env={"HOME": str(tmp_path)}, db_paths=[tmp_path / "missing.db"])

    assert setting.service_url == DEFAULT_BASE_URL
    assert setting.api_key == ""
    assert setting.source == "default"


def test_explicit_database_path_is_first_candidate(tmp_path: Path) -> None:
    explicit = tmp_path / "custom.db"

    assert candidate_db_paths({DB_ENV_VAR: str(explicit), "HOME": str(tmp_path)})[0] == explicit


@pytest.mark.parametrize(
    "value",
    [
        "/same-origin",
        "ssh://git@example.com/repo.git",
        "https://user@example.com/repo",
        "https://example.com/repo?token=secret",
    ],
)
def test_normalize_service_url_rejects_values_that_are_not_absolute_http_service_urls(value: str) -> None:
    with pytest.raises(ValueError):
        normalize_service_url(value)
