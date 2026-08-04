import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import appIconUrl from "../../assets/app-icon.png";
import type { UpdateCelebration } from "../../lib/appUpdater";
import { MarkdownLite } from "../common/MarkdownLite";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

export type AppUpdateDialogText = {
  availableKicker: string;
  availableTitle: string;
  availableSubtitle: (version: string) => string;
  currentLabel: string;
  newLabel: string;
  notesTitle: string;
  notesEmpty: string;
  later: string;
  install: string;
  installing: string;
  whatsNewKicker: string;
  whatsNewTitle: string;
  whatsNewSubtitle: (from: string, to: string) => string;
  whatsNewEmpty: string;
  gotIt: string;
  wizardKicker: string;
  wizardTitle: (to: string) => string;
  wizardSkip: string;
  wizardPrev: string;
  wizardNext: string;
  wizardStart: string;
  wizardStepIndicator: (current: number, total: number) => string;
};

type AvailableProps = {
  open: boolean;
  currentVersion: string;
  version: string;
  notes: string;
  busy?: boolean;
  text: AppUpdateDialogText;
  onLater: () => void;
  onInstall: () => void;
};

type WhatsNewProps = {
  open: boolean;
  celebration: UpdateCelebration | null;
  text: AppUpdateDialogText;
  onClose: () => void;
};

function VersionPath(props: {
  from: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-border bg-muted/50 px-3 py-1 font-mono text-[12px] tracking-tight">
      <span className="text-muted-foreground">
        {props.fromLabel ? `${props.fromLabel} ` : null}
        <span className="text-foreground/75">{props.from || "—"}</span>
      </span>
      <span className="text-muted-foreground/60" aria-hidden="true">
        →
      </span>
      <span className="text-foreground">
        {props.toLabel ? <span className="text-muted-foreground">{props.toLabel} </span> : null}
        <span className="font-medium">{props.to}</span>
      </span>
    </div>
  );
}

function NotesBlock(props: { notes: string; empty: string }) {
  const notes = props.notes.trim();
  if (!notes) {
    return <div className="text-[13.5px] leading-7 text-muted-foreground">{props.empty}</div>;
  }
  return (
    <ScrollArea className="max-h-[min(280px,40vh)]">
      <div className="pr-3 text-[13.5px] [&_.markdown-lite]:text-[13.5px]">
        <MarkdownLite source={notes} />
      </div>
    </ScrollArea>
  );
}

function UpdateShell(props: {
  open: boolean;
  busy?: boolean;
  kicker: string;
  title: string;
  description: string;
  versionPath: ReactNode;
  notesTitle: string;
  notes: string;
  notesEmpty: string;
  footer: React.ReactNode;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const hasNotes = Boolean(props.notes.trim());
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onDismiss();
      }}
    >
      <DialogContent className="w-[min(440px,calc(100vw-32px))] gap-0 overflow-hidden rounded-2xl p-0">
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-start gap-3.5">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.92, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="mt-0.5 size-11 shrink-0 overflow-hidden rounded-[12px] border border-border bg-muted/40"
            >
              <img src={appIconUrl} alt="" className="size-full object-cover" draggable={false} />
            </motion.div>
            <DialogHeader className="min-w-0 flex-1 gap-1.5 text-left">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {props.kicker}
              </div>
              <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
                {props.title}
              </DialogTitle>
              <DialogDescription className="text-[13.5px] leading-6 text-muted-foreground">
                {props.description}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="mt-4 pl-[58px]">{props.versionPath}</div>
        </div>

        {hasNotes ? (
          <div className="border-t border-border px-6 py-4">
            <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {props.notesTitle}
            </div>
            <NotesBlock notes={props.notes} empty={props.notesEmpty} />
          </div>
        ) : null}

        <DialogFooter className="border-t border-border bg-muted/30 px-6 py-3.5 sm:justify-end">
          {props.footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppUpdateAvailableDialog(props: AvailableProps) {
  return (
    <UpdateShell
      open={props.open}
      busy={props.busy}
      kicker={props.text.availableKicker}
      title={props.text.availableTitle}
      description={props.text.availableSubtitle(props.version)}
      versionPath={
        <VersionPath
          from={props.currentVersion}
          to={props.version}
          fromLabel={props.text.currentLabel}
          toLabel={props.text.newLabel}
        />
      }
      notesTitle={props.text.notesTitle}
      notes={props.notes}
      notesEmpty={props.text.notesEmpty}
      onDismiss={props.onLater}
      footer={
        <>
          <Button variant="ghost" disabled={props.busy} onClick={props.onLater}>
            {props.text.later}
          </Button>
          <Button variant="contrast" disabled={props.busy} onClick={props.onInstall}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={props.busy ? "busy" : "idle"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.16 }}
              >
                {props.busy ? props.text.installing : props.text.install}
              </motion.span>
            </AnimatePresence>
          </Button>
        </>
      }
    />
  );
}

export function AppUpdateWhatsNewDialog(props: WhatsNewProps) {
  const celebration = props.celebration;
  return (
    <UpdateShell
      open={props.open && Boolean(celebration)}
      kicker={props.text.whatsNewKicker}
      title={props.text.whatsNewTitle}
      description={
        celebration
          ? props.text.whatsNewSubtitle(celebration.fromVersion, celebration.toVersion)
          : ""
      }
      versionPath={
        celebration ? (
          <VersionPath from={celebration.fromVersion} to={celebration.toVersion} />
        ) : null
      }
      notesTitle={props.text.notesTitle}
      notes={celebration?.notes || ""}
      notesEmpty={props.text.whatsNewEmpty}
      onDismiss={props.onClose}
      footer={
        <Button variant="contrast" onClick={props.onClose}>
          {props.text.gotIt}
        </Button>
      }
    />
  );
}

export function getAppUpdateDialogText(language: "system" | "zh-CN" | "zh-TW" | "en-US"): AppUpdateDialogText {
  const nav = (navigator.language || "zh-CN").toLowerCase();
  const locale =
    language === "system"
      ? nav.startsWith("zh-tw") || nav.startsWith("zh-hk")
        ? "zh-TW"
        : nav.startsWith("zh")
          ? "zh-CN"
          : "en-US"
      : language;

  if (locale === "en-US") {
    return {
      availableKicker: "Update",
      availableTitle: "A newer Giteam is ready",
      availableSubtitle: (version) => `Version ${version} includes improvements you can install now.`,
      currentLabel: "Now",
      newLabel: "New",
      notesTitle: "Release notes",
      notesEmpty: "No release notes were included with this build.",
      later: "Not now",
      install: "Install update",
      installing: "Installing…",
      whatsNewKicker: "Updated",
      whatsNewTitle: "Welcome to the new build",
      whatsNewSubtitle: (from, to) => `Successfully moved from ${from} to ${to}.`,
      whatsNewEmpty: "You're on the latest desktop build. Thanks for updating.",
      gotIt: "Continue",
      wizardKicker: "What's new",
      wizardTitle: (to) => `Welcome to Giteam ${to}`,
      wizardSkip: "Skip",
      wizardPrev: "Back",
      wizardNext: "Next",
      wizardStart: "Get started",
      wizardStepIndicator: (current, total) => `${current} of ${total}`
    };
  }
  if (locale === "zh-TW") {
    return {
      availableKicker: "更新",
      availableTitle: "有新的 Giteam 可用",
      availableSubtitle: (version) => `版本 ${version} 已準備就緒，可立即安裝。`,
      currentLabel: "目前",
      newLabel: "新版",
      notesTitle: "更新說明",
      notesEmpty: "此版本未附帶更新說明。",
      later: "稍後",
      install: "安裝更新",
      installing: "安裝中…",
      whatsNewKicker: "已更新",
      whatsNewTitle: "歡迎使用新版本",
      whatsNewSubtitle: (from, to) => `已順利從 ${from} 更新到 ${to}。`,
      whatsNewEmpty: "你已在最新桌面版。感謝更新。",
      gotIt: "繼續使用",
      wizardKicker: "新功能",
      wizardTitle: (to) => `歡迎使用 Giteam ${to}`,
      wizardSkip: "略過",
      wizardPrev: "上一步",
      wizardNext: "下一步",
      wizardStart: "開始使用",
      wizardStepIndicator: (current, total) => `第 ${current} 步，共 ${total} 步`
    };
  }
  return {
    availableKicker: "更新",
    availableTitle: "有新的 Giteam 可用",
    availableSubtitle: (version) => `版本 ${version} 已就绪，可以立即安装。`,
    currentLabel: "当前",
    newLabel: "新版",
    notesTitle: "更新说明",
    notesEmpty: "此版本未附带更新说明。",
    later: "稍后",
    install: "安装更新",
    installing: "安装中…",
    whatsNewKicker: "已更新",
    whatsNewTitle: "欢迎使用新版本",
    whatsNewSubtitle: (from, to) => `已顺利从 ${from} 更新到 ${to}。`,
    whatsNewEmpty: "你已在最新桌面版。感谢更新。",
    gotIt: "继续使用",
    wizardKicker: "新功能",
    wizardTitle: (to) => `欢迎使用 Giteam ${to}`,
    wizardSkip: "跳过",
    wizardPrev: "上一步",
    wizardNext: "下一步",
    wizardStart: "开始使用",
    wizardStepIndicator: (current, total) => `第 ${current} 步，共 ${total} 步`
  };
}
