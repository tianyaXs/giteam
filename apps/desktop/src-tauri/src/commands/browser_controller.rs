//! desktop 端 `BrowserController` 实现：把 agent 的 `browser_use` 操作落到内置浏览器
//! 子 webview。giteam-core 定义抽象 trait，本文件实现并经 `PiSessionConfig` 注入。
//!
//! P2：navigate 直接驱动 webview；click/type/read_dom/eval_read/screenshot 经 requestId
//! 配对的 RPC 实现——Rust eval 注入带 requestId 的操作 JS，JS 经 init_script 的
//! `window.__giteamReport` 回传 action_result，Rust 侧 `BrowserActionRegistry` pending
//! map 按 requestId 唤醒等待的 execute（15s 超时兜底，防 IPC bridge 不可用时永久阻塞）。
//! html2canvas 截图当前用 CDN 按需加载（缓存到 window.__giteamHtml2canvas）；CSP 严格的
//! 页面可能拦外链脚本，届时换 include_str! 本地预载。

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use giteam_core::pi_agent::{BrowserAction, BrowserActionResult, BrowserController};

/// 内嵌浏览器子 webview label 前缀（与 `browser_panel.rs` 一致）。
const BROWSER_LABEL_PREFIX: &str = "giteam-browser-";

/// requestId 配对的 pending 注册表（app state 共享）。
///
/// `TauriBrowserController::run_action` 注册 sender 并 eval 操作 JS；
/// `browser_event` command 收到 `action_result` 按 `request_id` 唤醒等待的 execute。
/// 跨 controller/command 共享，故提升为 app state（`main.rs` setup 注入）。
#[derive(Default)]
pub struct BrowserActionRegistry {
    next_id: AtomicU64,
    pending: Mutex<HashMap<String, oneshot::Sender<BrowserActionResult>>>,
}

impl BrowserActionRegistry {
    /// 生成唯一 requestId。
    pub fn generate_id(&self) -> String {
        format!("ba-{}", self.next_id.fetch_add(1, Ordering::Relaxed))
    }

    /// 注册等待中的 sender，返回 receiver 供 execute await。
    pub fn register(&self, id: &str) -> oneshot::Receiver<BrowserActionResult> {
        let (tx, rx) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id.to_string(), tx);
        }
        rx
    }

    /// 收到回传时按 requestId 唤醒等待的 execute；无匹配（已超时清理）静默丢弃。
    pub fn complete(&self, id: &str, result: BrowserActionResult) {
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(tx) = pending.remove(id) {
                let _ = tx.send(result);
            }
        }
    }

    /// 超时/放弃时清理 pending 槽，避免泄漏。
    pub fn cancel(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(id);
        }
    }
}

/// desktop 端 BrowserController。
pub struct TauriBrowserController {
    app: AppHandle,
}

impl TauriBrowserController {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    /// 当前可见的浏览器 webview。骨架：取第一个 `giteam-browser-*` webview
    /// （多标签下精确 active 跟踪为后续优化）。
    fn active_webview(&self) -> Option<tauri::Webview> {
        self.app
            .webviews()
            .into_iter()
            .find(|(label, _)| label.starts_with(BROWSER_LABEL_PREFIX))
            .map(|(_, wv)| wv)
    }

    /// 取 app state 中的 registry（`main.rs` setup 注入）。
    fn registry(&self) -> Option<Arc<BrowserActionRegistry>> {
        self.app
            .try_state::<Arc<BrowserActionRegistry>>()
            .map(|state| state.inner().clone())
    }

    /// 字符串安全嵌入 JS 字面量（selector/text/js 等），防注入。
    fn js_lit(s: &str) -> String {
        serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
    }

    /// 注入带 requestId 的操作 JS，等待 `browser_event` 回传 action_result（15s 超时）。
    async fn run_action(&self, body: String) -> BrowserActionResult {
        let Some(wv) = self.active_webview() else {
            return BrowserActionResult::err("内置浏览器未打开任何标签页");
        };
        let Some(registry) = self.registry() else {
            return BrowserActionResult::err("浏览器动作注册表未初始化");
        };
        let req_id = registry.generate_id();
        let rx = registry.register(&req_id);
        // 包装：async IIFE 执行 body，结果/异常经 __giteamReport 回传 action_result。
        let js = format!(
            "(function(){{\
               var R={req_id};\
               function done(o){{try{{window.__giteamReport(Object.assign({{kind:'action_result',request_id:R}},o));}}catch(e){{}}}}\
               try{{\
                 Promise.resolve((async(){{{body}}})()).then(\
                   function(v){{done(Object.assign({{ok:true}},v));}},\
                   function(e){{done({{ok:false,error:String((e&&(e.message||e))||e).slice(0,500)}});}}\
                 );\
               }}catch(e){{done({{ok:false,error:String((e&&(e.message||e))||e).slice(0,500)}});}}\
             }})();",
            req_id = Self::js_lit(&req_id),
            body = body,
        );
        if let Err(e) = wv.eval(&js) {
            return BrowserActionResult::err(format!("注入操作脚本失败：{e}"));
        }
        match tokio::time::timeout(Duration::from_secs(15), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => BrowserActionResult::err("浏览器操作回传通道关闭"),
            Err(_) => {
                registry.cancel(&req_id);
                BrowserActionResult::err("浏览器操作超时（15s）——页面可能未注入 IPC bridge 或已不可用")
            }
        }
    }
}

#[async_trait]
impl BrowserController for TauriBrowserController {
    async fn execute(&self, action: BrowserAction) -> BrowserActionResult {
        match action {
            BrowserAction::Navigate { url } => {
                // 有 active webview → 直接导航当前 tab。
                if let Some(wv) = self.active_webview() {
                    let parsed = match url::Url::parse(&url) {
                        Ok(u) => u,
                        Err(e) => return BrowserActionResult::err(format!("无效 URL：{e}")),
                    };
                    return match wv.navigate(parsed) {
                        Ok(()) => BrowserActionResult::ok_text(format!("已导航到 {url}")),
                        Err(e) => BrowserActionResult::err(format!("导航失败：{e}")),
                    };
                }
                // 无 active webview（右侧浏览器面板未开 tab）→ 发事件让前端自动新建 tab。
                let _ = self
                    .app
                    .emit("giteam://browser-agent-open", serde_json::json!({ "url": url }));
                BrowserActionResult::ok_text(format!("已在内置浏览器打开 {url}"))
            }
            BrowserAction::Click { selector } => {
                let sel = Self::js_lit(&selector);
                let body = format!(
                    "var el=document.querySelector({sel});if(!el)throw new Error('元素未找到：'+{sel});\
                     el.scrollIntoView({{block:'center'}});el.click();return{{text:'已点击 '+{sel}}};",
                    sel = sel,
                );
                self.run_action(body).await
            }
            BrowserAction::Type { selector, text } => {
                let sel = Self::js_lit(&selector);
                let txt = Self::js_lit(&text);
                let body = format!(
                    "var el=document.querySelector({sel});if(!el)throw new Error('输入框未找到：'+{sel});\
                     el.focus();el.value={txt};\
                     el.dispatchEvent(new Event('input',{{bubbles:true}}));\
                     el.dispatchEvent(new Event('change',{{bubbles:true}}));\
                     return{{text:'已输入 '+{txt}}};",
                    sel = sel,
                    txt = txt,
                );
                self.run_action(body).await
            }
            BrowserAction::ReadDom { selector } => {
                let body = match selector {
                    Some(sel) => {
                        let s = Self::js_lit(&sel);
                        format!(
                            "var el=document.querySelector({s});if(!el)throw new Error('元素未找到：'+{s});\
                             return{{text:(el.innerText||'').slice(0,8000)}};",
                            s = s,
                        )
                    }
                    None => "return {text: ((document.body&&document.body.innerText)||'').slice(0,8000)};"
                        .to_string(),
                };
                self.run_action(body).await
            }
            BrowserAction::EvalRead { js } => {
                let j = Self::js_lit(&js);
                let body = format!(
                    "return {{text: JSON.stringify(await (async(){{ return eval({j}); }})())}};",
                    j = j,
                );
                self.run_action(body).await
            }
            BrowserAction::Screenshot => {
                // html2canvas 按需 CDN 加载 + 缓存到 window.__giteamHtml2canvas。
                // CSP 严格的页面可能拦外链脚本，届时换 include_str! 本地预载。
                let body = "\
                    if(!window.__giteamHtml2canvas){\
                        await new Promise(function(resolve,reject){\
                            var s=document.createElement('script');\
                            s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';\
                            s.onload=resolve;\
                            s.onerror=function(){reject(new Error('html2canvas 加载失败（CSP 拦截或无网）'));};\
                            document.head.appendChild(s);\
                        });\
                        window.__giteamHtml2canvas=window.html2canvas;\
                    }\
                    var canvas=await window.__giteamHtml2canvas(document.body,{useCORS:true});\
                    return {image: canvas.toDataURL('image/png')};\
                "
                .to_string();
                self.run_action(body).await
            }
        }
    }
}

/// 构造 desktop controller 共享引用，供 `PiSessionConfig` 注入。
#[must_use]
pub fn desktop_browser_controller(app: AppHandle) -> Arc<dyn BrowserController> {
    Arc::new(TauriBrowserController::new(app))
}
