import { toText } from '../../lib/text';

export type RefLike<T> = { current: T };

export type StreamPartEvent =
  | { kind: 'delta'; payload: unknown }
  | { kind: 'part'; payload: unknown }
  | { kind: 'part_removed'; payload: unknown };

export type OpenCodeStreamStoreRefs = {
  messageRole: RefLike<Record<string, Record<string, string>>>;
  message: RefLike<Record<string, Record<string, any>>>;
  part: RefLike<Record<string, Record<string, Record<string, any>>>>;
  sessionStatus: RefLike<Record<string, any>>;
  permission: RefLike<Record<string, any[]>>;
  question: RefLike<Record<string, any[]>>;
  todo: RefLike<Record<string, any[]>>;
  pendingPartEvents: RefLike<Record<string, Record<string, StreamPartEvent[]>>>;
  rawRows: RefLike<Record<string, any[]>>;
};

const SKIP_PARTS = new Set(['patch', 'step-start', 'step-finish']);

export function rawMessageRole(row: any) {
  return toText(row?.info?.role || row?.role).trim();
}

export function rawMessageId(row: any) {
  return toText(row?.info?.id || row?.id).trim();
}

export function rawMessageCreatedAt(row: any) {
  const raw = Number(row?.info?.time?.created || row?.createdAt || row?.time?.created || row?.info?.createdAt || 0);
  return Number.isFinite(raw) ? raw : 0;
}

export function rawPartId(part: any, index = 0) {
  return toText(part?.id || part?.partID || part?.callID).trim() || `${toText(part?.type).trim() || 'part'}:${index}`;
}

export function mergeStreamPart(prev: any, incoming: any) {
  const next = { ...(prev || {}), ...(incoming || {}) };
  const prevText = typeof prev?.text === 'string' ? prev.text : '';
  const incomingText = typeof incoming?.text === 'string' ? incoming.text : '';
  if (prevText && (!incomingText || incomingText.length < prevText.length)) {
    next.text = prevText;
  }
  return next;
}

export function shouldStoreStreamPart(part: any) {
  return !SKIP_PARTS.has(toText(part?.type).trim());
}

export function resetOpenCodeStreamStores(stores: OpenCodeStreamStoreRefs) {
  stores.messageRole.current = {};
  stores.message.current = {};
  stores.part.current = {};
  stores.sessionStatus.current = {};
  stores.permission.current = {};
  stores.question.current = {};
  stores.todo.current = {};
  stores.pendingPartEvents.current = {};
}

function sortedUpsert(list: any[] | undefined, item: any, id: string) {
  if (!id) return list || [];
  const next = [...(Array.isArray(list) ? list : [])];
  const index = next.findIndex((row) => toText(row?.id).trim() === id);
  if (index >= 0) next[index] = { ...next[index], ...item, id };
  else next.push({ ...item, id });
  return next.sort((a, b) => toText(a?.id).localeCompare(toText(b?.id)));
}

function removeByRequestId(list: any[] | undefined, requestID: string) {
  const id = toText(requestID).trim();
  if (!id || !Array.isArray(list)) return list || [];
  return list.filter((item) => toText(item?.id).trim() !== id);
}

export function setStreamSessionStatus(stores: OpenCodeStreamStoreRefs, sessionID: string, status: any) {
  const sid = toText(sessionID).trim();
  if (!sid || !status || typeof status !== 'object') return;
  stores.sessionStatus.current[sid] = status;
}

export function upsertStreamPermission(stores: OpenCodeStreamStoreRefs, permission: any) {
  const sid = toText(permission?.sessionID).trim();
  const id = toText(permission?.id).trim();
  if (!sid || !id) return;
  stores.permission.current[sid] = sortedUpsert(stores.permission.current[sid], permission, id);
}

export function removeStreamPermission(stores: OpenCodeStreamStoreRefs, sessionID: string, requestID: string) {
  const sid = toText(sessionID).trim();
  if (!sid) return;
  stores.permission.current[sid] = removeByRequestId(stores.permission.current[sid], requestID);
}

export function upsertStreamQuestion(stores: OpenCodeStreamStoreRefs, question: any) {
  const sid = toText(question?.sessionID).trim();
  const id = toText(question?.id).trim();
  if (!sid || !id) return;
  stores.question.current[sid] = sortedUpsert(stores.question.current[sid], question, id);
}

export function removeStreamQuestion(stores: OpenCodeStreamStoreRefs, sessionID: string, requestID: string) {
  const sid = toText(sessionID).trim();
  if (!sid) return;
  stores.question.current[sid] = removeByRequestId(stores.question.current[sid], requestID);
}

export function setStreamTodos(stores: OpenCodeStreamStoreRefs, sessionID: string, todos: any[]) {
  const sid = toText(sessionID).trim();
  if (!sid) return;
  stores.todo.current[sid] = Array.isArray(todos) ? todos : [];
}

export function ensureStreamSessionStores(stores: OpenCodeStreamStoreRefs, targetSessionId: string) {
  const sid = toText(targetSessionId).trim();
  if (!sid) return '';
  if (!stores.message.current[sid]) stores.message.current[sid] = {};
  if (!stores.part.current[sid]) stores.part.current[sid] = {};
  if (!stores.messageRole.current[sid]) stores.messageRole.current[sid] = {};
  return sid;
}

export function composeStreamRows(stores: OpenCodeStreamStoreRefs, targetSessionId: string) {
  const sid = toText(targetSessionId).trim();
  const messages = stores.message.current[sid] || {};
  const partsByMessage = stores.part.current[sid] || {};
  return Object.values(messages)
    .map((info: any) => {
      const mid = toText(info?.id).trim();
      const partMap = partsByMessage[mid] || {};
      const parts = Object.values(partMap).sort((a: any, b: any) => rawPartId(a).localeCompare(rawPartId(b)));
      return { info, parts };
    })
    .sort((a: any, b: any) => {
      const ta = rawMessageCreatedAt(a);
      const tb = rawMessageCreatedAt(b);
      if (ta !== tb) return ta - tb;
      return rawMessageId(a).localeCompare(rawMessageId(b));
    });
}

export function publishStreamRows(stores: OpenCodeStreamStoreRefs, targetSessionId: string) {
  const rows = composeStreamRows(stores, targetSessionId);
  stores.rawRows.current[targetSessionId] = rows;
  return rows;
}

export function ingestStreamRows(stores: OpenCodeStreamStoreRefs, targetSessionId: string, rows: any[]) {
  const sid = ensureStreamSessionStores(stores, targetSessionId);
  if (!sid || !Array.isArray(rows)) return publishStreamRows(stores, targetSessionId);
  const messageStore = stores.message.current[sid];
  const partStore = stores.part.current[sid];
  const roleStore = stores.messageRole.current[sid];
  for (const row of rows) {
    const mid = rawMessageId(row);
    if (!mid) continue;
    const incomingInfo = row?.info && typeof row.info === 'object'
      ? row.info
      : { id: mid, role: rawMessageRole(row), time: row?.time || undefined };
    const prevInfo = messageStore[mid] || {};
    messageStore[mid] = { ...prevInfo, ...incomingInfo, id: mid };
    const role = rawMessageRole({ info: messageStore[mid] });
    if (role) roleStore[mid] = role;
    const parts = Array.isArray(row?.parts) ? row.parts : [];
    if (!partStore[mid]) partStore[mid] = {};
    parts.forEach((part: any, index: number) => {
      if (!shouldStoreStreamPart(part)) return;
      const pid = rawPartId(part, index);
      partStore[mid][pid] = mergeStreamPart(partStore[mid][pid], { ...part, id: pid, messageID: mid });
    });
  }
  return publishStreamRows(stores, sid);
}

export function getKnownStreamMessageRole(stores: OpenCodeStreamStoreRefs, targetSessionId: string, messageId: string) {
  const sid = toText(targetSessionId).trim();
  const mid = toText(messageId).trim();
  if (!sid || !mid) return '';
  const cached = stores.messageRole.current[sid]?.[mid] || '';
  if (cached) return cached;
  const hit = stores.message.current[sid]?.[mid];
  if (hit) return rawMessageRole({ info: hit });
  const raw = stores.rawRows.current[sid] || [];
  return rawMessageRole(raw.find((row) => rawMessageId(row) === mid));
}

export function getStoredStreamPart(stores: OpenCodeStreamStoreRefs, targetSessionId: string, messageId: string, partId: string) {
  const sid = toText(targetSessionId).trim();
  const mid = toText(messageId).trim();
  const pid = toText(partId).trim();
  if (!sid || !mid || !pid) return undefined;
  return stores.part.current[sid]?.[mid]?.[pid];
}

export function patchStoredStreamPartDelta(
  stores: OpenCodeStreamStoreRefs,
  targetSessionId: string,
  messageId: string,
  partId: string,
  field: string,
  delta: string
) {
  const sid = ensureStreamSessionStores(stores, targetSessionId);
  const mid = toText(messageId).trim();
  const pid = toText(partId).trim();
  if (!sid || !mid || !pid || !field || !delta) return false;
  const byMessage = stores.part.current[sid] || {};
  const partMap = byMessage[mid] || {};
  const current = partMap[pid];
  if (!current) return false;
  const nextPart = { ...current, [field]: `${toText(current[field])}${delta}` };
  byMessage[mid] = { ...partMap, [pid]: nextPart };
  stores.part.current[sid] = byMessage;
  publishStreamRows(stores, sid);
  return true;
}
