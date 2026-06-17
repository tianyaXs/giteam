import type { MutableRefObject, ReactNode, RefObject, UIEventHandler, WheelEventHandler } from "react";
import { Card, CardContent, CardFooter } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";

type OpencodeChatFrameProps = {
  empty: boolean;
  threadRef: RefObject<HTMLDivElement | null>;
  onThreadScroll: UIEventHandler<HTMLDivElement>;
  onThreadWheel: WheelEventHandler<HTMLDivElement>;
  stream: ReactNode;
  composer: ReactNode;
};

export function OpencodeChatFrame({
  empty,
  threadRef,
  onThreadScroll,
  onThreadWheel,
  stream,
  composer
}: OpencodeChatFrameProps) {
  const setThreadNode = (node: HTMLDivElement | null) => {
    (threadRef as MutableRefObject<HTMLDivElement | null>).current = node;
  };

  return (
    <Card
      className={cn(
        "flex min-h-0 w-full flex-col overflow-hidden border-0 bg-transparent shadow-none",
        empty ? "h-full justify-center px-4 py-6" : "h-full"
      )}
    >
      <CardContent className={cn("min-h-0 flex-1 p-0", empty && "hidden")}>
        <ScrollArea
          type="always"
          className="h-full min-h-0 w-full"
          viewportRef={setThreadNode}
          viewportClassName="pt-4"
          viewportProps={{
            onScroll: onThreadScroll,
            onWheel: onThreadWheel
          }}
          scrollBarClassName="w-3 bg-transparent px-0 py-2"
          thumbClassName="bg-muted/55 hover:bg-muted/70"
        >
          <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col px-6">
            {stream}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className={cn("mx-auto block w-full shrink-0 p-0", empty ? "max-w-[620px]" : "max-w-[860px]")}>
        {composer}
      </CardFooter>
    </Card>
  );
}
