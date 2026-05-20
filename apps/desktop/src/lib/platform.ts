// Platform abstraction layer for giteam desktop
// Automatically switches between Tauri native APIs and HTTP RPC in browser

export const IS_TAURI = typeof window !== "undefined" && !!(
  (window as any).__TAURI_INTERNALS__
  || (window as any).isTauri
  || (window as any).__TAURI__
);

// In web mode, all API calls go through the same-origin control server
const RPC_BASE = "/api/v1/desktop/rpc";

function summarizeRpcValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth >= 2) {
    if (Array.isArray(value)) return `[array:${value.length}]`;
    if (typeof value === "object") return "[object]";
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 6).map((item) => summarizeRpcValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (lower.includes("key") || lower.includes("token") || lower.includes("secret") || lower.includes("password")) {
        out[key] = "[redacted]";
        continue;
      }
      if ((lower === "prompt" || lower === "message" || lower === "log" || lower === "output") && typeof raw === "string") {
        out[key] = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
        continue;
      }
      out[key] = summarizeRpcValue(raw, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  }
  return value;
}

function summarizeRpcArgs(args?: Record<string, unknown>): string {
  try {
    return JSON.stringify(summarizeRpcValue(args ?? {}));
  } catch {
    return "[unserializable args]";
  }
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (IS_TAURI) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke(command, args);
  }

  if (command === "send_desktop_notification") {
    const title = String(args?.title ?? "").trim();
    const body = String(args?.body ?? "").trim();
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title || "Giteam", { body });
      } else if (Notification.permission === "default") {
        Notification.requestPermission()
          .then((permission) => {
            if (permission === "granted") {
              new Notification(title || "Giteam", { body });
            }
          })
          .catch(() => {});
      }
    }
    return undefined as T;
  }

  if (command === "open_external_url") {
    const url = String(args?.url ?? "").trim();
    if (url && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return undefined as T;
  }

  // Web mode: POST to /api/v1/desktop/rpc
  const resp = await fetch(RPC_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, args: args ?? {} }),
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    const message = errBody.error || `RPC failed: ${resp.status}`;
    console.error("[rpc:web] command failed", {
      command,
      status: resp.status,
      args: summarizeRpcArgs(args),
      error: message
    });
    throw new Error(`[${command}] ${message}`);
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
