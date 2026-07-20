import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from filelock import FileLock
from pydantic import BaseModel, Field, PrivateAttr, field_validator


class RepoConfig(BaseModel):
    repo_id: str
    name: str
    remote_url: str
    default_ref: str = "main"
    auth_method: str | None = None
    credential_id: str | None = None

    @field_validator("remote_url")
    @classmethod
    def validate_remote_url(cls, value: str) -> str:
        """Allow cloneable local/SSH/HTTPS sources, never placeholder values."""
        remote_url = value.strip()
        if not remote_url or remote_url.casefold() in {"undefined", "null"}:
            raise ValueError("remote_url must be a local absolute path, file:// URL, SSH URL, or HTTPS URL")

        if Path(remote_url).is_absolute():
            return remote_url

        parsed = urlparse(remote_url)
        if parsed.scheme == "file":
            if parsed.netloc not in {"", "localhost"} or not Path(unquote(parsed.path)).is_absolute():
                raise ValueError("remote_url file:// URLs must use an absolute local path")
            return remote_url

        if parsed.scheme in {"http", "https", "ssh"} and parsed.hostname:
            return remote_url

        # SCP-style SSH clone URLs: git@github.com:owner/repo.git.
        if re.fullmatch(r"[^@\s/:]+@[^@\s/:]+:[^\s:]+", remote_url):
            return remote_url

        raise ValueError("remote_url must be a local absolute path, file:// URL, SSH URL, or HTTPS URL")


class Settings(BaseModel):
    storage_root: Path = Field(default=Path(".remote-repo-service"))
    api_keys: list[str] = Field(default_factory=list)
    command_timeout_seconds: int = 30
    max_stdout_bytes: int = 64_000
    max_stderr_bytes: int = 64_000
    max_diff_bytes: int = 64_000
    max_file_slice_bytes: int = 24_000
    max_file_slice_lines: int = 120
    gitnexus_analyze_command: list[str] = Field(default_factory=lambda: ["npx", "gitnexus", "analyze", "--index-only"])
    cors_allowed_origins: list[str] = Field(default_factory=lambda: [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ])
    repos: dict[str, RepoConfig] = Field(default_factory=dict)
    _source_path: Path | None = PrivateAttr(default=None)

    @classmethod
    def from_env(cls) -> "Settings":
        config_path = resolve_config_path()
        if config_path is None:
            return cls()
        return cls.from_file(Path(config_path))

    @classmethod
    def from_file(cls, config_path: Path) -> "Settings":
        data = json.loads(config_path.read_text(encoding="utf-8"))
        instance = cls.model_validate(data)
        instance._source_path = config_path
        return instance

    def save_to(self, config_path: Path, lock_timeout: float = 5.0) -> None:
        config_path = config_path.resolve()
        lock_path = config_path.with_suffix(config_path.suffix + ".lock")
        lock = FileLock(str(lock_path), timeout=lock_timeout)
        with lock:
            data = self.model_dump(mode="json")
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=str(config_path.parent),
                prefix=config_path.name + ".tmp",
                delete=False,
            ) as handle:
                json.dump(data, handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(handle.name, config_path)

    def add_repo(self, repo: RepoConfig) -> None:
        if repo.repo_id in self.repos:
            raise ValueError(f"repo_id already exists: {repo.repo_id}")
        self.repos[repo.repo_id] = repo

    def remove_repo(self, repo_id: str) -> RepoConfig:
        if repo_id not in self.repos:
            raise ValueError(f"repo_id not found: {repo_id}")
        return self.repos.pop(repo_id)

    def update_repo(self, repo_id: str, **updates: Any) -> RepoConfig:
        if repo_id not in self.repos:
            raise ValueError(f"repo_id not found: {repo_id}")
        existing = self.repos[repo_id]
        new_data = existing.model_dump()
        for key, value in updates.items():
            if value is None:
                continue
            if key not in new_data:
                raise ValueError(f"invalid repo field: {key}")
            new_data[key] = value
        new_repo = RepoConfig.model_validate(new_data)
        self.repos[repo_id] = new_repo
        return new_repo

    @property
    def repo_cache_root(self) -> Path:
        return self.storage_root / "repos"

    @property
    def workspace_root(self) -> Path:
        return self.storage_root / "workspaces"

    @property
    def graph_worktree_root(self) -> Path:
        return self.storage_root / "graph-worktrees"

    def ensure_directories(self) -> None:
        self.repo_cache_root.mkdir(parents=True, exist_ok=True)
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.graph_worktree_root.mkdir(parents=True, exist_ok=True)

    def effective_api_keys(self) -> list[str]:
        keys = [key.strip() for key in self.api_keys if key.strip()]
        env_values = [
            os.environ.get("REMOTE_REPO_SERVICE_API_KEY", ""),
            os.environ.get("REMOTE_REPO_SERVICE_API_KEYS", ""),
        ]
        for raw in env_values:
            keys.extend(part.strip() for part in raw.split(",") if part.strip())
        deduped: list[str] = []
        for key in keys:
            if key not in deduped:
                deduped.append(key)
        return deduped


def resolve_config_path(
    explicit: str | None = None,
    env_var: str = "REMOTE_REPO_SERVICE_CONFIG",
    default: str = "service.json",
) -> str | None:
    if explicit:
        return str(Path(explicit).resolve())
    env_path = os.environ.get(env_var)
    if env_path:
        return str(Path(env_path).resolve())
    default_path = Path(default).resolve()
    if default_path.exists():
        return str(default_path)
    return None
