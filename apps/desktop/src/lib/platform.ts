// Platform abstraction layer for giteam desktop (Tauri-only).

export const IS_TAURI = true;

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke(command, args);
}

export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen(event, handler);
}

export async function pickFolder(): Promise<string | null> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<string | null>("pick_repository_folder");
}
