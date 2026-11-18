import {
  agentContextUsedTokens,
  formatAgentTokens,
  type AgentChatUsage,
  type ContextBreakdown,
  type ContextCategoryId
} from "../../lib/agentSessions";
import { Button } from "../ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { cn } from "../../lib/utils";

type ContextOccupancyMeterProps = {
  usage?: AgentChatUsage | null;
  breakdown?: ContextBreakdown | null;
  contextWindow?: number | null;
};

const CATEGORY_COLORS: Record<ContextCategoryId, string> = {
  system: "bg-muted-foreground/70",
  rules: "bg-emerald-500",
  skills: "bg-orange-500",
  workspace: "bg-teal-500",
  tools: "bg-violet-500",
  mcp: "bg-fuchsia-500",
  runtime: "bg-sky-500",
  summary: "bg-rose-500",
  conversation: "bg-indigo-500"
};

/** AI Elements 圆形进度环常量。 */
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;

function ContextRing({ percent }: { percent: number }) {
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const clamped = Math.min(1, Math.max(0, percent / 100));
  const dashOffset = circumference * (1 - clamped);
  return (
    <svg
      aria-hidden
      height="20"
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.85"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

function SegmentedBar({
  categories,
  total
}: {
  categories: ContextBreakdown["categories"];
  total: number;
}) {
  if (total <= 0 || categories.length === 0) {
    return <div className="h-2 w-full overflow-hidden rounded-full bg-muted" />;
  }
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      {categories.map((row) => {
        const width = Math.max(0.5, (row.estimatedTokens / total) * 100);
        return (
          <div
            key={row.id}
            className={cn("h-full", CATEGORY_COLORS[row.id] || "bg-muted-foreground")}
            style={{ width: `${width}%` }}
            title={`${row.label}: ${formatAgentTokens(row.estimatedTokens)}`}
          />
        );
      })}
    </div>
  );
}

/**
 * 上下文占用：圆环 = billed prompt / window；
 * 浮层 = Cursor 风分类列表 + 分段色条（chars÷4 估计）。
 */
export function ContextOccupancyMeter({
  usage,
  breakdown,
  contextWindow
}: ContextOccupancyMeterProps) {
  if (!usage || contextWindow == null || contextWindow <= 0) return null;

  const usedTokens = breakdown?.billedPrompt ?? agentContextUsedTokens(usage);
  if (usedTokens <= 0) return null;

  const percent = Math.min(100, Math.round((usedTokens / contextWindow) * 100));
  const categories = breakdown?.categories ?? [];
  const segmentTotal =
    breakdown?.estimatedTotal
    || categories.reduce((sum, row) => sum + row.estimatedTokens, 0)
    || usedTokens;
  const deviation =
    breakdown && breakdown.estimatedTotal > 0
      ? Math.abs(breakdown.estimatedTotal - breakdown.billedPrompt)
      : 0;
  const showDeviation = breakdown != null && deviation > Math.max(256, breakdown.billedPrompt * 0.08);

  return (
    <HoverCard openDelay={10} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Context used ${percent}%`}
          title={`Context ${percent}%`}
        >
          <ContextRing percent={percent} />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="end" side="top" className="w-72 gap-0 overflow-hidden p-0">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{percent}% full</span>
            <span className="font-mono text-xs text-muted-foreground">
              ~{formatAgentTokens(usedTokens)} / {formatAgentTokens(contextWindow)}
            </span>
          </div>
          <SegmentedBar categories={categories} total={segmentTotal} />
        </div>
        <div className="flex flex-col gap-1.5 p-3 text-sm">
          {categories.length > 0 ? (
            categories.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-[3px]",
                      CATEGORY_COLORS[row.id] || "bg-muted-foreground"
                    )}
                  />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="shrink-0 font-mono text-xs">
                  {formatAgentTokens(row.estimatedTokens)}
                </span>
              </div>
            ))
          ) : (
            <div className="text-xs text-muted-foreground">
              分类估计将在下一轮回复完成后出现。
            </div>
          )}
        </div>
        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          {breakdown
            ? `估计 · ${breakdown.estimator.replace(/_/g, "/")}`
            : "等待分类估计"}
          {showDeviation
            ? ` · 与账单偏差 ${formatAgentTokens(deviation)}`
            : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
