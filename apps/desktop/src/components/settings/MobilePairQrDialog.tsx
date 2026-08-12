import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getCloudStatus,
  getDefaultCloudBaseUrl,
  resolveReachableCloudBaseUrl,
  type CloudLinkStatus,
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

  const cloudReady = Boolean(
    cloudStatus?.accessKey && cloudStatus.workspaceId && cloudStatus.cloudBaseUrl
  );
  const localReady = Boolean(localEnabled && localQrUrl);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getCloudStatus()
      .then((status) => {
        if (!cancelled) setCloudStatus(status);
      })
      .catch(() => {
        if (!cancelled) setCloudStatus(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const preferCloud = Boolean(
      cloudStatus?.accessKey && cloudStatus.workspaceId && cloudStatus.cloudBaseUrl
    );
    const preferLocal = Boolean(localEnabled && localQrUrl);
    setMode(preferCloud ? "cloud" : preferLocal ? "local" : "cloud");
  }, [open, cloudStatus?.accessKey, cloudStatus?.workspaceId, cloudStatus?.cloudBaseUrl, localEnabled, localQrUrl]);

  const cloudPayload = useMemo(() => {
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
  }, [cloudStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!open || !cloudPayload) {
      setCloudQrUrl("");
      return () => {
        cancelled = true;
      };
    }
    void QRCode.toDataURL(cloudPayload, {
      margin: 2,
      width: 320,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0a0a", light: "#ffffff" },
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
  }, [open, cloudPayload]);

  const showingCloud = mode === "cloud";
  const qrUrl = showingCloud ? cloudQrUrl : localQrUrl;
  const hasQr = Boolean(qrUrl);

  const subtitle = showingCloud
    ? cloudReady
      ? "手机扫码即可接入"
      : "先在设置 → 服务中创建 API Key"
    : localReady
      ? localNoAuth
        ? "局域网免验证 · 手机扫码直连"
        : `授权码 ${localPairCode || "------"}`
      : "先在设置 → 服务中开启局域网控制";

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
            <DialogTitle className="text-xl font-semibold tracking-tight">手机扫码连接</DialogTitle>
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
                  ["cloud", "云端", cloudReady],
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
                        ? "暂无云端密钥"
                        : "局域网服务未开启"}
                  </div>
                )}
              </div>
            </div>

            {!hasQr && onOpenServiceSettings ? (
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
