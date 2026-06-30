import { loadLocalBool, loadLocalJson, loadLocalString, saveLocalBool, saveLocalJson, saveLocalString } from "./localPreferences";

export type DesktopTheme = "dark" | "light";

const DESKTOP_THEME_KEY = "giteam.theme";
const PINNED_REPOS_KEY = "giteam.pinnedRepos";
const RUNTIME_READY_KEY = "giteam.runtime.ready.v1";
const RUNTIME_SETUP_DISMISSED_KEY = "giteam.runtime.setup.dismissed.v1";

export function loadDesktopTheme(): DesktopTheme {
  return loadLocalString(DESKTOP_THEME_KEY, "dark") === "light" ? "light" : "dark";
}

export function saveDesktopTheme(theme: DesktopTheme): void {
  saveLocalString(DESKTOP_THEME_KEY, theme);
}

export function loadPinnedRepoIds(): string[] {
  const raw = loadLocalJson<unknown[]>(PINNED_REPOS_KEY, []);
  return raw
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

export function savePinnedRepoIds(repoIds: string[]): void {
  const normalized = Array.from(new Set(repoIds.map((repoId) => repoId.trim()).filter(Boolean)));
  saveLocalJson(PINNED_REPOS_KEY, normalized);
}

export function hasRuntimeFirstCheckCompleted(storageKey: string): boolean {
  return loadLocalBool(storageKey, false);
}

export function markRuntimeFirstCheckCompleted(storageKey: string): void {
  saveLocalBool(storageKey, true);
}

export function isRuntimeSetupDismissed(): boolean {
  return loadLocalBool(RUNTIME_SETUP_DISMISSED_KEY, false);
}

export function setRuntimeSetupDismissed(dismissed: boolean): void {
  saveLocalBool(RUNTIME_SETUP_DISMISSED_KEY, dismissed);
}

export function markRuntimeReady(): void {
  saveLocalBool(RUNTIME_READY_KEY, true);
}
