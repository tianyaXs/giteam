import type { HealthResponse, PairAuthResponse } from '../types';
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
  if (!tk || tk === NO_AUTH_TOKEN) return {};
  return { Authorization: `Bearer ${tk}` };
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
