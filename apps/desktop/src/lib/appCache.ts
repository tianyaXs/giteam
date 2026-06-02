export type RuntimeDepName = "git" | "entire" | "opencode" | "giteam";

export type RuntimeDependencyStatus = {
  name: string;
  checked: boolean;
  installed: boolean;
  path?: string;
  version?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  installHint: string;
};

export type RuntimeRequirementsStatus = {
  platform: string;
  homebrewInstalled: boolean;
  git: RuntimeDependencyStatus;
  entire: RuntimeDependencyStatus;
  opencode: RuntimeDependencyStatus;
  giteam: RuntimeDependencyStatus;
};

export type RuntimeActionJobStatus = {
  jobId: string;
  name: string;
  action: "install" | "uninstall" | "bootstrap";
  status: "running" | "succeeded" | "failed";
  log: string;
  startedAtMs: number;
  finishedAtMs?: number;
  exitCode?: number;
  error?: string;
};

export const SIDEBAR_WIDTH_CACHE_KEY = "giteam.layout.sidebar.width.v1";
export const RIGHT_PANE_WIDTH_CACHE_KEY = "giteam.layout.right.width.v2";
export const GITTREE_SIDEBAR_WIDTH_CACHE_KEY = "giteam.layout.gittree.sidebar.width.v2";

const RUNTIME_STATUS_CACHE_KEY = "giteam.runtime.status.v1";

const EMPTY_DEP = (name: RuntimeDepName, installHint: string): RuntimeDependencyStatus => ({
  name,
  checked: false,
  installed: false,
  path: undefined,
  version: undefined,
  latestVersion: undefined,
  updateAvailable: false,
  installHint
});

function getDefaultPlatform(): string {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("win")) return "windows";
  if (userAgent.includes("mac") || userAgent.includes("darwin")) return "macos";
  return "linux";
}

function getInstallHints(platform: string): Record<RuntimeDepName, string> {
  if (platform === "windows") {
    return {
      git: "下载并安装 Git for Windows: https://git-scm.com/download/win",
      entire: "npm install -g @entire/cli",
      opencode: "npm install -g @anomalyco/opencode",
      giteam: "npm install -g giteam"
    };
  }
  return {
    git: "brew install git",
    entire: "brew tap entireio/tap && brew install entireio/tap/entire",
    opencode: "npm i -g opencode-ai",
    giteam: "npm install -g giteam"
  };
}

export const DEFAULT_RUNTIME_STATUS: RuntimeRequirementsStatus = {
  platform: getDefaultPlatform(),
  homebrewInstalled: false,
  git: EMPTY_DEP("git", getInstallHints(getDefaultPlatform()).git),
  entire: EMPTY_DEP("entire", getInstallHints(getDefaultPlatform()).entire),
  opencode: EMPTY_DEP("opencode", getInstallHints(getDefaultPlatform()).opencode),
  giteam: EMPTY_DEP("giteam", getInstallHints(getDefaultPlatform()).giteam)
};

export function loadCachedRuntimeStatus(): RuntimeRequirementsStatus {
  try {
    const raw = window.localStorage.getItem(RUNTIME_STATUS_CACHE_KEY);
    if (!raw) return DEFAULT_RUNTIME_STATUS;
    const parsed = JSON.parse(raw) as Partial<RuntimeRequirementsStatus>;
    return {
      platform: parsed.platform || DEFAULT_RUNTIME_STATUS.platform,
      homebrewInstalled: Boolean(parsed.homebrewInstalled),
      git: parsed.git ? { ...DEFAULT_RUNTIME_STATUS.git, ...parsed.git } : DEFAULT_RUNTIME_STATUS.git,
      entire: parsed.entire ? { ...DEFAULT_RUNTIME_STATUS.entire, ...parsed.entire } : DEFAULT_RUNTIME_STATUS.entire,
      opencode: parsed.opencode ? { ...DEFAULT_RUNTIME_STATUS.opencode, ...parsed.opencode } : DEFAULT_RUNTIME_STATUS.opencode,
      giteam: parsed.giteam ? { ...DEFAULT_RUNTIME_STATUS.giteam, ...parsed.giteam } : DEFAULT_RUNTIME_STATUS.giteam
    };
  } catch {
    return DEFAULT_RUNTIME_STATUS;
  }
}

export function saveCachedRuntimeStatus(status: RuntimeRequirementsStatus): void {
  try {
    window.localStorage.setItem(RUNTIME_STATUS_CACHE_KEY, JSON.stringify(status));
  } catch {
    // ignore unavailable storage
  }
}

export function getRuntimeLogTail(log: string): string {
  const lines = (log || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export function loadCachedWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  } catch {
    return fallback;
  }
}

export function saveCachedWidth(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore unavailable storage
  }
}
