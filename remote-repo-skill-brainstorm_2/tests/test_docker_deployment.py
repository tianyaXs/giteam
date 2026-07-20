from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_docker_image_contains_the_runtime_needed_for_git_and_gitnexus() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "python:3.12-slim" in dockerfile
    assert "git" in dockerfile
    assert "node:22-bookworm-slim" in dockerfile
    assert "remote-repo-service" in dockerfile


def test_docker_image_uses_a_gitnexus_compatible_node_runtime() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    # GitNexus 1.6+ requires Node 22. Debian bookworm's apt package is Node
    # 18, which installs successfully but fails when GitNexus is invoked.
    assert "FROM node:22-bookworm-slim AS node-runtime" in dockerfile
    assert "COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node" in dockerfile
    assert "COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules" in dockerfile
    # npm/npx are symlinks in the Node image. Recreate them rather than COPY
    # their link targets into /usr/local/bin, which breaks npx's relative
    # require of ../lib/cli.js.
    assert "ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm" in dockerfile
    assert "ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx" in dockerfile


def test_docker_image_preinstalls_gitnexus_instead_of_downloading_it_while_analyzing() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    # Runtime npx downloads mutate the persistent cache and race with another
    # analysis. Install one pinned GitNexus CLI in the immutable image layer.
    assert "ARG GITNEXUS_VERSION=1.6.8" in dockerfile
    assert 'npm install --global --omit=dev "gitnexus@${GITNEXUS_VERSION}"' in dockerfile


def test_docker_image_installs_native_build_tools_before_gitnexus() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    # GitNexus depends on tree-sitter native modules. Their install scripts
    # compile during npm install and require make/g++, supplied by
    # build-essential in Debian-based images.
    assert "build-essential" in dockerfile
    assert dockerfile.index("build-essential") < dockerfile.index("npm install --global")


def test_docker_image_contains_ssh_client_for_ssh_git_remotes() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    # Git invokes the ssh executable for git@github.com:owner/repo.git URLs.
    # Without openssh-client, sync fails before authentication with
    # "cannot run ssh: No such file or directory".
    assert "openssh-client" in dockerfile


def test_docker_image_trusts_persistent_git_cache_ownership() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "git config --system --add safe.directory '*'" in dockerfile


def test_compose_persists_both_service_config_and_workspace_state() -> None:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "REMOTE_REPO_SERVICE_CONFIG: /etc/giteam/remote-repo-service.json" in compose
    assert "REMOTE_REPO_SERVICE_API_KEY: ${REMOTE_REPO_SERVICE_API_KEY:?" in compose
    assert "${REMOTE_REPO_CONFIG_DIR:-./deploy/config}:/etc/giteam" in compose
    assert "${REMOTE_REPO_DATA_DIR:-./deploy/data}:/var/lib/giteam/remote-repo-service" in compose
    assert "${REMOTE_REPO_BIND_ADDRESS:-127.0.0.1}:8765:8765" in compose
    assert 'user: "${REMOTE_REPO_SERVICE_USER:-10001:10001}"' in compose
    assert "/v1/health" in compose
    assert "init-permissions:" in compose
    assert "condition: service_completed_successfully" in compose


def test_container_config_uses_an_internal_persistent_storage_root() -> None:
    config = (ROOT / "deploy" / "config" / "remote-repo-service.json").read_text(encoding="utf-8")

    assert '"storage_root": "/var/lib/giteam/remote-repo-service"' in config
    assert '"api_keys": []' in config
    assert '"repos": {}' in config
    assert '"cors_allowed_origins"' in config
    assert '"gitnexus_analyze_command": [\n    "gitnexus",\n    "analyze",\n    "--index-only"\n  ]' in config
