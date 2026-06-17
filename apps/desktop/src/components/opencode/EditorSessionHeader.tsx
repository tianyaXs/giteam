import { CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";

type EditorSessionHeaderProps = {
  title: string;
  className?: string;
};

export function EditorSessionHeader({ title, className }: EditorSessionHeaderProps) {
  return (
    <CardHeader
      className={cn(
        "h-10 shrink-0 flex-row items-center gap-0 border-b border-border/60 bg-background p-0 px-6",
        className
      )}
      data-tauri-drag-region
    >
      <CardTitle className="truncate font-medium leading-5 text-foreground">
        {title}
      </CardTitle>
    </CardHeader>
  );
}
