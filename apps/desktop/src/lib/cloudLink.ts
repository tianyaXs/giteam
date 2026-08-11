import { invoke } from "@tauri-apps/api/core";

export type CloudLinkStatus = {
  enabled: boolean;
  cloudBaseUrl: string;
  workspaceId: string;
  deviceId: string;
  deviceName: string;
  accessKey: string;
  tunnelRunning: boolean;
};

export type CloudQrPayload = {
  mode: "cloud";
  cloudBaseUrl: string;
  workspaceId: string;
  deviceId: string;
  accessKey: string;
};

export async function getCloudStatus(): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_status");
}

export async function linkCloud(args?: {
  url?: string;
  accessKey?: string;
  name?: string;
}): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_link", {
    url: args?.url ?? null,
    accessKey: args?.accessKey ?? null,
    name: args?.name ?? null,
  });
}

export async function unlinkCloud(): Promise<CloudLinkStatus> {
  return invoke<CloudLinkStatus>("giteam_cloud_unlink");
}

export async function getCloudQrPayload(): Promise<CloudQrPayload> {
  return invoke<CloudQrPayload>("giteam_cloud_qr_payload");
}
