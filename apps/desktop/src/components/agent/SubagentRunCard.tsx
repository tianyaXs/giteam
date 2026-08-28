/**
 * 子 agent 行：对齐移动端 Task 逻辑。
 * - 标签层：「任务 描述 · 当前工具」（运行中标签脉冲）
 * - 展开区：最近 3 步窗口 + 更早一步淡出不可点；无「更早 N 步」文案
 * - 内部步骤默认收起；定高窗口避免新增步骤顶抖外层标签
 */
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentDetailedPart, AgentTodoItem } from "../../lib/agentSessions";
import { readAgentTodosFromPart } from "../../lib/agentParts";
import { resolveTaskCardTitle } from "../../lib/subagentRun";
import { toolDisplayName } from "../../lib/agent/toolPresentation";
import { cn } from "../../lib/utils";
import { MarkdownLite } from "../common/MarkdownLite";
import { AnimatedCollapsibleContent } from "../ui/animated-collapsible-content";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { AgentExecutionPartView, type AgentToolFileTarget } from "./AgentExecutionPartView";

export type SubagentRunCardProps = {
  part: AgentDetailedPart;
  listItem?: boolean;
  /** 同批其它 task part，用于批并行子卡从父 tasks[] 回填标题 */
  siblingParts?: AgentDetailedPart[];
  /** 父回合已结束：纠正仍停在 running 的脏状态 */
  settled?: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile?: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
};

const TASK_STEP_WINDOW = 3;

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function ActivityDot({ active, error }: { active: boolean; error: boolean }) {
  return (
    <span
      className={cn(
        "mt-[5px] size-1.5 shrink-0 rounded-full",
        error && "bg-destructive",
        !error && active && "bg-foreground/70 animate-pulse",
        !error && !active && "bg-muted-foreground/40"
      )}
      aria-hidden
    />
  );
}

function summarizeTimeline(timeline: AgentDetailedPart[]): string {
  let reads = 0;
  let searches = 0;
  let tools = 0;
  for (const step of timeline) {
    if (normalizeText((step as { type?: string }).type) !== "toolCall") continue;
    tools += 1;
    const name = normalizeText((step as { toolName?: string }).toolName);
    if (name === "read") reads += 1;
    else if (name === "grep" || name === "find" || name === "ls" || name === "web_search" || name === "web_fetch") {
      searches += 1;
    }
  }
  const bits = [
    reads > 0 ? `${reads} 次读取` : "",
    searches > 0 ? `${searches} 次搜索` : "",
    tools > 0 && reads === 0 && searches === 0 ? `${tools} 个工具` : ""
  ].filter(Boolean);
  return bits.join("，");
}

function TaskStepWindowRow(props: {
  step: AgentDetailedPart;
  faded?: boolean;
  onOpenToolFile?: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
}) {
  const { faded = false, onOpenBrowserUrl, onOpenTaskSession, onOpenToolFile, step } = props;
  return (
    <div
      className={cn("min-w-0", faded && "pointer-events-none opacity-[0.28]")}
      aria-hidden={faded || undefined}
    >
      <AgentExecutionPartView
        part={step}
        shellToolPartsExpanded={false}
        editToolPartsExpanded={false}
        listItem
        onOpenToolFile={onOpenToolFile || (() => undefined)}
        onOpenBrowserUrl={onOpenBrowserUrl}
        onOpenTaskSession={onOpenTaskSession}
      />
    </div>
  );
}

export function SubagentRunCard({
  part,
  listItem = false,
  siblingParts = [],
  settled = false,
  onOpenTaskSession,
  onOpenToolFile,
  onOpenBrowserUrl
}: SubagentRunCardProps) {
  const input = ((part as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>;
  const details = ((part as { details?: Record<string, unknown> }).details || {}) as Record<string, unknown>;
  const batchTasks = Array.isArray(input.tasks)
    ? input.tasks
    : Array.isArray(details.tasks)
      ? details.tasks
      : null;
  // 真批并行（>1）父壳：有分卡则不渲染；无分卡时只留一行摘要。
  // 单元素 tasks[] 不当父壳，走下方正常子任务卡。
  const hasIndexedChildren = siblingParts.some((candidate) => {
    const id =
      normalizeText((candidate as { toolCallId?: string }).toolCallId)
      || normalizeText((candidate as { id?: string }).id);
    const parentId =
      normalizeText((part as { toolCallId?: string }).toolCallId)
      || normalizeText((part as { id?: string }).id);
    return Boolean(parentId && id.startsWith(`${parentId}:`));
  });
  if (batchTasks && batchTasks.length > 1) {
    if (hasIndexedChildren) return null;
    const status = normalizeText((part as { status?: string }).status).toLowerCase();
    const running = status === "running" || status === "pending";
    const isError = Boolean((part as { isError?: boolean }).isError) || status === "error";
    return (
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 overflow-hidden py-0.5 text-xs text-muted-foreground",
          listItem && "pl-0"
        )}
      >
        <ActivityDot active={running && !settled} error={isError || (settled && running)} />
        <span className="min-w-0 flex-1 truncate">
          批并行 {batchTasks.length} 个子任务
          {isError || (settled && running) ? " · 有失败" : settled || status === "completed" ? " · 已汇总" : ""}
        </span>
      </div>
    );
  }
  const status = normalizeText((part as { status?: string }).status).toLowerCase();
  const subagentStatus = normalizeText((part as { subagentStatus?: string }).subagentStatus).toLowerCase()
    || status;
  const rawRunning =
    subagentStatus === "running"
    || subagentStatus === "pending"
    || status === "running"
    || status === "pending";
  const isError =
    Boolean((part as { isError?: boolean }).isError)
    || subagentStatus === "failed"
    || subagentStatus === "aborted"
    || subagentStatus === "error"
    || status === "error";
  // 父回合结束后若仍标 running，按失败/中断展示，避免「已完成」组里挂着「进行中」。
  // 但 status 已是 completed 时（tool.completed / settle 已落盘），不要再因过期的
  // subagentStatus=running 误标「中断/任务失败」。
  const running = rawRunning && !settled && status !== "completed";
  const interrupted = rawRunning && settled && !isError && status !== "completed";
  const completed = !running && !isError && !interrupted
    && (subagentStatus === "completed" || status === "completed" || settled);

  const description = resolveTaskCardTitle(part, siblingParts) || "子任务";
  const subagentType =
    normalizeText((part as { subagentType?: string }).subagentType)
    || normalizeText(input.subagent_type)
    || "plan";
  const prompt =
    normalizeText((part as { subagentPrompt?: string }).subagentPrompt)
    || normalizeText(input.prompt)
    || "";
  const childSessionId =
    normalizeText((part as { childSessionId?: string }).childSessionId)
    || normalizeText(details.childSessionId);
  const summary =
    normalizeText((part as { summary?: string }).summary)
    || ((completed || isError || interrupted)
      ? normalizeText((part as { output?: string }).output)
      : "");
  const toolCount = Number(
    (part as { toolCount?: number }).toolCount
      ?? details.toolCount
      ?? 0
  ) || 0;
  const reportedElapsedMs = Number(
    (part as { elapsedMs?: number }).elapsedMs
      ?? details.elapsedMs
      ?? 0
  ) || 0;
  const startedAtMs = Number(
    (part as { startedAtMs?: number }).startedAtMs
      ?? details.startedAtMs
      ?? 0
  ) || 0;
  const currentToolName = normalizeText((part as { currentToolName?: string }).currentToolName);
  const childPhase = normalizeText((part as { childPhase?: string }).childPhase);
  const timeline = Array.isArray((part as { timeline?: AgentDetailedPart[] }).timeline)
    ? ((part as { timeline: AgentDetailedPart[] }).timeline)
    : [];
  const toolSteps = timeline.filter((step) => normalizeText((step as { type?: string }).type) === "toolCall");
  const childTodos = useMemo(() => {
    for (let i = toolSteps.length - 1; i >= 0; i -= 1) {
      const todos = readAgentTodosFromPart(toolSteps[i]);
      if (todos.length > 0) return todos;
    }
    return [] as AgentTodoItem[];
  }, [toolSteps]);

  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const fallbackStartedAtRef = useRef(0);

  // 运行中每秒刷新耗时（progress 只在工具切换时推 elapsed，中间会卡住）。
  useEffect(() => {
    if (!running) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (running && startedAtMs <= 0 && fallbackStartedAtRef.current <= 0) {
    fallbackStartedAtRef.current = Date.now() - Math.max(0, reportedElapsedMs);
  }
  const effectiveStartedAt = startedAtMs > 0 ? startedAtMs : fallbackStartedAtRef.current;
  const elapsedMs = running
    ? Math.max(reportedElapsedMs, effectiveStartedAt > 0 ? nowMs - effectiveStartedAt : 0)
    : reportedElapsedMs;

  // 窗口：最新 3 条可交互；再早 1 条淡出占位，不写「更早 N 步」
  const windowSteps = toolSteps.slice(-TASK_STEP_WINDOW);
  const fadedStep =
    toolSteps.length > TASK_STEP_WINDOW
      ? toolSteps[toolSteps.length - TASK_STEP_WINDOW - 1]
      : null;

  const statusLabel = isError
    ? "失败"
    : interrupted
      ? "中断"
      : running
        ? "进行中"
        : "完成";
  // 标签层：描述 · 当前工具（中文映射，对齐移动端）；展开区不再单独写「正在执行」
  const titlePreview = useMemo(() => {
    const rawLive = running
      ? (currentToolName || (childPhase === "responding" ? "模型响应中" : ""))
      : "";
    const liveTool =
      rawLive && rawLive !== "模型响应中" ? toolDisplayName(rawLive) : rawLive;
    if (liveTool && description && description !== liveTool) return `${description} · ${liveTool}`;
    if (liveTool) return liveTool;
    return description;
  }, [childPhase, currentToolName, description, running]);

  const metaLine = useMemo(() => {
    const explored = summarizeTimeline(timeline);
    const bits = [
      subagentType,
      explored || (toolCount > 0 ? `${toolCount} 个工具` : ""),
      formatElapsed(elapsedMs)
    ].filter(Boolean);
    return bits.join(" · ");
  }, [subagentType, timeline, toolCount, elapsedMs]);

  const taskLabel = isError || interrupted ? "任务失败" : "任务";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "grid min-w-0 max-w-full gap-0.5 overflow-hidden",
        listItem ? "py-0.5" : "py-1"
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "h-auto min-h-[28px] w-full min-w-0 justify-start overflow-hidden rounded-md px-0 text-left hover:bg-transparent hover:text-foreground",
            listItem ? "py-1" : "py-1.5"
          )}
        >
          <span className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span
              className={cn(
                "shrink-0 text-xs font-medium text-foreground/80",
                running && "animate-pulse",
                (isError || interrupted) && "text-destructive"
              )}
            >
              {taskLabel}
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {titlePreview}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px] tabular-nums text-muted-foreground",
                    running && "animate-pulse",
                    (isError || interrupted) && "text-destructive"
                  )}
                >
                  {statusLabel}
                </span>
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
                    open && "rotate-90"
                  )}
                  aria-hidden
                />
              </span>
              {metaLine ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
                  {metaLine}
                </span>
              ) : null}
            </span>
          </span>
        </Button>
      </CollapsibleTrigger>

      <AnimatedCollapsibleContent open={open}>
        <CollapsibleContent forceMount>
          {/* 与标题文字列对齐，无边框/底色/滚动；步骤区定高避免顶抖 */}
          <div className="flex min-w-0 max-w-md gap-2 pb-1">
            <span className="w-[28px] shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
              {summary && summary !== description ? (
                <div className="text-[12.5px] leading-5 text-muted-foreground">
                  <MarkdownLite source={summary} />
                </div>
              ) : null}

              {childTodos.length > 0 ? (
                <div className="flex flex-col gap-0.5 text-[11px] leading-4 text-muted-foreground">
                  {childTodos.map((todo) => (
                    <div key={todo.id} className="flex min-w-0 items-start gap-1.5">
                      <span className="mt-0.5 shrink-0">
                        {todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "●" : "○"}
                      </span>
                      <span className={cn("min-w-0 truncate", todo.status === "completed" && "line-through opacity-70")}>
                        {todo.content}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex h-[88px] min-w-0 flex-col justify-end gap-0.5 overflow-hidden">
                {fadedStep ? (
                  <TaskStepWindowRow
                    key={`fade:${normalizeText((fadedStep as { id?: string }).id) || "step"}`}
                    step={fadedStep}
                    faded
                    onOpenToolFile={onOpenToolFile}
                    onOpenBrowserUrl={onOpenBrowserUrl}
                    onOpenTaskSession={onOpenTaskSession}
                  />
                ) : null}
                {windowSteps.map((step, index) => {
                  const key = normalizeText((step as { id?: string }).id) || `step-${index}`;
                  return (
                    <TaskStepWindowRow
                      key={key}
                      step={step}
                      onOpenToolFile={onOpenToolFile}
                      onOpenBrowserUrl={onOpenBrowserUrl}
                      onOpenTaskSession={onOpenTaskSession}
                    />
                  );
                })}
                {windowSteps.length === 0 && !summary && childTodos.length === 0 ? (
                  <div className="py-0.5 text-[11px] text-muted-foreground/70">
                    {running ? "等待子任务步骤…" : "暂无执行步骤"}
                  </div>
                ) : null}
              </div>

              {prompt && !running ? (
                <pre className="max-w-full whitespace-pre-wrap break-words text-[11px] leading-4 text-muted-foreground/80">
                  {prompt}
                </pre>
              ) : null}

              {childSessionId && (completed || isError || interrupted) ? (
                <div className="flex min-w-0 justify-start pt-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-0 text-[11px] text-muted-foreground hover:bg-transparent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTaskSession(childSessionId, description);
                    }}
                  >
                    在会话中打开
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </CollapsibleContent>
      </AnimatedCollapsibleContent>
    </Collapsible>
  );
}
