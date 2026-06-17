import { normalizeModelRef } from "../../lib/opencodeModels";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Switch } from "../ui/switch";
import { cn } from "@/lib/utils";

type OpenCodeProviderModelListProps = {
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

export function OpenCodeProviderModelList(props: OpenCodeProviderModelListProps) {
  if (props.models.length === 0) {
    return (
      <Empty className="min-h-72 border-0">
        <EmptyHeader>
          <EmptyTitle>没有可用模型</EmptyTitle>
          <EmptyDescription>当前提供商没有可用模型，或搜索没有匹配结果。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const active = normalizeModelRef(props.activeModel);

  return (
    <>
      {props.models.map((modelId) => {
        const ref = `${props.configuredProviderId}/${modelId}`;
        const refNorm = normalizeModelRef(ref);
        const configured = (props.configuredModelsByProvider[props.configuredProviderId] ?? []).includes(modelId);
        const locallyEnabled = !!refNorm && props.enabledModels.has(refNorm);
        const hidden = !!refNorm && props.hiddenModels.has(refNorm);
        const enabled = !!refNorm && !hidden && (configured || locallyEnabled);
        const modelDisplay =
          props.modelNamesByProvider[props.providerId]?.[modelId] ||
          props.configuredModelNamesByProvider[props.configuredProviderId]?.[modelId] ||
          modelId;

        return (
          <div
            key={`provider-model-pick-${refNorm || ref}`}
            className={cn(
              "flex min-h-[64px] items-center gap-4 rounded-xl px-3.5 py-2.5 transition-colors hover:bg-secondary/45",
              active === refNorm && "bg-secondary text-secondary-foreground hover:bg-secondary"
            )}
          >
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start rounded-md px-0 py-1 text-left hover:bg-transparent"
              onClick={() => {
                if (refNorm) props.onSelectModel(refNorm);
              }}
              title={refNorm || ref}
            >
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[16px] font-semibold leading-6">{modelDisplay}</span>
                  {configured ? <Badge variant="secondary">默认</Badge> : null}
                  {!configured && locallyEnabled ? <Badge variant="outline">临时</Badge> : null}
                </span>
                {modelDisplay !== modelId ? <span className="truncate text-[14px] leading-5 text-muted-foreground">{modelId}</span> : null}
              </span>
            </Button>
            <Switch
              checked={enabled}
              aria-label={enabled ? "隐藏模型" : "显示模型"}
              title={enabled ? "隐藏模型" : "显示模型"}
              disabled={!refNorm}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={(checked) => {
                if (!refNorm) return;
                if (checked === enabled) return;
                if (checked) props.onEnableModel(refNorm);
                else props.onHideModel(refNorm);
              }}
            />
          </div>
        );
      })}
    </>
  );
}
