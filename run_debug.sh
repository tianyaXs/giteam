#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GITEAM_BG_PID=""

cleanup_backend() {
    if [ -n "$GITEAM_BG_PID" ]; then
        echo ""
        echo "=== Stopping giteam web server ==="
        kill "$GITEAM_BG_PID" 2>/dev/null || true
        wait "$GITEAM_BG_PID" 2>/dev/null || true
        GITEAM_BG_PID=""
    fi
}

# INT/TERM: stop the backend, then fall back to the menu.
trap 'cleanup_backend' EXIT INT TERM

kill_port() {
    local pid
    pid=$(lsof -t -i :"$1" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo "=== Killing remaining process (PID: $pid) on port $1 ==="
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
    fi
}

install_deps() {
    echo "=== Installing frontend dependencies ==="
    # IMPORTANT: desktop lives inside an npm workspace, but this debug flow only
    # needs desktop deps. Disable workspace resolution here so npm doesn't try to
    # resolve the mobile app's peer deps and fail the whole setup.
    (cd "$SCRIPT_DIR/apps/desktop" && npm install --workspaces=false)
}

start_web() {
    # Stop the system giteam service (launchd auto-restarts if we just kill)
    if launchctl list 2>/dev/null | grep -q com.giteam.control-service; then
        echo "=== Stopping system giteam service ==="
        launchctl stop com.giteam.control-service 2>/dev/null || true
        launchctl remove com.giteam.control-service 2>/dev/null || true
        sleep 1
    fi
    kill_port 5100
    kill_port 1420

    install_deps

    echo ""
    echo "=== Building web frontend (fallback for giteam) ==="
    (cd "$SCRIPT_DIR/apps/desktop" && npm run build:web)

    echo ""
    echo "=== Building Rust CLI ==="
    (cd "$SCRIPT_DIR/apps/cli" && cargo build --release)

    echo ""
    echo "=== Starting giteam web server (API backend) ==="
    (cd "$SCRIPT_DIR/apps/cli" && exec ./target/release/giteam web --dist "$SCRIPT_DIR/apps/desktop/dist-web") &
    GITEAM_BG_PID=$!
    sleep 2

    echo ""
    echo "=== Starting Vite dev server (frontend with HMR) ==="
    echo "Open http://localhost:1420 in your browser (Ctrl+C 返回菜单)"
    (cd "$SCRIPT_DIR/apps/desktop" && npm run dev) || true
    cleanup_backend
}

start_app() {
    kill_port 1420

    install_deps

    echo ""
    echo "=== Starting Tauri desktop app ==="
    (cd "$SCRIPT_DIR/apps/desktop" && npm run tauri:dev) || true
}

while true; do
    echo ""
    echo "===== giteam 调试菜单 ====="
    echo "  1) 启动 Web（前后端一起启动，端口占用自动 kill）"
    echo "  2) 启动 App 端（Tauri 桌面）"
    echo "  0) 退出"
    read -r -p "请选择: " choice || exit 0
    case "$choice" in
        1) start_web ;;
        2) start_app ;;
        0) echo "Bye."; exit 0 ;;
        *) echo "无效选择: $choice" ;;
    esac
done
