import { mmkvDelete, mmkvGetString, mmkvSetString } from './mmkv';
import type { MobileChatMessage, MobileRenderedTurn } from '../types';

const CHAT_SNAPSHOT_INDEX_KEY = 'giteam.mobile.chat-snapshot.v2.index';
const CHAT_SNAPSHOT_PREFIX = 'giteam.mobile.chat-snapshot.v2';
const LEGACY_CHAT_SNAPSHOT_KEY = 'giteam.mobile.chat-snapshot.v1';
const MAX_SNAPSHOTS = 16;

export type ChatSnapshot = {
  repoPath: string;
  sessionId: string;
  rawRows?: any[];
  nextCursor?: string;
  visibleTurnCount?: number;
  totalTurnCount?: number;
  messages: MobileChatMessage[];
  renderedTurns: MobileRenderedTurn[];
  updatedAt: number;
};

type SnapshotIndexRow = {
  key: string;
  updatedAt: number;
};

function snapshotKey(repoPath: string, sessionId: string): string {
  return `${repoPath}::${sessionId}`;
}

function snapshotStorageKey(repoPath: string, sessionId: string): string {
  return `${CHAT_SNAPSHOT_PREFIX}::${snapshotKey(repoPath, sessionId)}`;
}

function readIndex(): SnapshotIndexRow[] {
  try {
    const raw = mmkvGetString(CHAT_SNAPSHOT_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        key: String(item.key || '').trim(),
        updatedAt: Number(item.updatedAt || 0)
      }))
      .filter((item) => !!item.key);
  } catch {
    return [];
  }
}

function writeIndex(rows: SnapshotIndexRow[]): void {
  try {
    const raw = JSON.stringify(rows);
    mmkvSetString(CHAT_SNAPSHOT_INDEX_KEY, raw);
  } catch {
    // ignore snapshot write failures
  }
}

export function loadChatSnapshot(repoPath: string, sessionId: string): ChatSnapshot | null {
  const repo = String(repoPath || '').trim();
  const sid = String(sessionId || '').trim();
  if (!repo || !sid) return null;

  try {
    const raw = mmkvGetString(snapshotStorageKey(repo, sid));
    if (!raw) return null;
    const row = JSON.parse(raw);
    if (!row || !Array.isArray(row.messages) || !Array.isArray(row.renderedTurns)) return null;
    return row as ChatSnapshot;
  } catch {
    return null;
  }
}

export function saveChatSnapshot(snapshot: ChatSnapshot): void {
  const repo = String(snapshot.repoPath || '').trim();
  const sid = String(snapshot.sessionId || '').trim();
  if (!repo || !sid || snapshot.renderedTurns.length === 0) return;

  const storageKey = snapshotStorageKey(repo, sid);
  const nextSnapshot = { ...snapshot, repoPath: repo, sessionId: sid };

  try {
    mmkvSetString(storageKey, JSON.stringify(nextSnapshot));

    const prevIndex = readIndex();

    const nextIndex = [
      { key: storageKey, updatedAt: Number(nextSnapshot.updatedAt || Date.now()) },
      ...prevIndex.filter((item) => item.key !== storageKey)
    ]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SNAPSHOTS);

    writeIndex(nextIndex);

    const keep = new Set(nextIndex.map((item) => item.key));
    prevIndex
      .filter((item) => !keep.has(item.key))
      .forEach((item) => mmkvDelete(item.key));

    mmkvDelete(LEGACY_CHAT_SNAPSHOT_KEY);
  } catch {
    // ignore snapshot write failures
  }
}
