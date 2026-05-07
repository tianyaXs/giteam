import type { HealthResponse, PairAuthResponse, PromptResponse, QuestionRequest, SessionStatusInfo } from '../types';
export const NO_AUTH_TOKEN = '__NO_AUTH__';

function normalizeBaseUrl(input: string): string {
  const raw = input.trim().replace(/\/$/, '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `http://${raw}`;
}

const REQUEST_TIMEOUT_MS = 12000;
/** 长会话单页 JSON 较大，12s 易误判为失败 */
const MESSAGES_REQUEST_TIMEOUT_MS = 90000;

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

export async function sendPrompt(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  parts?: { type: string; mime?: string; url?: string; filename?: string; text?: string }[];
}): Promise<PromptResponse> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/opencode/prompt`;
  const body: Record<string, unknown> = {
    repoPath: args.repoPath,
    prompt: args.prompt,
    sessionId: args.sessionId || undefined,
    model: args.model || undefined
  };
  if (args.parts && args.parts.length > 0) {
    body.parts = args.parts;
  }
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(args.token)
    },
    body: JSON.stringify(body)
  });
  const raw = ensureOk('prompt', 'POST', url, result.status, result.ok, result.text);
  return JSON.parse(raw) as PromptResponse;
}

export async function createSession(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  title?: string;
}): Promise<{ id: string; title: string; createdAt?: number; updatedAt?: number }> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/opencode/session`;
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(args.token)
    },
    body: JSON.stringify({
      repoPath: args.repoPath,
      title: args.title || undefined
    })
  });
  const raw = ensureOk('session.create', 'POST', url, result.status, result.ok, result.text);
  return JSON.parse(raw) as { id: string; title: string; createdAt?: number; updatedAt?: number };
}

export async function getMessages(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  sessionId: string;
  limit?: number;
  before?: string;
}): Promise<{ items: any[]; nextCursor: string }> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const params = new URLSearchParams({
    repoPath: args.repoPath,
    sessionId: args.sessionId
  });
  if (typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0) {
    params.set('limit', String(Math.floor(args.limit)));
  }
  if (typeof args.before === 'string' && args.before.trim()) {
    params.set('before', args.before.trim());
  }
  const url = `${baseUrl}/api/v1/opencode/messages?${params.toString()}`;
  const result = await fetchTextWithTrace(
    url,
    {
      headers: authHeaders(args.token)
    },
    MESSAGES_REQUEST_TIMEOUT_MS
  );
  const raw = ensureOk('messages', 'GET', url, result.status, result.ok, result.text);
  // 服务端历史/兼容：可能直接返回数组（无 nextCursor），也可能返回 { items, nextCursor }
  // 另外某些实现会返回 nextCursor: null，需要归一化成 ''，避免上层误判。
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { items: parsed, nextCursor: '' };
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const nextCursor = parsed?.nextCursor == null ? '' : String(parsed?.nextCursor || '').trim();
  return { items, nextCursor };
}

export async function getSessions(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  limit?: number;
}): Promise<Array<{ id: string; title: string; createdAt?: number; updatedAt?: number }>> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const params = new URLSearchParams({
    repoPath: args.repoPath
  });
  if (typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0) {
    params.set('limit', String(Math.floor(args.limit)));
  }
  const url = `${baseUrl}/api/v1/opencode/session?${params.toString()}`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('sessions', 'GET', url, result.status, result.ok, result.text);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((x: any) => ({
      id: String(x?.id || '').trim(),
      title: String(x?.title || '').trim(),
      createdAt: Number(x?.createdAt || 0) || undefined,
      updatedAt: Number(x?.updatedAt || 0) || undefined
    }))
    .filter((x: any) => x.id);
}

export async function getSessionStatus(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
}): Promise<Record<string, SessionStatusInfo>> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const params = new URLSearchParams({
    repoPath: args.repoPath
  });
  const url = `${baseUrl}/api/v1/opencode/session/status?${params.toString()}`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('session.status', 'GET', url, result.status, result.ok, result.text);
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, SessionStatusInfo>;
}

export async function getOpencodeCommands(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
}): Promise<any[]> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/command?directory=${encodeURIComponent(args.repoPath)}`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('command.list', 'GET', url, result.status, result.ok, result.text);
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export async function getOpencodeConfig(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
}): Promise<any> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const params = new URLSearchParams({
    repoPath: args.repoPath
  });
  const url = `${baseUrl}/api/v1/opencode/config?${params.toString()}`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('config', 'GET', url, result.status, result.ok, result.text);
  return JSON.parse(raw);
}

export type OpencodeProjectItem = {
  id: string;
  worktree: string;
  vcs?: string;
  createdAt?: number;
  updatedAt?: number;
};

export async function getCurrentProject(args: {
  baseUrl: string;
  token: string;
}): Promise<OpencodeProjectItem | null> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/opencode/project/current`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('project.current', 'GET', url, result.status, result.ok, result.text);
  const parsed = JSON.parse(raw);
  const worktree = String(parsed?.worktree || '').trim();
  if (!worktree) return null;
  return {
    id: String(parsed?.id || '').trim(),
    worktree,
    vcs: String(parsed?.vcs || '').trim() || undefined,
    createdAt: Number(parsed?.time?.created || 0) || undefined,
    updatedAt: Number(parsed?.time?.updated || 0) || undefined
  };
}

export async function getProjects(args: {
  baseUrl: string;
  token: string;
}): Promise<OpencodeProjectItem[]> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/opencode/project`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('project.list', 'GET', url, result.status, result.ok, result.text);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((x: any) => ({
      id: String(x?.id || '').trim(),
      worktree: String(x?.worktree || '').trim(),
      vcs: String(x?.vcs || '').trim() || undefined,
      createdAt: Number(x?.time?.created || 0) || undefined,
      updatedAt: Number(x?.time?.updated || 0) || undefined
    }))
    .filter((x: OpencodeProjectItem) => x.worktree);
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

export async function abortSession(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  sessionId: string;
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/opencode/abort`;
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(args.token)
    },
    body: JSON.stringify({
      repoPath: args.repoPath,
      sessionId: args.sessionId
    })
  });
  ensureOk('abort', 'POST', url, result.status, result.ok, result.text);
}

export async function replyQuestion(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  requestId: string;
  answers: string[][];
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/opencode/question/${encodeURIComponent(args.requestId)}/reply`;
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(args.token)
    },
    body: JSON.stringify({
      repoPath: args.repoPath,
      answers: args.answers
    })
  });
  ensureOk('question.reply', 'POST', url, result.status, result.ok, result.text);
}

export async function rejectQuestion(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  requestId: string;
}): Promise<void> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const url = `${baseUrl}/api/v1/opencode/question/${encodeURIComponent(args.requestId)}/reject`;
  const result = await fetchTextWithTrace(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(args.token)
    },
    body: JSON.stringify({
      repoPath: args.repoPath
    })
  });
  ensureOk('question.reject', 'POST', url, result.status, result.ok, result.text);
}

export async function getPendingQuestions(args: {
  baseUrl: string;
  token: string;
  repoPath: string;
  sessionId?: string;
}): Promise<QuestionRequest[]> {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const params = new URLSearchParams({ repoPath: args.repoPath });
  if (args.sessionId) {
    params.append('sessionId', args.sessionId);
  }
  const url = `${baseUrl}/api/v1/opencode/question?${params.toString()}`;
  const result = await fetchTextWithTrace(url, {
    headers: authHeaders(args.token)
  });
  const raw = ensureOk('question.list', 'GET', url, result.status, result.ok, result.text);
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows as QuestionRequest[];
}

export function buildStreamUrl(args: {
  baseUrl: string;
  repoPath: string;
  sessionId: string;
  intervalMs?: number;
}): string {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const params = new URLSearchParams({
    repoPath: args.repoPath,
    sessionId: args.sessionId,
    intervalMs: String(args.intervalMs ?? 700)
  });
  return `${baseUrl}/api/v1/opencode/stream?${params.toString()}`;
}
