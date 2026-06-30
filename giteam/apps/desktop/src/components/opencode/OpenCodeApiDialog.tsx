import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

type OpenCodeApiDialogProps = {
  port: number;
  onClose: () => void;
  onPortChange: (port: number) => void;
};

export function OpenCodeApiDialog(props: OpenCodeApiDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) props.onClose();
    }}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle className="text-2xl">OpenCode API</DialogTitle>
          <DialogDescription className="text-[15px] leading-7">
            Configure the local OpenCode service port.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2">
          <span className="text-[14px] font-medium text-muted-foreground">Service port</span>
          <Input
            className="h-9 text-[15px]"
            type="number"
            min={1}
            max={65535}
            placeholder="Service port"
            value={String(props.port)}
            onChange={(e) => props.onPortChange(Number(e.target.value || "0"))}
          />
        </label>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
