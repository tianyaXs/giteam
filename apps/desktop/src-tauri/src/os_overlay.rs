//! agent 覆盖层窗口：虚拟光标 / 引导标记的宿主（自动挡与引导挡共用）。
//!
//! 窗口常驻（visible:false），show 时铺满目标显示器并向前端 emit 事件；渲染在
//! overlay.html（vite 多页构建的极简入口，见 src/os/overlay-main.tsx）——不要
//! 用 query/参数往 index.html 上分流：Tauri 拼 URL 时会把 `?` 编码进路径，vite
//! SPA fallback 兜底返回主应用（2026-11-10 实证：覆盖层窗口全屏加载了主应用
//! 启动屏）。纯 CSS 合成器动画。三条硬规则（docs/computer-use-overlay-research.md
//! §3）：
//! - 永久鼠标穿透：`set_ignore_cursor_events(true)`，交互控件一律放托盘/主窗口
//!   （Tauri 无 Electron 式 forward，穿透后收不到任何鼠标事件）；
//! - `set_content_protected(true)`：标记不进截屏，模型看不见自己的标注；
//! - 不抢焦点：macOS `focusable:false` 有抢焦点 bug（tauri#9065），全流程
//!   永不调 `set_focus`。
//!
//! macOS 窗口类型：WebviewWindow 转 NSPanel（NonActivatingPanel +
//! FullScreenAuxiliary + MoveToActiveSpace）。普通 NSWindow 在 release 打包后
//! 置顶失效、盖不住全屏空间（tauri#9556/#5566），dev 有效只是假象；配方照
//! tauri-macos-spotlight-example。转换失败时降级为普通窗口（dev 场景兜底）。
//! Windows：普通透明置顶窗口（focusable:false → WS_EX_NOACTIVATE），show 后
//! 重新 `set_always_on_top(true)` 重钉 z-order（keyviz 防游戏启动夺走置顶）。
//!
//! ⚠️ 线程纪律：一切窗口 / NSPanel / NSScreen 操作（建窗、set_level、样式掩码、
//! monitor 枚举、show、eval）必须经 `on_main` 派发到主线程——2026-11-10 真机实证：
//! 后台线程调 `OverlayPanel::set_level` 触发 AppKit 断言 "Must only be used
//! from the main thread" → SIGTRAP 闪退。
//!
//! 坐标约定：命令入参 (x, y) 为**全局逻辑点**（屏幕左上角原点，macOS CGEvent
//! 系原生坐标系；Windows 侧由未来 computer_use 控制器按物理像素换算后传入）。
//! 发给前端的是「显示器内逻辑坐标」（减去显示器逻辑原点），overlay webview 的
//! 视口原点即显示器原点，CSS 直接用。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// 覆盖层窗口 label；前端 capability（capabilities/os-overlay.json）按此放行事件监听。
const OVERLAY_LABEL: &str = "os-overlay";

/// 引导标记：Rust 经 `Webview::eval` 直接调 `window.__osOverlay.marker/clear`——
/// 不走 Tauri 事件系统（emit 与监听器注册之间的 capability/时序问题不可观测，
/// 2026-11-10 实证标记事件发出但前端未渲染；eval 通道无此依赖）。
/// 前端挂载完成后 `invoke(os_overlay_ready)` 上报（自定义命令不经 ACL 门控），
/// 下发标记前必须等就绪——注意不能用 window title 做探针：macOS 上它是 NSWindow
/// 标题，不随 document.title 变化（实证恒为 ""）。
/// 标记停留时长（毫秒）；引导挡由 agent 显式 clear，自动挡标记超时自消。
const MARKER_TTL_MS: u64 = 8000;

/// 等待前端桥就绪的超时（毫秒）。
const BRIDGE_READY_TIMEOUT_MS: u64 = 8000;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GuideMarkerPayload {
    id: String,
    /// 显示器内逻辑坐标（非全局）。
    x: f64,
    y: f64,
    label: String,
    /// action = 执行标记（绿、短 TTL，坐标兜底动作的位置反馈）。
    kind: &'static str,
}

/// 常驻窗口句柄：转 panel 后 tauri 的 get_webview_window 可能取不到，自行持有。
/// 仅主线程访问（所有窗口操作都经 `on_main`）。
static OVERLAY_WINDOW: Mutex<Option<WebviewWindow>> = Mutex::new(None);

/// 前端桥（window.__osOverlay）是否已挂载（前端 invoke os_overlay_ready 上报）。
/// 下发标记前以此为准，比页面加载事件更确定性。
static OVERLAY_BRIDGE_READY: AtomicBool = AtomicBool::new(false);

/// 标记自增序号：毫秒时间戳可能撞车，拼上序号保证 id 唯一（React key / TTL 过滤依赖）。
static MARKER_SEQ: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "macos")]
static OVERLAY_PANEL: OnceLock<tauri_nspanel::PanelHandle<tauri::Wry>> = OnceLock::new();

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(OverlayPanel {
        config: {
            can_become_key_window: false
        }
    })
}

/// 把窗口操作派发到主线程执行并取回结果。主线程调用时同步执行，不阻塞等待。
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(job());
    })
    .map_err(|err| format!("派发主线程失败：{err}"))?;
    rx.recv()
        .map_err(|err| format!("主线程任务无响应：{err}"))?
}

/// 取或创建覆盖层窗口。重复调用复用同一窗口（panel 转换只做一次）。
/// ⚠️ 仅主线程调用（经 `on_main`）。
fn ensure_overlay_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = OVERLAY_WINDOW.lock().ok().and_then(|guard| guard.clone()) {
        return Ok(window);
    }
    let window =
        WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
            .title("")
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false)
            .focusable(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .visible(false)
            .build()
            .map_err(|err| format!("创建覆盖层窗口失败：{err}"))?;
    let _ = window.set_content_protected(true);
    // 全窗口永久穿透：用户点击直接落到下层应用（引导挡的核心前提）。
    let _ = window.set_ignore_cursor_events(true);

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::{CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};
        // 转换失败不阻断：普通窗口在 dev 下可用，release 才暴露置顶失效问题。
        match window.to_panel::<OverlayPanel<tauri::Wry>>() {
            Ok(panel) => {
                panel.set_level(PanelLevel::Floating.value());
                // 跟随当前桌面空间 + 允许出现在全屏应用之上。
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .full_screen_auxiliary()
                        .move_to_active_space()
                        .into(),
                );
                // NonActivatingPanel：显示/点击均不激活 app、不抢焦点。
                let _ = panel.add_style_mask(StyleMask::empty().nonactivating_panel().into());
                let _ = OVERLAY_PANEL.set(panel);
            }
            Err(err) => eprintln!("覆盖层转 NSPanel 失败（降级普通窗口）：{err}"),
        }
    }

    if let Ok(mut guard) = OVERLAY_WINDOW.lock() {
        *guard = Some(window.clone());
    }
    Ok(window)
}

/// 显示覆盖层（macOS 走 panel.show() 以 orderFrontRegardless；Windows show 后重钉置顶）。
/// ⚠️ 仅主线程调用（经 `on_main`）。
fn show_overlay() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(panel) = OVERLAY_PANEL.get() {
            panel.show();
            return Ok(());
        }
    }
    let window = OVERLAY_WINDOW
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .ok_or("覆盖层窗口不存在")?;
    window.show().map_err(|err| err.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        // z-order 兜底重钉（tao 内部走 SetWindowPos(HWND_TOPMOST)）。
        window
            .set_always_on_top(true)
            .map_err(|err| err.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = window;
    }
    Ok(())
}

/// 找包含全局逻辑点的显示器，退化到主显示器。⚠️ 仅主线程调用（NSScreen 枚举）。
fn monitor_at(app: &AppHandle, x: f64, y: f64) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;
    monitors
        .into_iter()
        .find(|monitor| {
            let scale = monitor.scale_factor();
            let lx = monitor.position().x as f64 / scale;
            let ly = monitor.position().y as f64 / scale;
            let lw = monitor.size().width as f64 / scale;
            let lh = monitor.size().height as f64 / scale;
            x >= lx && x < lx + lw && y >= ly && y < ly + lh
        })
        .or_else(|| app.primary_monitor().ok().flatten())
}

/// 在全局逻辑坐标 (x, y) 弹执行标记（绿涟漪、短 TTL；坐标兜底动作的位置
/// 反馈；agent-desktop ref 点击无坐标，不弹）。
///
/// 流程：主线程建窗/定位（快速返回，不阻塞托盘等调用方）→ 后台线程等页面加载
/// 完成 → 主线程显示 → emit 标记。标记弹出的延迟包含页面首次加载（首秒级），
/// 之后窗口常驻复用，仅剩监听器注册余量。
pub(crate) fn show_marker_at(
    app: &AppHandle,
    x: f64,
    y: f64,
    label: String,
    kind: &'static str,
) -> Result<(), String> {
    let app_main = app.clone();
    let (rel_x, rel_y) = on_main(app, move || -> Result<(f64, f64), String> {
        let monitor = monitor_at(&app_main, x, y).ok_or("无可用显示器")?;
        let scale = monitor.scale_factor();
        let origin_x = monitor.position().x as f64 / scale;
        let origin_y = monitor.position().y as f64 / scale;
        let window = ensure_overlay_window(&app_main)?;
        window
            .set_position(tauri::PhysicalPosition::new(
                monitor.position().x,
                monitor.position().y,
            ))
            .map_err(|err| err.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(
                monitor.size().width,
                monitor.size().height,
            ))
            .map_err(|err| err.to_string())?;
        Ok((x - origin_x, y - origin_y))
    })?;

    let app_bg = app.clone();
    std::thread::spawn(move || {
        // 等前端桥就绪（挂载后 invoke 上报；首次创建窗口时是秒级，常驻后恒真）。
        let mut waited = 0u64;
        while !OVERLAY_BRIDGE_READY.load(Ordering::Relaxed) && waited < BRIDGE_READY_TIMEOUT_MS {
            std::thread::sleep(Duration::from_millis(100));
            waited += 100;
        }
        if !OVERLAY_BRIDGE_READY.load(Ordering::Relaxed) {
            let url = on_main(&app_bg, || -> Result<String, String> {
                let window = OVERLAY_WINDOW
                    .lock()
                    .ok()
                    .and_then(|guard| guard.clone())
                    .ok_or("覆盖层窗口不存在")?;
                window
                    .url()
                    .map(|u| u.to_string())
                    .map_err(|e| e.to_string())
            })
            .unwrap_or_else(|err| format!("url 读取失败：{err}"));
            eprintln!("覆盖层前端桥就绪超时（{BRIDGE_READY_TIMEOUT_MS}ms），当前页面：{url}");
        }
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let seq = MARKER_SEQ.fetch_add(1, Ordering::Relaxed);
        let payload = GuideMarkerPayload {
            id: format!("m-{millis}-{seq}"),
            x: rel_x,
            y: rel_y,
            label,
            kind,
        };
        let js = bridge_js("marker", &payload);
        let shown = on_main(&app_bg, move || -> Result<(), String> {
            show_overlay()?;
            eval_on_overlay(&js)
        });
        if let Err(err) = shown {
            eprintln!("覆盖层标记下发失败：{err}");
        }
    });
    Ok(())
}

/// 在覆盖层 webview 里执行 JS。⚠️ 仅主线程调用（经 `on_main`）。
fn eval_on_overlay(js: &str) -> Result<(), String> {
    let window = OVERLAY_WINDOW
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .ok_or("覆盖层窗口不存在")?;
    window.eval(js).map_err(|err| err.to_string())
}

/// 构造调用 `window.__osOverlay.<method>(payload)` 的 JS；serde_json 转义保证
/// label 含引号/反斜杠时仍安全。
fn bridge_js(method: &str, payload: &GuideMarkerPayload) -> String {
    let json = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_string());
    format!("window.__osOverlay&&window.__osOverlay.{method}({json})")
}

/// 清空当前标记（引导进入下一步 / agent 结束时调用）。
pub(crate) fn clear_markers(app: &AppHandle) {
    let js = "window.__osOverlay&&window.__osOverlay.clear()".to_string();
    let _ = on_main(app, move || eval_on_overlay(&js).map(|_| ()));
}

/// 更新引导进展浮窗（屏幕顶部中心状态卡）：computer_use/guide 每个动作完成后
/// 调用，用户不用切回主窗口也能看到进展。纯展示、鼠标穿透、不进截屏——
/// 与标记共用同一 overlay webview（窗口级 ignore_cursor_events/content_protected）。
/// 前端 60s 无更新自动隐藏；guide clear 时立即消失。
pub(crate) fn show_progress(app: &AppHandle, text: &str) {
    let payload = serde_json::json!({ "text": text });
    let json = serde_json::to_string(&payload).unwrap_or_else(|_| "null".to_string());
    let js = format!("window.__osOverlay&&window.__osOverlay.progress({json})");
    let owned = js.to_string();
    let _ = on_main(app, move || eval_on_overlay(&owned).map(|_| ()));
}

/// 立即隐藏进展浮窗（引导结束/清空标记时）。
pub(crate) fn clear_progress(app: &AppHandle) {
    let js = "window.__osOverlay&&window.__osOverlay.progressClear()".to_string();
    let _ = on_main(app, move || eval_on_overlay(&js).map(|_| ()));
}

/// 在主显示器上弹一枚演示标记：托盘「演示覆盖层标记」与 dev 启动自检共用。
pub fn demo_guide_marker(app: &AppHandle) -> Result<(), String> {
    let app_main = app.clone();
    let (x, y) = on_main(app, move || -> Result<(f64, f64), String> {
        let monitor = app_main
            .primary_monitor()
            .ok()
            .flatten()
            .ok_or("无可用显示器")?;
        let scale = monitor.scale_factor();
        Ok((
            monitor.position().x as f64 / scale + monitor.size().width as f64 / scale * 0.5,
            monitor.position().y as f64 / scale + monitor.size().height as f64 / scale * 0.35,
        ))
    })?;
    show_marker_at(
        app,
        x,
        y,
        "Giteam 覆盖层标记演示：这里就是要操作的位置".to_string(),
        "action",
    )?;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(MARKER_TTL_MS));
        clear_markers(&app);
    });
    Ok(())
}

/// 前端挂载完成上报：设置 `window.__osOverlay` 桥后立即 invoke。自定义命令不经
/// ACL 门控，覆盖层窗口无需 capability 条目。
#[tauri::command]
pub async fn os_overlay_ready() -> Result<(), String> {
    OVERLAY_BRIDGE_READY.store(true, Ordering::Relaxed);
    Ok(())
}
