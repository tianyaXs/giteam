#!/usr/bin/env bash
# One-click apply Giteam Cloud to the current kubectl context.
# Reads private registry + PUBLIC_BASE_URL + secrets from deploy/local.env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_ENV="${LOCAL_ENV:-$ROOT/services/cloud/deploy/local.env}"

if [[ ! -f "$LOCAL_ENV" ]]; then
  echo "Missing $LOCAL_ENV" >&2
  echo "cp services/cloud/deploy/local.env.example services/cloud/deploy/local.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$LOCAL_ENV"
set +a

REGISTRY="${REGISTRY:?REGISTRY required in local.env}"
NAMESPACE="${NAMESPACE:?NAMESPACE required in local.env}"
IMAGE_NAME="${IMAGE_NAME:-giteam-cloud}"
TAG="${TAG:-latest}"
IMAGE="${IMAGE:-${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:${TAG}}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:?PUBLIC_BASE_URL required in local.env}"
JWT_SECRET="${JWT_SECRET:?JWT_SECRET required in local.env}"
ADMIN_TOKEN="${ADMIN_TOKEN:?ADMIN_TOKEN required in local.env}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL required in local.env}"
KUBE_NAMESPACE="${KUBE_NAMESPACE:-default}"
PULL_SECRET_NAME="${PULL_SECRET_NAME:-}"

NS_ARGS=()
if [[ -n "$KUBE_NAMESPACE" ]]; then
  NS_ARGS=(-n "$KUBE_NAMESPACE")
fi

echo "==> image: ${IMAGE}"
echo "==> PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}"

kubectl "${NS_ARGS[@]}" apply -f "${DIR}/configmap.yaml"
kubectl "${NS_ARGS[@]}" create secret generic giteam-cloud-secret \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=ADMIN_TOKEN="${ADMIN_TOKEN}" \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --dry-run=client -o yaml | kubectl "${NS_ARGS[@]}" apply -f -

kubectl "${NS_ARGS[@]}" apply -f "${DIR}/deployment.yaml"

if [[ -n "$PULL_SECRET_NAME" ]]; then
  kubectl "${NS_ARGS[@]}" patch deployment giteam-cloud --type strategic -p \
    "{\"spec\":{\"template\":{\"spec\":{\"imagePullSecrets\":[{\"name\":\"${PULL_SECRET_NAME}\"}]}}}}"
fi

kubectl "${NS_ARGS[@]}" patch configmap giteam-cloud-config --type merge -p \
  "{\"data\":{\"PUBLIC_BASE_URL\":\"${PUBLIC_BASE_URL}\"}}"

kubectl "${NS_ARGS[@]}" set image deployment/giteam-cloud "giteam-cloud=${IMAGE}"
kubectl "${NS_ARGS[@]}" rollout status deployment/giteam-cloud --timeout=180s

if [[ "${APPLY_INGRESS:-0}" == "1" ]]; then
  kubectl "${NS_ARGS[@]}" apply -f "${DIR}/ingress.yaml"
fi

kubectl "${NS_ARGS[@]}" get deploy,svc,pods -l app=giteam-cloud
echo "OK deployed ${IMAGE}"
