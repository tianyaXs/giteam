import { useEffect, useState } from "react";

type OpenCodeAuthDialogProps = {
  providerId: string;
  providerName: string;
  providerTag: string;
  apiKey: string;
  busy: boolean;
  onClose: () => void;
  onApiKeyChange: (value: string) => void;
  onSave: (apiKey: string) => Promise<void> | void;
};

export function OpenCodeAuthDialog(props: OpenCodeAuthDialogProps) {
  const [draft, setDraft] = useState(props.apiKey);
  const [localStatus, setLocalStatus] = useState("");

  useEffect(() => {
    setDraft(props.apiKey);
  }, [props.apiKey, props.providerId]);

  async function submit() {
    const key = draft.trim();
    if (!key) {
      setLocalStatus("请输入 API Key");
      return;
    }
    setLocalStatus(`正在更新 API Key: ${props.providerId || props.providerName}`);
    props.onApiKeyChange(key);
    await props.onSave(key);
  }

  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="env-setup-head">
          <h3>{`更新 API Key · ${props.providerName}`}</h3>
          <button className="chip" onClick={props.onClose}>Close</button>
        </div>
        <p className="small muted">{`${props.providerTag} provider`}</p>
        <form
          className="settings-provider-form"
          style={{ marginTop: "var(--gt-space-2)" }}
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void submit();
          }}
        >
          <input
            className="path-input"
            type="password"
            placeholder="输入新的 API 密钥"
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setLocalStatus("");
              props.onApiKeyChange(e.target.value);
            }}
          />
          <button type="submit" className="chip is-primary" disabled={props.busy || !draft.trim()}>
            {props.busy ? "Saving..." : "更新 API Key"}
          </button>
        </form>
        {localStatus ? <p className="small muted" style={{ marginTop: "var(--gt-space-2)" }}>{localStatus}</p> : null}
      </div>
    </div>
  );
}
