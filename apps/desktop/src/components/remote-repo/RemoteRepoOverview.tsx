import { ArrowLeft, Folder, GitBranch, GitFork, RefreshCw, SquareTerminal, WandSparkles } from "lucide-react";

import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import {
  formatRemoteRepoTime,
  getRemoteRepoOriginLabel,
  REMOTE_REPO_FILE_TREE_LABEL,
  REMOTE_REPO_GIT_NEXUS_LABEL,
} from "./remoteRepoData";
import { RemoteRepoStatusBadge } from "./RemoteRepoStatusBadge";
import type { RemoteRepo, RemoteRepoAction } from "./types";
import type { RemoteRepoBranch } from "./remoteRepoResources";

function CodeStatusCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 border-b border-border/80 px-4 py-3.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5 truncate text-sm text-foreground", mono && "font-mono text-[13px]")}>{value}</div>
    </div>
  );
}

export function RemoteRepoOverview({
  repo,
  branches,
  branchesBusy,
  branchError,
  selectedRef,
  gitNexusBusy,
  currentProjectLinked,
  notice,
  backLabel = "全部远程仓库",
  onBack,
  onSelectBranch,
  onRepoHeadGraphStatus,
  onRepoHeadGraphAnalyze,
  onAction,
  onSync,
}: {
  repo: RemoteRepo;
  branches: RemoteRepoBranch[];
  branchesBusy: boolean;
  branchError: string;
  selectedRef: string;
  gitNexusBusy: boolean;
  currentProjectLinked: boolean;
  notice: string;
  backLabel?: string;
  onBack: () => void;
  onSelectBranch: (branchName: string) => void;
  onRepoHeadGraphStatus: () => void;
  onRepoHeadGraphAnalyze: () => void;
  onAction: (action: RemoteRepoAction, workspaceId?: string) => void;
  onSync: () => void;
}) {
  const syncBlocked = repo.connectionStatus === "syncing" || repo.connectionStatus === "auth_required";
  const effectiveRef = selectedRef || repo.branch;
  const workspacesByBranch = repo.recentWorkspaces.reduce<Record<string, typeof repo.recentWorkspaces>>((groups, workspace) => {
    const key = workspace.branchName || "历史提交";
    groups[key] = groups[key] || [];
    groups[key].push(workspace);
    return groups;
  }, {});
  const workspaceGroups = Object.entries(workspacesByBranch).sort(([a], [b]) => {
    if (a === effectiveRef) return -1;
    if (b === effectiveRef) return 1;
    if (a === "历史提交") return 1;
    if (b === "历史提交") return -1;
    return a.localeCompare(b);
  });
  return (
    <main className="h-full overflow-auto bg-transparent" aria-label={`${repo.displayName} 远程仓库概览`}>
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
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">远程仓库 / 概览</span>
                {currentProjectLinked ? <span className="rounded-full border border-[color-mix(in_srgb,var(--accent)_32%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">当前项目关联</span> : null}
              </div>
              <h1 className="truncate text-xl font-semibold tracking-[-0.025em] text-foreground">{repo.displayName}</h1>
              <p className="mt-2 font-mono text-xs text-muted-foreground">{repo.id}</p>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              <RemoteRepoStatusBadge status={repo.connectionStatus} />
              <span className="text-xs text-muted-foreground">最近同步：{formatRemoteRepoTime(repo.lastSyncedAt)}</span>
            </div>
          </div>
          {repo.errorMessage ? <p className="mt-4 border-l-2 border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-sm text-foreground">{repo.errorMessage}</p> : null}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">当前分支上下文</h2>
            <span className="text-xs text-muted-foreground">同步只刷新远程元数据，不修改远端</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--gt-shadow-1)]">
            <div className="border-b border-border bg-[color-mix(in_srgb,var(--bg-soft)_68%,transparent)] px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">分支</span>
                <Button size="sm" variant="ghost" onClick={() => onAction("view_branches")}>
                  <GitBranch />
                  管理分支
                </Button>
              </div>
              <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
                {branchesBusy ? <span className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">正在读取分支…</span> : null}
                {!branchesBusy && branches.length ? branches.map((branch) => (
                  <button
                    className={cn("shrink-0 rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors", effectiveRef === branch.name ? "border-[color-mix(in_srgb,var(--accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]" : "border-border bg-background text-muted-foreground hover:text-foreground")}
                    key={branch.name}
                    type="button"
                    onClick={() => onSelectBranch(branch.name)}
                  >
                    {branch.name}
                    {branch.isDefault ? <span className="ml-1 font-sans text-[10px]">默认</span> : null}
                  </button>
                )) : null}
                {!branchesBusy && !branches.length ? <span className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">暂无分支数据</span> : null}
              </div>
              {branchError ? <p className="mt-2 text-xs text-[var(--danger)]">分支读取失败：{branchError}</p> : null}
            </div>
            <div className="grid grid-cols-2">
              <CodeStatusCell label="当前分支" value={effectiveRef} mono />
              <CodeStatusCell label="提交" value={repo.commit} mono />
              <CodeStatusCell label="GitNexus" value={REMOTE_REPO_GIT_NEXUS_LABEL[repo.gitNexusStatus]} />
              <CodeStatusCell label="文件树" value={REMOTE_REPO_FILE_TREE_LABEL[repo.fileTreeStatus]} />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              <Button size="sm" variant="outline" onClick={onRepoHeadGraphStatus} disabled={gitNexusBusy || repo.connectionStatus !== "connected"}>
                {gitNexusBusy ? <RefreshCw className="animate-spin" /> : <GitFork />}
                检查 GitNexus
              </Button>
              <Button size="sm" variant="contrast" onClick={onRepoHeadGraphAnalyze} disabled={gitNexusBusy || repo.connectionStatus !== "connected"}>
                {gitNexusBusy ? <RefreshCw className="animate-spin" /> : <WandSparkles />}
                分析当前分支
              </Button>
            </div>
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border border-border/80 bg-[color-mix(in_srgb,var(--bg-soft)_72%,transparent)] px-3 py-2 text-xs text-muted-foreground">
            <span className="shrink-0 font-medium text-foreground/80">来源</span>
            <span className="min-w-0 truncate font-mono">{getRemoteRepoOriginLabel(repo.originUrl)}</span>
            {repo.provider ? <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-medium text-foreground/80">{repo.provider}</span> : null}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">代码入口</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="contrast" onClick={() => onAction("browse_files")} disabled={repo.fileTreeStatus === "unavailable"}>
              <Folder />
              浏览文件
            </Button>
            <Button variant="outline" onClick={onSync} disabled={syncBlocked}>
              <RefreshCw className={repo.connectionStatus === "syncing" ? "animate-spin" : ""} />
              {repo.connectionStatus === "syncing" ? "同步中" : "同步"}
            </Button>
            <Button variant="outline" onClick={() => onAction("open_workspace")} disabled={repo.connectionStatus !== "connected"}>
              <SquareTerminal />
              打开远程工作区
            </Button>
          </div>
          {notice ? <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--accent)_26%,transparent)] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] px-3 py-2 text-sm text-foreground">{notice}</p> : null}
        </section>

        <section className="border-t border-border pt-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">工作台信息</h2>
            <span className="text-xs text-muted-foreground">不自动创建 workspace / session</span>
          </div>
          <div className="grid gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">最近工作区 / session</div>
              {workspaceGroups.length ? (
                <div className="space-y-4">
                  {workspaceGroups.map(([branchName, workspaces]) => (
                    <div key={branchName}>
                      <div className="mb-2 flex items-center gap-2">
                        <GitBranch className="size-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs text-foreground">{branchName}</span>
                        {branchName === effectiveRef ? <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">当前</span> : null}
                      </div>
                      <div className="space-y-2">
                        {workspaces.map((workspace) => (
                          <div key={workspace.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs text-foreground">{workspace.name}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {workspace.state === "expired" ? "服务端 session 已失效" : `最近使用：${formatRemoteRepoTime(workspace.updatedAt)}`}
                                {workspace.dirty ? " · 有改动" : ""}
                                {workspace.workspaceVersion > 1 ? ` · v${workspace.workspaceVersion}` : ""}
                              </p>
                            </div>
                            {workspace.state === "expired" ? <span className="shrink-0 text-xs text-muted-foreground">不可恢复</span> : (
                              <Button size="sm" variant="outline" onClick={() => onAction("resume_workspace", workspace.id)}>继续工作</Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">暂无最近工作区或 session。</p>}
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">最近活动</div>
              <div className="space-y-3">
                {repo.recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 text-foreground">{activity.summary}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRemoteRepoTime(activity.occurredAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
