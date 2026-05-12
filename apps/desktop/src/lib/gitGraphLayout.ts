import type { GitGraphNode } from "./types";

export type LaneLayoutRow = {
  sha: string;
  parents: string[];
  col: number;
  colorIdx: number;
};

export type LaneSnapshot = Array<{ sha: string; colorIdx: number }>;

export type LaneLayout = {
  rows: LaneLayoutRow[];
  before: LaneSnapshot[];
  after: LaneSnapshot[];
  maxLanes: number;
};

const LANE_COLORS = [
  "#F6C445",
  "#8A5CF6",
  "#2DD4BF",
  "#60A5FA",
  "#FB7185",
  "#34D399",
  "#F97316"
];

export function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length];
}

export function computeLaneLayout(rows: GitGraphNode[]): LaneLayout {
  const commits = rows.filter((r) => !r.isConnector && !!r.sha);
  const remaining = new Set(commits.map((c) => c.sha));

  const lanes: Array<{ sha: string; colorIdx: number }> = [];
  let nextColor = 0;

  const outRows: LaneLayoutRow[] = [];
  const before: LaneSnapshot[] = [];
  const after: LaneSnapshot[] = [];
  let maxLanes = 0;

  for (const c of commits) {
    remaining.delete(c.sha);

    before.push(lanes.map((l) => ({ sha: l.sha, colorIdx: l.colorIdx })));
    maxLanes = Math.max(maxLanes, lanes.length);

    let col = lanes.findIndex((l) => l.sha === c.sha);
    if (col < 0) {
      lanes.push({ sha: c.sha, colorIdx: nextColor++ });
      col = lanes.length - 1;
    }

    const colorIdx = lanes[col]?.colorIdx ?? 0;
    outRows.push({ sha: c.sha, parents: c.parents ?? [], col, colorIdx });

    const parents = (c.parents ?? []).filter(Boolean);
    if (parents.length === 0) {
      lanes.splice(col, 1);
    } else {
      lanes[col] = { sha: parents[0], colorIdx };
      for (let i = 1; i < parents.length; i += 1) {
        lanes.splice(col + i, 0, { sha: parents[i], colorIdx: nextColor++ });
      }
    }

    for (let i = lanes.length - 1; i >= 0; i -= 1) {
      const s = lanes[i]?.sha ?? "";
      if (!remaining.has(s)) lanes.splice(i, 1);
    }

    after.push(lanes.map((l) => ({ sha: l.sha, colorIdx: l.colorIdx })));
    maxLanes = Math.max(maxLanes, lanes.length);
  }

  return { rows: outRows, before, after, maxLanes };
}
