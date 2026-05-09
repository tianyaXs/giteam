import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { MobileChatMessage, MobileRenderedTurn } from '../types';

const CHAT_SNAPSHOT_KEY = 'giteam.mobile.chat-snapshot.v1';
const MAX_SNAPSHOTS = 8;

export type ChatSnapshot = {
  repoPath: string;
  sessionId: string;
  messages: MobileChatMessage[];
  renderedTurns: MobileRenderedTurn[];
  updatedAt: number;
};

type SnapshotMap = Record<string, ChatSnapshot>;

function snapshotKey(repoPath: string, sessionId: string): string {
  return `${repoPath}::${sessionId}`;
}

async function readAll(): Promise<SnapshotMap> {
  try {
    const raw = Platform.OS === 'web'
      ? window.localStorage.getItem(CHAT_SNAPSHOT_KEY)
      : await AsyncStorage.getItem(CHAT_SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SnapshotMap : {};
  } catch {
    return {};
  }
}

async function writeAll(map: SnapshotMap): Promise<void> {
  try {
    const raw = JSON.stringify(map);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(CHAT_SNAPSHOT_KEY, raw);
      return;
    }
    await AsyncStorage.setItem(CHAT_SNAPSHOT_KEY, raw);
  } catch {
    // ignore snapshot write failures
  }
}

export async function loadChatSnapshot(repoPath: string, sessionId: string): Promise<ChatSnapshot | null> {
  const repo = String(repoPath || '').trim();
  const sid = String(sessionId || '').trim();
  if (!repo || !sid) return null;
  const map = await readAll();
  const row = map[snapshotKey(repo, sid)];
  if (!row || !Array.isArray(row.messages) || !Array.isArray(row.renderedTurns)) return null;
  return row;
}

export async function saveChatSnapshot(snapshot: ChatSnapshot): Promise<void> {
  const repo = String(snapshot.repoPath || '').trim();
  const sid = String(snapshot.sessionId || '').trim();
  if (!repo || !sid || snapshot.renderedTurns.length === 0) return;
  const map = await readAll();
  map[snapshotKey(repo, sid)] = { ...snapshot, repoPath: repo, sessionId: sid };
  const ordered = Object.entries(map).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0));
  await writeAll(Object.fromEntries(ordered.slice(0, MAX_SNAPSHOTS)) as SnapshotMap);
}
