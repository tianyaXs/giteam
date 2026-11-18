import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";

/** 对齐 dsh RiskConfirmation：扁平警告行 + 勾选门控，无额外色块。 */
export function FullAccessRiskDialog(props: {
  open: boolean;
  title?: string;
  description?: string;
  acknowledgeLabel?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const description = props.description
    || "启用后将放开工作区围栏，并自动通过工具授权，可访问工作区外路径与执行更多操作。仅在你信任当前任务时使用。";

  useEffect(() => {
    if (props.open) setAcknowledged(false);
  }, [props.open]);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setAcknowledged(false);
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="flex w-[min(440px,calc(100vw-32px))] max-w-[440px] flex-col gap-5 p-0 pb-6">
        <DialogHeader className="gap-0 px-6 pb-0 pt-[22px]">
          <DialogTitle className="text-base font-medium leading-6 tracking-normal">
            {props.title || "确认启用完全访问？"}
          </DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col overflow-y-auto px-6">
          <div className="flex items-start gap-2.5 text-sm leading-[22px] text-muted-foreground">
            <TriangleAlert
              className="mt-0.5 size-[18px] shrink-0 text-[var(--danger)]"
              aria-hidden
            />
            <p className="min-w-0">{description}</p>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm leading-[22px] text-foreground">
            <input
              type="checkbox"
              className="mt-[3px] size-4 shrink-0 accent-foreground"
              checked={acknowledged}
              autoFocus
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
            />
            <span>{props.acknowledgeLabel || "我已了解风险，并愿意继续"}</span>
          </label>
        </div>

        <DialogFooter className="gap-2 px-6 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="min-w-[72px]"
            onClick={() => props.onOpenChange(false)}
          >
            {props.cancelLabel || "取消"}
          </Button>
          <Button
            type="button"
            variant="contrast"
            className="min-w-[136px]"
            disabled={!acknowledged}
            onClick={() => {
              if (!acknowledged) return;
              setAcknowledged(false);
              props.onConfirm();
            }}
          >
            {props.confirmLabel || "启用完全访问"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
