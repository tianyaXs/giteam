export type OpencodePermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  always?: string[];
  metadata?: Record<string, unknown>;
  tool?: { messageID?: string; callID?: string };
};

export type OpencodePermissionReply = "once" | "always" | "reject";

export function parseOpencodePermissionRequests(raw: unknown): OpencodePermissionRequest[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((item: any): OpencodePermissionRequest | null => {
      const id = String(item?.id || "").trim();
      const sessionID = String(item?.sessionID || "").trim();
      if (!id || !sessionID) return null;
      return {
        id,
        sessionID,
        permission: String(item?.permission || ""),
        patterns: Array.isArray(item?.patterns) ? item.patterns.map((value: unknown) => String(value || "")).filter(Boolean) : [],
        always: Array.isArray(item?.always) ? item.always.map((value: unknown) => String(value || "")).filter(Boolean) : [],
        metadata: item?.metadata || undefined,
        tool: item?.tool || undefined
      };
    })
    .filter(Boolean) as OpencodePermissionRequest[];
}

export function filterPermissionsBySession(
  rows: OpencodePermissionRequest[],
  sessionId: string
): OpencodePermissionRequest[] {
  const id = sessionId.trim();
  return id ? rows.filter((row) => row.sessionID === id) : rows;
}

export function removePermissionsById(
  rows: OpencodePermissionRequest[],
  ids: Set<string>
): OpencodePermissionRequest[] {
  return rows.filter((row) => !ids.has(row.id));
}

export function replaceSessionPermissions(
  previous: OpencodePermissionRequest[],
  nextRows: OpencodePermissionRequest[],
  sessionId: string
): OpencodePermissionRequest[] {
  const id = sessionId.trim();
  const rest = id ? previous.filter((row) => row.sessionID !== id) : [];
  return [...rest, ...nextRows];
}

export function upsertPermissionRequest(
  previous: OpencodePermissionRequest[],
  request: OpencodePermissionRequest
): OpencodePermissionRequest[] {
  if (!request?.id) return previous;
  return [...previous.filter((item) => item.id !== request.id), request];
}
