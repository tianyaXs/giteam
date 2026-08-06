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

type SideRailMode = "expanded" | "hidden";

export type ChatLayout = {
  /** 内容列（860px 外框）左缘相对容器的 x 偏移。 */
  contentLeft: number;
  railMode: SideRailMode;
};

const THREAD_MAX_WIDTH = 860;
/** 与 AgentMessageListContainer 的 px-10 对齐，进度轨贴内容区而非 860 外框。 */
const THREAD_CONTENT_PADDING_X = 40;
/** 相对内容右缘的间距，避免进度卡贴着消息区。 */
const SIDE_RAIL_GAP = 12;
const SIDE_RAIL_EXPANDED_WIDTH = 276;
/** 右侧外侧余量：覆盖 scrollbar-gutter（约 12–16px）+ 少量呼吸感。 */
const SIDE_RAIL_OUTER_PADDING = 20;
/** 内容列左缘的最小留白：极窄屏（available < 860）居中位会贴 0，钉到 8 保持呼吸感。 */
const MIN_LEFT_GAP = 8;
/** 右侧快速导航条宽度（与 AgentMessageNavigator 的 w-7 对齐）。 */
const NAVIGATOR_WIDTH = 28;
/** 导航条左缘距消息区右缘的间距。 */
const NAVIGATOR_GAP_FROM_CONTENT = 6;
/** 消息区右缘 → 导航条左缘（导航条贴消息区右缘外侧）。 */
const NAVIGATOR_OFFSET_FROM_CONTENT =
  THREAD_MAX_WIDTH - THREAD_CONTENT_PADDING_X + NAVIGATOR_GAP_FROM_CONTENT;
/** 860 外框左缘 → 进度轨左缘的距离（导航条右侧 + 间距，为导航条让位）。 */
const SIDE_RAIL_OFFSET_FROM_CONTENT =
  NAVIGATOR_OFFSET_FROM_CONTENT + NAVIGATOR_WIDTH + SIDE_RAIL_GAP;
/** 相对内容区中心：内容右缘 + 小间距（居中场景的进度轨位置）。 */
const SIDE_RAIL_LEFT_FROM_CENTER =
  THREAD_MAX_WIDTH / 2 - THREAD_CONTENT_PADDING_X + SIDE_RAIL_GAP;

/** 内容列左缘的纯 CSS calc（基于容器 inline-size 的 100cqw）：宽屏居中/收窄左漂/极窄钉 8，连续无跳变。
 * 两处复用、基准一致：① Card 上挂 container-type:inline-size + 此 calc 作 --chat-content-left
 *   （Card 无 padding，100cqw = Card 宽 = available）；② App.tsx 的 editor 列（wb-editor-inner，无 padding）
 *   同样挂 container-type + 此 calc 作 --chat-content-left 供**标题**消费——标题是 Card 的兄弟（非后代），
 *   拿不到 Card 上的变量，故 editor 列自建一份。标题 div 自身**不**挂 container-type（其 paddingLeft 就是
 *   该 calc，若挂在标题自身会形成 100cqw=available-paddingLeft 的循环依赖、解不出值），靠 editor 列解析。 */
export const CHAT_CONTENT_LEFT_CSS = `max(min((100cqw - ${THREAD_MAX_WIDTH}px) / 2, 100cqw - ${
  SIDE_RAIL_OFFSET_FROM_CONTENT + SIDE_RAIL_EXPANDED_WIDTH + SIDE_RAIL_OUTER_PADDING
}px), ${MIN_LEFT_GAP}px)`;

/**
 * 响应式布局（codex 风格左漂）：宽屏内容居中，收窄时左侧留白优先收起（内容连续左漂），
 * 把空间让给右侧进度轨使其不溢出右缘；极窄（左漂到 MIN_LEFT_GAP 仍不够）进度轨淡出、内容贴左。
 *
 * 关键不变量：contentLeft 是宽度的「连续单调增」函数 max(min(centered, available-reserve), 8)，
 * 侧栏收放/拖窗时绝不左右晃动。进度轨只 expanded/hidden 两档（无 collapsed 中间档），切换仅
 * opacity 淡入淡出、width 固定 276，无 276↔40 宽度突变 = 无抖动。
 *
 * 为何去掉 collapsed：旧三档（276/40/0）下，左漂把 expanded 阈值压到 ~1170，窄屏 sidebar 收放
 * 反复跨越 1170 → rail 在 276↔40 间频繁切换、宽度突变 236px = 抖动。去 collapsed 后 expanded↔hidden
 * 只动 opacity，contentLeft 在切换点（available≈1170）保持 8→8 连续，故不抖。
 */
export function computeChatLayout(width: number): ChatLayout {
  const available = Math.max(0, width);
  const centeredLeft = Math.max((available - THREAD_MAX_WIDTH) / 2, 0);
  // 进度轨右缘不溢出所需的内容左缘上限：offset(866) + 展开宽(276) + 外边距(20) = 1162。
  const railReserve =
    SIDE_RAIL_OFFSET_FROM_CONTENT + SIDE_RAIL_EXPANDED_WIDTH + SIDE_RAIL_OUTER_PADDING;
  // 宽屏取居中；收窄时取 available - railReserve（左漂让位给进度轨）；极窄钉 MIN_LEFT_GAP。
  const contentLeft = Math.max(Math.min(centeredLeft, available - railReserve), MIN_LEFT_GAP);
  const railMode: SideRailMode = contentLeft + railReserve <= available ? "expanded" : "hidden";
  return { contentLeft, railMode };
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
  // 进度卡 left 即时跟随 --chat-rail-left（= contentLeft + 偏移），不参与过渡：侧栏
  // 收放时 contentLeft 逐帧重算，若 left 也加 transition 会形成 200ms 追尾巴、与消息
  // 流错峰来回（“范围更大”的元凶）。只保留 opacity/transform 过渡用于 railMode 进出场。
  const sideRailStyle = {
    left: `var(--chat-rail-left, calc(50% + ${SIDE_RAIL_LEFT_FROM_CENTER}px))`
  } satisfies CSSProperties;
  /** contentLeft / rail / navigator 位置全部用纯 CSS calc（基于容器 inline-size 的 100cqw）：
   * 浏览器布局阶段直接计算、与容器同帧，彻底切断 RO→setState→重渲染链路。此前 JS RO 逐帧算
   * contentLeft 再 setState 下发有两个问题：①左漂区 contentLeft 每帧变→每帧重渲染含 virtuoso
   * 的整帧＝「卡」；②CSS 变量滞后容器 1-2 帧、内容追容器＝「抖」。纯 CSS calc 两者全消。
   * container-type:inline-size 让 100cqw 解析为 Card 宽（=available），不依赖各消费点各自的
   * 包含块，composer/消息流/navigator/aside 四处基准完全一致（连续函数，无跳变）。 */
  const contentStyle = {
    containerType: "inline-size",
    "--chat-content-left": CHAT_CONTENT_LEFT_CSS,
    "--chat-rail-left": `calc(var(--chat-content-left) + ${SIDE_RAIL_OFFSET_FROM_CONTENT}px)`,
    "--chat-nav-left": `calc(var(--chat-content-left) + ${NAVIGATOR_OFFSET_FROM_CONTENT}px)`,
    // 标尺左侧模式：贴内容列左缘外侧（28 宽 + 8 间距）；窄屏 contentLeft≈8 时 clamp 到 4px 不溢出左缘。
    "--chat-nav-left-mirror": `max(calc(var(--chat-content-left) - 36px), 4px)`
  } as CSSProperties;
  const updateChatLayout = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;
    const next = computeChatLayout(node.clientWidth);
    // contentLeft 已改纯 CSS calc（零重渲染）；这里只在 railMode 变化时 setState，
    // 避免 RO 逐帧 contentLeft 变化拖累消息流重渲染（railMode 仅在阈值处低频切换）。
    setChatLayout((prev) => (prev.railMode === next.railMode ? prev : next));
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
                "pointer-events-none absolute top-4 z-10 w-[276px] min-w-0 opacity-0 motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out",
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
          </>
        ) : null}
      </CardContent>
      <div className="relative w-full shrink-0">
        {jumpLatest ? (
          // 按钮水平定位与输入框 composer 同源（left=--chat-content-left + max-w-860 + px-8），
          // 侧栏收放 contentLeft 变化时同帧对齐，不再钉在全宽中心而偏离输入框。
          <div className="pointer-events-none absolute top-0 left-[var(--chat-content-left,0px)] z-20 flex w-full max-w-[860px] -translate-y-[calc(100%+8px)] justify-center px-8">
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
          <div className="ml-[var(--chat-content-left,auto)] mr-auto w-full max-w-[860px] px-8 pb-4 pt-3">
            {composer}
          </div>
        </CardFooter>
      </div>
    </Card>
  );
}
