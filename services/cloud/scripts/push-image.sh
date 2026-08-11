#!/usr/bin/env bash
# Build & push Giteam Cloud image.
#
# Requires private ops file (gitignored):
#   cp services/cloud/deploy/local.env.example services/cloud/deploy/local.env
#
# Usage:
#   ./services/cloud/scripts/push-image.sh           # tag = git short sha
#   ./services/cloud/scripts/push-image.sh 0.1.0
#   PUSH=0 ./services/cloud/scripts/push-image.sh    # build only (no registry needed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

LOCAL_ENV="${LOCAL_ENV:-$ROOT/services/cloud/deploy/local.env}"
if [[ -f "$LOCAL_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$LOCAL_ENV"
  set +a
else
  echo "Missing $LOCAL_ENV" >&2
  echo "Copy services/cloud/deploy/local.env.example → local.env and fill registry/public URL." >&2
  if [[ "${PUSH:-1}" == "1" ]]; then
    exit 1
  fi
fi

REGISTRY="${REGISTRY:-}"
NAMESPACE="${NAMESPACE:-}"
IMAGE_NAME="${IMAGE_NAME:-giteam-cloud}"
TAG="${1:-${TAG:-}}"
if [[ -z "$TAG" ]]; then
  TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
fi
PUSH="${PUSH:-1}"
PLATFORM="${PLATFORM:-linux/amd64}"

if [[ "$PUSH" == "1" ]]; then
  if [[ -z "$REGISTRY" || -z "$NAMESPACE" ]]; then
    echo "REGISTRY and NAMESPACE must be set in $LOCAL_ENV for push." >&2
    exit 1
  fi
fi

FULL_IMAGE="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:${TAG}"
LATEST_IMAGE="${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:latest"

echo "==> image: ${FULL_IMAGE}"
echo "==> platform: ${PLATFORM}"
echo "==> PUBLIC_BASE_URL (ops): ${PUBLIC_BASE_URL:-<unset>}"

if ! docker info >/dev/null 2>&1; then
  echo "docker is not available" >&2
  exit 1
fi

if [[ "$PUSH" == "1" ]]; then
  if ! grep -q "${REGISTRY}" ~/.docker/config.json 2>/dev/null; then
    echo "Not logged in to ${REGISTRY}. Run: docker login ${REGISTRY}" >&2
    exit 1
  fi
  docker buildx build \
    --platform "${PLATFORM}" \
    -f services/cloud/Dockerfile \
    -t "${FULL_IMAGE}" \
    -t "${LATEST_IMAGE}" \
    --push \
    .
  echo "==> pushed ${FULL_IMAGE}"
  echo "==> pushed ${LATEST_IMAGE}"
else
  LOCAL_TAG="${IMAGE_NAME}:${TAG}"
  docker buildx build \
    --platform "${PLATFORM}" \
    -f services/cloud/Dockerfile \
    -t "${LOCAL_TAG}" \
    --load \
    .
  echo "==> build only → ${LOCAL_TAG}"
  FULL_IMAGE="$LOCAL_TAG"
fi

echo "${FULL_IMAGE}" > /tmp/giteam-cloud-image.txt
echo "OK ${FULL_IMAGE}"
