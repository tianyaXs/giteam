export type ControlPairCodeMode = "none" | "24h" | "7d" | "forever";
export type ControlAuthMode = "none" | "pair_code";

export type ControlServerSettings = {
  enabled: boolean;
  host: string;
  port: number;
  publicBaseUrl: string;
  authMode: ControlAuthMode;
  pairCodeTtlMode: ControlPairCodeMode;
};

export type ControlPairCodeInfo = {
  code: string;
  expiresAt: number;
  ttlSeconds: number;
};

export type ControlAccessInfo = {
  enabled: boolean;
  host: string;
  port: number;
  publicBaseUrl: string;
  pairCode: string;
  expiresAt: number;
  localUrls: string[];
  pairCodeTtlMode?: string;
  noAuth?: boolean;
};

export type GiteamMobileServiceStatus = {
  cliInstalled: boolean;
  enabled: boolean;
  port: number;
  running: boolean;
};

export const DEFAULT_CONTROL_SERVER_SETTINGS: ControlServerSettings = {
  enabled: false,
  host: "0.0.0.0",
  port: 4100,
  publicBaseUrl: "",
  authMode: "pair_code",
  pairCodeTtlMode: "24h"
};

export function normalizeControlPairMode(raw: unknown): ControlPairCodeMode {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "none" || value === "24h" || value === "7d" || value === "forever") return value;
  return "24h";
}

export function normalizeControlAuthMode(raw: unknown): ControlAuthMode {
  return String(raw || "").trim().toLowerCase() === "none" ? "none" : "pair_code";
}

export function resolveControlPairCodeMode(
  settings: Pick<ControlServerSettings, "authMode" | "pairCodeTtlMode">
): ControlPairCodeMode {
  return settings.authMode === "none" ? "none" : normalizeControlPairMode(settings.pairCodeTtlMode);
}

export function normalizeControlPublicBaseUrl(raw: unknown): string {
  let publicBaseUrl = String(raw || "").trim().replace(/\/+$/, "");
  if (publicBaseUrl && !/^https?:\/\//i.test(publicBaseUrl)) {
    publicBaseUrl = `http://${publicBaseUrl}`;
  }
  if (!publicBaseUrl) return "";
  const parsed = new URL(publicBaseUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

export function normalizeControlServerSettings(
  settings: Partial<ControlServerSettings> | null | undefined,
  fallback: ControlServerSettings = DEFAULT_CONTROL_SERVER_SETTINGS
): ControlServerSettings {
  const rawPairMode = normalizeControlPairMode(settings?.pairCodeTtlMode);
  const authMode = settings?.authMode == null
    ? (rawPairMode === "none" ? "none" : fallback.authMode)
    : normalizeControlAuthMode(settings.authMode);
  const pairCodeTtlMode = authMode === "none"
    ? "none"
    : (rawPairMode === "none" ? fallback.pairCodeTtlMode : rawPairMode);

  return {
    enabled: Boolean(settings?.enabled),
    host: (settings?.host || fallback.host).trim() || fallback.host,
    port: Number(settings?.port) > 0 ? Number(settings?.port) : fallback.port,
    publicBaseUrl: String(settings?.publicBaseUrl || "").trim().replace(/\/+$/, ""),
    authMode,
    pairCodeTtlMode
  };
}

export function controlServerSettingsChanged(
  current: ControlServerSettings,
  saved: ControlServerSettings
): boolean {
  return (
    current.enabled !== saved.enabled ||
    Number(current.port) !== Number(saved.port) ||
    current.authMode !== saved.authMode ||
    current.pairCodeTtlMode !== saved.pairCodeTtlMode ||
    String(current.publicBaseUrl || "").trim().replace(/\/+$/, "") !==
      String(saved.publicBaseUrl || "").trim().replace(/\/+$/, "")
  );
}
