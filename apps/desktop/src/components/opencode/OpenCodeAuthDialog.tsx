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
      <DialogContent className="opencode-provider-form-dialog">
        <DialogHeader className="opencode-provider-form-head">
          <div>
            <DialogTitle>{`更新 API Key · ${props.providerName}`}</DialogTitle>
            <DialogDescription>{`${props.providerTag} provider`}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm">关闭</Button>
          </DialogClose>
        </DialogHeader>
        <div className="settings-provider-form opencode-provider-form-grid">
          <Input
            className="opencode-provider-picker-input"
            placeholder="输入新的 API 密钥"
            value={props.apiKey}
            onChange={(e) => props.onApiKeyChange(e.target.value)}
          />
        </div>
        <div className="toolbar opencode-provider-form-actions">
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
