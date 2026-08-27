import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getGatewayUrl } from "./api";

type ShareMeta = {
  shareId: string;
  name: string;
  repoName: string;
  defaultBranch: string;
  headCommit: string;
  sizeBytes: number;
  contextSizeBytes?: number;
  encrypted: boolean;
  status: string;
  downloadCount: number;
  createdAt: string;
  expiresAt: string;
  gitUrl?: string;
  meta?: {
    sessionCount?: number;
    hasMemoryDb?: boolean;
    hasAttachments?: boolean;
    reviewRecordCount?: number;
    createdAt?: string;
    sourceOs?: string;
    repoSizeBytes?: number;
    contextSizeBytes?: number;
  };
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/** 分享落地页（公开，无需 admin 登录）。 */
export default function SharePage() {
  const { shareId = "" } = useParams();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/s/${shareId}${window.location.hash || ""}`;
  const cliCommand = `giteam init --from ${shareUrl}`;
  // 显式 host「import」，避免部分浏览器把 giteam://import?… 判为非法 URL。
  const deepLink = `giteam://import/?url=${encodeURIComponent(shareUrl)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getGatewayUrl()}/cloud/v1/shares/${shareId}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as ShareMeta;
        if (!cancelled) setMeta(data);
      } catch {
        if (!cancelled) setError("分享不存在或已被撤销");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Giteam 项目分享</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            这是一份项目快照（代码 + AI 会话 + 记忆）。用 Giteam 打开即可完成初始化。
          </p>
        </div>

        {error ? <div className="text-sm text-[var(--bad)]">{error}</div> : null}
        {!meta && !error ? <div className="text-sm text-[var(--muted)]">加载中…</div> : null}

        {meta ? (
          <>
            <div className="border border-[var(--border)] rounded-lg p-4 text-sm flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">项目</span>
                <span className="font-medium">{meta.repoName || meta.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">分支 / 提交</span>
                <span>
                  {meta.defaultBranch} @ {meta.headCommit.slice(0, 8)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">代码 / 上下文</span>
                <span>
                  {formatSize(meta.sizeBytes)}
                  {" + "}
                  {formatSize(meta.contextSizeBytes ?? meta.meta?.contextSizeBytes ?? 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">会话 / 记忆 / 附件</span>
                <span>
                  {meta.meta?.sessionCount ?? 0} 个会话 ·{" "}
                  {meta.meta?.hasMemoryDb ? "含记忆库" : "无记忆库"} ·{" "}
                  {meta.meta?.hasAttachments ? "含附件" : "无附件"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">创建于</span>
                <span>{meta.createdAt ? new Date(meta.createdAt).toLocaleString() : "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">过期时间</span>
                <span>{meta.expiresAt ? new Date(meta.expiresAt).toLocaleString() : "永不过期"}</span>
              </div>
            </div>

            {meta.status !== "active" ? (
              <div className="text-sm text-[var(--bad)]">
                该分享已{meta.status === "revoked" ? "撤销" : "过期"}，无法下载。
              </div>
            ) : (
              <>
                <a
                  href={deepLink}
                  className="rounded-md bg-[var(--primary)] text-[var(--primary-fg)] px-3 py-2 text-sm text-center"
                  onClick={(e) => {
                    // Safari 在未注册 scheme 时会弹「网址无效」；仍尝试唤起，并提示 CLI 兜底。
                    e.preventDefault();
                    window.location.href = deepLink;
                  }}
                >
                  在 Giteam 中打开
                </a>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs border border-[var(--border)] rounded-md px-3 py-2 overflow-x-auto whitespace-nowrap">
                    {cliCommand}
                  </code>
                  <button
                    type="button"
                    onClick={copyCommand}
                    className="rounded-md border border-[var(--border)] px-3 py-2 text-sm shrink-0"
                  >
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  需已安装并启动过 Giteam 桌面端。若浏览器提示「网址无效」，请改用上方 CLI 命令初始化。
                </p>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
