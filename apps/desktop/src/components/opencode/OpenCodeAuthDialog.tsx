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
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="env-setup-head">
          <h3>{`更新 API Key · ${props.providerName}`}</h3>
          <button className="chip" onClick={props.onClose}>Close</button>
        </div>
        <p className="small muted">{`${props.providerTag} provider`}</p>
        <div className="settings-provider-form" style={{ marginTop: 8 }}>
          <input
            className="path-input"
            placeholder="输入新的 API 密钥"
            value={props.apiKey}
            onChange={(e) => props.onApiKeyChange(e.target.value)}
          />
        </div>
        <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 10 }}>
          <button className="chip" disabled={props.busy || !props.providerId || !props.apiKey.trim()} onClick={props.onSave}>
            {props.busy ? "Saving..." : "更新 API Key"}
          </button>
        </div>
      </div>
    </div>
  );
}
