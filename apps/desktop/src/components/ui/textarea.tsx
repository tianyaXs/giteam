import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

const Field = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("grid gap-2", className)} {...props} />
);

const FieldLabel = ({ className, ...props }: ComponentPropsWithoutRef<"label">) => (
  <label className={cn("text-sm font-medium text-foreground", className)} {...props} />
);

const FieldDescription = ({ className, ...props }: ComponentPropsWithoutRef<"p">) => (
  <p className={cn("text-sm text-muted-foreground", className)} {...props} />
);

const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-20 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export {
  Field,
  FieldDescription,
  FieldLabel,
  Textarea
};
