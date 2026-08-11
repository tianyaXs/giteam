import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCloudQrPayload,
  getCloudStatus,
  linkCloud,
  unlinkCloud,
  type CloudLinkStatus,
  type CloudQrPayload,
} from "@/lib/cloudLink";

export function CloudRelaySettingsCard() {
  const [status, setStatus] = useState<CloudLinkStatus | null>(null);
  const [qr, setQr] = useState<CloudQrPayload | null>(null);
  const [url, setUrl] = useState("http://127.0.0.1:8787");
  const [joinKey, setJoinKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await getCloudStatus();
      setStatus(next);
      setUrl(next.cloudBaseUrl || "http://127.0.0.1:8787");
      if (next.enabled && next.accessKey) {
        try {
          setQr(await getCloudQrPayload());
        } catch {
          setQr(null);
        }
      } else {
        setQr(null);
      }
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function onLink() {
    setBusy(true);
    try {
      const next = await linkCloud({
        url,
        accessKey: joinKey.trim() || undefined,
      });
      setStatus(next);
      setJoinKey("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onUnlink() {
    setBusy(true);
    try {
      await unlinkCloud();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold">云端中继</div>
        <div className="text-xs text-muted-foreground mt-1">
          把本机 CLI 挂到 Cloud Gateway，手机可凭密钥异地连接。本地局域网模式不受影响。
        </div>
      </div>
      <div className="grid gap-2 text-sm">
        <label className="flex flex-col gap-1">
          Gateway URL
          <Input
            className="h-8"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:8787"
          />
        </label>
        <label className="flex flex-col gap-1">
          加入已有 Workspace（可选 accessKey）
          <Input
            className="h-8"
            value={joinKey}
            onChange={(e) => setJoinKey(e.target.value)}
            placeholder="gtm_aks_..."
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void onLink()}>
          {busy ? "处理中…" : status?.enabled ? "重新 Link" : "Link 云端"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !status?.enabled} onClick={() => void onUnlink()}>
          Unlink
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
          刷新
        </Button>
      </div>
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      {status ? (
        <div className="text-xs text-muted-foreground flex flex-col gap-1 font-mono">
          <div>enabled: {String(status.enabled)}</div>
          <div>tunnel: {status.tunnelRunning ? "online" : "offline"}</div>
          <div>workspace: {status.workspaceId || "—"}</div>
          <div>device: {status.deviceId || "—"}</div>
          <div>accessKey: {status.accessKey || "—"}</div>
        </div>
      ) : null}
      {qr ? (
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3">
          {JSON.stringify(qr, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
