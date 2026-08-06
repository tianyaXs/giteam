//! 内置浏览器后端（CDP 版）：用 chromiumoxide 经 Chrome DevTools Protocol 操作真实 Chrome，
//! 替代 Tauri 子 webview 的 eval JS + IPC 方案（后者对外部 URL 页面 IPC 断链——postMessage/
//! invoke 不达 Rust，fetch custom scheme 被浏览器规范拒，click 全 15s 超时）。
//!
//! ## runtime 关键（治本 click 超时）
//! pi agent 在 **asupersync runtime**（非 tokio）poll 工具 future，而 chromiumoxide 全家桶依赖
//! **tokio reactor**（`tokio::net`/`tokio::process`/`tokio::time` + `async-tungstenite`）。直接在
//! `execute` 里 await chromiumoxide 会因无 tokio reactor 而卡死——Chrome 子进程靠
//! `tokio::process::spawn` 起来了（窗口可见），但 CDP WebSocket（`tokio::net`）连不上，所有 page
//! 命令（`new_page`/`goto`/`find_element`/`evaluate`）超时。与 [[windows-https-10057-fix]] 同源。
//!
//! 修复：`execute` 把整段 chromiumoxide 操作 **spawn 到 tauri 启动时建立的 tokio runtime**
//! （`tauri::async_runtime::spawn` 用全局 tokio handle，asupersync context 可调），`execute` 自身
//! 仅 await 一个 `tokio::oneshot::Receiver`（纯 future，不依赖任何 reactor，asupersync 安全 poll）。
//!
//! 设计：单例 Chrome + 单 active Page，`Arc<Mutex<Option<ControllerState>>>` 保护（Clone 廉价，供
//! spawn move）；首次 execute 懒启动 headed Chrome（`--lang=en` 规避 debug port 解析语言坑），
//! `spawn` handler task 驱动 WebSocket。连接类失败（超时）后 reset state，下次自动重 launch（自愈，
//! 用户关 Chrome 窗口后不永久卡死）。
//!
//! 换引擎是纯局部替换：`BrowserController` trait 单方法 `execute`，`BrowserUseTool` 与 main.rs/
//! service.rs 的 6 处接线完全不动。换引擎仅需切 `main.rs` 的注入点（见 `new_controller`）。

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotFormat;
use chromiumoxide::page::{Page, ScreenshotParams};
use futures::StreamExt;
use tokio::sync::{oneshot, Mutex};

use giteam_core::pi_agent::{BrowserAction, BrowserActionResult, BrowserController};

/// Chrome 冷启动单独大超时：避开数秒冷启动 + `--lang=en` 下 debug port 解析慢。
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(60);
/// 每个 action 操作超时熔断：避 chromiumoxide#321 screenshot 偶发挂死、慢页面导航拖垮 agent。
const ACTION_TIMEOUT: Duration = Duration::from_secs(30);
/// ReadDom 文本截断上限：防爆渲染层 + 防上下文超长。
const READ_DOM_MAX_CHARS: usize = 8000;

struct ControllerState {
    /// 持有 Chrome 子进程句柄；保活避免每次 action 重启，drop 时关 Chrome。execute 仅用 page。
    _browser: Browser,
    /// active page（当前操作的标签）。`Page` 内部 `Arc`，可廉价克隆持锁外操作。
    page: Page,
}

/// CDP 版内置浏览器 controller。
#[derive(Clone)]
pub struct ChromiumoxideController {
    state: Arc<Mutex<Option<ControllerState>>>,
}

impl ChromiumoxideController {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(None)),
        }
    }

    /// 首次调用懒启动 Chrome + 建空白页；后续返回 active page 的廉价克隆。
    /// 冷启动在锁内完成（首次串行合理），返回后释放锁，action 在 page 克隆上不持锁操作。
    async fn ensure_launched(&self) -> Result<Page, String> {
        let mut guard = self.state.lock().await;
        if let Some(state) = guard.as_ref() {
            return Ok(state.page.clone());
        }

        // with_head：headed 可见，用户在独立窗口看 agent 操作（路线 A 显示层）。
        // --lang=en：chromiumoxide 从 Chrome 进程输出解析 debug port，仅认英文；中文 locale
        //   会让 launch 超时（README Troubleshooting）。默认找系统 Chrome，不加 fetcher（避免下载）。
        let config = BrowserConfig::builder()
            .with_head()
            .arg("--lang=en")
            .window_size(1280, 800)
            .build()
            .map_err(|e| format!("Chrome 配置构建失败：{e}"))?;

        let launched = tokio::time::timeout(LAUNCH_TIMEOUT, Browser::launch(config))
            .await
            .map_err(|_| format!("Chrome 冷启动超时（{LAUNCH_TIMEOUT:?}）"))?
            .map_err(|e| {
                format!("未找到 Chrome/Chromium 或启动失败：{e}\n请安装 Google Chrome 或 Chromium。")
            })?;
        let (browser, mut handler) = launched;

        // 驱动 CDP WebSocket：handler 是 Stream，必须持续 poll 否则命令不归。
        // 不因单个事件 Err 提前退出（长生命周期下误杀非致命事件会断整个连接）——连接真断时
        // `next()` 返回 None，循环自然结束。生命周期随 browser。
        tauri::async_runtime::spawn(async move {
            while handler.next().await.is_some() {}
        });

        let page = browser
            .new_page("about:blank")
            .await
            .map_err(|e| format!("创建页面失败：{e}"))?;
        *guard = Some(ControllerState {
            _browser: browser,
            page: page.clone(),
        });
        Ok(page)
    }

    /// 连接类失败后重置 state：下次 `ensure_launched` 自动重 launch。
    /// 自愈——用户关 Chrome 窗口后，下次 action 会超时触发 reset，再下次即重启 Chrome。
    async fn reset_state(&self) {
        let mut guard = self.state.lock().await;
        *guard = None;
    }

    /// 执行单个 action。返回结果 + 是否连接死（超时类失败需 reset 自愈）。
    /// 业务类错误（元素未找到、eval 语法错）不 reset——常见，重 launch 反而拖慢 agent。
    async fn run_action(
        &self,
        page: &Page,
        action: BrowserAction,
    ) -> (BrowserActionResult, bool) {
        match action {
            BrowserAction::Navigate { url } => {
                match tokio::time::timeout(ACTION_TIMEOUT, page.goto(url.as_str())).await {
                    Ok(Ok(_)) => (BrowserActionResult::ok_text("已导航"), false),
                    // 导航的 CdpError 多为连接断，保守判死重连。
                    Ok(Err(e)) => (
                        BrowserActionResult::err(format!("导航失败：{e}")),
                        true,
                    ),
                    Err(_) => (
                        BrowserActionResult::err(format!("导航超时（{ACTION_TIMEOUT:?}）")),
                        true,
                    ),
                }
            }
            BrowserAction::Click { selector } => {
                // find_element 返回 owned Element，click 返回 &Element（借用 el），故需 let 绑定
                // 延长 Element 生命周期；click 的 &Element 返回值用 ? 丢弃，块返回 Result<(), _> 不借块内局部。
                let clicked = tokio::time::timeout(ACTION_TIMEOUT, async {
                    let el = page.find_element(selector.as_str()).await?;
                    el.click().await?;
                    Ok::<_, chromiumoxide::error::CdpError>(())
                })
                .await;
                match clicked {
                    Ok(Ok(_)) => (BrowserActionResult::ok_text("已点击"), false),
                    Ok(Err(e)) => (
                        BrowserActionResult::err(format!("点击失败（{selector}）：{e}")),
                        false,
                    ),
                    Err(_) => (
                        BrowserActionResult::err(format!("点击超时（{ACTION_TIMEOUT:?}）")),
                        true,
                    ),
                }
            }
            BrowserAction::Type { selector, text } => {
                // 先 click 聚焦再 type_str：type_str 发原生键盘事件，天然触发 input/change，
                // 比旧 JS dispatch 更可靠。click/type_str 均返回 &Element（借用 el），需 let 绑定。
                let typed = tokio::time::timeout(ACTION_TIMEOUT, async {
                    let el = page.find_element(selector.as_str()).await?;
                    el.click().await?;
                    el.type_str(text.as_str()).await?;
                    Ok::<_, chromiumoxide::error::CdpError>(())
                })
                .await;
                match typed {
                    Ok(Ok(_)) => (BrowserActionResult::ok_text("已输入"), false),
                    Ok(Err(e)) => (
                        BrowserActionResult::err(format!("输入失败（{selector}）：{e}")),
                        false,
                    ),
                    Err(_) => (
                        BrowserActionResult::err(format!("输入超时（{ACTION_TIMEOUT:?}）")),
                        true,
                    ),
                }
            }
            BrowserAction::ReadDom { selector } => {
                // 有 selector 读元素 innerText，否则整页 body innerText；选择器经 JSON 字面量转义防注入。
                let js = match selector.as_deref() {
                    Some(sel) => format!(
                        "(document.querySelector({})?.innerText || '').slice(0, {READ_DOM_MAX_CHARS})",
                        serde_json::to_string(sel).unwrap_or_else(|_| "\"\"".into())
                    ),
                    None => format!("(document.body?.innerText || '').slice(0, {READ_DOM_MAX_CHARS})"),
                };
                match tokio::time::timeout(ACTION_TIMEOUT, page.evaluate(js)).await {
                    Ok(Ok(res)) => {
                        let text: String = res.into_value().unwrap_or_default();
                        (BrowserActionResult::ok_text(text), false)
                    }
                    Ok(Err(e)) => (
                        BrowserActionResult::err(format!("读取 DOM 失败：{e}")),
                        false,
                    ),
                    Err(_) => (
                        BrowserActionResult::err(format!("读取 DOM 超时（{ACTION_TIMEOUT:?}）")),
                        true,
                    ),
                }
            }
            BrowserAction::EvalRead { js } => {
                match tokio::time::timeout(ACTION_TIMEOUT, page.evaluate(js)).await {
                    Ok(Ok(res)) => {
                        // 任意返回值 → serde_json::Value → JSON 字符串（untrusted 围栏由 BrowserUseTool 包裹）。
                        let val: serde_json::Value =
                            res.into_value().unwrap_or(serde_json::Value::Null);
                        (BrowserActionResult::ok_text(val.to_string()), false)
                    }
                    Ok(Err(e)) => (BrowserActionResult::err(format!("eval 失败：{e}")), false),
                    Err(_) => (
                        BrowserActionResult::err(format!("eval 超时（{ACTION_TIMEOUT:?}）")),
                        true,
                    ),
                }
            }
            BrowserAction::Screenshot => {
                let shot = tokio::time::timeout(
                    ACTION_TIMEOUT,
                    page.screenshot(
                        ScreenshotParams::builder()
                            .format(CaptureScreenshotFormat::Png)
                            .build(),
                    ),
                )
                .await;
                match shot {
                    Ok(Ok(bytes)) => {
                        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        (
                            BrowserActionResult {
                                ok: true,
                                text: None,
                                image: Some(format!("data:image/png;base64,{data}")),
                                error: None,
                            },
                            false,
                        )
                    }
                    Ok(Err(e)) => (BrowserActionResult::err(format!("截图失败：{e}")), false),
                    Err(_) => (
                        BrowserActionResult::err(format!("截图超时（{ACTION_TIMEOUT:?}）")),
                        true,
                    ),
                }
            }
        }
    }

    /// 在 tauri tokio runtime 内执行：ensure + action；超时类失败 reset 自愈。
    async fn execute_inner(&self, action: BrowserAction) -> BrowserActionResult {
        let page = match self.ensure_launched().await {
            Ok(p) => p,
            Err(e) => return BrowserActionResult::err(e),
        };
        let (result, connection_dead) = self.run_action(&page, action).await;
        if connection_dead {
            self.reset_state().await;
        }
        result
    }
}

impl Default for ChromiumoxideController {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BrowserController for ChromiumoxideController {
    async fn execute(&self, action: BrowserAction) -> BrowserActionResult {
        // pi agent 在 asupersync runtime（非 tokio）poll 此 future；chromiumoxide 依赖 tokio reactor，
        // 直接 await 会卡（CDP WS 连不上，page 命令全超时）。把整段操作 spawn 到 tauri tokio runtime
        // （async_runtime::spawn 用 tauri 启动时建立的全局 tokio handle，asupersync context 可调），
        // execute 仅 await oneshot Receiver——纯 future，不依赖任何 reactor，asupersync 安全 poll。
        let controller = self.clone();
        let (tx, rx) = oneshot::channel::<BrowserActionResult>();
        tauri::async_runtime::spawn(async move {
            let result = controller.execute_inner(action).await;
            let _ = tx.send(result);
        });
        match rx.await {
            Ok(result) => result,
            Err(_) => BrowserActionResult::err("浏览器任务意外终止（Chrome 可能已被关闭）"),
        }
    }
}

/// 构造共享 controller 注入 PiAgentService（chromiumoxide 自管 Chrome 进程，不需 AppHandle）。
pub fn new_controller() -> Arc<dyn BrowserController> {
    Arc::new(ChromiumoxideController::new())
}
