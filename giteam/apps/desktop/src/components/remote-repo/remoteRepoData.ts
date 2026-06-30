import type { RemoteRepo, RemoteRepoConnectionStatus, RemoteRepoFileTreeStatus, RemoteRepoGitNexusStatus } from "./types";

export const REMOTE_REPO_CONNECTION_META: Record<RemoteRepoConnectionStatus, { label: string; dotClassName: string; badgeClassName: string }> = {
  connected: {
    label: "已连接",
    dotClassName: "bg-[var(--success)]",
    badgeClassName: "border-[color-mix(in_srgb,var(--success)_34%,transparent)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]",
  },
  syncing: {
    label: "同步中",
    dotClassName: "bg-[var(--accent)] animate-pulse",
    badgeClassName: "border-[color-mix(in_srgb,var(--accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]",
  },
  auth_required: {
    label: "需要授权",
    dotClassName: "bg-[var(--warning)]",
    badgeClassName: "border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[color-mix(in_srgb,var(--warning)_13%,transparent)] text-[var(--warning)]",
  },
  failed: {
    label: "连接失败",
    dotClassName: "bg-[var(--danger)]",
    badgeClassName: "border-[color-mix(in_srgb,var(--danger)_38%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]",
  },
  stale: {
    label: "需要同步",
    dotClassName: "bg-muted-foreground",
    badgeClassName: "border-border bg-muted text-muted-foreground",
  },
};

export const REMOTE_REPO_GIT_NEXUS_LABEL: Record<RemoteRepoGitNexusStatus, string> = {
  unknown: "状态未检查",
  ready: "已索引",
  indexing: "索引中",
  not_indexed: "需要分析",
  unavailable: "不可用",
};

export const REMOTE_REPO_FILE_TREE_LABEL: Record<RemoteRepoFileTreeStatus, string> = {
  ready: "可浏览",
  loading: "正在检查",
  unavailable: "暂不可用",
};

export function prioritizeRemoteRepos(repos: RemoteRepo[], currentProjectId: string): RemoteRepo[] {
  const projectId = currentProjectId.trim();
  return repos
    .map((repo, index) => ({ repo, index }))
    .sort((a, b) => {
      const aPinned = Boolean(a.repo.pinned);
      const bPinned = Boolean(b.repo.pinned);
      if (aPinned !== bPinned) return Number(bPinned) - Number(aPinned);
      const aLinked = projectId && a.repo.linkedProjectIds.includes(projectId) ? 1 : 0;
      const bLinked = projectId && b.repo.linkedProjectIds.includes(projectId) ? 1 : 0;
      if (aLinked !== bLinked) return bLinked - aLinked;
      if (a.repo.lastAccessedAt !== b.repo.lastAccessedAt) return b.repo.lastAccessedAt - a.repo.lastAccessedAt;
      const aSortOrder = a.repo.sortOrder || 0;
      const bSortOrder = b.repo.sortOrder || 0;
      if (aSortOrder !== bSortOrder) return aSortOrder - bSortOrder;
      return a.index - b.index;
    })
    .map(({ repo }) => repo);
}

export function getDefaultRemoteRepo(repos: RemoteRepo[], currentProjectId: string): RemoteRepo | null {
  return prioritizeRemoteRepos(repos, currentProjectId)[0] || null;
}

export function getVisibleRemoteRepos(repos: RemoteRepo[], currentProjectId: string, limit = 3): { repos: RemoteRepo[]; hiddenCount: number } {
  const ordered = prioritizeRemoteRepos(repos, currentProjectId);
  const visibleLimit = Math.max(1, limit);
  return {
    repos: ordered.slice(0, visibleLimit),
    hiddenCount: Math.max(0, ordered.length - visibleLimit),
  };
}

export function getRemoteRepoOriginLabel(originUrl: string): string {
  const source = originUrl.trim();
  if (!source) return "未提供来源";
  const ssh = source.match(/^(?:[^@]+@)?([^:/]+)[:/]([^/]+\/.+?)\/?$/);
  if (ssh && !source.includes("://")) return `${ssh[1]}/${ssh[2].replace(/\.git$/, "")}`;

  try {
    const url = new URL(source);
    return `${url.host}/${url.pathname.replace(/^\//, "").replace(/\.git$/, "").replace(/\/$/, "")}`;
  } catch {
    return source.replace(/^[^@/]+@/, "").replace(/\.git$/, "");
  }
}

export function formatRemoteRepoTime(timestamp?: number): string {
  if (!timestamp) return "尚未同步";
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
