export type SessionSwitchPerfTrace = {
  traceId: string;
  targetSid: string;
  fromSid: string;
  startedAt: number;
  log: (message: string) => void;
  finished: boolean;
  path?: string;
};

const LOG_TAG = 'session.perf';

let activeTrace: SessionSwitchPerfTrace | null = null;

export function getActiveSessionSwitchTrace(): SessionSwitchPerfTrace | null {
  return activeTrace;
}

export function setActiveSessionSwitchTrace(trace: SessionSwitchPerfTrace | null): void {
  activeTrace = trace;
}

function formatDetail(detail?: Record<string, string | number | boolean | undefined>): string {
  if (!detail) return '';
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function startSessionSwitchPerf(params: {
  targetSid: string;
  fromSid?: string;
  log: (message: string) => void;
}): SessionSwitchPerfTrace {
  const trace: SessionSwitchPerfTrace = {
    traceId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    targetSid: params.targetSid,
    fromSid: params.fromSid || '',
    startedAt: performance.now(),
    log: params.log,
    finished: false
  };
  setActiveSessionSwitchTrace(trace);
  trace.log(
    `${LOG_TAG} START trace=${trace.traceId} from=${trace.fromSid || '-'} to=${trace.targetSid}`
  );
  return trace;
}

export function markSessionSwitchPerf(
  trace: SessionSwitchPerfTrace | null | undefined,
  step: string,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  if (!trace || trace.finished) return;
  const ms = Math.round(performance.now() - trace.startedAt);
  trace.log(`${LOG_TAG} +${ms}ms ${step}${formatDetail(detail)} trace=${trace.traceId}`);
}

export function markSessionSwitchPerfForSid(
  targetSid: string,
  step: string,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  const trace = activeTrace;
  if (!trace || trace.finished || trace.targetSid !== targetSid) return;
  markSessionSwitchPerf(trace, step, detail);
}

export function finishSessionSwitchPerf(
  trace: SessionSwitchPerfTrace | null | undefined,
  path: string,
  detail?: Record<string, string | number | boolean | undefined>
): void {
  if (!trace || trace.finished) return;
  trace.finished = true;
  trace.path = path;
  const ms = Math.round(performance.now() - trace.startedAt);
  trace.log(`${LOG_TAG} DONE +${ms}ms path=${path}${formatDetail(detail)} trace=${trace.traceId}`);
  if (activeTrace?.traceId === trace.traceId) {
    activeTrace = null;
  }
}

export function abortSessionSwitchPerf(
  trace: SessionSwitchPerfTrace | null | undefined,
  reason: string
): void {
  if (!trace || trace.finished) return;
  trace.finished = true;
  const ms = Math.round(performance.now() - trace.startedAt);
  trace.log(`${LOG_TAG} ABORT +${ms}ms reason=${reason} trace=${trace.traceId}`);
  if (activeTrace?.traceId === trace.traceId) {
    activeTrace = null;
  }
}
