import {
  ArrowLeft,
  Braces,
  FileCode2,
  FileSearch,
  Folder,
  GitFork,
  History,
  Play,
  RefreshCw,
  Search,
  SquareTerminal,
  WandSparkles,
  Workflow,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  applyRemoteWorkspacePatch,
  createRemoteWorkspace,
  editRemoteWorkspaceFile,
  findRemoteWorkspaceFiles,
  getRemoteWorkspaceGraph,
  getRemoteWorkspaceState,
  grepRemoteWorkspaceFiles,
  listRemoteWorkspaceOperations,
  listRemoteWorkspaceFiles,
  readRemoteWorkspaceFile,
  runRemoteWorkspaceShell,
  writeRemoteWorkspaceFile,
} from "./remoteRepoWorkspaceApi";
import type {
  RemoteWorkspaceFileEntry,
  RemoteWorkspaceFileSlice,
  RemoteWorkspaceGraphState,
  RemoteWorkspaceOperationRecord,
  RemoteWorkspaceSession,
  RemoteWorkspaceShellResult,
  RemoteWorkspaceTextMatch,
} from "./remoteRepoWorkspaceResources";
import {
  describeRemoteWorkspaceGraphAction,
  ensureRemoteWorkspaceSessionRepo,
  explainRemoteWorkspaceCreationError,
  formatRemoteWorkspaceTimestamp,
} from "./remoteRepoWorkspaceResources";
import type { RemoteRepo } from "./types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";

type WorkspaceTab = "shell" | "files" | "search" | "graph" | "history";

const TAB_CONFIG: Array<{ id: WorkspaceTab; label: string; icon: typeof SquareTerminal }> = [
  { id: "shell", label: "Shell", icon: SquareTerminal },
  { id: "files", label: "文件", icon: FileCode2 },
  { id: "search", label: "搜索", icon: Search },
  { id: "graph", label: "GitNexus", icon: GitFork },
  { id: "history", label: "记录", icon: History },
];

function shortCommit(value: string): string {
  return value ? value.slice(0, 7) : "—";
}

function ErrorCallout({ message }: { message: string }) {
  return <p className="rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-sm text-foreground">{message}</p>;
}

function EmptyWorkspace({
  onCreate,
  refOrCommit,
  onRefChange,
  busy,
  sessionIdToRestore,
  onSessionIdToRestoreChange,
  onRestore,
  restoring,
}: {
  onCreate: () => void;
  refOrCommit: string;
  onRefChange: (value: string) => void;
  busy: boolean;
  sessionIdToRestore: string;
  onSessionIdToRestoreChange: (value: string) => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-[var(--gt-shadow-1)]">
      <div className="flex items-start gap-3">
        <Workflow className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">创建一个提交固定的远程工作区</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">工作区独立于远端仓库。Shell、编辑和补丁只会修改这个服务端 workspace，不会自动提交、推送或合并。</p>
        </div>
      </div>
      <div className="mt-4 flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-medium text-foreground">起始 ref 或提交</span>
          <Input aria-label="起始 ref 或提交" className="font-mono text-sm" value={refOrCommit} onChange={(event) => onRefChange(event.target.value)} onFocus={(event) => event.currentTarget.select()} placeholder="例如 main、feature/login 或 40 位 SHA" disabled={busy} />
          <span className="mt-1.5 block text-[11px] leading-4 text-muted-foreground">这里不是工作区名称；输入会替换默认 ref。</span>
        </label>
        <Button variant="contrast" onClick={onCreate} disabled={busy || !refOrCommit.trim()}>
          {busy ? <RefreshCw className="animate-spin" /> : <Workflow />}
          创建
        </Button>
      </div>
      <div className="mt-4 border-t border-border/70 pt-4">
        <p className="text-xs font-medium text-foreground">恢复已有 session</p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">如果是旧版本创建的工作区，可粘贴页面显示过的 <span className="font-mono">sess_…</span> ID 回到它。</p>
        <div className="mt-2 flex gap-2">
          <Input aria-label="已有 session ID" className="font-mono text-xs" value={sessionIdToRestore} onChange={(event) => onSessionIdToRestoreChange(event.target.value)} placeholder="sess_…" disabled={restoring} />
          <Button variant="outline" onClick={onRestore} disabled={restoring || !sessionIdToRestore.trim()}>{restoring ? <RefreshCw className="animate-spin" /> : <Workflow />}继续打开</Button>
        </div>
      </div>
    </section>
  );
}

function TabButton({ active, label, icon: Icon, onClick }: { active: boolean; label: string; icon: typeof SquareTerminal; onClick: () => void }) {
  return <button className={cn("flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs font-medium transition-colors", active ? "border-[var(--accent)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} type="button" onClick={onClick}><Icon className="size-3.5" />{label}</button>;
}

function Readout({ children, tone = "default" }: { children: string; tone?: "default" | "error" }) {
  return <pre className={cn("max-h-64 overflow-auto rounded-lg border p-3 font-mono text-xs leading-5", tone === "error" ? "border-[color-mix(in_srgb,var(--danger)_32%,transparent)] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] text-foreground" : "border-border bg-[color-mix(in_srgb,var(--bg-soft)_55%,transparent)] text-foreground")}>{children || "—"}</pre>;
}

const OPERATION_KIND_LABEL: Record<string, string> = {
  create_session: "创建工作区",
  resume_workspace: "恢复工作区",
  shell: "Shell",
  list_files: "列出文件",
  read_file: "读取文件",
  find_files: "查找文件",
  grep: "文本搜索",
  write_file: "写入文件",
  edit_file: "替换文本",
  apply_patch: "应用补丁",
  gitnexus_status: "GitNexus 状态",
  gitnexus_analyze: "GitNexus 分析",
};

function formatOperationTime(value: number): string {
  if (!value) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function OperationTimeline({ operations }: { operations: RemoteWorkspaceOperationRecord[] }) {
  if (!operations.length) {
    return <p className="rounded-xl border border-border bg-card px-4 py-5 text-sm text-muted-foreground">暂无操作记录。</p>;
  }
  return (
    <div className="space-y-3">
      {operations.map((operation) => {
        const hasOutput = Boolean(operation.stdout || operation.stderr || operation.diffSummary);
        return (
          <article key={operation.operationId} className="rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">{OPERATION_KIND_LABEL[operation.kind] || operation.kind}</span>
                  <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", operation.status === "failed" || operation.status === "timeout" ? "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]" : "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]")}>{operation.status}</span>
                  {operation.workspaceVersion ? <span className="font-mono text-[11px] text-muted-foreground">v{operation.workspaceVersion}</span> : null}
                </div>
                <p className="text-sm text-foreground">{operation.summary}</p>
              </div>
              <time className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatOperationTime(operation.startedAt)}</time>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {operation.path ? <span className="min-w-0 max-w-full truncate rounded-md bg-muted/55 px-2 py-1 font-mono">{operation.path}</span> : null}
              {operation.cwd ? <span className="rounded-md bg-muted/55 px-2 py-1 font-mono">cwd {operation.cwd}</span> : null}
              {operation.exitCode !== null ? <span className="rounded-md bg-muted/55 px-2 py-1 font-mono">exit {operation.exitCode}</span> : null}
            </div>
            {operation.command ? <Readout>{operation.command}</Readout> : null}
            {hasOutput ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">输出与变更</summary>
                <div className="mt-2 grid gap-2">
                  {operation.stdout ? <div><p className="mb-1 text-[11px] text-muted-foreground">stdout</p><Readout>{operation.stdout}</Readout></div> : null}
                  {operation.stderr ? <div><p className="mb-1 text-[11px] text-muted-foreground">stderr</p><Readout tone="error">{operation.stderr}</Readout></div> : null}
                  {operation.diffSummary ? <div><p className="mb-1 text-[11px] text-muted-foreground">diff</p><Readout>{operation.diffSummary}</Readout></div> : null}
                </div>
              </details>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function RemoteRepoWorkspacePanel({
  repo,
  onBack,
  initialSession = null,
  onSessionChange,
  onSessionUnavailable,
}: {
  repo: RemoteRepo;
  onBack: () => void;
  initialSession?: RemoteWorkspaceSession | null;
  onSessionChange?: (session: RemoteWorkspaceSession) => void;
  onSessionUnavailable?: (sessionId: string) => void;
}) {
  const [session, setSession] = useState<RemoteWorkspaceSession | null>(initialSession);
  const [refOrCommit, setRefOrCommit] = useState(repo.branch);
  const [sessionIdToRestore, setSessionIdToRestore] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("shell");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [shellCommand, setShellCommand] = useState("git status --short");
  const [shellCwd, setShellCwd] = useState(".");
  const [shellResult, setShellResult] = useState<RemoteWorkspaceShellResult | null>(null);
  const [filesPath, setFilesPath] = useState(".");
  const [files, setFiles] = useState<RemoteWorkspaceFileEntry[]>([]);
  const [filePath, setFilePath] = useState("README.md");
  const [fileContent, setFileContent] = useState<RemoteWorkspaceFileSlice | null>(null);
  const [writeContent, setWriteContent] = useState("");
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [patch, setPatch] = useState("");
  const [fileQuery, setFileQuery] = useState("*.md");
  const [textQuery, setTextQuery] = useState("TODO");
  const [foundFiles, setFoundFiles] = useState<string[]>([]);
  const [textMatches, setTextMatches] = useState<RemoteWorkspaceTextMatch[]>([]);
  const [graph, setGraph] = useState<RemoteWorkspaceGraphState | null>(null);
  const [graphNotice, setGraphNotice] = useState("");
  const [operations, setOperations] = useState<RemoteWorkspaceOperationRecord[]>([]);

  const rememberSession = (next: RemoteWorkspaceSession) => {
    setSession(next);
    onSessionChange?.(next);
  };

  useEffect(() => {
    if (!initialSession || initialSession.repoId !== repo.id) return;
    let cancelled = false;
    setSession(initialSession);
    void getRemoteWorkspaceState(initialSession.sessionId)
      .then((current) => {
        if (cancelled) return;
        rememberSession(current);
      })
      .catch((reason) => {
        if (cancelled) return;
        setSession(null);
        onSessionUnavailable?.(initialSession.sessionId);
        setError(`无法继续打开这个远程工作区。服务端 session 可能已重启或失效；请创建新的工作区。${String(reason)}`);
      });
    return () => {
      cancelled = true;
    };
  // Only a different session/repository needs a restore request. Updates to
  // the current session are reported through onSessionChange instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSession?.sessionId, repo.id]);

  useEffect(() => {
    if (tab !== "history" || !session) return;
    let cancelled = false;
    setBusy("history");
    setError("");
    void listRemoteWorkspaceOperations(session.workspaceId)
      .then((rows) => {
        if (!cancelled) setOperations(rows);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setBusy("");
      });
    return () => {
      cancelled = true;
    };
  }, [tab, session?.workspaceId]);

  const withBusy = async (name: string, action: () => Promise<void>, formatError: (reason: unknown) => string = String) => {
    setBusy(name);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy("");
    }
  };

  const updateWorkspaceVersion = (workspaceVersion: number) => {
    if (!workspaceVersion) return;
    setSession((current) => {
      if (!current) return current;
      const next = { ...current, workspaceVersion, dirty: true };
      onSessionChange?.(next);
      return next;
    });
  };

  const create = () => void withBusy("create", async () => {
    const created = await createRemoteWorkspace(repo.id, refOrCommit.trim());
    rememberSession(created);
    setFiles([]);
    setFileContent(null);
    setGraph(null);
    setOperations([]);
  }, explainRemoteWorkspaceCreationError);

  const restore = () => {
    if (!sessionIdToRestore.trim()) return;
    void withBusy("restore", async () => {
      const restored = ensureRemoteWorkspaceSessionRepo(
        await getRemoteWorkspaceState(sessionIdToRestore.trim()),
        repo.id,
      );
      rememberSession(restored);
      setSessionIdToRestore("");
      setFiles([]);
      setFileContent(null);
      setGraph(null);
      setOperations([]);
    });
  };

  const refreshState = () => {
    if (!session) return;
    void withBusy("state", async () => rememberSession(await getRemoteWorkspaceState(session.sessionId)));
  };

  const listFiles = (path = filesPath) => {
    if (!session) return;
    void withBusy("list-files", async () => {
      setFilesPath(path);
      setFiles(await listRemoteWorkspaceFiles(session.sessionId, path));
    });
  };

  const readFile = (path = filePath) => {
    if (!session || !path.trim()) return;
    void withBusy("read-file", async () => {
      setFilePath(path);
      setFileContent(await readRemoteWorkspaceFile(session.sessionId, path));
    });
  };

  const runShell = () => {
    if (!session || !shellCommand.trim()) return;
    void withBusy("shell", async () => {
      const result = await runRemoteWorkspaceShell(session.sessionId, shellCommand, shellCwd || ".");
      setShellResult(result);
      updateWorkspaceVersion(result.workspaceVersion);
    });
  };

  const writeFile = () => {
    if (!session || !filePath.trim()) return;
    void withBusy("write", async () => {
      updateWorkspaceVersion(await writeRemoteWorkspaceFile(session.sessionId, filePath, writeContent));
      setWriteContent("");
      readFile(filePath);
    });
  };

  const editFile = () => {
    if (!session || !filePath.trim() || !oldText) return;
    void withBusy("edit", async () => {
      updateWorkspaceVersion(await editRemoteWorkspaceFile(session.sessionId, filePath, oldText, newText, false));
      setOldText("");
      setNewText("");
      readFile(filePath);
    });
  };

  const applyPatch = () => {
    if (!session || !patch.trim()) return;
    void withBusy("patch", async () => {
      updateWorkspaceVersion(await applyRemoteWorkspacePatch(session.sessionId, patch));
      setPatch("");
    });
  };

  const findFiles = () => {
    if (!session || !fileQuery.trim()) return;
    void withBusy("find", async () => setFoundFiles(await findRemoteWorkspaceFiles(session.sessionId, fileQuery)));
  };

  const grepFiles = () => {
    if (!session || !textQuery.trim()) return;
    void withBusy("grep", async () => setTextMatches(await grepRemoteWorkspaceFiles(session.sessionId, textQuery)));
  };

  const graphAction = (analyze: boolean) => {
    if (!session) return;
    void withBusy(analyze ? "analyze" : "graph", async () => {
      const next = await getRemoteWorkspaceGraph(repo.id, session.sessionId, "session_workspace", analyze);
      setGraph(next);
      setGraphNotice(describeRemoteWorkspaceGraphAction(analyze ? "analyze" : "status", next));
    });
  };

  const refreshOperations = () => {
    if (!session) return;
    void withBusy("history", async () => setOperations(await listRemoteWorkspaceOperations(session.workspaceId)));
  };

  return (
    <main className="h-full overflow-auto bg-transparent" aria-label={`${repo.displayName} 远程工作区`}>
      <div className="flex w-full flex-col gap-5 px-4 pb-6 pt-4">
        <button type="button" className="-mb-2 inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onBack}>
          <ArrowLeft className="size-3.5" />返回仓库概览
        </button>

        <section className="border-b border-border pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"><Wrench className="size-3.5" />远程工作区 / 手动操作</div>
              <h1 className="truncate text-xl font-semibold tracking-[-0.025em] text-foreground">{repo.displayName}</h1>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">所有执行都限制在用户显式创建的服务端工作区中。</p>
            </div>
            {session ? <button type="button" className={cn("shrink-0 rounded-md border px-2 py-1 font-mono text-[11px]", session.dirty ? "border-[color-mix(in_srgb,var(--danger)_35%,transparent)] text-[var(--danger)]" : "border-border text-muted-foreground")} onClick={refreshState} title="刷新工作区状态">v{session.workspaceVersion} · {session.dirty ? "dirty" : "clean"}</button> : <span className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground">未创建</span>}
          </div>
          {session ? <p className="mt-3 truncate font-mono text-xs text-muted-foreground">{session.sessionId} · {shortCommit(session.baseCommit)}</p> : null}
        </section>

        {error ? <ErrorCallout message={error} /> : null}

        {!session ? <EmptyWorkspace
          onCreate={create}
          refOrCommit={refOrCommit}
          onRefChange={setRefOrCommit}
          busy={busy === "create"}
          sessionIdToRestore={sessionIdToRestore}
          onSessionIdToRestoreChange={setSessionIdToRestore}
          onRestore={restore}
          restoring={busy === "restore"}
        /> : (
          <>
            <nav className="flex overflow-x-auto border-b border-border" aria-label="远程工作区操作">
              {TAB_CONFIG.map((item) => <TabButton active={tab === item.id} icon={item.icon} key={item.id} label={item.label} onClick={() => setTab(item.id)} />)}
            </nav>

            {tab === "shell" ? <section className="space-y-3">
              <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]">
                <div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">受限 Shell</span><span className="text-xs text-muted-foreground">仅 workspace</span></div>
                <Textarea aria-label="Shell 命令" className="min-h-28 font-mono text-xs" value={shellCommand} onChange={(event) => setShellCommand(event.target.value)} />
                <div className="mt-2 flex gap-2"><Input aria-label="工作目录" className="font-mono text-xs" value={shellCwd} onChange={(event) => setShellCwd(event.target.value)} /><Button variant="contrast" onClick={runShell} disabled={busy === "shell" || !shellCommand.trim()}>{busy === "shell" ? <RefreshCw className="animate-spin" /> : <Play />}运行</Button></div>
              </div>
              {shellResult ? <div className="grid gap-3"><div><p className="mb-1 text-xs text-muted-foreground">stdout · exit {shellResult.exitCode} · {shellResult.elapsedMs}ms</p><Readout>{shellResult.stdout}</Readout></div><div><p className="mb-1 text-xs text-muted-foreground">stderr</p><Readout tone="error">{shellResult.stderr}</Readout></div>{shellResult.diffSummary ? <div><p className="mb-1 text-xs text-muted-foreground">变更摘要</p><Readout>{shellResult.diffSummary}</Readout></div> : null}</div> : null}
            </section> : null}

            {tab === "files" ? <section className="space-y-3">
              <div className="rounded-xl border border-border bg-card shadow-[var(--gt-shadow-1)]">
                <div className="flex gap-2 border-b border-border p-3"><Input aria-label="工作区路径" className="font-mono text-xs" value={filesPath} onChange={(event) => setFilesPath(event.target.value)} /><Button variant="outline" onClick={() => listFiles()} disabled={busy === "list-files"}>{busy === "list-files" ? <RefreshCw className="animate-spin" /> : <Folder />}列出</Button></div>
                {files.length ? <div className="divide-y divide-border">{files.map((entry) => <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50" key={entry.path} type="button" onClick={() => entry.type === "directory" ? listFiles(entry.path) : readFile(entry.path)}>{entry.type === "directory" ? <Folder className="size-4 text-[var(--accent)]" /> : <FileCode2 className="size-4 text-muted-foreground" />}<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{entry.path}</span>{entry.size !== null ? <span className="text-[11px] text-muted-foreground">{entry.size} B</span> : null}</button>)}</div> : <p className="px-3 py-4 text-sm text-muted-foreground">选择目录后显示 workspace 文件。</p>}
              </div>
              <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]">
                <div className="flex gap-2"><Input aria-label="文件路径" className="font-mono text-xs" value={filePath} onChange={(event) => setFilePath(event.target.value)} /><Button variant="outline" onClick={() => readFile()} disabled={busy === "read-file"}>{busy === "read-file" ? <RefreshCw className="animate-spin" /> : <FileSearch />}读取</Button></div>
                {fileContent ? <><p className="mt-3 truncate font-mono text-[11px] text-muted-foreground">{fileContent.path} · {fileContent.startLine}-{fileContent.endLine}{fileContent.truncated ? " · 已截断" : ""}</p><Readout>{fileContent.content}</Readout></> : null}
              </div>
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--accent)_24%,transparent)] bg-[color-mix(in_srgb,var(--accent)_4%,transparent)] p-3">
                <p className="mb-2 text-xs font-medium text-foreground">写入当前工作区文件</p><Textarea aria-label="写入内容" className="min-h-24 font-mono text-xs" value={writeContent} onChange={(event) => setWriteContent(event.target.value)} placeholder="内容会写入当前 session workspace" /><Button className="mt-2" variant="outline" onClick={writeFile} disabled={busy === "write" || !filePath.trim()}>{busy === "write" ? <RefreshCw className="animate-spin" /> : <FileCode2 />}写入文件</Button>
                <div className="mt-4 grid gap-2 border-t border-border/70 pt-3"><p className="text-xs font-medium text-foreground">精确替换一次</p><Textarea aria-label="待替换文本" className="min-h-16 font-mono text-xs" value={oldText} onChange={(event) => setOldText(event.target.value)} placeholder="旧文本" /><Textarea aria-label="新文本" className="min-h-16 font-mono text-xs" value={newText} onChange={(event) => setNewText(event.target.value)} placeholder="新文本" /><Button variant="outline" onClick={editFile} disabled={busy === "edit" || !oldText}>替换文本</Button></div>
                <div className="mt-4 grid gap-2 border-t border-border/70 pt-3"><p className="text-xs font-medium text-foreground">应用统一补丁</p><Textarea aria-label="统一补丁" className="min-h-28 font-mono text-xs" value={patch} onChange={(event) => setPatch(event.target.value)} placeholder="diff --git …" /><Button variant="outline" onClick={applyPatch} disabled={busy === "patch" || !patch.trim()}><Braces />应用补丁</Button></div>
              </div>
            </section> : null}

            {tab === "search" ? <section className="space-y-3">
              <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]"><p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">文件名或 Glob</p><div className="flex gap-2"><Input aria-label="文件名或 Glob" className="font-mono text-xs" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} /><Button variant="outline" onClick={findFiles} disabled={busy === "find"}>{busy === "find" ? <RefreshCw className="animate-spin" /> : <Search />}查找</Button></div>{foundFiles.length ? <Readout>{foundFiles.join("\n")}</Readout> : null}</div>
              <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]"><p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">正则文本搜索</p><div className="flex gap-2"><Input aria-label="文本模式" className="font-mono text-xs" value={textQuery} onChange={(event) => setTextQuery(event.target.value)} /><Button variant="outline" onClick={grepFiles} disabled={busy === "grep"}>{busy === "grep" ? <RefreshCw className="animate-spin" /> : <FileSearch />}搜索</Button></div>{textMatches.length ? <Readout>{textMatches.map((match) => `${match.path}:${match.lineNumber}: ${match.line}`).join("\n")}</Readout> : null}</div>
            </section> : null}

            {tab === "graph" ? (
              <section className="space-y-3">
                <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]">
                  <p className="mb-3 text-xs text-muted-foreground">这里只分析当前 session workspace。仓库 HEAD / 分支级分析请回到仓库的当前分支上下文中执行。</p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => graphAction(false)} disabled={Boolean(busy)}>
                      {busy === "graph" ? <RefreshCw className="animate-spin" /> : <GitFork />}
                      检查当前工作区
                    </Button>
                    <Button variant="contrast" onClick={() => graphAction(true)} disabled={Boolean(busy)}>
                      {busy === "analyze" ? <RefreshCw className="animate-spin" /> : <WandSparkles />}
                      分析当前工作区
                    </Button>
                  </div>
                </div>
                {graphNotice ? <p className="rounded-lg border border-[color-mix(in_srgb,var(--accent)_26%,transparent)] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] px-3 py-2 text-sm text-foreground">{graphNotice}</p> : null}
                {graph ? (
                  <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-sm text-foreground">{graph.status}</p>
                      <span className="text-[11px] text-muted-foreground">{graph.lastIndexedAt ? `索引于 ${formatRemoteWorkspaceTimestamp(graph.lastIndexedAt)}` : "尚无索引时间"}</span>
                    </div>
                    {graph.error ? <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-foreground">{graph.error}</p> : null}
                    <div className="mt-3">
                      <p className="mb-1 text-xs text-muted-foreground">分析目标</p>
                      <Readout>{JSON.stringify(graph.target, null, 2)}</Readout>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {tab === "history" ? (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--gt-shadow-1)]">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">服务端操作记录</p>
                    <p className="mt-1 truncate font-mono text-xs text-foreground">{session.workspaceId} · {session.sessionId}</p>
                  </div>
                  <Button variant="outline" onClick={refreshOperations} disabled={busy === "history"}>
                    <RefreshCw className={busy === "history" ? "animate-spin" : ""} />
                    刷新
                  </Button>
                </div>
                <OperationTimeline operations={operations} />
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
