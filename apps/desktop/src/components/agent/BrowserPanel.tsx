/**
 * 右侧「浏览器」tab：主窗口内嵌多个子 webview（Rust `Window::add_child`），每个浏览器
 * 标签对应一个子 webview（label = `giteam-browser-{tabId}`）。
 *
 * 顶部 tab 条（新建/切换/关闭）；控制栏（后退/前进/重载/URL/系统浏览器）作用于当前
 * active tab；下方占位区由 Rust active 子 webview 叠加渲染。ResizeObserver 测占位区
 * → invoke `set_browser_bounds`（带 activeTabId）；active tab 的 url 变 → `open_browser_embedded`
 * （创建或导航 + 显示）；切浏览器标签 → `hide_browser`(旧) + `select_browser_tab`(新，不重载)；
 * 切到其他右侧 tab 卸载 → `hide_all_browser`（保留会话不销毁）。
 *
 * 通信地基：监听 `giteam://browser-nav`（含 tab_id），按 tab_id 合并对应标签的 url/title/loading。
 *
 * web 端（非 Tauri）无内嵌能力：占位区显示降级提示。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Loader2, Plus, RotateCw, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../ui/button";
import { IS_TAURI, listen } from "../../lib/platform";
import { makeId } from "../../lib/browserRuntime";
import { cn } from "../../lib/utils";

/** 子 webview 导航/状态回传事件（任一字段缺失表示「不更新」）。 */
type BrowserNavEvent = {
  tab_id?: string;
  url?: string;
  /** "started" | "finished" */
  state?: string;
  title?: string;
};

type BrowserTab = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
};

/** 从 url 安全提取 hostname 作 title 缺省时的展示。 */
function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname || raw;
  } catch {
    return raw;
  }
}

function newTabState(url = ""): BrowserTab {
  return { id: makeId(), url, title: "", loading: false };
}

export function BrowserPanel({ url }: { url: string }) {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [newTabState(url)]);
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? "");
  const active = tabs.find((t) => t.id === activeId);
  const activeUrl = active?.url ?? "";
  const [input, setInput] = useState(activeUrl);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // 跟踪每个 tab 上次 open 的 url：切 tab（url 不变）只 select 不 open，避免 reload；
  // url 变才 navigate；首次创建才 open。
  const openedUrlRef = useRef<Map<string, string>>(new Map());
  // prop url 作为「打开请求」去重，避免重复建 tab。
  const openedPropUrlRef = useRef(url);

  // 地址栏跟随 active tab 的 url（切 tab / 外部导航后）。
  useEffect(() => {
    setInput(active?.url ?? "");
  }, [activeId, active?.url]);

  // prop url 变化（点 web 工具「打开」等）→ 新建 tab 打开。
  useEffect(() => {
    if (!url || url === openedPropUrlRef.current) return;
    openedPropUrlRef.current = url;
    const t = newTabState(url);
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  }, [url]);

  // active tab 的 url 变化 → open（首次创建 / 导航）。切 tab（url 不变）由 selectTab 的
  // select_browser_tab 处理，这里靠 openedUrlRef 去重跳过，避免 reload。
  useLayoutEffect(() => {
    if (!IS_TAURI || !activeId || !activeUrl) return;
    if (openedUrlRef.current.get(activeId) === activeUrl) return;
    openedUrlRef.current.set(activeId, activeUrl);
    void invoke("open_browser_embedded", { tabId: activeId, url: activeUrl, ...readBounds() }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeUrl]);

  // 监听子 webview 导航/状态回写，按 tab_id 更新对应 tab。
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void listen<BrowserNavEvent>("giteam://browser-nav", (event) => {
      if (!alive) return;
      const p = event.payload;
      if (!p.tab_id) return;
      setTabs((prev) =>
        prev.map((t) =>
          t.id !== p.tab_id
            ? t
            : {
                ...t,
                url: p.url && p.url.length ? p.url : t.url,
                title: typeof p.title === "string" ? p.title : t.title,
                loading: p.state === "started" ? true : p.state === "finished" ? false : t.loading,
              }
        )
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const readBounds = () => {
    const r = viewportRef.current?.getBoundingClientRect();
    return r
      ? {
          x: Math.round(r.left),
          y: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
        }
      : { x: 0, y: 0, width: 600, height: 400 };
  };

  // 同步 active tab 占位区位置/尺寸（resize / 滚动 / 面板宽度调整）。
  useLayoutEffect(() => {
    if (!IS_TAURI) return;
    const node = viewportRef.current;
    if (!node) return;
    const sync = () => {
      const b = readBounds();
      if (b.width <= 1 || b.height <= 1) return;
      void invoke("set_browser_bounds", { tabId: activeIdRef.current, ...b }).catch(() => {});
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载（切到其他右侧 tab）：隐藏所有 tab 的子 webview，保留会话不销毁。
  useEffect(() => {
    if (!IS_TAURI) return;
    return () => {
      void invoke("hide_all_browser").catch(() => {});
    };
  }, []);

  const selectTab = (id: string) => {
    if (id === activeId) return;
    const oldId = activeId;
    setActiveId(id);
    if (IS_TAURI) {
      void invoke("hide_browser", { tabId: oldId }).catch(() => {});
      const t = tabs.find((x) => x.id === id);
      if (t?.url) {
        // select 不 navigate（避免 reload 丢滚动位置）；标记该 url 已 show，
        // 使上面的 open effect 在切回时跳过 open。
        openedUrlRef.current.set(id, t.url);
        void invoke("select_browser_tab", { tabId: id, ...readBounds() }).catch(() => {});
      }
    }
  };

  const addTab = () => {
    // 切到空白新 tab 前 hide 当前 active（空白 tab 无 webview）。
    if (IS_TAURI) void invoke("hide_browser", { tabId: activeId }).catch(() => {});
    const t = newTabState();
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      if (IS_TAURI) {
        void invoke("close_browser", { tabId: id }).catch(() => {});
        openedUrlRef.current.delete(id);
      }
      const next = prev.filter((t) => t.id !== id);
      const fallback = next.length ? next : [newTabState()];
      if (id === activeId) {
        const replacement = next[idx] ?? next[idx - 1] ?? fallback[0];
        setActiveId(replacement.id);
        if (IS_TAURI && replacement.url) {
          openedUrlRef.current.set(replacement.id, replacement.url);
          void invoke("select_browser_tab", { tabId: replacement.id, ...readBounds() }).catch(() => {});
        }
      }
      return fallback;
    });
  };

  const navigate = (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, url: trimmed } : t)));
    if (IS_TAURI) void invoke("navigate_browser", { tabId: activeId, url: trimmed }).catch(() => {});
    setInput(trimmed);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* tab 条 */}
      <div className="gt-subtle-scrollbar flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border/60 bg-background px-1 pt-1">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeId}
            onClick={() => selectTab(t.id)}
            className={cn(
              "group flex w-[140px] max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2 py-1 text-xs outline-none",
              t.id === activeId
                ? "border-border bg-background text-foreground"
                : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/50"
            )}
          >
            {t.loading ? (
              <Loader2 className="size-3 shrink-0 animate-spin" />
            ) : (
              <Globe className="size-3 shrink-0 opacity-60" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {t.title || hostnameOf(t.url) || "新标签页"}
            </span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
              className="shrink-0 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
              title="关闭标签"
            >
              <X className="size-3" />
            </span>
          </div>
        ))}
        <button
          type="button"
          onClick={addTab}
          title="新建标签页"
          className="flex shrink-0 items-center px-1.5 text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* 控制栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 py-1.5">
        <Button variant="ghost" size="icon" className="size-7" title="后退" disabled={!IS_TAURI || !activeUrl}
          onClick={() => void invoke("browser_go", { tabId: activeId, delta: -1 }).catch(() => {})}>
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" title="前进" disabled={!IS_TAURI || !activeUrl}
          onClick={() => void invoke("browser_go", { tabId: activeId, delta: 1 }).catch(() => {})}>
          <ArrowRight className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" title="重载" disabled={!IS_TAURI || !activeUrl}
          onClick={() => void invoke("reload_browser", { tabId: activeId }).catch(() => {})}>
          <RotateCw className="size-3.5" />
        </Button>
        <form
          className="relative flex min-w-0 flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入网址，如 https://example.com"
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 pr-7 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {active?.loading ? (
            <Loader2 className="pointer-events-none absolute right-2 size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </form>
        <Button variant="ghost" size="icon" className="size-7" title="用系统浏览器打开"
          disabled={!IS_TAURI || !activeUrl}
          onClick={() => activeUrl && void invoke("open_external_url", { url: activeUrl }).catch(() => {})}>
          <ExternalLink className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" title="关闭当前标签" disabled={!IS_TAURI}
          onClick={() => closeTab(activeId)}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* 标题/状态条：loading 时显示加载指示，否则显示 active tab 的 title（缺省 hostname）。 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 bg-background px-2 py-1 text-[10px] text-muted-foreground">
        {active?.loading ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : (
          <Globe className="size-3 shrink-0 opacity-60" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {active?.loading
            ? "加载中…"
            : active?.title || (activeUrl ? hostnameOf(activeUrl) : "输入网址开始浏览")}
        </span>
      </div>

      {/* 占位区：Rust active 子 webview 叠加渲染；web 端显示降级提示。 */}
      <div ref={viewportRef} className="relative min-h-0 flex-1 bg-muted/30">
        {!IS_TAURI ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            <div className="space-y-2">
              <Globe className="mx-auto size-6 opacity-50" />
              <p>Web 端不支持内嵌浏览器，点击右上角图标用系统浏览器打开。</p>
              {activeUrl ? (
                <Button variant="secondary" size="sm"
                  onClick={() => window.open(activeUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="size-3.5" /> 打开网页
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
