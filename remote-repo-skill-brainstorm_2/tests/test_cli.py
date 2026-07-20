import json
from pathlib import Path

from remote_repo_service.cli import post_json, resolve_config_path
from remote_repo_service.config import RepoConfig, Settings


def test_cli_repo_add_writes_config(tmp_path: Path) -> None:
    config_path = tmp_path / "service.json"
    config_path.write_text(
        json.dumps(
            {
                "storage_root": str(tmp_path / "storage"),
                "repos": {},
            }
        ),
        encoding="utf-8",
    )

    from remote_repo_service.cli import add_repo

    add_repo(
        config_path=str(config_path),
        repo_id="demo",
        name="Demo",
        remote_url=str(tmp_path / "remote.git"),
        default_ref="main",
        auth_method=None,
        credential_id=None,
        notify_base_url=None,
    )

    loaded = Settings.from_file(config_path)
    assert loaded.repos["demo"].repo_id == "demo"


def test_cli_config_path_resolution_explicit_over_env(tmp_path: Path, monkeypatch) -> None:
    explicit = tmp_path / "explicit.json"
    env = tmp_path / "env.json"
    explicit.write_text("{}", encoding="utf-8")
    env.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("REMOTE_REPO_SERVICE_CONFIG", str(env))

    assert resolve_config_path(explicit=str(explicit)) == str(explicit.resolve())


def test_cli_post_json_sends_env_api_key(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self) -> bytes:
            return b'{"ok": true}'

    def fake_urlopen(request, timeout):
        captured["headers"] = dict(request.header_items())
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setenv("REMOTE_REPO_SERVICE_API_KEY", "server-secret")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    response = post_json("http://remote.example", "/v1/repos/sync", {"request_id": "test"})

    assert response["ok"] is True
    assert captured["headers"]["X-api-key"] == "server-secret"
    assert captured["timeout"] == 30
