import { mmkvGetString, mmkvSetString } from './mmkv';
import type { MobileChatMessage, MobileRenderedTurn } from '../types';

const CHAT_SNAPSHOT_KEY = 'giteam.mobile.chat-snapshot.v1';
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

type SnapshotMap = Record<string, ChatSnapshot>;

function snapshotKey(repoPath: string, sessionId: string): string {
  return `${repoPath}::${sessionId}`;
}

function readAll(): SnapshotMap {
  try {
    const raw = mmkvGetString(CHAT_SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SnapshotMap : {};
  } catch {
    return {};
  }
}

function writeAll(map: SnapshotMap): void {
  try {
    const raw = JSON.stringify(map);
    mmkvSetString(CHAT_SNAPSHOT_KEY, raw);
  } catch {
    // ignore snapshot write failures
  }
}

export function loadChatSnapshot(repoPath: string, sessionId: string): ChatSnapshot | null {
  const repo = String(repoPath || '').trim();
  const sid = String(sessionId || '').trim();
  if (!repo || !sid) return null;
  const map = readAll();
  const row = map[snapshotKey(repo, sid)];
  if (!row || !Array.isArray(row.messages) || !Array.isArray(row.renderedTurns)) return null;
  return row;
}

export function saveChatSnapshot(snapshot: ChatSnapshot): void {
  const repo = String(snapshot.repoPath || '').trim();
  const sid = String(snapshot.sessionId || '').trim();
  if (!repo || !sid || snapshot.renderedTurns.length === 0) return;
  const map = readAll();
  map[snapshotKey(repo, sid)] = { ...snapshot, repoPath: repo, sessionId: sid };
  const ordered = Object.entries(map).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0));
  writeAll(Object.fromEntries(ordered.slice(0, MAX_SNAPSHOTS)) as SnapshotMap);
}
