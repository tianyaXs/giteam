import { normalizeModelRef } from "../../lib/agentModels";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Switch } from "../ui/switch";
import { cn } from "@/lib/utils";

type AgentProviderModelListProps = {
  models: string[];
  providerId: string;
  configuredProviderId: string;
  activeModel: string;
  configuredModelsByProvider: Record<string, string[]>;
  configuredModelNamesByProvider: Record<string, Record<string, string>>;
  modelNamesByProvider: Record<string, Record<string, string>>;
  hiddenModels: Set<string>;
  enabledModels: Set<string>;
  onSelectModel: (modelRef: string) => void;
  onEnableModel: (modelRef: string) => void;
  onHideModel: (modelRef: string) => void;
};

export function AgentProviderModelList(props: AgentProviderModelListProps) {
  if (props.models.length === 0) {
    return (
      <Empty className="min-h-48 border-0">
        <EmptyHeader>
          <EmptyTitle>没有可用模型</EmptyTitle>
          <EmptyDescription>当前提供商没有可用模型，或搜索没有匹配结果。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const active = normalizeModelRef(props.activeModel);

  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-black/[0.08] bg-card shadow-[var(--gt-elev-card)] dark:border-border/70 dark:shadow-none">
      {props.models.map((modelId) => {
        // 开关/选中必须按「当前供应商 + modelId」区分；不能用 configuredProviderId，
        // 否则 zai/glm-5.2 与 indemind/glm-5.2 会共用同一条 enabled 状态（同名串开关）。
        const ref = `${props.providerId}/${modelId}`;
        const refNorm = normalizeModelRef(ref);
        const configured = (props.configuredModelsByProvider[props.configuredProviderId] ?? []).includes(modelId)
          || (props.configuredModelsByProvider[props.providerId] ?? []).includes(modelId);
        const locallyEnabled = !!refNorm && props.enabledModels.has(refNorm);
        const hidden = !!refNorm && props.hiddenModels.has(refNorm);
        // 打开哪个，模型选择器才显示哪个：开关只反映用户显式启用，
        // "已配置"不再默认全开。
        const enabled = !!refNorm && !hidden && locallyEnabled;
        const isDefault = !!refNorm && active === refNorm;
        const modelDisplay =
          props.modelNamesByProvider[props.providerId]?.[modelId] ||
          props.configuredModelNamesByProvider[props.configuredProviderId]?.[modelId] ||
          props.configuredModelNamesByProvider[props.providerId]?.[modelId] ||
          modelId;

        return (
          <div
            key={`provider-model-pick-${refNorm || ref}`}
            className={cn(
              "flex min-h-[48px] items-center gap-3 px-3.5 py-2 transition-colors hover:bg-muted/40",
              isDefault && "bg-muted/55 hover:bg-muted/55"
            )}
          >
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start rounded-md px-0 py-1 text-left hover:bg-transparent"
              onClick={() => {
                if (refNorm) props.onSelectModel(refNorm);
              }}
              title={isDefault ? "当前默认模型" : "设为默认模型"}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] font-medium leading-5">{modelDisplay}</span>
                  {isDefault ? <Badge variant="secondary" className="shrink-0 normal-case tracking-normal">默认</Badge> : null}
                  {!configured && locallyEnabled ? <Badge variant="outline" className="shrink-0">临时</Badge> : null}
                </span>
                {modelDisplay !== modelId ? (
                  <span className="truncate text-[11px] leading-4 text-muted-foreground">{modelId}</span>
                ) : (
                  <span className="truncate text-[11px] leading-4 text-muted-foreground/80">
                    {isDefault ? "对话将使用此模型" : "点击设为默认"}
                  </span>
                )}
              </span>
            </Button>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <Switch
                checked={enabled}
                aria-label={enabled ? "隐藏模型" : "显示模型"}
                title={enabled ? "从模型选择器隐藏" : "在模型选择器中显示"}
                disabled={!refNorm}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={(checked) => {
                  if (!refNorm) return;
                  if (checked === enabled) return;
                  if (checked) props.onEnableModel(refNorm);
                  else props.onHideModel(refNorm);
                }}
              />
              <span className="text-[10px] leading-3 text-muted-foreground/70">
                {enabled ? "显示中" : "已隐藏"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
