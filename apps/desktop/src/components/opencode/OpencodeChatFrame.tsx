import type { MutableRefObject, ReactNode, RefObject, UIEventHandler, WheelEventHandler } from "react";
import { Card, CardContent, CardFooter } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
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

  if (empty) {
    return (
      <Card className="flex h-full min-h-0 w-full flex-col justify-center overflow-hidden border-0 bg-transparent px-4 py-6 shadow-none">
        <CardContent className="mx-auto w-full max-w-[620px] p-0">
          {composer}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-0 bg-transparent shadow-none">
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <ScrollArea
          type="always"
          className="min-h-0 flex-1"
          viewportRef={setThreadNode}
          viewportClassName="pt-4"
          viewportProps={{
            onScroll: onThreadScroll,
            onWheel: onThreadWheel
          }}
        >
          <div className="mx-auto flex w-full max-w-[860px] flex-col px-6 pb-4">
            {stream}
          </div>
        </ScrollArea>
      </CardContent>
      <Separator />
      <CardFooter className="mx-auto w-full max-w-[860px] shrink-0 p-0">
        {composer}
      </CardFooter>
    </Card>
  );
}
