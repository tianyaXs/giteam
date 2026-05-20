#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Stop the system giteam service (launchd auto-restarts if we just kill)
if launchctl list 2>/dev/null | grep -q com.giteam.control-service; then
    echo "=== Stopping system giteam service ==="
    launchctl stop com.giteam.control-service 2>/dev/null || true
    launchctl remove com.giteam.control-service 2>/dev/null || true
    sleep 1
fi

# Kill any remaining process on port 5100
GITEAM_PID=$(lsof -t -i :5100 2>/dev/null || true)
if [ -n "$GITEAM_PID" ]; then
    echo "=== Killing remaining process (PID: $GITEAM_PID) on port 5100 ==="
    kill -9 "$GITEAM_PID" 2>/dev/null || true
    sleep 1
fi

echo "=== Installing frontend dependencies ==="
cd "$SCRIPT_DIR/apps/desktop"
# IMPORTANT: desktop lives inside an npm workspace, but this debug flow only
# needs desktop deps. Disable workspace resolution here so npm doesn't try to
# resolve the mobile app's peer deps and fail the whole setup.
npm install --workspaces=false

echo ""
echo "=== Building web frontend (fallback for giteam) ==="
npm run build:web

echo ""
echo "=== Building Rust CLI ==="
cd "$SCRIPT_DIR/apps/cli"
cargo build --release

echo ""
echo "=== Starting giteam web server (API backend) ==="
cd "$SCRIPT_DIR/apps/cli"
./target/release/giteam web --dist "$SCRIPT_DIR/apps/desktop/dist-web" &
GITEAM_BG_PID=$!
sleep 2

cleanup() {
    echo ""
    echo "=== Stopping giteam web server ==="
    kill "$GITEAM_BG_PID" 2>/dev/null || true
    wait "$GITEAM_BG_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo ""
echo "=== Starting Vite dev server (frontend with HMR) ==="
echo "Open http://localhost:1420 in your browser"
cd "$SCRIPT_DIR/apps/desktop"
npm run dev
