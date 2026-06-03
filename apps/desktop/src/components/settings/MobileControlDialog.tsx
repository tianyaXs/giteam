import type { ControlAuthMode, ControlPairCodeMode, ControlServerSettings } from "../../lib/controlServer";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

type MobileControlDialogProps = {
  settings: ControlServerSettings;
  busy: boolean;
  serviceEnabled: boolean;
  authNoAuth: boolean;
  pairCode: string;
  baseUrl: string;
  pairQrUrl: string;
  onClose: () => void;
  onToggleService: (enabled: boolean) => void;
  onSettingsChange: (patch: Partial<ControlServerSettings>) => void;
  onAuthModeChange: (mode: ControlAuthMode) => void;
  onPairModeChange: (mode: ControlPairCodeMode) => void;
  onRefreshCode: () => void;
  onCopiedUrl: () => void;
};

export function MobileControlDialog({
  settings,
  busy,
  serviceEnabled,
  authNoAuth,
  pairCode,
  baseUrl,
  pairQrUrl,
  onClose,
  onToggleService,
  onSettingsChange,
  onAuthModeChange,
  onPairModeChange,
  onRefreshCode,
  onCopiedUrl
}: MobileControlDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="gt-settings-dialog-content">
        <DialogTitle className="sr-only">Mobile Control API</DialogTitle>
        <DialogDescription className="sr-only">Configure the mobile control service, authentication mode, and QR pairing.</DialogDescription>
        <div className="modal-card settings-card" style={{ maxWidth: 860 }}>
          <div className="env-setup-head">
            <h3>Mobile Control API</h3>
            <div className="mobile-control-head-right">
              <span className="small muted">Service</span>
              <Switch
                checked={settings.enabled}
                disabled={busy}
                onCheckedChange={onToggleService}
                title={settings.enabled ? "Disable service" : "Enable service"}
                className="settings-switch"
              />
            </div>
          </div>
          <div className="settings-provider-form settings-mobile-control">
            <div className="mobile-control-section-title">Connection</div>
            <div className="mobile-control-config">
              <div className="mobile-control-field">
                <div className="small muted">Port</div>
                <Input
                  className="path-input"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={!serviceEnabled}
                  placeholder="Port"
                  value={String(settings.port)}
                  onChange={(event) => onSettingsChange({ port: Number(event.target.value || "0") })}
                />
              </div>
              <div className="mobile-control-field">
                <div className="small muted">Public URL (optional)</div>
                <Input
                  className="path-input"
                  disabled={!serviceEnabled}
                  placeholder="Public URL（默认自动取局域网 IPv4）"
                  value={settings.publicBaseUrl}
                  onChange={(event) => onSettingsChange({ publicBaseUrl: event.target.value })}
                />
              </div>
            </div>
            <div className="mobile-control-section-title">Authentication</div>
            <div className="mobile-control-auth-row">
              <div className="mobile-control-field">
                <div className="small muted">Auth Mode</div>
                <Select disabled={!serviceEnabled} value={settings.authMode} onValueChange={(value) => onAuthModeChange(value as ControlAuthMode)}>
                  <SelectTrigger className="path-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No Auth</SelectItem>
                      <SelectItem value="pair_code">Pair Code</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="mobile-control-field">
                <div className="small muted">Pair Code Validity</div>
                <Select
                  disabled={!serviceEnabled || settings.authMode === "none"}
                  value={settings.pairCodeTtlMode === "none" ? "24h" : settings.pairCodeTtlMode}
                  onValueChange={(value) => onPairModeChange(value as ControlPairCodeMode)}
                >
                  <SelectTrigger className="path-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="24h">Pair code valid for 24 hours</SelectItem>
                      <SelectItem value="7d">Pair code valid for 7 days</SelectItem>
                      <SelectItem value="forever">Pair code valid indefinitely</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="mobile-control-field">
                <div className="small muted">Actions</div>
                <div className="toolbar" style={{ justifyContent: "flex-start", minHeight: 36 }}>
                  <Button variant="secondary" size="sm" className="gt-settings-action-btn" disabled={!serviceEnabled || busy} onClick={onRefreshCode}>
                    Refresh code
                  </Button>
                </div>
              </div>
            </div>
            <div className="toolbar mobile-control-status">
              <span className="small muted">
                {!serviceEnabled
                  ? "Service is disabled"
                  : authNoAuth
                    ? "Current mode: No Auth"
                    : `Pair code: ${pairCode || "------"}`}
              </span>
            </div>
            <div className="mobile-control-divider" />
            <div className="mobile-control-section-title">QR Connection</div>
            <div className="mobile-qr-card">
              <div className="mobile-qr-visual">
                {serviceEnabled && pairQrUrl ? (
                  <img src={pairQrUrl} alt="Mobile pair QR code" />
                ) : (
                  <div className="small muted">{serviceEnabled ? "QR unavailable" : "Service disabled"}</div>
                )}
              </div>
              <div className="mobile-qr-meta">
                <div className="small muted">
                  {!serviceEnabled
                    ? "Enable the service to generate a QR code for mobile pairing."
                    : authNoAuth
                      ? "Scan to connect directly (No Auth mode)"
                      : "Scan, then connect on mobile with pair code (manual or auto-filled)"}
                </div>
                <div className="mobile-qr-code">{!serviceEnabled ? "Disabled" : authNoAuth ? "No Auth" : pairCode || "------"}</div>
                <div className="mobile-qr-url">{serviceEnabled ? baseUrl || "Waiting for local address..." : "Service disabled"}</div>
                <div className="toolbar">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gt-settings-action-btn"
                    disabled={!serviceEnabled || !baseUrl}
                    onClick={() => {
                      void navigator.clipboard.writeText(baseUrl);
                      onCopiedUrl();
                    }}
                  >
                    Copy URL
                  </Button>
                </div>
              </div>
            </div>
            {busy ? <span className="small muted">Saving control server settings...</span> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
