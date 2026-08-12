import { startTransition, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { CloudServiceIcon, LanServiceIcon, PrivateServiceIcon, RefreshIcon } from "../icons";
import { Button } from "../ui/button";
import { CloudRelaySettingsCard } from "./CloudRelaySettingsCard";

type ControlSettings = {
  enabled: boolean;
  authMode: "none" | "pair_code";
};

type ServiceSettingsPanelProps = {
  controlSettings: ControlSettings;
  controlBusy: boolean;
  controlConnectionUrl: string;
  controlPairCode: string;
  controlPairQrUrl: string;
  onCopyControlUrl: () => void;
  onRefreshControlPairCode: () => void;
  connectionAddress: string;
  authCode: string;
  copyUrl: string;
  refreshCode: string;
  noAuth: string;
  qrWaiting: string;
  qrDisabled: string;
  mobileControlEntries: ReactNode;
};

type ServiceMode = "local" | "cloud" | "private";

const MODE_OPTIONS = [
  ["cloud", "云端", CloudServiceIcon],
  ["local", "局域网", LanServiceIcon],
  ["private", "私有", PrivateServiceIcon],
] as const;

export function ServiceSettingsPanel(props: ServiceSettingsPanelProps) {
  const [mode, setMode] = useState<ServiceMode>("cloud");
  const showLocal = mode === "local";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <span className="shrink-0 text-[13px] font-medium text-foreground">服务类型</span>
        <div className="inline-flex items-center gap-2" role="radiogroup" aria-label="服务类型">
          {MODE_OPTIONS.map(([id, label, Icon]) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                title={label}
                onClick={() => startTransition(() => setMode(id))}
                className={cn(
                  "inline-flex h-11 min-w-[88px] flex-col items-center justify-center gap-0.5 rounded-lg border px-3 transition-colors",
                  active
                    ? "border-foreground/30 bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                )}
              >
                <Icon className="size-[18px]" />
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div hidden={!showLocal} className="flex flex-col gap-5">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_144px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="min-w-0">
              <strong className="block text-sm font-semibold text-foreground">{props.connectionAddress}</strong>
              <Button
                variant="ghost"
                className="mt-1 h-auto max-w-full justify-start px-0 py-1 text-left font-mono text-[13px] text-muted-foreground hover:bg-transparent"
                title={props.copyUrl}
                disabled={!props.controlSettings.enabled || !props.controlConnectionUrl}
                onClick={props.onCopyControlUrl}
              >
                <span className="truncate">
                  {props.controlSettings.enabled
                    ? (props.controlConnectionUrl || props.qrWaiting).replace(/^https?:\/\//i, "")
                    : props.qrDisabled}
                </span>
              </Button>
            </div>
            <div>
              <strong className="block text-sm font-semibold text-foreground">{props.authCode}</strong>
              <div className="mt-2 flex items-center gap-2">
                <div className="inline-flex h-8 min-w-28 items-center justify-center rounded-md border border-border bg-muted px-3 font-mono text-sm font-semibold tracking-[0.18em] text-foreground">
                  {!props.controlSettings.enabled
                    ? "------"
                    : props.controlSettings.authMode === "none"
                      ? props.noAuth
                      : props.controlPairCode || "------"}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  title={props.refreshCode}
                  disabled={
                    !props.controlSettings.enabled ||
                    props.controlBusy ||
                    props.controlSettings.authMode === "none"
                  }
                  onClick={props.onRefreshControlPairCode}
                >
                  <RefreshIcon />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex size-36 items-center justify-center rounded-lg border border-border bg-background p-3">
            {props.controlSettings.enabled && props.controlPairQrUrl ? (
              <img className="size-full rounded-md object-contain" src={props.controlPairQrUrl} alt="Mobile pair QR code" />
            ) : (
              <div className="text-center text-[13px] leading-5 text-muted-foreground">
                {props.controlSettings.enabled ? props.qrWaiting : props.qrDisabled}
              </div>
            )}
          </div>
        </div>
        {props.mobileControlEntries}
      </div>

      <div hidden={showLocal}>
        <CloudRelaySettingsCard
          mode={mode === "private" ? "private" : "cloud"}
          active={!showLocal}
        />
      </div>
    </div>
  );
}
