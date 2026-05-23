import { mergeOpencodeStreamText } from '../../lib/opencodeParts';
import { toText } from '../../lib/text';
import { mergeMessageRows } from './turns';

export type RefLike<T> = { current: T };

export type StreamPartEvent =
  | { kind: 'delta'; payload: unknown }
  | { kind: 'part'; payload: unknown }
  | { kind: 'part_removed'; payload: unknown };

/** Ordered part list per message — matches OpenCode Web `part[messageID]` binary insert by id. */
export type StreamPartBucket = {
  order: string[];
  byId: Record<string, any>;
};

export type OpenCodeStreamStoreRefs = {
  messageRole: RefLike<Record<string, Record<string, string>>>;
  message: RefLike<Record<string, Record<string, any>>>;
  part: RefLike<Record<string, Record<string, StreamPartBucket>>>;
  sessionStatus: RefLike<Record<string, any>>;
  permission: RefLike<Record<string, any[]>>;
  question: RefLike<Record<string, any[]>>;
  todo: RefLike<Record<string, any[]>>;
  pendingPartEvents: RefLike<Record<string, Record<string, StreamPartEvent[]>>>;
  rawRows: RefLike<Record<string, any[]>>;
};

export const SKIP_STREAM_PART_TYPES = new Set(['patch', 'step-start', 'step-finish']);

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

export function emptyStreamPartBucket(): StreamPartBucket {
  return { order: [], byId: {} };
}

function binaryPartInsertIndex(order: string[], partId: string) {
  let left = 0;
  let right = order.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (order[mid] < partId) left = mid + 1;
    else right = mid;
  }
  return left;
}

export function mergeStreamPart(prev: any, incoming: any) {
  const next = { ...(prev || {}), ...(incoming || {}) };
  const prevText = typeof prev?.text === 'string' ? prev.text : '';
  const incomingText = typeof incoming?.text === 'string' ? incoming.text : '';
  if (prevText || incomingText) {
    next.text = mergeOpencodeStreamText(prevText, incomingText);
  }
  return next;
}

export function shouldStoreStreamPart(part: any) {
  return !SKIP_STREAM_PART_TYPES.has(toText(part?.type).trim());
}

export function listBucketParts(bucket: StreamPartBucket | undefined): any[] {
  if (!bucket) return [];
  return bucket.order.map((id) => bucket.byId[id]).filter(Boolean);
}

export function upsertStreamPartBucket(
  bucket: StreamPartBucket,
  part: any,
  opts?: { preserveApiOrder?: boolean },
) {
  if (!shouldStoreStreamPart(part)) return bucket;
  const pid = rawPartId(part);
  if (!pid) return bucket;
  const merged = mergeStreamPart(bucket.byId[pid], { ...part, id: pid });
  bucket.byId[pid] = merged;
  if (opts?.preserveApiOrder) {
    if (!bucket.order.includes(pid)) bucket.order.push(pid);
    return bucket;
  }
  if (!bucket.order.includes(pid)) {
    const index = binaryPartInsertIndex(bucket.order, pid);
    bucket.order.splice(index, 0, pid);
  }
  return bucket;
}

export function ingestSnapshotPartsIntoBucket(prev: StreamPartBucket, parts: any[]): StreamPartBucket {
  const apiOrder: string[] = [];
  const byId: Record<string, any> = {};
  parts.forEach((part, index) => {
    if (!shouldStoreStreamPart(part)) return;
    const pid = rawPartId(part, index);
    if (!pid) return;
    if (!apiOrder.includes(pid)) apiOrder.push(pid);
    byId[pid] = mergeStreamPart(prev.byId[pid], { ...part, id: pid });
  });
  if (apiOrder.length <= 0) return prev;
  return { order: apiOrder, byId };
}

export function removeStreamPartFromBucket(bucket: StreamPartBucket, partId: string) {
  const pid = toText(partId).trim();
  if (!pid || !bucket.byId[pid]) return bucket;
  delete bucket.byId[pid];
  bucket.order = bucket.order.filter((id) => id !== pid);
  return bucket;
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
      const parts = listBucketParts(partsByMessage[mid]);
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
  const sid = toText(targetSessionId).trim();
  if (!sid) return [];
  const composed = composeStreamRows(stores, targetSessionId);
  const prevRaw = Array.isArray(stores.rawRows.current[sid]) ? stores.rawRows.current[sid] : [];
  if (composed.length <= 0) return prevRaw;
  const merged = prevRaw.length > 0 ? mergeMessageRows(prevRaw, composed) : composed;
  stores.rawRows.current[sid] = merged;
  return merged;
}

function applyRowsToStreamStores(stores: OpenCodeStreamStoreRefs, targetSessionId: string, rows: any[]) {
  const sid = ensureStreamSessionStores(stores, targetSessionId);
  if (!sid || !Array.isArray(rows)) return sid;
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
    const prevBucket = partStore[mid] || emptyStreamPartBucket();
    partStore[mid] = parts.length > 0
      ? ingestSnapshotPartsIntoBucket(prevBucket, parts)
      : prevBucket;
  }
  return sid;
}

/** Authoritative server snapshot — replaces stream store and raw rows (after prompt / SSE messages). */
export function replaceStreamRows(stores: OpenCodeStreamStoreRefs, targetSessionId: string, rows: any[]) {
  const sid = toText(targetSessionId).trim();
  if (!sid || !Array.isArray(rows)) return stores.rawRows.current[sid] || [];
  stores.message.current[sid] = {};
  stores.part.current[sid] = {};
  stores.messageRole.current[sid] = {};
  applyRowsToStreamStores(stores, sid, rows);
  const composed = composeStreamRows(stores, sid);
  stores.rawRows.current[sid] = composed;
  return composed;
}

export function ingestStreamRows(stores: OpenCodeStreamStoreRefs, targetSessionId: string, rows: any[]) {
  const sid = applyRowsToStreamStores(stores, targetSessionId, rows);
  if (!sid) return publishStreamRows(stores, targetSessionId);
  return publishStreamRows(stores, sid);
}

export function upsertStreamPartRecord(
  stores: OpenCodeStreamStoreRefs,
  targetSessionId: string,
  messageId: string,
  part: any,
) {
  const sid = ensureStreamSessionStores(stores, targetSessionId);
  const mid = toText(messageId).trim();
  if (!sid || !mid || !shouldStoreStreamPart(part)) return;
  const partStore = stores.part.current[sid];
  const bucket = partStore[mid] || emptyStreamPartBucket();
  upsertStreamPartBucket(bucket, { ...part, messageID: mid });
  partStore[mid] = bucket;
}

export function removeStreamPartRecord(
  stores: OpenCodeStreamStoreRefs,
  targetSessionId: string,
  messageId: string,
  partId: string,
) {
  const sid = ensureStreamSessionStores(stores, targetSessionId);
  const mid = toText(messageId).trim();
  const pid = toText(partId).trim();
  if (!sid || !mid || !pid) return;
  const bucket = stores.part.current[sid]?.[mid];
  if (!bucket) return;
  removeStreamPartFromBucket(bucket, pid);
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
  return stores.part.current[sid]?.[mid]?.byId[pid];
}

export function resolveStreamPartWriteField(part: any, field: string): string {
  const key = toText(field).trim();
  if (key) return key;
  return 'text';
}

export function patchStoredStreamPartDelta(
  stores: OpenCodeStreamStoreRefs,
  targetSessionId: string,
  messageId: string,
  partId: string,
  field: string,
  delta: string,
  partTypeHint?: string,
) {
  const sid = ensureStreamSessionStores(stores, targetSessionId);
  const mid = toText(messageId).trim();
  const pid = toText(partId).trim();
  if (!sid || !mid || !pid || !delta) return false;
  const partStore = stores.part.current[sid];
  let bucket = partStore[mid];
  if (!bucket) {
    bucket = emptyStreamPartBucket();
    partStore[mid] = bucket;
  }
  let current = bucket.byId[pid];
  if (!current) {
    const type = toText(partTypeHint).trim() || (toText(field).trim() === 'reasoning' ? 'reasoning' : 'text');
    current = { id: pid, messageID: mid, type, text: '' };
    upsertStreamPartBucket(bucket, current);
    current = bucket.byId[pid];
  }
  const writeField = resolveStreamPartWriteField(current, field);
  const nextPart = { ...current, [writeField]: `${toText(current[writeField])}${delta}` };
  bucket.byId[pid] = nextPart;
  publishStreamRows(stores, sid);
  return true;
}
