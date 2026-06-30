import subprocess
from pathlib import Path

import pytest


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, check=True, text=True, capture_output=True)


@pytest.fixture
def local_remote_repo(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    run(["git", "init", "-b", "main"], source)
    run(["git", "config", "user.email", "test@example.com"], source)
    run(["git", "config", "user.name", "Test User"], source)
    (source / "README.md").write_text("# Demo\n", encoding="utf-8")
    run(["git", "add", "README.md"], source)
    run(["git", "commit", "-m", "initial"], source)

    remote = tmp_path / "remote.git"
    run(["git", "clone", "--bare", str(source), str(remote)], tmp_path)
    return remote
