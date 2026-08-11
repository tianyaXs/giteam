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

/** 会话列表预览净化：去掉 system 注入块、markdown 语法与多余空白。 */
export function cleanSessionPreview(input: string): string {
  let text = toText(input);
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  text = text.replace(/<\/?system[^>]*>/g, '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]*)`/g, '$1');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  text = text.replace(/\*\*([^*]*)\*\*/g, '$1');
  text = text.replace(/\*([^*]*)\*/g, '$1');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*>\s?/gm, '');
  return text.replace(/\s+/g, ' ').trim();
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

export function sharesSessionMessageContext(prev: MobileChatMessage[], next: MobileChatMessage[]): boolean {
  if (prev.length === 0 || next.length === 0) return false;
  const nextIds = new Set(next.map((message) => message.id));
  return prev.some((message) => nextIds.has(message.id));
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

/** 最新用户气泡从 prev 消失（常见于乐观层被摘掉而权威 user 尚未进窗口）。 */
export function losesLatestUserMessage(prev: MobileChatMessage[], next: MobileChatMessage[]): boolean {
  const prevUsers = prev.filter((m) => m.role === 'user' && toText(m.text).trim());
  const nextUsers = next.filter((m) => m.role === 'user' && toText(m.text).trim());
  if (prevUsers.length === 0) return false;
  const prevLast = prevUsers[prevUsers.length - 1]!;
  const prevText = toText(prevLast.text).trim();
  if (!prevText) return false;
  // 同 id 或同文案（乐观 → 权威替换）都算仍在
  const stillThere = nextUsers.some((m) => {
    const text = toText(m.text).trim();
    return m.id === prevLast.id || text === prevText;
  });
  return !stillThere;
}
