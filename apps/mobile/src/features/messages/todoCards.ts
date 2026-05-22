import { toText } from '../../lib/text';
import type { MobileTodoCard } from '../../types';

export function buildLiveTodoCard(sessionId: string, todos: any[]): MobileTodoCard | null {
  const sid = toText(sessionId).trim();
  const items = Array.isArray(todos)
    ? todos
        .map((todo: any, index: number) => {
          const id = toText(todo?.id).trim() || `todo:${index}`;
          const content = toText(todo?.content).trim();
          const status = toText(todo?.status).trim();
          if (!id || !content) return null;
          if (status !== 'pending' && status !== 'in_progress' && status !== 'completed' && status !== 'cancelled') return null;
          return {
            id,
            content,
            status,
            priority: toText(todo?.priority).trim() || undefined
          };
        })
        .filter(Boolean) as MobileTodoCard['items']
    : [];
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'completed').length;
  const active = items.find((item) => item.status === 'in_progress') || items.find((item) => item.status === 'pending') || items[items.length - 1] || null;
  return {
    id: `todo:stream:${sid || 'current'}`,
    title: 'Todo',
    summary: active ? `已完成 ${done}/${items.length} · ${active.content}` : `已完成 ${done}/${items.length}`,
    createdAt: Date.now(),
    items,
    finished: items.every((item) => item.status === 'completed' || item.status === 'cancelled')
  };
}
