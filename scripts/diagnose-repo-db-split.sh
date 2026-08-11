#!/usr/bin/env bash
# 核对 CLI / 桌面是否都只读 ~/.giteam/client.db，以及 API 数量是否一致。
#
# 用法（在跑 giteam 的那台 Mac 上）：
#   ./scripts/diagnose-repo-db-split.sh
#   ./scripts/diagnose-repo-db-split.sh http://127.0.0.1:4100
#   ./scripts/diagnose-repo-db-split.sh http://127.0.0.1:4100 355000

set -u

BASE_URL="${1:-http://127.0.0.1:4100}"
PAIR_CODE="${2:-}"
BASE_URL="${BASE_URL%/}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
hdr() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

if ! command -v sqlite3 >/dev/null 2>&1; then
  red "需要 sqlite3"
  exit 1
fi

CANONICAL="${GITEAM_HOME:-$HOME/.giteam}/client.db"
ASUPPORT="$HOME/Library/Application Support/giteam/client.db"

hdr "Canonical DB (only path CLI/desktop should use)"
if [ -f "$CANONICAL" ]; then
  N="$(sqlite3 "$CANONICAL" "SELECT COUNT(*) FROM repositories;")"
  grn "count=$N  path=$CANONICAL"
  sqlite3 -header -column "$CANONICAL" \
    "SELECT name, path FROM repositories ORDER BY added_at_ms DESC;" | sed 's/^/  /'
else
  red "missing: $CANONICAL"
  N=""
fi

hdr "Stale legacy DB (should be ignored by CLI)"
if [ -f "$ASUPPORT" ]; then
  OLD="$(sqlite3 "$ASUPPORT" "SELECT COUNT(*) FROM repositories;")"
  ylw "still exists count=$OLD  path=$ASUPPORT (informational only)"
  if [ -n "$N" ] && [ "$N" != "$OLD" ]; then
    ylw "counts differ; if API still equals $OLD, CLI binary is old / not reloaded"
  fi
else
  echo "absent (ok)"
fi

hdr "API /api/v1/repository/list via $BASE_URL"
if ! curl -sS -m 5 "$BASE_URL/api/v1/health" >/tmp/giteam-repo-diag-health.json 2>/dev/null; then
  red "无法连接 $BASE_URL"
  exit 1
fi

if [ -z "$PAIR_CODE" ]; then
  case "$BASE_URL" in
    *127.0.0.1*|*localhost*)
      PAIR_CODE="$(curl -sS -m 5 "$BASE_URL/api/v1/pair/current" 2>/dev/null \
        | python3 -c "import json,sys
try:
 d=json.load(sys.stdin); print(d.get('code') or '')
except Exception:
 print('')" 2>/dev/null || true)"
      ;;
  esac
fi

if [ -z "$PAIR_CODE" ]; then
  ylw "请传 pair code：$0 $BASE_URL <code>"
  exit 0
fi

PAIR_RESP="$(curl -sS -m 10 -X POST "$BASE_URL/api/v1/auth/pair" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$PAIR_CODE\"}")"
TOKEN="$(python3 -c "import json,sys
try:
 d=json.loads(sys.argv[1]); print(d.get('token') or '')
except Exception:
 print('')" "$PAIR_RESP")"
if [ -z "$TOKEN" ]; then
  red "配对失败: $PAIR_RESP"
  exit 1
fi

LIST="$(curl -sS -m 15 -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v1/repository/list")"
python3 - <<'PY' "$LIST" "$N"
import json, sys
raw, n = sys.argv[1], sys.argv[2]
data = json.loads(raw)
if isinstance(data, dict) and data.get("error"):
    print("api error:", data)
    raise SystemExit(1)
items = data if isinstance(data, list) else []
print(f"api_count={len(items)}")
for i, x in enumerate(items, 1):
    print(f"  {i:02d}. {x.get('name','')} | {x.get('path','')}")
if n.isdigit():
    print("MATCH canonical" if int(n) == len(items) else f"DIFF canonical_db={n} api={len(items)}")
PY
