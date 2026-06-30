import json
from pathlib import Path

import pytest

from remote_repo_service.config import RepoConfig, Settings


def test_settings_create_storage_directories(tmp_path: Path) -> None:
    settings = Settings(
        storage_root=tmp_path / "storage",
        command_timeout_seconds=3,
        max_stdout_bytes=100,
        max_stderr_bytes=100,
        max_diff_bytes=100,
        max_file_slice_bytes=100,
        max_file_slice_lines=10,
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo",
                remote_url=str(tmp_path / "remote.git"),
                default_ref="main",
            )
        },
    )

    settings.ensure_directories()

    assert settings.repo_cache_root.exists()
    assert settings.workspace_root.exists()
    assert settings.graph_worktree_root.exists()


def test_settings_allow_a_configured_giteam_web_origin_for_service_url_settings() -> None:
    settings = Settings(cors_allowed_origins=["https://app.giteam.example"])

    assert settings.cors_allowed_origins == ["https://app.giteam.example"]


def test_settings_merge_api_keys_from_config_and_environment(monkeypatch) -> None:
    monkeypatch.setenv("REMOTE_REPO_SERVICE_API_KEYS", " env-a,env-b ")
    settings = Settings(api_keys=["config-a", " "])

    assert settings.effective_api_keys() == ["config-a", "env-a", "env-b"]


def test_settings_load_from_env_config_file(tmp_path: Path, monkeypatch) -> None:
    config_path = tmp_path / "service.json"
    storage_root = tmp_path / "storage"
    remote_url = tmp_path / "remote.git"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(storage_root),
                "command_timeout_seconds": 7,
                "repos": {
                    "demo": {
                        "repo_id": "demo",
                        "name": "Demo Repo",
                        "remote_url": str(remote_url),
                        "default_ref": "main",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("REMOTE_REPO_SERVICE_CONFIG", str(config_path))

    settings = Settings.from_env()

def test_settings_save_is_atomic_and_re_loadable(tmp_path: Path) -> None:
    config_path = tmp_path / "service.json"
    settings = Settings(
        storage_root=tmp_path / "storage",
        repos={
            "demo": RepoConfig(
                repo_id="demo",
                name="Demo Repo",
                remote_url=str(tmp_path / "remote.git"),
                default_ref="main",
                auth_method="ssh_key",
                credential_id="default",
            )
        },
    )

    settings.save_to(config_path)

    assert config_path.exists()
    loaded = Settings.from_file(config_path)
    assert loaded.repos["demo"].auth_method == "ssh_key"
    assert loaded.repos["demo"].credential_id == "default"


@pytest.mark.parametrize(
    "remote_url",
    [
        "/opt/repos/demo.git",
        "file:///opt/repos/demo.git",
        "git@github.com:acme/demo.git",
        "ssh://git@github.com/acme/demo.git",
        "https://github.com/acme/demo.git",
    ],
)
def test_repo_config_accepts_supported_remote_url_forms(remote_url: str) -> None:
    repo = RepoConfig(repo_id="demo", name="Demo", remote_url=remote_url)

    assert repo.remote_url == remote_url


@pytest.mark.parametrize("remote_url", ["", "  ", "undefined", "null", "./relative/repo.git"])
def test_repo_config_rejects_placeholder_or_relative_remote_url(remote_url: str) -> None:
    with pytest.raises(ValueError, match="remote_url"):
        RepoConfig(repo_id="demo", name="Demo", remote_url=remote_url)
