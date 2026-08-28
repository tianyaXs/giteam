import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  FileText,
  LoaderCircle,
  Megaphone,
  Pause,
  Play,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../../lib/utils";
import type { AgentModelInfo } from "../../lib/agent/client";
import {
  clampThinkingLevelToModel,
  normalizeThinkingLevel,
  thinkingLevelMeta,
  thinkingLevelsForModel,
  type AgentThinkingLevel,
} from "../../lib/agentComposerSettings";
import type { RepositoryEntry } from "../../lib/types";
import type { AgentChatSession } from "../../lib/agentSessions";
import {
  AUTOMATION_SUGGESTIONS,
  createAutomationTask,
  deleteAutomationTask,
  formatRelativeMs,
  formatScheduleLabel,
  getAutomationTask,
  hasUnreadAutomationRun,
  listAutomationTasks,
  runAutomationNow,
  setAutomationEnabled,
  testAutomationDingTalkNotify,
  updateAutomationTask,
  type AutomationRun,
  type AutomationTask,
  type CreateTaskInput,
  type ScheduleKind,
  type SessionMode,
  type TaskFilter,
} from "../../lib/automation";

type ModelOption = { ref: string; label: string; provider: string; modelId: string };

type Props = {
  repos: RepositoryEntry[];
  getRepoSessions: (repoId: string) => AgentChatSession[];
  ensureRepoSessions: (repo: RepositoryEntry) => void;
  onOpenImportProject: () => void;
  modelOptions?: ModelOption[];
  modelInfoByRef?: Record<string, AgentModelInfo>;
};

type SchedulePreset = "interval" | "daily" | "weekdays" | "weekly" | "custom";
type CustomUnit = "day" | "week";
type NotifyLevel = "all" | "important";
type NotifyChannelOption = "none" | "desktop" | "dingtalk";

type DraftForm = {
  title: string;
  goalPrompt: string;
  repoPath: string;
  sessionMode: SessionMode;
  sessionId: string;
  /** provider/modelId；空=默认模型 */
  modelRef: string;
  /** 推理强度；auto=默认 */
  thinkingLevel: AgentThinkingLevel;
  schedulePreset: SchedulePreset;
  time: string;
  intervalMinutes: string;
  /** 自定义：重复单位 */
  customUnit: CustomUnit;
  /** 自定义：每隔 N 个单位 */
  customEvery: string;
  /** 自定义：开启的星期（0=日 … 6=六） */
  customDays: number[];
  notifyChannelOption: NotifyChannelOption;
  notifyLevel: NotifyLevel;
  dingtalkWebhookUrl: string;
  dingtalkSignSecret: string;
  enabled: boolean;
};

const WEEKDAY_OPTIONS: Array<{ value: number; short: string; label: string }> = [
  { value: 1, short: "一", label: "周一" },
  { value: 2, short: "二", label: "周二" },
  { value: 3, short: "三", label: "周三" },
  { value: 4, short: "四", label: "周四" },
  { value: 5, short: "五", label: "周五" },
  { value: 6, short: "六", label: "周六" },
  { value: 0, short: "日", label: "周日" },
];

const EMPTY_DRAFT: DraftForm = {
  title: "",
  goalPrompt: "",
  repoPath: "",
  sessionMode: "new",
  sessionId: "",
  modelRef: "",
  thinkingLevel: "auto",
  schedulePreset: "daily",
  time: "09:00",
  intervalMinutes: "60",
  customUnit: "week",
  customEvery: "1",
  customDays: [1, 2, 3, 4, 5, 6, 0],
  notifyChannelOption: "desktop",
  notifyLevel: "all",
  dingtalkWebhookUrl: "",
  dingtalkSignSecret: "",
  enabled: true,
};

const SUGGESTION_ICONS = [Megaphone, FileText, Search] as const;

const PANEL_SPRING = { type: "spring" as const, stiffness: 380, damping: 36 };
const LIST_FADE = { duration: 0.22, ease: "easeOut" as const };
/** Codex 风格深色胶囊主按钮 */
const CODEX_PILL_BTN =
  "h-8 gap-1 rounded-full border-0 bg-foreground px-3.5 text-sm font-normal text-background shadow-none hover:bg-foreground/90";

function parseModelRef(ref: string): { provider: string | null; model: string | null } {
  const trimmed = ref.trim();
  if (!trimmed) return { provider: null, model: null };
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { provider: trimmed, model: null };
  return {
    provider: trimmed.slice(0, slash) || null,
    model: trimmed.slice(slash + 1) || null,
  };
}

function toStoredThinkingLevel(level: AgentThinkingLevel): string | null {
  const normalized = normalizeThinkingLevel(level);
  if (normalized === "auto") return null;
  if (normalized === "off" || normalized === "none") return "off";
  if (normalized === "max") return "xhigh";
  return normalized;
}

function draftToInput(draft: DraftForm): CreateTaskInput {
  const { scheduleKind, scheduleExpr } = resolveSchedule(draft);
  const { provider, model } = parseModelRef(draft.modelRef);
  const piThinking = toStoredThinkingLevel(draft.thinkingLevel);
  const notifyOnSuccess =
    draft.notifyChannelOption !== "none" &&
    (draft.notifyLevel === "all" || draft.notifyChannelOption === "dingtalk");
  const notifyOnFailure =
    draft.notifyChannelOption !== "none" &&
    (draft.notifyLevel === "all" || draft.notifyLevel === "important");
  return {
    title: draft.title.trim(),
    goalPrompt: draft.goalPrompt.trim(),
    repoPath: draft.repoPath,
    sessionMode: draft.sessionMode,
    sessionId: draft.sessionMode === "existing" ? draft.sessionId : null,
    provider,
    model,
    thinkingLevel: piThinking,
    scheduleKind,
    scheduleExpr,
    timezone: "local",
    notifyOnSuccess,
    notifyOnFailure,
    notifyChannel: draft.notifyChannelOption === "dingtalk" ? "dingtalk" : "desktop",
    dingtalkWebhookUrl:
      draft.notifyChannelOption === "dingtalk" ? draft.dingtalkWebhookUrl.trim() || null : null,
    dingtalkSignSecret:
      draft.notifyChannelOption === "dingtalk" ? draft.dingtalkSignSecret.trim() || null : null,
    enabled: draft.enabled,
  };
}

function resolveSchedule(draft: DraftForm): { scheduleKind: ScheduleKind; scheduleExpr: string } {
  const [hRaw, mRaw] = draft.time.split(":");
  const hour = Number(hRaw) || 0;
  const minute = Number(mRaw) || 0;
  switch (draft.schedulePreset) {
    case "daily":
      return { scheduleKind: "cron", scheduleExpr: `${minute} ${hour} * * *` };
    case "weekdays":
      return { scheduleKind: "cron", scheduleExpr: `${minute} ${hour} * * 1-5` };
    case "weekly":
      return { scheduleKind: "cron", scheduleExpr: `${minute} ${hour} * * 5` };
    case "interval": {
      const mins = Math.max(1, Number(draft.intervalMinutes) || 60);
      return { scheduleKind: "interval", scheduleExpr: String(mins * 60) };
    }
    case "custom": {
      const days = [...draft.customDays].sort((a, b) => a - b);
      const dow = days.length === 0 || days.length === 7 ? "*" : days.join(",");
      // 每隔 N 周：MVP 用 cron 周字段表达「开启的天」；every>1 时仍按所选天每周触发（完整 N 周间隔进阶段 2）
      return { scheduleKind: "cron", scheduleExpr: `${minute} ${hour} * * ${dow}` };
    }
    default:
      return { scheduleKind: "cron", scheduleExpr: `${minute} ${hour} * * *` };
  }
}

function taskToDraft(task: AutomationTask): DraftForm {
  let schedulePreset: SchedulePreset = "custom";
  let time = "09:00";
  let intervalMinutes = "60";
  let customDays = [1, 2, 3, 4, 5, 6, 0];
  let customUnit: CustomUnit = "week";

  if (task.scheduleKind === "interval") {
    schedulePreset = "interval";
    intervalMinutes = String(Math.max(1, Math.round(Number(task.scheduleExpr) / 60) || 60));
  } else if (task.scheduleKind === "cron") {
    const parts = task.scheduleExpr.trim().split(/\s+/);
    if (parts.length === 5) {
      const [minute, hour, , , dow] = parts;
      time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
      if (dow === "*") schedulePreset = "daily";
      else if (dow === "1-5") schedulePreset = "weekdays";
      else if (dow === "5") schedulePreset = "weekly";
      else {
        schedulePreset = "custom";
        customUnit = "week";
        customDays = dow
          .split(",")
          .flatMap((token) => {
            if (token.includes("-")) {
              const [a, b] = token.split("-").map(Number);
              const out: number[] = [];
              for (let i = a; i <= b; i += 1) out.push(i);
              return out;
            }
            const n = Number(token);
            return Number.isFinite(n) ? [n] : [];
          });
        if (customDays.length === 0) customDays = [1, 2, 3, 4, 5, 6, 0];
      }
    }
  }

  let notifyChannelOption: NotifyChannelOption = "desktop";
  if (!task.notifyOnSuccess && !task.notifyOnFailure) {
    notifyChannelOption = "none";
  } else if (task.notifyChannel === "dingtalk") {
    notifyChannelOption = "dingtalk";
  }
  let notifyLevel: NotifyLevel = "important";
  if (task.notifyOnSuccess && task.notifyOnFailure) notifyLevel = "all";

  const provider = (task.provider || "").trim();
  const model = (task.model || "").trim();
  const modelRef = provider && model ? `${provider}/${model}` : provider || model || "";

  return {
    title: task.title,
    goalPrompt: task.goalPrompt,
    repoPath: task.repoPath,
    sessionMode: task.sessionMode,
    sessionId: task.sessionId || "",
    modelRef,
    thinkingLevel: normalizeThinkingLevel(task.thinkingLevel || "auto"),
    schedulePreset,
    time,
    intervalMinutes,
    customUnit,
    customEvery: "1",
    customDays,
    notifyChannelOption,
    notifyLevel,
    dingtalkWebhookUrl: task.dingtalkWebhookUrl || "",
    dingtalkSignSecret: task.dingtalkSignSecret || "",
    enabled: task.enabled,
  };
}

function formatDaysLabel(days: number[]): string {
  if (days.length === 7) return "周一、周二、周三、周四、周五、周六和周日";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
    return "周一至周五";
  }
  const labels = WEEKDAY_OPTIONS.filter((d) => days.includes(d.value)).map((d) => d.label);
  if (labels.length === 0) return "未选择";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join("、")}和${labels[labels.length - 1]}`;
}

function scheduleNeedsTime(preset: SchedulePreset): boolean {
  return preset !== "interval";
}

/** 完整且合法的 HH:MM（00:00–23:59）。 */
function isValidTimeValue(raw: string): boolean {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function normalizeTimeValue(raw: string): string | null {
  if (!isValidTimeValue(raw)) return null;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/)!;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function canSubmit(draft: DraftForm, reposEmpty: boolean): boolean {
  if (reposEmpty) return false;
  if (!draft.title.trim() || !draft.goalPrompt.trim() || !draft.repoPath.trim()) return false;
  if (draft.sessionMode === "existing" && !draft.sessionId.trim()) return false;
  if (draft.schedulePreset === "custom" && draft.customDays.length === 0) return false;
  if (scheduleNeedsTime(draft.schedulePreset) && !isValidTimeValue(draft.time)) return false;
  if (draft.notifyChannelOption === "dingtalk" && !draft.dingtalkWebhookUrl.trim()) {
    return false;
  }
  return true;
}

function isTerminalAutomationStatus(status?: string | null): boolean {
  return (
    status === "success" ||
    status === "failure" ||
    status === "skipped" ||
    status === "cancelled"
  );
}

export function AutomationView(props: Props) {
  const {
    repos,
    getRepoSessions,
    ensureRepoSessions,
    onOpenImportProject,
    modelOptions = [],
    modelInfoByRef = {},
  } = props;
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [saving, setSaving] = useState(false);
  const [dingtalkTestBusy, setDingtalkTestBusy] = useState(false);
  const [dingtalkTestNotice, setDingtalkTestNotice] = useState("");
  const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());
  /** 本地触发立即运行的时间戳；用于 DB 尚未写入 running 前保持列表状态 */
  const pendingRunStartedAtRef = useRef<Map<string, number>>(new Map());

  const showForm = creating || Boolean(selectedId);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const list = await listAutomationTasks(filter);
      setTasks(list);
      setRunningIds(() => {
        const next = new Set<string>();
        for (const task of list) {
          if (task.lastStatus === "running") next.add(task.id);
        }
        for (const [id, startedAt] of pendingRunStartedAtRef.current) {
          const task = list.find((t) => t.id === id);
          if (!task) {
            pendingRunStartedAtRef.current.delete(id);
            continue;
          }
          if (task.lastStatus === "running") {
            next.add(id);
            continue;
          }
          if (
            isTerminalAutomationStatus(task.lastStatus) &&
            task.lastRunAtMs != null &&
            task.lastRunAtMs >= startedAt
          ) {
            pendingRunStartedAtRef.current.delete(id);
            continue;
          }
          next.add(id);
        }
        return next;
      });
    } catch (e) {
      if (!silent) setError(String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 打开视图时轮询，同步调度器触发的 running
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.goalPrompt.toLowerCase().includes(q) ||
        t.repoPath.toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const selectedRepo = useMemo(
    () => repos.find((r) => normalizePath(r.path) === normalizePath(draft.repoPath)) || null,
    [repos, draft.repoPath]
  );

  useEffect(() => {
    if (selectedRepo) ensureRepoSessions(selectedRepo);
  }, [selectedRepo, ensureRepoSessions]);

  const sessions = selectedRepo ? getRepoSessions(selectedRepo.id) : [];

  const modelDisplay = useMemo(() => {
    if (!draft.modelRef) return "默认模型";
    return modelOptions.find((m) => m.ref === draft.modelRef)?.label || draft.modelRef;
  }, [draft.modelRef, modelOptions]);

  const modelSelectOptions = useMemo(
    () => [
      { value: "", label: "默认模型" },
      ...modelOptions.map((m) => ({ value: m.ref, label: m.label })),
    ],
    [modelOptions]
  );

  const selectedModelInfo = useMemo(
    () => (draft.modelRef ? modelInfoByRef[draft.modelRef] || null : null),
    [draft.modelRef, modelInfoByRef]
  );

  const thinkingLevelOptions = useMemo(
    () => thinkingLevelsForModel(selectedModelInfo),
    [selectedModelInfo]
  );

  const thinkingDisplay = useMemo(
    () => thinkingLevelMeta(draft.thinkingLevel).label,
    [draft.thinkingLevel]
  );

  const thinkingSelectOptions = useMemo(
    () =>
      thinkingLevelOptions.map((level) => ({
        value: level,
        label: thinkingLevelMeta(level).label,
      })),
    [thinkingLevelOptions]
  );

  useEffect(() => {
    setDraft((d) => {
      const info = d.modelRef ? modelInfoByRef[d.modelRef] || null : null;
      const clamped = clampThinkingLevelToModel(d.thinkingLevel, info);
      if (clamped === d.thinkingLevel) return d;
      return { ...d, thinkingLevel: clamped };
    });
  }, [draft.modelRef, modelInfoByRef]);

  async function openTask(id: string) {
    setCreating(false);
    setSelectedId(id);
    setError("");
    try {
      const detail = await getAutomationTask(id);
      setDraft(taskToDraft(detail));
      setRuns(detail.recentRuns || []);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                lastViewedRunAtMs:
                  detail.lastViewedRunAtMs ?? detail.lastRunAtMs ?? t.lastViewedRunAtMs,
              }
            : t
        )
      );
    } catch (e) {
      setError(String(e));
    }
  }

  function startCreate(partial?: Partial<DraftForm>) {
    setCreating(true);
    setSelectedId(null);
    setRuns([]);
    setError("");
    setDraft({
      ...EMPTY_DRAFT,
      repoPath: repos[0]?.path || "",
      ...partial,
    });
  }

  function closeForm() {
    setCreating(false);
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setRuns([]);
    setError("");
  }

  async function handleSave() {
    if (!canSubmit(draft, repos.length === 0)) {
      if (repos.length === 0) setError("请先导入项目");
      else if (!draft.repoPath.trim()) setError("请选择项目（自动化任务必须绑定工作空间）");
      else if (!draft.title.trim() || !draft.goalPrompt.trim()) setError("请填写标题与目标");
      else if (draft.sessionMode === "existing" && !draft.sessionId.trim()) setError("请选择已有会话");
      else if (scheduleNeedsTime(draft.schedulePreset) && !isValidTimeValue(draft.time)) {
        setError("请输入合法时间（00:00–23:59）");
      }
      else if (draft.notifyChannelOption === "dingtalk" && !draft.dingtalkWebhookUrl.trim()) {
        setError("钉钉通知需填写 Webhook URL");
      }
      else setError("请完善表单");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input = draftToInput(draft);
      if (creating || !selectedId) {
        await createAutomationTask(input);
        await refresh();
        closeForm();
      } else {
        await updateAutomationTask({ id: selectedId, ...input });
        await refresh();
        await openTask(selectedId);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestDingTalk() {
    const webhook = draft.dingtalkWebhookUrl.trim();
    if (!webhook) {
      setDingtalkTestNotice("");
      setError("请先填写 Webhook URL");
      return;
    }
    setDingtalkTestBusy(true);
    setDingtalkTestNotice("");
    setError("");
    try {
      await testAutomationDingTalkNotify({
        webhookUrl: webhook,
        signSecret: draft.dingtalkSignSecret.trim() || undefined,
      });
      setDingtalkTestNotice("测试消息已发送");
    } catch (e) {
      setError(String(e));
    } finally {
      setDingtalkTestBusy(false);
    }
  }

  async function handleToggleEnabled(task: AutomationTask) {
    try {
      await setAutomationEnabled(task.id, !task.enabled);
      await refresh();
      if (selectedId === task.id) await openTask(task.id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    try {
      await deleteAutomationTask(selectedId);
      closeForm();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRunNow() {
    if (!selectedId) return;
    const id = selectedId;
    const startedAt = Date.now();
    pendingRunStartedAtRef.current.set(id, startedAt);
    setRunningIds((prev) => new Set(prev).add(id));
    setError("");
    try {
      if (!creating && canSubmit(draft, repos.length === 0)) {
        await updateAutomationTask({ id, ...draftToInput(draft) });
      }
      const result = await runAutomationNow(id);
      if (result.notifyError) {
        setError(`任务已完成，但通知发送失败：${result.notifyError}`);
      }
      await refresh({ silent: true });
      await openTask(id);
    } catch (e) {
      pendingRunStartedAtRef.current.delete(id);
      setError(String(e));
    } finally {
      await refresh({ silent: true });
    }
  }

  function applySuggestion(item: (typeof AUTOMATION_SUGGESTIONS)[number]) {
    const parts = item.scheduleExpr.trim().split(/\s+/);
    const minute = parts[0] || "0";
    const hour = parts[1] || "9";
    const dow = parts[4] || "1-5";
    let schedulePreset: SchedulePreset = "weekdays";
    if (dow === "*") schedulePreset = "daily";
    else if (dow === "5") schedulePreset = "weekly";
    else if (dow === "1-5") schedulePreset = "weekdays";
    startCreate({
      title: item.title,
      goalPrompt: item.goalPrompt,
      schedulePreset,
      time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
    });
  }

  const listPane = (
    <TaskListPane
      compact={showForm}
      filter={filter}
      search={search}
      loading={loading}
      visibleTasks={visibleTasks}
      selectedId={creating ? null : selectedId}
      creating={creating}
      reposEmpty={repos.length === 0}
      runningIds={runningIds}
      onFilterChange={setFilter}
      onSearchChange={setSearch}
      onCreate={() => (repos.length === 0 ? onOpenImportProject() : startCreate())}
      onOpenTask={(id) => void openTask(id)}
      onSuggestion={applySuggestion}
    />
  );

  return (
    <div className="relative z-[1] flex h-full min-h-0 w-full overflow-hidden bg-background pointer-events-auto">
      {/* 顶部透明拖拽带：不拆标题栏，避免影响页面大标题排版 */}
      <div
        className="pointer-events-auto absolute inset-x-0 top-0 z-10 h-8"
        data-tauri-drag-region
        aria-hidden="true"
      />
      <motion.div
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          showForm && "shrink-0 border-r border-border"
        )}
        initial={false}
        animate={{ width: showForm ? "min(380px, 40%)" : "100%" }}
        transition={PANEL_SPRING}
      >
        {!showForm ? (
          <motion.div
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            {error ? (
              <div className="mx-6 mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {listPane}
          </motion.div>
        ) : (
          <motion.div
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            initial={{ opacity: 0.92, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={LIST_FADE}
          >
            {listPane}
          </motion.div>
        )}
      </motion.div>

      <AnimatePresence mode="popLayout">
        {showForm ? (
          <motion.div
            key="automation-form-panel"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={PANEL_SPRING}
          >
            <div className="flex items-center gap-3 px-5 py-3" data-tauri-drag-region>
              <div className="text-sm font-medium text-muted-foreground">
                {creating ? "新建" : draft.enabled ? "已开启" : "已暂停"}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
              {error ? (
                <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <Input
                className="mb-2 h-10 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="已安排任务标题"
              />
              <Textarea
                className="mb-5 min-h-[100px] resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                value={draft.goalPrompt}
                onChange={(e) => setDraft((d) => ({ ...d, goalPrompt: e.target.value }))}
                placeholder="描述 Agent 应该做什么"
              />

              <SectionLabel>详情</SectionLabel>
              <div className="mb-5 overflow-visible rounded-xl border border-border/70">
                <OptionRow
                  label="运行于"
                  value={draft.sessionMode}
                  display={draft.sessionMode === "new" ? "新会话" : "已有会话"}
                  options={[
                    { value: "new", label: "新会话" },
                    { value: "existing", label: "已有会话" },
                  ]}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      sessionMode: v as SessionMode,
                      sessionId: v === "new" ? "" : d.sessionId,
                    }))
                  }
                />
                <OptionRow
                  label="项目"
                  value={draft.repoPath}
                  display={
                    repos.find((r) => normalizePath(r.path) === normalizePath(draft.repoPath))?.name ||
                    "选择项目…"
                  }
                  options={[
                    { value: "", label: "选择项目…" },
                    ...repos.map((repo) => ({ value: repo.path, label: repo.name })),
                  ]}
                  onChange={(v) => setDraft((d) => ({ ...d, repoPath: v, sessionId: "" }))}
                />
                {draft.sessionMode === "existing" ? (
                  <OptionRow
                    label="会话"
                    value={draft.sessionId}
                    display={
                      sessions.find((s) => s.id === draft.sessionId)?.title ||
                      (draft.sessionId ? draft.sessionId : "选择会话…")
                    }
                    disabled={!selectedRepo}
                    options={[
                      { value: "", label: "选择会话…" },
                      ...sessions.map((s) => ({ value: s.id, label: s.title || s.id })),
                    ]}
                    onChange={(v) => setDraft((d) => ({ ...d, sessionId: v }))}
                  />
                ) : null}
                <OptionRow
                  label="模型"
                  value={draft.modelRef}
                  display={modelDisplay}
                  options={modelSelectOptions}
                  onChange={(v) => setDraft((d) => ({ ...d, modelRef: v }))}
                />
                <OptionRow
                  label="推理"
                  last
                  value={draft.thinkingLevel}
                  display={thinkingDisplay}
                  options={thinkingSelectOptions}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      thinkingLevel: normalizeThinkingLevel(v) as AgentThinkingLevel,
                    }))
                  }
                />
              </div>

              <SectionLabel>频率</SectionLabel>
              <div className="mb-5 overflow-visible rounded-xl border border-border/70">
                <OptionRow
                  label="重复"
                  value={draft.schedulePreset}
                  display={
                    (
                      {
                        interval: "间隔",
                        daily: "每天",
                        weekdays: "工作日",
                        weekly: "每周",
                        custom: "自定义",
                      } as const
                    )[draft.schedulePreset]
                  }
                  options={[
                    { value: "interval", label: "间隔" },
                    { value: "daily", label: "每天" },
                    { value: "weekdays", label: "工作日" },
                    { value: "weekly", label: "每周" },
                    { value: "custom", label: "自定义" },
                  ]}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      schedulePreset: v as SchedulePreset,
                      customDays:
                        v === "custom" && d.customDays.length === 0
                          ? [1, 2, 3, 4, 5, 6, 0]
                          : d.customDays,
                    }))
                  }
                />

                {draft.schedulePreset === "interval" ? (
                  <NumberSettingRow
                    label="每隔"
                    value={draft.intervalMinutes}
                    suffix="分钟"
                    onChange={(v) => setDraft((d) => ({ ...d, intervalMinutes: v }))}
                  />
                ) : null}

                {draft.schedulePreset === "custom" ? (
                  <>
                    <OptionRow
                      label="重复"
                      value={draft.customUnit}
                      display={draft.customUnit === "week" ? "每周" : "每天"}
                      options={[
                        { value: "day", label: "每天" },
                        { value: "week", label: "每周" },
                      ]}
                      onChange={(v) => setDraft((d) => ({ ...d, customUnit: v as CustomUnit }))}
                    />
                    <NumberSettingRow
                      label="每隔"
                      value={draft.customEvery}
                      suffix={draft.customUnit === "week" ? "周" : "天"}
                      onChange={(v) => setDraft((d) => ({ ...d, customEvery: v }))}
                    />
                    <DayPickerRow
                      days={draft.customDays}
                      summary={formatDaysLabel(draft.customDays)}
                      onChange={(days) => setDraft((d) => ({ ...d, customDays: days }))}
                    />
                  </>
                ) : null}

                {draft.schedulePreset !== "interval" ? (
                  <TimeRow
                    value={draft.time}
                    invalid={!isValidTimeValue(draft.time)}
                    onChange={(v) => setDraft((d) => ({ ...d, time: v }))}
                  />
                ) : null}

                <OptionRow
                  label="通知"
                  value={draft.notifyChannelOption}
                  display={
                    (
                      {
                        none: "不通知",
                        desktop: "系统通知",
                        dingtalk: "钉钉",
                      } as const
                    )[draft.notifyChannelOption]
                  }
                  options={[
                    { value: "desktop", label: "系统通知" },
                    { value: "dingtalk", label: "钉钉" },
                    { value: "none", label: "不通知" },
                  ]}
                  onChange={(v) =>
                    setDraft((d) => {
                      const next = v as NotifyChannelOption;
                      return {
                        ...d,
                        notifyChannelOption: next,
                        ...(next === "dingtalk" && d.notifyLevel === "important"
                          ? { notifyLevel: "all" as NotifyLevel }
                          : {}),
                      };
                    })
                  }
                />

                {draft.notifyChannelOption !== "none" ? (
                  <OptionRow
                    label="通知范围"
                    value={draft.notifyLevel}
                    display={
                      (
                        {
                          all: "全部运行",
                          important: "重要更新",
                        } as const
                      )[draft.notifyLevel]
                    }
                    options={[
                      { value: "all", label: "全部运行" },
                      { value: "important", label: "重要更新" },
                    ]}
                    onChange={(v) => setDraft((d) => ({ ...d, notifyLevel: v as NotifyLevel }))}
                  />
                ) : null}

                {draft.notifyChannelOption === "dingtalk" ? (
                  <div className="space-y-3 border-t border-border/60 px-4 py-3">
                    <div className="space-y-1.5">
                      <p className="text-sm text-foreground">Webhook URL</p>
                      <Input
                        className="h-9 rounded-md bg-muted/30 font-mono text-[13px]"
                        placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"
                        value={draft.dingtalkWebhookUrl}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, dingtalkWebhookUrl: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-sm text-foreground">加签 Secret（可选）</p>
                      <Input
                        className="h-9 rounded-md bg-muted/30 font-mono text-[13px]"
                        type="password"
                        placeholder="SEC…"
                        value={draft.dingtalkSignSecret}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, dingtalkSignSecret: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={dingtalkTestBusy || !draft.dingtalkWebhookUrl.trim()}
                        onClick={() => void handleTestDingTalk()}
                      >
                        {dingtalkTestBusy ? "发送中…" : "测试发送"}
                      </Button>
                      {dingtalkTestNotice ? (
                        <span className="text-xs text-muted-foreground">{dingtalkTestNotice}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              {!creating && selectedId ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runningIds.has(selectedId)}
                    onClick={() => void handleRunNow()}
                  >
                    {runningIds.has(selectedId) ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    立即运行
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const task = tasks.find((t) => t.id === selectedId);
                      if (task) void handleToggleEnabled(task);
                    }}
                  >
                    {draft.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
                    {draft.enabled ? "暂停" : "开启"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDelete()}>
                    <Trash2 className="size-4" />
                    删除
                  </Button>
                </div>
              ) : null}

              {!creating && runs.length > 0 ? (
                <div className="mb-4">
                  <SectionLabel>运行历史</SectionLabel>
                  <ul className="space-y-1.5">
                    {runs.map((run) => (
                      <li key={run.id} className="rounded-lg border border-border/60 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <RunStatusBadge status={run.status} />
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeMs(run.startedAtMs)}
                          </span>
                        </div>
                        {run.summary ? (
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{run.summary}</div>
                        ) : null}
                        {run.errorMessage ? (
                          <div className="mt-1 line-clamp-2 text-xs text-destructive">{run.errorMessage}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-1 border-t border-border/60 px-5 py-2.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3 font-normal text-muted-foreground hover:text-foreground"
                onClick={closeForm}
              >
                取消
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(CODEX_PILL_BTN, "min-w-[4.25rem] px-4")}
                disabled={saving || !canSubmit(draft, repos.length === 0)}
                onClick={() => void handleSave()}
              >
                {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {creating ? "创建" : "保存"}
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TaskListPane(props: {
  compact: boolean;
  filter: TaskFilter;
  search: string;
  loading: boolean;
  visibleTasks: AutomationTask[];
  selectedId: string | null;
  creating: boolean;
  reposEmpty: boolean;
  runningIds: Set<string>;
  onFilterChange: (f: TaskFilter) => void;
  onSearchChange: (v: string) => void;
  onCreate: () => void;
  onOpenTask: (id: string) => void;
  onSuggestion: (item: (typeof AUTOMATION_SUGGESTIONS)[number]) => void;
}) {
  const {
    compact,
    filter,
    search,
    loading,
    visibleTasks,
    selectedId,
    creating,
    reposEmpty,
    runningIds,
    onFilterChange,
    onSearchChange,
    onCreate,
    onOpenTask,
    onSuggestion,
  } = props;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", !compact && "mx-auto w-full max-w-3xl")}>
      <AnimatePresence initial={false}>
        {!compact ? (
          <motion.div
            key="list-header"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div
              className="flex items-start justify-between gap-3 px-8 pb-4 pt-8"
              data-tauri-drag-region
            >
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">已安排的任务</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  让 Agent 安排任务、设置提醒或监测更新。需保持 Giteam 运行才会按时触发。
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className={cn(CODEX_PILL_BTN, "shrink-0")}
                onClick={onCreate}
              >
                创建
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div
        className={cn(
          "transition-[padding] duration-300 ease-out",
          compact ? "px-4 pb-2 pt-4" : "px-8 pb-3"
        )}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索已安排任务"
            className={cn("pl-9", compact ? "h-9" : "h-10 rounded-xl")}
          />
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-1 transition-[padding] duration-300 ease-out",
          compact ? "px-4 pb-2" : "px-8 pb-3"
        )}
      >
        {(["all", "enabled", "paused"] as TaskFilter[]).map((key) => (
          <button
            key={key}
            type="button"
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              filter === key
                ? "bg-[var(--selection-bg)] text-[var(--selection-foreground)]"
                : "text-muted-foreground hover:bg-[var(--selection-bg-subtle)] hover:text-foreground"
            )}
            onClick={() => onFilterChange(key)}
          >
            {key === "all" ? "全部" : key === "enabled" ? "已开启" : "已暂停"}
          </button>
        ))}
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto pb-6", compact ? "px-2" : "px-6")}>
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            加载中…
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="px-2 py-6 text-sm text-muted-foreground">
            {reposEmpty
              ? "还没有项目。先导入工作区后再创建自动化任务。"
              : "还没有自动化任务。点创建或使用下方建议。"}
          </div>
        ) : (
          <ul className="flex flex-col">
            {visibleTasks.map((task) => {
              const active = !creating && selectedId === task.id;
              const isRunning = runningIds.has(task.id) || task.lastStatus === "running";
              const isUnread = !isRunning && hasUnreadAutomationRun(task);
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left transition-[background-color,border-color,color]",
                      active
                        ? "border-[var(--selection-border)] bg-[var(--selection-bg)] text-[var(--selection-foreground)] hover:bg-[var(--selection-bg-hover)]"
                        : "hover:bg-[var(--selection-bg-subtle)]"
                    )}
                    onClick={() => onOpenTask(task.id)}
                  >
                    <span className="size-4 shrink-0 rounded-full border border-border" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{task.title}</span>
                        {isRunning ? (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            运行中
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatScheduleLabel(task)}
                        {task.nextRunAtMs ? ` · 下次运行 ${formatRelativeMs(task.nextRunAtMs)}` : ""}
                        {!task.enabled ? " · 已暂停" : ""}
                      </div>
                    </div>
                    {isRunning ? (
                      <RunningDot />
                    ) : isUnread ? (
                      <span
                        className="size-2 shrink-0 rounded-full bg-foreground/55"
                        aria-label="未读运行结果"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className={cn("mt-8", compact ? "px-2" : "px-2")}>
          <div className="mb-3 text-sm font-medium text-muted-foreground">建议</div>
          <div className="flex flex-col gap-1">
            {AUTOMATION_SUGGESTIONS.map((item, index) => {
              const Icon = SUGGESTION_ICONS[index % SUGGESTION_ICONS.length];
              return (
                <button
                  key={item.title}
                  type="button"
                  className="flex items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[var(--selection-bg-subtle)]"
                  onClick={() => onSuggestion(item)}
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.title}
                      <span className="ml-2 font-normal text-muted-foreground">{item.summary}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
                      {item.goalPrompt}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunningDot() {
  return (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center" aria-label="运行中">
      <span className="absolute inset-0 animate-ping rounded-full bg-foreground/25" />
      <span className="absolute -inset-1 animate-pulse rounded-full bg-foreground/10" />
      <span className="relative size-2 rounded-full bg-foreground/70" />
    </span>
  );
}

function SectionLabel(props: { children: ReactNode }) {
  return <div className="mb-2 text-sm font-medium text-muted-foreground">{props.children}</div>;
}

const ROW_CHEVRON = "size-3.5 shrink-0 text-muted-foreground";

function formRowClass(last?: boolean) {
  return cn(
    "grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 px-3.5 py-2",
    !last && "border-b border-border/60"
  );
}

/** 右侧值 + chevron 固定列宽，保证各行右缘对齐。 */
function RowTrailing(props: {
  children: ReactNode;
  chevron?: "show" | "spacer";
  className?: string;
  /** 为 true 时不包裹 truncate 层（用于 time/number 输入）。 */
  bare?: boolean;
}) {
  return (
    <span className={cn("flex min-w-0 items-center justify-end gap-1", props.className)}>
      {props.bare ? (
        props.children
      ) : (
        <span className="min-w-0 truncate text-right text-sm">{props.children}</span>
      )}
      <ChevronDown
        className={cn(ROW_CHEVRON, props.chevron === "spacer" && "pointer-events-none opacity-0")}
        aria-hidden={props.chevron === "spacer"}
      />
    </span>
  );
}

function formatTimeDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function TimeRow(props: { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  const showInvalid = props.invalid ?? !isValidTimeValue(props.value);

  return (
    <div className={formRowClass()}>
      <span className="shrink-0 text-sm text-foreground">时间</span>
      <RowTrailing chevron="spacer">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-label="时间"
          aria-invalid={showInvalid}
          placeholder="09:00"
          value={props.value}
          onChange={(e) => props.onChange(formatTimeDigits(e.target.value))}
          onBlur={() => {
            const normalized = normalizeTimeValue(props.value);
            if (normalized) props.onChange(normalized);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={cn(
            "w-full min-w-0 border-0 bg-transparent p-0 text-right text-sm tabular-nums outline-none focus:ring-0",
            showInvalid ? "text-destructive" : "text-foreground"
          )}
        />
      </RowTrailing>
    </div>
  );
}

function SettingRow(props: { label: string; children: ReactNode; last?: boolean; muted?: boolean }) {
  return (
    <div className={formRowClass(props.last)}>
      <span className="shrink-0 text-sm text-foreground">{props.label}</span>
      <RowTrailing chevron="spacer">
        <span className={cn("text-foreground", props.muted && "text-muted-foreground")}>
          {props.children}
        </span>
      </RowTrailing>
    </div>
  );
}

function NumberSettingRow(props: {
  label: string;
  value: string;
  suffix: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={formRowClass()}>
      <span className="shrink-0 text-sm text-foreground">{props.label}</span>
      <RowTrailing chevron="spacer" bare>
        <Input
          type="number"
          min={1}
          className="h-7 w-14 border-0 bg-transparent p-0 text-right text-sm tabular-nums text-foreground shadow-none focus-visible:ring-0"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <span className="shrink-0 text-sm text-muted-foreground">{props.suffix}</span>
      </RowTrailing>
    </div>
  );
}

/** 整行可点的选项菜单（Portal，避免 Tauri 里原生 select 点不动）。 */
function OptionRow(props: {
  label: string;
  value: string;
  display: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={props.disabled}>
        <button
          type="button"
          disabled={props.disabled}
          className={cn(
            formRowClass(props.last),
            "text-left outline-none transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <span className="shrink-0 text-sm text-foreground">{props.label}</span>
          <RowTrailing chevron="show">{props.display}</RowTrailing>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {props.options.map((opt) => (
          <DropdownMenuItem
            key={`${opt.value}:${opt.label}`}
            className="justify-between gap-3"
            onSelect={() => props.onChange(opt.value)}
          >
            <span>{opt.label}</span>
            {props.value === opt.value ? <Check className="size-4 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DayPickerRow(props: {
  days: number[];
  onChange: (days: number[]) => void;
  summary: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            formRowClass(),
            "text-left outline-none transition-colors hover:bg-accent/40"
          )}
        >
          <span className="shrink-0 text-sm text-foreground">开启</span>
          <RowTrailing chevron="show">{props.summary}</RowTrailing>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        {WEEKDAY_OPTIONS.map((day) => {
          const checked = props.days.includes(day.value);
          return (
            <DropdownMenuItem
              key={day.value}
              className="justify-between gap-3"
              // 多选时不要关菜单
              onSelect={(event) => {
                event.preventDefault();
                const next = checked
                  ? props.days.filter((d) => d !== day.value)
                  : [...props.days, day.value];
                props.onChange(next);
              }}
            >
              <span>{day.label}</span>
              {checked ? <Check className="size-4 shrink-0" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "success":
      return "成功";
    case "failure":
      return "失败";
    case "running":
      return "运行中";
    case "skipped":
      return "已跳过";
    case "queued":
      return "排队";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function runStatusTone(status: string): string {
  switch (status) {
    case "running":
      return "bg-muted text-foreground";
    case "success":
      return "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400";
    case "failure":
      return "bg-destructive/10 text-destructive";
    case "skipped":
    case "cancelled":
    case "queued":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function RunStatusBadge(props: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        runStatusTone(props.status)
      )}
    >
      {statusLabel(props.status)}
    </span>
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
