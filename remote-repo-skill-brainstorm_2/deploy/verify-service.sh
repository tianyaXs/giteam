#!/bin/sh
set -eu

BASE_URL="${1:-}"
API_KEY="${2:-${REMOTE_REPO_SERVICE_API_KEY:-}}"
if [ -z "$BASE_URL" ]; then
  echo "Usage: sh deploy/verify-service.sh http://SERVER-LAN-IP:8765 [api-key]" >&2
  exit 64
fi

BASE_URL="${BASE_URL%/}"
echo "Checking ${BASE_URL}/v1/dashboard"
if [ -n "$API_KEY" ]; then
  curl --fail --silent --show-error --max-time 8 -H "X-API-Key: ${API_KEY}" "${BASE_URL}/v1/dashboard"
else
  curl --fail --silent --show-error --max-time 8 "${BASE_URL}/v1/dashboard"
fi
echo
echo "Remote Repo Service is reachable. Configure this URL in Giteam → 设置 → 远程仓库."
