#!/bin/bash
# Comprehensive test for question flow

set -e

REPO_PATH="/Users/tianya/Documents/project/giteam"
GITEAM_URL="http://localhost:4100"
OPENCODE_BASE="http://localhost:4098"
OPENCODE_DIR=$(basename "$REPO_PATH")
TOKEN=$(cat ~/Library/Application\ Support/giteam/control-auth.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)

echo "=== Question Flow Test ==="
echo ""

# Helper function
auth_curl() {
    if [ -n "$TOKEN" ]; then
        curl -s -H "Authorization: Bearer $TOKEN" "$@"
    else
        curl -s "$@"
    fi
}

# Step 1: Check current state
echo "=== Step 1: Check current question state ==="
echo "Giteam API:"
auth_curl "${GITEAM_URL}/api/v1/opencode/question?repoPath=${REPO_PATH}"
echo ""
echo "Opencode API:"
auth_curl "${OPENCODE_BASE}/question?directory=${OPENCODE_DIR}"
echo ""

# Step 2: Create a test session and trigger a question
echo ""
echo "=== Step 2: Create session and send prompt ==="
SESSION_RESPONSE=$(auth_curl -X POST "${GITEAM_URL}/api/v1/opencode/session" \
    -H "Content-Type: application/json" \
    -d "{\"repoPath\": \"${REPO_PATH}\", \"title\": \"Test Question\"}")
echo "Session response: $SESSION_RESPONSE"
SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null || echo "")
echo "Session ID: $SESSION_ID"

if [ -n "$SESSION_ID" ]; then
    echo ""
    echo "Sending prompt to trigger question..."
    auth_curl -X POST "${GITEAM_URL}/api/v1/opencode/prompt" \
        -H "Content-Type: application/json" \
        -d "{\"repoPath\": \"${REPO_PATH}\", \"sessionId\": \"${SESSION_ID}\", \"prompt\": \"请问我应该使用哪种编程语言？选项：A. Python B. JavaScript C. Rust\"}" > /dev/null 2>&1 || true
    
    echo "Prompt sent. Waiting for question to appear..."
    sleep 5
    
    # Step 3: Check if question appeared
    echo ""
    echo "=== Step 3: Check if question appeared ==="
    echo "Giteam API:"
    auth_curl "${GITEAM_URL}/api/v1/opencode/question?repoPath=${REPO_PATH}"
    echo ""
    echo "Opencode API:"
    auth_curl "${OPENCODE_BASE}/question?directory=${OPENCODE_DIR}"
    echo ""
    
    # Step 4: Get session messages to see question in timeline
    echo ""
    echo "=== Step 4: Get session messages ==="
    auth_curl "${GITEAM_URL}/api/v1/opencode/messages?repoPath=${REPO_PATH}&sessionId=${SESSION_ID}&limit=5" | python3 -m json.tool 2>/dev/null | head -100
fi

echo ""
echo "=== Test Complete ==="
