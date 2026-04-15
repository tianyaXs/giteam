import type {
  MobileChatMessage,
  MobileContextCard,
  MobileEventCard,
  MobileThinkCard,
  MobileTimelineItem,
  ParsedConversation
} from './types';

function normalizeText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function createdAtOf(info: any, fallback: number): number {
  const t = Number(info?.time?.created || 0);
  if (Number.isFinite(t) && t > 0) return t;
  return fallback;
}

function collectParts(parts: any[], type: string): any[] {
  return parts.filter((p: any) => normalizeText(p?.type) === type);
}

function collectVisibleTexts(parts: any[]): string[] {
  return collectParts(parts, 'text')
    .filter((p: any) => p?.synthetic !== true)
    .map((p: any) => normalizeText(p?.text))
    .filter(Boolean);
}

function toolMode(tool: string): string {
  if (tool === 'read' || tool === 'list' || tool === 'glob' || tool === 'grep') return '读取';
  if (tool === 'write' || tool === 'edit' || tool === 'apply_patch') return '写入';
  return '';
}

function toolDetail(input: any): string {
  return normalizeText(input?.description)
    || normalizeText(input?.filePath)
    || normalizeText(input?.pattern)
    || normalizeText(input?.query)
    || normalizeText(input?.url)
    || normalizeText(input?.path);
}

function toolOutputText(state: any): string {
  const output = state?.output;
  if (typeof output === 'string') return output.trim();
  if (output && typeof output === 'object') {
    try {
      return JSON.stringify(output).trim();
    } catch {
      return '';
    }
  }
  return '';
}

function isContextTool(tool: string): boolean {
  return tool === 'read' || tool === 'glob' || tool === 'grep' || tool === 'list';
}

function isRenderablePart(p: any): boolean {
  if (!p) return false;
  const t = normalizeText(p?.type);
  if (t === 'text') return !!normalizeText(p?.text);
  if (t === 'reasoning') return !!normalizeText(p?.text);
  if (t === 'step-start' || t === 'step-finish' || t === 'patch') return false;
  if (t === 'tool') {
    const tool = normalizeText(p?.tool);
    if (tool === 'todowrite') return false;
    return true;
  }
  return false;
}

function summarizeContextToolCounts(parts: any[]): { read: number; search: number; list: number } {
  let read = 0;
  let search = 0;
  let list = 0;
  for (const p of parts) {
    if (normalizeText(p?.type) !== 'tool') continue;
    const tool = normalizeText(p?.tool);
    if (tool === 'read') read += 1;
    else if (tool === 'glob' || tool === 'grep') search += 1;
    else if (tool === 'list') list += 1;
  }
  return { read, search, list };
}

function summarizeContextProgress(parts: any[]): { active: boolean; mode: string; detail: string } {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i] || {};
    if (normalizeText(p?.type) !== 'tool') continue;
    const st = normalizeText(p?.state?.status).toLowerCase();
    if (st !== 'running' && st !== 'pending') continue;
    const title = normalizeText(p?.state?.title);
    const tool = normalizeText(p?.tool);
    const input = p?.state?.input || {};
    const subtitle = normalizeText(input?.description) || normalizeText(input?.filePath) || normalizeText(input?.pattern) || normalizeText(input?.path);
    const detail = [tool, title || subtitle].filter(Boolean).join(' · ');
    const mode =
      tool === 'read' || tool === 'list' || tool === 'glob' || tool === 'grep'
        ? '读取'
        : tool === 'write' || tool === 'edit' || tool === 'apply_patch'
          ? '写入'
          : '处理中';
    return { active: true, mode, detail };
  }
  return { active: false, mode: '', detail: '' };
}

function buildToolEvent(part: any, id: string, createdAt: number): MobileEventCard {
  const tool = normalizeText(part?.tool) || 'tool';
  const state = part?.state || {};
  const status = normalizeText(state?.status).toLowerCase();
  const outputText = toolOutputText(state);
  const showOutput = !isContextTool(tool) && !!outputText && (status === 'error' || tool === 'bash');
  const output = showOutput ? (outputText.length > 320 ? `${outputText.slice(0, 320)}...` : outputText) : '';
  const metadata = state?.metadata || part?.metadata || {};
  const rawTaskSessionId = normalizeText(metadata?.sessionId) || normalizeText(metadata?.sessionID);
  const taskSessionId = rawTaskSessionId || (() => {
    if (!outputText) return '';
    const m = outputText.match(/task_id:\\s*(ses[^\\s)]+)/i);
    return normalizeText(m?.[1] || '');
  })();
  const taskSubagent = normalizeText(state?.input?.subagent_type);
  return {
    id,
    title: tool,
    detail: toolDetail(state?.input),
    mode: toolMode(tool),
    status,
    output,
    taskSessionId,
    taskSubagent,
    createdAt
  };
}

export function parseConversation(raw: unknown): ParsedConversation {
  if (!Array.isArray(raw)) {
    return { chatMessages: [], timeline: [], writing: false };
  }

  const timelineRows: Array<{ order: number; item: MobileTimelineItem }> = [];
  let seq = 0;
  let writing = false;
  let hasAssistantRenderable = false;
  let sizeLimitSyntheticCount = 0;

  for (let idx = 0; idx < raw.length; idx += 1) {
    const item: any = (raw as any[])[idx];
    const info = item?.info || {};
    const id = normalizeText(info?.id);
    if (!id) continue;

    const role = normalizeText(info?.role);
    const parts = Array.isArray(item?.parts) ? item.parts : [];
    const createdAt = createdAtOf(info, idx + 1);
    const finished = Boolean(info?.finish || info?.time?.completed);

    if (role === 'user') {
      const hasAutoCompactionPart = parts.some((p: any) => normalizeText(p?.type) === 'compaction' && p?.auto === true);
      if (hasAutoCompactionPart) continue;
      for (const p of parts) {
        if (normalizeText(p?.type) !== 'text') continue;
        if (p?.synthetic !== true) continue;
        const t = normalizeText(p?.text).toLowerCase();
        if (t.includes('exceeded the provider') && t.includes('size limit')) {
          sizeLimitSyntheticCount += 1;
        }
      }
      const text = collectVisibleTexts(parts).join('\n\n').trim();
      if (!text) continue;
      timelineRows.push({
        order: seq++,
        item: { kind: 'chat', createdAt, message: { id, role: 'user', text, createdAt } }
      });
      continue;
    }

    if (role !== 'assistant') continue;
    const renderParts = parts.filter(isRenderablePart);
    let pidx = 0;
    while (pidx < renderParts.length) {
      const p: any = renderParts[pidx];
      const t = normalizeText(p?.type);
      const partId = normalizeText(p?.id) || `${id}:${pidx}`;
      const partCreatedAt = createdAt + pidx;

      if (t === 'tool' && isContextTool(normalizeText(p?.tool))) {
        const batch: any[] = [p];
        let j = pidx + 1;
        while (j < renderParts.length) {
          const nxt: any = renderParts[j];
          if (normalizeText(nxt?.type) === 'tool' && isContextTool(normalizeText(nxt?.tool))) {
            batch.push(nxt);
            j += 1;
            continue;
          }
          break;
        }
        const counts = summarizeContextToolCounts(batch);
        const progress = summarizeContextProgress(batch);
        const summary = progress.detail
          ? `${progress.mode} · ${progress.detail} · ${counts.read} read · ${counts.search} search · ${counts.list} list`
          : `${counts.read} read · ${counts.search} search · ${counts.list} list`;
        const tools: MobileEventCard[] = batch.map((bp: any, bidx: number) => {
          const bid = normalizeText(bp?.id) || `${partId}:ctx:${bidx}`;
          return buildToolEvent(bp, `event:${bid}`, partCreatedAt + bidx);
        });
        const context: MobileContextCard = {
          id: `context:${partId}`,
          title: progress.active ? 'Gathering Context' : 'Context',
          summary,
          createdAt: partCreatedAt,
          tools
        };
        timelineRows.push({
          order: seq++,
          item: { kind: 'context', createdAt: partCreatedAt, context }
        });
        hasAssistantRenderable = true;
        pidx = j;
        continue;
      }

      if (t === 'text') {
        const text = normalizeText(p?.text);
        if (text) {
          timelineRows.push({
            order: seq++,
            item: {
              kind: 'chat',
              createdAt: partCreatedAt,
              message: { id: `chat:${partId}`, role: 'assistant', text, createdAt: partCreatedAt }
            }
          });
          hasAssistantRenderable = true;
        }
      } else if (t === 'reasoning') {
        const text = normalizeText(p?.text);
        if (text) {
          timelineRows.push({
            order: seq++,
            item: {
              kind: 'think',
              createdAt: partCreatedAt,
              card: { id: `think:${partId}`, title: 'Think', text, createdAt: partCreatedAt, finished }
            }
          });
          hasAssistantRenderable = true;
        }
      } else if (t === 'tool') {
        const card = buildToolEvent(p, `event:${partId}`, partCreatedAt);
        timelineRows.push({
          order: seq++,
          item: { kind: 'event', createdAt: partCreatedAt, event: card }
        });
        hasAssistantRenderable = true;
      }
      pidx += 1;
    }

    if (!finished) writing = true;
  }

  const ordered: MobileTimelineItem[] = timelineRows
    .sort((a, b) => (a.item.createdAt - b.item.createdAt) || (a.order - b.order))
    .map((r) => r.item);

  const timeline: MobileTimelineItem[] = [];
  const seenSig = new Set<string>();
  for (const item of ordered) {
    let sig: string = item.kind;
    // 仅用稳定 id 去重：长正文拼进 key 会导致超长会话下 Set/字符串成本极高、主线程卡顿。
    if (item.kind === 'chat') sig = `${sig}:${item.message.role}:${item.message.id}`;
    if (item.kind === 'think') sig = `${sig}:${item.card.id}`;
    if (item.kind === 'event') sig = `${sig}:${item.event.id}`;
    if (item.kind === 'context') sig = `${sig}:${item.context.id}`;
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    timeline.push(item);
  }

  if (!hasAssistantRenderable && sizeLimitSyntheticCount > 0) {
    const userOnly = timeline.filter((t): t is Extract<MobileTimelineItem, { kind: 'chat' }> => t.kind === 'chat' && t.message.role === 'user');
    const stable: MobileTimelineItem[] = userOnly.map((t) => t);
    stable.push({
      kind: 'think',
      createdAt: Date.now(),
      card: {
        id: 'think:size-limit-loop',
        title: 'System',
        text: '服务端检测到 size-limit 循环（synthetic+compaction）。本轮没有有效 assistant 正文或工具事件，请更换模型或清理上游上下文后重试。',
        createdAt: Date.now(),
        finished: true
      }
    });
    const chatMessages = stable
      .filter((t): t is Extract<MobileTimelineItem, { kind: 'chat' }> => t.kind === 'chat')
      .map((t) => t.message);
    return { chatMessages, timeline: stable, writing: false };
  }

  const rawChat = timeline
    .filter((t): t is Extract<MobileTimelineItem, { kind: 'chat' }> => t.kind === 'chat')
    .map((t) => t.message);
  const chatMessages: MobileChatMessage[] = [];
  for (const m of rawChat) {
    const prev = chatMessages[chatMessages.length - 1];
    const sameRole = prev?.role === m.role;
    const sameText = (prev?.text || '') === m.text;
    const closeTime = Math.abs((prev?.createdAt || 0) - (m.createdAt || 0)) < 4000;
    if (sameRole && sameText && closeTime) continue;
    chatMessages.push(m);
  }

  if (timeline.length === 0 && raw.length > 0) {
    let fallbackText = '';
    for (let i = raw.length - 1; i >= 0; i -= 1) {
      const item: any = (raw as any[])[i];
      const parts = Array.isArray(item?.parts) ? item.parts : [];
      const text = collectParts(parts, 'text')
        .map((p: any) => normalizeText(p?.text))
        .find(Boolean);
      if (text) {
        fallbackText = text;
        break;
      }
    }
    const text = fallbackText || '本轮会话只有系统事件（如 compaction），暂无可展示正文。';
    timeline.push({
      kind: 'think',
      createdAt: Date.now(),
      card: {
        id: 'think:fallback',
        title: 'System',
        text,
        createdAt: Date.now(),
        finished: true
      }
    });
  }

  return { chatMessages, timeline, writing };
}
