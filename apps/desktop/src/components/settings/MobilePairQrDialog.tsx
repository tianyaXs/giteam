import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Check, Smartphone, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  disconnectCloudMobileClient,
  getCloudStatus,
  getDefaultCloudBaseUrl,
  listCloudMobileClients,
  resolveReachableCloudBaseUrl,
  type CloudLinkStatus,
  type MobileClientSession,
} from "@/lib/cloudLink";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type PairMode = "cloud" | "local";

type MobilePairQrDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** LAN pair QR data URL from App */
  localQrUrl: string;
  localBaseUrl: string;
  localPairCode: string;
  localEnabled: boolean;
  localNoAuth: boolean;
  onOpenServiceSettings?: () => void;
};

function formatConnectedDuration(connectedAtMs: number): string {
  if (!connectedAtMs || connectedAtMs <= 0) return "刚刚接入";
  const secs = Math.max(0, Math.floor((Date.now() - connectedAtMs) / 1000));
  if (secs < 60) return "刚刚接入";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `已连接 ${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  return `已连接 ${hours} 小时`;
}

export function MobilePairQrDialog({
  open,
  onOpenChange,
  localQrUrl,
  localBaseUrl: _localBaseUrl,
  localPairCode,
  localEnabled,
  localNoAuth,
  onOpenServiceSettings,
}: MobilePairQrDialogProps) {
  const [cloudStatus, setCloudStatus] = useState<CloudLinkStatus | null>(null);
  const [cloudQrUrl, setCloudQrUrl] = useState("");
  const [mode, setMode] = useState<PairMode>("cloud");
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<MobileClientSession[]>([]);
  const [disconnectingJti, setDisconnectingJti] = useState("");
  const [actionError, setActionError] = useState("");
  const [nowTick, setNowTick] = useState(0);

  const cloudReady = Boolean(
    cloudStatus?.accessKey &&
      cloudStatus.workspaceId &&
      cloudStatus.cloudBaseUrl &&
      cloudStatus.tunnelConnected
  );
  const cloudLinked = Boolean(
    cloudStatus?.accessKey && cloudStatus.workspaceId && cloudStatus.cloudBaseUrl
  );
  const cloudConnecting = cloudLinked && !cloudStatus?.tunnelConnected;
  const localReady = Boolean(localEnabled && localQrUrl);
  const showingCloud = mode === "cloud";
  const primaryClient = clients[0] || null;
  const cloudConnected = showingCloud && Boolean(primaryClient);

  const refreshCloudStatus = useCallback(async () => {
    try {
      const status = await getCloudStatus();
      setCloudStatus(status);
    } catch {
      setCloudStatus(null);
    }
  }, []);

  const refreshClients = useCallback(async () => {
    if (!cloudReady) {
      setClients([]);
      return;
    }
    try {
      const rows = await listCloudMobileClients();
      setClients(Array.isArray(rows) ? rows : []);
    } catch {
      // 旧 Gateway 可能尚无 clients API；保持二维码态即可。
      setClients([]);
    }
  }, [cloudReady]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setActionError("");
    void (async () => {
      await refreshCloudStatus();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshCloudStatus]);

  useEffect(() => {
    if (!open) return;
    const preferCloud = Boolean(
      cloudStatus?.accessKey && cloudStatus.workspaceId && cloudStatus.cloudBaseUrl
    );
    const preferLocal = Boolean(localEnabled && localQrUrl);
    setMode(preferCloud ? "cloud" : preferLocal ? "local" : "cloud");
  }, [open, cloudStatus?.accessKey, cloudStatus?.workspaceId, cloudStatus?.cloudBaseUrl, localEnabled, localQrUrl]);

  useEffect(() => {
    if (!open || !showingCloud) return;
    void refreshClients();
    void refreshCloudStatus();
    // Wait for tunnel handshake before treating QR as scannable.
    const pollMs = cloudStatus?.tunnelConnected ? 2000 : 1000;
    const poll = window.setInterval(() => {
      void refreshClients();
      void refreshCloudStatus();
    }, pollMs);
    const tick = window.setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [
    open,
    showingCloud,
    refreshClients,
    refreshCloudStatus,
    cloudStatus?.tunnelConnected,
  ]);

  const cloudPayload = useMemo(() => {
    if (!cloudReady) return "";
    if (!cloudStatus?.accessKey || !cloudStatus.workspaceId) return "";
    const cloudBaseUrl = resolveReachableCloudBaseUrl(
      cloudStatus.cloudBaseUrl || getDefaultCloudBaseUrl()
    );
    if (!cloudBaseUrl) return "";
    return JSON.stringify({
      mode: "cloud",
      cloudBaseUrl,
      workspaceId: cloudStatus.workspaceId,
      accessKey: cloudStatus.accessKey,
    });
  }, [cloudReady, cloudStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!open || !cloudPayload || cloudConnected) {
      if (!cloudPayload || cloudConnected) setCloudQrUrl("");
      return () => {
        cancelled = true;
      };
    }
    void QRCode.toDataURL(cloudPayload, {
      margin: 2,
      width: 320,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setCloudQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setCloudQrUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, cloudPayload, cloudConnected]);

  const qrUrl = showingCloud ? cloudQrUrl : localQrUrl;
  const hasQr = Boolean(qrUrl);

  const subtitle = cloudConnected
    ? "移动设备接入"
    : showingCloud
      ? cloudReady
        ? "中继已连接 · 扫码接入"
        : cloudConnecting
          ? "正在连接云端中继，请稍候…"
          : "先在设置 → 服务中创建 API Key"
      : localReady
        ? localNoAuth
          ? "局域网免验证 · 扫码直连"
          : `授权码 ${localPairCode || "------"}`
        : "先在设置 → 服务中开启局域网控制";

  async function onDisconnect(jti: string) {
    if (!jti || disconnectingJti) return;
    setDisconnectingJti(jti);
    setActionError("");
    try {
      await disconnectCloudMobileClient(jti);
      await refreshClients();
    } catch (e) {
      setActionError(String(e || "断开失败"));
    } finally {
      setDisconnectingJti("");
    }
  }

  void nowTick;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="z-[2501] w-[min(400px,calc(100vw-32px))] overflow-hidden border-border/80 p-0 shadow-2xl"
        overlayClassName="z-[2500] bg-black/45 backdrop-blur-[2px]"
      >
        <div className="relative overflow-hidden px-6 pb-6 pt-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,hsl(var(--foreground)/0.06),transparent_55%)]"
          />
          <DialogHeader className="relative items-center gap-2 text-center sm:text-center">
            <div className="mb-1 flex size-10 items-center justify-center rounded-full border border-border/80 bg-background/80 text-foreground shadow-sm">
              <Smartphone className="size-5" strokeWidth={1.75} />
            </div>
            <DialogTitle className="text-xl font-semibold tracking-tight">连接你的手机</DialogTitle>
            <DialogDescription className="max-w-[280px] text-[13px] leading-5 text-muted-foreground">
              {subtitle}
            </DialogDescription>
          </DialogHeader>

          <div className="relative mt-5 flex justify-center">
            <div
              className="inline-flex rounded-full border border-border bg-muted/60 p-1"
              role="tablist"
              aria-label="连接方式"
            >
              {(
                [
                  ["cloud", "云端", cloudLinked],
                  ["local", "局域网", localReady],
                ] as const
              ).map(([id, label, ready]) => {
                const active = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setMode(id)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                      !ready && !active ? "opacity-60" : null
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative mt-6 flex flex-col items-center gap-4">
            {cloudConnected && primaryClient ? (
              <div className="w-full max-w-[280px]">
                <div className="rounded-[22px] border border-border/70 bg-background px-5 py-6 shadow-[0_12px_40px_-18px_rgba(0,0,0,0.35)]">
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/15" />
                      <Check className="relative size-7" strokeWidth={2.25} />
                    </div>
                    <div className="text-[15px] font-semibold tracking-tight text-foreground">
                      已安全连接
                    </div>
                    <div className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                      {primaryClient.clientName || "移动设备"}
                    </div>
                    <div className="mt-3 rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-[11px] tracking-wide text-muted-foreground">
                      {formatConnectedDuration(primaryClient.connectedAt)}
                    </div>
                    {clients.length > 1 ? (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        另有 {clients.length - 1} 台设备在线
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 space-y-2">
                    {clients.map((client) => (
                      <div
                        key={client.jti}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5"
                      >
                        <div className="min-w-0 text-left">
                          <div className="truncate text-[13px] font-medium text-foreground">
                            {client.clientName || "移动设备"}
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {formatConnectedDuration(client.connectedAt)}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 gap-1.5 px-2.5 text-[12px]"
                          disabled={Boolean(disconnectingJti)}
                          onClick={() => void onDisconnect(client.jti)}
                        >
                          <Unplug className="size-3.5" />
                          {disconnectingJti === client.jti ? "断开中…" : "断开"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                {actionError ? (
                  <div className="mt-3 text-center text-[12px] text-destructive">{actionError}</div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="rounded-[22px] border border-border/70 bg-background p-4 shadow-[0_12px_40px_-18px_rgba(0,0,0,0.35)]">
                  <div className="flex size-[220px] items-center justify-center rounded-[14px] bg-white p-3">
                    {hasQr ? (
                      <img
                        src={qrUrl}
                        alt={showingCloud ? "Cloud pair QR" : "LAN pair QR"}
                        className="size-full object-contain"
                      />
                    ) : (
                      <div className="px-4 text-center text-[13px] leading-5 text-neutral-500">
                        {loading && showingCloud
                          ? "加载中…"
                          : showingCloud
                            ? cloudConnecting
                              ? "正在连接云端中继…"
                              : "暂无云端密钥"
                            : "局域网服务未开启"}
                      </div>
                    )}
                  </div>
                </div>

                {!hasQr && !cloudConnecting && onOpenServiceSettings ? (
                  <Button
                    size="sm"
                    variant="contrast"
                    className="mt-1"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenServiceSettings();
                    }}
                  >
                    打开服务设置
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
