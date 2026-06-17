import { CheckIcon, MinusIcon } from "lucide-react";
import { Button } from "../ui/button";

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
  onChange
}: GitStageToggleProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={checked}
      className="size-6 rounded-sm text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground [&_svg]:size-3.5"
      onClick={() => onChange()}
    >
      {checked ? <MinusIcon aria-hidden="true" /> : <CheckIcon aria-hidden="true" />}
    </Button>
  );
}
