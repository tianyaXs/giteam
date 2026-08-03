import type { AgentTodoItem } from "../../lib/agentSessions";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { ScrollArea } from "../ui/scroll-area";
import { CheckIcon, CloseIcon } from "../icons";
import { cn } from "../../lib/utils";

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

function TodoStatusMark({
  status,
  activeSessionBusy
}: {
  status: AgentTodoItem["status"];
  activeSessionBusy: boolean;
}) {
  const running = status === "in_progress";
  const completed = status === "completed";
  const cancelled = status === "cancelled";

  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border text-muted-foreground",
        completed && "border-muted-foreground/75 bg-muted-foreground/80 text-background",
        cancelled && "border-border bg-muted text-muted-foreground",
        running && "border-muted-foreground/75 bg-muted-foreground/80 text-background",
        running && activeSessionBusy && "animate-pulse"
      )}
      aria-hidden="true"
    >
      {completed ? (
        <CheckIcon width={12} height={12} />
      ) : cancelled ? (
        <CloseIcon width={10} height={10} />
      ) : running ? (
        <span className="size-1 rounded-full bg-background" />
      ) : null}
    </span>
  );
}

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
          "text-xs font-medium tabular-nums tracking-normal text-muted-foreground shadow-sm",
          "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
          "hover:-translate-y-px hover:border-border hover:bg-muted hover:text-foreground hover:shadow-md",
          "active:translate-y-0 active:shadow-sm"
        )}
        title={title}
        aria-label={title}
      >
        {label}
      </div>
    );
  }

  return (
    <Collapsible open>
      <Card className="w-full rounded-[28px] border-border/55 bg-card/95 shadow-sm transition-all duration-200">
        <CardHeader className="flex-row items-center justify-between gap-2 px-4 pb-2 pt-4">
          <CardTitle className="text-sm font-normal text-muted-foreground">进度</CardTitle>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{label}</span>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 pt-0">
            <ScrollArea className="max-h-[min(46vh,340px)] pr-1.5" scrollBarClassName="w-1.5">
              <div className="flex flex-col gap-2">
                {todos.map((todo) => {
                  const current = progress.active?.id === todo.id && todo.status !== "completed";
                  return (
                    <div key={todo.id} className="flex min-w-0 items-start gap-2">
                      <TodoStatusMark status={todo.status} activeSessionBusy={activeSessionBusy} />
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm font-normal leading-6 text-muted-foreground",
                          current && "text-foreground"
                        )}
                      >
                        {todo.content}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
