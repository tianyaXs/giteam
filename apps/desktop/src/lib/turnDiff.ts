/**
 * 回合改动的行级 diff（ Myers/LCS 简化版，编辑块都很小，DP 足够）。
 * 悬浮预览与完整查看器共用：diffLines 出原始行序列，buildHunks 切 hunk。
 */

export type DiffLine = {
  type: "context" | "added" | "removed";
  /** 旧文件行号（added 为 null）。 */
  beforeNo: number | null;
  /** 新文件行号（removed 为 null）。 */
  afterNo: number | null;
  text: string;
};

export type DiffHunk = {
  /** `@@ -a,b +c,d @@` 形式的 hunk 头。 */
  header: string;
  lines: DiffLine[];
};

/** DP 上限：行数乘积超过则退化为「整段删除 + 整段新增」双块展示。 */
const DP_CELL_LIMIT = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  if (a.length * b.length > DP_CELL_LIMIT) {
    return [
      ...a.map((text, index) => ({ type: "removed" as const, beforeNo: index + 1, afterNo: null, text })),
      ...b.map((text, index) => ({ type: "added" as const, beforeNo: null, afterNo: index + 1, text }))
    ];
  }
  // LCS 动态规划。
  const rows = a.length;
  const cols = b.length;
  const dp: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      out.push({ type: "context", beforeNo: i + 1, afterNo: j + 1, text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "removed", beforeNo: i + 1, afterNo: null, text: a[i] });
      i += 1;
    } else {
      out.push({ type: "added", beforeNo: null, afterNo: j + 1, text: b[j] });
      j += 1;
    }
  }
  while (i < rows) {
    out.push({ type: "removed", beforeNo: i + 1, afterNo: null, text: a[i] });
    i += 1;
  }
  while (j < cols) {
    out.push({ type: "added", beforeNo: null, afterNo: j + 1, text: b[j] });
    j += 1;
  }
  return out;
}

/** 把行序列切成带上下文语境的 hunk（变更区前后各 context 行，相邻 hunk 距离 ≤ 2*context 则合并）。 */
export function buildHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed = new Set<number>();
  lines.forEach((line, index) => {
    if (line.type !== "context") changed.add(index);
  });
  if (changed.size === 0) return [];

  // 每个变更行的影响区间 [start, end]（含上下文）。
  const spans: Array<[number, number]> = [];
  for (const index of changed) {
    spans.push([Math.max(0, index - context), Math.min(lines.length - 1, index + context)]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], span[1]);
    } else {
      merged.push([span[0], span[1]]);
    }
  }

  return merged.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    const first = slice[0];
    const lastLine = slice[slice.length - 1];
    const beforeStart = first.beforeNo ?? (lastLine.beforeNo ?? 0);
    const beforeCount = slice.filter((line) => line.beforeNo != null).length;
    const afterStart = first.afterNo ?? (lastLine.afterNo ?? 0);
    const afterCount = slice.filter((line) => line.afterNo != null).length;
    return {
      header: `@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`,
      lines: slice
    };
  });
}
