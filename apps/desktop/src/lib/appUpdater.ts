import { IS_TAURI } from "./platform";

export type AppUpdateState =
  | { status: "idle" }
  | { status: "unsupported" }
  | { status: "checking" }
  | { status: "upToDate"; currentVersion: string }
  | {
      status: "available";
      currentVersion: string;
      version: string;
      notes: string;
    }
  | {
      status: "downloading";
      currentVersion: string;
      version: string;
      progress: number;
    }
  | { status: "ready"; currentVersion: string; version: string }
  | { status: "error"; message: string };

type PendingUpdate = {
  version: string;
  notes: string;
  downloadAndInstall: (
    onEvent?: (event: {
      event: string;
      data?: { chunkLength?: number; contentLength?: number | null };
    }) => void
  ) => Promise<void>;
};

let pendingUpdate: PendingUpdate | null = null;

export async function getAppVersion(): Promise<string> {
  if (!IS_TAURI) return "web";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function checkAppUpdate(): Promise<AppUpdateState> {
  if (!IS_TAURI) {
    pendingUpdate = null;
    return { status: "unsupported" };
  }

  const currentVersion = await getAppVersion();
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      pendingUpdate = null;
      return { status: "upToDate", currentVersion };
    }
    pendingUpdate = {
      version: update.version,
      notes: String(update.body || "").trim(),
      downloadAndInstall: (onEvent) => update.downloadAndInstall(onEvent as never)
    };
    return {
      status: "available",
      currentVersion,
      version: update.version,
      notes: pendingUpdate.notes
    };
  } catch (error) {
    pendingUpdate = null;
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function downloadAndInstallAppUpdate(
  onProgress?: (progress: number) => void
): Promise<AppUpdateState> {
  if (!IS_TAURI) return { status: "unsupported" };
  if (!pendingUpdate) {
    return { status: "error", message: "No pending update. Check for updates first." };
  }

  const currentVersion = await getAppVersion();
  const version = pendingUpdate.version;
  let downloaded = 0;
  let contentLength: number | null = null;

  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        contentLength = event.data?.contentLength ?? null;
        downloaded = 0;
        onProgress?.(0);
        return;
      }
      if (event.event === "Progress") {
        downloaded += Number(event.data?.chunkLength || 0);
        if (contentLength && contentLength > 0) {
          onProgress?.(Math.min(99, Math.round((downloaded / contentLength) * 100)));
        }
        return;
      }
      if (event.event === "Finished") {
        onProgress?.(100);
      }
    });
    pendingUpdate = null;
    return { status: "ready", currentVersion, version };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function relaunchApp(): Promise<void> {
  if (!IS_TAURI) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
