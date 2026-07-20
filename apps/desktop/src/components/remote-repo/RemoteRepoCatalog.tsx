import { ArrowLeft, Plus, RefreshCw } from "lucide-react";

import { Button } from "../ui/button";
import { prioritizeRemoteRepos } from "./remoteRepoData";
import { RemoteRepoListItem } from "./RemoteRepoListItem";
import type { RemoteRepo } from "./types";

export function RemoteRepoCatalog({
  repos,
  currentProjectId,
  loading,
  error,
  refreshing,
  backLabel = "关闭远程仓库",
  onBack,
  onOpenRepo,
  onImport,
  onReload,
  onEditRepo,
  onSyncRepo,
  onRemoveRepo,
  onTogglePin,
}: {
  repos: RemoteRepo[];
  currentProjectId: string;
  loading: boolean;
  error: string;
  refreshing: boolean;
  backLabel?: string;
  onBack: () => void;
  onOpenRepo: (repo: RemoteRepo) => void;
  onImport: () => void;
  onReload: () => void;
  onEditRepo: (repo: RemoteRepo) => void;
  onSyncRepo: (repo: RemoteRepo) => void;
  onRemoveRepo: (repo: RemoteRepo) => void;
  onTogglePin: (repo: RemoteRepo) => void;
}) {
  const ordered = prioritizeRemoteRepos(repos, currentProjectId);
  return (
    <main className="h-full overflow-auto bg-transparent" aria-label="全部远程仓库">
      <div className="flex w-full flex-col gap-5 px-4 pb-6 pt-4">
        <button
          type="button"
          className="-mb-2 inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </button>
        <section className="border-b border-border pb-6">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">远程仓库 / 连接列表</p>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">全部远程仓库</h1>
            <span className="text-sm text-muted-foreground">{repos.length} 个连接</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">当前项目相关仓库优先排列；选择一个仓库查看代码状态与入口。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="contrast" onClick={onImport}><Plus />引入仓库</Button>
            <Button size="sm" variant="outline" disabled={refreshing} onClick={onReload}><RefreshCw className={refreshing ? "animate-spin" : ""} />刷新</Button>
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--gt-shadow-1)]">
          {loading ? <p className="px-4 py-8 text-sm text-muted-foreground">正在读取远程连接…</p> : null}
          {!loading && error ? <p className="border-l-2 border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] px-4 py-4 text-sm text-foreground">无法读取远程连接：{error}</p> : null}
          {!loading && !error && ordered.length === 0 ? <p className="px-4 py-8 text-sm text-muted-foreground">还没有远程仓库连接。</p> : null}
          {!loading && !error ? ordered.map((repo) => {
            const linked = Boolean(currentProjectId) && repo.linkedProjectIds.includes(currentProjectId);
            return (
              <RemoteRepoListItem
                key={repo.id}
                repo={repo}
                currentProjectLinked={linked}
                onOpen={() => onOpenRepo(repo)}
                onEdit={() => onEditRepo(repo)}
                onSync={() => onSyncRepo(repo)}
                onRemove={() => onRemoveRepo(repo)}
                onTogglePin={() => onTogglePin(repo)}
              />
            );
          }) : null}
        </section>
        <div className="text-center">
          <Button variant="outline" onClick={onBack}>{backLabel}</Button>
        </div>
      </div>
    </main>
  );
}
