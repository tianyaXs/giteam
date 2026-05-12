type OpenCodeApiDialogProps = {
  port: number;
  onClose: () => void;
  onPortChange: (port: number) => void;
};

export function OpenCodeApiDialog(props: OpenCodeApiDialogProps) {
  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="env-setup-head">
          <h3>OpenCode API</h3>
        </div>
        <div className="settings-provider-form">
          <div className="mobile-control-field">
            <div className="small muted">Service port</div>
            <input
              className="path-input"
              type="number"
              min={1}
              max={65535}
              placeholder="Service port"
              value={String(props.port)}
              onChange={(e) => props.onPortChange(Number(e.target.value || "0"))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
