const TOKEN_KEY = "giteam.cloud.adminToken";
const GATEWAY_KEY = "giteam.cloud.gatewayUrl";

export function getAdminToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setAdminToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

/** Empty string = same-origin（Gateway 托管控制台时）。 */
export function getGatewayUrl(): string {
  return (localStorage.getItem(GATEWAY_KEY) || "").replace(/\/$/, "");
}

export function setGatewayUrl(url: string) {
  localStorage.setItem(GATEWAY_KEY, url.trim().replace(/\/$/, ""));
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getGatewayUrl();
  const token = getAdminToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export type Metrics = {
  workspaceCount: number;
  deviceCount: number;
  onlineDeviceCount: number;
};

export type AdminDevice = {
  id: string;
  workspaceId: string;
  name: string;
  clientVersion: string;
  status: string;
  online: boolean;
  lastSeenAt?: string;
  createdAt: string;
};

export type WorkspaceItem = {
  id: string;
  status: string;
  accessKeyId: string;
  defaultDeviceId?: string | null;
  createdAt: string;
};

export type WorkspaceDevice = {
  id: string;
  name: string;
  online: boolean;
  clientVersion?: string;
};

export type WorkspaceDetail = {
  id: string;
  status: string;
  accessKeyId: string;
  defaultDeviceId?: string | null;
  devices: WorkspaceDevice[];
};
