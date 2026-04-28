import { useEffect, useRef, useCallback } from "react";

export interface TopologyCanvasNode {
  id: string;
  kind: "branch" | "commit" | "worktree" | "repo";
  label: string;
  branch: string;
  parentId: string | null;
  children: TopologyCanvasNode[];
  depth: number;
  gx: number;
  gy: number;
  tone: { accent: string; soft: string; border: string };
  meta?: string;
  sha?: string;
  path?: string;
  isCurrent?: boolean;
  dirtyCount?: number;
  author?: string;
  date?: string;
  commits?: number;
  collapsed?: boolean;
  commitCount?: number;
}

interface Props {
  nodes: TopologyCanvasNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDoubleClick: (node: TopologyCanvasNode) => void;
  onContextMenu?: (node: TopologyCanvasNode, e: React.MouseEvent) => void;
  onToggleCollapse: (id: string) => void;
  collapsedIds: Set<string>;
  theme: "dark" | "light";
}

const CELL = 52;
const GAP = 1;

export function WorktreeTopologyCanvas({
  nodes,
  selectedId,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onToggleCollapse,
  collapsedIds,
  theme
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 所有状态使用 ref 避免 React 重渲染
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1, targetZoom: 1 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const animRef = useRef(0);
  const layoutRef = useRef<TopologyCanvasNode[]>([]);
  const hoveredIdRef = useRef("");
  const selectedIdRef = useRef(selectedId);
  const showInfoRef = useRef(false);
  const infoNodeRef = useRef<TopologyCanvasNode | null>(null);

  // 同步 selectedId
  selectedIdRef.current = selectedId;

  // 计算布局（完全参照 worktree.html）
  const calculateLayout = useCallback((inputNodes: TopologyCanvasNode[], collapsedSet: Set<string>) => {
    if (inputNodes.length === 0) return [];

    // 找到根节点
    const roots = inputNodes.filter((n) => !n.parentId);
    if (roots.length === 0) return inputNodes;

    function getVisibleChildren(node: TopologyCanvasNode): TopologyCanvasNode[] {
      if (!node.children || node.children.length === 0) return [];
      // 如果节点被收起，只保留分支子节点（跳过 commit 子节点）
      if (collapsedSet.has(node.id)) {
        return node.children.filter((c) => c.kind !== "commit");
      }
      return node.children;
    }

    function layoutTree(
      node: TopologyCanvasNode,
      depth: number
    ): { minX: number; maxX: number } {
      node.gy = depth * 2;

      const visibleChildren = getVisibleChildren(node);
      if (visibleChildren.length === 0) {
        return { minX: 0, maxX: 0 };
      }

      let currentX = 0;
      const childBounds: { minX: number; maxX: number }[] = [];

      for (const child of visibleChildren) {
        const res = layoutTree(child, depth + 1);
        const offset = currentX - res.minX;
        shiftSubtree(child, offset);
        const span = res.maxX - res.minX;
        childBounds.push({ minX: currentX, maxX: currentX + span });
        currentX += span + 2;
      }

      const left = childBounds[0].minX;
      const right = childBounds[childBounds.length - 1].maxX;
      node.gx = Math.round((left + right) / 2);
      return { minX: left, maxX: right };
    }

    function shiftSubtree(node: TopologyCanvasNode, offset: number) {
      node.gx += offset;
      const visibleChildren = getVisibleChildren(node);
      for (const child of visibleChildren) {
        shiftSubtree(child, offset);
      }
    }

    // 布局所有根节点
    let globalX = 0;
    for (const root of roots) {
      const res = layoutTree(root, 0);
      shiftSubtree(root, globalX - res.minX);
      globalX += res.maxX - res.minX + 4;
    }

    // 收集所有可见节点
    const allNodes: TopologyCanvasNode[] = [];
    function collect(node: TopologyCanvasNode) {
      allNodes.push(node);
      const visibleChildren = getVisibleChildren(node);
      for (const child of visibleChildren) {
        collect(child);
      }
    }
    roots.forEach(collect);

    // 整体居中偏移
    const allX = allNodes.map((n) => n.gx);
    const offset = -Math.round((Math.min(...allX) + Math.max(...allX)) / 2);
    allNodes.forEach((n) => {
      n.gx += offset;
    });

    return allNodes;
  }, []);

  // 坐标转换
  const toScreen = useCallback(
    (gx: number, gy: number, camera: typeof cameraRef.current) => {
      return {
        x: gx * CELL * camera.zoom + camera.x,
        y: gy * CELL * camera.zoom + camera.y
      };
    },
    []
  );

  const toGrid = useCallback(
    (sx: number, sy: number, camera: typeof cameraRef.current) => {
      return {
        gx: Math.round((sx - camera.x) / (CELL * camera.zoom)),
        gy: Math.round((sy - camera.y) / (CELL * camera.zoom))
      };
    },
    []
  );

  // 绘制网格
  const drawGrid = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number, camera: typeof cameraRef.current) => {
      const s = CELL * camera.zoom;
      const ox = camera.x % s;
      const oy = camera.y % s;

      ctx.lineWidth = 1;
      ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
      for (let x = ox; x < width; x += s) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = oy; y < height; y += s) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.strokeStyle = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
      for (let x = ox; x < width; x += s * 5) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = oy; y < height; y += s * 5) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    },
    [theme]
  );

  // 绘制连线
  const drawLinks = useCallback(
    (ctx: CanvasRenderingContext2D, layoutNodes: TopologyCanvasNode[], camera: typeof cameraRef.current) => {
      const s = CELL * camera.zoom;

      const layoutIds = new Set(layoutNodes.map((n) => n.id));

      for (const node of layoutNodes) {
        if (!node.children || node.children.length === 0) continue;

        const pPos = toScreen(node.gx, node.gy, camera);
        const px = pPos.x + s / 2;
        const py = pPos.y + s - GAP;

        for (const child of node.children) {
          // 只绘制到可见子节点的连线
          if (!layoutIds.has(child.id)) continue;
          const cPos = toScreen(child.gx, child.gy, camera);
          const cx = cPos.x + s / 2;
          const cy = cPos.y + GAP;
          const midY = pPos.y + s + s / 2;

          const isRel =
            selectedIdRef.current === node.id ||
            selectedIdRef.current === child.id;
          const isHov =
            hoveredIdRef.current === node.id ||
            hoveredIdRef.current === child.id;
          const isRelated = isRel || isHov;

          ctx.save();
          ctx.strokeStyle = isRelated
            ? theme === "dark"
              ? "#58a6ff"
              : "#0071e3"
            : theme === "dark"
              ? "rgba(255,255,255,0.12)"
              : "rgba(0,0,0,0.12)";
          ctx.lineWidth = isRelated ? 2.5 : 1.5;
          ctx.lineCap = "butt";
          ctx.lineJoin = "miter";

          const pts = [
            { x: px, y: py },
            { x: px, y: midY },
            { x: cx, y: midY },
            { x: cx, y: cy }
          ];

          if (node.gx === child.gx) {
            pts.splice(1, 2);
          }

          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          ctx.stroke();

          if (isRelated) {
            ctx.strokeStyle =
              theme === "dark"
                ? "rgba(88,166,255,0.06)"
                : "rgba(0,113,227,0.06)";
            ctx.lineWidth = 10;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
              ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.stroke();
          }

          ctx.restore();
        }
      }
    },
    [theme, toScreen]
  );

  // 绘制节点
  const drawNode = useCallback(
    (ctx: CanvasRenderingContext2D, node: TopologyCanvasNode, camera: typeof cameraRef.current) => {
      const isSel = selectedIdRef.current === node.id;
      const isHov = hoveredIdRef.current === node.id;
      const isMain = node.kind === "repo" || node.kind === "worktree";

      const pos = toScreen(node.gx, node.gy, camera);
      const s = CELL * camera.zoom;
      const x = pos.x + GAP;
      const y = pos.y + GAP;
      const w = s - GAP * 2;
      const h = s - GAP * 2;

      ctx.save();

      if (isMain) {
        ctx.fillStyle = isSel ? "#1e293b" : "#0f172a";
      } else {
        ctx.fillStyle = isSel
          ? theme === "dark"
            ? "rgba(88,166,255,0.08)"
            : "rgba(0,113,227,0.04)"
          : theme === "dark"
            ? "#252526"
            : "#ffffff";
      }
      ctx.fillRect(x, y, w, h);

      ctx.lineWidth = 1;
      if (isMain) {
        ctx.strokeStyle = isSel ? "#58a6ff" : "#1e293b";
      } else {
        ctx.strokeStyle = isSel
          ? theme === "dark"
            ? "#58a6ff"
            : "#0071e3"
          : isHov
            ? theme === "dark"
              ? "rgba(255,255,255,0.15)"
              : "rgba(0,0,0,0.15)"
            : theme === "dark"
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.08)";
      }
      ctx.strokeRect(x, y, w, h);

      if (isSel) {
        ctx.strokeStyle =
          theme === "dark"
            ? "rgba(88,166,255,0.3)"
            : "rgba(0,113,227,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(pos.x + 0.5, pos.y + 0.5, s - 1, s - 1);
      }

      const dotR = 3.5 * camera.zoom;
      ctx.beginPath();
      ctx.arc(x + 8 * camera.zoom + dotR, y + 8 * camera.zoom + dotR, dotR, 0, Math.PI * 2);
      ctx.fillStyle = node.tone.accent;
      ctx.fill();

      const txt = isMain ? "#f1f5f9" : theme === "dark" ? "#d4d4d4" : "#1e293b";
      const txtSec = isMain ? "#94a3b8" : theme === "dark" ? "#9da5b4" : "#64748b";

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `600 ${10 * camera.zoom}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillStyle = txt;
      let name = node.label;
      if (name.length > 8) name = name.slice(0, 6) + "..";
      ctx.fillText(name, x + w / 2, y + h / 2 - 2 * camera.zoom);

      ctx.font = `500 ${8 * camera.zoom}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.fillStyle = txtSec;
      if (node.commits !== undefined) {
        ctx.fillText(`${node.commits}`, x + w / 2, y + h / 2 + 10 * camera.zoom);
      } else if (node.meta) {
        ctx.fillText(node.meta, x + w / 2, y + h / 2 + 10 * camera.zoom);
      }

      if (isMain && node.kind === "repo") {
        ctx.font = `700 ${7 * camera.zoom}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.fillStyle = "#58a6ff";
        ctx.fillText("MAIN", x + w / 2, y + h - 6 * camera.zoom);
      }

      // 绘制展开/收起指示器（仅分支节点有 commit 子节点时显示）
      if (node.kind === "branch" && node.commitCount && node.commitCount > 0) {
        const isCollapsed = collapsedIds.has(node.id);
        const badgeR = 7 * camera.zoom;
        const badgeX = x + w - badgeR - 4 * camera.zoom;
        const badgeY = y + h - badgeR - 4 * camera.zoom;

        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = node.tone.accent;
        ctx.fill();

        ctx.font = `600 ${7 * camera.zoom}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isCollapsed ? "+" : "−", badgeX, badgeY);
      }

      ctx.restore();
    },
    [theme, toScreen, collapsedIds]
  );

  // 绘制主函数
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const camera = cameraRef.current;

    ctx.fillStyle = theme === "dark" ? "#1e1e1e" : "#f5f5f7";
    ctx.fillRect(0, 0, width, height);

    drawGrid(ctx, width, height, camera);
    drawLinks(ctx, layoutRef.current, camera);
    for (const node of layoutRef.current) {
      drawNode(ctx, node, camera);
    }
  }, [drawGrid, drawLinks, drawNode, theme]);

  // 动画循环
  const animate = useCallback(() => {
    const camera = cameraRef.current;
    camera.zoom += (camera.targetZoom - camera.zoom) * 0.12;
    draw();
    animRef.current = requestAnimationFrame(animate);
  }, [draw]);

  // 初始化
  useEffect(() => {
    const layout = calculateLayout(nodes, collapsedIds);
    layoutRef.current = layout;

    if (layout.length > 0 && containerRef.current) {
      const allGX = layout.map((n) => n.gx);
      const allGY = layout.map((n) => n.gy);
      const minGX = Math.min(...allGX);
      const maxGX = Math.max(...allGX);
      const maxGY = Math.max(...allGY);
      const centerGX = (minGX + maxGX) / 2;
      const centerGY = maxGY / 2;

      cameraRef.current.x =
        containerRef.current.clientWidth / 2 - centerGX * CELL * cameraRef.current.zoom;
      cameraRef.current.y =
        containerRef.current.clientHeight / 3 - centerGY * CELL * cameraRef.current.zoom;
    }

    draw();
  }, [nodes, calculateLayout, draw]);

  // 启动动画
  useEffect(() => {
    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
      }
    };
  }, [animate]);

  // 鼠标事件处理
  const getMousePos = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }, []);

  const getNodeAt = useCallback(
    (pos: { x: number; y: number }) => {
      const camera = cameraRef.current;
      // 使用矩形区域检测而非精确网格匹配
      for (const node of layoutRef.current) {
        const screenPos = toScreen(node.gx, node.gy, camera);
        const s = CELL * camera.zoom;
        if (
          pos.x >= screenPos.x &&
          pos.x <= screenPos.x + s &&
          pos.y >= screenPos.y &&
          pos.y <= screenPos.y + s
        ) {
          return node;
        }
      }
      return null;
    },
    [toScreen]
  );

  // 检测点击是否在展开/收起按钮上
  const isClickOnToggle = useCallback(
    (pos: { x: number; y: number }, node: TopologyCanvasNode) => {
      if (node.kind !== "branch" || !node.commitCount || node.commitCount <= 0) return false;
      const s = CELL * cameraRef.current.zoom;
      const nodePos = toScreen(node.gx, node.gy, cameraRef.current);
      const badgeR = 7 * cameraRef.current.zoom;
      const badgeX = nodePos.x + s - badgeR - 4 * cameraRef.current.zoom;
      const badgeY = nodePos.y + s - badgeR - 4 * cameraRef.current.zoom;
      const dx = pos.x - badgeX;
      const dy = pos.y - badgeY;
      return Math.sqrt(dx * dx + dy * dy) <= badgeR + 2;
    },
    [toScreen]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const pos = getMousePos(e);
      const node = getNodeAt(pos);
      if (node) {
        // 检查是否点击了展开/收起按钮
        if (isClickOnToggle(pos, node)) {
          onToggleCollapse(node.id);
          e.stopPropagation();
          return;
        }
        onSelect(node.id);
        infoNodeRef.current = node;
        showInfoRef.current = true;
        if (canvasRef.current) {
          canvasRef.current.style.cursor = "pointer";
        }
      } else {
        isPanningRef.current = true;
        panStartRef.current = pos;
        if (canvasRef.current) {
          canvasRef.current.style.cursor = "grabbing";
        }
      }
    },
    [getMousePos, getNodeAt, onSelect, onToggleCollapse, isClickOnToggle]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getMousePos(e);
      if (isPanningRef.current) {
        cameraRef.current.x += pos.x - panStartRef.current.x;
        cameraRef.current.y += pos.y - panStartRef.current.y;
        panStartRef.current = pos;
      } else {
        const node = getNodeAt(pos);
        const nodeId = node?.id || "";
        if (nodeId !== hoveredIdRef.current) {
          hoveredIdRef.current = nodeId;
          if (canvasRef.current) {
            canvasRef.current.style.cursor = node ? "pointer" : "grab";
          }
        }
      }
    },
    [getMousePos, getNodeAt]
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = hoveredIdRef.current ? "pointer" : "grab";
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    cameraRef.current.targetZoom = Math.max(
      0.4,
      Math.min(3, cameraRef.current.targetZoom * f)
    );
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = getMousePos(e);
      const node = getNodeAt(pos);
      if (node) {
        onDoubleClick(node);
      }
    },
    [getMousePos, getNodeAt, onDoubleClick]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!onContextMenu) return;
      const pos = getMousePos(e);
      const node = getNodeAt(pos);
      if (node) {
        onContextMenu(node, e);
      }
    },
    [getMousePos, getNodeAt, onContextMenu]
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden"
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          cursor: "grab"
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
