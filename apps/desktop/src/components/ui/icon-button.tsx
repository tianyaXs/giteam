import { Button as HeadlessButton } from "@headlessui/react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type IconButtonProps = ComponentPropsWithoutRef<"button"> & {
  tone?: "default" | "danger";
  size?: "sm" | "md";
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, tone = "default", size = "sm", ...props },
  ref
) {
  return (
    <HeadlessButton
      ref={ref}
      className={cn(
        "gt-icon-button",
        tone === "danger" && "is-danger",
        size === "md" && "is-md",
        className
      )}
      {...props}
    />
  );
});

export {
  IconButton
};
