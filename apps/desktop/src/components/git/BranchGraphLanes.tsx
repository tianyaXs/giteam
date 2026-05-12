import { useMemo } from "react";
import { computeLaneLayout, laneColor } from "../../lib/gitGraphLayout";
import type { GitGraphNode } from "../../lib/types";

type BranchGraphLanesProps = {
  rows: GitGraphNode[];
  rowHeight: number;
  laneGap: number;
  selectedSha: string;
};

export function BranchGraphLanes(props: BranchGraphLanesProps) {
  const commits = props.rows.filter((r) => !r.isConnector && !!r.sha);
  const layout = useMemo(() => computeLaneLayout(commits), [commits]);
  const rowH = props.rowHeight;
  const laneAreaW = 140;
  const maxCol = Math.max(0, ...layout.rows.map((r) => r.col));
  const laneCount = Math.max(1, maxCol + 1);
  const laneGap = Math.max(8, Math.floor((laneAreaW - 20) / laneCount));

  const width = laneAreaW;
  const height = Math.max(1, commits.length * rowH);
  const edges: Array<{ d: string; colorIdx: number; kind: "first" | "merge"; toX: number; toY: number }> = [];

  layout.rows.forEach((r, rowIdx) => {
    const fromX = r.col * laneGap + 10;
    const fromY = rowIdx * rowH + rowH / 2;
    const next = layout.after[rowIdx] ?? [];
    const parents = (r.parents ?? []).filter(Boolean);
    parents.forEach((p, i) => {
      const toCol = next.findIndex((l) => l.sha === p);
      if (toCol < 0) return;
      const toX = toCol * laneGap + 10;
      const toY = (rowIdx + 1) * rowH + rowH / 2;
      const kind: "first" | "merge" = i === 0 ? "first" : "merge";
      if (kind === "first" && toCol === r.col) return;
      const dx = toX - fromX;
      const c1x = fromX + dx * 0.35;
      const c2x = toX - dx * 0.35;
      const c1y = fromY + rowH * 0.55;
      const c2y = toY - rowH * 0.55;
      const d = `M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}`;
      edges.push({ d, colorIdx: r.colorIdx, kind, toX, toY });
    });
  });

  return (
    <svg className="branch-lanes" width={width} height={height} aria-hidden="true">
      <g className="branch-lanes-rails">
        {layout.before.slice(0, commits.length).map((snap, rowIdx) => {
          const y0 = rowIdx * rowH;
          return snap.map((l, colIdx) => {
            const x = colIdx * laneGap + 10;
            return (
              <line
                key={`rail-${rowIdx}-${colIdx}-${l.sha}`}
                x1={x}
                y1={y0}
                x2={x}
                y2={y0 + rowH}
                style={{ stroke: laneColor(l.colorIdx), opacity: 0.18, strokeWidth: 2 }}
              />
            );
          });
        })}
      </g>
      <g className="branch-lanes-edges">
        {edges.map((e, idx) => {
          const color = laneColor(e.colorIdx);
          return (
            <path
              key={`e-${idx}`}
              d={e.d}
              fill="none"
              style={{
                stroke: color,
                opacity: e.kind === "merge" ? 0.3 : 0.85,
                strokeWidth: e.kind === "merge" ? 1.5 : 2.4
              }}
            />
          );
        })}
      </g>
      <g className="branch-lanes-junctions">
        {edges.map((e, idx) => {
          const color = laneColor(e.colorIdx);
          const r = e.kind === "merge" ? 2.8 : 3.2;
          return (
            <circle
              key={`j-${idx}`}
              cx={e.toX}
              cy={e.toY}
              r={r}
              style={{ fill: color, opacity: e.kind === "merge" ? 0.55 : 0.75 }}
            />
          );
        })}
      </g>
      <g className="branch-lanes-nodes">
        {layout.rows.map((r, idx) => {
          const x = r.col * laneGap + 10;
          const y = idx * rowH + rowH / 2;
          const color = laneColor(r.colorIdx);
          const selected = props.selectedSha === r.sha;
          return (
            <circle
              key={`n-${r.sha}`}
              cx={x}
              cy={y}
              r={selected ? 6 : 5}
              style={{ stroke: color, fill: color, strokeWidth: selected ? 2.5 : 2 }}
            />
          );
        })}
      </g>
    </svg>
  );
}
