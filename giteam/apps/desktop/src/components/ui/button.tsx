import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "appearance-none border-0 bg-transparent inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 shrink-0 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        contrast: "border border-foreground/90 bg-foreground text-background shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-foreground/92",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/84",
        outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "bg-transparent hover:bg-accent hover:text-accent-foreground",
        link: "bg-transparent text-foreground/78 underline underline-offset-4 decoration-muted-foreground/45 hover:bg-transparent hover:text-foreground hover:decoration-foreground/60",
        destructive: "bg-destructive text-white hover:brightness-110"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-lg px-5",
        inline: "h-auto min-w-0 max-w-full shrink whitespace-normal rounded-none px-0 py-0 align-baseline leading-[inherit] text-[inherit]",
        icon: "size-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export {
  Button,
  buttonVariants
};
