import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  adminFetch,
  getAdminToken,
  setAdminToken,
  setGatewayUrl,
  type AdminDevice,
  type Metrics,
  type WorkspaceDetail,
  type WorkspaceItem,
} from "./api";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-[var(--border)] bg-[var(--card)] p-4 flex flex-col gap-3">
        <div className="text-sm font-semibold tracking-wide">Giteam Cloud</div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link className="px-2 py-1.5 rounded hover:bg-[var(--background)]" to="/">
            Overview
          </Link>
          <Link className="px-2 py-1.5 rounded hover:bg-[var(--background)]" to="/devices">
            Devices
          </Link>
          <Link className="px-2 py-1.5 rounded hover:bg-[var(--background)]" to="/workspaces">
            Workspaces
          </Link>
          <Link className="px-2 py-1.5 rounded hover:bg-[var(--background)]" to="/settings">
            Settings
          </Link>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getAdminToken()) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
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
    // Same-origin only: console is served by the gateway it manages.
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

  function logout() {
    setAdminToken("");
    window.location.assign("/login");
  }

  return (
    <div className="flex flex-col gap-4 max-w-lg">
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Overview</h1>
      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}
      <div className="grid grid-cols-3 gap-4">
        {[
          ["Workspaces", metrics?.workspaceCount],
          ["Devices", metrics?.deviceCount],
          ["Online", metrics?.onlineDeviceCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
            <div className="text-sm text-[var(--muted)]">{label}</div>
            <div className="text-3xl font-semibold mt-2">{value ?? "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevicesPage() {
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      setDevices(await adminFetch<AdminDevice[]>("/cloud/v1/admin/devices"));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function revoke(id: string) {
    if (!confirm(`Revoke device ${id}?`)) return;
    await adminFetch(`/cloud/v1/admin/devices/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
    });
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Devices</h1>
      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-left">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Status</th>
              <th className="p-3">Workspace</th>
              <th className="p-3">Version</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="border-t border-[var(--border)]">
                <td className="p-3">
                  <div className="font-medium">{d.name || d.id}</div>
                  <div className="text-xs text-[var(--muted)]">{d.id}</div>
                </td>
                <td className="p-3">
                  <span
                    className="inline-flex px-2 py-0.5 rounded-full text-xs"
                    style={{
                      background: d.online ? "#dcfce7" : "#f3f4f6",
                      color: d.online ? "var(--ok)" : "var(--muted)",
                    }}
                  >
                    {d.online ? "Online" : d.status}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs">
                  <Link className="underline" to={`/workspaces/${encodeURIComponent(d.workspaceId)}`}>
                    {d.workspaceId}
                  </Link>
                </td>
                <td className="p-3">{d.clientVersion || "—"}</td>
                <td className="p-3 text-right">
                  <button
                    className="text-xs border border-[var(--border)] rounded px-2 py-1"
                    onClick={() => revoke(d.id)}
                    type="button"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkspacesPage() {
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [error, setError] = useState("");
  const [rotatedKey, setRotatedKey] = useState("");

  async function load() {
    try {
      setItems(await adminFetch<WorkspaceItem[]>("/cloud/v1/admin/workspaces"));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function rotate(id: string) {
    try {
      const res = await adminFetch<{ accessKey: string; accessKeyId: string }>(
        `/cloud/v1/admin/workspaces/${encodeURIComponent(id)}/access-key/rotate`,
        { method: "POST" },
      );
      setRotatedKey(res.accessKey);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Workspaces</h1>
      {error ? <div className="text-[var(--bad)] text-sm">{error}</div> : null}
      {rotatedKey ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <div className="font-medium mb-2">新 Access Key（仅显示一次）</div>
          <code className="break-all">{rotatedKey}</code>
        </div>
      ) : null}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-left">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Access Key ID</th>
              <th className="p-3">Default Device</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id} className="border-t border-[var(--border)]">
                <td className="p-3 font-mono text-xs">
                  <Link className="underline" to={`/workspaces/${encodeURIComponent(w.id)}`}>
                    {w.id}
                  </Link>
                </td>
                <td className="p-3 font-mono text-xs">{w.accessKeyId}</td>
                <td className="p-3 font-mono text-xs">{w.defaultDeviceId || "—"}</td>
                <td className="p-3">{w.status}</td>
                <td className="p-3 text-right space-x-2">
                  <Link
                    className="text-xs border border-[var(--border)] rounded px-2 py-1 inline-block"
                    to={`/workspaces/${encodeURIComponent(w.id)}`}
                  >
                    Detail
                  </Link>
                  <button
                    type="button"
                    className="text-xs border border-[var(--border)] rounded px-2 py-1"
                    onClick={() => void rotate(w.id)}
                  >
                    Rotate Key
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkspaceDetailPage() {
  const { id = "" } = useParams();
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
    if (!confirm(`Revoke device ${deviceId}?`)) return;
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
            <button
              type="button"
              disabled={busy}
              className="w-fit text-xs border border-[var(--border)] rounded px-2 py-1"
              onClick={() => void rotate()}
            >
              Rotate Access Key
            </button>
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
                {detail.devices.map((d) => {
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
                      </td>
                    </tr>
                  );
                })}
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
