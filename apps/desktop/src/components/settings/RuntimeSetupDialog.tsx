import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Progress } from "../ui/progress";

type RuntimeSetupDialogProps = {
  runtimeStatus: RuntimeRequirementsStatus;
  runtimeChecking: boolean;
  checkingDeps: Record<RuntimeDepName, boolean>;
  installingDep: string;
  installingElapsed: number;
  runtimeJob: RuntimeActionJobStatus | null;
  runtimeInstallLog: string;
  runtimeLogTail: string;
  installError: string;
  autoInitAvailable: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onRefresh: () => void;
  onRunAutoInit: () => void;
};

const RUNTIME_DEPS: RuntimeDepName[] = ["git", "entire", "opencode", "giteam"];

const BOOTSTRAP_LOG_WEIGHTS: Array<[RegExp, number]> = [
  [/homebrew/i, 12],
  [/installing git|git already installed/i, 28],
  [/installing node|node\/npm already installed/i, 42],
  [/installing entire|entire already installed/i, 58],
  [/\[giteam\] PROGRESS: 68|正在通过 npm 安装 OpenCode|installing opencode|opencode already installed/i, 72],
  [/npm 安装失败|PROGRESS: 74|正在通过官方脚本|OpenCode includes free models|█▀▀█|\[giteam\] PROGRESS: 88/i, 86],
  [/installing opencode|OpenCode includes free models|█▀▀█|\[giteam\] PROGRESS: 88/i, 86],
  [/installing giteam|giteam already installed/i, 91],
  [/installed_version|runtime bootstrap complete|setup completed|finished/i, 100]
];

function inferBootstrapStage(log: string): string {
  const lines = (log || "").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].replace(/\x1b\[[0-9;]*m/g, "");
    const progress = line.match(/\[giteam\] PROGRESS: \d+ (.+)/);
    if (progress?.[1]) return progress[1];
    if (/installing giteam/i.test(line)) return "正在安装 giteam";
    if (/giteam already installed/i.test(line)) return "giteam 已就绪";
    if (/OpenCode includes free models|█▀▀█/i.test(line)) return "OpenCode 安装完成";
    if (/正在通过 npm 安装 OpenCode/i.test(line)) return "正在通过 npm 安装 OpenCode";
    if (/正在通过官方脚本安装 OpenCode/i.test(line)) return "正在通过官方脚本安装 OpenCode";
    if (/opencode already installed/i.test(line)) return "OpenCode 已就绪";
    if (/installing entire/i.test(line)) return "正在安装 Entire";
    if (/entire already installed/i.test(line)) return "Entire 已就绪";
    if (/installing node/i.test(line)) return "正在安装 Node.js";
    if (/node\/npm already installed/i.test(line)) return "Node.js 已就绪";
    if (/installing git/i.test(line)) return "正在安装 Git";
    if (/git already installed/i.test(line)) return "Git 已就绪";
    if (/installing homebrew/i.test(line)) return "正在安装 Homebrew";
    if (/homebrew already installed/i.test(line)) return "Homebrew 已就绪";
  }
  return "";
}

function depsFromStatus(status: RuntimeRequirementsStatus): RuntimeDependencyStatus[] {
  return RUNTIME_DEPS.map((name) => status[name]);
}

function inferBootstrapProgress(log: string): number {
  let progress = 0;
  for (const [pattern, weight] of BOOTSTRAP_LOG_WEIGHTS) {
    if (pattern.test(log || "")) progress = Math.max(progress, weight);
  }
  return progress;
}

function deriveRuntimeProgress(args: {
  deps: RuntimeDependencyStatus[];
  installingDep: string;
  installingElapsed: number;
  runtimeChecking: boolean;
  runtimeJob: RuntimeActionJobStatus | null;
  runtimeInstallLog: string;
}): number {
  if (args.runtimeJob?.status === "succeeded") return 100;

  const completed = args.deps.filter((dep) => dep.installed).length;
  const base = Math.round((completed / Math.max(args.deps.length, 1)) * 100);
  if (base >= 100) return 100;

  if (args.runtimeJob?.status === "failed") return Math.max(8, Math.min(96, base));

  if (args.installingDep) {
    const logProgress = args.installingDep === "runtime" ? inferBootstrapProgress(args.runtimeInstallLog) : 0;
    const elapsedProgress = Math.min(94, 10 + args.installingElapsed * 0.7);
    return Math.max(8, Math.min(96, Math.max(base, logProgress, elapsedProgress)));
  }

  if (args.runtimeChecking) return Math.max(8, Math.min(96, base || 12));
  return base;
}

function inferBootstrapFailureMessage(log: string): string {
  const lines = (log || "").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (line.includes("NETWORK_ERROR:")) {
      return line.replace(/^.*NETWORK_ERROR:\s*/, "").trim();
    }
    if (/^curl:\s/.test(line)) {
      return `网络连接失败（${line}），将自动尝试备用安装方式或请稍后重试。`;
    }
  }
  return "安装过程中断，可以稍后重试。";
}

function getRuntimeCopy(args: {
  missingCount: number;
  runtimeChecking: boolean;
  installing: boolean;
  runtimeJob: RuntimeActionJobStatus | null;
  runtimeInstallLog: string;
  installError: string;
  progress: number;
}) {
  if (args.missingCount === 0) {
    return {
      title: "已准备好",
      description: "正在进入应用。"
    };
  }

  if (args.installing) {
    return {
      title: "正在准备工作环境",
      description: "保持应用打开，马上就好。"
    };
  }

  if (args.runtimeChecking) {
    return {
      title: "正在检查工作环境",
      description: "确认必要能力是否可用。"
    };
  }

  if (args.installError.trim()) {
    return {
      title: "准备未完成",
      description: args.installError.trim()
    };
  }

  if (args.progress >= 100 || args.runtimeJob?.status === "succeeded") {
    return {
      title: "已准备好",
      description: "正在进入应用。"
    };
  }

  if (args.runtimeJob?.status === "failed") {
    return {
      title: "准备未完成",
      description: inferBootstrapFailureMessage(args.runtimeInstallLog)
    };
  }

  if (args.missingCount > 0) {
    return {
      title: "需要准备工作环境",
      description: "正在自动安装缺失组件…"
    };
  }

  return {
    title: "工作环境已就绪",
    description: "可以继续使用应用。"
  };
}

export function RuntimeSetupDialog(props: RuntimeSetupDialogProps) {
  const deps = depsFromStatus(props.runtimeStatus);
  const missingCount = deps.filter((dep) => !dep.installed).length;
  const installing = Boolean(props.installingDep || props.runtimeJob?.status === "running");
  const canStart = props.autoInitAvailable && missingCount > 0 && !installing && !props.runtimeChecking;
  const progress = deriveRuntimeProgress({
    deps,
    installingDep: props.installingDep,
    installingElapsed: props.installingElapsed,
    runtimeChecking: props.runtimeChecking,
    runtimeJob: props.runtimeJob,
    runtimeInstallLog: props.runtimeInstallLog
  });
  const bootstrapStage =
    props.installingDep === "runtime"
      ? inferBootstrapStage(props.runtimeInstallLog)
      : props.installingDep
        ? `正在安装 ${props.installingDep}`
        : "";
  const copy = getRuntimeCopy({
    missingCount,
    runtimeChecking: props.runtimeChecking,
    installing,
    runtimeJob: props.runtimeJob,
    runtimeInstallLog: props.runtimeInstallLog,
    installError: props.installError,
    progress
  });
  const showStartAction = missingCount > 0 && !installing && !props.runtimeChecking;
  const showCloseAction = !installing;

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open && !installing) props.onClose();
    }}>
      <DialogContent
        className="left-0 top-0 flex h-svh w-screen max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 bg-background p-0 shadow-none outline-none"
        overlayClassName="bg-background"
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_84%,var(--card)_16%)_0%,var(--background)_50%,color-mix(in_srgb,var(--background)_88%,var(--primary)_12%)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/50" />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-end px-[clamp(24px,5vw,72px)]">
            <div className="flex min-w-28 justify-end">
              {showStartAction ? (
                <Button variant="ghost" size="sm" onClick={props.onRunAutoInit}>
                  {props.runtimeJob?.status === "failed" || props.installError ? "重试" : "开始"}
                </Button>
              ) : showCloseAction ? (
                <Button variant="ghost" size="sm" onClick={props.onDismiss}>
                  {missingCount > 0 && progress < 100 ? "稍后" : "进入"}
                </Button>
              ) : null}
            </div>
          </header>

          <main className="grid min-h-0 flex-1 place-items-center px-[clamp(24px,5vw,72px)] py-12">
            <section className="flex w-full max-w-[640px] flex-col gap-10">
              <div className="text-sm font-semibold tracking-normal text-foreground">Giteam</div>
              <DialogHeader className="gap-4 text-left">
                <DialogTitle className="text-[clamp(30px,4.4vw,48px)] font-semibold leading-[1.1] tracking-normal text-foreground">
                  {copy.title}
                </DialogTitle>
                <DialogDescription className="text-[16px] leading-7 text-muted-foreground">
                  {copy.description}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3" role="status" aria-live="polite">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {installing
                      ? bootstrapStage || "安装中"
                      : props.runtimeChecking
                        ? "检查中"
                        : progress >= 100
                          ? "完成"
                          : "等待开始"}
                  </span>
                  <span className="tabular-nums">{Math.round(progress)}%</span>
                </div>
                <Progress
                  value={progress}
                  className="h-0.5 bg-muted/80 [&>div]:bg-foreground [&>div]:duration-500"
                />
              </div>
            </section>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
