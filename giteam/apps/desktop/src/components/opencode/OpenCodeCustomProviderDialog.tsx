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
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-xl">自定义提供商</DialogTitle>
            <DialogDescription className="text-[14px] leading-6">
              OpenAI 兼容提供商（参考 `https://opencode.ai/docs/providers/#custom-provider`）。
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm">关闭</Button>
          </DialogClose>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            className="h-9 text-[15px]"
            placeholder="provider id（例如 vllm / myprovider）"
            value={props.config.provider}
            onChange={(e) => props.onConfigChange({ provider: e.target.value })}
          />
          <Input
            className="h-9 text-[15px]"
            placeholder="显示名称（可选）"
            value={props.config.name}
            onChange={(e) => props.onConfigChange({ name: e.target.value })}
          />
          <Input
            className="h-9 text-[15px] sm:col-span-2"
            placeholder="baseURL（例如 http://127.0.0.1:8000/v1）"
            value={props.config.baseUrl}
            onChange={(e) => props.onConfigChange({ baseUrl: e.target.value })}
          />
          <Input
            className="h-9 text-[15px] sm:col-span-2"
            placeholder="API Key（可空；支持 {env:ENV_NAME}）"
            value={props.config.apiKey}
            onChange={(e) => props.onConfigChange({ apiKey: e.target.value })}
          />
          <Input
            className="h-9 text-[15px] sm:col-span-2"
            placeholder="model id（例如 qwen3.5_35b_a3b）"
            value={props.modelId}
            onChange={(e) => props.onModelChange(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button variant="contrast" size="sm" disabled={disabled} onClick={props.onSave}>
            {props.busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
