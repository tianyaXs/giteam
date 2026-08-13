import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useEffect, useState } from "react";
import {
  adminFetch,
  buildQuery,
  getAdminToken,
  setAdminToken,
  setGatewayUrl,
  type AdminDevice,
  type AuditEvent,
  type Metrics,
  type PageResponse,
  type WorkspaceDetail,
  type WorkspaceItem,
} from "./api";

function Shell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const nav = [
    ["/", "Overview"],
    ["/devices", "Devices"],
    ["/workspaces", "Workspaces"],
    ["/audit", "Audit"],
    ["/settings", "Settings"],
  ] as const;

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-[var(--border)] bg-[var(--card)] p-4 flex flex-col gap-3">
        <div className="text-sm font-semibold tracking-wide">Giteam Cloud</div>
        <nav className="flex flex-col gap-1 text-sm">
          {nav.map(([to, label]) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                className={`px-2 py-1.5 rounded hover:bg-[var(--background)] ${
                  active ? "bg-[var(--background)] font-medium" : ""
                }`}
                to={to}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getAdminToken()) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
      <div>
        共 {total} 条 · 显示 {from}-{to}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          每页
          <select
            className="border border-[var(--border)] rounded-md px-2 py-1 bg-white"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="border border-[var(--border)] rounded-md px-2 py-1 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="border border-[var(--border)] rounded-md px-2 py-1 disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

function StatusPill({ online, status }: { online?: boolean; status?: string }) {
  const ok = online === true;
  const label = online === true ? "Online" : online === false ? status || "Offline" : status || "—";
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-full text-xs"
      style={{
        background: ok ? "#dcfce7" : "#f3f4f6",
        color: ok ? "var(--ok)" : "var(--muted)",
      }}
    >
      {label}
    </span>
  );
}

function LoginPage() {
  const nav = useNavigate();
  const [token, setToken] = useState(getAdminToken());
  const [error, setError] = useState("");

  useEffect(() => {
    if (getAdminToken()) nav("/", { replace: true });
  }, [nav]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGatewayUrl("");
    setAdminToken(token);
    try {
      await adminFetch<Metrics>("/cloud/v1/admin/metrics");
      nav("/");
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 flex flex-col gap-4"
      >
        <h1 className="text-xl font-semibold">Giteam Cloud</h1>
        <p className="text-sm text-[var(--muted)]">使用 ADMIN_TOKEN 登录本站 Gateway 管理面。</p>
        <label className="flex flex-col gap-1 text-sm">
          Admin Token
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {error ? <div className="text-sm text-[var(--bad)]">{error}</div> : null}
        <button
          type="submit"
          className="rounded-md bg-[var(--primary)] text-[var(--primary-fg)] px-3 py-2 text-sm"
        >
          进入控制台
        </button>
      </form>
    </div>
  );
}

function SettingsPage() {
  const [token, setToken] = useState(getAdminToken());
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [jti, setJti] = useState("");
  const [jwtWorkspaceId, setJwtWorkspaceId] = useState("");
  const [jwtMsg, setJwtMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setGatewayUrl("");
    setAdminToken(token);
    try {
      await adminFetch<Metrics>("/cloud/v1/admin/metrics");
      setError("");
      setSaved(true);
    } catch (err) {
      setError(String(err));
    }
  }

  async function revokeJwt(e: React.FormEvent) {
    e.preventDefault();
    setJwtMsg("");
    try {
      await adminFetch("/cloud/v1/admin/jwt/revoke", {
        method: "POST",
        body: JSON.stringify({
          jti: jti.trim(),
          workspaceId: jwtWorkspaceId.trim() || undefined,
        }),
      });
      setJwtMsg("已拉黑该 JWT（jti）");
      setJti("");
    } catch (err) {
      setJwtMsg(String(err));
    }
  }

  function logout() {
    setAdminToken("");
    window.location.assign("/login");
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <form
        onSubmit={onSubmit}
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          Admin Token
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {error ? <div className="text-sm text-[var(--bad)]">{error}</div> : null}
        {saved ? <div className="text-sm text-[var(--ok)]">已保存并验证通过</div> : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-[var(--primary)] text-[var(--primary-fg)] px-3 py-2 text-sm"
          >
            保存
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
            onClick={logout}
          >
            退出登录
          </button>
        </div>
      </form>

      <form
        onSubmit={revokeJwt}
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 flex flex-col gap-4"
      >
        <div>
          <h2 className="font-medium">吊销 JWT</h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            将 session 的 jti 写入黑名单，立即切断对应移动端/设备会话。
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          JTI
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 font-mono text-xs"
            value={jti}
            onChange={(e) => setJti(e.target.value)}
            placeholder="jwt id"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Workspace ID（可选）
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 font-mono text-xs"
            value={jwtWorkspaceId}
            onChange={(e) => setJwtWorkspaceId(e.target.value)}
          />
        </label>
        {jwtMsg ? (
          <div
            className={`text-sm ${jwtMsg.startsWith("已") ? "text-[var(--ok)]" : "text-[var(--bad)]"}`}
          >
            {jwtMsg}
          </div>
        ) : null}
        <button
          type="submit"
          className="w-fit rounded-md border border-[var(--border)] px-3 py-2 text-sm"
        >
          吊销
        </button>
      </form>
    </div>
  );
}

function OverviewPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminFetch<Metrics>("/cloud/v1/admin/metrics")
      .then(setMetrics)
      .catch((e) => setError(String(e)));
  }, []);

  const cards = [
    ["Workspaces", metrics?.workspaceCount, "/workspaces"],
    ["Devices", metrics?.deviceCount, "/devices"],
    ["Online", metrics?.onlineDeviceCount, "/devices?online=online"],
    ["Revoked devices", metrics?.revokedDeviceCount, "/devices?status=revoked"],
    ["Disabled workspaces", metrics?.disabledWorkspaceCount, "/workspaces?status=disabled"],
    ["Audit (24h)", metrics?.auditEventCount24h, "/audit"],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Overview</h1>
      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map(([label, value, to]) => (
          <Link
            key={label}
            to={to}
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--foreground)] transition-colors"
          >
            <div className="text-sm text-[var(--muted)]">{label}</div>
            <div className="text-3xl font-semibold mt-2">{value ?? "—"}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function useListQueryState(defaults?: { pageSize?: number }) {
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaults?.pageSize ?? 20);

  function applySearch(e?: React.FormEvent) {
    e?.preventDefault();
    setQ(qDraft.trim());
    setPage(1);
  }

  function changePageSize(size: number) {
    setPageSize(size);
    setPage(1);
  }

  return {
    q,
    qDraft,
    setQDraft,
    page,
    setPage,
    pageSize,
    changePageSize,
    applySearch,
    resetPage: () => setPage(1),
  };
}

function DevicesPage() {
  const [searchParams] = useSearchParams();
  const list = useListQueryState();
  const [status, setStatus] = useState(() => searchParams.get("status") || "");
  const [online, setOnline] = useState(() => searchParams.get("online") || "");
  const [workspaceId, setWorkspaceId] = useState(() => searchParams.get("workspaceId") || "");
  const [data, setData] = useState<PageResponse<AdminDevice> | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(searchParams.get("status") || "");
    setOnline(searchParams.get("online") || "");
    setWorkspaceId(searchParams.get("workspaceId") || "");
    list.resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function load() {
    try {
      const res = await adminFetch<PageResponse<AdminDevice>>(
        `/cloud/v1/admin/devices${buildQuery({
          q: list.q,
          status,
          online,
          workspaceId,
          page: list.page,
          pageSize: list.pageSize,
        })}`,
      );
      setData(res);
      setSelected(new Set());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.q, list.page, list.pageSize, status, online, workspaceId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const items = data?.items ?? [];
    if (items.length === 0) return;
    const allSelected = items.every((d) => selected.has(d.id));
    setSelected(allSelected ? new Set() : new Set(items.map((d) => d.id)));
  }

  async function revoke(id: string) {
    if (!confirm(`撤销设备 ${id}？（软删除，默认列表不再显示）`)) return;
    setBusy(true);
    try {
      await adminFetch(`/cloud/v1/admin/devices/${encodeURIComponent(id)}/revoke`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(id: string) {
    if (!confirm(`永久删除设备 ${id}？工作空间会保留。`)) return;
    setBusy(true);
    try {
      await adminFetch(`/cloud/v1/admin/devices/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revokeBatch() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`批量撤销 ${ids.length} 台设备？（默认列表不再显示）`)) return;
    setBusy(true);
    try {
      await adminFetch<{ ok: boolean; revoked: number }>("/cloud/v1/admin/devices/revoke-batch", {
        method: "POST",
        body: JSON.stringify({ deviceIds: ids }),
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Devices</h1>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          className="rounded-md border border-[var(--bad)] text-[var(--bad)] px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => void revokeBatch()}
        >
          批量撤销 ({selected.size})
        </button>
      </div>

      <form
        onSubmit={list.applySearch}
        className="flex flex-wrap gap-2 items-end bg-[var(--card)] border border-[var(--border)] rounded-xl p-3"
      >
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)] flex-1 min-w-[160px]">
          搜索
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--foreground)]"
            value={list.qDraft}
            onChange={(e) => list.setQDraft(e.target.value)}
            placeholder="名称 / ID / workspace / 版本"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          状态
          <select
            className="border border-[var(--border)] rounded-md px-2 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              list.resetPage();
            }}
          >
            <option value="">有效（隐藏已撤销）</option>
            <option value="active">active</option>
            <option value="revoked">revoked</option>
            <option value="all">全部（含已撤销）</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          在线
          <select
            className="border border-[var(--border)] rounded-md px-2 py-2 text-sm"
            value={online}
            onChange={(e) => {
              setOnline(e.target.value);
              list.resetPage();
            }}
          >
            <option value="">全部</option>
            <option value="online">在线</option>
            <option value="offline">离线</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)] min-w-[140px]">
          Workspace
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 text-sm font-mono text-[var(--foreground)]"
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value.trim());
              list.resetPage();
            }}
            placeholder="workspace id"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-[var(--primary)] text-[var(--primary-fg)] px-3 py-2 text-sm"
        >
          搜索
        </button>
      </form>

      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-left">
            <tr>
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={items.length > 0 && items.every((d) => selected.has(d.id))}
                  onChange={toggleAll}
                />
              </th>
              <th className="p-3">Name</th>
              <th className="p-3">Status</th>
              <th className="p-3">Workspace</th>
              <th className="p-3">Version</th>
              <th className="p-3">Last seen</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-[var(--muted)]">
                  暂无设备
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr key={d.id} className="border-t border-[var(--border)]">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggle(d.id)}
                      disabled={d.status === "revoked"}
                    />
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{d.name || d.id}</div>
                    <div className="text-xs text-[var(--muted)] font-mono">{d.id}</div>
                  </td>
                  <td className="p-3">
                    <StatusPill online={d.online} status={d.status} />
                  </td>
                  <td className="p-3 font-mono text-xs">
                    <Link
                      className="underline"
                      to={`/workspaces/${encodeURIComponent(d.workspaceId)}`}
                    >
                      {d.workspaceId}
                    </Link>
                  </td>
                  <td className="p-3">{d.clientVersion || "—"}</td>
                  <td className="p-3 text-xs text-[var(--muted)]">
                    {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    {d.status !== "revoked" ? (
                      <button
                        className="text-xs border border-[var(--border)] rounded px-2 py-1"
                        onClick={() => void revoke(d.id)}
                        type="button"
                        disabled={busy}
                      >
                        Revoke
                      </button>
                    ) : null}
                    <button
                      className="text-xs border border-[var(--bad)] text-[var(--bad)] rounded px-2 py-1"
                      onClick={() => void removeDevice(d.id)}
                      type="button"
                      disabled={busy}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={list.page}
        pageSize={list.pageSize}
        total={data?.total ?? 0}
        onPageChange={list.setPage}
        onPageSizeChange={list.changePageSize}
      />
    </div>
  );
}

function WorkspacesPage() {
  const [searchParams] = useSearchParams();
  const list = useListQueryState();
  const [status, setStatus] = useState(() => searchParams.get("status") || "");
  const [data, setData] = useState<PageResponse<WorkspaceItem> | null>(null);
  const [error, setError] = useState("");
  const [rotatedKey, setRotatedKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(searchParams.get("status") || "");
    list.resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function load() {
    try {
      const res = await adminFetch<PageResponse<WorkspaceItem>>(
        `/cloud/v1/admin/workspaces${buildQuery({
          q: list.q,
          status,
          page: list.page,
          pageSize: list.pageSize,
        })}`,
      );
      setData(res);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.q, list.page, list.pageSize, status]);

  async function rotate(id: string) {
    if (!confirm(`轮换 workspace ${id} 的 Access Key？旧 key 将立即失效。`)) return;
    setBusy(true);
    try {
      const res = await adminFetch<{ accessKey: string; accessKeyId: string }>(
        `/cloud/v1/admin/workspaces/${encodeURIComponent(id)}/access-key/rotate`,
        { method: "POST" },
      );
      setRotatedKey(res.accessKey);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(w: WorkspaceItem) {
    const disable = w.status !== "disabled";
    if (!confirm(`${disable ? "禁用" : "启用"} workspace ${w.id}？`)) return;
    setBusy(true);
    try {
      await adminFetch(
        `/cloud/v1/admin/workspaces/${encodeURIComponent(w.id)}/${disable ? "disable" : "enable"}`,
        { method: "POST" },
      );
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeWorkspace(id: string) {
    if (!confirm(`永久删除 workspace ${id}？其下设备也会一并删除。`)) return;
    setBusy(true);
    try {
      await adminFetch(`/cloud/v1/admin/workspaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Workspaces</h1>
      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}
      {rotatedKey ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <div className="font-medium mb-2">新 Access Key（仅显示一次）</div>
          <code className="break-all">{rotatedKey}</code>
          <button
            type="button"
            className="ml-3 text-xs underline"
            onClick={() => void navigator.clipboard.writeText(rotatedKey)}
          >
            复制
          </button>
        </div>
      ) : null}

      <form
        onSubmit={list.applySearch}
        className="flex flex-wrap gap-2 items-end bg-[var(--card)] border border-[var(--border)] rounded-xl p-3"
      >
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)] flex-1 min-w-[160px]">
          搜索
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--foreground)]"
            value={list.qDraft}
            onChange={(e) => list.setQDraft(e.target.value)}
            placeholder="workspace id / access key id"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          状态
          <select
            className="border border-[var(--border)] rounded-md px-2 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              list.resetPage();
            }}
          >
            <option value="">有效（隐藏已禁用）</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
            <option value="all">全部（含已禁用）</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-[var(--primary)] text-[var(--primary-fg)] px-3 py-2 text-sm"
        >
          搜索
        </button>
      </form>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-left">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Access Key ID</th>
              <th className="p-3">Default Device</th>
              <th className="p-3">Status</th>
              <th className="p-3">Created</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-[var(--muted)]">
                  暂无 workspace
                </td>
              </tr>
            ) : (
              items.map((w) => (
                <tr key={w.id} className="border-t border-[var(--border)]">
                  <td className="p-3 font-mono text-xs">
                    <Link className="underline" to={`/workspaces/${encodeURIComponent(w.id)}`}>
                      {w.id}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs">{w.accessKeyId}</td>
                  <td className="p-3 font-mono text-xs">{w.defaultDeviceId || "—"}</td>
                  <td className="p-3">
                    <StatusPill status={w.status} />
                  </td>
                  <td className="p-3 text-xs text-[var(--muted)]">
                    {w.createdAt ? new Date(w.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    <Link
                      className="text-xs border border-[var(--border)] rounded px-2 py-1 inline-block"
                      to={`/workspaces/${encodeURIComponent(w.id)}`}
                    >
                      Detail
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-xs border border-[var(--border)] rounded px-2 py-1"
                      onClick={() => void rotate(w.id)}
                    >
                      Rotate Key
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-xs border border-[var(--border)] rounded px-2 py-1"
                      onClick={() => void toggleStatus(w)}
                    >
                      {w.status === "disabled" ? "Enable" : "Disable"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="text-xs border border-[var(--bad)] text-[var(--bad)] rounded px-2 py-1"
                      onClick={() => void removeWorkspace(w.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={list.page}
        pageSize={list.pageSize}
        total={data?.total ?? 0}
        onPageChange={list.setPage}
        onPageSizeChange={list.changePageSize}
      />
    </div>
  );
}

function WorkspaceDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [error, setError] = useState("");
  const [rotatedKey, setRotatedKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setDetail(
        await adminFetch<WorkspaceDetail>(`/cloud/v1/admin/workspaces/${encodeURIComponent(id)}`),
      );
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [id]);

  async function rotate() {
    if (!confirm("轮换 Access Key？旧 key 将立即失效。")) return;
    setBusy(true);
    try {
      const res = await adminFetch<{ accessKey: string }>(
        `/cloud/v1/admin/workspaces/${encodeURIComponent(id)}/access-key/rotate`,
        { method: "POST" },
      );
      setRotatedKey(res.accessKey);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(deviceId: string) {
    setBusy(true);
    try {
      await adminFetch(`/cloud/v1/admin/workspaces/${encodeURIComponent(id)}/default-device`, {
        method: "POST",
        body: JSON.stringify({ deviceId }),
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(deviceId: string) {
    if (!confirm(`撤销设备 ${deviceId}？（软删除）`)) return;
    setBusy(true);
    try {
      await adminFetch(`/cloud/v1/admin/devices/${encodeURIComponent(deviceId)}/revoke`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(deviceId: string) {
    if (!confirm(`永久删除设备 ${deviceId}？工作空间会保留。`)) return;
    setBusy(true);
    try {
      await adminFetch(`/cloud/v1/admin/devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleWorkspace() {
    if (!detail) return;
    const disable = detail.status !== "disabled";
    if (!confirm(`${disable ? "禁用" : "启用"}此 workspace？`)) return;
    setBusy(true);
    try {
      await adminFetch(
        `/cloud/v1/admin/workspaces/${encodeURIComponent(id)}/${disable ? "disable" : "enable"}`,
        { method: "POST" },
      );
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeWorkspace() {
    if (!confirm(`永久删除此 workspace？其下设备也会一并删除。`)) return;
    setBusy(true);
    try {
      await adminFetch(`/cloud/v1/admin/workspaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      nav("/workspaces");
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link className="text-sm text-[var(--muted)]" to="/workspaces">
          ← Workspaces
        </Link>
        <h1 className="text-2xl font-semibold">Workspace</h1>
      </div>
      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}
      {rotatedKey ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <div className="font-medium mb-2">新 Access Key（仅显示一次）</div>
          <code className="break-all">{rotatedKey}</code>
        </div>
      ) : null}
      {detail ? (
        <>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm grid gap-2">
            <div>
              <span className="text-[var(--muted)]">ID </span>
              <code>{detail.id}</code>
            </div>
            <div>
              <span className="text-[var(--muted)]">Status </span>
              {detail.status}
            </div>
            <div>
              <span className="text-[var(--muted)]">Access Key ID </span>
              <code>{detail.accessKeyId}</code>
            </div>
            <div>
              <span className="text-[var(--muted)]">Default Device </span>
              <code>{detail.defaultDeviceId || "—"}</code>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                disabled={busy}
                className="w-fit text-xs border border-[var(--border)] rounded px-2 py-1"
                onClick={() => void rotate()}
              >
                Rotate Access Key
              </button>
              <button
                type="button"
                disabled={busy}
                className="w-fit text-xs border border-[var(--border)] rounded px-2 py-1"
                onClick={() => void toggleWorkspace()}
              >
                {detail.status === "disabled" ? "Enable" : "Disable"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="w-fit text-xs border border-[var(--bad)] text-[var(--bad)] rounded px-2 py-1"
                onClick={() => void removeWorkspace()}
              >
                删除工作空间
              </button>
              <Link
                className="w-fit text-xs border border-[var(--border)] rounded px-2 py-1"
                to={`/devices?workspaceId=${encodeURIComponent(detail.id)}`}
              >
                查看设备列表
              </Link>
              <Link
                className="w-fit text-xs border border-[var(--border)] rounded px-2 py-1"
                to={`/audit?workspaceId=${encodeURIComponent(detail.id)}`}
              >
                查看审计
              </Link>
            </div>
          </div>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--background)] text-left">
                <tr>
                  <th className="p-3">Device</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Version</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {detail.devices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-[var(--muted)]">
                      暂无设备
                    </td>
                  </tr>
                ) : (
                  detail.devices.map((d) => {
                    const isDefault = detail.defaultDeviceId === d.id;
                    return (
                      <tr key={d.id} className="border-t border-[var(--border)]">
                        <td className="p-3">
                          <div className="font-medium">
                            {d.name || d.id}
                            {isDefault ? (
                              <span className="ml-2 text-xs text-[var(--ok)]">default</span>
                            ) : null}
                          </div>
                          <div className="text-xs text-[var(--muted)]">{d.id}</div>
                        </td>
                        <td className="p-3">{d.online ? "Online" : "Offline"}</td>
                        <td className="p-3">{d.clientVersion || "—"}</td>
                        <td className="p-3 text-right space-x-2">
                          {!isDefault ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="text-xs border border-[var(--border)] rounded px-2 py-1"
                              onClick={() => void setDefault(d.id)}
                            >
                              Set Default
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            className="text-xs border border-[var(--border)] rounded px-2 py-1"
                            onClick={() => void revoke(d.id)}
                          >
                            Revoke
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="text-xs border border-[var(--bad)] text-[var(--bad)] rounded px-2 py-1"
                            onClick={() => void removeDevice(d.id)}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="text-sm text-[var(--muted)]">Loading…</div>
      )}
    </div>
  );
}

function AuditPage() {
  const [searchParams] = useSearchParams();
  const list = useListQueryState({ pageSize: 30 });
  const [workspaceId, setWorkspaceId] = useState(() => searchParams.get("workspaceId") || "");
  const [eventType, setEventType] = useState(() => searchParams.get("eventType") || "");
  const [data, setData] = useState<PageResponse<AuditEvent> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setWorkspaceId(searchParams.get("workspaceId") || "");
    setEventType(searchParams.get("eventType") || "");
    list.resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function load() {
    try {
      const res = await adminFetch<PageResponse<AuditEvent>>(
        `/cloud/v1/admin/audit${buildQuery({
          q: list.q,
          workspaceId,
          eventType,
          page: list.page,
          pageSize: list.pageSize,
        })}`,
      );
      setData(res);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.q, list.page, list.pageSize, workspaceId, eventType]);

  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Audit</h1>
      <form
        onSubmit={list.applySearch}
        className="flex flex-wrap gap-2 items-end bg-[var(--card)] border border-[var(--border)] rounded-xl p-3"
      >
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)] flex-1 min-w-[160px]">
          搜索
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--foreground)]"
            value={list.qDraft}
            onChange={(e) => list.setQDraft(e.target.value)}
            placeholder="事件类型 / workspace / meta"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)] min-w-[140px]">
          Workspace
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 text-sm font-mono text-[var(--foreground)]"
            value={workspaceId}
            onChange={(e) => {
              setWorkspaceId(e.target.value.trim());
              list.resetPage();
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)] min-w-[140px]">
          Event type
          <input
            className="border border-[var(--border)] rounded-md px-3 py-2 text-sm text-[var(--foreground)]"
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value.trim());
              list.resetPage();
            }}
            placeholder="device.revoked"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-[var(--primary)] text-[var(--primary-fg)] px-3 py-2 text-sm"
        >
          搜索
        </button>
      </form>

      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-left">
            <tr>
              <th className="p-3">Time</th>
              <th className="p-3">Event</th>
              <th className="p-3">Workspace</th>
              <th className="p-3">Meta</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-[var(--muted)]">
                  暂无审计记录
                </td>
              </tr>
            ) : (
              items.map((ev) => (
                <tr key={ev.id} className="border-t border-[var(--border)] align-top">
                  <td className="p-3 text-xs text-[var(--muted)] whitespace-nowrap">
                    {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className="p-3 font-mono text-xs">{ev.eventType}</td>
                  <td className="p-3 font-mono text-xs">
                    {ev.workspaceId ? (
                      <Link
                        className="underline"
                        to={`/workspaces/${encodeURIComponent(ev.workspaceId)}`}
                      >
                        {ev.workspaceId}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    <pre className="text-xs whitespace-pre-wrap break-all max-w-xl text-[var(--muted)]">
                      {JSON.stringify(ev.metaJson ?? {}, null, 0)}
                    </pre>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={list.page}
        pageSize={list.pageSize}
        total={data?.total ?? 0}
        onPageChange={list.setPage}
        onPageSizeChange={list.changePageSize}
      />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <OverviewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/devices"
        element={
          <RequireAuth>
            <DevicesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces"
        element={
          <RequireAuth>
            <WorkspacesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/workspaces/:id"
        element={
          <RequireAuth>
            <WorkspaceDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireAuth>
            <AuditPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
