import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type IconButtonProps = Omit<ComponentPropsWithoutRef<typeof Button>, "size"> & {
  tone?: "default" | "danger";
  size?: "sm" | "md";
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, tone = "default", size = "sm", ...props },
  ref
) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn(
        "shrink-0 rounded-md text-muted-foreground hover:text-foreground",
        size === "sm" ? "size-5 [&_svg]:size-3" : "size-6 [&_svg]:size-4",
        tone === "danger" && "hover:text-destructive",
        className
      )}
      {...props}
    />
  );
});

export {
  IconButton
};
