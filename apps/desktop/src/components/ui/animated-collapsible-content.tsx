import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CollapsibleContent } from "./collapsible";
import { cn } from "../../lib/utils";

type AnimatedCollapsibleContentProps = {
  open: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * 基于 Radix Collapsible + motion 的高度展开动画。
 * 对齐 DesktopSidebar 的折叠动效，可在会话流工具事件等场景复用。
 */
export function AnimatedCollapsibleContent({
  open,
  className,
  children
}: AnimatedCollapsibleContentProps) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <CollapsibleContent asChild forceMount>
      <motion.div
        initial={false}
        animate={open ? "open" : "closed"}
        variants={{
          open: { height: "auto", opacity: 1 },
          closed: { height: 0, opacity: 0 }
        }}
        transition={transition}
        className={cn("overflow-hidden", className)}
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        <motion.div
          variants={{
            open: { y: 0 },
            closed: { y: reduceMotion ? 0 : -6 }
          }}
          transition={transition}
        >
          {children}
        </motion.div>
      </motion.div>
    </CollapsibleContent>
  );
}
