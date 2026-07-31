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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/select";

export type AgentCustomProviderForm = {
  provider: string;
  npm: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  api?: string;
};

type AgentCustomProviderDialogProps = {
  config: AgentCustomProviderForm;
  modelId: string;
  busy: boolean;
  onClose: () => void;
  onConfigChange: (patch: Partial<AgentCustomProviderForm>) => void;
  onModelChange: (modelId: string) => void;
  onSave: () => void;
};

/** 参考 Moirai：去掉 endpoint 后缀，无 /v1 时补上，便于保存与拉模型。 */
export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  const normalized = baseUrl
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\/(?:responses|chat\/completions|completions|models|messages)\/?$/i, "");
  if (!normalized || /\/v\d+[a-z0-9.-]*(?:\/|$)/i.test(normalized)) return normalized;
  return `${normalized}/v1`;
}

export function AgentCustomProviderDialog(props: AgentCustomProviderDialogProps) {
  const disabled =
    props.busy
    || !props.config.provider.trim()
    || !props.config.baseUrl.trim()
    || !props.modelId.trim();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="w-[min(720px,calc(100vw-32px))]">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-xl">自定义供应商</DialogTitle>
            <DialogDescription className="text-[14px] leading-6">
              OpenAI 兼容端点（vLLM / 本地网关 / 自托管代理）。保存后会写入 models.json，API Key 仅存 vault。
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm">关闭</Button>
          </DialogClose>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            className="h-9 text-[15px]"
            placeholder="provider id（例如 vllm / my-proxy）"
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
            onBlur={() => {
              const next = normalizeOpenAICompatibleBaseUrl(props.config.baseUrl);
              if (next && next !== props.config.baseUrl.trim()) {
                props.onConfigChange({ baseUrl: next });
              }
            }}
          />
          <Input
            className="h-9 text-[15px] sm:col-span-2"
            placeholder="API Key（可空；支持 {env:ENV_NAME}）"
            value={props.config.apiKey}
            onChange={(e) => props.onConfigChange({ apiKey: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Select
              value={props.config.api || "openai-completions"}
              onValueChange={(value) => props.onConfigChange({ api: value })}
            >
              <SelectTrigger className="h-9 text-[15px]">
                <SelectValue placeholder="API 协议" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            className="h-9 text-[15px] sm:col-span-2"
            placeholder="至少一个 model id（例如 qwen2.5-72b）"
            value={props.modelId}
            onChange={(e) => props.onModelChange(e.target.value)}
          />
        </div>
        <p className="m-0 text-[12px] leading-5 text-muted-foreground">
          保存后若填写了 API Key，会自动尝试拉取 `/models` 补全目录。也可稍后在供应商面板刷新。
        </p>
        <div className="flex justify-end">
          <Button variant="contrast" size="sm" disabled={disabled} onClick={props.onSave}>
            {props.busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
