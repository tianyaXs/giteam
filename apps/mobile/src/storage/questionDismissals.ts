import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const QUESTION_DISMISSALS_KEY = 'giteam.mobile.questionDismissals.v1';
const MAX_DISMISSALS = 500;

type StoredDismissal = {
  key: string;
  ts: number;
};

function storageKey(repoPath: string, sessionId: string, requestId: string): string {
  return `${repoPath.trim()}\n${sessionId.trim()}\n${requestId.trim()}`;
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return window.localStorage.getItem(QUESTION_DISMISSALS_KEY);
  return await AsyncStorage.getItem(QUESTION_DISMISSALS_KEY);
}

async function writeRaw(raw: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(QUESTION_DISMISSALS_KEY, raw);
    return;
  }
  await AsyncStorage.setItem(QUESTION_DISMISSALS_KEY, raw);
}

export async function loadQuestionDismissals(repoPath: string, sessionId: string): Promise<Set<string>> {
  try {
    const raw = await readRaw();
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? (parsed as StoredDismissal[]) : [];
    const prefix = `${repoPath.trim()}\n${sessionId.trim()}\n`;
    return new Set(rows.map((row) => row?.key || '').filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
  } catch {
    return new Set();
  }
}

export async function saveQuestionDismissal(repoPath: string, sessionId: string, requestId: string): Promise<void> {
  const key = storageKey(repoPath, sessionId, requestId);
  if (!repoPath.trim() || !sessionId.trim() || !requestId.trim()) return;
  try {
    const raw = await readRaw();
    const parsed = raw ? JSON.parse(raw) : [];
    const rows = Array.isArray(parsed) ? (parsed as StoredDismissal[]) : [];
    const deduped = rows.filter((row) => row?.key && row.key !== key);
    deduped.push({ key, ts: Date.now() });
    deduped.sort((a, b) => b.ts - a.ts);
    await writeRaw(JSON.stringify(deduped.slice(0, MAX_DISMISSALS)));
  } catch {
    // ignore persistence failures; question dismissal is only a UX cache.
  }
}
