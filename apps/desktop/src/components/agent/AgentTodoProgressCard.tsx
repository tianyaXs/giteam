import type { AgentTodoItem } from "../../lib/agentSessions";
import { cn } from "../../lib/utils";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "../ui/trace";
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  ListChecksIcon,
  ListTodoIcon,
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

  // 官方 QueueDemo 形状：一个 Trace 里两组 TraceCollapsible（N to do / N completed），
  // 条目按当前状态「滑动」归属——随 todowrite 快照推进，条目从 pending 组滑入
  // completed 组，而不是整卡平铺滚动。pending 展开、completed 收起（defaultOpen）。
  const pending = todos.filter((todo) => todo.status !== "completed");
  const completed = todos.filter((todo) => todo.status === "completed");
  return (
    <div className="w-full rounded-[28px] border border-border/55 bg-card/95 p-3 text-sm shadow-sm">
      <Trace>
        {pending.length > 0 ? (
          <TraceCollapsible key={`pending:${todos.length}`} defaultOpen>
            <TraceCollapsibleTrigger className="min-w-0 max-w-full">
              <TraceLine status={activeSessionBusy ? "running" : undefined}>
                <TraceIcon>
                  <ListTodoIcon />
                </TraceIcon>
                <TraceTitle>{`${pending.length} 待办`}</TraceTitle>
                {progress.active?.content ? (
                  <TraceDescription className="max-w-[240px] shrink truncate">
                    {progress.active.content}
                  </TraceDescription>
                ) : null}
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <Trace>
                {pending.map((todo) => (
                  <TraceLine key={todo.id} status={activeSessionBusy && todo.status === "in_progress" ? "running" : "pending"}>
                    <TraceIcon>
                      {todo.status === "in_progress" && activeSessionBusy ? <CircleDotIcon /> : <CircleIcon />}
                    </TraceIcon>
                    <TraceTitle className="font-normal">{todo.content}</TraceTitle>
                  </TraceLine>
                ))}
              </Trace>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        ) : null}
        {completed.length > 0 ? (
          <TraceCollapsible defaultOpen>
            <TraceCollapsibleTrigger className="min-w-0 max-w-full">
              <TraceLine>
                <TraceIcon>
                  <ListChecksIcon />
                </TraceIcon>
                <TraceTitle>{`${completed.length} 已完成`}</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <Trace>
                {completed.map((todo) => (
                  <TraceLine key={todo.id}>
                    <TraceIcon>
                      <CircleCheckIcon />
                    </TraceIcon>
                    <TraceTitle className="font-normal line-through opacity-70">{todo.content}</TraceTitle>
                  </TraceLine>
                ))}
              </Trace>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        ) : null}
      </Trace>
    </div>
  );
}
