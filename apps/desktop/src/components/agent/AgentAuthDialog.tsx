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
import { normalizeOpenAICompatibleBaseUrl } from "./AgentCustomProviderDialog";

type AgentAuthDialogProps = {
  providerId: string;
  providerName: string;
  providerTag: string;
  apiKey: string;
  baseUrl: string;
  name?: string;
  showNameField?: boolean;
  defaultBaseUrl?: string;
  busy: boolean;
  onClose: () => void;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onNameChange?: (value: string) => void;
  onSave: () => void;
};

export function AgentAuthDialog(props: AgentAuthDialogProps) {
  const nameRequired = Boolean(props.showNameField);
  const canSave = Boolean(props.providerId)
    && Boolean(props.apiKey.trim())
    && (!nameRequired || Boolean((props.name || "").trim()));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-xl">{`更新连接 · ${props.providerName}`}</DialogTitle>
            <DialogDescription className="text-[14px] leading-6">{`${props.providerTag} provider`}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm">关闭</Button>
          </DialogClose>
        </DialogHeader>
        <div className="grid gap-3">
          {props.showNameField ? (
            <Input
              className="h-9 text-[15px]"
              placeholder="供应商名称（必填）"
              value={props.name || ""}
              onChange={(e) => props.onNameChange?.(e.target.value)}
            />
          ) : null}
          <Input
            className="h-9 text-[15px]"
            placeholder="输入新的 API 密钥"
            value={props.apiKey}
            onChange={(e) => props.onApiKeyChange(e.target.value)}
          />
          <Input
            className="h-9 text-[15px]"
            placeholder={
              props.providerId === "openai-codex"
                ? "Base URL（可选；自定义代理仍保留 openai-codex，仅更新端点）"
                : props.defaultBaseUrl
                  ? `Base URL（默认 ${props.defaultBaseUrl}）`
                  : "Base URL（可选，自定义代理/自托管端点）"
            }
            value={props.baseUrl}
            onChange={(e) => props.onBaseUrlChange(e.target.value)}
            onBlur={() => {
              const next = normalizeOpenAICompatibleBaseUrl(props.baseUrl);
              if (next && next !== props.baseUrl.trim()) props.onBaseUrlChange(next);
            }}
          />
          <p className="m-0 text-[12px] leading-5 text-muted-foreground">
            {props.showNameField
              ? "供应商名称会显示在已配置模型列表中；Base URL 与 API Key 用于连接兼容端点。"
              : "Base URL 可留空使用默认端点；填写后写入 models.json，用于代理或自托管。"}
          </p>
        </div>
        <div className="flex justify-end">
          <Button
            variant="contrast"
            size="sm"
            disabled={props.busy || !canSave}
            onClick={props.onSave}
          >
            {props.busy ? "Saving..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
