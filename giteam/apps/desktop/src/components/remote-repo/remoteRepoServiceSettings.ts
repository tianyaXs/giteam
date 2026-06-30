import { invoke, IS_TAURI } from "../../lib/platform";
import { normalizeRemoteRepoServiceUrl, resolveRemoteRepoServiceBase } from "./remoteRepoServiceUrl";

const REMOTE_REPO_SERVICE_URL_KEY = "giteam.remote-repo.service-url.v1";
const REMOTE_REPO_SERVICE_API_KEY = "giteam.remote-repo.service-api-key.v1";

export type RemoteRepoServiceSetting = {
  configuredUrl: string;
  effectiveUrl: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  source: "setting" | "environment" | "proxy" | "default";
};

export type RemoteRepoServiceCheck = {
  serviceUrl: string;
  repoCount: number;
};

export { normalizeRemoteRepoServiceUrl, resolveRemoteRepoServiceBase } from "./remoteRepoServiceUrl";

function readWebConfiguredUrl(): string {
  try {
    return normalizeRemoteRepoServiceUrl(window.localStorage.getItem(REMOTE_REPO_SERVICE_URL_KEY) || "");
  } catch {
    return "";
  }
}

function writeWebConfiguredUrl(value: string): void {
  try {
    if (value) window.localStorage.setItem(REMOTE_REPO_SERVICE_URL_KEY, value);
    else window.localStorage.removeItem(REMOTE_REPO_SERVICE_URL_KEY);
  } catch {
    // The browser can still use its environment/proxy fallback when storage is unavailable.
  }
}

function readWebApiKey(): string {
  try {
    return window.localStorage.getItem(REMOTE_REPO_SERVICE_API_KEY) || "";
  } catch {
    return "";
  }
}

function writeWebApiKey(value: string): void {
  try {
    if (value) window.localStorage.setItem(REMOTE_REPO_SERVICE_API_KEY, value);
    else window.localStorage.removeItem(REMOTE_REPO_SERVICE_API_KEY);
  } catch {
    // The browser can still talk to unauthenticated local services.
  }
}

function webEnvironmentUrl(): string {
  return import.meta.env.VITE_REMOTE_REPO_SERVICE_URL || "";
}

function webEnvironmentApiKey(): string {
  return import.meta.env.VITE_REMOTE_REPO_SERVICE_API_KEY || "";
}

export function getWebRemoteRepoServiceBase(): string {
  return resolveRemoteRepoServiceBase(readWebConfiguredUrl(), webEnvironmentUrl());
}

export function getWebRemoteRepoServiceApiKey(): string {
  return readWebApiKey() || webEnvironmentApiKey();
}

export async function loadRemoteRepoServiceSetting(): Promise<RemoteRepoServiceSetting> {
  if (IS_TAURI) {
    return invoke<RemoteRepoServiceSetting>("remote_repo", { action: "get_service_url", payload: {} });
  }
  const configuredUrl = readWebConfiguredUrl();
  const environmentUrl = normalizeRemoteRepoServiceUrl(webEnvironmentUrl());
  const apiKey = getWebRemoteRepoServiceApiKey();
  return {
    configuredUrl,
    effectiveUrl: resolveRemoteRepoServiceBase(configuredUrl, environmentUrl),
    apiKey,
    apiKeyConfigured: Boolean(apiKey),
    source: configuredUrl ? "setting" : environmentUrl ? "environment" : "proxy",
  };
}

async function checkWebServiceUrl(serviceUrl: string, apiKey: string): Promise<RemoteRepoServiceCheck> {
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers["X-API-Key"] = apiKey.trim();
  const response = await fetch(`${serviceUrl}/v1/dashboard`, { method: "GET", headers });
  const payload = await response.json().catch(() => ({})) as { repos?: unknown; detail?: string };
  if (!response.ok) throw new Error(payload.detail || `服务返回 HTTP ${response.status}`);
  return {
    serviceUrl,
    repoCount: Array.isArray(payload.repos) ? payload.repos.length : 0,
  };
}

export async function testRemoteRepoServiceUrl(raw: string, apiKey = getWebRemoteRepoServiceApiKey()): Promise<RemoteRepoServiceCheck> {
  const serviceUrl = normalizeRemoteRepoServiceUrl(raw);
  const effectiveUrl = serviceUrl || getWebRemoteRepoServiceBase();
  if (IS_TAURI) {
    return invoke<RemoteRepoServiceCheck>("remote_repo", {
      action: "test_service_url",
      payload: { serviceUrl: effectiveUrl, apiKey },
    });
  }
  return checkWebServiceUrl(effectiveUrl, apiKey);
}

export async function saveRemoteRepoServiceUrl(raw: string, apiKey = getWebRemoteRepoServiceApiKey()): Promise<RemoteRepoServiceSetting & RemoteRepoServiceCheck> {
  const configuredUrl = normalizeRemoteRepoServiceUrl(raw);
  if (IS_TAURI) {
    return invoke<RemoteRepoServiceSetting & RemoteRepoServiceCheck>("remote_repo", {
      action: "set_service_url",
      payload: { serviceUrl: configuredUrl, apiKey },
    });
  }
  if (!configuredUrl) {
    writeWebConfiguredUrl("");
    writeWebApiKey(apiKey.trim());
    const effectiveUrl = resolveRemoteRepoServiceBase("", webEnvironmentUrl());
    return {
      configuredUrl: "",
      effectiveUrl,
      apiKey: apiKey.trim(),
      apiKeyConfigured: Boolean(apiKey.trim()),
      source: webEnvironmentUrl() ? "environment" : "proxy",
      serviceUrl: effectiveUrl,
      repoCount: 0,
    };
  }
  const checked = await checkWebServiceUrl(resolveRemoteRepoServiceBase(configuredUrl, webEnvironmentUrl()), apiKey);
  writeWebConfiguredUrl(configuredUrl);
  writeWebApiKey(apiKey.trim());
  return {
    configuredUrl,
    effectiveUrl: checked.serviceUrl,
    apiKey: apiKey.trim(),
    apiKeyConfigured: Boolean(apiKey.trim()),
    source: configuredUrl ? "setting" : webEnvironmentUrl() ? "environment" : "proxy",
    ...checked,
  };
}
