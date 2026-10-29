import type { AgentTodoItem } from "../../lib/agentSessions";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";
import {
  Plan,
  PlanDescription,
  PlanHeader,
  PlanHeaderTrigger,
  PlanIcon,
  PlanTitle,
  PlanTrigger,
  PlanContent,
} from "../ai-elements/plan";
import { TraceIcon, TraceLine, TraceTitle } from "../ui/trace";
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  RouteIcon,
} from "lucide-react";

type AgentTodoProgressCardProps = {
  todos: AgentTodoItem[];
  progress: {
    total: number;
    done: number;
    active: AgentTodoItem | null;
  };
  activeSessionBusy: boolean;
  collapsed?: boolean;
};

export function AgentTodoProgressCard({
  todos,
  progress,
  activeSessionBusy,
  collapsed = false
}: AgentTodoProgressCardProps) {
  if (todos.length <= 0) return null;

  const label = `${progress.done}/${progress.total}`;
  const title = progress.active?.content
    ? `进度 ${label} · ${progress.active.content}`
    : `进度 ${label}`;

  if (collapsed) {
    // 单层胶囊：避免 Card+Badge 叠成「外白圈 + 内灰底」。
    return (
      <div
        className={cn(
          "inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-border/60 bg-card px-2.5",
          activeSessionBusy && "border-muted-foreground/70 animate-pulse"
        )}
      >
        {label}
      </div>
    );
  }

  // 官方 Plan 形状：Route 图标摘要行（isStreaming 时 shimmer）+ done/running/
  // pending 三态步骤行，外层 Trace 折叠。
  return (
    <Plan
      isStreaming={activeSessionBusy}
      className="w-full rounded-[28px] border border-border/55 bg-card/95 p-3 shadow-sm"
    >
      <PlanHeader defaultOpen>
        <PlanHeaderTrigger>
          <PlanTrigger>
            <PlanIcon>
              <RouteIcon />
            </PlanIcon>
            <PlanTitle>进度</PlanTitle>
            <PlanDescription className="max-w-[280px] truncate">
              {label}
              {progress.active?.content ? ` · ${progress.active.content}` : ""}
            </PlanDescription>
          </PlanTrigger>
        </PlanHeaderTrigger>
      </PlanHeader>
      <PlanContent>
        <ScrollArea className="max-h-[min(46vh,340px)] pr-1.5" scrollBarClassName="w-1.5">
          <div className="flex flex-col gap-1">
            {todos.map((todo) => {
              const completed = todo.status === "completed";
              const running =
                todo.status === "in_progress"
                && progress.active?.id === todo.id;
              const status: "running" | "pending" | undefined = completed
                ? undefined
                : running
                  ? "running"
                  : "pending";
              return (
                <TraceLine key={todo.id} status={status}>
                  <TraceIcon>
                    {completed ? (
                      <CircleCheckIcon />
                    ) : running ? (
                      <CircleDotIcon />
                    ) : (
                      <CircleIcon />
                    )}
                  </TraceIcon>
                  <TraceTitle className={cn("font-normal", completed && "line-through opacity-70")}>
                    {todo.content}
                  </TraceTitle>
                </TraceLine>
              );
            })}
          </div>
        </ScrollArea>
      </PlanContent>
    </Plan>
  );
}
