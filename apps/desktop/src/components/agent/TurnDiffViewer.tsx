import { useState, type ReactNode } from "react";
import { Check, ChevronDown, FilePen } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { buildHunks, diffLines } from "../../lib/turnDiff";
import type { AgentDetailedPart } from "../../lib/agentSessions";

/**
 * 回合修改文件的数据模型与查看器（右侧栏「本轮改动」页签内容区）。
 * AgentMessageStream（汇总卡片）与 GitChangesPanel（右侧栏）共用。
 */

export type TurnManifestEntry = {
  changed: string[];
  fileDiffs: Array<{ path: string; before: string; after: string }>;
};

export type TurnModifiedFile = {
  path: string;
  added?: number;
  removed?: number;
  /** before/after 是完整文件快照（manifest 基线或整文件 write）——查看器可整文件渲染；
   *  false/缺省 = 编辑片段（edit 的 old/new 局部块），只能按 hunk 展示。 */
  snapshot?: boolean;
  /** 该文件本回合的全部编辑块（edit 的 old/new 对、write 的全文），按调用顺序。
   *  统计与展示都基于它：统计 = 各块最小 diff 之和，展示 = 逐块渲染 hunk——两者恒等。 */
  edits?: Array<{ before: string; after: string }>;
};

/**
 * 从工具调用流派生回合修改文件：office 写改 + 内置 write/edit 的目标文件，去重保序。
 * 统计口径 = 各编辑块的最小 diff 行数（与查看器展示严格一致，不再按整块大小计数）；
 * edits 按调用顺序累积（上限 10 块），多次编辑在查看器里逐块呈现。读取类不计入。
 */
export function collectTurnModifiedFiles(parts: AgentDetailedPart[]): TurnModifiedFile[] {
  const byPath = new Map<string, TurnModifiedFile>();
  const MAX_EDITS_PER_FILE = 10;
  for (const part of parts) {
    if (String((part as { type?: string }).type || "") !== "toolCall") continue;
    const tool = String((part as { toolName?: string }).toolName || "");
    if (!/^(write|edit)_(xlsx|docx|pptx)$/.test(tool) && tool !== "write" && tool !== "edit") continue;
    const input = ((part as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>;
    const path = String(input.path || input.file_path || "").trim();
    if (!path) continue;
    let added = 0;
    let removed = 0;
    let editBlock: { before: string; after: string } | null = null;
    if (tool === "edit") {
      const before = String(input.oldText ?? input.old_string ?? "");
      const after = String(input.newText ?? input.new_string ?? "");
      if (!after) continue;
      // 统计 = 最小 diff 的真实增删行数（与用户看到的 hunk 恒等）。
      const lines = diffLines(before, after);
      added = lines.filter((line) => line.type === "added").length;
      removed = lines.filter((line) => line.type === "removed").length;
      editBlock = { before, after };
    } else if (tool === "write") {
      const after = String(input.content ?? "");
      if (!after) continue;
      added = after.split("\n").length;
      removed = 0;
      editBlock = { before: "", after };
    }
    const existing = byPath.get(path);
    if (existing) {
      // 连续相同编辑块 = 模型重试，净变化只计一次（避免统计与展示各说各话）。
      const lastEdit = existing.edits?.length ? existing.edits[existing.edits.length - 1] : null;
      const isRetry = Boolean(
        editBlock && lastEdit && lastEdit.before === editBlock.before && lastEdit.after === editBlock.after
      );
      if (!isRetry) {
        existing.added = (existing.added || 0) + added;
        existing.removed = (existing.removed || 0) + removed;
        if (editBlock) {
          existing.edits = existing.edits || [];
          if (existing.edits.length < MAX_EDITS_PER_FILE) existing.edits.push(editBlock);
        }
      }
    } else {
      byPath.set(path, {
        path,
        added,
        removed,
        edits: editBlock ? [editBlock] : undefined,
        // 整文件 write 的 after 是完整文件，可作快照渲染；edit 块只是局部片段。
        snapshot: editBlock ? editBlock.before === "" : undefined
      });
    }
  }
  // 统计统一从展示块推导（单一数据源原则：展示什么就统计什么）。
  const out = [...byPath.values()];
  for (const file of out) {
    const stats = deriveTurnStats(file.edits);
    file.added = stats.added;
    file.removed = stats.removed;
  }
  return out;
}

/**
 * 编辑块压缩（净变化语义）：首块的 before → 末块的 after 即回合净变化——
 * 中间步骤（含 write 覆盖）在数学上无关。首块为 write（before=""）时回合起点未知，
 * 退化为整文件新增口径。同一文件在 UI 上只呈现一份完整 diff，不再按编辑调用分层展开。
 */
export function compressEdits(edits?: Array<{ before: string; after: string }>): {
  before: string;
  after: string;
} | null {
  if (!edits?.length) return null;
  return { before: edits[0].before, after: edits[edits.length - 1].after };
}

/** 统计的唯一推导入口：对压缩后的净变化块计算最小 diff 行数——卡片数字与查看器行数构造恒等。 */
export function deriveTurnStats(edits?: Array<{ before: string; after: string }>): {
  added: number;
  removed: number;
} {
  const net = compressEdits(edits);
  if (!net) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diffLines(net.before, net.after)) {
    if (line.type === "added") added += 1;
    else if (line.type === "removed") removed += 1;
  }
  return { added, removed };
}

/** 增删统计的展示文本：+ 和 − 两侧始终完整展示（+0 −2 / +33 −0 都是真实口径的一部分）。 */
export function formatTurnStats(added?: number, removed?: number): string {
  return `+${added || 0} −${removed || 0}`;
}

/** 双色统计文本：+ 绿 − 红，两侧始终完整展示。 */
export function StatsBadgeText({ added, removed }: { added?: number; removed?: number }) {
  return (
    <>
      <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{added || 0}</span>{" "}
      <span className="font-semibold text-rose-600 dark:text-rose-400">−{removed || 0}</span>
    </>
  );
}

/**
 * 词级高亮（markEdits 同款）：对一对 before/after 行取公共前后缀，
 * 中段差异用高亮底色标出。前缀/后缀对齐到词边界，避免半词高亮。
 */
function splitLineHighlight(before: string, after: string) {
  const maxPrefix = Math.min(before.length, after.length);
  let pre = 0;
  while (pre < maxPrefix && before[pre] === after[pre]) pre += 1;
  // 前缀回退到词边界（最后一个空白之后）。
  while (pre > 0 && pre < before.length && !/\s/.test(before[pre - 1])) pre -= 1;
  let beforePost = before.length;
  let afterPost = after.length;
  while (
    beforePost > pre &&
    afterPost > pre &&
    before[beforePost - 1] === after[afterPost - 1]
  ) {
    beforePost -= 1;
    afterPost -= 1;
  }
  // 后缀对齐到词边界。
  while (beforePost < before.length && afterPost < after.length && !/\s/.test(before[beforePost])) {
    beforePost += 1;
    afterPost += 1;
  }
  return {
    beforePre: before.slice(0, pre),
    beforeMid: before.slice(pre, beforePost),
    beforePostText: before.slice(beforePost),
    afterPre: after.slice(0, pre),
    afterMid: after.slice(pre, afterPost),
    afterPostText: after.slice(afterPost)
  };
}

/** 单行渲染：行号 + 符号列（−/+ 着色）+ 文本（词级高亮由调用方注入 segments）。 */
function DiffRow({
  beforeNo,
  afterNo,
  sign,
  segments,
  tint
}: {
  beforeNo: number | null;
  afterNo: number | null;
  sign: "removed" | "added" | "context";
  segments: Array<{ text: string; mark?: "removed" | "added" }>;
  tint: string;
}) {
  const signClass =
    sign === "removed"
      ? "font-bold text-rose-600 dark:text-rose-400"
      : sign === "added"
        ? "font-bold text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground/40";
  // 字体不再按增删上色（避免行底色/字色/亮盒三重叠加）——区分交给行底色、
  // 左色条与符号列；只有词级亮盒内的差异词保持强调色文字。
  const textClass = "text-foreground/90";
  const markClass =
    sign === "removed"
      ? "rounded-[3px] bg-rose-400/50 px-0.5 font-semibold text-rose-950 dark:bg-rose-400/45 dark:text-rose-50"
      : "rounded-[3px] bg-emerald-400/40 px-0.5 font-semibold text-emerald-950 dark:bg-emerald-400/35 dark:text-emerald-50";
  return (
    <div className={tint}>
      <span className="w-10 shrink-0 pr-2 text-right text-[10px] leading-6 text-muted-foreground/45 select-none">
        {beforeNo ?? ""}
      </span>
      <span className="w-10 shrink-0 pr-2 text-right text-[10px] leading-6 text-muted-foreground/45 select-none">
        {afterNo ?? ""}
      </span>
      <span className={cn("w-5 shrink-0 text-center leading-6 select-none", signClass)}>
        {sign === "removed" ? "−" : sign === "added" ? "+" : ""}
      </span>
      <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-all pr-3 leading-6", textClass)}>
        {segments.map((segment, index) =>
          segment.mark ? (
            <mark key={index} className={cn("text-inherit", markClass)}>
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          )
        )}
      </span>
    </div>
  );
}

/**
 * hunk 行渲染（悬浮与查看器共用）。对比感三要素：
 * 1) 行底色调强（removed/added 12% 着色）；
 * 2) 独立符号列，−/+ 加粗着色；
 * 3) 相邻 removed/added 行按对做词级高亮（中段差异亮底+加粗）。
 */
export function DiffLineRows({ lines }: { lines: ReturnType<typeof diffLines> }) {
  const rows: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.type === "context") {
      rows.push(
        <DiffRow
          key={index}
          beforeNo={line.beforeNo}
          afterNo={line.afterNo}
          sign="context"
          segments={[{ text: line.text }]}
          tint="flex"
        />
      );
      index += 1;
      continue;
    }
    // 收集连续 removed / added 块。
    const removedRun: typeof lines = [];
    const addedRun: typeof lines = [];
    while (index < lines.length && lines[index].type === "removed") {
      removedRun.push(lines[index]);
      index += 1;
    }
    while (index < lines.length && lines[index].type === "added") {
      addedRun.push(lines[index]);
      index += 1;
    }
    const pairCount = Math.min(removedRun.length, addedRun.length);
    // 词标克制：中段占整行 60% 以上时视为整行重写——行底色已承载指示，不再加亮盒。
    const midDominates = (mid: string, line: string) =>
      line.length > 0 && mid.length / line.length >= 0.6;
    removedRun.forEach((removedLine, runIndex) => {
      let segments: Array<{ text: string; mark?: "removed" }>;
      if (runIndex < pairCount) {
        const parts = splitLineHighlight(removedLine.text, addedRun[runIndex].text);
        segments = midDominates(parts.beforeMid, removedLine.text)
          ? [{ text: removedLine.text }]
          : [
              { text: parts.beforePre },
              { text: parts.beforeMid, mark: "removed" },
              { text: parts.beforePostText }
            ];
      } else {
        // 未配对整行：行底色即指示，不再加亮盒（避免整屏色块）。
        segments = [{ text: removedLine.text }];
      }
      rows.push(
        <DiffRow
          key={`r${index}-${runIndex}`}
          beforeNo={removedLine.beforeNo}
          afterNo={null}
          sign="removed"
          segments={segments}
          tint="flex border-l-2 border-l-rose-500/60 bg-rose-500/15"
        />
      );
    });
    addedRun.forEach((addedLine, runIndex) => {
      let segments: Array<{ text: string; mark?: "added" }>;
      if (runIndex < pairCount) {
        const parts = splitLineHighlight(removedRun[runIndex].text, addedLine.text);
        segments = midDominates(parts.afterMid, addedLine.text)
          ? [{ text: addedLine.text }]
          : [
              { text: parts.afterPre },
              { text: parts.afterMid, mark: "added" },
              { text: parts.afterPostText }
            ];
      } else {
        // 未配对整行：行底色即指示，不再加亮盒。
        segments = [{ text: addedLine.text }];
      }
      rows.push(
        <DiffRow
          key={`a${index}-${runIndex}`}
          beforeNo={null}
          afterNo={addedLine.afterNo}
          sign="added"
          segments={segments}
          tint="flex border-l-2 border-l-emerald-500/60 bg-emerald-500/12"
        />
      );
    });
  }
  return <>{rows}</>;
}

/**
 * 完整改动查看器（右侧栏「本轮改动」页签内容，对标 DSH 的轮次改动视图）：
 * 顶部文件选择条（下拉列出全部文件），代码区占满剩余宽度——文件列表是浮层而非常驻侧栏。
 */
export function TurnDiffViewer({
  files,
  title,
  initialPath
}: {
  files: TurnModifiedFile[];
  title?: string;
  /** 初始选中文件（点文件行进入时定位）。 */
  initialPath?: string;
}) {
  const [activePath, setActivePath] = useState(initialPath || "");
  const active = files.find((file) => file.path === activePath) || files[0] || null;
  // 净变化单块：回合起始完整状态 → 回合结束完整状态。
  // snapshot（完整快照）→ 整文件渲染；片段（edit 局部块）→ hunk 展示。
  const activeNet = compressEdits(active?.edits);
  const activeIsSnapshot = Boolean(active?.snapshot && activeNet);
  const activeLines = activeNet ? diffLines(activeNet.before, activeNet.after) : [];
  const FULL_VIEW_LINE_CAP = 3000;
  const activeHunks = activeNet ? buildHunks(activeLines, 3) : [];
  const activeViewLines = activeIsSnapshot
    ? activeLines.length > FULL_VIEW_LINE_CAP
      ? activeLines.slice(0, FULL_VIEW_LINE_CAP)
      : activeLines
    : [];
  const activeViewOmitted = activeLines.length - activeViewLines.length;
  const totalAdded = files.reduce((sum, file) => sum + (file.added || 0), 0);
  const totalRemoved = files.reduce((sum, file) => sum + (file.removed || 0), 0);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 文件选择条：当前文件 + 下拉切换；右侧本文件统计与总计。 */}
      <div className="flex items-center gap-2 border-b border-border py-2 pr-3 pl-3">
        <FilePen className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={1.9} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
            >
              <span className="min-w-0 truncate font-mono text-[12px] text-foreground">
                {active?.path || "—"}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[min(420px,80vw)]">
            {files.map((file) => (
              <DropdownMenuItem
                key={file.path}
                className="flex items-center gap-2 font-mono text-[11px]"
                onSelect={() => setActivePath(file.path)}
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    file === active ? "text-emerald-600 dark:text-emerald-400" : "text-transparent"
                  )}
                  strokeWidth={2.2}
                />
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                {file.added != null ? (
                  <span className="shrink-0 tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">+{file.added}</span>
                    {" "}
                    <span className="text-rose-600 dark:text-rose-400">−{file.removed || 0}</span>
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto shrink-0 text-[11px] whitespace-nowrap text-muted-foreground/70">
          {title || "本轮改动"} · {files.length} 个文件
        </span>
        <Badge variant="outline" className="shrink-0 gap-1.5 border-transparent font-mono text-[11px] tabular-nums">
          <StatsBadgeText added={totalAdded} removed={totalRemoved} />
        </Badge>
      </div>
      <Separator />
      {/* 代码区：全宽。 */}
      <ScrollArea className="min-w-0 flex-1">
        {active ? (
          activeIsSnapshot && activeViewLines.length > 0 ? (
            <div className="py-2 font-mono text-[12px] leading-6">
              <DiffLineRows lines={activeViewLines} />
              {activeViewOmitted > 0 ? (
                <div className="px-3 py-1 text-center text-[10px] text-muted-foreground/60">
                  … 其余 {activeViewOmitted} 行已省略（文件过大）
                </div>
              ) : null}
            </div>
          ) : activeHunks.length > 0 ? (
            <div className="py-2 font-mono text-[12px] leading-6">
              {!activeIsSnapshot ? (
                <div className="bg-muted/80 px-3 py-1 text-[10px] tracking-wide text-muted-foreground">
                  基于编辑片段的局部 diff（完整快照见 manifest 覆盖的回合）
                </div>
              ) : null}
              {activeHunks.map((hunk, hunkIndex) => (
                <div key={hunkIndex} className="mb-2">
                  <div className="bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">{hunk.header}</div>
                  <DiffLineRows lines={hunk.lines} />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-6 text-xs leading-6 text-muted-foreground">
              该文件无逐行 diff 源（bash 间接写入或 office 工具）。
            </div>
          )
        ) : null}
      </ScrollArea>
    </div>
  );
}
