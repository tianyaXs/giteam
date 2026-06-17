import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../ui/dialog";
import { Input } from "../ui/input";

type OpenCodeAuthDialogProps = {
  providerId: string;
  providerName: string;
  providerTag: string;
  apiKey: string;
  busy: boolean;
  onClose: () => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
};

export function OpenCodeAuthDialog(props: OpenCodeAuthDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-xl">{`更新 API Key · ${props.providerName}`}</DialogTitle>
            <DialogDescription className="text-[14px] leading-6">{`${props.providerTag} provider`}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm">关闭</Button>
          </DialogClose>
        </DialogHeader>
        <Input
          className="h-9 text-[15px]"
          placeholder="输入新的 API 密钥"
          value={props.apiKey}
          onChange={(e) => props.onApiKeyChange(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            variant="contrast"
            size="sm"
            disabled={props.busy || !props.providerId || !props.apiKey.trim()}
            onClick={props.onSave}
          >
            {props.busy ? "Saving..." : "更新 API Key"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
