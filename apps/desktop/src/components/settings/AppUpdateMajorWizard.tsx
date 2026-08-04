import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import appIconUrl from "../../assets/app-icon.png";
import type { ReleaseNotesStep, UpdateCelebration } from "../../lib/appUpdater";
import { splitReleaseNotesIntoSteps } from "../../lib/appUpdater";
import { cn } from "../../lib/utils";
import { MarkdownLite } from "../common/MarkdownLite";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import type { AppUpdateDialogText } from "./AppUpdateDialogs";

type WizardProps = {
  open: boolean;
  celebration: UpdateCelebration | null;
  text: AppUpdateDialogText;
  onClose: () => void;
};

/**
 * 大更新（major/minor）全屏分步向导：release notes 按章节切步，
 * 左栏步骤导航 + 右栏章节内容，逐步告诉用户更新了什么。
 */
export function AppUpdateMajorWizard(props: WizardProps) {
  const reduceMotion = useReducedMotion();
  const celebration = props.celebration;
  const steps = useMemo<ReleaseNotesStep[]>(
    () => splitReleaseNotesIntoSteps(celebration?.notes || ""),
    [celebration?.notes]
  );
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  // 每次弹出新 celebration 时回到第一步。
  useEffect(() => {
    if (props.open) {
      setIndex(0);
      setDirection(1);
    }
  }, [props.open, celebration?.toVersion]);

  if (!celebration || steps.length === 0) return null;

  const total = steps.length;
  const current = Math.min(index, total - 1);
  const step = steps[current];
  const isLast = current === total - 1;

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (clamped === current) return;
    setDirection(clamped > current ? 1 : -1);
    setIndex(clamped);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-row gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=open]:zoom-in-100">
        {/* 左栏：品牌区 + 步骤导航 */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-border bg-muted/30 px-7 pb-6 pt-10">
          <div className="flex items-center gap-3">
            <div className="size-11 overflow-hidden rounded-[12px] border border-border bg-muted/40">
              <img src={appIconUrl} alt="" className="size-full object-cover" draggable={false} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {props.text.wizardKicker}
              </div>
              <DialogTitle className="mt-0.5 truncate text-[15px] font-semibold tracking-tight">
                {props.text.wizardTitle(celebration.toVersion)}
              </DialogTitle>
            </div>
          </div>
          <DialogDescription className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[11.5px]">
            <span className="text-muted-foreground">{celebration.fromVersion}</span>
            <span aria-hidden="true" className="text-muted-foreground/60">→</span>
            <span className="font-medium text-foreground">{celebration.toVersion}</span>
          </DialogDescription>

          <nav className="mt-8 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label={props.text.wizardKicker}>
            {steps.map((item, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <button
                  key={`${item.title}-${i}`}
                  type="button"
                  onClick={() => goTo(i)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                    active
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-medium",
                      done
                        ? "border-transparent bg-foreground text-background"
                        : active
                          ? "border-foreground/70 text-foreground"
                          : "border-border text-muted-foreground"
                    )}
                  >
                    {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0 truncate">{item.title}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-300",
                  i === current ? "w-5 bg-foreground/80" : "w-1.5 bg-foreground/20"
                )}
              />
            ))}
          </div>
        </div>

        {/* 右栏：当前章节内容 + 底部导航 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto w-full max-w-[720px] px-12 pb-8 pt-14">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={current}
                  custom={direction}
                  initial={reduceMotion ? false : { opacity: 0, x: 24 * direction }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, x: -18 * direction }}
                  transition={{ type: "spring", stiffness: 360, damping: 34, mass: 0.92 }}
                >
                  <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-foreground">
                    {step.title}
                  </h2>
                  <div className="mt-5 text-[14px]">
                    <MarkdownLite source={step.body} />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </ScrollArea>

          <div className="flex shrink-0 items-center justify-between border-t border-border px-8 py-4">
            <Button variant="ghost" onClick={props.onClose}>
              {props.text.wizardSkip}
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {props.text.wizardStepIndicator(current + 1, total)}
              </span>
              <Button variant="outline" disabled={current === 0} onClick={() => goTo(current - 1)}>
                {props.text.wizardPrev}
              </Button>
              {isLast ? (
                <Button variant="contrast" onClick={props.onClose}>
                  {props.text.wizardStart}
                </Button>
              ) : (
                <Button variant="contrast" onClick={() => goTo(current + 1)}>
                  {props.text.wizardNext}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
