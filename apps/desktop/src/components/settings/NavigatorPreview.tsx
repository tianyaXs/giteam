import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";

/**
 * 概览标尺的迷你演示卡（设置面板内）：画几条示意消息（user 短条 / assistant 长条），
 * 旁边一列标尺随 side / scope / style 变化：经典尺标或帆船细轨（弯航线 + 船，无旁侧长文）。
 */
type Side = "left" | "right";
type Scope = "sent" | "all";
type Style = "rail" | "sailing";

type Row = { role: "user" | "assistant" };
const PREVIEW_ROWS: Row[] = [
  { role: "user" },
  { role: "assistant" },
  { role: "user" },
  { role: "assistant" },
  { role: "user" }
];
const ACTIVE_INDEX = 2;

export function NavigatorPreview(props: {
  side: Side;
  scope: Scope;
  style?: Style;
  caption?: string;
}) {
  const { side, scope, style = "rail", caption } = props;
  const showRail = (role: Row["role"]) => (scope === "sent" ? role === "user" : true);
  const sailing = style === "sailing";
  const mirror = side === "left";
  const activeTopPct = ((ACTIVE_INDEX + 0.5) / PREVIEW_ROWS.length) * 100;
  const activeY = activeTopPct * 1.2;
  // 基线贴所在侧外边，弯向内容：左轨 base 左 / 右轨 base 右。
  const baseX = mirror ? 10 : 26;
  const bendX = mirror ? 24 : 12;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/25 p-3">
        <div
          className={cn(
            "relative flex min-h-[88px] flex-col gap-1.5",
            sailing && (mirror ? "pl-10" : "pr-10")
          )}
        >
          {PREVIEW_ROWS.map((row, i) => (
            <div key={i} className="relative flex h-3 items-center">
              <div
                className={cn(
                  "h-2.5 rounded-full",
                  row.role === "user" ? "bg-primary/70" : "bg-muted-foreground/35"
                )}
                style={{
                  width: row.role === "user" ? "38%" : "78%",
                  marginLeft: mirror ? "auto" : undefined
                }}
              />
              {!sailing ? (
                <AnimatePresence initial={false}>
                  {showRail(row.role) ? (
                    <motion.span
                      key={`${side}-${i}`}
                      initial={{ opacity: 0, scaleX: 0.3 }}
                      animate={{ opacity: 1, scaleX: 1 }}
                      exit={{ opacity: 0, scaleX: 0.3 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className={cn(
                        "absolute top-1/2 h-[3px] w-3.5 -translate-y-1/2 rounded-full",
                        i === ACTIVE_INDEX ? "bg-primary" : "bg-foreground/50",
                        side === "right" ? "right-0" : "left-0"
                      )}
                    />
                  ) : null}
                </AnimatePresence>
              ) : null}
            </div>
          ))}

          {sailing ? (
            <div
              className={cn(
                "pointer-events-none absolute inset-y-0 w-9",
                mirror ? "left-0" : "right-0"
              )}
              aria-hidden
            >
              <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 36 120" preserveAspectRatio="xMidYMin meet">
                <path
                  d={`M${baseX} 8L${baseX} ${activeY - 14}C${baseX} ${activeY - 8} ${bendX} ${activeY - 8} ${bendX} ${activeY}C${bendX} ${activeY + 8} ${baseX} ${activeY + 8} ${baseX} ${activeY + 14}L${baseX} 112`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeDasharray="3 3"
                  className="text-muted-foreground/60"
                />
                <circle cx={baseX} cy="8" r="2.5" fill="var(--background)" stroke="currentColor" strokeWidth="1" className="text-muted-foreground/70" />
                <circle cx={baseX} cy="112" r="2.5" fill="var(--background)" stroke="currentColor" strokeWidth="1" className="text-muted-foreground/70" />
              </svg>
              {PREVIEW_ROWS.map((row, i) =>
                showRail(row.role) ? (
                  <span
                    key={i}
                    className={cn(
                      "absolute size-1.5 -translate-x-1/2 rounded-full",
                      i === ACTIVE_INDEX ? "bg-primary" : "bg-foreground/40"
                    )}
                    style={{
                      left: baseX,
                      top: `${((i + 0.5) / PREVIEW_ROWS.length) * 100}%`,
                      transform:
                        i === ACTIVE_INDEX
                          ? `translate(-50%, 0) translateX(${mirror ? -6 : 6}px)`
                          : "translate(-50%, 0)"
                    }}
                  />
                ) : null
              )}
              <motion.div
                className="absolute size-5 text-foreground/80"
                style={{
                  left: Math.max(0, bendX - 10),
                  top: `calc(${activeTopPct}% - 10px)`
                }}
                animate={{ y: [0, -1.5, 0, 1.2, 0], rotate: [0, -4, 0, 3, 0] }}
                transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <svg viewBox="0 0 100 88" className="size-full overflow-visible">
                  <path d="M7 65C29 75 66 73 93 57L92 64C72 83 32 88 14 73Z" fill="var(--background)" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                  <path d="M8 65C32 72 65 69 93 57M14 73C36 80 70 76 92 64" fill="none" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M29 13V71M56 3V69M79 12V64" fill="none" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M56 8C46 3 39 9 42 20L56 25Z" fill="var(--background)" stroke="currentColor" strokeWidth="1.1" />
                </svg>
              </motion.div>
            </div>
          ) : null}
        </div>
      </div>
      {caption ? <p className="px-1 text-[11px] leading-4 text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
