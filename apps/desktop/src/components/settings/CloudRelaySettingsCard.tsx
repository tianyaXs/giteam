import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  forgetCloudKey,
  getCloudStatus,
  getDefaultCloudBaseUrl,
  linkCloud,
  renameCloudKey,
  useCloudKey,
  type CloudAccessKeyRecord,
  type CloudLinkStatus,
} from "@/lib/cloudLink";

const PRIVATE_URL_STORAGE_KEY = "giteam.privateCloudBaseUrl";
const MAX_KEYS = 20;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "").toLowerCase();
}

function formatCreatedAt(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncateId(id: string): string {
  const s = id.trim();
  if (s.length <= 22) return s || "—";
  return `${s.slice(0, 18)}…`;
}

function loadPrivateUrl(): string {
  try {
    return String(localStorage.getItem(PRIVATE_URL_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function savePrivateUrl(url: string) {
  try {
    localStorage.setItem(PRIVATE_URL_STORAGE_KEY, url.trim().replace(/\/$/, ""));
  } catch {
    /* ignore */
  }
}

export type CloudRelayMode = "cloud" | "private";

type CloudRelaySettingsCardProps = {
  mode: CloudRelayMode;
  /** When false, pause background refresh (kept mounted but hidden). */
  active?: boolean;
};

export function CloudRelaySettingsCard({ mode, active = true }: CloudRelaySettingsCardProps) {
  const defaultCloud = getDefaultCloudBaseUrl();
  const [status, setStatus] = useState<CloudLinkStatus | null>(null);
  const [privateUrl, setPrivateUrl] = useState(loadPrivateUrl);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CloudAccessKeyRecord | null>(null);
  const [pendingRename, setPendingRename] = useState<CloudAccessKeyRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [copiedKeyId, setCopiedKeyId] = useState("");

  const baseUrl =
    mode === "cloud"
      ? (status?.cloudBaseUrl || defaultCloud).replace(/\/$/, "")
      : privateUrl.trim().replace(/\/$/, "");

  const hasActiveKey = Boolean(status?.accessKey?.trim());
  const tunnelConnected = Boolean(status?.tunnelConnected);
  const tunnelRunning = Boolean(status?.tunnelRunning);
  const relayLabel = !hasActiveKey
    ? "未创建密钥"
    : tunnelConnected
      ? "中继已连接"
      : tunnelRunning
        ? "中继连接中…"
        : "中继未连接";
  const relayTone = !hasActiveKey
    ? "text-muted-foreground"
    : tunnelConnected
      ? "text-emerald-600 dark:text-emerald-400"
      : tunnelRunning
        ? "text-amber-600 dark:text-amber-400"
        : "text-destructive";

  const refresh = useCallback(async () => {
    try {
      const next = await getCloudStatus();
      setStatus(next);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    // Connecting: poll faster so UI / QR can flip to ready ASAP.
    const intervalMs = status?.tunnelConnected ? 8000 : 1500;
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [refresh, active, status?.tunnelConnected]);

  async function ensureRelayAfterLink() {
    // Backend already waits until tunnelConnected; refresh once (+ brief fallback).
    const next = await getCloudStatus();
    setStatus(next);
    if (next.tunnelConnected) return;
    for (let i = 0; i < 8; i += 1) {
      await new Promise((r) => window.setTimeout(r, 120));
      const again = await getCloudStatus();
      setStatus(again);
      if (again.tunnelConnected) return;
    }
  }

  const keys = useMemo(() => {
    const all = status?.accessKeys || [];
    const defaultNorm = normalizeBaseUrl(defaultCloud);
    const privateNorm = normalizeBaseUrl(privateUrl);
    const linkedNorm = normalizeBaseUrl(status?.cloudBaseUrl || "");

    if (mode === "private") {
      // 私有：仅展示当前填写的服务地址下的密钥；未填地址则不展示
      if (!privateNorm) return [];
      return all.filter((k) => normalizeBaseUrl(k.cloudBaseUrl || "") === privateNorm);
    }

    // 云端：默认 Gateway + 当前已连接且未被私有地址占用的入口
    const cloudUrls = new Set<string>();
    if (defaultNorm) cloudUrls.add(defaultNorm);
    if (linkedNorm && linkedNorm !== privateNorm) cloudUrls.add(linkedNorm);

    return all.filter((k) => {
      const u = normalizeBaseUrl(k.cloudBaseUrl || "");
      if (privateNorm && u === privateNorm) return false;
      // 旧记录可能没有 cloudBaseUrl，归入云端
      if (!u) return true;
      return cloudUrls.has(u);
    });
  }, [status?.accessKeys, status?.cloudBaseUrl, mode, privateUrl, defaultCloud]);

  function openCreateDialog() {
    setNewKeyName("");
    setCreateError("");
    setCreateOpen(true);
  }

  async function onCreateKey() {
    const name = newKeyName.trim();
    if (!name) {
      setCreateError("请填写名称");
      return;
    }
    if (mode === "private" && !baseUrl) {
      setCreateError("请先填写服务地址");
      return;
    }
    if (keys.length >= MAX_KEYS) {
      setCreateError(`最多 ${MAX_KEYS} 个 API Key`);
      return;
    }
    setBusy(true);
    try {
      if (mode === "private") savePrivateUrl(baseUrl);
      await linkCloud({
        url: baseUrl || defaultCloud,
        forceNew: true,
        keyName: name,
      });
      setNewKeyName("");
      setCreateOpen(false);
      setCreateError("");
      await ensureRelayAfterLink();
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRenameConfirm() {
    if (!pendingRename) return;
    const name = renameValue.trim();
    if (!name) {
      setRenameError("名称不能为空");
      return;
    }
    setBusy(true);
    try {
      await renameCloudKey(pendingRename.id, name);
      setPendingRename(null);
      setRenameValue("");
      setRenameError("");
      await refresh();
    } catch (e) {
      setRenameError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteConfirm() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await forgetCloudKey(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onActivate(key: CloudAccessKeyRecord) {
    setBusy(true);
    try {
      await useCloudKey(key.accessKey);
      await ensureRelayAfterLink();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCopyKey(key: CloudAccessKeyRecord) {
    const value = key.accessKey.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKeyId(key.id);
      window.setTimeout(() => {
        setCopiedKeyId((prev) => (prev === key.id ? "" : prev));
      }, 1600);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {mode === "private" ? (
        <label className="flex max-w-xl items-center gap-3">
          <span className="shrink-0 text-[13px] font-medium text-foreground">服务地址</span>
          <Input
            className="h-9 flex-1 font-mono text-[13px]"
            value={privateUrl}
            disabled={busy}
            placeholder="https://gateway.example.com:8787"
            onChange={(e) => {
              setPrivateUrl(e.target.value);
              savePrivateUrl(e.target.value);
            }}
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-base font-semibold text-foreground">API Keys</h3>
          <div className={`text-[12px] ${relayTone}`}>{relayLabel}</div>
        </div>
        <Button
          size="sm"
          variant="contrast"
          className="h-8 gap-1"
          disabled={busy}
          onClick={openCreateDialog}
        >
          <PlusIcon className="size-4" />
          新建 API Key
        </Button>
      </div>

      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[12px] text-muted-foreground">
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">API ID</th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">名称</th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">创建时间</th>
              <th className="px-2 py-2.5 font-medium">Key</th>
              <th className="px-2 py-2.5 font-medium whitespace-nowrap">状态</th>
              <th className="px-2 py-2.5 font-medium text-right whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">
                  暂无 API Key
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id} className="border-b border-border/70 text-foreground">
                  <td className="px-2 py-3 font-mono text-[12px] text-muted-foreground whitespace-nowrap" title={k.id}>
                    {truncateId(k.id)}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      disabled={busy || k.active}
                      title={k.active ? "当前使用中" : "切换为当前密钥"}
                      onClick={() => void onActivate(k)}
                    >
                      {k.name || "未命名"}
                    </button>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-muted-foreground">
                    {formatCreatedAt(k.createdAtMs)}
                  </td>
                  <td className="px-2 py-3 font-mono text-[12px] text-muted-foreground">
                    <button
                      type="button"
                      className="relative max-w-[280px] break-all text-left hover:text-foreground"
                      title="点击复制密钥"
                      onClick={() => void onCopyKey(k)}
                    >
                      <span>{k.accessKey || "—"}</span>
                      {copiedKeyId === k.id ? (
                        <span className="pointer-events-none absolute -right-1 -top-2 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-sans font-medium text-background shadow-sm">
                          已复制
                        </span>
                      ) : null}
                    </button>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    {k.active ? "生效中" : "已保存"}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        disabled={busy}
                        title="重命名"
                        onClick={() => {
                          setPendingRename(k);
                          setRenameValue(k.name || "");
                          setRenameError("");
                        }}
                      >
                        <EditIcon className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        disabled={busy}
                        title="删除"
                        onClick={() => setPendingDelete(k)}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {error ? <div className="text-[12px] text-destructive">{error}</div> : null}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setNewKeyName("");
            setCreateError("");
          }
        }}
      >
        <DialogContent
          className="z-[2701] flex w-[min(360px,calc(100vw-40px))] flex-col gap-5 p-6"
          overlayClassName="z-[2700]"
        >
          <DialogHeader>
            <DialogTitle>新建 API Key</DialogTitle>
            <DialogDescription className="sr-only">输入名称后创建</DialogDescription>
          </DialogHeader>
          <Input
            className="h-10"
            value={newKeyName}
            disabled={busy}
            placeholder="名称"
            autoFocus
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => {
              // 拼音等 IME 组合输入中回车只是上屏，不应提交
              if (e.key !== "Enter") return;
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              void onCreateKey();
            }}
          />
          {createError ? <div className="text-[12px] text-destructive">{createError}</div> : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button variant="contrast" size="sm" disabled={busy} onClick={() => void onCreateKey()}>
              {busy ? "连接中…" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent
          className="z-[2701] flex w-[min(360px,calc(100vw-40px))] flex-col gap-5 p-6"
          overlayClassName="z-[2700]"
        >
          <DialogHeader>
            <DialogTitle>删除 API Key</DialogTitle>
            <DialogDescription>
              从本机移除「{pendingDelete?.name || pendingDelete?.id}」。服务端密钥仍有效。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void onDeleteConfirm()}>
              {busy ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingRename)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRename(null);
            setRenameValue("");
            setRenameError("");
          }
        }}
      >
        <DialogContent
          className="z-[2701] flex w-[min(360px,calc(100vw-40px))] flex-col gap-5 p-6"
          overlayClassName="z-[2700]"
        >
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
            <DialogDescription className="sr-only">修改 API Key 名称</DialogDescription>
          </DialogHeader>
          <Input
            className="h-10"
            value={renameValue}
            disabled={busy}
            placeholder="名称"
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              void onRenameConfirm();
            }}
          />
          {renameError ? <div className="text-[12px] text-destructive">{renameError}</div> : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setPendingRename(null);
                setRenameValue("");
                setRenameError("");
              }}
            >
              取消
            </Button>
            <Button variant="contrast" size="sm" disabled={busy} onClick={() => void onRenameConfirm()}>
              {busy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
