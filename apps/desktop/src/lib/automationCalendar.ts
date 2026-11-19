import type { AutomationTask, ScheduleKind, ScheduleOverride } from "./automation";

/** 避免拉入 tauri invoke，便于 node:test 直接跑本文件 */
function formatScheduleLabel(task: Pick<AutomationTask, "scheduleKind" | "scheduleExpr">): string {
  if (task.scheduleKind === "interval") {
    const secs = Number(task.scheduleExpr);
    if (!Number.isFinite(secs) || secs <= 0) return `间隔 ${task.scheduleExpr}`;
    if (secs < 60) return `每 ${secs} 秒`;
    if (secs < 3600) return `每 ${Math.round(secs / 60)} 分钟`;
    return `每 ${Math.round(secs / 3600)} 小时`;
  }
  if (task.scheduleKind === "once_at") return `一次 · ${task.scheduleExpr}`;
  const parts = task.scheduleExpr.trim().split(/\s+/);
  if (parts.length === 5) {
    const [minute, hour, , , dow] = parts;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    if (dow === "1-5") return `工作日 ${time}`;
    if (dow === "*") return `每天 ${time}`;
    if (/^\d+$/.test(dow)) return `周${dow} ${time}`;
    return `Cron ${task.scheduleExpr}`;
  }
  return task.scheduleExpr;
}

export type CalendarBoardTheme = "pink" | "green" | "yellow" | "purple" | "blue" | "gray";

export type CalendarBoardEvent = {
  /** 稳定 id：源格 `taskId__day`；例外格 `taskId__ovr__originDate` */
  id: string;
  taskId: string;
  day: number;
  hour: number;
  duration: number;
  title: string;
  subtitle: string;
  theme: CalendarBoardTheme;
  enabled: boolean;
  /**
   * 例外卡片才有：被挪动的那一次绝对日 `YYYY-MM-DD`。
   * 拖拽时带回，避免与同日源格抢同一 origin。
   */
  originDate?: string;
};

const THEMES: CalendarBoardTheme[] = ["blue", "purple", "green", "pink", "yellow", "gray"];

export function themeForTaskId(id: string): CalendarBoardTheme {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return THEMES[hash % THEMES.length];
}

export function startOfWeek(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function inSameWeek(ms: number, weekStart: Date): boolean {
  const start = weekStart.getTime();
  const end = start + 7 * 86400000;
  return ms >= start && ms < end;
}

function parseCronParts(expr: string): { minute: number; hour: number; days: number[] } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  const dow = parts[4];
  const days: number[] = [];
  if (dow === "*") {
    for (let i = 0; i < 7; i += 1) days.push(i);
  } else {
    for (const token of dow.split(",")) {
      if (token.includes("-")) {
        const [a, b] = token.split("-").map(Number);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        for (let i = a; i <= b; i += 1) days.push(((i % 7) + 7) % 7);
      } else {
        const n = Number(token);
        if (Number.isFinite(n)) days.push(((n % 7) + 7) % 7);
      }
    }
  }
  return { minute, hour, days: [...new Set(days)].sort((a, b) => a - b) };
}

function parseOnceAtMs(expr: string): number | null {
  const raw = expr.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return asDate;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  return d.getTime();
}

function clampHour(hour: number, min = 8, max = 20): number {
  return Math.max(min, Math.min(max, hour));
}

function taskMinute(task: AutomationTask): number {
  if (task.scheduleKind === "cron") {
    const parsed = parseCronParts(task.scheduleExpr);
    if (parsed) return parsed.minute;
  }
  if (task.scheduleKind === "once_at") {
    const ms = parseOnceAtMs(task.scheduleExpr);
    if (ms != null) return new Date(ms).getMinutes();
  }
  if (task.nextRunAtMs) return new Date(task.nextRunAtMs).getMinutes();
  return 0;
}

function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function dateForWeekDay(weekAnchor: Date, day: number): Date {
  const weekStart = startOfWeek(weekAnchor);
  const d = new Date(weekStart);
  d.setDate(weekStart.getDate() + (((day % 7) + 7) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function isMultiDayCron(task: AutomationTask): boolean {
  if (task.scheduleKind !== "cron") return false;
  const parsed = parseCronParts(task.scheduleExpr);
  return !!parsed && parsed.days.length > 1;
}

function weekEndExclusive(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 7);
  return end;
}

function parseOriginDate(raw: string): Date | null {
  const d = new Date(`${raw.trim()}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function overrideTargetDate(ovr: ScheduleOverride): Date | null {
  const origin = parseOriginDate(ovr.originDate);
  if (!origin) return null;
  const target = new Date(origin);
  target.setDate(origin.getDate() + ovr.dayOffset);
  target.setHours(0, 0, 0, 0);
  return target;
}

/** 例外是否等于源规则落点（拖回原点 → 应删除例外） */
function overrideMatchesBase(
  ovr: ScheduleOverride,
  baseHour: number,
  baseMinute: number
): boolean {
  return ovr.dayOffset === 0 && ovr.hour === baseHour && ovr.minute === baseMinute;
}

/**
 * 源格 + 例外格并存：
 * - 只去掉被挪走的 origin 源格
 * - 目标日已有同源任务时不覆盖，额外挂一条例外卡
 */
function applyOverridesToEvents(
  events: CalendarBoardEvent[],
  task: AutomationTask,
  weekAnchor: Date,
  baseHour: number,
  baseMinute: number
): CalendarBoardEvent[] {
  const overrides = task.scheduleOverrides ?? [];
  if (!overrides.length) return events;

  const weekStart = startOfWeek(weekAnchor);
  const weekEnd = weekEndExclusive(weekStart);
  const paused = task.enabled ? "" : " · 已暂停";
  const label = formatScheduleLabel(task);

  let list = [...events];

  for (const ovr of overrides) {
    if (overrideMatchesBase(ovr, baseHour, baseMinute)) continue;

    const origin = parseOriginDate(ovr.originDate);
    const target = overrideTargetDate(ovr);
    if (!origin || !target) continue;

    if (origin >= weekStart && origin < weekEnd) {
      const originDay = origin.getDay();
      // 只删源格，不删其它例外卡
      list = list.filter((ev) => !(ev.day === originDay && !ev.originDate));
    }

    if (target >= weekStart && target < weekEnd) {
      const targetDay = target.getDay();
      const ovrId = `${task.id}__ovr__${ovr.originDate}`;
      list = list.filter((ev) => ev.id !== ovrId);
      const template = events[0];
      list.push({
        id: ovrId,
        taskId: task.id,
        day: targetDay,
        hour: clampHour(ovr.hour),
        duration: 1,
        title: template?.title ?? task.title ?? "未命名任务",
        subtitle: `${label} · 例外${paused}`,
        theme: template?.theme ?? themeForTaskId(task.id),
        enabled: task.enabled,
        originDate: ovr.originDate,
      });
    }
  }

  return list.sort((a, b) => a.day - b.day || a.hour - b.hour || a.id.localeCompare(b.id));
}

/**
 * 将自动化任务展开为指定周的日历卡片。
 */
export function tasksToCalendarEvents(
  tasks: AutomationTask[],
  weekAnchor = new Date()
): CalendarBoardEvent[] {
  const weekStart = startOfWeek(weekAnchor);
  const out: CalendarBoardEvent[] = [];

  for (const task of tasks) {
    const theme = themeForTaskId(task.id);
    const subtitle = `${formatScheduleLabel(task)}${task.enabled ? "" : " · 已暂停"}`;
    const base = {
      taskId: task.id,
      title: task.title || "未命名任务",
      subtitle,
      theme,
      enabled: task.enabled,
      duration: 1 as const,
    };

    if (task.scheduleKind === "cron") {
      const parsed = parseCronParts(task.scheduleExpr);
      if (!parsed) continue;
      const hour = clampHour(parsed.hour);
      const expanded: CalendarBoardEvent[] = parsed.days.map((day) => ({
        ...base,
        id: `${task.id}__${day}`,
        day,
        hour,
      }));
      out.push(...applyOverridesToEvents(expanded, task, weekAnchor, hour, parsed.minute));
      continue;
    }

    if (task.scheduleKind === "once_at") {
      const ms = parseOnceAtMs(task.scheduleExpr);
      if (ms == null || !inSameWeek(ms, weekStart)) continue;
      const d = new Date(ms);
      out.push({
        ...base,
        id: `${task.id}__${d.getDay()}`,
        day: d.getDay(),
        hour: clampHour(d.getHours()),
      });
      continue;
    }

    const ms = task.nextRunAtMs;
    if (ms != null && inSameWeek(ms, weekStart)) {
      const d = new Date(ms);
      out.push({
        ...base,
        id: `${task.id}__${d.getDay()}`,
        day: d.getDay(),
        hour: clampHour(d.getHours()),
      });
    }
  }

  return out;
}

export function formatWeekLabel(weekAnchor: Date): string {
  const start = startOfWeek(weekAnchor);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月 ${start.getDate()}–${end.getDate()}日`;
  }
  return `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
}

export type RescheduleResult =
  | {
      mode: "override";
      scheduleOverrides: ScheduleOverride[];
    }
  | {
      mode: "source";
      scheduleKind: ScheduleKind;
      scheduleExpr: string;
      scheduleOverrides: ScheduleOverride[];
    };

/**
 * 日历拖放：
 * - 多日 cron → 写/更新/删除补充例外，不改源 scheduleExpr
 * - 拖回源日源时 → 删除该 origin 例外（卡片恢复，不会消失）
 * - 单日 / once_at / interval → 直接改源日程
 *
 * @param dragOriginDate 若拖的是例外卡，传入其 originDate，避免与同日源格混淆
 */
export function rescheduleOccurrence(
  task: AutomationTask,
  day: number,
  hour: number,
  weekAnchor = new Date(),
  originDay: number | null = null,
  dragOriginDate: string | null = null
): RescheduleResult {
  const minute = taskMinute(task);
  const safeDay = ((day % 7) + 7) % 7;
  const safeHour = clampHour(hour);
  const fromDay = originDay == null ? safeDay : ((originDay % 7) + 7) % 7;

  if (task.scheduleKind === "once_at") {
    const weekStart = startOfWeek(weekAnchor);
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + safeDay);
    date.setHours(safeHour, minute, 0, 0);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return {
      mode: "source",
      scheduleKind: "once_at",
      scheduleExpr: `${yyyy}-${mm}-${dd}T${hh}:${mi}`,
      scheduleOverrides: [],
    };
  }

  if (task.scheduleKind === "interval" || !isMultiDayCron(task)) {
    return {
      mode: "source",
      scheduleKind: "cron",
      scheduleExpr: `${minute} ${safeHour} * * ${safeDay}`,
      scheduleOverrides: [],
    };
  }

  const parsed = parseCronParts(task.scheduleExpr);
  const baseHour = parsed ? clampHour(parsed.hour) : safeHour;
  const baseMinute = parsed?.minute ?? minute;

  const weekStart = startOfWeek(weekAnchor);
  const weekEnd = weekEndExclusive(weekStart);
  const existingList = task.scheduleOverrides ?? [];

  let originDate = dragOriginDate?.trim() || "";
  if (!originDate) {
    const byTarget = existingList.find((ovr) => {
      const target = overrideTargetDate(ovr);
      return !!target && target >= weekStart && target < weekEnd && target.getDay() === fromDay;
    });
    // 只有「拖的是例外落点、且当天没有同源源格」时才沿用 byTarget；
    // 同日并存时若未带 dragOriginDate，默认当作拖源格（新建/更新该日 origin）。
    const hasBaseOnFromDay = parsed?.days.includes(fromDay) ?? false;
    const baseStillVisible =
      hasBaseOnFromDay &&
      !existingList.some((ovr) => {
        const origin = parseOriginDate(ovr.originDate);
        return (
          !!origin &&
          origin >= weekStart &&
          origin < weekEnd &&
          origin.getDay() === fromDay &&
          !overrideMatchesBase(ovr, baseHour, baseMinute)
        );
      });
    if (byTarget && !baseStillVisible) {
      originDate = byTarget.originDate;
    } else {
      originDate = formatLocalDate(dateForWeekDay(weekAnchor, fromDay));
    }
  }

  const origin = parseOriginDate(originDate) ?? dateForWeekDay(weekAnchor, fromDay);
  const target = dateForWeekDay(weekAnchor, safeDay);
  const offset = Math.round((target.getTime() - origin.getTime()) / 86400000);

  const next: ScheduleOverride = {
    originDate: formatLocalDate(origin),
    dayOffset: offset,
    hour: safeHour,
    minute: baseMinute,
  };

  const prev = existingList.filter((o) => o.originDate !== next.originDate);

  // 拖回源日 + 源时刻 → 删除例外，恢复源格
  if (overrideMatchesBase(next, baseHour, baseMinute)) {
    return { mode: "override", scheduleOverrides: prev };
  }

  return {
    mode: "override",
    scheduleOverrides: [...prev, next],
  };
}

/** @deprecated 使用 rescheduleOccurrence */
export function rescheduleTaskToSlot(
  task: AutomationTask,
  day: number,
  hour: number,
  weekAnchor = new Date(),
  originDay: number | null = null
): { scheduleKind: ScheduleKind; scheduleExpr: string } {
  const result = rescheduleOccurrence(task, day, hour, weekAnchor, originDay);
  if (result.mode === "source") {
    return { scheduleKind: result.scheduleKind, scheduleExpr: result.scheduleExpr };
  }
  return { scheduleKind: task.scheduleKind, scheduleExpr: task.scheduleExpr };
}
