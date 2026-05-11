#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
