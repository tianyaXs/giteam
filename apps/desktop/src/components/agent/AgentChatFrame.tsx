import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { Card, CardContent, CardFooter } from "../ui/card";
import { cn } from "../../lib/utils";

type AgentSideRailRender = (state: { collapsed: boolean }) => ReactNode;

type AgentChatFrameProps = {
  empty: boolean;
  stream: ReactNode;
  sideRail?: ReactNode | AgentSideRailRender;
  sideRailHidden?: boolean;
  composer: ReactNode;
  /** 悬浮在输入区上方的「拉到最新」按钮，不占用消息列表行高。 */
  jumpLatest?: ReactNode;
};

type SideRailMode = "expanded" | "collapsed" | "hidden";

const THREAD_MAX_WIDTH = 860;
/** 与 AgentMessageListContainer 的 px-10 对齐，进度轨贴内容区而非 860 外框。 */
const THREAD_CONTENT_PADDING_X = 40;
const SIDE_RAIL_GAP = 8;
const SIDE_RAIL_EXPANDED_WIDTH = 300;
const SIDE_RAIL_COLLAPSED_WIDTH = 46;
const SIDE_RAIL_OUTER_PADDING = 8;
/** 相对内容区中心：内容右缘 + 小间距，比贴 860 外框更靠左。 */
const SIDE_RAIL_LEFT_FROM_CENTER =
  THREAD_MAX_WIDTH / 2 - THREAD_CONTENT_PADDING_X + SIDE_RAIL_GAP;

function getSideRailMode(width: number): SideRailMode {
  // 用实际轨道起点算余量，左移后展开所需窗口宽度会明显下降。
  const half = width / 2;
  if (half >= SIDE_RAIL_LEFT_FROM_CENTER + SIDE_RAIL_EXPANDED_WIDTH + SIDE_RAIL_OUTER_PADDING) {
    return "expanded";
  }
  if (half >= SIDE_RAIL_LEFT_FROM_CENTER + SIDE_RAIL_COLLAPSED_WIDTH + SIDE_RAIL_OUTER_PADDING) {
    return "collapsed";
  }
  return "hidden";
}

export function AgentChatFrame({
  empty,
  stream,
  sideRail,
  sideRailHidden = false,
  composer,
  jumpLatest
}: AgentChatFrameProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [sideRailMode, setSideRailMode] = useState<SideRailMode>("hidden");
  const sideRailStyle = {
    left: `calc(50% + ${SIDE_RAIL_LEFT_FROM_CENTER}px)`
  } satisfies CSSProperties;
  const updateSideRailMode = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;
    setSideRailMode(getSideRailMode(node.clientWidth));
  }, []);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    updateSideRailMode();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSideRailMode);
      return () => window.removeEventListener("resize", updateSideRailMode);
    }

    const observer = new ResizeObserver(updateSideRailMode);
    observer.observe(node);
    return () => observer.disconnect();
  }, [empty, updateSideRailMode]);

  useEffect(() => {
    updateSideRailMode();
    const frame = window.requestAnimationFrame(updateSideRailMode);
    const timer = window.setTimeout(updateSideRailMode, 260);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [empty, sideRailHidden, updateSideRailMode]);

  if (empty) {
    return (
      <Card className="flex h-full min-h-0 w-full flex-col justify-center overflow-hidden border-0 bg-transparent px-4 pb-[14vh] pt-6 shadow-none">
        <CardContent className="mx-auto w-full max-w-[620px] p-0">
          {composer}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full min-h-0 w-full flex-col overflow-hidden border-0 bg-transparent shadow-none">
      <CardContent ref={contentRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div className="relative min-h-0 flex-1">
          {stream}
        </div>
        {sideRail ? (
          <>
            <aside
              className={cn(
                "pointer-events-none absolute top-4 z-10 w-[300px] min-w-0 opacity-0 motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out",
                sideRailMode === "expanded" && !sideRailHidden
                  ? "translate-x-0 scale-100 opacity-100"
                  : "translate-x-3 scale-95 opacity-0"
              )}
              style={sideRailStyle}
              aria-label="会话进度"
              aria-hidden={sideRailHidden || sideRailMode !== "expanded"}
            >
              <div className={cn("pointer-events-auto", (sideRailHidden || sideRailMode !== "expanded") && "pointer-events-none")}>
                {typeof sideRail === "function" ? sideRail({ collapsed: false }) : sideRail}
              </div>
            </aside>
            <aside
              className={cn(
                "pointer-events-none absolute top-4 z-10 w-[46px] min-w-0 opacity-0 motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out",
                sideRailMode === "collapsed" && !sideRailHidden
                  ? "translate-x-0 scale-100 opacity-100"
                  : "translate-x-3 scale-95 opacity-0"
              )}
              style={sideRailStyle}
              aria-label="会话进度"
              aria-hidden={sideRailHidden || sideRailMode !== "collapsed"}
            >
              <div className={cn("pointer-events-auto", (sideRailHidden || sideRailMode !== "collapsed") && "pointer-events-none")}>
                {typeof sideRail === "function" ? sideRail({ collapsed: true }) : sideRail}
              </div>
            </aside>
          </>
        ) : null}
      </CardContent>
      <div className="relative w-full shrink-0">
        {jumpLatest ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex -translate-y-[calc(100%+8px)] justify-center">
            <div className="pointer-events-auto">{jumpLatest}</div>
          </div>
        ) : null}
        {/*
          与消息流 Virtuoso 的 scrollbar-gutter:stable 对齐：footer 同样预留滚动条槽位，
          使输入框内容区与消息流左右边界对齐——消息流 Virtuoso 因 stable 预留了右侧滚动条槽，
          内容整体偏左、左侧压输入框左边线。footer 用 overflow-y-auto + stable：内容不溢出时
          不显示滚动条，但仍预留 stable 槽位（若再用 scrollbar-width:none / ::-webkit-scrollbar
          隐藏滚动条，WebKit 下 stable 会失效而不预留，导致再次错位）。
        */}
        <CardFooter className="w-full shrink-0 overflow-y-auto p-0 [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-[860px] px-8 pb-4 pt-3">
            {composer}
          </div>
        </CardFooter>
      </div>
    </Card>
  );
}
