#!/bin/bash
# Test to check if question cache has the correct que_ ID

REPO_PATH="/Users/tianya/Documents/project/giteam"
OPENCODE_DIR=$(basename "$REPO_PATH")
TOKEN=$(cat ~/Library/Application\ Support/giteam/control-auth.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)

# Get giteam service URL
GITEAM_URL="http://localhost:4100"

echo "=== Testing Giteam Question API ==="
echo "Giteam URL: $GITEAM_URL"
echo "Repo Path: $REPO_PATH"
echo ""

# Test 1: Get questions through giteam API
echo "=== Test 1: GET /api/v1/opencode/question (through giteam) ==="
if [ -n "$TOKEN" ]; then
    QUESTION_LIST=$(curl -s -H "Authorization: Bearer $TOKEN" "${GITEAM_URL}/api/v1/opencode/question?repoPath=${REPO_PATH}")
else
    QUESTION_LIST=$(curl -s "${GITEAM_URL}/api/v1/opencode/question?repoPath=${REPO_PATH}")
fi
echo "Response:"
echo "$QUESTION_LIST" | python3 -m json.tool 2>/dev/null || echo "$QUESTION_LIST"
echo ""

# Extract IDs and tool info
QUESTION_IDS=$(echo "$QUESTION_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if isinstance(data, list):
    for item in data:
        print(f\"ID: {item.get('id', 'NO_ID')}, Tool: {item.get('tool', 'NO_TOOL')}\")
" 2>/dev/null || true)

if [ -n "$QUESTION_IDS" ]; then
    echo "Found questions:"
    echo "$QUESTION_IDS"
else
    echo "No questions found."
fi

# Test 2: Check opencode directly
echo ""
echo "=== Test 2: GET /question (direct from opencode) ==="
OPENCODE_BASE="http://localhost:4098"
if [ -n "$TOKEN" ]; then
    OPENCODE_LIST=$(curl -s -H "Authorization: Bearer $TOKEN" "${OPENCODE_BASE}/question?directory=${OPENCODE_DIR}")
else
    OPENCODE_LIST=$(curl -s "${OPENCODE_BASE}/question?directory=${OPENCODE_DIR}")
fi
echo "Response:"
echo "$OPENCODE_LIST" | python3 -m json.tool 2>/dev/null || echo "$OPENCODE_LIST"
echo ""

# Test 3: Try to submit with a call_function ID (should fail)
echo "=== Test 3: Try submit with call_function ID ==="
if [ -n "$TOKEN" ]; then
    curl -s -X POST -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        "${GITEAM_URL}/api/v1/opencode/question/call_function_test123/reply" \
        -d "{\"repoPath\": \"${REPO_PATH}\", \"answers\": [[\"option A\"]]}"
else
    curl -s -X POST \
        -H "Content-Type: application/json" \
        "${GITEAM_URL}/api/v1/opencode/question/call_function_test123/reply" \
        -d "{\"repoPath\": \"${REPO_PATH}\", \"answers\": [[\"option A\"]]}"
fi
echo ""

