import { invoke } from "@tauri-apps/api/core";

export type CloudAccessKeyRecord = {
  id: string;
  name: string;
  accessKey: string;
  workspaceId: string;
  cloudBaseUrl: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  active: boolean;
};

export type CloudLinkStatus = {
  enabled: boolean;
  cloudBaseUrl: string;
  workspaceId: string;
  deviceId: string;
  deviceName: string;
  accessKey: string;
  keyName: string;
  tunnelRunning: boolean;
  accessKeys: CloudAccessKeyRecord[];
};

export type CloudQrPayload = {
  mode: "cloud";
  cloudBaseUrl: string;
  workspaceId: string;
  deviceId: string;
  accessKey: string;
};

/** Build-time / env default; open-source fallback is loopback. */
export function getDefaultCloudBaseUrl(): string {
  const fromEnv = String((import.meta as any).env?.VITE_DEFAULT_CLOUD_BASE_URL || "").trim();
  return (fromEnv || "http://127.0.0.1:8787").replace(/\/$/, "");
}

const INTERNAL_CLOUD_HOSTS = new Set(["giteam-cloud", "giteam-cloud-gateway", "localhost", "127.0.0.1"]);

/** Prefer public default when server/QR embeds an unreachable cluster URL. */
export function resolveReachableCloudBaseUrl(candidate: string, fallback = getDefaultCloudBaseUrl()): string {
  const raw = String(candidate || "").trim().replace(/\/$/, "");
  const fb = String(fallback || "").trim().replace(/\/$/, "");
  if (!raw) return fb;
  try {
    const host = new URL(raw.startsWith("http") ? raw : `http://${raw}`).hostname.toLowerCase();
    if (INTERNAL_CLOUD_HOSTS.has(host)) return fb || raw;
  } catch {
    return fb || raw;
  }
  return raw;
}

export async function getCloudStatus(): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_status");
}

export async function linkCloud(args?: {
  url?: string;
  accessKey?: string;
  name?: string;
  forceNew?: boolean;
  keyName?: string;
}): Promise<CloudLinkStatus> {
  const url = (args?.url?.trim() || getDefaultCloudBaseUrl()).replace(/\/$/, "");
  return invoke<CloudLinkStatus>("giteam_cloud_link", {
    url,
    accessKey: args?.accessKey ?? null,
    name: args?.name ?? null,
    forceNew: args?.forceNew ?? false,
    keyName: args?.keyName ?? null,
  });
}

export async function unlinkCloud(): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_unlink");
}

export async function forgetCloudKey(keyId: string): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_forget_key", { keyId });
}

export async function renameCloudKey(keyId: string, name: string): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_rename_key", { keyId, name });
}

export async function useCloudKey(accessKey: string): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_use_key", { accessKey });
}

export async function getCloudQrPayload(): Promise<CloudQrPayload> {
  return invoke<CloudQrPayload>("giteam_cloud_qr_payload");
}
