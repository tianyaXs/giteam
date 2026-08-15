/**
 * 将 subagent.childEvent 投影到 task tool part 的 metadata.timeline，
 * 对齐桌面 applySubagentChildEventToPart（移动端落在 part.state.metadata）。
 */

export type MobileSubagentChildEvent = {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
};

export type MobileTaskTimelineStep = {
  id: string;
  type: 'toolCall';
  toolCallId: string;
  toolName: string;
  status: string;
  isError?: boolean;
  input?: unknown;
  output?: unknown;
  details?: unknown;
};

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function extractOutputText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    const row = output as Record<string, unknown>;
    if (typeof row.text === 'string') return row.text;
    if (typeof row.output === 'string') return row.output;
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }
  return String(output);
}

function upsertTimelineStep(
  timeline: MobileTaskTimelineStep[],
  next: MobileTaskTimelineStep
): MobileTaskTimelineStep[] {
  const id = normalizeText(next.id);
  if (!id) return [...timeline, next];
  const index = timeline.findIndex((step) => normalizeText(step.id) === id);
  if (index < 0) return [...timeline, next];
  const copy = timeline.slice();
  copy[index] = { ...copy[index], ...next };
  return copy;
}

export function readTaskTimeline(metadata: Record<string, unknown> | null | undefined): MobileTaskTimelineStep[] {
  const raw = metadata?.timeline;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const step = row as Record<string, unknown>;
      const id = normalizeText(step.id) || normalizeText(step.toolCallId);
      if (!id) return null;
      return {
        id,
        type: 'toolCall' as const,
        toolCallId: normalizeText(step.toolCallId) || id,
        toolName: normalizeText(step.toolName) || 'tool',
        status: normalizeText(step.status) || 'running',
        isError: step.isError === true,
        ...(step.input !== undefined ? { input: step.input } : {}),
        ...(step.output !== undefined ? { output: step.output } : {}),
        ...(step.details !== undefined ? { details: step.details } : {})
      };
    })
    .filter(Boolean) as MobileTaskTimelineStep[];
}

/** 按 id 合并 timeline，保留客户端 SSE 投影出的步骤（服务端快照常无 timeline）。 */
export function mergeTaskTimelines(prev: unknown, incoming: unknown): MobileTaskTimelineStep[] {
  const left = readTaskTimeline({ timeline: prev });
  const right = readTaskTimeline({ timeline: incoming });
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const byId = new Map<string, MobileTaskTimelineStep>();
  const order: string[] = [];
  for (const step of [...left, ...right]) {
    const id = normalizeText(step.id) || normalizeText(step.toolCallId);
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    const prevStep = byId.get(id);
    byId.set(id, prevStep ? { ...prevStep, ...step, id } : { ...step, id });
  }
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

/** 合并 tool part 的 state.metadata，避免 tail sync / message.completed 冲掉 timeline。 */
export function mergeToolPartMetadata(
  prev: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const left = prev && typeof prev === 'object' ? prev : {};
  const right = incoming && typeof incoming === 'object' ? incoming : {};
  const merged: Record<string, unknown> = { ...left, ...right };
  const timeline = mergeTaskTimelines(left.timeline, right.timeline);
  if (timeline.length > 0) merged.timeline = timeline;
  else delete merged.timeline;
  return merged;
}

/** 合并 tool part.state：浅合并字段，深合并 metadata（含 timeline）。 */
export function mergeToolPartState(prev: any, incoming: any): any {
  if (!prev) return incoming || {};
  if (!incoming) return prev;
  const prevMeta =
    prev.metadata && typeof prev.metadata === 'object' ? (prev.metadata as Record<string, unknown>) : null;
  const nextMeta =
    incoming.metadata && typeof incoming.metadata === 'object'
      ? (incoming.metadata as Record<string, unknown>)
      : null;
  return {
    ...prev,
    ...incoming,
    input:
      incoming.input && typeof incoming.input === 'object' && Object.keys(incoming.input as object).length > 0
        ? incoming.input
        : prev.input,
    output: incoming.output !== undefined ? incoming.output : prev.output,
    error: incoming.error !== undefined ? incoming.error : prev.error,
    metadata: mergeToolPartMetadata(prevMeta, nextMeta)
  };
}

/** 把子 agent 事件合并进 metadata（含 timeline / currentToolName / childPhase）。 */
export function applySubagentChildEventToMetadata(
  metadata: Record<string, unknown> | null | undefined,
  childEvent: MobileSubagentChildEvent
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  let timeline = readTaskTimeline(base);
  const type = normalizeText(childEvent.type);

  if (type === 'tool.started' || type === 'toolCall.started') {
    const toolCallId = normalizeText(childEvent.toolCallId) || `child-${timeline.length}`;
    const toolName = normalizeText(childEvent.toolName) || 'tool';
    timeline = upsertTimelineStep(timeline, {
      id: toolCallId,
      type: 'toolCall',
      toolCallId,
      toolName,
      status: 'running',
      ...(childEvent.input !== undefined ? { input: childEvent.input } : {})
    });
    return { ...base, timeline, currentToolName: toolName, childPhase: '' };
  }

  if (type === 'tool.progress') {
    const toolCallId = normalizeText(childEvent.toolCallId);
    if (!toolCallId) return base;
    timeline = upsertTimelineStep(timeline, {
      id: toolCallId,
      type: 'toolCall',
      toolCallId,
      toolName: normalizeText(childEvent.toolName),
      status: 'running',
      ...(childEvent.output !== undefined ? { output: extractOutputText(childEvent.output) } : {})
    });
    return { ...base, timeline };
  }

  if (type === 'tool.completed') {
    const toolCallId = normalizeText(childEvent.toolCallId);
    if (!toolCallId) return base;
    const isError = Boolean(childEvent.isError);
    timeline = upsertTimelineStep(timeline, {
      id: toolCallId,
      type: 'toolCall',
      toolCallId,
      toolName: normalizeText(childEvent.toolName),
      status: isError ? 'error' : 'completed',
      isError,
      ...(childEvent.output !== undefined ? { output: extractOutputText(childEvent.output) } : {})
    });
    return { ...base, timeline };
  }

  if (type === 'reasoning.delta' || type === 'message.delta' || type === 'message.started') {
    return { ...base, childPhase: 'responding' };
  }

  if (type === 'message.completed') {
    return { ...base, childPhase: '' };
  }

  return base;
}
