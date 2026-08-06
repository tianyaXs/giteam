import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";

/**
 * 概览标尺的迷你演示卡（设置面板内）：画几条示意消息（user 短条 / assistant 长条），
 * 旁边一列标尺横杠随 side（左/右）换边、随 scope（仅我发送 / 全部）增减，
 * 中间一根高亮示「当前」。纯展示，让用户调设置时即时看到效果。
 */
type Side = "left" | "right";
type Scope = "sent" | "all";

type Row = { role: "user" | "assistant" };
const PREVIEW_ROWS: Row[] = [
  { role: "user" },
  { role: "assistant" },
  { role: "user" },
  { role: "assistant" },
  { role: "user" }
];
const ACTIVE_INDEX = 2;

export function NavigatorPreview(props: { side: Side; scope: Scope; caption?: string }) {
  const { side, scope, caption } = props;
  const showRail = (role: Row["role"]) => (scope === "sent" ? role === "user" : true);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/25 p-3">
        <div className="flex flex-col gap-1.5">
          {PREVIEW_ROWS.map((row, i) => (
            <div key={i} className="relative flex h-3 items-center">
              <div
                className={cn(
                  "h-2.5 rounded-full",
                  row.role === "user" ? "bg-primary/70" : "bg-muted-foreground/35"
                )}
                style={{
                  width: row.role === "user" ? "38%" : "78%",
                  // 镜像：left 模式消息条靠右（左留白给标尺横杠），right 模式靠左（右留白），
                  // 横杠始终落在消息条外侧的空白处，不叠在消息条上。
                  marginLeft: side === "left" ? "auto" : undefined
                }}
              />
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
            </div>
          ))}
        </div>
      </div>
      {caption ? <p className="px-1 text-[11px] leading-4 text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
