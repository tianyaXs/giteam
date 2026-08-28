import { invoke } from "@tauri-apps/api/core";

export type SessionMode = "new" | "existing";
export type ScheduleKind = "cron" | "interval" | "once_at";
export type TaskFilter = "all" | "enabled" | "paused";
export type RunStatus = "queued" | "running" | "success" | "failure" | "skipped" | "cancelled";
export type RunTrigger = "schedule" | "manual" | "event";

export type NotifyChannel = "desktop" | "dingtalk";

export type AutomationTask = {
  id: string;
  title: string;
  goalPrompt: string;
  repoPath: string;
  sessionMode: SessionMode;
  sessionId?: string | null;
  provider?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  scheduleKind: ScheduleKind;
  scheduleExpr: string;
  timezone: string;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyChannel: NotifyChannel;
  dingtalkWebhookUrl?: string | null;
  dingtalkSignSecret?: string | null;
  enabled: boolean;
  nextRunAtMs?: number | null;
  lastRunAtMs?: number | null;
  lastViewedRunAtMs?: number | null;
  lastStatus?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AutomationRun = {
  id: string;
  taskId: string;
  status: RunStatus;
  trigger: RunTrigger;
  sessionId?: string | null;
  repoPath: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  errorMessage?: string | null;
  summary?: string | null;
};

export type TaskWithRuns = AutomationTask & {
  recentRuns: AutomationRun[];
};

export type CreateTaskInput = {
  title: string;
  goalPrompt: string;
  repoPath: string;
  sessionMode: SessionMode;
  sessionId?: string | null;
  provider?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  scheduleKind: ScheduleKind;
  scheduleExpr: string;
  timezone?: string;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  notifyChannel?: NotifyChannel;
  dingtalkWebhookUrl?: string | null;
  dingtalkSignSecret?: string | null;
  enabled?: boolean;
};

export type UpdateTaskInput = {
  id: string;
  title?: string;
  goalPrompt?: string;
  repoPath?: string;
  sessionMode?: SessionMode;
  sessionId?: string | null;
  provider?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  scheduleKind?: ScheduleKind;
  scheduleExpr?: string;
  timezone?: string;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  notifyChannel?: NotifyChannel;
  dingtalkWebhookUrl?: string | null;
  dingtalkSignSecret?: string | null;
};

export const AUTOMATION_SUGGESTIONS: Array<{
  title: string;
  goalPrompt: string;
  scheduleKind: ScheduleKind;
  scheduleExpr: string;
  summary: string;
}> = [
  {
    title: "每日简报",
    goalPrompt: "每个工作日开始时，总结日历、未读邮件与优先事项。",
    scheduleKind: "cron",
    scheduleExpr: "0 8 * * 1-5",
    summary: "工作日 8:00",
  },
  {
    title: "每周回顾",
    goalPrompt: "每周五把近期工作整理成简洁的状态更新。",
    scheduleKind: "cron",
    scheduleExpr: "0 16 * * 5",
    summary: "星期五 16:00",
  },
  {
    title: "跟进监测",
    goalPrompt: "检查近期邮件与日历活动，标出需要关注的事项。",
    scheduleKind: "cron",
    scheduleExpr: "0 9 * * 1-5",
    summary: "工作日 9:00",
  },
];

export async function listAutomationTasks(filter: TaskFilter = "all", repoPath?: string): Promise<AutomationTask[]> {
  return invoke<AutomationTask[]>("automation_list_tasks", {
    request: { filter, repoPath: repoPath || null },
  });
}

export async function getAutomationTask(id: string): Promise<TaskWithRuns> {
  return invoke<TaskWithRuns>("automation_get_task", { id });
}

export async function createAutomationTask(input: CreateTaskInput): Promise<AutomationTask> {
  return invoke<AutomationTask>("automation_create_task", { request: input });
}

export async function updateAutomationTask(input: UpdateTaskInput): Promise<AutomationTask> {
  return invoke<AutomationTask>("automation_update_task", { request: input });
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationTask> {
  return invoke<AutomationTask>("automation_set_enabled", { id, enabled });
}

export async function deleteAutomationTask(id: string): Promise<void> {
  await invoke("automation_delete_task", { id });
}

export async function listAutomationRuns(taskId: string, limit = 20): Promise<AutomationRun[]> {
  return invoke<AutomationRun[]>("automation_list_runs", { taskId, limit });
}

export async function runAutomationNow(id: string): Promise<{
  run: AutomationRun;
  task: AutomationTask;
  notifyError?: string | null;
}> {
  return invoke("automation_run_now", { id });
}

export async function testAutomationDingTalkNotify(input: {
  webhookUrl: string;
  signSecret?: string;
  content?: string;
}): Promise<{ ok: boolean; errcode: number; errmsg: string }> {
  return invoke("automation_test_dingtalk_notify", { request: input });
}

export function formatScheduleLabel(task: Pick<AutomationTask, "scheduleKind" | "scheduleExpr">): string {
  if (task.scheduleKind === "interval") {
    const secs = Number(task.scheduleExpr);
    if (!Number.isFinite(secs) || secs <= 0) return `间隔 ${task.scheduleExpr}`;
    if (secs < 60) return `每 ${secs} 秒`;
    if (secs < 3600) return `每 ${Math.round(secs / 60)} 分钟`;
    if (secs % 86400 === 0) return `每 ${secs / 86400} 天`;
    return `每 ${Math.round(secs / 3600)} 小时`;
  }
  if (task.scheduleKind === "once_at") {
    return `一次 · ${task.scheduleExpr}`;
  }
  const parts = task.scheduleExpr.trim().split(/\s+/);
  if (parts.length === 5) {
    const [minute, hour, , , dow] = parts;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    if (dow === "1-5") return `工作日 ${time}`;
    if (dow === "*") return `每天 ${time}`;
    if (dow === "5") return `周五 ${time}`;
    return `Cron ${task.scheduleExpr}`;
  }
  return task.scheduleExpr;
}

/** 是否有尚未在详情页确认的运行结果（列表蓝点）。 */
export function hasUnreadAutomationRun(
  task: Pick<AutomationTask, "lastRunAtMs" | "lastViewedRunAtMs" | "lastStatus">
): boolean {
  const lastRun = task.lastRunAtMs;
  if (!lastRun) return false;
  const status = task.lastStatus || "";
  if (status === "running" || status === "queued") return false;
  return lastRun > (task.lastViewedRunAtMs ?? 0);
}

export function formatRelativeMs(ms?: number | null): string {
  if (!ms) return "—";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const suffix = diff >= 0 ? "后" : "前";
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟${suffix}`;
  if (hours < 48) return `${hours} 小时${suffix}`;
  return `${days} 天${suffix}`;
}
