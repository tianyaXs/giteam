#!/bin/bash

# Test script for opencode question API
# This script tests the question endpoints to understand the expected behavior

set -e

REPO_PATH="/Users/tianya/Documents/project/giteam"
OPENCODE_DIR=$(basename "$REPO_PATH")

# Get token from giteam config
TOKEN=$(cat ~/Library/Application\ Support/giteam/control-auth.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)

# Get opencode port from giteam config
OPENCODE_PORT=$(cat ~/Library/Application\ Support/giteam/opencode-service.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('port', 4098))" 2>/dev/null)

# Try to find opencode service base URL
for PORT in $OPENCODE_PORT 3000 3001 3002 4000 4001 4100 5000; do
    URL="http://localhost:$PORT"
    if curl -s "$URL/health" > /dev/null 2>&1; then
        echo "Found opencode service at: $URL"
        OPENCODE_BASE="$URL"
        break
    fi
done

if [ -z "$OPENCODE_BASE" ]; then
    echo "ERROR: Could not find opencode service. Make sure opencode is running."
    lsof -i -P | grep LISTEN | grep -E "node|bun|deno" || true
    exit 1
fi

echo "=== Testing Opencode Question API ==="
echo "Opencode Base URL: $OPENCODE_BASE"
echo "Directory: $OPENCODE_DIR"
echo "Token: ${TOKEN:0:20}..."
echo ""

# Helper function for authenticated requests
auth_curl() {
    if [ -n "$TOKEN" ]; then
        curl -s -H "Authorization: Bearer $TOKEN" "$@"
    else
        curl -s "$@"
    fi
}

# Test 1: List questions
echo "=== Test 1: GET /question ==="
QUESTION_LIST=$(auth_curl "${OPENCODE_BASE}/question?directory=${OPENCODE_DIR}")
echo "Response:"
echo "$QUESTION_LIST" | python3 -m json.tool 2>&1 || echo "$QUESTION_LIST"
echo ""

# Extract question IDs if any
QUESTION_IDS=$(echo "$QUESTION_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if isinstance(data, list):
    for item in data:
        print(item.get('id', 'NO_ID'))
" 2>&1 || true)

if [ -n "$QUESTION_IDS" ] && [ "$QUESTION_IDS" != "NO_ID" ]; then
    echo "Found question IDs:"
    echo "$QUESTION_IDS"
    
    for QID in $QUESTION_IDS; do
        echo ""
        echo "=== Test 2: Question Details for $QID ==="
        
        echo "$QUESTION_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data:
    if item.get('id') == '$QID':
        print('SessionID:', item.get('sessionID'))
        print('Tool:', item.get('tool'))
        print('Questions:', json.dumps(item.get('questions'), indent=2, ensure_ascii=False))
" 2>&1 || true
        
        # Test 3: Try reply with invalid ID (call_function format)
        echo ""
        echo "=== Test 3: Try reply with call_function ID (should fail) ==="
        auth_curl -X POST "${OPENCODE_BASE}/question/call_function_test123/reply?directory=${OPENCODE_DIR}" \
            -H "Content-Type: application/json" \
            -d '{"answers": [["option A"]]}' || true
        echo ""
        
        # Test 4: Try reject with invalid ID
        echo ""
        echo "=== Test 4: Try reject with call_function ID (should fail) ==="
        auth_curl -X POST "${OPENCODE_BASE}/question/call_function_test123/reject?directory=${OPENCODE_DIR}" || true
        echo ""
        
        # Test 5: Try reply with correct ID format but non-existent
        echo ""
        echo "=== Test 5: Try reply with que_ ID but wrong one (should fail) ==="
        auth_curl -X POST "${OPENCODE_BASE}/question/que_nonexistent123/reply?directory=${OPENCODE_DIR}" \
            -H "Content-Type: application/json" \
            -d '{"answers": [["option A"]]}' || true
        echo ""
    done
else
    echo "No questions found in the list."
fi

# Test 6: Check SSE events endpoint
echo ""
echo "=== Test 6: Check SSE /global/event (5 second timeout) ==="
timeout 5 auth_curl -N -H "Accept: text/event-stream" "${OPENCODE_BASE}/global/event?directory=${OPENCODE_DIR}" || true
echo ""

echo ""
echo "=== Test Complete ==="
