import {
  agentSearchDetail,
  buildAgentAssistantRenderGroups,
  isAgentContextTool,
  isAgentRenderablePart,
  mergeAssistantTextChunks,
  summarizeAgentContextProgress,
  summarizeAgentContextToolCounts
} from './lib/agentParts';
import { humanizeAgentError } from './lib/humanizeAgentError';
import type {
  MobileChatMessage,
  MobileContextCard,
  MobileEventCard,
  MobileQuestionCard,
  MobileThinkCard,
  MobileTodoCard,
  MobileTodoItem,
  MobileTimelineItem,
  ParsedConversation
} from './types';

type MobileImageAttachment = NonNullable<MobileChatMessage['attachments']>[number];

function normalizeText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function errorText(error: any): string {
  if (!error) return '';
  if (typeof error === 'string') return error.trim();
  const name = normalizeText(error?.name);
  const message = normalizeText(error?.message);
  const code = normalizeText(error?.code) || normalizeText(error?.data?.code);
  const fallback = (() => {
    try {
      return JSON.stringify(error).trim();
    } catch {
      return '';
    }
  })();
  return [name, code, message].filter(Boolean).join(' · ') || fallback;
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

function collectUserImageAttachments(parts: any[]): MobileImageAttachment[] {
  const out: MobileImageAttachment[] = [];
  collectParts(parts, 'file').forEach((p: any, index: number) => {
      const mime = normalizeText(p?.mime);
      const url = normalizeText(p?.url) || normalizeText(p?.source);
      const filename = normalizeText(p?.filename);
      const looksLikeImage = mime.startsWith('image/') || url.startsWith('data:image/') || /\.(png|jpe?g|webp|gif|heic)$/i.test(filename);
      if (!looksLikeImage || !url) return;
      out.push({
        id: normalizeText(p?.id) || `image:${index}`,
        kind: 'image' as const,
        uri: url,
        mime: mime || undefined,
        filename: filename || undefined,
      });
    });
  return out;
}

function hasCompactionPart(parts: any[]): boolean {
  return parts.some((p: any) => normalizeText(p?.type) === 'compaction');
}

function toolMode(tool: string): string {
  if (tool === 'read' || tool === 'list' || tool === 'ls' || tool === 'glob' || tool === 'grep') return '读取';
  if (tool === 'find' || tool === 'search') return '搜索';
  if (tool === 'write' || tool === 'edit' || tool === 'apply_patch') return '写入';
  // bash 不再挂「命令」模式标签，由终端块直接呈现
  return '';
}

function toolDetail(tool: string, input: any): string {
  if (tool === 'bash') {
    return normalizeText(input?.command) || normalizeText(input?.description);
  }
  const searchTool = tool === 'grep' || tool === 'find' || tool === 'glob' || tool === 'search';
  if (searchTool) {
    return agentSearchDetail(input || {});
  }
  return normalizeText(input?.description)
    || normalizeText(input?.filePath)
    || normalizeText(input?.query)
    || normalizeText(input?.url)
    || normalizeText(input?.path);
}

function compactPath(input: string): string {
  const path = normalizeText(input).replace(/\\/g, '/');
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join('/');
}

function diffCountFromText(text: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeEditFileDiff(tool: string, state: any, metadata: any) {
  if (tool !== 'edit') return undefined;
  const fromMeta = metadata?.filediff;
  const file = normalizeText(fromMeta?.file) || normalizeText(state?.input?.filePath);
  const patch = normalizeText(fromMeta?.patch) || '';
  const before = typeof fromMeta?.before === 'string'
    ? fromMeta.before
    : typeof state?.input?.oldString === 'string'
      ? state.input.oldString
      : typeof state?.input?.old_string === 'string'
        ? state.input.old_string
        : '';
  const after = typeof fromMeta?.after === 'string'
    ? fromMeta.after
    : typeof state?.input?.newString === 'string'
      ? state.input.newString
      : typeof state?.input?.new_string === 'string'
        ? state.input.new_string
        : '';
  const counts = patch ? diffCountFromText(patch) : { additions: 0, deletions: 0 };
  const additions = toNumber(fromMeta?.additions) || counts.additions;
  const deletions = toNumber(fromMeta?.deletions) || counts.deletions;
  if (!file && !patch && !before && !after) return undefined;
  return {
    file,
    patch: patch || undefined,
    before: before || undefined,
    after: after || undefined,
    additions,
    deletions,
    status: typeof fromMeta?.status === 'string' ? fromMeta.status : 'modified' as const
  };
}

function normalizePatchFiles(metadata: any) {
  if (!Array.isArray(metadata?.files)) return undefined;
  const files = metadata.files
    .map((file: any) => {
      const patch = normalizeText(file?.patch) || normalizeText(file?.diff) || undefined;
      const counts = patch ? diffCountFromText(patch) : { additions: 0, deletions: 0 };
      const type = normalizeText(file?.type) as 'add' | 'update' | 'delete' | 'move';
      const relativePath = normalizeText(file?.relativePath) || normalizeText(file?.filePath);
      const filePath = normalizeText(file?.filePath) || relativePath;
      if (!relativePath && !filePath) return null;
      return {
        filePath,
        relativePath,
        type: type || 'update',
        patch,
        additions: toNumber(file?.additions) || counts.additions,
        deletions: toNumber(file?.deletions) || counts.deletions,
        movePath: normalizeText(file?.movePath) || undefined
      };
    })
    .filter(Boolean);
  return files.length > 0 ? files : undefined;
}

function formatCountLabel(count: number, noun: string): string {
  return count > 0 ? `${count} 次${noun}` : '';
}

function summarizeContextCounts(counts: { read: number; search: number; list: number }): string {
  return [
    formatCountLabel(counts.read, '读取'),
    formatCountLabel(counts.search, '搜索'),
    formatCountLabel(counts.list, '列出')
  ].filter(Boolean).join('，');
}

function summarizePatchText(patchText: string): string {
  const rows = new Map<string, { action: string; add: number; del: number }>();
  let current = '';
  for (const line of patchText.split(/\r?\n/)) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (header) {
      current = normalizeText(header[2]);
      rows.set(current, { action: header[1], add: 0, del: 0 });
      continue;
    }
    if (!current) continue;
    const row = rows.get(current);
    if (!row) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) row.add += 1;
    if (line.startsWith('-') && !line.startsWith('---')) row.del += 1;
  }
  const summaries = [...rows.entries()].map(([path, row]) => {
    const action = row.action === 'Add' ? 'Added' : row.action === 'Delete' ? 'Deleted' : 'Modified';
    return `${action} ${compactPath(path)} +${row.add} -${row.del}`;
  });
  if (summaries.length <= 2) return summaries.join('；');
  return `${summaries.slice(0, 2).join('；')}；等 ${summaries.length} 个文件`;
}

function summarizePatchOutput(outputText: string): string {
  const rows: string[] = [];
  for (const line of outputText.split(/\r?\n/)) {
    const m = line.match(/^\s*([MAD])\s+(.+)$/);
    if (!m) continue;
    const action = m[1] === 'A' ? 'Added' : m[1] === 'D' ? 'Deleted' : 'Modified';
    rows.push(`${action} ${compactPath(m[2])}`);
  }
  if (rows.length <= 2) return rows.join('；');
  return `${rows.slice(0, 2).join('；')}；等 ${rows.length} 个文件`;
}

function summarizeWriteTool(tool: string, input: any): string {
  if (tool === 'apply_patch') {
    const patchText = normalizeText(input?.patchText) || normalizeText(input?.patch);
    return summarizePatchText(patchText);
  }
  const filePath = compactPath(normalizeText(input?.filePath) || normalizeText(input?.path));
  if (tool === 'write') {
    const content = typeof input?.content === 'string' ? input.content : '';
    const lineCount = content ? content.split(/\r?\n/).length : 0;
    return [filePath, lineCount ? `${lineCount} 行` : ''].filter(Boolean).join(' · ');
  }
  if (tool === 'edit') {
    const oldText = typeof input?.oldString === 'string' ? input.oldString : typeof input?.old_string === 'string' ? input.old_string : '';
    const newText = typeof input?.newString === 'string' ? input.newString : typeof input?.new_string === 'string' ? input.new_string : '';
    const oldLines = oldText ? oldText.split(/\r?\n/).length : 0;
    const newLines = newText ? newText.split(/\r?\n/).length : 0;
    const delta = oldLines || newLines ? `+${newLines} -${oldLines}` : '';
    return [filePath, delta].filter(Boolean).join(' · ');
  }
  return '';
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
  return isAgentContextTool(tool);
}


function parseTodoItems(input: unknown): MobileTodoItem[] {
  if (!Array.isArray(input)) return [];
  const out: MobileTodoItem[] = [];
  input.forEach((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    if (!row) return;
    const content = normalizeText(row.content);
    if (!content) return;
    const rawStatus = normalizeText(row.status).toLowerCase();
    const status: MobileTodoItem['status'] =
      rawStatus === 'completed' || rawStatus === 'cancelled' || rawStatus === 'in_progress'
        ? rawStatus
        : 'pending';
    out.push({
      id: normalizeText(row.id) || `todo-${index + 1}`,
      content,
      status,
      priority: normalizeText(row.priority) || undefined
    });
  });
  return out;
}

function buildTodoCard(part: any, id: string, createdAt: number, finished: boolean): MobileTodoCard | null {
  const state = part?.state || {};
  const metadata = state?.metadata || part?.metadata || {};
  const items = (() => {
    const fromMeta = parseTodoItems(metadata?.todos);
    if (fromMeta.length > 0) return fromMeta;
    return parseTodoItems(state?.input?.todos);
  })();
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'completed').length;
  const active = items.find((item) => item.status === 'in_progress') || items.find((item) => item.status === 'pending') || items[items.length - 1];
  return {
    id,
    title: 'Todo',
    summary: active ? `已完成 ${done}/${items.length} · ${active.content}` : `已完成 ${done}/${items.length}`,
    createdAt,
    items,
    finished: finished || items.every((item) => item.status === 'completed' || item.status === 'cancelled')
  };
}

function parseQuestionOptions(input: unknown): Array<{ label: string; description?: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => ({
      label: normalizeText(item?.label),
      description: normalizeText(item?.description) || undefined
    }))
    .filter((item) => !!item.label);
}

function buildQuestionCard(part: any, id: string, createdAt: number, messageId?: string): MobileQuestionCard | null {
  const state = part?.state || {};
  const input = state?.input || {};
  const rawQuestions = Array.isArray(input?.questions) ? input.questions : [];
  if (rawQuestions.length === 0) return null;
  const questions = rawQuestions
    .map((q: any) => ({
      question: normalizeText(q?.question),
      header: normalizeText(q?.header) || undefined,
      options: parseQuestionOptions(q?.options),
      multiple: q?.multiple === true,
      custom: q?.custom !== false
    }))
    .filter((q: { question: string | null; options: unknown[] }) => q.question || q.options.length > 0);
  if (questions.length === 0) return null;
  const status = normalizeText(state?.status).toLowerCase() || 'running';
  const errorText = normalizeText(state?.error) || undefined;
  const metadata = state?.metadata || part?.metadata || {};
  const answers = Array.isArray(metadata?.answers) ? metadata.answers : undefined;
  return {
    id,
    title: '问题',
    status,
    createdAt,
    questions,
    answers,
    interactive: false,
    tool: {
      messageID: normalizeText(part?.messageID) || normalizeText(metadata?.messageID) || normalizeText(state?.messageID) || normalizeText(messageId) || undefined,
      callID: normalizeText(part?.callID) || normalizeText(metadata?.callID) || normalizeText(state?.callID) || normalizeText(part?.id) || undefined
    },
    error: errorText
  };
}

function buildToolEvent(part: any, id: string, createdAt: number): MobileEventCard {
  const tool = normalizeText(part?.tool) || 'tool';
  const state = part?.state || {};
  const status = normalizeText(state?.status).toLowerCase();
  const outputText = toolOutputText(state);
  const errorText =
    normalizeText(state?.error)
    || (status === 'error' || status === 'failed' ? outputText : '');
  const showOutput = !isContextTool(tool) && !!outputText && (status === 'error' || tool === 'bash');
  const output = showOutput ? outputText : '';
  const metadata = state?.metadata || part?.metadata || {};
  const writeSummary = normalizeText(metadata?.writeSummary);
  const rawTaskSessionId = normalizeText(metadata?.sessionId) || normalizeText(metadata?.sessionID);
  const taskSessionId = rawTaskSessionId || (() => {
    if (!outputText) return '';
    const m = outputText.match(/task_id:\\s*(ses[^\\s)]+)/i);
    return normalizeText(m?.[1] || '');
  })();
  const taskSubagent = normalizeText(state?.input?.subagent_type) || normalizeText(metadata?.subagentType);
  const taskDescription =
    normalizeText(metadata?.description)
    || normalizeText(state?.input?.description)
    || normalizeText(metadata?.summary);
  const fileDiff = normalizeEditFileDiff(tool, state, metadata);
  const patchFiles = tool === 'apply_patch' ? normalizePatchFiles(metadata) : undefined;
  const primaryDetail =
    (tool === 'task' ? taskDescription : '') ||
    writeSummary ||
    (fileDiff ? `${compactPath(fileDiff.file)} · +${fileDiff.additions} -${fileDiff.deletions}` : '') ||
    (patchFiles?.length === 1 ? `${compactPath(patchFiles[0]?.relativePath || '')} · +${patchFiles[0]?.additions || 0} -${patchFiles[0]?.deletions || 0}` : '') ||
    summarizeWriteTool(tool, state?.input) ||
    (tool === 'apply_patch' ? summarizePatchOutput(outputText) : '') ||
    toolDetail(tool, state?.input);
  // 探索类失败时不把整段 error dump 当主输出；摘要行展示精简错误。
  const detail =
    primaryDetail ||
    (errorText ? errorText.replace(/^Error:\s*/i, '').trim() : '');
  return {
    id,
    title: tool,
    detail,
    mode: toolMode(tool),
    status,
    meta: tool === 'bash'
      ? normalizeText(state?.input?.command)
      : normalizeText(state?.input?.path || state?.input?.filePath || metadata?.path || metadata?.filePath),
    fileDiff,
    patchFiles,
    output: tool === 'task' ? (normalizeText(metadata?.summary) || outputText) : output,
    taskSessionId,
    taskSubagent,
    createdAt
  };
}

function mergeAdjacentContextItems(items: MobileTimelineItem[]): MobileTimelineItem[] {
  const merged: MobileTimelineItem[] = [];
  for (const item of items) {
    const prev = merged[merged.length - 1];
    if (item.kind === 'context' && prev?.kind === 'context') {
      const tools = [...(prev.context.tools || []), ...(item.context.tools || [])];
      const counts = {
        read: tools.filter((tool) => normalizeText(tool.title) === 'read').length,
        search: tools.filter((tool) => ['grep', 'glob', 'search', 'find'].includes(normalizeText(tool.title))).length,
        list: tools.filter((tool) => ['list', 'ls'].includes(normalizeText(tool.title))).length
      };
      merged[merged.length - 1] = {
        ...prev,
        context: {
          ...prev.context,
          id: `${prev.context.id}:${item.context.id}`,
          title: prev.context.status === 'running' || item.context.status === 'running' ? '探索中' : '已探索',
          status: prev.context.status === 'running' || item.context.status === 'running' ? 'running' : 'completed',
          summary: summarizeContextCounts(counts) || '已收集上下文',
          detail: normalizeText(item.context.detail) || normalizeText(prev.context.detail) || undefined,
          tools
        }
      };
      continue;
    }
    merged.push(item);
  }
  return merged;
}

/** 与桌面端 getBatchKind 对齐：判定单个工具事件属于哪个批组。 */
function eventBatchKind(tool: string): 'shell' | 'edit' | 'web' | 'browser' | '' {
  const t = normalizeText(tool).toLowerCase();
  if (t === 'bash' || t === 'bash_output' || t === 'kill_shell') return 'shell';
  if (t === 'write' || t === 'edit' || t === 'hashline_edit' || t === 'apply_patch') return 'edit';
  if (t === 'web_fetch' || t === 'web_search') return 'web';
  if (t === 'browser_use') return 'browser';
  return '';
}

/** 与桌面端 buildBatchedTimelineGroups 对齐：相邻同类工具合并为一个批组（含单条），
 *  其他时间线项（chat/think/todo/question/error/context）作为批次边界。 */
function batchAdjacentToolEvents(items: MobileTimelineItem[]): MobileTimelineItem[] {
  const out: MobileTimelineItem[] = [];
  let pendingKind: '' | 'shell' | 'edit' | 'web' | 'browser' = '';
  let pending: Array<Extract<MobileTimelineItem, { kind: 'event' }>> = [];

  const flush = () => {
    if (!pending.length || !pendingKind) return;
    const first = pending[0];
    const anyRunning = pending.some((row) => {
      const s = normalizeText(row.event.status).toLowerCase();
      return s === 'running' || s === 'pending';
    });
    out.push({
      kind: 'toolBatch',
      createdAt: first.createdAt,
      batch: {
        id: `batch:${pendingKind}:${first.event.id}`,
        batchKind: pendingKind,
        events: pending.map((row) => row.event),
        status: anyRunning ? 'running' : 'completed',
        createdAt: first.createdAt
      }
    });
    pendingKind = '';
    pending = [];
  };

  for (const item of items) {
    if (item.kind !== 'event') {
      flush();
      out.push(item);
      continue;
    }
    const kind = eventBatchKind(item.event.title);
    if (!kind) {
      flush();
      out.push(item);
      continue;
    }
    if (pendingKind && pendingKind !== kind) flush();
    pendingKind = kind;
    pending.push(item);
  }
  flush();
  return out;
}

export function parseConversation(raw: unknown): ParsedConversation {
  if (!Array.isArray(raw)) {
    return { chatMessages: [], timeline: [], writing: false, hasError: false };
  }

  const timelineRows: Array<{ order: number; item: MobileTimelineItem }> = [];
  let seq = 0;
  let writing = false;
  let hasError = false;
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
      writing = false;
      if (hasCompactionPart(parts)) {
        timelineRows.push({
          order: seq++,
          item: {
            kind: 'divider',
            createdAt,
            divider: {
              id: `divider:${id}`,
              label: '会话已压缩',
              createdAt
            }
          }
        });
        continue;
      }
      for (const p of parts) {
        if (normalizeText(p?.type) !== 'text') continue;
        if (p?.synthetic !== true) continue;
        const t = normalizeText(p?.text).toLowerCase();
        if (t.includes('exceeded the provider') && t.includes('size limit')) {
          sizeLimitSyntheticCount += 1;
        }
      }
      const text = collectVisibleTexts(parts).join('\n\n').trim();
      const attachments = collectUserImageAttachments(parts);
      if (!text && attachments.length === 0) continue;
      timelineRows.push({
        order: seq++,
        item: { kind: 'chat', createdAt, message: { id, role: 'user', text, createdAt, attachments } }
      });
      continue;
    }

    if (role !== 'assistant') continue;
    const errText = errorText(info?.error);
    const errCode = normalizeText(info?.error?.code) || normalizeText(info?.error?.data?.code);
    const hasAssistantError = !!errText;
    if (hasAssistantError && !isAbortLikeMessageError(errText, errCode)) {
      timelineRows.push({
        order: seq++,
        item: {
          kind: 'error',
          createdAt,
          error: {
            id: `error:${id}`,
            title: '运行失败',
            text: humanizeAgentError(errText),
            code: errCode,
            createdAt
          }
        }
      });
      hasAssistantRenderable = true;
      hasError = true;
    }
    const renderParts = parts.filter((p: any) => isAgentRenderablePart(p, true));
    let groupIndex = 0;
    let assistantTextRun: string[] = [];
    const flushAssistantTextRun = (partCreatedAt: number) => {
      const text = mergeAssistantTextChunks(assistantTextRun);
      assistantTextRun = [];
      if (!text) return;
      timelineRows.push({
        order: seq++,
        item: {
          kind: 'chat',
          createdAt: partCreatedAt,
          message: {
            id: `chat:assistant:${id}`,
            role: 'assistant',
            text,
            createdAt: partCreatedAt
          }
        }
      });
      hasAssistantRenderable = true;
    };
    for (const group of buildAgentAssistantRenderGroups(renderParts)) {
      const partCreatedAt = createdAt + groupIndex;
      groupIndex += 1;

      if (group.kind === 'context') {
        flushAssistantTextRun(partCreatedAt);
        const batch = group.parts;
        const firstId = normalizeText((batch[0] as any)?.id) || `${id}:ctx`;
        const counts = summarizeAgentContextToolCounts(batch);
        const progress = summarizeAgentContextProgress(batch);
        const summary = summarizeContextCounts(counts) || '已收集上下文';
        const tools: MobileEventCard[] = batch.map((bp: any, bidx: number) => {
          const bid = normalizeText(bp?.id) || `${firstId}:ctx:${bidx}`;
          return buildToolEvent(bp, `event:${bid}`, partCreatedAt + bidx);
        });
        timelineRows.push({
          order: seq++,
          item: {
            kind: 'context',
            createdAt: partCreatedAt,
            context: {
              id: `context:${group.key}`,
              title: progress.active ? '探索中' : '已探索',
              summary,
              detail: progress.detail || undefined,
              status: progress.active ? 'running' : 'completed',
              createdAt: partCreatedAt,
              tools
            }
          }
        });
        hasAssistantRenderable = true;
        continue;
      }

      if (group.kind === 'reasoning') {
        flushAssistantTextRun(partCreatedAt);
        // redacted（加密思考，gpt5.6 等 OpenAI Responses 系）无明文 text：
        // 不渲染占位说明，仅保证 hasAssistantRenderable 计数（纯思考轮不触发空会话 fallback）。
        const hasRedacted = group.parts.some((part: any) => part?.redacted === true);
        const text = group.parts
          .map((part: any) => normalizeText(part?.text))
          .filter(Boolean)
          .join('\n\n');
        if (!text && !hasRedacted) continue;
        if (hasRedacted) {
          hasAssistantRenderable = true;
          continue;
        }
        const lastPart: any = group.parts[group.parts.length - 1];
        const partFinished = Boolean(lastPart?.finish || lastPart?.time?.end || lastPart?.time?.completed);
        timelineRows.push({
          order: seq++,
          item: {
            kind: 'think',
            createdAt: partCreatedAt,
            card: {
              id: `think:${group.key}`,
              title: 'Think',
              text,
              createdAt: partCreatedAt,
              finished: finished || partFinished
            }
          }
        });
        hasAssistantRenderable = true;
        continue;
      }

      const p: any = group.part;
      const t = normalizeText(p?.type);
      const partId = normalizeText(p?.id) || `${id}:${group.key}`;

      if (t === 'tool' && normalizeText(p?.tool) === 'todowrite') {
        flushAssistantTextRun(partCreatedAt);
        const todo = buildTodoCard(p, `todo:${partId}`, partCreatedAt, finished);
        if (todo) {
          timelineRows.push({
            order: seq++,
            item: { kind: 'todo', createdAt: partCreatedAt, todo }
          });
          hasAssistantRenderable = true;
        }
        continue;
      }

      if (t === 'tool' && normalizeText(p?.tool) === 'question') {
        flushAssistantTextRun(partCreatedAt);
        const question = buildQuestionCard(p, `question:${partId}`, partCreatedAt, id);
        if (question) {
          timelineRows.push({
            order: seq++,
            item: { kind: 'question', createdAt: partCreatedAt, question }
          });
          hasAssistantRenderable = true;
        }
        continue;
      }

      if (t === 'text') {
        const text = normalizeText(p?.text);
        if (text) assistantTextRun.push(text);
        continue;
      }

      if (t === 'tool') {
        flushAssistantTextRun(partCreatedAt);
        const card = buildToolEvent(p, `event:${partId}`, partCreatedAt);
        timelineRows.push({
          order: seq++,
          item: { kind: 'event', createdAt: partCreatedAt, event: card }
        });
        hasAssistantRenderable = true;
      }
    }
    flushAssistantTextRun(createdAt + groupIndex);

    writing = !finished && !hasAssistantError;
  }

  const ordered: MobileTimelineItem[] = timelineRows
    .sort((a, b) => (a.item.createdAt - b.item.createdAt) || (a.order - b.order))
    .map((r) => r.item);

  const timeline: MobileTimelineItem[] = [];
  const seenSig = new Set<string>();
  for (const item of ordered) {
    let sig: string = item.kind;
    // 仅用稳定 id 去重：长正文拼进 key 会导致超长会话下 Set/字符串成本极高、主线程卡顿。
    if (item.kind === 'chat') {
      sig = `${sig}:${item.message.role}:${item.message.id}:${normalizeText(item.message.text).length}`;
    }
    if (item.kind === 'think') sig = `${sig}:${item.card.id}`;
    if (item.kind === 'event') sig = `${sig}:${item.event.id}`;
    if (item.kind === 'todo') sig = `${sig}:${item.todo.id}`;
    if (item.kind === 'question') sig = `${sig}:${item.question.id}`;
    if (item.kind === 'divider') sig = `${sig}:${item.divider.id}`;
    if (item.kind === 'error') sig = `${sig}:${item.error.id}`;
    if (item.kind === 'context') sig = `${sig}:${item.context.id}`;
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    timeline.push(item);
  }

  const normalizedTimeline = batchAdjacentToolEvents(mergeAdjacentContextItems(timeline));

  if (!hasAssistantRenderable && sizeLimitSyntheticCount > 0) {
    const userOnly = normalizedTimeline.filter((t): t is Extract<MobileTimelineItem, { kind: 'chat' }> => t.kind === 'chat' && t.message.role === 'user');
    const stable: MobileTimelineItem[] = userOnly.map((t) => t);
    stable.push({
      kind: 'error',
      createdAt: Date.now(),
      error: {
        id: 'error:size-limit-loop',
        title: '运行失败',
        text: '服务端检测到上下文超限循环（size-limit）。本轮没有有效回复，请更换模型或清理上游上下文后重试。',
        code: 'size_limit_loop',
        createdAt: Date.now()
      }
    });
    const chatMessages = stable
      .filter((t): t is Extract<MobileTimelineItem, { kind: 'chat' }> => t.kind === 'chat')
      .map((t) => t.message);
    return { chatMessages, timeline: stable, writing: false, hasError: true };
  }

  const rawChat = normalizedTimeline
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

  // 仅有 compaction/系统 part、无可展示正文时：不再塞说明性 think 文案。
  // 若 raw 里带有明确 error，则渲染为错误事件；否则保持空时间线（用户气泡仍由 turns 层展示）。
  if (normalizedTimeline.length === 0 && raw.length > 0) {
    let errText = '';
    let errCode = '';
    for (let i = raw.length - 1; i >= 0; i -= 1) {
      const item: any = (raw as any[])[i];
      const info = item?.info || {};
      const text = errorText(info?.error);
      if (text) {
        errText = text;
        errCode = normalizeText(info?.error?.code) || normalizeText(info?.error?.data?.code);
        break;
      }
    }
    if (errText && !isAbortLikeMessageError(errText, errCode)) {
      normalizedTimeline.push({
        kind: 'error',
        createdAt: Date.now(),
        error: {
          id: 'error:fallback',
          title: '运行失败',
          text: humanizeAgentError(errText),
          code: errCode || undefined,
          createdAt: Date.now()
        }
      });
    }
  }

  if (writing && hasAssistantRenderable && !hasError) {
    const assistantTextLen = chatMessages
      .filter((m) => m.role === 'assistant')
      .reduce((sum, m) => sum + normalizeText(m.text).trim().length, 0);
    if (assistantTextLen >= 64) writing = false;
  }

  return { chatMessages, timeline: normalizedTimeline, writing, hasError };
}

function isAbortLikeMessageError(text: string, code: string) {
  const merged = `${normalizeText(text)} ${normalizeText(code)}`.toLowerCase();
  return merged.includes('messageabortederror') || merged.includes('the operation was aborted');
}
