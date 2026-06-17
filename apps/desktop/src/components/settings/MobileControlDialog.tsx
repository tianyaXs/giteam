import type { ControlAuthMode, ControlPairCodeMode, ControlServerSettings } from "../../lib/controlServer";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
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
  const status = !serviceEnabled
    ? "Service is disabled"
    : authNoAuth
      ? "Current mode: No Auth"
      : `Pair code: ${pairCode || "------"}`;

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="w-[min(860px,calc(100vw-32px))]">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-2xl">Mobile Control API</DialogTitle>
            <DialogDescription className="text-[15px] leading-7">
              Configure the mobile control service, authentication mode, and QR pairing.
            </DialogDescription>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[14px] text-muted-foreground">Service</span>
            <Switch checked={settings.enabled} disabled={busy} onCheckedChange={onToggleService} title={settings.enabled ? "Disable service" : "Enable service"} />
          </div>
        </DialogHeader>

        <div className="grid gap-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle>Connection</CardTitle>
              <CardDescription>{status}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <label className="flex flex-col gap-2">
                <span className="text-[14px] font-medium text-muted-foreground">Port</span>
                <Input
                  className="h-9 text-[15px]"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={!serviceEnabled}
                  placeholder="Port"
                  value={String(settings.port)}
                  onChange={(event) => onSettingsChange({ port: Number(event.target.value || "0") })}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[14px] font-medium text-muted-foreground">Public URL (optional)</span>
                <Input
                  className="h-9 text-[15px]"
                  disabled={!serviceEnabled}
                  placeholder="Public URL（默认自动取局域网 IPv4）"
                  value={settings.publicBaseUrl}
                  onChange={(event) => onSettingsChange({ publicBaseUrl: event.target.value })}
                />
              </label>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle>Authentication</CardTitle>
              <CardDescription>Choose direct access or pair-code based authorization.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-2">
                <span className="text-[14px] font-medium text-muted-foreground">Auth Mode</span>
                <Select disabled={!serviceEnabled} value={settings.authMode} onValueChange={(value) => onAuthModeChange(value as ControlAuthMode)}>
                  <SelectTrigger className="h-9 text-[15px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No Auth</SelectItem>
                      <SelectItem value="pair_code">Pair Code</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-[14px] font-medium text-muted-foreground">Pair Code Validity</span>
                <Select
                  disabled={!serviceEnabled || settings.authMode === "none"}
                  value={settings.pairCodeTtlMode === "none" ? "24h" : settings.pairCodeTtlMode}
                  onValueChange={(value) => onPairModeChange(value as ControlPairCodeMode)}
                >
                  <SelectTrigger className="h-9 text-[15px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="24h">24 hours</SelectItem>
                      <SelectItem value="7d">7 days</SelectItem>
                      <SelectItem value="forever">Indefinitely</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <div className="flex flex-col gap-2">
                <span className="text-[14px] font-medium text-muted-foreground">Actions</span>
                <Button variant="secondary" size="sm" disabled={!serviceEnabled || busy} onClick={onRefreshCode}>
                  Refresh code
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle>QR Connection</CardTitle>
              <CardDescription>
                {!serviceEnabled
                  ? "Enable the service to generate a QR code for mobile pairing."
                  : authNoAuth
                    ? "Scan to connect directly (No Auth mode)."
                    : "Scan, then connect on mobile with pair code."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
              <div className="flex size-40 items-center justify-center rounded-lg border border-border bg-background p-3">
                {serviceEnabled && pairQrUrl ? (
                  <img className="size-full rounded-md object-contain" src={pairQrUrl} alt="Mobile pair QR code" />
                ) : (
                  <div className="text-center text-[14px] leading-6 text-muted-foreground">{serviceEnabled ? "QR unavailable" : "Service disabled"}</div>
                )}
              </div>
              <div className="flex min-w-0 flex-col justify-center gap-3">
                <div className="font-mono text-xl font-semibold tracking-[0.16em] text-foreground">{!serviceEnabled ? "Disabled" : authNoAuth ? "No Auth" : pairCode || "------"}</div>
                <div className="truncate font-mono text-[14px] text-muted-foreground">{serviceEnabled ? baseUrl || "Waiting for local address..." : "Service disabled"}</div>
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
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
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="justify-between">
          <span className="text-[14px] text-muted-foreground">{busy ? "Saving control server settings..." : status}</span>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
