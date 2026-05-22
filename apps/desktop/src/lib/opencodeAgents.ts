export type OpencodeAgentInfo = {
  name: string;
  description?: string;
  mode?: "primary" | "subagent" | "all";
  native?: boolean;
  hidden?: boolean;
  color?: string;
  variant?: string;
  model?: { providerID?: string; modelID?: string };
};

export function parseOpencodeAgents(raw: unknown): OpencodeAgentInfo[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((item: any): OpencodeAgentInfo | null => {
      const name = String(item?.name || "").trim();
      if (!name) return null;
      return {
        name,
        description: String(item?.description || ""),
        mode: item?.mode === "subagent" || item?.mode === "primary" || item?.mode === "all" ? item.mode : undefined,
        native: Boolean(item?.native),
        hidden: Boolean(item?.hidden),
        color: String(item?.color || ""),
        variant: String(item?.variant || ""),
        model: item?.model || undefined
      };
    })
    .filter(Boolean) as OpencodeAgentInfo[];
}
