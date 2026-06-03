import { normalizeModelRef } from "../../lib/opencodeModels";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
    return <div className="small muted opencode-provider-empty">没有可用模型（或搜索无结果）。</div>;
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
            className={cn("file-item opencode-provider-model-row", active === refNorm && "selected")}
          >
            <Button
              variant="ghost"
              className="opencode-provider-model-main"
              onClick={() => {
                if (refNorm) props.onSelectModel(refNorm);
              }}
              title={refNorm || ref}
            >
              <span className="opencode-provider-model-copy">
                <span className="opencode-provider-model-copy-head">
                  <span>{modelDisplay}</span>
                  {configured ? <Badge variant="secondary" className="opencode-provider-model-badge">默认</Badge> : null}
                  {!configured && locallyEnabled ? <Badge variant="outline" className="opencode-provider-model-badge">临时</Badge> : null}
                </span>
                {modelDisplay !== modelId ? <small>{modelId}</small> : null}
              </span>
            </Button>
            <Switch
              checked={enabled}
              className="opencode-switch"
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
