// Platform abstraction layer for giteam desktop
// Automatically switches between Tauri native APIs and HTTP RPC in browser

const IS_TAURI = typeof window !== "undefined" && !!(window as any).__TAURI__;

// In web mode, all API calls go through the same-origin control server
const RPC_BASE = "/api/v1/desktop/rpc";

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (IS_TAURI) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke(command, args);
  }

  // Web mode: POST to /api/v1/desktop/rpc
  const resp = await fetch(RPC_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args: args ?? {} }),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(errBody.error || `RPC failed: ${resp.status}`);
  }

  const data = await resp.json();
  return data as T;
}

export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> {
  if (IS_TAURI) {
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    return tauriListen(event, handler);
  }

  // Web mode: no-op for file watcher events (frontend uses polling instead)
  console.warn(`[platform] listen("${event}") is not supported in web mode`);
  return () => {};
}

export async function pickFolder(): Promise<string | null> {
  if (IS_TAURI) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("pick_repository_folder");
  }

  // Web mode: prompt user for path
  const input = window.prompt("Enter the full path to your Git repository:");
  return input?.trim() || null;
}
