export type MessageSendPerfTrace = {
  traceId: string;
  optimisticId: string;
  targetSid: string;
  startedAt: number;
  log: (message: string) => void;
  finished: boolean;
  path?: string;
  userVisibleMarked: boolean;
  listCellsVisibleMarked: boolean;
  assistantVisibleMarked: boolean;
};

const LOG_TAG = 'message.perf';

let activeTrace: MessageSendPerfTrace | null = null;

export function getActiveMessageSendTrace(): MessageSendPerfTrace | null {
  return activeTrace;
}

export function setActiveMessageSendTrace(trace: MessageSendPerfTrace | null): void {
  activeTrace = trace;
}

function formatDetail(detail?: Record<string, string | number | boolean | undefined>): string {
  if (!detail) return '';
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function startMessageSendPerf(params: {
  optimisticId: string;
  targetSid?: string;
  textLength: number;
  imageCount: number;
  log: (message: string) => void;
}): MessageSendPerfTrace {
  const trace: MessageSendPerfTrace = {
    traceId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    optimisticId: params.optimisticId,
    targetSid: params.targetSid || '',
    startedAt: performance.now(),
    log: params.log,
    finished: false,
    userVisibleMarked: false,
    listCellsVisibleMarked: false,
    assistantVisibleMarked: false
  };
  setActiveMessageSendTrace(trace);
  trace.log(
    `${LOG_TAG} START trace=${trace.traceId} optimistic=${trace.optimisticId} sid=${trace.targetSid || '-'} textLen=${params.textLength} images=${params.imageCount}`
  );
  return trace;
}

export function bindMessageSendSession(trace: MessageSendPerfTrace | null | undefined, targetSid: string): void {
  if (!trace || trace.finished) return;
  trace.targetSid = targetSid;
  markMessageSendPerf(trace, 'send.session_bound', { sid: targetSid });
}

export function markMessageSendPerf(
  trace: MessageSendPerfTrace | null | undefined,
  step: string,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  if (!trace || trace.finished) return;
  const ms = Math.round(performance.now() - trace.startedAt);
  trace.log(`${LOG_TAG} +${ms}ms ${step}${formatDetail(detail)} trace=${trace.traceId} optimistic=${trace.optimisticId}`);
}

export function markMessageSendPerfForSession(
  targetSid: string,
  step: string,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  const trace = activeTrace;
  if (!trace || trace.finished || !trace.targetSid || trace.targetSid !== targetSid) return;
  markMessageSendPerf(trace, step, detail);
}

export function markMessageSendUserVisible(
  trace: MessageSendPerfTrace | null | undefined,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  if (!trace || trace.finished || trace.userVisibleMarked) return;
  trace.userVisibleMarked = true;
  markMessageSendPerf(trace, 'ui.user_turn_visible', detail);
}

export function markMessageSendListCellsVisible(
  trace: MessageSendPerfTrace | null | undefined,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  if (!trace || trace.finished || trace.listCellsVisibleMarked) return;
  trace.listCellsVisibleMarked = true;
  markMessageSendPerf(trace, 'ui.list_cells_visible', detail);
}

export function markMessageSendAssistantVisible(
  trace: MessageSendPerfTrace | null | undefined,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  if (!trace || trace.finished || trace.assistantVisibleMarked) return;
  trace.assistantVisibleMarked = true;
  markMessageSendPerf(trace, 'ui.assistant_first_render', detail);
}

export function finishMessageSendPerf(
  trace: MessageSendPerfTrace | null | undefined,
  path: string,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  if (!trace || trace.finished) return;
  trace.finished = true;
  trace.path = path;
  const ms = Math.round(performance.now() - trace.startedAt);
  trace.log(`${LOG_TAG} DONE +${ms}ms path=${path}${formatDetail(detail)} trace=${trace.traceId} optimistic=${trace.optimisticId}`);
  if (activeTrace?.traceId === trace.traceId) {
    activeTrace = null;
  }
}

export function abortMessageSendPerf(
  trace: MessageSendPerfTrace | null | undefined,
  reason: string
): void {
  if (!trace || trace.finished) return;
  trace.finished = true;
  const ms = Math.round(performance.now() - trace.startedAt);
  trace.log(`${LOG_TAG} ABORT +${ms}ms reason=${reason} trace=${trace.traceId} optimistic=${trace.optimisticId}`);
  if (activeTrace?.traceId === trace.traceId) {
    activeTrace = null;
  }
}
