//! 内置浏览器：主窗口内嵌多个子 webview（`Window::add_child`），网页在右侧「浏览器」tab
//! 直接渲染。每个浏览器标签对应一个子 webview，label = `giteam-browser-{tabId}`。
//!
//! 多 webview 内嵌需 tauri `unstable` feature（已启用）。位置/尺寸由前端 `BrowserPanel`
//! 用 ResizeObserver 测占位区 getBoundingClientRect 后 invoke `set_browser_bounds` 同步；
//! URL 输入 → `navigate_browser`；切浏览器标签 → `select_browser_tab`（show+bounds，不重载）；
//! 切到其他右侧 tab 卸载 → `hide_all_browser`（保留会话不销毁）。
//!
//! 跨平台：macOS WKWebView 原生支持子 webview；Windows WebView2 的 HWND z-order、
//! Linux WebKitGTK 的多 webview 布局需真机验证（本地仅 macOS 可测）。
//!
//! SSRF 不在此防护：这是用户主动浏览（非 agent 抓取），web_fetch 工具侧已对 agent
//! 的抓取做了 SSRF 防护。
//!
//! 通信地基（P0）：on_navigation / on_page_load 钩子在 Rust 端捕获每个 tab 的导航 URL
//! 与加载态，经 `giteam://browser-nav`（含 tab_id）回写前端地址栏/loading；init_script
//! 注入 content bridge 经 `browser_event` 回传 title/错误（P2/P3 扩展 agent 操作/标注）。
//! 主动回传依赖 `window.__TAURI_INTERNALS__.invoke`，External URL 页面是否可用是已知
//! spike 点；不可用时仅 title 暂缺，地址栏回写不受影响（走 Rust 钩子）。

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

use super::browser_controller::BrowserActionRegistry;
use giteam_core::pi_agent::BrowserActionResult;

/// 内嵌浏览器子 webview label 前缀，完整 label = `{prefix}{tabId}`。
const BROWSER_LABEL_PREFIX: &str = "giteam-browser-";

/// 由 tabId 派生子 webview label；只保留 alnum/-/_ 防注入，空则用 "default"。
fn label_of(tab_id: &str) -> String {
    let safe: String = tab_id
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
        .collect();
    format!("{BROWSER_LABEL_PREFIX}{}", if safe.is_empty() { "default" } else { safe.as_str() })
}

/// 子 webview → 前端的导航/状态事件 payload。url/state/title 任一为 None 表示「不更新」，
/// 前端按非空字段合并对应 tab 的地址栏/title/loading。
#[derive(Clone, Serialize)]
struct BrowserNavPayload {
    tab_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
}

/// 子 webview 主动回传的事件（init_script 注入的 bridge 调 invoke 上报）。
/// pub：作为 `browser_event` Tauri command 的参数类型，可见性需匹配 pub command。
#[derive(Deserialize)]
pub struct BrowserEvent {
    #[serde(default)]
    tab_id: Option<String>,
    kind: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    payload: Option<serde_json::Value>,
    // P2 action_result 回传字段（requestId 配对 RPC）。
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn emit_browser_nav(
    app: &AppHandle,
    tab_id: &str,
    url: Option<String>,
    state: Option<String>,
    title: Option<String>,
) {
    let _ = app.emit(
        "giteam://browser-nav",
        BrowserNavPayload {
            tab_id: tab_id.to_string(),
            url,
            state,
            title,
        },
    );
}

/// 构造注入到某个 tab 子 webview 的 content bridge（携带该 tab 的 id，回传时带上）。
/// P0：上报 title + 错误；P2/P3 在此基础上扩展 agent 操作实现与标注拾取。
fn make_init_script(tab_id: &str) -> String {
    let tab_id_json = serde_json::to_string(tab_id).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"(function(){{
  if (window.__giteamBrowserBridge) return;
  window.__giteamBrowserBridge = true;
  var TAB_ID = {tab_id_json};
  function report(payload){{
    var msg = Object.assign({{ tab_id: TAB_ID }}, payload);
    try {{
      var json = JSON.stringify(msg);
      // 大数据截断：location URL 限长（WKWebView navigation 实测 ~80k，保险截到 50k；
      // encodeURIComponent 约 1.3x 膨胀，screenshot base64 常超限——图片类降级）。
      if (json.length > 50000) {{
        if (msg.image) {{ delete msg.image; msg.error = (msg.error || '') + ' [截图数据过大，location 通道无法承载]'; }}
        if (msg.text) msg.text = msg.text.slice(0, 48000) + '…[truncated]';
        json = JSON.stringify(msg);
      }}
      // 主通道：location 跳转 → Rust on_navigation 拦截 giteam-action://，return false 取消
      // （页面不跳）。fetch custom scheme 不可用——fetch API 规范仅支持 http/https/blob/data，
      // custom scheme 的 fetch 在浏览器层直接失败（不发请求，WKURLSchemeHandler 收不到）。
      // navigation 是 External URL 子 webview 唯一可靠回传通道（100% 触发 decidePolicyForNavigationAction）。
      location.href = 'giteam-action://localhost/r?d=' + encodeURIComponent(json);
    }} catch(e) {{}}
    // 兜底：invoke（本地 tauri:// 页面下可用；External URL postMessage 桥不可达，静默失败）。
    try {{
      var i = window.__TAURI_INTERNALS__;
      if (i && typeof i.invoke === 'function') i.invoke('browser_event', msg);
    }} catch(e2) {{}}
  }}
  window.__giteamReport = report;
  window.addEventListener('load', function(){{
    report({{ kind: 'title', title: (document && document.title) || '' }});
  }});
  window.addEventListener('error', function(ev){{
    report({{ kind: 'error', payload: {{ message: String((ev && ev.message) || '').slice(0, 500) }} }});
  }});
}})();"#
    )
}

/// 校验并规范化 URL：补 https:// 前缀 + 校验可解析。
fn normalize_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL 不能为空".into());
    }
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    url::Url::parse(&with_scheme).map_err(|e| format!("无效 URL：{e}"))?;
    Ok(with_scheme)
}

fn parse_url(raw: &str) -> Result<url::Url, String> {
    url::Url::parse(&normalize_url(raw)?).map_err(|e| format!("无效 URL：{e}"))
}

/// 创建或复用某个 tab 的子 webview：导航到 url 并定位到占位区坐标/尺寸。
/// 已存在则导航（url 变化时）+ 重定位 + 显示；首次创建时挂载导航/加载钩子与 content bridge。
#[tauri::command]
pub fn open_browser_embedded(
    app: AppHandle,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    let label = label_of(&tab_id);

    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.navigate(parsed);
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(width, height));
        let _ = wv.show();
        let _ = wv.set_focus();
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    // on_navigation / on_page_load 在 Rust 端捕获导航，不依赖页面注入，是地址栏回写主通道。
    let app_for_nav = app.clone();
    let app_for_load = app.clone();
    let tab_for_nav = tab_id.clone();
    let tab_for_load = tab_id.clone();
    let _wv = window
        .add_child(
            WebviewBuilder::new(label, WebviewUrl::External(parsed))
                .on_navigation(move |nav_url| {
                    // bridge 回传通道：location 跳转到 giteam-action://，解析 query 回传事件，
                    // return false 取消导航（页面不跳）。fetch custom scheme 不可用（fetch API
                    // 规范不支持 custom scheme，浏览器层直接拒），navigation 是 External URL 子
                    // webview 唯一可靠回传通道（100% 触发 decidePolicyForNavigationAction）。
                    if nav_url.scheme() == "giteam-action" {
                        if let Some(json) = nav_url
                            .query_pairs()
                            .find(|(k, _)| k == "d")
                            .map(|(_, v)| v.to_string())
                        {
                            if let Ok(event) = serde_json::from_str::<BrowserEvent>(&json) {
                                handle_browser_bridge(&app_for_nav, event);
                            }
                        }
                        return false;
                    }
                    emit_browser_nav(
                        &app_for_nav,
                        &tab_for_nav,
                        Some(nav_url.to_string()),
                        Some("started".into()),
                        None,
                    );
                    true
                })
                .on_page_load(move |wv, payload| {
                    let (state, finished) = match payload.event() {
                        PageLoadEvent::Started => ("started", false),
                        PageLoadEvent::Finished => ("finished", true),
                    };
                    emit_browser_nav(
                        &app_for_load,
                        &tab_for_load,
                        Some(payload.url().to_string()),
                        Some(state.into()),
                        None,
                    );
                    // Finished 后主动 eval 读 title 回传（注入 bridge 的 load 作双保险）。
                    if finished {
                        let _ = wv.eval(
                            "try{var i=window.__TAURI_INTERNALS__;if(i&&i.invoke){i.invoke('browser_event',{kind:'title',title:(document&&document.title)||''})}}catch(e){}",
                        );
                    }
                })
                .initialization_script(make_init_script(&tab_id)),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("创建浏览器子 webview 失败：{e}"))?;
    Ok(())
}

/// 切换到某个已存在的 tab：show + 重定位 + 聚焦，不导航（避免重载丢失滚动位置）。
#[tauri::command]
pub fn select_browser_tab(
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label_of(&tab_id)) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(width, height));
        let _ = wv.show();
        let _ = wv.set_focus();
    }
    Ok(())
}

/// 导航到新 URL（地址栏输入提交）。
#[tauri::command]
pub fn navigate_browser(app: AppHandle, tab_id: String, url: String) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    let wv = app
        .get_webview(&label_of(&tab_id))
        .ok_or_else(|| "浏览器未打开".to_string())?;
    wv.navigate(parsed).map_err(|e| format!("导航失败：{e}"))
}

/// 同步某个 tab 子 webview 位置/尺寸（前端 ResizeObserver / scroll / resize 触发）。
#[tauri::command]
pub fn set_browser_bounds(
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label_of(&tab_id)) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(width, height));
    }
    Ok(())
}

/// 隐藏某个 tab 子 webview（切到其他浏览器标签时调用，保留会话不销毁）。
#[tauri::command]
pub fn hide_browser(app: AppHandle, tab_id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label_of(&tab_id)) {
        let _ = wv.hide();
    }
    Ok(())
}

/// 隐藏所有浏览器子 webview（切到其他右侧 tab 卸载 BrowserPanel 时批量调用）。
#[tauri::command]
pub fn hide_all_browser(app: AppHandle) -> Result<(), String> {
    for (label, wv) in app.webviews() {
        if label.starts_with(BROWSER_LABEL_PREFIX) {
            let _ = wv.hide();
        }
    }
    Ok(())
}

/// 关闭并销毁某个 tab 子 webview（关闭浏览器标签）。
#[tauri::command]
pub fn close_browser(app: AppHandle, tab_id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label_of(&tab_id)) {
        let _ = wv.close();
    }
    Ok(())
}

/// 重新加载某个 tab 当前页。
#[tauri::command]
pub fn reload_browser(app: AppHandle, tab_id: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label_of(&tab_id)) {
        let _ = wv.reload();
    }
    Ok(())
}

/// 某个 tab 前进/后退历史：delta = -1 后退、+1 前进。
#[tauri::command]
pub fn browser_go(app: AppHandle, tab_id: String, delta: i32) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label_of(&tab_id)) {
        let _ = wv.eval(&format!("history.go({delta});"));
    }
    Ok(())
}

/// 处理子 webview 经 bridge 回传的事件（title/action_result/error/...）。
/// pub：`browser_event` command（invoke 通道）与 `giteam-bridge` custom protocol
/// handler（fetch 通道）共用——两条回传路径汇聚于此。
pub fn handle_browser_bridge(app: &AppHandle, event: BrowserEvent) {
    match event.kind.as_str() {
        "title" => {
            if let Some(tab_id) = event.tab_id.clone() {
                let title = event.title.filter(|t| !t.is_empty());
                emit_browser_nav(app, &tab_id, None, None, title);
            }
        }
        "action_result" => {
            // browser_use 操作回传：按 request_id 唤醒等待的 controller execute。
            if let Some(req_id) = event.request_id.as_deref() {
                let result = BrowserActionResult {
                    ok: event.ok.unwrap_or(false),
                    text: event.text.filter(|t| !t.is_empty()),
                    image: event.image.filter(|s| !s.is_empty()),
                    error: event.error.filter(|s| !s.is_empty()),
                };
                if let Some(registry) = app.try_state::<Arc<BrowserActionRegistry>>() {
                    registry.complete(req_id, result);
                }
            }
        }
        "error" | "annotation" | "dom" | "screenshot" => {
            let _ = app.emit(
                "giteam://browser-event",
                serde_json::json!({
                    "tab_id": event.tab_id,
                    "kind": event.kind,
                    "payload": event.payload,
                }),
            );
        }
        _ => {}
    }
}

/// 接收子 webview 经 invoke 的回传（本地 tauri:// 页面用；External URL 走 giteam-bridge）。
/// - `title`：合并进 `giteam://browser-nav`（按 tab_id 更新对应 tab 的地址栏/title）。
/// - `error` / `annotation` / `dom` / `screenshot`：转发 `giteam://browser-event`（P2/P3 消费）。
#[tauri::command]
pub fn browser_event(app: AppHandle, event: BrowserEvent) -> Result<(), String> {
    handle_browser_bridge(&app, event);
    Ok(())
}
