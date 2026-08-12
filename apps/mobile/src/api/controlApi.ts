import type { HealthResponse, PairAuthResponse } from '../types';
import { getActiveDeviceId } from './connectionContext';
export const NO_AUTH_TOKEN = '__NO_AUTH__';

function normalizeBaseUrl(input: string): string {
  const raw = input.trim().replace(/\/$/, '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `http://${raw}`;
}

const REQUEST_TIMEOUT_MS = 12000;

function authHeaders(token: string): Record<string, string> {
  const tk = String(token || '').trim();
  const headers: Record<string, string> = {};
  if (tk && tk !== NO_AUTH_TOKEN) headers.Authorization = `Bearer ${tk}`;
  const deviceId = getActiveDeviceId();
  if (deviceId) headers['X-Giteam-Device-Id'] = deviceId;
  return headers;
}

function describeNetworkError(err: unknown, timeoutMs?: number): string {
  const name = (err as any)?.name ? String((err as any).name) : '';
  const message = (err as any)?.message ? String((err as any).message) : String(err || 'unknown error');
  if (name === 'AbortError') return `timeout after ${timeoutMs ?? REQUEST_TIMEOUT_MS}ms`;
  if (/Network request failed/i.test(message)) {
    return `${message} (possible: LAN unreachable / HTTP cleartext blocked / firewall / wrong IP)`;
  }
  return `${name ? `${name}: ` : ''}${message}`;
}

async function fetchTextWithTrace(
  url: string,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<{ status: number; ok: boolean; text: string }> {
  const method = String(init?.method || 'GET').toUpperCase();
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : REQUEST_TIMEOUT_MS;
  const timeout = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    const res = await fetch(url, {
      ...(init || {}),
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (e) {
    throw new Error(`[${method}] ${url} -> ${describeNetworkError(e, ms)}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function ensureOk(label: string, method: string, url: string, status: number, ok: boolean, raw: string): string {
  if (ok) return raw;
  const compact = raw.length > 2000 ? `${raw.slice(0, 2000)}...` : raw;
  throw new Error(`${label} failed: HTTP ${status} [${method}] ${url} ${compact}`);
}

export async function health(baseUrlInput: string): Promise<HealthResponse> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const url = `${baseUrl}/api/v1/health`;
  const result = await fetchTextWithTrace(url, { method: 'GET' });
  const raw = ensureOk('health', 'GET', url, result.status, result.ok, result.text);
  return JSON.parse(raw) as HealthResponse;
}

export async function pairAuth(baseUrlInput: string, code: string): Promise<PairAuthResponse> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const url = `${baseUrl}/api/v1/auth/pair`;
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() })
  });
  const raw = ensureOk('pair', 'POST', url, result.status, result.ok, result.text);
  return JSON.parse(raw) as PairAuthResponse;
}

export type CloudDeviceInfo = {
  id: string;
  name: string;
  online: boolean;
  clientVersion?: string;
};

export type CloudRedeemResponse = {
  workspaceId: string;
  deviceId: string;
  token: string;
  tokenType?: string;
  expiresAt?: number;
  devices: CloudDeviceInfo[];
};

export type CloudRedeemError = Error & {
  code?: string;
  devices?: CloudDeviceInfo[];
};

export async function redeemCloudAccess(args: {
  cloudBaseUrl: string;
  accessKey: string;
  deviceId?: string;
  clientName?: string;
}): Promise<CloudRedeemResponse> {
  const baseUrl = normalizeBaseUrl(args.cloudBaseUrl);
  const url = `${baseUrl}/cloud/v1/auth/redeem`;
  const body: Record<string, string> = { accessKey: args.accessKey.trim() };
  const deviceId = String(args.deviceId || '').trim();
  if (deviceId) body.deviceId = deviceId;
  const clientName = String(args.clientName || '').trim();
  if (clientName) body.clientName = clientName;
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!result.ok) {
    let code = 'redeem_failed';
    let message = result.text;
    let devices: CloudDeviceInfo[] | undefined;
    try {
      const parsed = JSON.parse(result.text);
      code = String(parsed?.code || code);
      message = String(parsed?.message || message);
      if (Array.isArray(parsed?.devices)) {
        devices = parsed.devices.map((d: any) => ({
          id: String(d?.id || '').trim(),
          name: String(d?.name || '').trim(),
          online: Boolean(d?.online),
          clientVersion: String(d?.clientVersion || '').trim() || undefined
        })).filter((d: CloudDeviceInfo) => d.id);
      }
    } catch {
      // keep raw
    }
    const err = new Error(message || `redeem failed: HTTP ${result.status}`) as CloudRedeemError;
    err.code = code;
    err.devices = devices;
    throw err;
  }
  const parsed = JSON.parse(result.text);
  return {
    workspaceId: String(parsed?.workspaceId || '').trim(),
    deviceId: String(parsed?.deviceId || '').trim(),
    token: String(parsed?.token || '').trim(),
    tokenType: String(parsed?.tokenType || 'Bearer'),
    expiresAt: typeof parsed?.expiresAt === 'number' ? parsed.expiresAt : undefined,
    devices: Array.isArray(parsed?.devices)
      ? parsed.devices.map((d: any) => ({
          id: String(d?.id || '').trim(),
          name: String(d?.name || '').trim(),
          online: Boolean(d?.online),
          clientVersion: String(d?.clientVersion || '').trim() || undefined
        })).filter((d: CloudDeviceInfo) => d.id)
      : []
  };
}

export async function cloudHeartbeat(args: {
  cloudBaseUrl: string;
  token: string;
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(args.cloudBaseUrl);
  const url = `${baseUrl}/cloud/v1/auth/heartbeat`;
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...authHeaders(args.token)
    }
  });
  if (!result.ok) {
    const err = new Error(`heartbeat failed: HTTP ${result.status}`) as CloudRedeemError;
    try {
      const parsed = JSON.parse(result.text);
      err.code = String(parsed?.code || '');
      err.message = String(parsed?.message || err.message);
    } catch {
      // keep
    }
    throw err;
  }
}

export async function getClientRepositories(args: {
  baseUrl: string;
  token: string;
}): Promise<Array<{ id: string; path: string; name?: string; addedAt?: string }>> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/repository/list`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('repository.list', 'GET', url, result.status, result.ok, result.text);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((x: any) => ({
      id: String(x?.id || '').trim(),
      path: String(x?.path || '').trim(),
      name: String(x?.name || '').trim() || undefined,
      addedAt: String(x?.addedAt || '').trim() || undefined
    }))
    .filter((x: any) => x.path);
}
