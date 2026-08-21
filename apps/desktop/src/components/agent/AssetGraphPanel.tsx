/**
 * 右侧「记忆」tab：跨会话仓库记忆图谱。
 *
 * 渲染设计完整对齐 semantica Knowledge Explorer（同款 sigma.js 组件族）：
 * - 曲边 + 箭头（@sigma/edge-curve EdgeCurvedArrowProgram，方向可辨）
 * - 节点环（@sigma/node-border NodeBorderProgram；center 金环常亮，
 *   hover 亮环）——对齐 semantica 的 ring/border 层次
 * - 边层级：结构边（has_turn/used_tool…）最淡，资产边（modified/read…）
 *   中等，语义边（sem/*）最亮——不靠静态单色
 * - hover 卡片：canvas 圆角卡（标题 13px 粗体 + 类型 meta 10px），
 *   对齐 semantica labels.hoverCard 的构图与配色
 * - 缩放三档 LOD（overview/structure/inspection）：标签阈值与边基准色
 *   随相机 ratio 变化
 * - 聚焦状态机：hover/selected/neighbor/muted（muted 去标签压暗）
 * - 相机动画：点选飞到节点（480ms，对齐 semantica motion.cameraMs）；
 *   布局收敛后自动 fit
 * - 主题兼容：深浅两套调色板（node 浅色版降亮度；边/标签/hover 卡分色），
 *   MutationObserver 监听 data-theme 切换即重建
 *
 * 布局：ForceAtlas2 Worker 持续动画（semantica FA2_SETTINGS），按节点位移
 * 检测收敛后停并自动 fit（20s 上限兜底）。
 */

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import Graph from "graphology";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import Sigma from "sigma";
import { NodeBorderProgram } from "@sigma/node-border";
import { Loader2, RefreshCw, Search, Waypoints, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../../lib/platform";
import { scheduleAfterInteraction, scheduleWhenIdle } from "../../lib/browserRuntime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// ---------- 类型（对齐内核 query.rs DTO，camelCase） ----------

type GraphCounts = {
  nodes: number; edges: number; sessions: number; files: number;
  toolCalls: number; errors: number; commits: number; mounted: boolean;
};

type NodeHit = { nodeId: string; nodeType: string; label: string; lastSeenMs: number };

type SubgraphNode = {
  nodeId: string; nodeType: string; label: string; props: string; lastSeenMs: number;
};

type SubgraphEdge = { srcId: string; dstId: string; edgeType: string; timestampMs: number };

type SubgraphView = { center: string; nodes: SubgraphNode[]; edges: SubgraphEdge[] };

// ---------- 主题感知调色板 ----------

type GraphThemeMode = "dark" | "light";

/** 监听 data-theme / dark class（useDesktopTheme 写这两者），切换即换色。 */
function useGraphThemeMode(): GraphThemeMode {
  const read = (): GraphThemeMode =>
    document.documentElement.classList.contains("dark") ||
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  const [mode, setMode] = useState<GraphThemeMode>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** 深色主题的节点调色板（低饱和、色相区分类型）。 */
const TYPE_COLORS_DARK: Record<string, string> = {
  session: "#a78bfa", run: "#8b7bd8", turn: "#7b6ec8", message: "#7aa2cc",
  tool_call: "#c9a26d", file: "#6db5a8", command: "#7f96b8", error: "#c96d84",
  commit: "#94b56d",
  decision: "#d2b45c", feature: "#6db5c9", module: "#9b8bd0",
  tech_concept: "#8faab8", error_pattern: "#c07a95", api: "#c99a6d",
  tradeoff: "#b07dc0", open_task: "#c8b06d",
};

/** 浅色主题同色相、降亮提饱和（白底上可读）。 */
const TYPE_COLORS_LIGHT: Record<string, string> = {
  session: "#7c5ce0", run: "#6b5cc0", turn: "#5b50a8", message: "#4a7ab0",
  tool_call: "#a0763c", file: "#3d8f82", command: "#4a6d96", error: "#b04060",
  commit: "#5d8a3c",
  decision: "#a8882c", feature: "#3d8fa8", module: "#7565b0",
  tech_concept: "#5a7a8c", error_pattern: "#a04a6e", api: "#a0703a",
  tradeoff: "#8c4d9c", open_task: "#9c8440",
};

const TYPE_LABELS: Record<string, string> = {
  session: "会话", run: "运行", turn: "轮次", message: "消息",
  tool_call: "工具调用", file: "文件", command: "命令", error: "错误", commit: "提交",
  decision: "决策", feature: "功能", module: "模块", tech_concept: "技术概念",
  error_pattern: "错误模式", api: "接口", tradeoff: "取舍", open_task: "待办",
};

/** 单套图的主题化视觉常量（semantica palette.edges 的主题化版）。 */
interface SceneTheme {
  label: string;
  /** 结构边 / 资产边 / 语义边三档基准色（非聚焦态）。 */
  edgeStructural: string;
  edgeAsset: string;
  edgeSemantic: string;
  edgeHover: string;
  edgeMuted: string;
  nodeMuted: string;
  nodeOutline: string;
  hoverCard: {
    background: string;
    border: string;
    titleColor: string;
    metaColor: string;
  };
}

/**
 * sigma v3 的 WebGL 混合是预乘 alpha（blendFunc(ONE, ONE_MINUS_SRC_ALPHA)），
 * 但它的颜色管线不做预乘：半透明色的 RGB 会被全额叠加到帧缓冲，
 * alpha 只衰减背景、不衰减颜色本身。直接传 rgba(148,163,184,0.07)，
 * 深色主题下渲染为全量 #94a3b8 —— 即「边白色常亮」。
 * 传给 sigma 的半透明色必须先手动预乘 RGB；canvas 2D 用的颜色不要走这里。
 */
function sigmaRgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r * a)}, ${Math.round(g * a)}, ${Math.round(b * a)}, ${a})`;
}

function sceneTheme(mode: GraphThemeMode): SceneTheme {
  if (mode === "light") {
    return {
      label: "#4a5568",
      edgeStructural: sigmaRgba(100, 116, 139, 0.13),
      edgeAsset: sigmaRgba(100, 116, 139, 0.18),
      edgeSemantic: sigmaRgba(100, 116, 139, 0.22),
      edgeHover: sigmaRgba(51, 65, 85, 0.85),
      edgeMuted: sigmaRgba(100, 116, 139, 0.05),
      nodeMuted: sigmaRgba(148, 163, 184, 0.30),
      nodeOutline: sigmaRgba(255, 255, 255, 0.9),
      hoverCard: {
        background: "rgba(255, 255, 255, 0.97)",
        border: "rgba(100, 116, 139, 0.30)",
        titleColor: "#1e293b",
        metaColor: "rgba(71, 85, 105, 0.72)",
      },
    };
  }
  return {
    label: "#c8cdd6",
    edgeStructural: sigmaRgba(148, 163, 184, 0.07),
    edgeAsset: sigmaRgba(148, 163, 184, 0.11),
    edgeSemantic: sigmaRgba(148, 163, 184, 0.15),
    edgeHover: sigmaRgba(222, 232, 245, 0.72),
    edgeMuted: sigmaRgba(148, 163, 184, 0.025),
    nodeMuted: sigmaRgba(138, 145, 158, 0.16),
    nodeOutline: sigmaRgba(8, 12, 20, 0.9),
    hoverCard: {
      background: "rgba(12, 17, 29, 0.96)",
      border: "rgba(154, 181, 212, 0.32)",
      titleColor: "#EAF3FF",
      metaColor: "rgba(184, 214, 255, 0.58)",
    },
  };
}

const RING_CENTER = "#FFC857"; // semantica selected 金
const RING_HOVER = "#5EC6FF"; // semantica hoverGlow 青

// ---------- 边层级（类型 → 视觉层级） ----------

type EdgeTier = "structural" | "asset" | "semantic";

function edgeTier(edgeType: string): EdgeTier {
  if (edgeType.startsWith("sem/") || edgeType === "extracted") return "semantic";
  // 聚合边（compact 总览）：会话→资产折叠，按资产档着色。
  if (edgeType === "touches" || edgeType === "fixed") return "asset";
  switch (edgeType) {
    case "modified":
    case "read":
    case "executed":
    case "produced":
    case "failed_with":
    case "resolved_by":
      return "asset";
    default:
      return "structural";
  }
}

function edgeBaseColor(tier: EdgeTier, theme: SceneTheme): string {
  switch (tier) {
    case "structural":
      return theme.edgeStructural;
    case "asset":
      return theme.edgeAsset;
    case "semantic":
      return theme.edgeSemantic;
  }
}

// ---------- zoom LOD（对齐 semantica zoomTiers 的精简版） ----------

type ZoomTier = "overview" | "structure" | "inspection";

function zoomTierOf(ratio: number): ZoomTier {
  if (ratio > 1.15) return "overview";
  if (ratio > 0.55) return "structure";
  return "inspection";
}

function labelThresholdFor(tier: ZoomTier): number {
  switch (tier) {
    case "overview":
      return 8.5;
    case "structure":
      return 6;
    case "inspection":
      return 4;
  }
}

// ---------- 工具 ----------

function ageLabel(ms: number): string {
  const delta = Math.max(0, Date.now() - ms) / 1000;
  if (delta < 3600) return `${Math.round(delta / 60)}m`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h`;
  return `${Math.round(delta / 86400)}d`;
}

function propsRows(raw: string): Array<[string, string]> {
  try {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => [k, v as string]);
  } catch {
    return [];
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- sigma 场景 ----------

type SigmaSceneState = {
  hovered: string | null;
  selected: string | null;
  zoomTier: ZoomTier;
};

function buildSigmaScene(options: {
  container: HTMLDivElement;
  view: SubgraphView;
  themeMode: GraphThemeMode;
  stateRef: React.MutableRefObject<SigmaSceneState>;
  selectCbRef: React.MutableRefObject<(node: SubgraphNode | null) => void>;
  setReady: (ready: boolean) => void;
}): () => void {
  const { container, view, themeMode, stateRef, selectCbRef, setReady } = options;
  const theme = sceneTheme(themeMode);
  const palette = themeMode === "light" ? TYPE_COLORS_LIGHT : TYPE_COLORS_DARK;
  const colorOf = (type: string) => palette[type] ?? (themeMode === "light" ? "#64748b" : "#8a919e");

  const graph = new Graph();
  const nodesById = new Map(view.nodes.map((n) => [n.nodeId, n]));
  const count = view.nodes.length;
  const isCenter = (id: string) => id === view.center;

  // 紧凑随机播种（高斯近似），FA2 从中聚簇。
  const rand = () => (Math.random() + Math.random() + Math.random()) / 3 - 0.5;
  for (const node of view.nodes) {
    graph.addNode(node.nodeId, {
      x: rand() * 400,
      y: rand() * 400,
      size: 4,
      color: colorOf(node.nodeType),
      label: node.label || TYPE_LABELS[node.nodeType] || node.nodeType,
      nodeType: node.nodeType,
      isCenter: isCenter(node.nodeId),
      borderColor: isCenter(node.nodeId) ? RING_CENTER : theme.nodeOutline,
      borderSize: isCenter(node.nodeId) ? 2.2 : 0,
      lastSeenMs: node.lastSeenMs,
    });
  }
  for (const edge of view.edges) {
    if (!graph.hasNode(edge.srcId) || !graph.hasNode(edge.dstId)) continue;
    if (graph.hasEdge(edge.srcId, edge.dstId)) continue;
    const tier = edgeTier(edge.edgeType);
    graph.addDirectedEdge(edge.srcId, edge.dstId, {
      color: edgeBaseColor(tier, theme),
      size: 0.55,
      tier,
    });
  }
  graph.forEachNode((node) => {
    const degree = graph.degree(node);
    const centerBoost = graph.getNodeAttribute(node, "isCenter") ? 1.6 : 0;
    graph.setNodeAttribute(node, "size", 2.6 + Math.min(3.5, degree * 0.32) + centerBoost);
  });

  const drawHoverCard = (
    context: CanvasRenderingContext2D,
    data: { x: number; y: number; size: number; label: string },
    metaLabel: string
  ) => {
    if (!data.label) return;
    const font = "system-ui, -apple-system, sans-serif";
    const titleFont = `600 13px ${font}`;
    const metaFont = `500 10px ${font}`;
    context.save();
    context.textBaseline = "top";
    context.font = titleFont;
    const titleWidth = context.measureText(data.label).width;
    context.font = metaFont;
    const metaWidth = context.measureText(metaLabel).width;
    const paddingX = 10;
    const paddingY = 7;
    const titleSize = 13;
    const metaSize = 10;
    const metaGap = 5;
    const width = Math.max(titleWidth, metaWidth) + paddingX * 2;
    const height = paddingY * 2 + titleSize + metaGap + metaSize;
    const x = data.x + Math.max(data.size * 0.9, 12);
    const y = data.y - Math.max(data.size * 1.1, 14) - height;
    context.shadowColor = "rgba(0, 0, 0, 0.35)";
    context.shadowBlur = 14;
    context.fillStyle = theme.hoverCard.background;
    drawRoundedRect(context, x, y, width, height, 8);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = theme.hoverCard.border;
    context.lineWidth = 1;
    drawRoundedRect(context, x, y, width, height, 8);
    context.stroke();
    context.fillStyle = theme.hoverCard.titleColor;
    context.font = titleFont;
    context.fillText(data.label, x + paddingX, y + paddingY);
    context.fillStyle = theme.hoverCard.metaColor;
    context.font = metaFont;
    context.fillText(metaLabel, x + paddingX, y + paddingY + titleSize + metaGap);
    context.restore();
  };

  const sigma = new Sigma(graph, container, {
    renderLabels: true,
    labelColor: { color: theme.label },
    labelFont: "system-ui, -apple-system, sans-serif",
    labelSize: 11,
    labelWeight: "400",
    labelRenderedSizeThreshold: labelThresholdFor("overview"),
    labelDensity: 0.55,
    labelGridCellSize: 110,
    stagePadding: 20,
    zIndex: true,
    minCameraRatio: 0.04,
    maxCameraRatio: 10,
    defaultNodeType: "bordered",
    nodeProgramClasses: { bordered: NodeBorderProgram },
    defaultDrawNodeHover: (context, data) => {
      const nodeType = (data as unknown as { nodeType?: string }).nodeType ?? "";
      const lastSeenMs = (data as unknown as { lastSeenMs?: number }).lastSeenMs ?? 0;
      const meta = nodeType
        ? `${(TYPE_LABELS[nodeType] ?? nodeType).toUpperCase()} · ${ageLabel(lastSeenMs)}前`
        : "NODE";
      drawHoverCard(context, data as unknown as { x: number; y: number; size: number; label: string }, meta);
    },
  });

  const onCameraUpdated = () => {
    const ratio = sigma.getCamera().getState().ratio;
    const tier = zoomTierOf(ratio);
    if (tier !== stateRef.current.zoomTier) {
      stateRef.current.zoomTier = tier;
      sigma.setSetting("labelRenderedSizeThreshold", labelThresholdFor(tier));
      sigma.refresh();
    }
  };
  sigma.getCamera().on("updated", onCameraUpdated);

  const applyState = () => {
    const focus = stateRef.current.selected ?? stateRef.current.hovered;
    sigma.setSetting("nodeReducer", (node, data) => {
      if (!focus) return data;
      if (node === focus) {
        return {
          ...data,
          zIndex: 4,
          highlighted: true,
          forceLabel: true,
          borderColor: RING_HOVER,
          borderSize: 2.4,
        };
      }
      if (graph.neighbors(focus).includes(node)) {
        return { ...data, zIndex: 2 };
      }
      return {
        ...data,
        zIndex: 0,
        color: theme.nodeMuted,
        label: null,
        borderColor: undefined,
        borderSize: 0,
      } as typeof data;
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      const [src, dst] = graph.extremities(edge);
      if (focus && (src === focus || dst === focus)) {
        return { ...data, color: theme.edgeHover, size: 1.1, zIndex: 4 };
      }
      if (!focus) return data;
      return { ...data, color: theme.edgeMuted, size: 0.5 };
    });
    sigma.refresh();
  };

  sigma.on("enterNode", ({ node }) => {
    stateRef.current.hovered = node;
    applyState();
  });
  sigma.on("leaveNode", () => {
    stateRef.current.hovered = null;
    applyState();
  });

  let draggedNode: string | null = null;
  let dragMoved = false;
  const mouseCaptor = sigma.getMouseCaptor();
  const onDownNode = ({ node, event }: { node: string; event: { preventSigmaDefault(): void } }) => {
    event.preventSigmaDefault();
    draggedNode = node;
    dragMoved = false;
    graph.setNodeAttribute(node, "fixed", true);
    container.style.cursor = "grabbing";
    if (!sigma.getCustomBBox()) {
      sigma.setCustomBBox(sigma.getBBox());
    }
  };
  const onMoveBody = (event: {
    x: number;
    y: number;
    preventSigmaDefault(): void;
    original: { preventDefault(): void; stopPropagation(): void };
  }) => {
    if (!draggedNode) return;
    const pos = sigma.viewportToGraph({ x: event.x, y: event.y });
    graph.setNodeAttribute(draggedNode, "x", pos.x);
    graph.setNodeAttribute(draggedNode, "y", pos.y);
    dragMoved = true;
    event.preventSigmaDefault();
    event.original.preventDefault();
    event.original.stopPropagation();
    sigma.refresh();
  };
  const onUp = () => {
    if (!draggedNode) return;
    draggedNode = null;
    container.style.cursor = "";
  };
  sigma.on("downNode", onDownNode);
  mouseCaptor.on("mousemovebody", onMoveBody);
  mouseCaptor.on("mouseup", onUp);

  sigma.on("clickNode", ({ node }) => {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    const next = stateRef.current.selected === node ? null : node;
    stateRef.current.selected = next;
    selectCbRef.current(next ? nodesById.get(next) ?? null : null);
    applyState();
    if (next) {
      const pos = sigma.getNodeDisplayData(node);
      if (pos) {
        sigma.getCamera().animate({ x: pos.x, y: pos.y }, { duration: 480 });
      }
    }
  });
  sigma.on("clickStage", () => {
    stateRef.current.selected = null;
    selectCbRef.current(null);
    applyState();
  });
  sigma.on("doubleClickNode", ({ node }) => {
    container.dispatchEvent(new CustomEvent("asset-graph-drill", { detail: { node } }));
  });

  const FA2_SETTINGS = {
    barnesHutOptimize: true,
    barnesHutTheta: 0.5,
    adjustSizes: false,
    gravity: 0.06,
    scalingRatio: 40,
    edgeWeightInfluence: 0.3,
    linLogMode: true,
    strongGravityMode: false,
    slowDown: 8,
  };
  let fa2: InstanceType<typeof FA2Layout> | null = null;
  let settlePoll: number | null = null;
  let syncFrame: number | null = null;
  let syncDisposed = false;
  if (count > 1) {
    fa2 = new FA2Layout(graph, { settings: FA2_SETTINGS });
    fa2.start();
    let lastPositions: Float64Array | null = null;
    let stableRounds = 0;
    const startedAt = Date.now();
    settlePoll = window.setInterval(() => {
      if (draggedNode) return;
      const positions = new Float64Array(count * 2);
      let i = 0;
      graph.forEachNode((_, attrs) => {
        positions[i++] = attrs.x as number;
        positions[i++] = attrs.y as number;
      });
      if (lastPositions) {
        let maxDelta = 0;
        for (let j = 0; j < positions.length; j++) {
          const delta = Math.abs(positions[j] - lastPositions[j]);
          if (delta > maxDelta) maxDelta = delta;
        }
        stableRounds = maxDelta < 1 ? stableRounds + 1 : 0;
      }
      lastPositions = positions;
      if (stableRounds >= 3 || Date.now() - startedAt > 20_000) {
        if (settlePoll !== null) window.clearInterval(settlePoll);
        settlePoll = null;
        fa2?.stop();
        // 布局停后不再刷屏；之后靠 sigma 自身事件刷新
        if (syncFrame !== null) {
          window.clearTimeout(syncFrame);
          syncFrame = null;
        }
        sigma.refresh();
        sigma.getCamera().animatedReset({ duration: 400 });
      }
    }, 400);
    const sync = () => {
      if (syncDisposed) return;
      sigma.refresh();
      // 布局期 ~20fps 刷新即可，避免与侧栏 React 更新抢主线程
      syncFrame = window.setTimeout(sync, 50);
    };
    syncFrame = window.setTimeout(sync, 50);
  }

  setReady(true);
  return () => {
    syncDisposed = true;
    if (syncFrame !== null) window.clearTimeout(syncFrame);
    if (settlePoll !== null) window.clearInterval(settlePoll);
    sigma.getCamera().removeListener("updated", onCameraUpdated);
    sigma.off("downNode", onDownNode);
    mouseCaptor.off("mousemovebody", onMoveBody);
    mouseCaptor.off("mouseup", onUp);
    fa2?.stop();
    fa2?.kill();
    sigma.kill();
    container.style.cursor = "";
    setReady(false);
  };
}

function useSigmaScene(
  containerRef: React.RefObject<HTMLDivElement | null>,
  view: SubgraphView | null,
  themeMode: GraphThemeMode,
  onSelectNode: (node: SubgraphNode | null) => void
): { ready: boolean } {
  const [ready, setReady] = useState(false);
  const [pendingSize, setPendingSize] = useState(false);
  const stateRef = useRef<SigmaSceneState>({
    hovered: null,
    selected: null,
    zoomTier: "overview",
  });
  const selectCbRef = useRef(onSelectNode);
  selectCbRef.current = onSelectNode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !view || view.nodes.length === 0) {
      setReady(false);
      return;
    }
    // 容器零尺寸守护（tab 未可见时不建场景）。
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      let cancelled = false;
      const observer = new ResizeObserver(() => {
        if (cancelled) return;
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          observer.disconnect();
          setPendingSize((v) => !v);
        }
      });
      observer.observe(container);
      setReady(false);
      return () => {
        cancelled = true;
        observer.disconnect();
      };
    }

    // 社区常见做法：requestIdleCallback 再建 WebGL，避免与消息区抢 Long Task
    let cancelled = false;
    let cleanupScene: (() => void) | null = null;
    const cancelIdle = scheduleWhenIdle(() => {
      if (cancelled || !containerRef.current) return;
      const cleanup = buildSigmaScene({
        container: containerRef.current,
        view,
        themeMode,
        stateRef,
        selectCbRef,
        setReady,
      });
      if (cancelled) {
        cleanup();
        return;
      }
      cleanupScene = cleanup;
    }, { timeout: 1500, delay: 32 });

    return () => {
      cancelled = true;
      cancelIdle();
      cleanupScene?.();
      setReady(false);
    };
  }, [containerRef, view, pendingSize, themeMode]);

  return { ready };
}

// ---------- 面板 ----------

type AssetGraphPanelProps = {
  repoPath: string;
  /** 会话消息正在 hydration/加载时，自动拉图让路，避免与 getMessages 抢 IPC/主线程 */
  deferForContent?: boolean;
};

export function AssetGraphPanel({ repoPath, deferForContent = false }: AssetGraphPanelProps) {
  const [counts, setCounts] = useState<GraphCounts | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hits, setHits] = useState<NodeHit[]>([]);
  const [view, setView] = useState<SubgraphView | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [detail, setDetail] = useState<SubgraphNode | null>(null);

  const themeMode = useGraphThemeMode();
  const palette = themeMode === "light" ? TYPE_COLORS_LIGHT : TYPE_COLORS_DARK;
  const colorOf = useCallback(
    (type: string) => palette[type] ?? (themeMode === "light" ? "#64748b" : "#8a919e"),
    [palette, themeMode]
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<SubgraphView | null>(null);
  viewRef.current = view;
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const [drilled, setDrilled] = useState<string | null>(null);
  /** idle=加载中；ready=已有数据或已确认空 */
  const [loadPhase, setLoadPhase] = useState<"idle" | "ready">("idle");
  /** 仓路径变化后需要拉图；会话内容忙完才真正执行，避免同仓切会话误触发重载 */
  const pendingRepoLoadRef = useRef(false);
  /**
   * 数据 view 与 WebGL 场景解耦：消息 hydration 期间冻结旧场景；
   * 新图仅在空闲时挂上（对齐社区 requestIdleCallback / 勿在导航瞬间重建 WebGL）。
   */
  const [sceneView, setSceneView] = useState<SubgraphView | null>(null);

  const openSubgraph = useCallback(
    async (center: string) => {
      if (!IS_TAURI || !repoPath || !center) return;
      const pathAtRequest = repoPath;
      setLoadingView(true);
      setDetail(null);
      setDrilled(center);
      try {
        const result = await invoke<SubgraphView>("asset_graph_subgraph", {
          repoPath: pathAtRequest, center, hops: 2, limit: 150,
        });
        if (repoPathRef.current !== pathAtRequest) return;
        const normalized: SubgraphView = {
          center: result?.center ?? "",
          nodes: result?.nodes ?? [],
          edges: result?.edges ?? [],
        };
        setView(normalized.nodes.length > 0 ? normalized : null);
      } catch (error) {
        console.warn("[asset-graph] subgraph failed", error);
      } finally {
        if (repoPathRef.current === pathAtRequest) setLoadingView(false);
      }
    },
    [repoPath]
  );

  const openFull = useCallback(async () => {
    if (!IS_TAURI || !repoPath) return;
    const pathAtRequest = repoPath;
    setDetail(null);
    setDrilled(null);
    try {
      const result = await invoke<SubgraphView>("asset_graph_full", {
        repoPath: pathAtRequest, limit: 1000, compact: true,
      });
      if (repoPathRef.current !== pathAtRequest) return;
      const normalized: SubgraphView = {
        center: result?.center ?? "",
        nodes: result?.nodes ?? [],
        edges: result?.edges ?? [],
      };
      setView(normalized.nodes.length > 0 ? normalized : null);
    } catch (error) {
      console.warn("[asset-graph] full graph failed", error);
    }
  }, [repoPath]);

  /** 首次打开 / 切项目 / 手动刷新 */
  const loadLatest = useCallback(async () => {
    if (!IS_TAURI || !repoPath) return;
    pendingRepoLoadRef.current = false;
    const pathAtRequest = repoPath;
    setLoadingView(true);
    setLoadPhase("idle");
    try {
      const summary = await invoke<GraphCounts>("asset_graph_summary", { repoPath: pathAtRequest });
      if (repoPathRef.current !== pathAtRequest) return;
      setCounts(summary);
      if ((summary?.nodes ?? 0) <= 0) {
        setView(null);
        viewRef.current = null;
        setLoadPhase("ready");
        return;
      }
      await openFull();
      if (repoPathRef.current === pathAtRequest) setLoadPhase("ready");
    } catch (error) {
      console.warn("[asset-graph] load failed", error);
      if (repoPathRef.current === pathAtRequest) setLoadPhase("ready");
    } finally {
      if (repoPathRef.current === pathAtRequest) setLoadingView(false);
    }
  }, [repoPath, openFull]);

  // 切仓先清局部 UI；真正拉图等会话消息忙完后再走，避免与 getMessages/hydration 并行卡顿
  useEffect(() => {
    if (!IS_TAURI || !repoPath) {
      pendingRepoLoadRef.current = false;
      setView(null);
      viewRef.current = null;
      setSceneView(null);
      setHits([]);
      setDetail(null);
      setDrilled(null);
      setSearchQuery("");
      setCounts(null);
      setLoadingView(false);
      setLoadPhase("ready");
      return;
    }
    pendingRepoLoadRef.current = true;
    setHits([]);
    setDetail(null);
    setDrilled(null);
    setSearchQuery("");
  }, [repoPath]);

  useEffect(() => {
    if (!IS_TAURI || !repoPath || !pendingRepoLoadRef.current) return;
    if (deferForContent) return;
    const pathAtSchedule = repoPath;
    const timer = scheduleAfterInteraction(() => {
      if (repoPathRef.current !== pathAtSchedule || !pendingRepoLoadRef.current) return;
      pendingRepoLoadRef.current = false;
      void loadLatest();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [repoPath, deferForContent, loadLatest]);

  // 消息忙时不换场景；空闲后再 startTransition 挂图，避免点击瞬间 Long Task
  useEffect(() => {
    if (deferForContent) return;
    const pathAt = repoPath;
    const next = view;
    return scheduleWhenIdle(() => {
      if (repoPathRef.current !== pathAt) return;
      startTransition(() => setSceneView(next));
    }, { timeout: 1200, delay: 64 });
  }, [view, deferForContent, repoPath]);

  const { ready } = useSigmaScene(containerRef, sceneView, themeMode, setDetail);

  // 双击下钻（sigma 场景内经 DOM 事件转发）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDrill = (event: Event) => {
      const node = (event as CustomEvent<{ node: string }>).detail?.node;
      if (node) void openSubgraph(node);
    };
    container.addEventListener("asset-graph-drill", onDrill);
    return () => container.removeEventListener("asset-graph-drill", onDrill);
  }, [openSubgraph]);

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!IS_TAURI || !repoPath || !q) { setHits([]); return; }
    try {
      const result = await invoke<{ hits: NodeHit[] }>("asset_graph_search", { repoPath, query: q });
      setHits(result?.hits ?? []);
    } catch (error) {
      console.warn("[asset-graph] search failed", error);
    }
  }, [repoPath, searchQuery]);

  const rebuild = useCallback(async () => {
    if (!IS_TAURI || !repoPath) return;
    setRebuilding(true);
    try {
      await invoke("asset_graph_rebuild", { repoPath });
      setView(null);
      viewRef.current = null;
      await loadLatest();
    } catch (error) {
      console.warn("[asset-graph] rebuild failed", error);
    } finally {
      setRebuilding(false);
    }
  }, [repoPath, loadLatest]);

  const empty = !counts || counts.nodes === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {loadPhase === "idle" && empty ? (
        <div className="relative flex flex-1 items-center justify-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 size-8 rounded-md border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-background"
            title="刷新记忆图谱"
            onClick={() => void loadLatest()}
            disabled={loadingView}
          >
            {loadingView ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : empty ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 size-8 rounded-md border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-background"
            title="刷新记忆图谱"
            onClick={() => void loadLatest()}
            disabled={loadingView}
          >
            {loadingView ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>
          <Waypoints className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {counts?.mounted === false ? "记忆尚未挂载：创建一个 agent 会话后自动生成" : "暂无记忆数据"}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void rebuild()} disabled={rebuilding}>
            {rebuilding ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            扫描存量会话
          </Button>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div ref={containerRef} className="absolute inset-0" />

          {/* 搜索：左上 */}
          <div className="absolute left-2 top-2 z-10 w-72">
            <form
              className="relative"
              onSubmit={(e) => { e.preventDefault(); void runSearch(); }}
            >
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  counts?.mounted && !empty
                    ? `搜索记忆…（${counts.nodes} · ${counts.edges}）`
                    : "搜索记忆…"
                }
                className="h-8 rounded-md border-border/50 bg-background/80 pl-7 text-xs shadow-sm backdrop-blur"
              />
            </form>
            <div className="mt-1">
              {drilled && (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-md border border-border bg-background/90 px-2 py-1.5 text-left text-xs text-foreground shadow-sm backdrop-blur hover:bg-accent"
                  onClick={() => void openFull()}
                >
                  <span className="text-muted-foreground">←</span>
                  返回全图
                  <span className="ml-auto truncate text-[10px] text-muted-foreground/70">下钻视图</span>
                </button>
              )}
              {hits.length > 0 && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-background/95 shadow-md backdrop-blur">
                  {hits.map((hit) => (
                    <button
                      key={hit.nodeId}
                      type="button"
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
                      onClick={() => { setHits([]); void openSubgraph(hit.nodeId); }}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(hit.nodeType) }} />
                      <span className="truncate text-foreground">{hit.label}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {TYPE_LABELS[hit.nodeType] ?? hit.nodeType}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 刷新：右上 */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 z-20 size-8 rounded-md border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-background"
            title="刷新记忆图谱"
            onClick={() => void loadLatest()}
            disabled={loadingView || rebuilding}
          >
            {loadingView ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>

          {/* 类型图例：悬浮右下 */}
          {ready && (
            <div className="pointer-events-none absolute bottom-2 right-2 max-w-[280px] rounded-md border border-border/60 bg-background/80 px-2 py-1.5 text-[10px] text-muted-foreground opacity-70 backdrop-blur transition-opacity hover:opacity-100">
              <div className="flex flex-wrap gap-x-2.5 gap-y-1">
                {Object.entries(TYPE_LABELS).map(([type, label]) => (
                  <span key={type} className="flex items-center gap-1">
                    <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: colorOf(type) }} />
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground/70">拖拽节点 · 双击下钻 · 单击详情</p>
            </div>
          )}

          {/* Inspector：刷新按钮下方 */}
          {detail && (
            <div className="absolute right-2 top-12 z-10 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-background/95 p-2.5 shadow-md backdrop-blur">
              <div className="mb-1.5 flex items-start gap-2">
                <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(detail.nodeType) }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{detail.label}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {TYPE_LABELS[detail.nodeType] ?? detail.nodeType} · {ageLabel(detail.lastSeenMs)}前
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setDetail(null)}
                  aria-label="关闭详情"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {propsRows(detail.props).slice(0, 5).map(([key, value]) => (
                  <div key={key} className="text-[10px] leading-relaxed">
                    <span className="text-muted-foreground">{key}: </span>
                    <span className="text-foreground/90">
                      {value.length > 140 ? `${value.slice(0, 138)}…` : value}
                    </span>
                  </div>
                ))}
              </div>
              <Button
                type="button" variant="outline" size="sm"
                className="mt-2 h-6 w-full text-[11px]"
                onClick={() => void openSubgraph(detail.nodeId)}
              >
                展开
              </Button>
            </div>
          )}

          {loadingView ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !ready ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
              <p className="text-xs text-muted-foreground">暂无可视数据</p>
              <p className="text-[10px] text-muted-foreground/60">尝试右上角刷新或扫描存量会话</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
