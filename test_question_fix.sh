#!/bin/bash
set -e

echo "=== Question Fix Test ==="
echo ""

# Check if giteam service is running
GITEAM_PID=$(cat ~/Library/Application\ Support/giteam/control-server.pid 2>/dev/null || echo "")
if [ -n "$GITEAM_PID" ] && kill -0 "$GITEAM_PID" 2>/dev/null; then
    echo "Giteam service running (PID: $GITEAM_PID)"
    echo "Restarting with new binary..."
    kill "$GITEAM_PID" 2>/dev/null || true
    sleep 2
else
    echo "Giteam service not running"
fi

# Start giteam service with new binary
echo "Starting giteam service..."
cd /Users/tianya/Documents/project/giteam
./apps/cli/npm/darwin-arm64/bin/giteam service start > /tmp/giteam-test.log 2>&1 &
echo $! > /tmp/giteam-test.pid
sleep 3

# Check service health
GITEAM_URL="http://localhost:4100"
if curl -s "${GITEAM_URL}/api/v1/health" > /dev/null 2>&1; then
    echo "Giteam service started successfully"
else
    echo "WARNING: Giteam service may not be ready yet"
fi

# Get auth token
TOKEN=$(cat ~/Library/Application\ Support/giteam/control-auth.json | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
REPO_PATH="/Users/tianya/Documents/project/giteam"

echo ""
echo "=== Test 1: List questions (should be empty) ==="
if [ -n "$TOKEN" ]; then
    curl -s -H "Authorization: Bearer $TOKEN" "${GITEAM_URL}/api/v1/opencode/question?repoPath=${REPO_PATH}"
else
    curl -s "${GITEAM_URL}/api/v1/opencode/question?repoPath=${REPO_PATH}"
fi
echo ""

echo ""
echo "=== Test 2: Submit with call_function ID (should try to find mapping) ==="
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

echo ""
echo "=== Test 3: Submit with non-existent que_ ID ==="
if [ -n "$TOKEN" ]; then
    curl -s -X POST -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        "${GITEAM_URL}/api/v1/opencode/question/que_nonexistent123/reply" \
        -d "{\"repoPath\": \"${REPO_PATH}\", \"answers\": [[\"option A\"]]}"
else
    curl -s -X POST \
        -H "Content-Type: application/json" \
        "${GITEAM_URL}/api/v1/opencode/question/que_nonexistent123/reply" \
        -d "{\"repoPath\": \"${REPO_PATH}\", \"answers\": [[\"option A\"]]}"
fi
echo ""

echo ""
echo "=== Test Complete ==="
echo "Cleaning up..."
kill $(cat /tmp/giteam-test.pid) 2>/dev/null || true
