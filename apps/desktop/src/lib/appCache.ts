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
  action: "install" | "uninstall";
  status: "running" | "succeeded" | "failed";
  log: string;
  startedAtMs: number;
  finishedAtMs?: number;
  exitCode?: number;
  error?: string;
};

export const SIDEBAR_WIDTH_CACHE_KEY = "giteam.layout.sidebar.width.v1";
export const RIGHT_PANE_WIDTH_CACHE_KEY = "giteam.layout.right.width.v1";

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

export const DEFAULT_RUNTIME_STATUS: RuntimeRequirementsStatus = {
  platform: "macos",
  homebrewInstalled: false,
  git: EMPTY_DEP("git", "brew install git"),
  entire: EMPTY_DEP("entire", "brew tap entireio/tap && brew install entireio/tap/entire"),
  opencode: EMPTY_DEP("opencode", "brew install anomalyco/tap/opencode"),
  giteam: EMPTY_DEP("giteam", "npm install -g giteam")
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
