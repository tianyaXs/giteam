/** 同格多事件：收起为不透明牌堆（只露色边），展开为可读列表。 */

export const CALENDAR_PEEK = {
  insetPx: 3,
  /** 收起时每层露边 */
  peekPx: 8,
  maxVisible: 3,
  /** 展开时每张相对上一张下移 */
  expandStepPx: 30,
} as const;

export type PeekEventLike = {
  id: string;
  day: number;
  hour: number;
  enabled?: boolean;
  title?: string;
};

export type PeekCardLayout = {
  id: string;
  day: number;
  hour: number;
  lane: number;
  visibleCount: number;
  cellTotal: number;
  /** 相对格左 inset 再向右错开的 px */
  offsetPx: number;
  /** 相对满宽再收窄的 px */
  shrinkPx: number;
  /** 相对格顶再下移的 px（展开态） */
  topOffsetPx: number;
  zIndex: number;
  /** 是否渲染标题（收起时仅最前一张） */
  showContent: boolean;
  expanded: boolean;
};

export type PeekOverflowChip = {
  day: number;
  hour: number;
  count: number;
  titles: string[];
  ids: string[];
};

export type PeekLayoutResult = {
  cards: PeekCardLayout[];
  overflows: PeekOverflowChip[];
};

function cellKey(day: number, hour: number): string {
  return `${day}:${hour}`;
}

export function peekCellKey(day: number, hour: number): string {
  return cellKey(day, hour);
}

/** enabled 优先，再按 id 稳定排序 */
export function sortPeekEvents<T extends PeekEventLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ae = a.enabled === false ? 0 : 1;
    const be = b.enabled === false ? 0 : 1;
    if (ae !== be) return be - ae;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function layoutPeekStacks<T extends PeekEventLike>(
  events: T[],
  options?: {
    excludeId?: string | null;
    maxVisible?: number;
    peekPx?: number;
    expandStepPx?: number;
    /** `day:hour`，该格展开为可读列表 */
    expandedKey?: string | null;
  }
): PeekLayoutResult {
  const maxVisible = options?.maxVisible ?? CALENDAR_PEEK.maxVisible;
  const peekPx = options?.peekPx ?? CALENDAR_PEEK.peekPx;
  const expandStepPx = options?.expandStepPx ?? CALENDAR_PEEK.expandStepPx;
  const excludeId = options?.excludeId ?? null;
  const expandedKey = options?.expandedKey ?? null;

  const buckets = new Map<string, T[]>();
  for (const ev of events) {
    if (excludeId && ev.id === excludeId) continue;
    const key = cellKey(ev.day, ev.hour);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(ev);
    else buckets.set(key, [ev]);
  }

  const cards: PeekCardLayout[] = [];
  const overflows: PeekOverflowChip[] = [];

  for (const [key, bucket] of buckets) {
    const sorted = sortPeekEvents(bucket);
    const cellTotal = sorted.length;
    const expanded = expandedKey === key && cellTotal > 1;

    if (expanded) {
      // 展开：全部可见，纵向错开，每张都有正文
      sorted.forEach((ev, lane) => {
        cards.push({
          id: ev.id,
          day: ev.day,
          hour: ev.hour,
          lane,
          visibleCount: cellTotal,
          cellTotal,
          offsetPx: 0,
          shrinkPx: 0,
          topOffsetPx: lane * expandStepPx,
          zIndex: 40 + lane,
          showContent: true,
          expanded: true,
        });
      });
      continue;
    }

    const visibleCount = Math.min(cellTotal, maxVisible);
    // 收起牌堆：最前一张在最右/最上（可读），后面的只露左边色条
    for (let lane = 0; lane < visibleCount; lane += 1) {
      const ev = sorted[lane]!;
      const isFront = lane === visibleCount - 1;
      cards.push({
        id: ev.id,
        day: ev.day,
        hour: ev.hour,
        lane,
        visibleCount,
        cellTotal,
        offsetPx: lane * peekPx,
        shrinkPx: (visibleCount - 1) * peekPx,
        topOffsetPx: 0,
        zIndex: 10 + lane,
        showContent: isFront,
        expanded: false,
      });
    }

    if (cellTotal > maxVisible) {
      const hidden = sorted.slice(maxVisible);
      overflows.push({
        day: sorted[0]!.day,
        hour: sorted[0]!.hour,
        count: cellTotal - maxVisible,
        titles: hidden.map((e) => String(e.title || e.id)),
        ids: hidden.map((e) => e.id),
      });
    }
  }

  return { cards, overflows };
}

/**
 * 拖拽落点：目标格收起牌堆的下一层 peek 槽。
 * 展开格拖入时仍用满宽单卡占位。
 */
export function placeholderPeekLayout<T extends PeekEventLike>(
  events: T[],
  dragged: T,
  day: number,
  hour: number,
  options?: {
    maxVisible?: number;
    peekPx?: number;
    expandedKey?: string | null;
  }
): PeekCardLayout {
  const maxVisible = options?.maxVisible ?? CALENDAR_PEEK.maxVisible;
  const peekPx = options?.peekPx ?? CALENDAR_PEEK.peekPx;
  const expandedKey = options?.expandedKey ?? null;
  const peers = events.filter((e) => e.day === day && e.hour === hour && e.id !== dragged.id);
  const hypothetical = [...peers, { ...dragged, day, hour }];
  const { cards } = layoutPeekStacks(hypothetical, {
    maxVisible,
    peekPx,
    expandedKey,
  });
  const hit = cards.find((c) => c.id === dragged.id);
  if (hit) return hit;

  const visibleCount = maxVisible;
  return {
    id: dragged.id,
    day,
    hour,
    lane: maxVisible - 1,
    visibleCount,
    cellTotal: peers.length + 1,
    offsetPx: (maxVisible - 1) * peekPx,
    shrinkPx: (visibleCount - 1) * peekPx,
    topOffsetPx: 0,
    zIndex: 10 + maxVisible - 1,
    showContent: true,
    expanded: false,
  };
}

/** 引擎用的 left/width calc 片段 */
export function peekPositionCalc(day: number, offsetPx: number, shrinkPx: number): {
  left: string;
  width: string;
} {
  const inset = CALENDAR_PEEK.insetPx;
  const offset = offsetPx > 0 ? ` + ${offsetPx}px` : "";
  const shrink = shrinkPx > 0 ? ` - ${shrinkPx}px` : "";
  return {
    left: `calc(var(--col-time-width) + ${day} * ((100% - var(--col-time-width)) / 7) + ${inset}px${offset})`,
    width: `calc(((100% - var(--col-time-width)) / 7) - ${inset * 2}px${shrink})`,
  };
}
