import type { RuntimeRequirementsStatus } from "../../lib/appCache";

type SettingsDialogProps = {
  theme: "dark" | "light";
  runtimeStatus: RuntimeRequirementsStatus;
  onClose: () => void;
  onToggleTheme: () => void;
  onOpenRuntimeSetup: () => void;
  onOpenMobileControl: () => void;
  onOpenOpenCodeApi: () => void;
  onOpenModelManager: () => void;
};

export function SettingsDialog(props: SettingsDialogProps) {
  return (
    <div className="modal-mask" onClick={() => void props.onClose()}>
      <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <p className="small muted">Theme and layout preferences</p>

        <div className="settings-grid">
          <div className="settings-row">
            <div className="settings-label">Theme</div>
            <div className="toolbar">
              <button className="chip" onClick={props.onToggleTheme} title={props.theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}>
                {props.theme === "dark" ? "Light" : "Dark"}
              </button>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-label">Plugins</div>
            <div className="toolbar">
              <button className="chip" onClick={props.onOpenRuntimeSetup}>
                Manage plugins
              </button>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-label">Mobile Control API</div>
            <div className="settings-config-btn-wrap">
              <button
                className="chip"
                disabled={!props.runtimeStatus.giteam.installed}
                title={props.runtimeStatus.giteam.installed ? "Configure Mobile Control API" : "Install giteam plugin first"}
                onClick={props.onOpenMobileControl}
              >
                Configure
              </button>
            </div>
          </div>
          {props.runtimeStatus.giteam.installed ? null : (
            <div className="settings-row">
              <div className="settings-label">Mobile Control API</div>
              <div className="small muted">Install giteam plugin first. This feature is provided by giteam CLI.</div>
            </div>
          )}

          {props.runtimeStatus.opencode.installed ? (
            <div className="settings-row">
              <div className="settings-label">OpenCode API</div>
              <div className="settings-config-btn-wrap">
                <button className="chip" onClick={props.onOpenOpenCodeApi}>
                  Configure
                </button>
              </div>
            </div>
          ) : null}

          {props.runtimeStatus.opencode.installed ? (
            <div className="settings-row">
              <div className="settings-label">Model management</div>
              <div className="toolbar">
                <button className="chip" onClick={props.onOpenModelManager}>
                  Open manager
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-row">
              <div className="settings-label">Model management</div>
              <div className="small muted">Install OpenCode plugin first.</div>
            </div>
          )}
        </div>

        <div className="toolbar" style={{ justifyContent: "flex-end" }}>
          <button className="chip" onClick={() => void props.onClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
