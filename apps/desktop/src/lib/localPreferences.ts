/**
 * Copy legacy localStorage entries to new keys once.
 * Migrates exact key and any key that continues with `:` / `.` after the prefix
 * (e.g. `...v1:global`).
 */
export function migrateLocalStoragePrefix(legacyPrefix: string, newPrefix: string): void {
  if (!legacyPrefix || legacyPrefix === newPrefix) return;
  try {
    const legacyKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key === legacyPrefix) {
        legacyKeys.push(key);
        continue;
      }
      if (!key.startsWith(legacyPrefix)) continue;
      const rest = key.slice(legacyPrefix.length);
      if (rest.startsWith(":") || rest.startsWith(".")) legacyKeys.push(key);
    }
    for (const legacyKey of legacyKeys) {
      const newKey = `${newPrefix}${legacyKey.slice(legacyPrefix.length)}`;
      if (window.localStorage.getItem(newKey) != null) continue;
      const value = window.localStorage.getItem(legacyKey);
      if (value != null) window.localStorage.setItem(newKey, value);
    }
  } catch {
    // ignore unavailable storage
  }
}

export function loadLocalString(key: string, fallback = ""): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function saveLocalString(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // ignore unavailable storage
  }
}

export function loadLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveLocalJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore unavailable storage
  }
}

export function loadLocalBool(key: string, fallback = false): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

export function saveLocalBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore unavailable storage
  }
}
