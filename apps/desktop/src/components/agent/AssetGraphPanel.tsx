/**
 * 右侧「记忆」tab：跨会话仓库记忆图谱。
 *
 * 渲染设计完整对齐 semantica Knowledge Explorer（同款 sigma.js 组件族）：
 * - 曲边 + 箭头（@sigma/edge-curve EdgeCurvedArrowProgram，方向可辨）
 * - 节点：Obsidian 风统一尺寸/统一灰色；悬停淡入变色（rAF 插值）
 * - 节点环（@sigma/node-border）：仅选中/焦点时细描边，无类型色环
 * - 边层级：结构边 / 资产边 / 语义边三档透明度
 * - hover 卡片：canvas 圆角卡（标题 + 类型 meta）
 * - 缩放三档 LOD；聚焦状态机 hover/selected/neighbor/muted
 * - 相机动画：点选飞入；布局收敛后自动 fit
 * - 主题兼容：深浅两套节点底色与悬停强调色
 *
 * 布局与拖拽（Obsidian 式 d3-force）：
 * - 冷启动与保温共用同一模拟：随机播种 → 强排斥 + 统一边长 + 碰撞
 * - 拖拽钉住 fx/fy 并加热，松手后邻域回位
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import Graph from "graphology";
import random from "graphology-layout/random";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import Sigma from "sigma";
import { NodeBorderProgram } from "@sigma/node-border";
import { Loader2, RefreshCw, Search, Waypoints, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../../lib/platform";
import { scheduleAfterInteraction, scheduleWhenIdle } from "../../lib/browserRuntime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { makeGraphContextRef, type GraphContextRef } from "../../lib/graphContextRefs";

export type { GraphContextRef };

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

type ExtractionQueue = {
  pending: number;
  claimed: number;
  updatedAtMs: number;
};


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

/** 节点统一尺寸；主次仅用颜色区分（对齐 Obsidian 灰层，不改半径）。 */
const NODE_SIZE = 7.5;

const TYPE_LABELS: Record<string, string> = {
  session: "会话", run: "运行", turn: "轮次", message: "消息",
  tool_call: "工具调用", file: "文件", command: "命令", error: "错误", commit: "提交",
  decision: "决策", feature: "功能", module: "模块", tech_concept: "技术概念",
  error_pattern: "错误模式", api: "接口", tradeoff: "取舍", open_task: "待办",
};

const SEMANTIC_TYPES = new Set([
  "decision", "feature", "module", "tech_concept", "error_pattern",
  "api", "tradeoff", "open_task",
]);

/**
 * Obsidian Graph 分层直觉：重要节点更醒目，次要偏灰——只用颜色，尺寸统一。
 * - entity：语义实体（主层，最实）
 * - hub：会话/文件等卫星（中层）
 * - scaffold：turn/message/run 等过程脚手架（灰底层）
 */
type VisualTier = "entity" | "hub" | "scaffold";

function visualTierOf(nodeType: string): VisualTier {
  if (SEMANTIC_TYPES.has(nodeType)) return "entity";
  if (
    nodeType === "session"
    || nodeType === "session_group"
    || nodeType === "file"
    || nodeType === "commit"
    || nodeType === "error"
  ) {
    return "hub";
  }
  return "scaffold";
}

function tierColor(tier: VisualTier, theme: SceneTheme): string {
  switch (tier) {
    case "entity":
      return theme.nodeEntity;
    case "hub":
      return theme.nodeHub;
    case "scaffold":
      return theme.nodeScaffold;
  }
}

/** 像不像会话/运行等内部 id（UUID、纯 hex、session:hash），禁止当展示名。 */
function looksLikeOpaqueId(label: string): boolean {
  const s = label.trim();
  if (!s) return true;
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){1,3}(-[0-9a-f]{12})?$/i.test(s)) return true;
  if (/^[0-9a-f]{6,32}$/i.test(s)) return true;
  if (/^(sess|session|run|msg|turn)[-_:]?[0-9a-f-]{4,}$/i.test(s)) return true;
  // store::node_id 形态：session:<16 hex>
  if (/^(session|run|turn|message|tool_call|file|session_group):[0-9a-f]{8,64}$/i.test(s)) return true;
  return false;
}

/** 节点展示名：turn 裸序号 → props.intent；空 message → 角色/正文；session 优先意图，绝不展示会话 id。 */
function resolveNodeLabel(
  nodeType: string,
  label: string,
  propsRaw: string | undefined,
): string {
  const base = (label || "")
    .replace(/\s*[×xX]\s*\d+\s*$/u, "")
    .trim();
  let intent: string | undefined;
  let role: string | undefined;
  let text: string | undefined;
  try {
    const parsed = JSON.parse(propsRaw || "{}") as {
      intent?: string;
      role?: string;
      text?: string;
    };
    if (typeof parsed.intent === "string" && parsed.intent.trim()) {
      intent = parsed.intent.trim();
    }
    if (typeof parsed.role === "string") role = parsed.role;
    if (typeof parsed.text === "string") text = parsed.text.trim();
  } catch {
    /* ignore */
  }

  if (nodeType === "session" || nodeType === "session_group") {
    if (intent && intent.length >= 2 && !looksLikeOpaqueId(intent)) return intent;
    if (base && !looksLikeOpaqueId(base) && base !== "会话" && base !== "session" && base !== "未命名会话") {
      return base;
    }
    return "未命名会话";
  }

  if (intent && intent.length >= 4) {
    if (nodeType === "turn" && /^(turn|轮次)\s*\d*$/i.test(base || "turn")) return intent;
  }
  if (nodeType === "message") {
    const blank = !base || base === "消息" || base === "message" || looksLikeOpaqueId(base);
    if (blank && text) {
      return text.length > 48 ? `${text.slice(0, 48)}…` : text;
    }
    if (blank) {
      const r = (role || "").toLowerCase();
      if (r.includes("user")) return "用户消息";
      if (r.includes("assistant")) return "助手回复";
      if (r.includes("tool")) return "工具输出";
      return "消息";
    }
  }
  if (looksLikeOpaqueId(base)) return TYPE_LABELS[nodeType] || nodeType;
  return base || TYPE_LABELS[nodeType] || nodeType;
}

/** 单套图的主题化视觉常量（Obsidian 节点 + semantica 边档）。 */
interface SceneTheme {
  label: string;
  /** 结构边 / 资产边 / 语义边三档基准色（非聚焦态）。 */
  edgeStructural: string;
  edgeAsset: string;
  edgeSemantic: string;
  edgeHover: string;
  edgeMuted: string;
  /** @deprecated 兼容；等同 nodeHub。 */
  nodeFill: string;
  /** 实体核（主层，最醒目）。 */
  nodeEntity: string;
  /** 会话/文件卫星（中层）。 */
  nodeHub: string;
  /** 过程脚手架灰层（turn/message/run）。 */
  nodeScaffold: string;
  /** 悬停强调色（淡入插值目标）。 */
  nodeHover: string;
  /** 聚焦时不相关节点的淡化填充色（低对比实心点，不是空圆）。 */
  nodeFaded: string;
  /** 聚焦时不相关节点的淡化标签色（canvas 2D 用，无需预乘）。 */
  labelFaded: string;
  nodeOutline: string;
  /** 选中/焦点细描边。 */
  nodeFocusRing: string;
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
      // Obsidian light：实体更深更实，脚手架浅灰退到后层，悬停偏紫
      nodeFill: "#8b8b8b",
      nodeEntity: "#4f4f59",
      nodeHub: "#8b8b8b",
      nodeScaffold: "#c8c8d0",
      nodeHover: "#7c5cbf",
      nodeFaded: sigmaRgba(148, 163, 184, 0.16),
      labelFaded: "rgba(100, 116, 139, 0.32)",
      nodeOutline: sigmaRgba(255, 255, 255, 0.85),
      nodeFocusRing: "#6d28d9",
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
    // Obsidian dark：实体更亮，脚手架沉到暗灰层，悬停亮紫
    nodeFill: "#7a7a82",
    nodeEntity: "#d0d0d8",
    nodeHub: "#7a7a82",
    nodeScaffold: "#3a3a44",
    nodeHover: "#b794f6",
    nodeFaded: sigmaRgba(138, 145, 158, 0.10),
    labelFaded: "rgba(200, 205, 214, 0.24)",
    nodeOutline: sigmaRgba(8, 12, 20, 0.9),
    nodeFocusRing: "#c4b5fd",
    hoverCard: {
      background: "rgba(12, 17, 29, 0.96)",
      border: "rgba(154, 181, 212, 0.32)",
      titleColor: "#EAF3FF",
      metaColor: "rgba(184, 214, 255, 0.58)",
    },
  };
}

/** 线性插值 #rrggbb → #rrggbb（t∈[0,1]），供悬停淡入。 */
function lerpHex(from: string, to: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ] as const;
  };
  const a = parse(from);
  const b = parse(to);
  const u = Math.min(1, Math.max(0, t));
  const ch = (i: number) => Math.round(a[i] + (b[i] - a[i]) * u);
  return `#${[ch(0), ch(1), ch(2)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// ---------- 边层级（类型 → 视觉层级） ----------

type EdgeTier = "structural" | "asset" | "semantic";

function edgeTier(edgeType: string): EdgeTier {
  if (edgeType.startsWith("sem/") || edgeType === "extracted" || edgeType === "mentions") {
    return "semantic";
  }
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

// ---------- 工具 ----------

function ageLabel(ms: number): string {
  const delta = Math.max(0, Date.now() - ms) / 1000;
  if (delta < 3600) return `${Math.round(delta / 60)}m`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h`;
  return `${Math.round(delta / 86400)}d`;
}

function propsRows(raw: string): Array<[string, string]> {
  const hide = new Set(["sessionId", "session_id", "repoPath", "repo_path"]);
  try {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(([k, v]) => !hide.has(k) && typeof v === "string" && v.trim())
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
};

/** 场景的命令式焦点接口：切会话时换金环 + 相机飞入，不重建场景。 */
type GraphSceneApi = {
  setFocus: (nodeId: string | null) => void;
  /** 增量并入新节点/边：保留已有坐标，轻加热力导；返回新增节点数。 */
  mergeView: (next: SubgraphView) => number;
};

function buildSigmaScene(options: {
  container: HTMLDivElement;
  view: SubgraphView;
  themeMode: GraphThemeMode;
  /** 焦点节点（当前会话）ref：构建时读一次，之后经 focusApiRef.setFocus 更新 */
  focusRef: React.MutableRefObject<string | null>;
  focusApiRef: React.MutableRefObject<GraphSceneApi | null>;
  stateRef: React.MutableRefObject<SigmaSceneState>;
  selectCbRef: React.MutableRefObject<(node: SubgraphNode | null) => void>;
  /** 下钻回调（会话组单击 / 任意节点双击）；用 ref 避免 CustomEvent 在容器晚挂载时丢监听 */
  drillCbRef: React.MutableRefObject<(nodeId: string) => void>;
  setReady: (ready: boolean) => void;
}): () => void {
  const { container, view, themeMode, focusRef, focusApiRef, stateRef, selectCbRef, drillCbRef, setReady } = options;
  const theme = sceneTheme(themeMode);

  const graph = new Graph();
  const nodesById = new Map(view.nodes.map((n) => [n.nodeId, n]));
  const count = view.nodes.length;

  /** 若焦点落在已被折叠的成员会话上，映射到其超节点（视角跟踪必须命中图上真实节点）。 */
  const resolveFocusId = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    if (graph.hasNode?.(raw) || nodesById.has(raw)) return raw;
    for (const node of view.nodes) {
      if (!node.nodeId.startsWith("session_group:")) continue;
      try {
        const props = JSON.parse(node.props || "{}") as { members?: string[] };
        if (Array.isArray(props.members) && props.members.includes(raw)) {
          return node.nodeId;
        }
      } catch {
        /* ignore */
      }
    }
    return raw;
  };

  const groupMemberCount = (nodeId: string): number => {
    const node = nodesById.get(nodeId);
    if (!node?.nodeId.startsWith("session_group:")) return 1;
    try {
      const props = JSON.parse(node.props || "{}") as { count?: number; members?: string[] };
      if (typeof props.count === "number" && props.count > 0) return props.count;
      if (Array.isArray(props.members)) return Math.max(1, props.members.length);
    } catch {
      /* ignore */
    }
    return 1;
  };

  const isCenter = (id: string) => id === view.center;
  const resolvedInitialFocus = resolveFocusId(focusRef.current);
  const isFocus = (id: string) => !!resolvedInitialFocus && id === resolvedInitialFocus;

  // random 播种；随后由 d3-force 从随机云收敛出舒展布局（见 startSim）
  for (const node of view.nodes) {
    const ringed = isCenter(node.nodeId) || isFocus(node.nodeId);
    const members = groupMemberCount(node.nodeId);
    const tier = visualTierOf(node.nodeType);
    const isEntity = tier === "entity";
    graph.addNode(node.nodeId, {
      x: 0,
      y: 0,
      size: NODE_SIZE,
      color: tierColor(tier, theme),
      // 外层只显示语义标题；防御性剥掉历史 ×N / xN 后缀（旧版二进制曾写入）。
      label: resolveNodeLabel(node.nodeType, node.label || "", node.props),
      labelColor: theme.label,
      nodeType: node.nodeType,
      isCenter: isCenter(node.nodeId),
      isFocus: isFocus(node.nodeId),
      isGroup: node.nodeId.startsWith("session_group:"),
      isEntity,
      visualTier: tier,
      memberCount: members,
      borderColor: ringed ? theme.nodeFocusRing : theme.nodeOutline,
      borderSize: ringed ? 1.6 : 0,
      lastSeenMs: node.lastSeenMs,
    });
  }
  // 初值云略紧：过大初始散布会让收敛后 bbox 偏松，fit 后节点更小。
  random.assign(graph, { scale: Math.max(28, Math.sqrt(Math.max(count, 1)) * 5.5) });
  for (const edge of view.edges) {
    if (!graph.hasNode(edge.srcId) || !graph.hasNode(edge.dstId)) continue;
    if (graph.hasEdge(edge.srcId, edge.dstId)) continue;
    const tier = edgeTier(edge.edgeType);
    graph.addDirectedEdge(edge.srcId, edge.dstId, {
      color: edgeBaseColor(tier, theme),
      size: 0.75,
      tier,
    });
  }

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
    // attribute 模式：标签色走每个节点的 labelColor 属性（无属性时回退 color），
    // 这样聚焦时不相关节点的标签可以单独淡化而不是直接消失。
    labelColor: { attribute: "labelColor", color: theme.label },
    labelFont: "system-ui, -apple-system, sans-serif",
    labelSize: 11,
    labelWeight: "400",
    // 官方标签 LOD 方案（sigma settings，无自定义渲染器）：
    // - labelRenderedSizeThreshold：节点在屏幕上的尺寸小于阈值就不画名称。
    //   5500+ 节点全图 fit 时渲染尺寸约 5-6px，阈值 8 让远景/进入时天然无文字；
    //   用户拉近（ratio 约 0.65 以下）节点变大后名称才出现——拉近哪里就显示哪里。
    // - labelDensity + labelGridCellSize：官方网格抽稀，每个 110px 格子最多一个标签，避免拥挤。
    // - hideLabelsOnMove：相机移动时暂时收起标签，停下再渲染。
    // - 悬停/选中/焦点节点经 nodeReducer 的 forceLabel 始终显示名称（官方推荐做法）。
    labelRenderedSizeThreshold: 8,
    labelDensity: 0.55,
    labelGridCellSize: 110,
    hideLabelsOnMove: true,
    // 官方 drawDiscNodeLabel 的同款实现（labelColor/font/size/weight 设置照常生效），
    // 仅把文字位置从节点右侧改为节点正下方居中——这是 sigma 官方预留的标签位置扩展点。
    // 长文本按最大宽度截断为省略号，避免长标题铺满整屏。
    defaultDrawNodeLabel: (context, data, settings) => {
      if (!data.label) return;
      const size = settings.labelSize;
      const font = settings.labelFont;
      const weight = settings.labelWeight;
      const color = (settings.labelColor.attribute
        ? String((data as unknown as Record<string, unknown>)[settings.labelColor.attribute] ?? settings.labelColor.color ?? "#000")
        : settings.labelColor.color) ?? "#000";
      context.save();
      context.fillStyle = color;
      context.font = `${weight} ${size}px ${font}`;
      context.textAlign = "center";
      context.textBaseline = "top";
      const maxWidth = size * 10;
      let label = data.label;
      if (context.measureText(label).width > maxWidth) {
        // 二分查找能放下的最长前缀，再补省略号
        let lo = 0;
        let hi = label.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (context.measureText(`${label.slice(0, mid)}…`).width <= maxWidth) lo = mid;
          else hi = mid - 1;
        }
        label = `${label.slice(0, lo)}…`;
      }
      context.fillText(label, data.x, data.y + data.size + 3);
      context.restore();
    },
    stagePadding: 20,
    zIndex: true,
    minCameraRatio: 0.04,
    maxCameraRatio: 10,
    defaultNodeType: "bordered",
    nodeProgramClasses: { bordered: NodeBorderProgram },
    defaultDrawNodeHover: (context, data) => {
      const nodeType = (data as unknown as { nodeType?: string }).nodeType ?? "";
      const lastSeenMs = (data as unknown as { lastSeenMs?: number }).lastSeenMs ?? 0;
      const isGroup = Boolean((data as unknown as { isGroup?: boolean }).isGroup);
      const memberCount = (data as unknown as { memberCount?: number }).memberCount ?? 1;
      const meta = isGroup
        ? `${memberCount} 个会话 · 点击展开`
        : nodeType
          ? `${(TYPE_LABELS[nodeType] ?? nodeType).toUpperCase()} · ${ageLabel(lastSeenMs)}前`
          : "NODE";
      drawHoverCard(context, data as unknown as { x: number; y: number; size: number; label: string }, meta);
    },
  });

  let draggedNode: string | null = null;
  let dragMoved = false;
  const mouseCaptor = sigma.getMouseCaptor();

  /**
   * Obsidian 式单一力模型：冷启动与保温共用同一个 d3-force 模拟。
   * 平衡态模型（link 拉到目标长度即平衡），收敛/常驻/拖拽回位一体。
   */
  let fitTimer: number | null = null;
  let syncDisposed = false;
  /** 力导是否已首次收敛。未收敛前 setFocus 只换描边，不飞相机。 */
  let layoutSettled = count <= 1;
  /** 是否已做过「首次落焦」。首次只描边不飞镜头，避免布局刚停又缩放一次。 */
  let initialFocusConsumed = false;

  // 悬停淡入：0→1 插值 nodeFill→nodeHover（Obsidian 风变色）
  let hoverFade = 0;
  let hoverFadeTarget = 0;
  let hoverFadeRaf = 0;
  const HOVER_FADE_MS = 160;

  const tickHoverFade = () => {
    hoverFadeRaf = 0;
    if (syncDisposed) return;
    const step = 16 / HOVER_FADE_MS;
    if (hoverFade < hoverFadeTarget) {
      hoverFade = Math.min(hoverFadeTarget, hoverFade + step);
    } else if (hoverFade > hoverFadeTarget) {
      hoverFade = Math.max(hoverFadeTarget, hoverFade - step);
    }
    applyState();
    if (Math.abs(hoverFade - hoverFadeTarget) > 0.01) {
      hoverFadeRaf = window.requestAnimationFrame(tickHoverFade);
    } else {
      hoverFade = hoverFadeTarget;
    }
  };

  const driveHoverFade = (target: number) => {
    hoverFadeTarget = target;
    if (!hoverFadeRaf) hoverFadeRaf = window.requestAnimationFrame(tickHoverFade);
  };

  /** reducer 闭包共享的可变状态，避免每帧 setSetting 分配新函数。 */
  const reducerState = {
    focus: null as string | null,
    hoverNode: null as string | null,
    neighborSet: null as Set<string> | null,
    hoverFade: 0,
    selected: null as string | null,
  };

  const applyState = () => {
    const focus = stateRef.current.selected ?? stateRef.current.hovered;
    reducerState.focus = focus;
    reducerState.hoverNode = stateRef.current.hovered;
    reducerState.neighborSet = focus ? new Set(graph.neighbors(focus)) : null;
    reducerState.hoverFade = hoverFade;
    reducerState.selected = stateRef.current.selected;
    sigma.refresh({ skipIndexation: true });
  };

  sigma.setSetting("nodeReducer", (node, data) => {
    const { focus, hoverNode, neighborSet, hoverFade: fade, selected } = reducerState;
    const tier = (data.visualTier as VisualTier | undefined) ?? visualTierOf(String(data.nodeType || ""));
    const baseColor = String(data.color || tierColor(tier, theme));
    const base = {
      ...data,
      size: NODE_SIZE,
      color: baseColor,
    };
    if (!focus) {
      if (focusRef.current === node) {
        return {
          ...base,
          forceLabel: true,
          zIndex: 3,
          borderColor: theme.nodeFocusRing,
          borderSize: 1.6,
        };
      }
      if (tier === "entity") {
        return { ...base, zIndex: 2 };
      }
      return base;
    }
    if (node === focus) {
      const t =
        hoverNode === node
          ? fade
          : selected === node
            ? 1
            : fade;
      return {
        ...base,
        zIndex: 4,
        highlighted: true,
        forceLabel: true,
        color: lerpHex(baseColor, theme.nodeHover, t),
        borderColor: theme.nodeFocusRing,
        borderSize: 1.6,
      };
    }
    if (neighborSet?.has(node)) {
      return { ...base, zIndex: 2, color: lerpHex(baseColor, theme.nodeHover, 0.25) };
    }
    // 不相关节点：淡出淡化（实心低对比点 + 淡化标签），不要换成空圆。
    // borderColor 保持常态描边色——置 undefined 会让 NodeBorderProgram 回落到默认黑边，才出现「空圆」。
    return {
      ...base,
      zIndex: 0,
      color: theme.nodeFaded,
      labelColor: theme.labelFaded,
      borderColor: theme.nodeOutline,
      borderSize: 0,
    } as typeof data;
  });
  sigma.setSetting("edgeReducer", (edge, data) => {
    const { focus } = reducerState;
    const [src, dst] = graph.extremities(edge);
    if (focus && (src === focus || dst === focus)) {
      return { ...data, color: theme.edgeHover, size: 1.1, zIndex: 4 };
    }
    if (!focus) return data;
    return { ...data, color: theme.edgeMuted, size: 0.5 };
  });

  const clearFit = () => {
    if (fitTimer !== null) {
      window.clearTimeout(fitTimer);
      fitTimer = null;
    }
  };

  // ---------- d3-force 常驻模拟（冷启动 + 保温一体） ----------

  interface SimNode extends SimulationNodeDatum {
    id: string;
    size: number;
  }

  let sim: Simulation<SimNode, undefined> | null = null;
  let simNodes: SimNode[] = [];
  const simNodeById = new Map<string, SimNode>();
  /** 悬停时被钉住（fx/fy）的节点：只固定指针下这一个，其余节点保持力导运动。 */
  let hoverPinnedNode: string | null = null;

  const killSim = () => {
    hoverPinnedNode = null;
    sim?.stop();
    sim = null;
    simNodes = [];
    simNodeById.clear();
  };

  // 布局相对节点尺寸收紧：边长约 4× 直径，避免「空白很大、节点针尖」。
  // 统一边长仍保留——远看是均匀网格张力，但不再过度撑开。
  const LINK_DIST = NODE_SIZE * 4.2;
  const CHARGE = -28;
  /** 全图 fit 后 ratio 上限：再远节点会缩成针尖，宁可裁掉外围也要可读。 */
  const MAX_FIT_RATIO = 0.92;

  const startSim = () => {
    killSim();
    if (count <= 1 || syncDisposed) return;
    simNodes = [];
    graph.forEachNode((id, attrs) => {
      simNodes.push({
        id,
        x: attrs.x as number,
        y: attrs.y as number,
        size: Number(attrs.size) || NODE_SIZE,
      });
    });
    simNodes.forEach((n) => simNodeById.set(n.id, n));
    const links: SimulationLinkDatum<SimNode>[] = [];
    graph.forEachEdge((edge) => {
      const [src, dst] = graph.extremities(edge);
      links.push({ source: src, target: dst });
    });

    let fittedOnConverge = false;
    const simInst = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
          .id((d) => d.id)
          .distance(LINK_DIST)
          .strength(0.55),
      )
      .force("charge", forceManyBody<SimNode>().strength(CHARGE).distanceMax(LINK_DIST * 8))
      .force("collide", forceCollide<SimNode>().radius((d) => (d.size || NODE_SIZE) + 5))
      .force("x", forceX<SimNode>(0).strength(0.08))
      .force("y", forceY<SimNode>(0).strength(0.08))
      .alpha(1)
      .alphaMin(0.0015)
      .alphaDecay(0.025)
      .velocityDecay(0.42)
      .on("tick", () => {
        if (syncDisposed) return;
        for (const n of simNodes) {
          graph.setNodeAttribute(n.id, "x", n.x as number);
          graph.setNodeAttribute(n.id, "y", n.y as number);
        }
        sigma.refresh({ skipIndexation: true });
        // 收敛后只标记 settled，不再自动 fit。
        // sigma 默认 autoRescale 会在布局过程中保持图在视口内；
        // 结束时再 animate 相机会叠成「展开快完又缩放一次」。
        if (!fittedOnConverge && simInst.alpha() < 0.06) {
          fittedOnConverge = true;
          layoutSettled = true;
        }
      });
    sim = simInst;
    // 不做周期性保温：布局收敛后全图完全静止，只有拖拽/新节点并入等交互才重新加热。
  };

  /**
   * 全图可读视角（单次动画）。
   * 本版 sigma 的 animatedReset = 飞到 {x:0.5,y:0.5,ratio:1}（图已被归一化到单位框），
   * 略小于 1 的 ratio 让节点稍大一点，且只播一次。
   */
  const fitGraphReadable = (duration = 420) => {
    sigma.setCustomBBox(null);
    sigma.getCamera().animate(
      {
        x: 0.5,
        y: 0.5,
        angle: 0,
        ratio: Math.min(1, MAX_FIT_RATIO),
      },
      { duration },
    );
  };

  const scheduleCameraFit = (delayMs = 200, preferFocus = true) => {
    clearFit();
    fitTimer = window.setTimeout(() => {
      fitTimer = null;
      if (syncDisposed || draggedNode) return;
      const focusId = resolveFocusId(focusRef.current);
      if (preferFocus && focusId && graph.hasNode(focusId)) {
        const pos = sigma.getNodeDisplayData(focusId);
        if (pos) {
          sigma.setCustomBBox(null);
          // 焦点视角：略近，节点可读且能看到邻域
          sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.42 }, { duration: 620 });
          return;
        }
      }
      fitGraphReadable(420);
    }, delayMs);
  };

  sigma.on("enterNode", ({ node }) => {
    stateRef.current.hovered = node;
    driveHoverFade(1);
    applyState();
    // 对齐 sigma 官方 use-reducers 与 Obsidian：悬停只改外观，不冻结布局。
    // 把指针下的节点 fx/fy 钉住（与拖拽同一机制），其余节点保持力导运动。
    if (sim && !draggedNode) {
      const simNode = simNodeById.get(node);
      if (simNode) {
        hoverPinnedNode = node;
        simNode.fx = graph.getNodeAttribute(node, "x") as number;
        simNode.fy = graph.getNodeAttribute(node, "y") as number;
      }
    }
  });
  sigma.on("leaveNode", () => {
    stateRef.current.hovered = null;
    driveHoverFade(0);
    applyState();
    // 释放钉住的节点即可，不再轻加热——图保持完全静止。
    if (hoverPinnedNode && !draggedNode) {
      const simNode = simNodeById.get(hoverPinnedNode);
      if (simNode) {
        simNode.fx = null;
        simNode.fy = null;
      }
      hoverPinnedNode = null;
    }
  });

  /**
   * 切会话跟随：焦点描边换到目标节点 + 相机飞过去。
   * 纯属性/相机操作，不重建场景、不重新布局。
   */
  const setFocus = (nodeId: string | null) => {
    const target = resolveFocusId(nodeId);
    graph.forEachNode((n) => {
      const attrs = graph.getNodeAttributes(n);
      const ringed = Boolean(attrs.isCenter) || (!!target && n === target);
      const wantBorderColor = ringed ? theme.nodeFocusRing : theme.nodeOutline;
      const wantBorderSize = ringed ? 1.6 : 0;
      if (attrs.borderColor !== wantBorderColor) graph.setNodeAttribute(n, "borderColor", wantBorderColor);
      if (attrs.borderSize !== wantBorderSize) graph.setNodeAttribute(n, "borderSize", wantBorderSize);
      if (attrs.isFocus !== (n === target)) graph.setNodeAttribute(n, "isFocus", n === target);
    });
    sigma.refresh();
    // 布局未收敛：只描边。
    // 首次落焦：也只描边（布局结束前后异步焦点到达时，不再飞镜头造成二次缩放）。
    // 之后切会话才飞相机。
    if (!layoutSettled || !target || draggedNode || !graph.hasNode(target)) return;
    if (!initialFocusConsumed) {
      initialFocusConsumed = true;
      return;
    }
    const pos = sigma.getNodeDisplayData(target);
    if (pos) sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.5 }, { duration: 620 });
  };

  const mergeView = (next: SubgraphView): number => {
    if (syncDisposed) return 0;
    const nextNodes = new Map(next.nodes.map((n) => [n.nodeId, n]));
    const nextIds = new Set(nextNodes.keys());

    // 计算现有质心，供孤立新节点落点
    let cx = 0;
    let cy = 0;
    let cn = 0;
    graph.forEachNode((_id, attrs) => {
      cx += Number(attrs.x) || 0;
      cy += Number(attrs.y) || 0;
      cn += 1;
    });
    if (cn > 0) {
      cx /= cn;
      cy /= cn;
    }

    const placeNear = (hintIds: string[]): { x: number; y: number } => {
      const pts: Array<{ x: number; y: number }> = [];
      for (const id of hintIds) {
        if (!graph.hasNode(id)) continue;
        const a = graph.getNodeAttributes(id);
        pts.push({ x: Number(a.x) || 0, y: Number(a.y) || 0 });
      }
      if (pts.length === 0) {
        return {
          x: cx + (Math.random() - 0.5) * 36,
          y: cy + (Math.random() - 0.5) * 36,
        };
      }
      const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      return {
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 18,
      };
    };

    // 邻居提示：先扫一遍 next edges
    const neighborHints = new Map<string, string[]>();
    for (const edge of next.edges) {
      if (!neighborHints.has(edge.srcId)) neighborHints.set(edge.srcId, []);
      if (!neighborHints.has(edge.dstId)) neighborHints.set(edge.dstId, []);
      neighborHints.get(edge.srcId)!.push(edge.dstId);
      neighborHints.get(edge.dstId)!.push(edge.srcId);
    }

    let added = 0;
    // 删除已不在 compact 视图中的节点（会话折叠进超节点时会发生）
    const toDrop: string[] = [];
    graph.forEachNode((id) => {
      if (!nextIds.has(id)) toDrop.push(id);
    });
    for (const id of toDrop) {
      if (graph.hasNode(id)) graph.dropNode(id);
      const idx = simNodes.findIndex((n) => n.id === id);
      if (idx >= 0) simNodes.splice(idx, 1);
      simNodeById.delete(id);
      nodesById.delete(id);
    }

    const focusNow = resolveFocusId(focusRef.current);
    for (const node of next.nodes) {
      nodesById.set(node.nodeId, node);
      const label = resolveNodeLabel(node.nodeType, node.label || "", node.props);
      const tier = visualTierOf(node.nodeType);
      const isEntity = tier === "entity";
      const isGroup = node.nodeId.startsWith("session_group:");
      const members = groupMemberCount(node.nodeId);
      const ringed = Boolean(node.nodeId === next.center) || (!!focusNow && node.nodeId === focusNow);
      const color = tierColor(tier, theme);
      if (graph.hasNode(node.nodeId)) {
        graph.mergeNodeAttributes(node.nodeId, {
          label,
          nodeType: node.nodeType,
          isCenter: node.nodeId === next.center,
          isFocus: !!focusNow && node.nodeId === focusNow,
          isGroup,
          isEntity,
          visualTier: tier,
          memberCount: members,
          lastSeenMs: node.lastSeenMs,
          borderColor: ringed ? theme.nodeFocusRing : theme.nodeOutline,
          borderSize: ringed ? 1.6 : 0,
          size: NODE_SIZE,
          color,
        });
        const existingSim = simNodeById.get(node.nodeId);
        if (existingSim) existingSim.size = NODE_SIZE;
        continue;
      }
      const pos = placeNear(neighborHints.get(node.nodeId) || []);
      graph.addNode(node.nodeId, {
        x: pos.x,
        y: pos.y,
        size: NODE_SIZE,
        color,
        label,
        nodeType: node.nodeType,
        isCenter: node.nodeId === next.center,
        isFocus: !!focusNow && node.nodeId === focusNow,
        isGroup,
        isEntity,
        visualTier: tier,
        memberCount: members,
        borderColor: ringed ? theme.nodeFocusRing : theme.nodeOutline,
        borderSize: ringed ? 1.6 : 0,
        lastSeenMs: node.lastSeenMs,
      });
      const sn: SimNode = { id: node.nodeId, x: pos.x, y: pos.y, size: NODE_SIZE };
      simNodes.push(sn);
      simNodeById.set(node.nodeId, sn);
      added += 1;
    }

    // 边：清掉不在 next 的，补新边
    const edgeDrop: string[] = [];
    graph.forEachEdge((edge, _attrs, src, dst) => {
      const hit = next.edges.some((e) => e.srcId === src && e.dstId === dst);
      if (!hit) edgeDrop.push(edge);
    });
    for (const edge of edgeDrop) {
      if (graph.hasEdge(edge)) graph.dropEdge(edge);
    }
    for (const edge of next.edges) {
      if (!graph.hasNode(edge.srcId) || !graph.hasNode(edge.dstId)) continue;
      if (graph.hasEdge(edge.srcId, edge.dstId)) continue;
      const tier = edgeTier(edge.edgeType);
      graph.addDirectedEdge(edge.srcId, edge.dstId, {
        color: edgeBaseColor(tier, theme),
        size: 0.75,
        tier,
        edgeType: edge.edgeType,
      });
    }

    // 轻加热：保留坐标，让新节点被 link/charge 拉进布局
    if (sim && simNodes.length > 1) {
      const links: SimulationLinkDatum<SimNode>[] = [];
      graph.forEachEdge((_e, _a, src, dst) => {
        links.push({ source: src, target: dst });
      });
      sim.nodes(simNodes);
      sim.force(
        "link",
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
          .id((d) => d.id)
          .distance(LINK_DIST)
          .strength(0.4),
      );
      if (!draggedNode && !stateRef.current.hovered) {
        sim.alpha(Math.max(sim.alpha(), 0.18)).restart();
      }
    } else if (!sim && simNodes.length > 1) {
      startSim();
    }
    sigma.refresh({ skipIndexation: true });
    return added;
  };
  focusApiRef.current = { setFocus, mergeView };


  const onDownNode = ({ node, event }: { node: string; event: { preventSigmaDefault(): void } }) => {
    event.preventSigmaDefault();
    draggedNode = node;
    dragMoved = false;
    container.style.cursor = "grabbing";
    sigma.getCamera().disable();
    // 钉住目标节点并重新加热：link 弹簧拽邻居、charge 推开周围
    const simNode = simNodeById.get(node);
    if (sim && simNode) {
      simNode.fx = graph.getNodeAttribute(node, "x") as number;
      simNode.fy = graph.getNodeAttribute(node, "y") as number;
      sim.alphaTarget(0.3).restart();
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
    // d3 看到 fx/fy 会钉住该点，link 力在每帧 tick 里自动拽动邻居
    const simNode = simNodeById.get(draggedNode);
    if (simNode) {
      simNode.fx = pos.x;
      simNode.fy = pos.y;
    }
    dragMoved = true;
    event.preventSigmaDefault();
    event.original.preventDefault();
    event.original.stopPropagation();
    sigma.refresh();
  };
  const onUp = () => {
    if (!draggedNode) return;
    const node = draggedNode;
    draggedNode = null;
    container.style.cursor = "";
    sigma.getCamera().enable();
    // 解钉 + 停止加热：整个邻域在 link/向心力平衡下慢慢回到该处的位置
    const simNode = simNodeById.get(node);
    if (simNode) {
      simNode.fx = null;
      simNode.fy = null;
    }
    sim?.alphaTarget(0);
  };
  sigma.on("downNode", onDownNode);
  mouseCaptor.on("mousemovebody", onMoveBody);
  mouseCaptor.on("mouseup", onUp);

  sigma.on("clickNode", ({ node }) => {
    // 拖拽松手后 sigma 仍会触发 clickNode，跳过以免误选
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    const attrs = graph.getNodeAttributes(node);
    const isGroup = Boolean(attrs.isGroup) || String(node).startsWith("session_group:");
    if (isGroup) {
      drillCbRef.current(String(node));
      return;
    }
    const next = stateRef.current.selected === node ? null : node;
    stateRef.current.selected = next;
    selectCbRef.current(next ? nodesById.get(next) ?? null : null);
    applyState();
    if (next) {
      const pos = sigma.getNodeDisplayData(node);
      if (pos) {
        const cam = sigma.getCamera();
        const dx = cam.x - pos.x;
        const dy = cam.y - pos.y;
        if (dx * dx + dy * dy > 0.04) {
          sigma.getCamera().animate({ x: pos.x, y: pos.y }, { duration: 280 });
        }
      }
    }
  });
  sigma.on("clickStage", () => {
    stateRef.current.selected = null;
    selectCbRef.current(null);
    applyState();
  });
  sigma.on("doubleClickNode", ({ node }) => {
    drillCbRef.current(String(node));
  });

  // 单节点无需模拟；多节点直接由 d3-force 从随机云收敛出布局
  if (count <= 1) {
    layoutSettled = true;
    scheduleCameraFit(80);
  } else {
    startSim();
  }

  setReady(true);
  return () => {
    syncDisposed = true;
    if (hoverFadeRaf) {
      window.cancelAnimationFrame(hoverFadeRaf);
      hoverFadeRaf = 0;
    }
    clearFit();
    killSim();
    focusApiRef.current = null;
    sigma.getCamera().enable();
    sigma.off("downNode", onDownNode);
    mouseCaptor.off("mousemovebody", onMoveBody);
    mouseCaptor.off("mouseup", onUp);
    sigma.kill();
    container.style.cursor = "";
    setReady(false);
  };
}

function useSigmaScene(
  containerRef: React.RefObject<HTMLDivElement | null>,
  view: SubgraphView | null,
  themeMode: GraphThemeMode,
  focusRef: React.MutableRefObject<string | null>,
  focusApiRef: React.MutableRefObject<GraphSceneApi | null>,
  onSelectNode: (node: SubgraphNode | null) => void,
  onDrillNode: (nodeId: string) => void
): { ready: boolean } {
  const [ready, setReady] = useState(false);
  const [pendingSize, setPendingSize] = useState(false);
  const stateRef = useRef<SigmaSceneState>({
    hovered: null,
    selected: null,
  });
  const selectCbRef = useRef(onSelectNode);
  selectCbRef.current = onSelectNode;
  const drillCbRef = useRef(onDrillNode);
  drillCbRef.current = onDrillNode;

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
        focusRef,
        focusApiRef,
        stateRef,
        selectCbRef,
        drillCbRef,
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
  }, [containerRef, view, pendingSize, themeMode, focusRef, focusApiRef]);

  return { ready };
}

// ---------- 面板 ----------

type AssetGraphPanelProps = {
  repoPath: string;
  /** 会话消息正在 hydration/加载时，自动拉图让路，避免与 getMessages 抢 IPC/主线程 */
  deferForContent?: boolean;
  /** 当前会话 id：打开图谱时视角优先落在它的节点附近（金环 + 相机飞入） */
  currentSessionId?: string;
  /** 将节点引用到 Composer，作为发送时的显式图谱上下文 */
  onCiteNode?: (ref: GraphContextRef) => void;
};

// ---------- 日期筛选 ----------

type DatePreset = "all" | "today" | "3d" | "7d" | "custom";

const DATE_PRESETS: Array<{ key: DatePreset; label: string }> = [
  { key: "all", label: "全部" },
  { key: "today", label: "今天" },
  { key: "3d", label: "近三天" },
  { key: "7d", label: "近一周" },
  { key: "custom", label: "自定义" },
];

type DateRange = { fromMs?: number; toMs?: number };

/** 预设 → 闭区间 epoch ms；自定义缺任一端视为不筛选（与后端 time_range 语义一致）。 */
function computeDateRange(preset: DatePreset, customFrom: string, customTo: string): DateRange {
  const now = Date.now();
  switch (preset) {
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { fromMs: start.getTime(), toMs: now };
    }
    case "3d":
      return { fromMs: now - 3 * 86_400_000, toMs: now };
    case "7d":
      return { fromMs: now - 7 * 86_400_000, toMs: now };
    case "custom": {
      if (!customFrom || !customTo) return {};
      return {
        fromMs: new Date(`${customFrom}T00:00:00`).getTime(),
        toMs: new Date(`${customTo}T23:59:59.999`).getTime(),
      };
    }
    default:
      return {};
  }
}

type GraphNodeInspectorProps = {
  detail: SubgraphNode;
  nodeDotColor: string;
  onClose: () => void;
  onDrill: (nodeId: string) => void;
  onCiteNode?: (ref: GraphContextRef) => void;
};

const GraphNodeInspector = memo(function GraphNodeInspector({
  detail,
  nodeDotColor,
  onClose,
  onDrill,
  onCiteNode,
}: GraphNodeInspectorProps) {
  const label = useMemo(
    () =>
      resolveNodeLabel(detail.nodeType, detail.label, detail.props)
        .replace(/\s*[×xX]\s*\d+\s*$/u, "")
        .trim(),
    [detail.nodeType, detail.label, detail.props],
  );
  const subtitle = useMemo(() => {
    if (detail.nodeId.startsWith("session_group:")) {
      try {
        const props = JSON.parse(detail.props || "{}") as { count?: number };
        const n = props.count ?? 0;
        return n > 0 ? `同语义会话 · ${n} 个 · 点击展开` : "同语义会话聚合";
      } catch {
        return "同语义会话聚合";
      }
    }
    return `${TYPE_LABELS[detail.nodeType] ?? detail.nodeType} · ${ageLabel(detail.lastSeenMs)}前`;
  }, [detail.nodeId, detail.nodeType, detail.props, detail.lastSeenMs]);
  const rows = useMemo(() => propsRows(detail.props).slice(0, 5), [detail.props]);

  return (
    <div className="absolute right-2 top-12 z-10 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-background/95 p-2.5 shadow-md backdrop-blur">
      <div className="mb-1.5 flex items-start gap-2">
        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: nodeDotColor }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map(([key, value]) => (
          <div key={key} className="text-[10px] leading-relaxed">
            <span className="text-muted-foreground">{key}: </span>
            <span className="text-foreground/90">
              {value.length > 140 ? `${value.slice(0, 138)}…` : value}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {onCiteNode ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-6 w-full text-[11px]"
            onClick={() => {
              onCiteNode(
                makeGraphContextRef({
                  nodeId: detail.nodeId,
                  nodeType: detail.nodeType,
                  typeLabel: TYPE_LABELS[detail.nodeType] ?? detail.nodeType,
                  label,
                  props: detail.props,
                }),
              );
            }}
          >
            引用到对话
          </Button>
        ) : null}
        {detail.nodeId.startsWith("session_group:") ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 w-full text-[11px]"
            onClick={() => onDrill(detail.nodeId)}
          >
            展开成员
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 w-full text-[11px]"
            onClick={() => onDrill(detail.nodeId)}
          >
            展开
          </Button>
        )}
      </div>
    </div>
  );
});

function AssetGraphPanelInner({
  repoPath,
  deferForContent = false,
  currentSessionId,
  onCiteNode,
}: AssetGraphPanelProps) {
  const [counts, setCounts] = useState<GraphCounts | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hits, setHits] = useState<NodeHit[]>([]);
  const [view, setView] = useState<SubgraphView | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [detail, setDetail] = useState<SubgraphNode | null>(null);
  /** 当前会话在图中的节点 id（金环 + 初始相机焦点）；未收录/被过滤时为 null */
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  const themeMode = useGraphThemeMode();
  const nodeDotColor = sceneTheme(themeMode).nodeFill;

  // 日期筛选：默认「全部」不过滤；区间经 ref 透传给 invoke（不触发 callback 重建）
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const dateRangeRef = useRef<DateRange>({});
  dateRangeRef.current = computeDateRange(datePreset, customFrom, customTo);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<SubgraphView | null>(null);
  viewRef.current = view;
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  // 会话 id 走 ref 供 loadLatest 读取（避免 loadLatest 身份随会话切换变化）；
  // 视角跟随由下方两个 effect 完成（setFocus 纯相机/属性操作，不重拉图）。
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  const [drilled, setDrilled] = useState<string | null>(null);
  /** 场景命令式焦点接口（场景构建时填充）；focusRef 始终反映最新焦点 */
  const focusApiRef = useRef<GraphSceneApi | null>(null);
  const focusRef = useRef<string | null>(null);
  focusRef.current = drilled ? null : focusNodeId;
  /** idle=加载中；ready=已有数据或已确认空 */
  const [loadPhase, setLoadPhase] = useState<"idle" | "ready">("idle");
  /** 仓路径变化后需要拉图；会话内容忙完才真正执行，避免同仓切会话误触发重载 */
  const pendingRepoLoadRef = useRef(false);
  /**
   * 数据 view 与 WebGL 场景解耦：消息 hydration 期间冻结旧场景；
   * 新图仅在空闲时挂上（对齐社区 requestIdleCallback / 勿在导航瞬间重建 WebGL）。
   */
  const [sceneView, setSceneView] = useState<SubgraphView | null>(null);
  /** 仅全量重建时递增；增量 merge 只改 view，不 bump，避免 WebGL 整图重装。 */
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const bumpScene = useCallback(() => setSceneEpoch((n) => n + 1), []);
  const [queue, setQueue] = useState<ExtractionQueue | null>(null);
  /** 本波次完成数/总数：只增不减；中途新入队只抬高 total，不把 done 打回 0。 */
  const [queueProgress, setQueueProgress] = useState({ done: 0, total: 0 });
  const queueProgressRef = useRef({ done: 0, total: 0 });
  /** 队列刚清空时短暂展示「已沉淀」，避免轮询窗口里完全看不到反馈。 */
  const [queueSettled, setQueueSettled] = useState(false);
  const queueSettledRef = useRef(false);
  const queueUpdatedAtRef = useRef(0);
  const queueSettleTimerRef = useRef<number | null>(null);
  const mergeInflightRef = useRef(false);
  const pendingMergeViewRef = useRef<SubgraphView | null>(null);
  const sceneEverReadyRef = useRef(false);
  const viewSnapshotRef = useRef<SubgraphView | null>(null);
  viewSnapshotRef.current = view;

  const openSubgraph = useCallback(
    async (center: string) => {
      if (!IS_TAURI || !repoPath || !center) return;
      const pathAtRequest = repoPath;
      setLoadingView(true);
      setDetail(null);
      try {
        const result = await invoke<SubgraphView>("asset_graph_subgraph", {
          repoPath: pathAtRequest, center, hops: 2, limit: 150,
          fromMs: dateRangeRef.current.fromMs ?? null,
          toMs: dateRangeRef.current.toMs ?? null,
        });
        if (repoPathRef.current !== pathAtRequest) return;
        const normalized: SubgraphView = {
          center: result?.center ?? "",
          nodes: result?.nodes ?? [],
          edges: result?.edges ?? [],
        };
        if (normalized.nodes.length === 0) {
          // 下钻空结果时保留当前图（避免点会话组后整图消失、又看不到展开入口）
          console.warn("[asset-graph] subgraph empty for", center);
          return;
        }
        setDrilled(center);
        setView(normalized);
      bumpScene();
      } catch (error) {
        console.warn("[asset-graph] subgraph failed", error);
      } finally {
        if (repoPathRef.current === pathAtRequest) setLoadingView(false);
      }
    },
    [repoPath, bumpScene]
  );

  const openFull = useCallback(async () => {
    if (!IS_TAURI || !repoPath) return;
    const pathAtRequest = repoPath;
    setDetail(null);
    setDrilled(null);
    try {
      const result = await invoke<SubgraphView>("asset_graph_full", {
        repoPath: pathAtRequest, limit: 1000, compact: true,
        fromMs: dateRangeRef.current.fromMs ?? null,
        toMs: dateRangeRef.current.toMs ?? null,
      });
      if (repoPathRef.current !== pathAtRequest) return;
      const normalized: SubgraphView = {
        center: result?.center ?? "",
        nodes: result?.nodes ?? [],
        edges: result?.edges ?? [],
      };
      setView(normalized.nodes.length > 0 ? normalized : null);
      bumpScene();
    } catch (error) {
      console.warn("[asset-graph] full graph failed", error);
    }
  }, [repoPath, bumpScene]);

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
        bumpScene();
        setLoadPhase("ready");
        return;
      }
      // 先解析当前会话的焦点节点，再拉图——保证场景构建时焦点已就位
      const sessionId = currentSessionIdRef.current;
      if (sessionId) {
        try {
          const focus = await invoke<{ nodeId: string | null }>("asset_graph_session_node", {
            repoPath: pathAtRequest, sessionId,
          });
          if (repoPathRef.current !== pathAtRequest) return;
          setFocusNodeId(focus?.nodeId ?? null);
        } catch {
          setFocusNodeId(null);
        }
      } else {
        setFocusNodeId(null);
      }
      await openFull();
      if (repoPathRef.current === pathAtRequest) setLoadPhase("ready");
    } catch (error) {
      console.warn("[asset-graph] load failed", error);
      if (repoPathRef.current === pathAtRequest) setLoadPhase("ready");
    } finally {
      if (repoPathRef.current === pathAtRequest) setLoadingView(false);
    }
  }, [repoPath, openFull, bumpScene]);

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
    sceneEverReadyRef.current = false;
    pendingMergeViewRef.current = null;
    setHits([]);
    setDetail(null);
    setDrilled(null);
    setSearchQuery("");
    setFocusNodeId(null);
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

  // 仅 sceneEpoch bump（全量加载/下钻/筛选）时换场景；增量 merge 不走这里。
  useEffect(() => {
    if (deferForContent) return;
    const pathAt = repoPath;
    const next = viewSnapshotRef.current;
    return scheduleWhenIdle(() => {
      if (repoPathRef.current !== pathAt) return;
      startTransition(() => setSceneView(next));
    }, { timeout: 1200, delay: 64 });
  }, [sceneEpoch, deferForContent, repoPath]);


  // 抽取队列：有活才显示顶栏；进度变化时增量并入新节点（不整图重建）。
  // 故意不绑 deferForContent：会话 hydration 只应推迟重图，不应清空/停掉队列指示。
  useEffect(() => {
    if (!IS_TAURI || !repoPath) {
      setQueue(null);
      queueProgressRef.current = { done: 0, total: 0 };
      setQueueProgress({ done: 0, total: 0 });
      queueSettledRef.current = false;
      setQueueSettled(false);
      queueUpdatedAtRef.current = 0;
      return;
    }
    let cancelled = false;
    const pathAt = repoPath;
    let prevActive = -1;
    let timer: number | null = null;

    const clearSettleTimer = () => {
      if (queueSettleTimerRef.current != null) {
        window.clearTimeout(queueSettleTimerRef.current);
        queueSettleTimerRef.current = null;
      }
    };

    const mergeLatestGraph = async () => {
      if (cancelled || mergeInflightRef.current || drilled) return;
      mergeInflightRef.current = true;
      try {
        const result = await invoke<SubgraphView>("asset_graph_full", {
          repoPath: pathAt,
          limit: 1000,
          compact: true,
          fromMs: dateRangeRef.current.fromMs ?? null,
          toMs: dateRangeRef.current.toMs ?? null,
        });
        if (cancelled || repoPathRef.current !== pathAt) return;
        const normalized: SubgraphView = {
          center: result?.center ?? "",
          nodes: result?.nodes ?? [],
          edges: result?.edges ?? [],
        };
        if (normalized.nodes.length === 0) return;
        viewRef.current = normalized;
        if (focusApiRef.current?.mergeView) {
          focusApiRef.current.mergeView(normalized);
          pendingMergeViewRef.current = null;
          startTransition(() => setView(normalized));
        } else {
          pendingMergeViewRef.current = normalized;
        }
        try {
          const summary = await invoke<GraphCounts>("asset_graph_summary", { repoPath: pathAt });
          if (!cancelled && repoPathRef.current === pathAt) setCounts(summary);
        } catch {
          /* ignore */
        }
      } catch (error) {
        console.warn("[asset-graph] incremental merge failed", error);
      } finally {
        mergeInflightRef.current = false;
      }
    };

    const scheduleNext = (active: number) => {
      if (cancelled) return;
      if (timer != null) window.clearTimeout(timer);
      // 有活时加快轮询，避免「沉淀」窗口被 2s 间隔漏掉。
      const delay = active > 0 ? 800 : 2000;
      timer = window.setTimeout(() => {
        void tick();
      }, delay);
    };

    const tick = async () => {
      if (cancelled || repoPathRef.current !== pathAt) return;
      let active = 0;
      try {
        const q = await invoke<ExtractionQueue>("asset_graph_extraction_queue", {
          repoPath: pathAt,
        });
        if (cancelled || repoPathRef.current !== pathAt) return;
        const pending = Number(q?.pending) || 0;
        const claimed = Number(q?.claimed) || 0;
        const updatedAtMs = Number(q?.updatedAtMs) || 0;
        active = pending + claimed;
        const updatedAdvanced = updatedAtMs > queueUpdatedAtRef.current;
        const activeDropped = prevActive > 0 && active < prevActive;

        if (active > 0) {
          clearSettleTimer();
          queueSettledRef.current = false;
          setQueueSettled(false);
          setQueue({ pending, claimed, updatedAtMs });
          // 进度：完成数只随 active 下降累加；新任务入队只抬高 total。
          let { done, total } = queueProgressRef.current;
          if (prevActive <= 0) {
            done = 0;
            total = active;
          } else if (active < prevActive) {
            done += prevActive - active;
            total = Math.max(total, done + active);
          } else if (active > prevActive) {
            total = Math.max(total, done + active);
          }
          queueProgressRef.current = { done, total };
          setQueueProgress({ done, total });
        } else if (prevActive > 0) {
          // 刚抽完：短暂留「已沉淀」，再隐藏。
          const finished = Math.max(
            queueProgressRef.current.total,
            queueProgressRef.current.done + prevActive,
          );
          queueProgressRef.current = { done: finished, total: finished };
          setQueueProgress({ done: finished, total: finished });
          setQueue(null);
          queueSettledRef.current = true;
          setQueueSettled(true);
          clearSettleTimer();
          queueSettleTimerRef.current = window.setTimeout(() => {
            if (cancelled) return;
            queueSettledRef.current = false;
            setQueueSettled(false);
            queueProgressRef.current = { done: 0, total: 0 };
            setQueueProgress({ done: 0, total: 0 });
          }, 2400);
        } else if (!queueSettledRef.current) {
          setQueue(null);
        }

        if (updatedAdvanced || activeDropped || (prevActive <= 0 && active > 0)) {
          if (updatedAdvanced) queueUpdatedAtRef.current = updatedAtMs;
          void mergeLatestGraph();
        }

        prevActive = active;
      } catch (error) {
        console.warn("[asset-graph] extraction queue poll failed", error);
        if (!cancelled) {
          setQueue(null);
          queueProgressRef.current = { done: 0, total: 0 };
          setQueueProgress({ done: 0, total: 0 });
          queueSettledRef.current = false;
          setQueueSettled(false);
        }
      }
      scheduleNext(active);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      clearSettleTimer();
    };
  }, [repoPath, drilled, bumpScene]);



  // 日期筛选变化 → 按当前视图（下钻/全图）重载。
  // 用 key 对比而不是直接挂在依赖上：repoPath 变化导致 openFull/openSubgraph
  // 身份变化时不误触发（那一路由 loadLatest 负责）。
  const lastDateKeyRef = useRef("");
  useEffect(() => {
    const key = `${datePreset}|${customFrom}|${customTo}`;
    if (!lastDateKeyRef.current) {
      lastDateKeyRef.current = key;
      return;
    }
    if (lastDateKeyRef.current === key) return;
    lastDateKeyRef.current = key;
    if (!IS_TAURI || !repoPathRef.current) return;
    if (drilled) void openSubgraph(drilled);
    else void openFull();
  }, [datePreset, customFrom, customTo, drilled, openSubgraph, openFull]);

  // 会话切换 → 解析新会话的图节点（不重拉图；视角跟随由下方 setFocus effect 完成）。
  // 挂载时也会跑一次：首次打开的初始焦点，比 loadLatest 里的解析更早到位。
  useEffect(() => {
    if (!IS_TAURI || !repoPath) return;
    const pathAtRequest = repoPath;
    if (!currentSessionId) {
      setFocusNodeId(null);
      return;
    }
    let cancelled = false;
    invoke<{ nodeId: string | null }>("asset_graph_session_node", {
      repoPath: pathAtRequest,
      sessionId: currentSessionId,
    })
      .then((r) => {
        if (!cancelled && repoPathRef.current === pathAtRequest) {
          setFocusNodeId(r?.nodeId ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentSessionId, repoPath]);

  // 下钻视图有自己的 center 金环，会话焦点只在全图生效
  const handleSelectNode = useCallback((node: SubgraphNode | null) => {
    setDetail(node);
  }, []);
  const handleDrillNode = useCallback(
    (nodeId: string) => {
      void openSubgraph(nodeId);
    },
    [openSubgraph],
  );
  const handleCloseDetail = useCallback(() => setDetail(null), []);

  const { ready } = useSigmaScene(
    containerRef,
    sceneView,
    themeMode,
    focusRef,
    focusApiRef,
    handleSelectNode,
    handleDrillNode,
  );

  useEffect(() => {
    if (ready) sceneEverReadyRef.current = true;
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const pending = pendingMergeViewRef.current;
    if (!pending || !focusApiRef.current?.mergeView) return;
    pendingMergeViewRef.current = null;
    focusApiRef.current.mergeView(pending);
    startTransition(() => setView(pending));
  }, [ready]);

  // 焦点变化 / 场景就绪 / 同组内切会话 → 金环 + 相机飞入。
  // 依赖 currentSessionId：同语义超节点下切成员时 focusNodeId 不变，也要重飞。
  // 依赖 ready：场景晚于焦点解析建好时补一次，避免空转。
  useEffect(() => {
    if (drilled || !ready) return;
    focusApiRef.current?.setFocus(focusNodeId);
  }, [focusNodeId, drilled, ready, currentSessionId]);

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
            {/* 日期筛选：默认全部；自定义展开起止日期（闭区间） */}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setDatePreset(p.key)}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] backdrop-blur transition-colors ${
                    datePreset === p.key
                      ? "border-border bg-background/90 text-foreground shadow-sm"
                      : "border-border/40 bg-background/50 text-muted-foreground hover:bg-background/80"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {datePreset === "custom" && (
              <div
                className="mt-1 flex items-center gap-1 rounded-md border border-border/50 bg-background/80 px-1.5 py-1 shadow-sm backdrop-blur"
                style={{ colorScheme: themeMode }}
              >
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-5 min-w-0 flex-1 bg-transparent text-[10px] text-foreground outline-none"
                  aria-label="开始日期"
                />
                <span className="shrink-0 text-[10px] text-muted-foreground">至</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-5 min-w-0 flex-1 bg-transparent text-[10px] text-foreground outline-none"
                  aria-label="结束日期"
                />
              </div>
            )}
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
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: nodeDotColor }} />
                      <span className="truncate text-foreground">{resolveNodeLabel(hit.nodeType, hit.label, undefined)}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                        {TYPE_LABELS[hit.nodeType] ?? hit.nodeType}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>


          {/* 右上：队列指示 + 刷新（避开左侧搜索框） */}
          <div className="absolute right-2 top-2 z-20 flex items-center gap-2">
            {queue && (queue.pending + queue.claimed) > 0 ? (
              <div className="pointer-events-none flex items-center gap-2 rounded-full border border-border/60 bg-background/85 px-3 py-1 shadow-sm backdrop-blur">
                <span className="relative flex size-1.5">
                  <span className="absolute inset-0 animate-pulse rounded-full bg-foreground/50" />
                  <span className="relative size-1.5 rounded-full bg-foreground/80" />
                </span>
                <span className="text-[11px] font-medium text-foreground/90">沉淀中</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {queueProgress.done}/{Math.max(queueProgress.total, queueProgress.done)}
                </span>
                <span className="h-0.5 w-14 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-foreground/55 transition-[width] duration-500 ease-out"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (queueProgress.done /
                            Math.max(1, queueProgress.total, queueProgress.done)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </span>
                {queue.claimed > 0 ? (
                  <span className="text-[10px] text-muted-foreground">写入中</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">排队 {queue.pending}</span>
                )}
              </div>
            ) : queueSettled ? (
              <div className="pointer-events-none flex items-center gap-2 rounded-full border border-border/50 bg-background/80 px-3 py-1 shadow-sm backdrop-blur">
                <span className="size-1.5 rounded-full bg-foreground/40" />
                <span className="text-[11px] font-medium text-foreground/80">已沉淀</span>
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-md border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-background"
              title="刷新记忆图谱"
              onClick={() => void loadLatest()}
              disabled={loadingView || rebuilding}
            >
              {loadingView ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            </Button>
          </div>

          {detail ? (
            <GraphNodeInspector
              detail={detail}
              nodeDotColor={nodeDotColor}
              onClose={handleCloseDetail}
              onDrill={handleDrillNode}
              onCiteNode={onCiteNode}
            />
          ) : null}

          {loadingView ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !ready && !sceneEverReadyRef.current ? (
            // 仅首次构建显示加载遮罩；后续增量/重建不遮挡，避免点击时误感知为「转圈」
            view && view.nodes.length > 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground/70">图谱构建中…</p>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
                <p className="text-xs text-muted-foreground">暂无可视数据</p>
                <p className="text-[10px] text-muted-foreground/60">
                  尝试调整日期筛选、右上角刷新或扫描存量会话
                </p>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

export const AssetGraphPanel = memo(AssetGraphPanelInner);
