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
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="env-setup-head">
          <h3>自定义提供商</h3>
          <button className="chip" onClick={props.onClose}>Close</button>
        </div>
        <p className="small muted">
          OpenAI 兼容提供商（参考 `https://opencode.ai/docs/providers/#custom-provider`）。
        </p>
        <div className="settings-provider-form">
          <input
            className="path-input"
            placeholder="provider id（例如 vllm / myprovider）"
            value={props.config.provider}
            onChange={(e) => props.onConfigChange({ provider: e.target.value })}
          />
          <input
            className="path-input"
            placeholder="显示名称（可选）"
            value={props.config.name}
            onChange={(e) => props.onConfigChange({ name: e.target.value })}
          />
          <input
            className="path-input"
            placeholder="baseURL（例如 http://127.0.0.1:8000/v1）"
            value={props.config.baseUrl}
            onChange={(e) => props.onConfigChange({ baseUrl: e.target.value })}
          />
          <input
            className="path-input"
            placeholder="API Key（可空；支持 {env:ENV_NAME}）"
            value={props.config.apiKey}
            onChange={(e) => props.onConfigChange({ apiKey: e.target.value })}
          />
          <input
            className="path-input"
            placeholder="model id（例如 qwen3.5_35b_a3b）"
            value={props.modelId}
            onChange={(e) => props.onModelChange(e.target.value)}
          />
          <div className="toolbar">
            <button className="chip" disabled={disabled} onClick={props.onSave}>
              {props.busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
