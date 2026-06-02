import {
  Description as HeadlessDescription,
  Field as HeadlessField,
  Label as HeadlessLabel,
  Textarea as HeadlessTextarea
} from "@headlessui/react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const Field = ({ className, ...props }: ComponentPropsWithoutRef<typeof HeadlessField>) => (
  <HeadlessField className={cn("gt-field", className)} {...props} />
);

const FieldLabel = ({ className, ...props }: ComponentPropsWithoutRef<typeof HeadlessLabel>) => (
  <HeadlessLabel className={cn("gt-field-label", className)} {...props} />
);

const FieldDescription = ({ className, ...props }: ComponentPropsWithoutRef<typeof HeadlessDescription>) => (
  <HeadlessDescription className={cn("gt-field-description", className)} {...props} />
);

const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(({ className, ...props }, ref) => (
  <HeadlessTextarea
    ref={ref}
    className={cn("gt-textarea", className)}
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
