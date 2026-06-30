import type { OpencodeTodoItem } from "../../lib/opencodeSessions";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { ScrollArea } from "../ui/scroll-area";
import { CheckIcon, CloseIcon } from "../icons";
import { cn } from "../../lib/utils";

type OpencodeTodoProgressCardProps = {
  todos: OpencodeTodoItem[];
  progress: {
    total: number;
    done: number;
    active: OpencodeTodoItem | null;
  };
  activeSessionBusy: boolean;
  collapsed?: boolean;
};

function TodoStatusMark({
  status,
  activeSessionBusy
}: {
  status: OpencodeTodoItem["status"];
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

export function OpencodeTodoProgressCard({
  todos,
  progress,
  activeSessionBusy,
  collapsed = false
}: OpencodeTodoProgressCardProps) {
  if (todos.length <= 0) return null;

  return (
    <Collapsible open={!collapsed}>
      <Card
        className={cn(
          "w-full rounded-[28px] border-border/55 bg-card/95 shadow-sm transition-all duration-200",
          collapsed && "rounded-full shadow-sm"
        )}
      >
        <CardHeader className={cn("flex-row items-center justify-between gap-2 px-4 pb-2 pt-4", collapsed && "justify-center p-1.5")}>
          {collapsed ? (
            <Badge variant="secondary" className="px-2 text-xs font-normal">
              {progress.done}/{progress.total}
            </Badge>
          ) : (
            <CardTitle className="text-sm font-normal text-muted-foreground">进度</CardTitle>
          )}
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
