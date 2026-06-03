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

export type OpenCodeCustomProviderForm = {
  provider: string;
  npm: string;
  name: string;
  baseUrl: string;
  apiKey: string;
};

type OpenCodeCustomProviderDialogProps = {
  config: OpenCodeCustomProviderForm;
  modelId: string;
  busy: boolean;
  onClose: () => void;
  onConfigChange: (patch: Partial<OpenCodeCustomProviderForm>) => void;
  onModelChange: (modelId: string) => void;
  onSave: () => void;
};

export function OpenCodeCustomProviderDialog(props: OpenCodeCustomProviderDialogProps) {
  const disabled = props.busy || !props.config.provider.trim() || !props.modelId.trim();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="opencode-provider-form-dialog opencode-provider-form-dialog-lg">
        <DialogHeader className="opencode-provider-form-head">
          <div>
            <DialogTitle>自定义提供商</DialogTitle>
            <DialogDescription>
              OpenAI 兼容提供商（参考 `https://opencode.ai/docs/providers/#custom-provider`）。
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm">关闭</Button>
          </DialogClose>
        </DialogHeader>
        <div className="settings-provider-form opencode-provider-form-grid">
          <Input
            className="opencode-provider-picker-input"
            placeholder="provider id（例如 vllm / myprovider）"
            value={props.config.provider}
            onChange={(e) => props.onConfigChange({ provider: e.target.value })}
          />
          <Input
            className="opencode-provider-picker-input"
            placeholder="显示名称（可选）"
            value={props.config.name}
            onChange={(e) => props.onConfigChange({ name: e.target.value })}
          />
          <Input
            className="opencode-provider-picker-input"
            placeholder="baseURL（例如 http://127.0.0.1:8000/v1）"
            value={props.config.baseUrl}
            onChange={(e) => props.onConfigChange({ baseUrl: e.target.value })}
          />
          <Input
            className="opencode-provider-picker-input"
            placeholder="API Key（可空；支持 {env:ENV_NAME}）"
            value={props.config.apiKey}
            onChange={(e) => props.onConfigChange({ apiKey: e.target.value })}
          />
          <Input
            className="opencode-provider-picker-input"
            placeholder="model id（例如 qwen3.5_35b_a3b）"
            value={props.modelId}
            onChange={(e) => props.onModelChange(e.target.value)}
          />
        </div>
        <div className="toolbar opencode-provider-form-actions">
          <Button variant="contrast" size="sm" disabled={disabled} onClick={props.onSave}>
            {props.busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
