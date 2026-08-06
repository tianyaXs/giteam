import { type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "../../lib/utils";

/**
 * 通用分段控件：选中档背后一个共享 layoutId 的滑块，切换时在档位间平滑滑动。
 * spring 参数取偏临界阻尼（ζ≈1），无过冲、跟手，与 Workbench 侧栏动画风格一致。
 */
type Option<T extends string> = { value: T; label: string; icon?: ReactNode };

export function SegmentedControl<T extends string>(props: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 同一 group 内的档位共享滑块 layoutId；不同分段组用不同 group 避免串扰。 */
  group: string;
  className?: string;
}) {
  const { options, value, onChange, group, className } = props;
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5", className)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            className={cn(
              "relative flex min-w-[2.5rem] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`${group}-seg`}
                className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-border/50"
                transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
