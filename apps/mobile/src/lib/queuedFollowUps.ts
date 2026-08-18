export type QueuedFollowUp = {
  id: string;
  content: string;
};

export function makeQueuedFollowUpId(): string {
  return `queue-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

/** 跟进已发出时，从预览队列按正文 FIFO 摘掉对应项。 */
export function consumeQueuedFollowUp(
  queue: QueuedFollowUp[],
  committedContent: string
): { queue: QueuedFollowUp[]; consumed: QueuedFollowUp | null } {
  if (queue.length === 0) return { queue, consumed: null };
  const text = committedContent.trim();
  const idx = text ? queue.findIndex((item) => item.content.trim() === text) : -1;
  if (idx < 0) return { queue, consumed: null };
  return {
    queue: queue.filter((_, index) => index !== idx),
    consumed: queue[idx] || null
  };
}

/** 用户手动取消某条待发送跟进。 */
export function removeQueuedFollowUpById(
  queue: QueuedFollowUp[],
  id: string
): QueuedFollowUp[] {
  const target = String(id || '').trim();
  if (!target || queue.length === 0) return queue;
  return queue.filter((item) => item.id !== target);
}

/** 时间线里已经有的用户句不再留在跟进预览里。 */
export function dropQueuedFollowUpsAlreadyInTranscript(
  queue: QueuedFollowUp[],
  userTexts: string[]
): QueuedFollowUp[] {
  if (queue.length === 0) return queue;
  const committed = new Set(userTexts.map((text) => text.trim()).filter(Boolean));
  if (committed.size === 0) return queue;
  return queue.filter((item) => !committed.has(item.content.trim()));
}
