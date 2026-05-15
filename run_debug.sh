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

echo "=== Building web frontend ==="
cd "$SCRIPT_DIR/apps/desktop"
npm install
npm run build:web

echo ""
echo "=== Building Rust CLI ==="
cd "$SCRIPT_DIR/apps/cli"
cargo build --release

echo ""
echo "=== Starting giteam web server ==="
cd "$SCRIPT_DIR/apps/cli"
exec ./target/release/giteam web "$@"
