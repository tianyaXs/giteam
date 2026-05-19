import type { ReactNode } from "react";
import { normalizeModelRef } from "../../lib/opencodeModels";

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
  topSlot?: ReactNode;
};

export function OpenCodeProviderModelList(props: OpenCodeProviderModelListProps) {
  if (props.models.length === 0 && !props.topSlot) {
    return <div className="small muted opencode-provider-empty">没有可用模型，或当前搜索无结果。</div>;
  }

  const active = normalizeModelRef(props.activeModel);

  return (
    <>
      {props.topSlot ? <div className="opencode-provider-model-topslot">{props.topSlot}</div> : null}
      {props.models.length === 0 ? <div className="small muted opencode-provider-empty">没有可用模型，或当前搜索无结果。</div> : null}
      {props.models.map((modelId) => {
        const ref = `${props.configuredProviderId}/${modelId}`;
        const refNorm = normalizeModelRef(ref);
        const configured = (props.configuredModelsByProvider[props.configuredProviderId] ?? []).includes(modelId);
        const locallyEnabled = !!refNorm && props.enabledModels.has(refNorm);
        const enabled = !!refNorm && !props.hiddenModels.has(refNorm) && (configured || locallyEnabled);
        const modelDisplay =
          props.modelNamesByProvider[props.providerId]?.[modelId] ||
          props.configuredModelNamesByProvider[props.configuredProviderId]?.[modelId] ||
          modelId;

        return (
          <div
            key={`provider-model-pick-${refNorm || ref}`}
            className={active === refNorm ? "file-item selected opencode-provider-model-row" : "file-item opencode-provider-model-row"}
          >
            <button
              className="opencode-provider-model-main"
              onClick={() => {
                if (refNorm) props.onSelectModel(refNorm);
              }}
              title={refNorm || ref}
            >
              <span>{modelDisplay}</span>
              {modelDisplay !== modelId ? <small>{modelId}</small> : null}
            </button>
            <button
              type="button"
              className={enabled ? "opencode-switch is-on" : "opencode-switch"}
              aria-pressed={enabled}
              aria-label={enabled ? "隐藏模型" : "启用模型"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!refNorm) return;
                if (enabled) props.onHideModel(refNorm);
                else props.onEnableModel(refNorm);
              }}
            />
          </div>
        );
      })}
    </>
  );
}
