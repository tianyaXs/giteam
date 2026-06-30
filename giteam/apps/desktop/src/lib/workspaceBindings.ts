export type WorkspaceAgentBinding = {
  workspacePath: string;
  branch: string;
  activeSessionId: string;
  sessionIds: string[];
  updatedAt: number;
};

const WORKSPACE_AGENT_BINDINGS_KEY = "giteam.workspace-agent-bindings.v1";
const BRANCH_PARENT_MAP_KEY = "giteam.branch-parent-map.v1";
const WORKTREE_PARENT_MAP_KEY = "giteam.worktree-parent-map.v1";

export function normalizeWorkspacePath(path: string): string {
  return path.trim();
}

export function readWorkspaceAgentBindings(): Record<string, WorkspaceAgentBinding> {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_AGENT_BINDINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WorkspaceAgentBinding> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, WorkspaceAgentBinding> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const workspacePath = normalizeWorkspacePath(value?.workspacePath || key);
      const activeSessionId = String(value?.activeSessionId || "").trim();
      if (!workspacePath || !activeSessionId) continue;
      out[workspacePath] = {
        workspacePath,
        branch: String(value?.branch || "").trim(),
        activeSessionId,
        sessionIds: Array.isArray(value?.sessionIds) ? value.sessionIds.map((id) => String(id || "").trim()).filter(Boolean) : [activeSessionId],
        updatedAt: Number(value?.updatedAt || Date.now())
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeWorkspaceAgentBindings(bindings: Record<string, WorkspaceAgentBinding>): void {
  try {
    window.localStorage.setItem(WORKSPACE_AGENT_BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // localStorage may be unavailable in restricted WebViews.
  }
}

export function readBranchParentMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(BRANCH_PARENT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [child, parent] of Object.entries(parsed)) {
      const c = child.trim();
      const p = String(parent || "").trim();
      if (c && p && c !== p) out[c] = p;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeBranchParentMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(BRANCH_PARENT_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore unavailable storage
  }
}

export function readWorktreeParentMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(WORKTREE_PARENT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [path, branch] of Object.entries(parsed)) {
      const p = normalizeWorkspacePath(path);
      const b = String(branch || "").trim();
      if (p && b) out[p] = b;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeWorktreeParentMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(WORKTREE_PARENT_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore unavailable storage
  }
}
