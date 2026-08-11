#!/usr/bin/env bash
# 仅针对「对方机器」控制面做模型列表诊断（不要拿本机 127.0.0.1 测）
#
# 默认就是你发来的接入信息：
#   pair_code : 299000
#   local_urls: http://192.168.50.242:4100
#
# 用法：
#   ./scripts/diagnose-mobile-models.sh
#   ./scripts/diagnose-mobile-models.sh http://192.168.50.242:4100 299000

set -u

BASE_URL="${1:-http://192.168.50.242:4100}"
PAIR_CODE="${2:-299000}"
BASE_URL="${BASE_URL%/}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
hdr() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

if [[ "$BASE_URL" == *"127.0.0.1"* || "$BASE_URL" == *"localhost"* ]]; then
  red "拒绝：本脚本只测对方机器地址，不要用 127.0.0.1/localhost"
  exit 1
fi

hdr "Target"
echo "BASE_URL  = $BASE_URL"
echo "PAIR_CODE = $PAIR_CODE"

hdr "1) Health"
HEALTH="$(curl -sS -m 10 "$BASE_URL/api/v1/health" 2>&1)" || true
if [[ -z "$HEALTH" || "$HEALTH" == *"Failed"* || "$HEALTH" == *"Connection"* ]]; then
  red "连不上 $BASE_URL"
  echo "$HEALTH"
  exit 1
fi
echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"

hdr "2) Pair ($PAIR_CODE)"
PAIR_RESP="$(curl -sS -m 10 -X POST "$BASE_URL/api/v1/auth/pair" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$PAIR_CODE\"}" 2>&1)" || true
echo "$PAIR_RESP" | python3 -m json.tool 2>/dev/null || echo "$PAIR_RESP"
TOKEN="$(python3 -c "import json,sys
try:
 d=json.loads(sys.argv[1]); print(d.get('token') or '')
except Exception:
 print('')" "$PAIR_RESP")"
if [[ -z "$TOKEN" ]]; then
  red "配对失败：没有 token。配对码是否已过期？在对方机器执行: giteam pair-code --refresh"
  exit 1
fi
grn "配对成功 token=${TOKEN:0:16}…"

AUTH_H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/json" -H "X-Giteam-Device-Id: diagnose-remote")

probe() {
  local path="$1"
  local out code
  out="$(mktemp)"
  code="$(curl -sS -m 30 -o "$out" -w '%{http_code}' "${AUTH_H[@]}" "$BASE_URL$path" 2>/dev/null || echo 000)"
  printf '%s\t%s\t%s\n' "$code" "$(wc -c <"$out" | tr -d ' ')" "$path"
  # keep body path in global for caller via echo last line? use named files
  echo "$out"
}

hdr "3) Route probe（看对方 CLI 是否真有 Agent/模型接口）"
for path in \
  /api/v1/agent/runtime \
  /api/v1/agent/session \
  /api/v1/agent/providers \
  /api/v1/admin/mobile/model-state
do
  body="$(mktemp)"
  code="$(curl -sS -m 30 -o "$body" -w '%{http_code}' "${AUTH_H[@]}" "$BASE_URL$path" 2>/dev/null || echo 000)"
  bytes="$(wc -c <"$body" | tr -d ' ')"
  snippet="$(head -c 160 "$body" | tr '\n' ' ')"
  echo "[$code] ${bytes}B  $path"
  echo "      $snippet"
  case "$path" in
    */session) SESSION_BODY="$body"; SESSION_CODE="$code" ;;
    */providers) PROV_BODY="$body"; PROV_CODE="$code" ;;
    */model-state) STATE_BODY="$body"; STATE_CODE="$code" ;;
    */runtime) RUNTIME_BODY="$body"; RUNTIME_CODE="$code" ;;
  esac
done

hdr "4) 解析 model-state / providers（若接口存在）"
python3 - <<'PY' "${STATE_CODE:-000}" "${STATE_BODY:-}" "${PROV_CODE:-000}" "${PROV_BODY:-}" "${SESSION_CODE:-000}" "${SESSION_BODY:-}"
import json, sys, os

state_code, state_path, prov_code, prov_path, sess_code, sess_path = sys.argv[1:7]

def load(path):
    if not path or not os.path.exists(path):
        return None
    raw = open(path, "rb").read()
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except Exception as e:
        return {"_parse_error": str(e), "_raw": raw[:200].decode("utf-8", "replace")}

print(f"session HTTP={sess_code}")
sess = load(sess_path)
if sess_code.startswith("2") and isinstance(sess, list):
    print(f"  sessions = {len(sess)}")
elif isinstance(sess, dict):
    print(f"  body = {sess}")

print(f"\nmodel-state HTTP={state_code}")
state = load(state_path)
if state_code == "404" or (isinstance(state, dict) and state.get("error") == "not found"):
    print("  ❌ 接口 404 not found → 对方 :4100 进程几乎肯定不是完整 giteam Agent 控制面")
    print("     （health/pair 有，但 /api/v1/agent/* 和 model-state 没有）")
elif state is None:
    print("  STATE = null/空 → 桌面未成功 push mobile-model-state")
elif isinstance(state, dict) and state.get("error"):
    print(f"  ERROR: {state}")
elif isinstance(state, dict):
    enabled = state.get("enabledModels")
    available = state.get("availableModels") or []
    hidden = set(state.get("hiddenModels") or [])
    print(f"  activeModel     = {state.get('activeModel')}")
    print(f"  updatedAt       = {state.get('updatedAt')}")
    print(f"  enabledModels   = {enabled} (count={len(enabled) if isinstance(enabled, list) else 'n/a'})")
    print(f"  availableModels = {len(available)}")
    print(f"  hiddenModels    = {len(hidden)}")
    refs = []
    if isinstance(enabled, list):
        en = set(enabled)
        if available:
            refs = [r for r in available if r in en and r not in hidden]
        for r in enabled:
            if r not in hidden and r not in refs:
                refs.append(r)
    print(f"  粗算可选 ≈ {len(refs)}")
    for r in refs[:10]:
        print(f"    ✓ {r}")
else:
    print(f"  unexpected: {state}")

print(f"\nproviders HTTP={prov_code}")
prov = load(prov_path)
if prov_code == "404" or (isinstance(prov, dict) and prov.get("error") == "not found"):
    print("  ❌ providers 也是 404 → 与上面同一问题：控制面缺 Agent 路由")
elif isinstance(prov, dict) and prov.get("error"):
    print(f"  ERROR: {prov}")
elif isinstance(prov, list):
    with_cred = [p for p in prov if p.get("hasCredential")]
    print(f"  providers={len(prov)}  withCredential={len(with_cred)}")
    for p in with_cred[:8]:
        models = p.get("models") or []
        print(f"    - {p.get('provider')}: models={len(models)}")
else:
    print(f"  unexpected: {type(prov)} {str(prov)[:120]}")
PY

hdr "5) 结论"
python3 - <<'PY' "${STATE_CODE:-000}" "${PROV_CODE:-000}" "${SESSION_CODE:-000}"
import sys
sc, pc, sess = sys.argv[1:4]
print("针对 http://192.168.50.242:4100 + pair 299000：")
if sc == "404" or pc == "404":
    print("""
根因更像是：对方机器 4100 上跑的进程能 health/pair，但没有挂上
/api/v1/agent/* 与 /api/v1/admin/mobile/model-state。

手机若仍能「看到会话」，请确认手机里填的 baseUrl 是否真是这个地址，
或是否还缓存了旧服务数据。

在对方机器上执行：
  giteam --version
  giteam service status
  giteam service doctor
  curl -sS http://127.0.0.1:4100/api/v1/health | python3 -m json.tool
  # 用刚配对出的 token：
  curl -sS -H "Authorization: Bearer <token>" http://127.0.0.1:4100/api/v1/agent/runtime

若 runtime/session 在对方本机也 404：需要重装/重启完整 CLI：
  npm install -g giteam@latest
  giteam service stop && giteam service start
""")
elif sess.startswith("2") and sc.startswith("2"):
    print("接口都通。若手机仍无模型，看步骤 4 的 enabledModels / 过滤结果。")
else:
    print(f"session={sess} model-state={sc} providers={pc} — 把完整输出发回来继续看。")
PY

# cleanup temp bodies
rm -f "${SESSION_BODY:-}" "${PROV_BODY:-}" "${STATE_BODY:-}" "${RUNTIME_BODY:-}" 2>/dev/null || true
printf '\033[32m诊断完成（仅测了 %s）。\033[0m\n' "$BASE_URL"
