import { toText } from "../../lib/text";

export const INITIAL_SESSION_LIMIT = 1;
export const OLDER_SESSION_LIMIT = 1;
export const INITIAL_CELL_LIMIT = 6;
export const OLDER_CELL_LIMIT = 24;
export const HISTORY_PREFETCH_COOLDOWN_MS = 350;
export const CHAT_BOTTOM_PROXIMITY = 96;
/** 切换会话后延迟展示列表（与 swift-chat 手机端一致），避免看见布局/滚动过程 */
export const SESSION_LIST_REVEAL_DELAY_MS = 200;
export const CHAT_LIST_BOTTOM_AIR = 24;
export const INITIAL_MESSAGE_FETCH_LIMIT = 8;
export const OLDER_MESSAGE_FETCH_LIMIT = 8;
export const IMAGE_SEND_TIMEOUT_MS = 180000;

export type SessionItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

export function stableSortSessionItems(items: SessionItem[]): SessionItem[] {
  const deduped = new Map<string, SessionItem>();
  for (const item of items) {
    const id = toText(item.id).trim();
    if (!id) continue;
    const prev = deduped.get(id);
    if (!prev) {
      deduped.set(id, { ...item, id });
      continue;
    }
    deduped.set(id, {
      id,
      title: toText(item.title) || prev.title,
      preview: toText(item.preview) || prev.preview,
      updatedAt: Math.max(
        Number(prev.updatedAt) || 0,
        Number(item.updatedAt) || 0,
      ),
      createdAt:
        Number(prev.createdAt || 0) || Number(item.createdAt || 0) || undefined,
    });
  }

  return [...deduped.values()].sort((a, b) => {
    const ua = Number(a.updatedAt) || 0;
    const ub = Number(b.updatedAt) || 0;
    if (ub !== ua) return ub - ua;
    const ca = Number(a.createdAt || 0) || 0;
    const cb = Number(b.createdAt || 0) || 0;
    if (cb !== ca) return cb - ca;
    return a.id.localeCompare(b.id);
  });
}

export type ComposerAgentName = "build" | "plan";

export const COMPOSER_MODE_OPTIONS: Array<{
  key: ComposerAgentName;
  label: string;
}> = [
  { key: "build", label: "Build" },
  { key: "plan", label: "Plan" },
];

const STREAM_DEBUG = false;

export function streamDebug(label: string, payload?: Record<string, unknown>) {
  if (!STREAM_DEBUG) return;
  try {
    console.log(
      `[GiteamStream] ${label}`,
      payload ? JSON.stringify(payload) : "",
    );
  } catch {
    console.log(`[GiteamStream] ${label}`);
  }
}
