import { Checkbox } from "@headlessui/react";
import { CheckIcon, MinusIcon } from "../icons";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type GitStageToggleProps = {
  checked: boolean;
  disabled?: boolean;
  title: string;
  compact?: boolean;
  onChange: () => void;
};

export function GitStageToggle({
  checked,
  disabled = false,
  title,
  compact = false,
  onChange
}: GitStageToggleProps) {
  return (
    <Checkbox
      as="button"
      type="button"
      checked={checked}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "gt-stage-toggle",
        checked && "is-on",
        compact && "is-compact"
      )}
      onChange={() => onChange()}
    >
      <span className="gt-stage-toggle-icon gt-stage-toggle-icon-check" aria-hidden="true">
        <CheckIcon />
      </span>
      <span className="gt-stage-toggle-icon gt-stage-toggle-icon-minus" aria-hidden="true">
        <MinusIcon />
      </span>
    </Checkbox>
  );
}
