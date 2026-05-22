export type ControlPairCodeMode = "none" | "24h" | "7d" | "forever";

export type ControlServerSettings = {
  enabled: boolean;
  host: string;
  port: number;
  publicBaseUrl: string;
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
  pairCodeTtlMode: "24h"
};

export function normalizeControlPairMode(raw: unknown): ControlPairCodeMode {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "none" || value === "24h" || value === "7d" || value === "forever") return value;
  return "24h";
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
  return {
    enabled: Boolean(settings?.enabled),
    host: (settings?.host || fallback.host).trim() || fallback.host,
    port: Number(settings?.port) > 0 ? Number(settings?.port) : fallback.port,
    publicBaseUrl: String(settings?.publicBaseUrl || "").trim().replace(/\/+$/, ""),
    pairCodeTtlMode: normalizeControlPairMode(settings?.pairCodeTtlMode)
  };
}

export function controlServerSettingsChanged(
  current: ControlServerSettings,
  saved: ControlServerSettings
): boolean {
  return (
    current.enabled !== saved.enabled ||
    Number(current.port) !== Number(saved.port) ||
    current.pairCodeTtlMode !== saved.pairCodeTtlMode ||
    String(current.publicBaseUrl || "").trim().replace(/\/+$/, "") !==
      String(saved.publicBaseUrl || "").trim().replace(/\/+$/, "")
  );
}
