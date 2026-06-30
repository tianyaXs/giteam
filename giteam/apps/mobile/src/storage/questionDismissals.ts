import { mmkvGetString, mmkvSetString } from './mmkv';

const QUESTION_DISMISSALS_KEY = 'giteam.mobile.questionDismissals.v1';
const MAX_DISMISSALS = 500;

type StoredDismissal = {
  key: string;
  ts: number;
};

function storageKey(repoPath: string, sessionId: string, requestId: string): string {
  return `${repoPath.trim()}\n${sessionId.trim()}\n${requestId.trim()}`;
}

function readRaw(): string | undefined {
  return mmkvGetString(QUESTION_DISMISSALS_KEY);
}

function writeRaw(raw: string): void {
  mmkvSetString(QUESTION_DISMISSALS_KEY, raw);
}

export function loadQuestionDismissals(repoPath: string, sessionId: string): Set<string> {
  try {
    const raw = readRaw();
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? (parsed as StoredDismissal[]) : [];
    const prefix = `${repoPath.trim()}\n${sessionId.trim()}\n`;
    return new Set(rows.map((row) => row?.key || '').filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
  } catch {
    return new Set();
  }
}

export function saveQuestionDismissal(repoPath: string, sessionId: string, requestId: string): void {
  const key = storageKey(repoPath, sessionId, requestId);
  if (!repoPath.trim() || !sessionId.trim() || !requestId.trim()) return;
  try {
    const raw = readRaw();
    const parsed = raw ? JSON.parse(raw) : [];
    const rows = Array.isArray(parsed) ? (parsed as StoredDismissal[]) : [];
    const deduped = rows.filter((row) => row?.key && row.key !== key);
    deduped.push({ key, ts: Date.now() });
    deduped.sort((a, b) => b.ts - a.ts);
    writeRaw(JSON.stringify(deduped.slice(0, MAX_DISMISSALS)));
  } catch {
    // ignore persistence failures; question dismissal is only a UX cache.
  }
}
