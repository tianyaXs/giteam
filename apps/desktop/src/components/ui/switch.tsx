import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
    size?: "sm" | "default"
  }
>(({ className, size = "default", ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    type="button"
    data-slot="switch"
    data-size={size}
    className={cn(
      "peer group/switch inline-flex shrink-0 cursor-pointer appearance-none items-center rounded-full border p-0 shadow-xs outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=unchecked]:border-[var(--switch-off-border)] data-[state=unchecked]:bg-[var(--switch-off-bg)]",
      className
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      data-slot="switch-thumb"
      className={cn(
        "pointer-events-none block shrink-0 rounded-full bg-[var(--switch-thumb-bg)] ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:bg-background data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
