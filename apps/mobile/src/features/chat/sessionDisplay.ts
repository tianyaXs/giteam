import { toText } from '../../lib/text';
import { formatClock } from '../../lib/time';
import type { MobileChatMessage } from '../../types';

export type SessionDisplayItem = {
  id: string;
  title: string;
  preview: string;
};

export function summarizePreview(messages: MobileChatMessage[]): string {
  const user = [...messages].reverse().find((m) => m.role === 'user' && m.text.trim());
  return user ? user.text.slice(0, 42) : '新会话';
}

export function isPlaceholderSessionTitle(input: string): boolean {
  const text = toText(input).trim();
  return !text || text === '新会话' || text === '新建线程' || text === 'New session' || text === 'newsession';
}

export function pickSessionDisplayTitle(item: Pick<SessionDisplayItem, 'title' | 'preview' | 'id'>, fallbackMessages?: MobileChatMessage[]): string {
  const rawTitle = toText(item.title).trim();
  if (!isPlaceholderSessionTitle(rawTitle)) return rawTitle;
  const preview = toText(item.preview).trim();
  if (preview && !isPlaceholderSessionTitle(preview)) return preview.slice(0, 24);
  const userFallback = fallbackMessages?.find((message) => message.role === 'user' && toText(message.text).trim());
  if (userFallback) return toText(userFallback.text).trim().slice(0, 24);
  return rawTitle || '未命名会话';
}

export function formatSessionTimestamp(input?: number): string {
  const value = Number(input || 0);
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && date.getMonth() === now.getMonth();
  const sameDate = sameMonth && date.getDate() === now.getDate();
  if (sameDate) return formatClock(value);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return sameYear ? `${month}-${day}` : `${date.getFullYear()}/${month}/${day}`;
}

export function assistantTextWeight(messages: MobileChatMessage[]): number {
  return messages
    .filter((m) => m.role === 'assistant')
    .reduce((sum, m) => sum + toText(m.text).length, 0);
}

export function losesRenderedAssistant(prev: MobileChatMessage[], next: MobileChatMessage[]): boolean {
  const prevAssistant = assistantTextWeight(prev);
  if (prevAssistant <= 0) return false;
  const nextAssistant = assistantTextWeight(next);
  if (nextAssistant >= prevAssistant) return false;
  const prevLastUserIndex = Math.max(...prev.map((m, index) => (m.role === 'user' ? index : -1)));
  const nextLastUserIndex = Math.max(...next.map((m, index) => (m.role === 'user' ? index : -1)));
  if (prevLastUserIndex < 0 || nextLastUserIndex < 0) return false;
  const prevTailAssistant = prev.slice(prevLastUserIndex + 1).some((m) => m.role === 'assistant' && toText(m.text));
  const nextTailAssistant = next.slice(nextLastUserIndex + 1).some((m) => m.role === 'assistant' && toText(m.text));
  return prevTailAssistant && !nextTailAssistant;
}
