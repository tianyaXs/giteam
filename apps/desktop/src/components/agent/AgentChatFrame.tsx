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

export type ChatLayout = {
  /** 内容列（860px 外框）左缘相对容器的 x 偏移。 */
  contentLeft: number;
  railMode: SideRailMode;
};

const THREAD_MAX_WIDTH = 860;
/** 与 AgentMessageListContainer 的 px-10 对齐，进度轨贴内容区而非 860 外框。 */
const THREAD_CONTENT_PADDING_X = 40;
/** 相对内容右缘的间距；略收以给右侧滚动条留空，避免卡片压住滚动条。 */
const SIDE_RAIL_GAP = 0;
const SIDE_RAIL_EXPANDED_WIDTH = 300;
const SIDE_RAIL_COLLAPSED_WIDTH = 46;
/** 右侧外侧余量：覆盖 scrollbar-gutter（约 12–16px）+ 少量呼吸感。 */
const SIDE_RAIL_OUTER_PADDING = 20;
/** 空间不足时内容列左缘的最小留白——左侧空白是首个被牺牲的区域。 */
const MIN_LEFT_GAP = 24;
/** 860 外框左缘 → 进度轨左缘的距离（贴内容区右缘 + 小间距）。 */
const SIDE_RAIL_OFFSET_FROM_CONTENT =
  THREAD_MAX_WIDTH - THREAD_CONTENT_PADDING_X + SIDE_RAIL_GAP;
/** 相对内容区中心：内容右缘 + 小间距（居中场景的进度轨位置）。 */
const SIDE_RAIL_LEFT_FROM_CENTER =
  THREAD_MAX_WIDTH / 2 - THREAD_CONTENT_PADDING_X + SIDE_RAIL_GAP;

/**
 * 响应式布局优先级：内容区 > 右侧进度轨 > 左侧空白。
 *
 * 连续性设计（无跳变）：内容列左缘是宽度的连续函数——
 * 空间充足时居中；宽度收缩越过「居中能容下展开轨」的临界后，内容列随宽度
 * 缓慢左漂（每缩 1px 漂 1px），漂到左缘下限后定格；此后宽度继续变化只让
 * 进度轨在右缘原地降级（展开→折叠→淡出），内容列不再移动，
 * 避免阈值处整列瞬移几百像素。
 */
export function computeChatLayout(width: number): ChatLayout {
  const available = Math.max(0, width);
  const centeredLeft = Math.max((available - THREAD_MAX_WIDTH) / 2, 0);
  const expandedNeed =
    SIDE_RAIL_OFFSET_FROM_CONTENT + SIDE_RAIL_EXPANDED_WIDTH + SIDE_RAIL_OUTER_PADDING;
  const collapsedNeed =
    SIDE_RAIL_OFFSET_FROM_CONTENT + SIDE_RAIL_COLLAPSED_WIDTH + SIDE_RAIL_OUTER_PADDING;

  // 轨道档位只看「左压到极限后能否容下」，降级发生在右缘局部。
  const railMode: SideRailMode =
    available >= MIN_LEFT_GAP + expandedNeed
      ? "expanded"
      : available >= MIN_LEFT_GAP + collapsedNeed
        ? "collapsed"
        : "hidden";

  if (railMode === "expanded") {
    // 居中 → 左漂的连续过渡：min(居中, 给展开轨留位的右贴值)，且不低于左缘下限。
    return {
      contentLeft: Math.max(Math.min(centeredLeft, available - expandedNeed), MIN_LEFT_GAP),
      railMode
    };
  }
  if (railMode === "collapsed") {
    // min(居中, 左缘下限)：低端与 hidden 档的居中位衔接、高端与展开档的左漂
    // 终点衔接，整段连续，宽度变化几乎全由轨道原地折叠吸收。
    return { contentLeft: Math.min(centeredLeft, MIN_LEFT_GAP), railMode };
  }
  return { contentLeft: centeredLeft, railMode };
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
  const [chatLayout, setChatLayout] = useState<ChatLayout>({ contentLeft: 0, railMode: "hidden" });
  const sideRailMode = chatLayout.railMode;
  const sideRailStyle = {
    left: `var(--chat-rail-left, calc(50% + ${SIDE_RAIL_LEFT_FROM_CENTER}px))`
  } satisfies CSSProperties;
  /** 内容列左缘 / 进度轨位置经 CSS 变量下发，消息流与输入框共用同一偏移。 */
  const contentStyle = {
    "--chat-content-left": `${chatLayout.contentLeft}px`,
    "--chat-rail-left": `${chatLayout.contentLeft + SIDE_RAIL_OFFSET_FROM_CONTENT}px`
  } as CSSProperties;
  const updateChatLayout = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;
    const next = computeChatLayout(node.clientWidth);
    setChatLayout((prev) =>
      prev.contentLeft === next.contentLeft && prev.railMode === next.railMode ? prev : next
    );
  }, []);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    updateChatLayout();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateChatLayout);
      return () => window.removeEventListener("resize", updateChatLayout);
    }

    const observer = new ResizeObserver(updateChatLayout);
    observer.observe(node);
    return () => observer.disconnect();
  }, [empty, updateChatLayout]);

  useEffect(() => {
    updateChatLayout();
    const frame = window.requestAnimationFrame(updateChatLayout);
    const timer = window.setTimeout(updateChatLayout, 260);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [empty, sideRailHidden, updateChatLayout]);

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
    // CSS 变量挂在根 Card：CardContent（消息流）与 CardFooter（输入框）是兄弟节点，
    // 变量必须覆盖两者，输入框才会跟着内容区一起滑动。
    <Card
      className="flex h-full min-h-0 w-full flex-col overflow-hidden border-0 bg-transparent shadow-none"
      style={contentStyle}
    >
      <CardContent
        ref={contentRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      >
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
        <CardFooter className="gt-subtle-scrollbar w-full shrink-0 overflow-y-auto p-0 [scrollbar-gutter:stable]">
          <div className="ml-[var(--chat-content-left,auto)] mr-auto w-full max-w-[860px] px-8 pb-4 pt-3 motion-safe:transition-[margin] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]">
            {composer}
          </div>
        </CardFooter>
      </div>
    </Card>
  );
}
