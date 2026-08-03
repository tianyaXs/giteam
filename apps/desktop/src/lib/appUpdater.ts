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
      notes: string;
      progress: number;
    }
  | {
      status: "ready";
      currentVersion: string;
      version: string;
      notes: string;
    }
  | { status: "error"; message: string };

export type UpdateCelebration = {
  fromVersion: string;
  toVersion: string;
  notes: string;
};

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

const CELEBRATION_KEY = "giteam.app.updateCelebration.v1";
const LAST_LAUNCHED_VERSION_KEY = "giteam.app.lastLaunchedVersion.v1";

let pendingUpdate: PendingUpdate | null = null;
let installInFlight: Promise<AppUpdateState> | null = null;

export async function getAppVersion(): Promise<string> {
  if (!IS_TAURI) return "web";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export function stashUpdateCelebration(payload: UpdateCelebration): void {
  try {
    window.localStorage.setItem(CELEBRATION_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function consumeUpdateCelebration(currentVersion: string): UpdateCelebration | null {
  try {
    const raw = window.localStorage.getItem(CELEBRATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UpdateCelebration>;
    const toVersion = String(parsed.toVersion || "").trim();
    const fromVersion = String(parsed.fromVersion || "").trim();
    const notes = String(parsed.notes || "").trim();
    if (!toVersion || toVersion !== currentVersion) return null;
    window.localStorage.removeItem(CELEBRATION_KEY);
    return { fromVersion: fromVersion || "—", toVersion, notes };
  } catch {
    return null;
  }
}

export function clearUpdateCelebration(): void {
  try {
    window.localStorage.removeItem(CELEBRATION_KEY);
  } catch {
    // ignore
  }
}

export function readLastLaunchedVersion(): string {
  try {
    return String(window.localStorage.getItem(LAST_LAUNCHED_VERSION_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeLastLaunchedVersion(version: string): void {
  const next = String(version || "").trim();
  if (!next) return;
  try {
    window.localStorage.setItem(LAST_LAUNCHED_VERSION_KEY, next);
  } catch {
    // ignore
  }
}

/** 启动时解析：优先用安装前缓存的更新说明；否则仅版本号变化时给简版提示。 */
export function resolveStartupUpdateCelebration(currentVersion: string): UpdateCelebration | null {
  const version = String(currentVersion || "").trim();
  if (!version || version === "web") return null;
  const stashed = consumeUpdateCelebration(version);
  if (stashed) {
    writeLastLaunchedVersion(version);
    return stashed;
  }
  const last = readLastLaunchedVersion();
  writeLastLaunchedVersion(version);
  if (last && last !== version) {
    return { fromVersion: last, toVersion: version, notes: "" };
  }
  return null;
}

function isCrossDeviceUpdaterError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("cross-device") ||
    lower.includes("crossesdevices") ||
    lower.includes("os error 18") ||
    lower.includes("exdev")
  );
}

function isNoPendingUpdaterError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("no pending update") || lower.includes("check for updates first");
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
      version: pendingUpdate.version,
      notes: pendingUpdate.notes
    };
  } catch (error) {
    pendingUpdate = null;
    const raw = error instanceof Error ? error.message : String(error);
    const lower = raw.toLowerCase();
    const hint =
      lower.includes("release json") ||
      lower.includes("latest.json") ||
      lower.includes("404") ||
      lower.includes("not found")
        ? "（通常是 GitHub Release 尚未发布，或 Desktop Release CI 失败，没有 latest.json）"
        : "";
    return {
      status: "error",
      message: `${raw}${hint}`
    };
  }
}

async function ensurePendingUpdate(): Promise<AppUpdateState | null> {
  if (pendingUpdate) return null;
  const checked = await checkAppUpdate();
  if (checked.status === "available" && pendingUpdate) return null;
  if (checked.status === "upToDate" || checked.status === "unsupported") {
    return {
      status: "error",
      message: "没有可用更新。请先检查更新。"
    };
  }
  return checked;
}

async function runPendingDownloadAndInstall(
  onProgress?: (progress: number) => void
): Promise<AppUpdateState> {
  if (!pendingUpdate) {
    return { status: "error", message: "No pending update. Check for updates first." };
  }

  const currentVersion = await getAppVersion();
  const version = pendingUpdate.version;
  const notes = pendingUpdate.notes;
  let downloaded = 0;
  let contentLength: number | null = null;

  try {
    // 重启后展示 What's New：在安装前写入，避免 relaunch 后丢失
    stashUpdateCelebration({
      fromVersion: currentVersion,
      toVersion: version,
      notes
    });
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
    return { status: "ready", currentVersion, version, notes };
  } catch (error) {
    clearUpdateCelebration();
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}

export async function downloadAndInstallAppUpdate(
  onProgress?: (progress: number) => void
): Promise<AppUpdateState> {
  if (!IS_TAURI) return { status: "unsupported" };

  // 合并连点：同一时刻只跑一次安装，避免“要点两次”和重复下载。
  if (installInFlight) return installInFlight;

  installInFlight = (async () => {
    const missing = await ensurePendingUpdate();
    if (missing) return missing;

    let result = await runPendingDownloadAndInstall(onProgress);

    // 首次失败常见原因：pending Update 已失效，或跨卷 rename。自动重新 check 再试一次。
    if (
      result.status === "error" &&
      (isNoPendingUpdaterError(result.message) || isCrossDeviceUpdaterError(result.message))
    ) {
      pendingUpdate = null;
      const refreshed = await ensurePendingUpdate();
      if (!refreshed && pendingUpdate) {
        result = await runPendingDownloadAndInstall(onProgress);
      } else if (refreshed) {
        result = refreshed;
      }
    }

    if (result.status === "error" && isCrossDeviceUpdaterError(result.message)) {
      return {
        status: "error",
        message:
          `${result.message}（安装临时目录与应用不在同一磁盘卷。请把 giteam.app 放到本机磁盘如 /Applications 后再试，或重新打开应用后重试一次。）`
      };
    }

    return result;
  })();

  try {
    return await installInFlight;
  } finally {
    installInFlight = null;
  }
}

export async function relaunchApp(): Promise<void> {
  if (!IS_TAURI) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
