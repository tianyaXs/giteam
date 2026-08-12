import { getConnectionMode } from '../connectionContext';

export type AgentApiError = Error & {
  status?: number;
  code?: string;
  body?: unknown;
};

/** Only hard auth failures should force logout. Device/tunnel offline is recoverable. */
const CLOUD_SESSION_INVALID_CODES = new Set([
  'token_expired',
  'token_revoked',
  'unauthorized',
  'invalid_access_key'
]);

export function createAgentApiError(
  status: number,
  value: unknown,
  fallback: string
): AgentApiError {
  let code = '';
  let message = fallback;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    if (typeof row.code === 'string' && row.code.trim()) code = row.code.trim();
    if (typeof row.message === 'string' && row.message.trim()) message = row.message.trim();
    else if (typeof row.error === 'string' && row.error.trim()) message = row.error.trim();
  }
  const err = new Error(message || fallback) as AgentApiError;
  err.status = status;
  err.code = code || undefined;
  err.body = value;
  return err;
}

export function getAgentApiErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const code = (error as AgentApiError).code;
  return typeof code === 'string' ? code.trim() : '';
}

export function getAgentApiErrorStatus(error: unknown): number {
  if (!error || typeof error !== 'object') return 0;
  const status = (error as AgentApiError).status;
  return typeof status === 'number' ? status : 0;
}

/** Cloud-mode failures that mean the current login session is no longer usable. */
export function isCloudSessionInvalidError(error: unknown): boolean {
  if (getConnectionMode() !== 'cloud') return false;
  const code = getAgentApiErrorCode(error);
  if (code && CLOUD_SESSION_INVALID_CODES.has(code)) return true;
  const status = getAgentApiErrorStatus(error);
  // 401 = auth dead. 503/504 device/tunnel offline should stay logged in with an error toast.
  return status === 401;
}

export function cloudSessionInvalidReason(error: unknown): string {
  const code = getAgentApiErrorCode(error);
  if (code === 'token_expired' || code === 'token_revoked' || code === 'unauthorized') {
    return '云端授权已失效，请重新连接';
  }
  if (code === 'invalid_access_key') {
    return '连接密钥无效，请重新填写';
  }
  return '云端连接已失效，请重新登录';
}

type InvalidationHandler = (reason: string) => void;

let invalidationHandler: InvalidationHandler | null = null;
let lastInvalidationAt = 0;

export function setCloudSessionInvalidationHandler(handler: InvalidationHandler | null) {
  invalidationHandler = handler;
}

/** Notify once per short window so parallel 503s don't thrash UI. */
export function notifyCloudSessionInvalidation(error: unknown) {
  if (!isCloudSessionInvalidError(error)) return;
  const now = Date.now();
  if (now - lastInvalidationAt < 1500) return;
  lastInvalidationAt = now;
  invalidationHandler?.(cloudSessionInvalidReason(error));
}
