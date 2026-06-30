import { ArrowLeft, ChevronRight, FileCode2, Folder, FolderOpen, GitBranch, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { listRemoteRepoBranches, listRemoteRepoFiles, readRemoteRepoFile } from "./remoteRepoApi";
import type { RemoteRepo } from "./types";
import type { RemoteRepoBranch, RemoteRepoFileContent, RemoteRepoFileTree } from "./remoteRepoResources";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type ResourceMode = "branches" | "files";

function shortCommit(commit: string): string {
  return commit ? commit.slice(0, 7) : "—";
}

function ErrorCallout({ message }: { message: string }) {
  return <p className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-sm text-foreground">{message}</p>;
}

function LoadingRow({ label }: { label: string }) {
  return <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><RefreshCw className="size-3.5 animate-spin" />{label}</div>;
}

export function RemoteRepoCodeResourcePanel({
  repo,
  mode,
  selectedRef,
  onSelectBranch,
  onBack,
}: {
  repo: RemoteRepo;
  mode: ResourceMode;
  selectedRef: string;
  onSelectBranch: (branchName: string) => void;
  onBack: () => void;
}) {
  const [branches, setBranches] = useState<RemoteRepoBranch[]>([]);
  const [tree, setTree] = useState<RemoteRepoFileTree | null>(null);
  const [selectedFile, setSelectedFile] = useState<RemoteRepoFileContent | null>(null);
  const [path, setPath] = useState(".");
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState("");

  const breadcrumbParts = useMemo(() => path === "." ? [] : path.split("/"), [path]);

  useEffect(() => {
    setPath(".");
    setTree(null);
    setSelectedFile(null);
    setError("");
  }, [mode, repo.id, selectedRef]);

  useEffect(() => {
    if (mode !== "branches") return;
    let cancelled = false;
    setBusy(true);
    setError("");
    void listRemoteRepoBranches(repo.id)
      .then((rows) => { if (!cancelled) setBranches(rows); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [mode, repo.id]);

  useEffect(() => {
    if (mode !== "files") return;
    let cancelled = false;
    setBusy(true);
    setError("");
    void listRemoteRepoFiles(repo.id, path, selectedRef || repo.branch)
      .then((result) => { if (!cancelled) setTree(result); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [mode, path, repo.branch, repo.id, selectedRef]);

  async function openFile(filePath: string) {
    setFileBusy(true);
    setError("");
    try {
      setSelectedFile(await readRemoteRepoFile(repo.id, filePath, selectedRef || repo.branch));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setFileBusy(false);
    }
  }

  const title = mode === "branches" ? "分支" : "文件浏览";
  const subtitle = mode === "branches"
    ? "只读展示镜像中的分支与提交，不创建 workspace / session。"
    : "直接读取已同步的仓库镜像；不创建 workspace / session。";

  return (
    <main className="h-full overflow-auto bg-transparent" aria-label={`${repo.displayName} ${title}`}>
      <div className="flex w-full flex-col gap-5 px-4 pb-6 pt-4">
        <button
          type="button"
          className="-mb-2 inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" />
          返回仓库概览
        </button>

        <section className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {mode === "branches" ? <GitBranch className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                代码资源 / {title}
              </div>
              <h1 className="truncate text-xl font-semibold tracking-[-0.025em] text-foreground">{repo.displayName}</h1>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{subtitle}</p>
            </div>
            <span className="shrink-0 rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground">{selectedRef || repo.branch}@{repo.commit}</span>
          </div>
        </section>

        {error ? <ErrorCallout message={error} /> : null}

        {mode === "branches" ? (
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--gt-shadow-1)]">
            <div className="flex items-center justify-between border-b border-border bg-[color-mix(in_srgb,var(--bg-soft)_65%,transparent)] px-3 py-2.5">
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">镜像分支</span>
              <span className="text-xs text-muted-foreground">{branches.length} 个</span>
            </div>
            {busy ? <LoadingRow label="正在读取分支…" /> : branches.length ? (
              <div className="divide-y divide-border">
                {branches.map((branch) => (
                  <button
                    className={cn("flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50", (selectedRef || repo.branch) === branch.name && "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]")}
                    key={branch.name}
                    type="button"
                    onClick={() => onSelectBranch(branch.name)}
                  >
                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{branch.name}</span>
                    {branch.isDefault ? <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">默认</span> : null}
                    {(selectedRef || repo.branch) === branch.name ? <span className="rounded-full border border-[color-mix(in_srgb,var(--accent)_28%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">当前</span> : null}
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{branch.shortSha}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                <p>没有可读取的分支。</p>
                <p className="mt-1 text-xs">如果仓库显示已连接但这里为空，请先同步；若仍为空，可能是服务端镜像没有 refs 或返回结构异常。</p>
              </div>
            )}
          </section>
        ) : (
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--gt-shadow-1)]">
            <div className="border-b border-border bg-[color-mix(in_srgb,var(--bg-soft)_65%,transparent)] px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs text-muted-foreground">
                <button className="shrink-0 hover:text-foreground" type="button" onClick={() => { setPath("."); setSelectedFile(null); }}>根目录</button>
                {breadcrumbParts.map((part, index) => {
                  const nextPath = breadcrumbParts.slice(0, index + 1).join("/");
                  return <span className="flex shrink-0 items-center gap-1" key={nextPath}><ChevronRight className="size-3" /><button className="hover:text-foreground" type="button" onClick={() => { setPath(nextPath); setSelectedFile(null); }}>{part}</button></span>;
                })}
              </div>
              {tree ? <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{tree.ref} · {shortCommit(tree.commit)}</p> : null}
            </div>
            <div className="divide-y divide-border">
              {busy ? <LoadingRow label="正在读取文件树…" /> : tree?.entries.map((entry) => (
                <button
                  className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50", selectedFile?.path === entry.path && "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]")}
                  key={entry.path}
                  type="button"
                  onClick={() => entry.kind === "directory" ? (setPath(entry.path), setSelectedFile(null)) : void openFile(entry.path)}
                >
                  {entry.kind === "directory" ? <Folder className="size-4 shrink-0 text-[var(--accent)]" /> : <FileCode2 className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">{entry.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{entry.shortSha}</span>
                  {entry.kind === "directory" ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                </button>
              ))}
              {!busy && !tree?.entries.length ? <p className="px-3 py-4 text-sm text-muted-foreground">该目录为空，或尚未同步仓库。</p> : null}
            </div>
          </section>
        )}

        {mode === "files" && (fileBusy || selectedFile) ? (
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--gt-shadow-1)]">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-[color-mix(in_srgb,var(--bg-soft)_65%,transparent)] px-3 py-2.5">
              <span className="min-w-0 truncate font-mono text-xs text-foreground">{selectedFile?.path || "正在读取文件…"}</span>
              {selectedFile?.truncated ? <span className="shrink-0 text-[11px] text-muted-foreground">已截断</span> : null}
            </div>
            {fileBusy ? <LoadingRow label="正在读取文件内容…" /> : selectedFile ? <pre className="max-h-[34rem] overflow-auto p-3 font-mono text-xs leading-5 text-foreground"><code>{selectedFile.content}</code></pre> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
