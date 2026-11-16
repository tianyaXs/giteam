//! DesktopOsController：[`OsController`] 的桌面端实现——enigo 键鼠注入 +
//! xcap 截屏 + os_overlay 引导标记。
//!
//! - 坐标协议：trait 层收 0~1000 归一化（相对最近一次截图 = 主显示器），换算
//!   `全局坐标 = origin + norm/1000 × size`。两端语义各自对齐（macOS xcap 的
//!   x/y/width/height 走 CGDisplayBounds 是逻辑点、enigo 走 CGEvent 也是逻辑点；
//!   Windows xcap 的 dmPelsWidth 是物理像素、enigo 也是物理像素），无需
//!   scale_factor 参与坐标注入（见 docs/computer-use-overlay-research.md §2）。
//!   ⚠️ enigo 自带的 `main_display()` 在 macOS 返回物理像素、与其 move 坐标空间
//!   不一致，禁用——尺寸一律取 xcap Monitor。
//! - enigo 每动作临时创建（CGEventSource 创建是微秒级）：无跨线程 Send 顾虑，
//!   组合键在同一次调用内完成 Press→Click→Release，动作间状态天然隔离。
//! - 权限 fail-closed：键鼠动作预检辅助功能、截屏预检屏幕录制，未授权返回带
//!   系统设置路径指引的错误，绝不静默（CGEventPost 无权限时是静默失败，预检
//!   是唯一防线）。
//! - enigo 阻塞调用经 `tauri::async_runtime::spawn_blocking` 下沉线程池。

use std::io::Cursor;
use std::time::Duration;

use base64::Engine as _;
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use giteam_core::pi_agent::{OsActionResult, OsController};

use super::os_permissions;
use tauri::Manager;

/// 执行标记先弹出、后注入的引导延迟：保证「看到绿涟漪 → 光标过去 → 点击」
/// 的可见时序（action 动画单跳 0.9s，取前段足够）。
const ACTION_MARKER_LEAD_MS: u64 = 300;

const ACCESSIBILITY_HINT: &str =
    "键鼠注入需要「辅助功能」权限：系统设置 → 隐私与安全性 → 辅助功能，授权后重试";
const SCREEN_RECORDING_HINT: &str =
    "截屏需要「屏幕录制」权限：系统设置 → 隐私与安全性 → 屏幕录制，授权后重试";

fn ensure_accessibility() -> Result<(), String> {
    if os_permissions::accessibility_granted() {
        Ok(())
    } else {
        Err(ACCESSIBILITY_HINT.to_string())
    }
}

fn ensure_screen_recording() -> Result<(), String> {
    if os_permissions::screen_recording_granted() {
        Ok(())
    } else {
        Err(SCREEN_RECORDING_HINT.to_string())
    }
}

/// xcap 错误统一转 String（`?` 无法直接从 XCapError 转换）。
fn xcap_err(e: xcap::XCapError) -> String {
    format!("显示器信息读取失败：{e}")
}

/// 主显示器几何 origin(x, y) + size(width, height)：macOS 为逻辑点、Windows
/// 为物理像素，与各自 enigo 注入空间一致。P0 仅主显示器，多显示器留 P2。
fn primary_geometry() -> Result<((i32, i32), (u32, u32), f32), String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("枚举显示器失败：{e}"))?;
    let primary = monitors
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .ok_or("未找到主显示器")?;
    let origin = (
        primary.x().map_err(xcap_err)?,
        primary.y().map_err(xcap_err)?,
    );
    let size = (
        primary.width().map_err(xcap_err)?,
        primary.height().map_err(xcap_err)?,
    );
    if size.0 == 0 || size.1 == 0 {
        return Err("主显示器尺寸为 0".to_string());
    }
    let scale = primary.scale_factor().unwrap_or(1.0);
    Ok((origin, size, scale))
}

/// 归一化 (0~1000) → 全局坐标。0 是合法值（屏幕顶边/左边），只判 NaN/越界。
fn norm_to_global(origin: i32, size: u32, norm: f64) -> Result<i32, String> {
    if !norm.is_finite() || !(0.0..=1000.0).contains(&norm) {
        return Err(format!("归一化坐标 {norm} 越界（须为 0~1000）"));
    }
    Ok(origin + (norm / 1000.0 * size as f64).round() as i32)
}

/// 归一化坐标 → 全局坐标点（click/move 共用换算）。
/// CGEvent 全局空间是**逻辑点**（enigo 原样传 CGEvent、零 scale 处理），
/// 而 xcap 的 origin/size 是物理像素——必须除 scale（Retina 2x 下差一倍
/// 即偏出小目标；大面积区域此前「点中」纯属容错）。0 是合法值（屏幕
/// 顶边/左边），只判 NaN/越界。
fn resolve_target(x: f64, y: f64) -> Result<(i32, i32), String> {
    let (origin, size, scale) = primary_geometry()?;
    let scale = if scale > 0.0 { f64::from(scale) } else { 1.0 };
    let logical = |v: i32| (v as f64 / scale).round() as i32;
    let logical_size = |v: u32| ((v as f64 / scale).round() as u32).max(1);
    Ok((
        norm_to_global(logical(origin.0), logical_size(size.0), x)?,
        norm_to_global(logical(origin.1), logical_size(size.1), y)?,
    ))
}

/// 键名 → enigo Key。与 computer_use 工具 description 声明的可用键全集一致。
fn map_key(name: &str) -> Result<Key, String> {
    let lowered = name.trim().to_ascii_lowercase();
    let key = match lowered.as_str() {
        "cmd" | "command" | "meta" | "win" | "super" => Key::Meta,
        "ctrl" | "control" => Key::Control,
        "alt" | "option" | "opt" => Key::Alt,
        "shift" => Key::Shift,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "capslock" => Key::CapsLock,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        other => {
            let mut chars = other.chars();
            let (first, rest) = (chars.next(), chars.count());
            if first.is_some() && rest == 0 {
                Key::Unicode(first.expect("checked above"))
            } else {
                return Err(format!("不支持的键名：{name}"));
            }
        }
    };
    Ok(key)
}

/// 创建 enigo 实例。权限提示由本模块预检统一处理（fail-closed + 指引），
/// 关闭 enigo 自己的弹窗避免双重 UX。
fn new_enigo() -> Result<Enigo, String> {
    let settings = Settings {
        open_prompt_to_get_permissions: false,
        ..Settings::default()
    };
    Enigo::new(&settings).map_err(|e| format!("初始化键鼠注入失败：{e}"))
}

/// 截图长边上限（像素）+ JPEG q75。Retina PNG 时代实证（2026-11-10）：6.7MB
/// 全尺寸图两轮把端点打到 3 分钟零产出；870KB PNG 仍会在第二轮卡死。1600px
/// JPEG 单图 ~150KB，端点可正常消化。
const SCREENSHOT_MAX_SIDE: u32 = 1600;

fn input_err(context: &str) -> impl Fn(enigo::InputError) -> String + '_ {
    move |e| format!("{context}失败：{e}")
}

fn map_button(name: &str) -> Result<Button, String> {
    match name {
        "left" => Ok(Button::Left),
        "right" => Ok(Button::Right),
        "middle" => Ok(Button::Middle),
        other => Err(format!("按键 {other} 无效")),
    }
}

pub fn new_controller(app: tauri::AppHandle) -> std::sync::Arc<dyn OsController> {
    std::sync::Arc::new(DesktopOsController {
        app,
        ad_session: tokio::sync::Mutex::new(None),
        last_label: tokio::sync::Mutex::new(None),
    })
}

struct DesktopOsController {
    app: tauri::AppHandle,
    /// agent-desktop 会话 id（惰性创建，trace 关闭防隐私落盘）；run 终态
    /// notify_clear 里 end + 清槽。光标不经 session start --cursor（那是官方
    /// 默认蓝样式，会先闪蓝再换肤），改由 enable 一次性配好样式。
    ad_session: tokio::sync::Mutex<Option<String>>,
    /// 最近一条进展/穿插正文文本：首次 enable 带上它可压掉官方 greeting
    /// 英文彩蛋；后续 notify 重复 enable 幂等刷新光标药丸 label。
    last_label: tokio::sync::Mutex<Option<String>>,
}

impl DesktopOsController {
    /// 取（或创建）agent-desktop 会话 id。session 是官方光标 overlay 的宿主，
    /// 同时给 refs 一个稳定命名空间。子进程经 AGENT_DESKTOP_SESSION 环境变量
    /// 继承，无需逐命令传 --session。
    async fn ensure_ad_session(&self) -> Result<String, String> {
        let mut guard = self.ad_session.lock().await;
        if let Some(id) = guard.as_ref() {
            return Ok(id.clone());
        }
        let cli = resolve_ad_cli().await?;
        let output = tokio::process::Command::new(&cli)
            .args([
                "session",
                "start",
                "--no-trace",
                "--name",
                "giteam",
            ])
            .output()
            .await
            .map_err(|e| format!("agent-desktop session start 失败：{e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
            .map_err(|e| format!("session start 输出解析失败：{e}"))?;
        let id = parsed
            .get("data")
            .and_then(|data| {
                data.get("session_id")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        data.pointer("/activation/value")
                            .and_then(serde_json::Value::as_str)
                    })
            })
            .ok_or("session start 未返回 session_id")?
            .to_string();
        *guard = Some(id.clone());
        // 光标：PNG 复刻官方 dart 箭头（黑身白边+投影，形状取自官方源码矢量）。
        // --image 是压掉官方 enable 英文 greeting 彩蛋的唯一通道（Enable 渲染
        // label 写死 greeting，有 image 时渲染层 filter 掉）；--label 是动作时
        // 药丸显示的意图文本（Present 从 config 读）。资源缺失降级官方箭头。
        // 失败不阻断（光标只是可视化）。
        let label = self.last_label.lock().await.clone();
        let image = cursor_resource(&self.app, "cursor-agent.png");
        let args = cursor_enable_args(label.as_deref(), image.as_deref());
        let _ = tokio::process::Command::new(&cli)
            .args(&args)
            .env("AGENT_DESKTOP_SESSION", &id)
            .output()
            .await;
        Ok(id)
    }

    /// 刷新光标药丸 label（幂等 enable，参数全量重传防回落默认）。带 image
    /// 时 enable 的渲染 greeting 被 filter，重复调用不会重画英文彩蛋；label
    /// 存进 config，下一个动作（Present）光标移动即显示最新文本。会话未建时
    /// 只记文本等 ensure_ad_session 首次 enable 取用。
    async fn update_cursor_label(&self, text: &str) {
        *self.last_label.lock().await = Some(text.to_string());
        let id = self.ad_session.lock().await.clone();
        let Some(id) = id else {
            return;
        };
        let Ok(cli) = resolve_ad_cli().await else {
            return;
        };
        let image = cursor_resource(&self.app, "cursor-agent.png");
        let mut args = cursor_enable_args(Some(text), image.as_deref());
        args.extend(["--session".to_string(), id.clone()]);
        let _ = tokio::process::Command::new(&cli)
            .args(&args)
            .env("AGENT_DESKTOP_SESSION", &id)
            .output()
            .await;
    }
}

#[async_trait::async_trait]
impl OsController for DesktopOsController {
    async fn screenshot(&self) -> Result<OsActionResult, String> {
        ensure_screen_recording()?;
        let screenshot_result = tauri::async_runtime::spawn_blocking(|| {
            let monitors = xcap::Monitor::all().map_err(|e| format!("枚举显示器失败：{e}"))?;
            let primary = monitors
                .into_iter()
                .find(|monitor| monitor.is_primary().unwrap_or(false))
                .ok_or("未找到主显示器")?;
            let (_, (w, h), scale) = primary_geometry()?;
            let image = primary
                .capture_image()
                .map_err(|e| format!("截屏失败：{e}"))?;
            // 降采样（长边 ≤1600px）+ JPEG：模型按 0~1000 归一化输出坐标，只依赖
            // 比例。PNG 时代实证：6.7MB 全尺寸图把会话上下文撑爆后端点 3 分钟零
            // 产出卡死（两轮复现）；降到 870KB PNG 后第一轮 24s 正常、下一轮（上
            // 下文多一张图）再次卡死——这个端点对百 KB 级图片仍敏感，JPEG q75
            // 把单图压到 ~150KB。
            let (pw, ph) = (image.width(), image.height());
            let image = if pw.max(ph) > SCREENSHOT_MAX_SIDE {
                let scale = SCREENSHOT_MAX_SIDE as f64 / pw.max(ph) as f64;
                let nw = ((pw as f64 * scale).round() as u32).max(1);
                let nh = ((ph as f64 * scale).round() as u32).max(1);
                xcap::image::DynamicImage::ImageRgba8(image)
                    .resize_exact(nw, nh, xcap::image::imageops::FilterType::Lanczos3)
                    .to_rgb8()
            } else {
                xcap::image::DynamicImage::ImageRgba8(image).to_rgb8()
            };
            let (ow, oh) = (image.width(), image.height());
            let mut jpeg = Vec::new();
            image
                .write_to(&mut Cursor::new(&mut jpeg), xcap::image::ImageFormat::Jpeg)
                .map_err(|e| format!("JPEG 编码失败：{e}"))?;
            let data_url = format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(jpeg)
            );
            Ok(OsActionResult {
                ok: true,
                text: Some(format!(
                    "主显示器逻辑 {w}×{h} @ {scale}x，截图 {ow}×{oh}px。坐标换算：归一化 = 像素位置÷截图宽(高)×1000。例：截图 1600×900、元素在像素 (345,283) → 输出 (216,314)。切勿把截图像素值直接当 0~1000 坐标输出（那会偏差 1.6 倍以上）"
                )),
                image: Some(data_url),
                error: None,
            })
        })
        .await
        .map_err(|e| format!("截屏任务失败：{e}"))?;
        screenshot_result
    }

    async fn click(
        &self,
        x: f64,
        y: f64,
        button: &str,
        double: bool,
    ) -> Result<OsActionResult, String> {
        ensure_accessibility()?;
        let button = map_button(button)?;
        let app = self.app.clone();
        let click_result = tauri::async_runtime::spawn_blocking(move || {
            let (gx, gy) = resolve_target(x, y)?;
            // 目标可视化先于注入：绿色涟漪标出即将点击的位置（覆盖层
            // content_protected，标记不进截图，模型看不见自己的标注）。
            let _ = super::super::os_overlay::show_marker_at(
                &app,
                gx as f64,
                gy as f64,
                String::new(),
                "action",
            );
            std::thread::sleep(Duration::from_millis(ACTION_MARKER_LEAD_MS));
            let mut enigo = new_enigo()?;
            enigo
                .move_mouse(gx, gy, Coordinate::Abs)
                .map_err(input_err("移动鼠标"))?;
            // 双击：连续两次 Click，enigo macOS 侧维护 clickCount 生成双击事件。
            let times = if double { 2 } else { 1 };
            for _ in 0..times {
                enigo
                    .button(button, Direction::Click)
                    .map_err(input_err("点击"))?;
            }
            Ok(OsActionResult::ok_text(format!("已在 ({gx},{gy}) 点击")))
        })
        .await
        .map_err(|e| format!("点击任务失败：{e}"))?;
        click_result
    }

    async fn move_mouse(&self, x: f64, y: f64) -> Result<OsActionResult, String> {
        ensure_accessibility()?;
        let app = self.app.clone();
        let move_result = tauri::async_runtime::spawn_blocking(move || {
            let (gx, gy) = resolve_target(x, y)?;
            let _ = super::super::os_overlay::show_marker_at(
                &app,
                gx as f64,
                gy as f64,
                String::new(),
                "action",
            );
            std::thread::sleep(Duration::from_millis(ACTION_MARKER_LEAD_MS));
            let mut enigo = new_enigo()?;
            enigo
                .move_mouse(gx, gy, Coordinate::Abs)
                .map_err(input_err("移动鼠标"))?;
            Ok(OsActionResult::ok_text(format!("已移动鼠标到 ({gx},{gy})")))
        })
        .await
        .map_err(|e| format!("移动任务失败：{e}"))?;
        move_result
    }

    async fn type_text(&self, text: &str) -> Result<OsActionResult, String> {
        ensure_accessibility()?;
        let text = text.to_string();
        let type_result = tauri::async_runtime::spawn_blocking(move || {
            let mut enigo = new_enigo()?;
            // 非 ASCII 文本走「写剪贴板 + 粘贴」：enigo 合成键盘事件在输入法激活时
            // 会被 IME 拦截（2026-11-12 实证：ASCII 正常、中文 3 连败后才绕到
            // pbcopy+cmd+v，白耗 6 步）。ASCII 仍走合成事件，不污染用户剪贴板。
            if text.chars().any(|c| !c.is_ascii()) {
                #[cfg(target_os = "macos")]
                let (paste_modifier, modifier_name) = (Key::Meta, "cmd+v");
                #[cfg(not(target_os = "macos"))]
                let (paste_modifier, modifier_name) = (Key::Control, "ctrl+v");
                arboard::Clipboard::new()
                    .and_then(|mut clipboard| clipboard.set_text(text.clone()))
                    .map_err(|e| format!("写入剪贴板失败：{e}"))?;
                // 剪贴板落定余量（NSPasteboard/Windows 剪贴板广播是异步的）。
                std::thread::sleep(Duration::from_millis(80));
                enigo
                    .key(paste_modifier, Direction::Press)
                    .map_err(input_err("按下粘贴修饰键"))?;
                enigo
                    .key(Key::Unicode('v'), Direction::Click)
                    .map_err(input_err("敲击 V"))?;
                enigo
                    .key(paste_modifier, Direction::Release)
                    .map_err(input_err("释放粘贴修饰键"))?;
                return Ok(OsActionResult::ok_text(format!(
                    "已通过剪贴板粘贴 {} 个字符（{}，IME 安全路径）",
                    text.chars().count(),
                    modifier_name
                )));
            }
            enigo.text(&text).map_err(input_err("键入文本"))?;
            Ok(OsActionResult::ok_text(format!(
                "已键入 {} 个字符",
                text.chars().count()
            )))
        })
        .await
        .map_err(|e| format!("键入任务失败：{e}"))?;
        type_result
    }

    async fn key(&self, keys: &[String]) -> Result<OsActionResult, String> {
        ensure_accessibility()?;
        // 先全部映射（任一非法键整体拒绝，不产生半截组合键）。
        let mapped: Vec<Key> = keys
            .iter()
            .map(|name| map_key(name))
            .collect::<Result<Vec<_>, _>>()?;
        let key_result = tauri::async_runtime::spawn_blocking(move || {
            let mut enigo = new_enigo()?;
            // 组合键：修饰键依次按下 → 最后键 Click → 修饰键逆序释放。
            let (last, modifiers) = mapped.split_last().ok_or("keys 为空")?;
            for key in modifiers {
                enigo
                    .key(*key, Direction::Press)
                    .map_err(input_err("按下按键"))?;
            }
            enigo
                .key(*last, Direction::Click)
                .map_err(input_err("敲击按键"))?;
            for key in modifiers.iter().rev() {
                enigo
                    .key(*key, Direction::Release)
                    .map_err(input_err("释放按键"))?;
            }
            Ok(OsActionResult::ok_text("已按键"))
        })
        .await
        .map_err(|e| format!("按键任务失败：{e}"))?;
        key_result
    }

    async fn scroll(&self, dx: i32, dy: i32) -> Result<OsActionResult, String> {
        ensure_accessibility()?;
        // 工具层约定：正值向上/向左；enigo 正值向下/向右，故取反。
        let scroll_result = tauri::async_runtime::spawn_blocking(move || {
            let mut enigo = new_enigo()?;
            if dy != 0 {
                enigo
                    .scroll(-dy, Axis::Vertical)
                    .map_err(input_err("纵向滚动"))?;
            }
            if dx != 0 {
                enigo
                    .scroll(-dx, Axis::Horizontal)
                    .map_err(input_err("横向滚动"))?;
            }
            Ok(OsActionResult::ok_text(format!("已滚动 dx={dx} dy={dy}")))
        })
        .await
        .map_err(|e| format!("滚动任务失败：{e}"))?;
        scroll_result
    }

    /// 浮窗语义进展直通：computer_use 动作前模型会给一句现在时描述。
    async fn notify(&self, text: &str) {
        super::super::os_overlay::show_progress(&self.app, text);
        // 光标药丸同步：浮窗与系统级光标显示同一句现在时进展/穿插正文。
        self.update_cursor_label(text).await;
    }

    /// run 终态清理：浮窗消失 + 关官方光标 overlay + 结束 agent-desktop 会话。
    async fn notify_clear(&self) {
        super::super::os_overlay::clear_progress(&self.app);
        *self.last_label.lock().await = None;
        let session = self.ad_session.lock().await.take();
        let Some(id) = session else {
            return;
        };
        let Ok(cli) = resolve_ad_cli().await else {
            return;
        };
        // cursor-overlay disable 需挂在 session 上；session end 收口 manifest。
        let _ = tokio::process::Command::new(&cli)
            .env("AGENT_DESKTOP_SESSION", &id)
            .args(["cursor-overlay", "disable"])
            .output()
            .await;
        let _ = tokio::process::Command::new(&cli)
            .args(["session", "end", &id])
            .output()
            .await;
    }

    /// agent-desktop CLI 通道：定位 CLI（bundle 内 sibling → PATH）、白名单校验、
    /// 子进程执行（stdin 载荷经管道，不进 argv）、envelope 校验后原文返回。
    async fn ad_command(
        &self,
        command: &str,
        args: &[String],
        stdin: Option<&str>,
    ) -> Result<String, String> {
        const ALLOWED: &[&str] = &[
            // 只读观察
            "snapshot",
            "find",
            "get",
            "is",
            "list-apps",
            "list-windows",
            "list-surfaces",
            "focus-window",
            // 受控批执行（computer_use 工具层已对 batch 子命令做白名单校验，
            // 这里只放行命令名本身）
            "batch",
            // ref 语义动作
            "click",
            "double-click",
            "triple-click",
            "right-click",
            "type",
            "set-value",
            "clear",
            "focus",
            "select",
            "toggle",
            "check",
            "uncheck",
            "expand",
            "collapse",
            "scroll",
            "scroll-to",
            // 键盘/滚轮（headless 语义交付优先）
            "press",
            "hover",
            "scroll-wheel",
            // 等待（-w 选择器轮询）
            "wait",
        ];
        if !ALLOWED.contains(&command) {
            return Err(format!("agent-desktop 命令 {command} 不在白名单内"));
        }
        if args.iter().any(|a| a.contains('\0')) {
            return Err("参数含非法字符".to_string());
        }
        let cli = resolve_ad_cli().await?;
        let mut cmd = tokio::process::Command::new(&cli);
        cmd.arg(command)
            .args(args)
            .stdin(std::process::Stdio::piped());
        // 会话环境变量：refs 命名空间 + 光标 overlay 生效范围随命令传播。
        if let Ok(id) = self.ensure_ad_session().await {
            cmd.env("AGENT_DESKTOP_SESSION", id);
        }
        // stdout 恒为 JSON envelope；stderr 是诊断日志，错误时带出。
        let mut child = cmd
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 agent-desktop 失败（{}）：{e}", cli.display()))?;
        if let Some(payload) = stdin {
            use tokio::io::AsyncWriteExt;
            if let Some(mut pipe) = child.stdin.take() {
                pipe.write_all(payload.as_bytes()).await.ok();
                pipe.shutdown().await.ok();
                drop(pipe);
            }
        }
        let output = child
            .wait_with_output()
            .await
            .map_err(|e| format!("agent-desktop 执行失败：{e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.trim().is_empty() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "agent-desktop 无输出（exit={}）：{}",
                output.status,
                stderr.trim().chars().take(300).collect::<String>()
            ));
        }
        Ok(stdout.to_string())
    }
}

/// cursor-overlay enable 参数（全量重传：重复 enable 是官方的设置更新通道，
/// 漏传回落默认）。image = 复刻官方 dart 的 PNG（黑身白边箭头），是压掉
/// enable 英文 greeting 的唯一通道（image 与 fill/rim 官方互斥，image 模式
/// 光标本体即 PNG）；label 为最新进展/穿插正文，动作时显示在光标药丸上。
fn cursor_enable_args(label: Option<&str>, image: Option<&std::path::Path>) -> Vec<String> {
    let mut args = vec![
        "cursor-overlay".to_string(),
        "enable".to_string(),
        "--accent".to_string(),
        "#22b573".to_string(),
        "--travel-ms".to_string(),
        "150,420".to_string(),
        "--max-words".to_string(),
        "12".to_string(),
    ];
    if let Some(path) = image {
        args.push("--image".to_string());
        args.push(path.display().to_string());
        // 热点 = dart 尖角 {1.0, 35.0}（ObjC y 向上）→ PNG (1, 0) + 偏移 (20, 24)
        args.push("--hotspot".to_string());
        args.push("21,24".to_string());
    }
    if let Some(text) = label {
        args.push("--label".to_string());
        args.push(text.to_string());
    }
    args
}

/// 定位打包资源（光标 PNG）：resource_dir（bundle）→ exe 同级 → exe/resources
/// （dev 布局）。找不到返回 None（调用方降级到 CLI 内置样式）。
fn cursor_resource(app: &tauri::AppHandle, name: &str) -> Option<std::path::PathBuf> {
    let candidates = [
        app.path().resource_dir().ok().map(|dir| dir.join(name)),
        app.path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("resources").join(name)),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join(name))),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("resources").join(name))),
    ];
    candidates.into_iter().flatten().find(|path| path.is_file())
}

/// 定位 agent-desktop CLI：bundle 内 sibling（release sidecar）→ PATH（dev brew）。
async fn resolve_ad_cli() -> Result<std::path::PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sibling = dir.join("agent-desktop");
            if sibling.is_file() {
                return Ok(sibling);
            }
        }
    }
    let which = tauri::async_runtime::spawn_blocking(|| {
        let paths = match std::env::var_os("PATH") {
            Some(p) => std::env::split_paths(&p).collect::<Vec<_>>(),
            None => Vec::new(),
        };
        paths
            .into_iter()
            .map(|dir| dir.join("agent-desktop"))
            .find(|candidate| candidate.is_file())
    })
    .await
    .map_err(|e| format!("PATH 查找任务失败：{e}"))?;
    which.ok_or_else(|| {
        "未找到 agent-desktop CLI（辅助功能引擎）：release 应随应用打包；开发环境请 brew install agent-desktop".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_to_global_maps_bounds_and_midpoint() {
        // 0 是合法坐标（屏幕顶边/左边），必须映射到 origin 而非被丢弃。
        assert_eq!(norm_to_global(100, 1000, 0.0).unwrap(), 100);
        assert_eq!(norm_to_global(100, 1000, 1000.0).unwrap(), 1100);
        assert_eq!(norm_to_global(0, 2560, 500.0).unwrap(), 1280);
        assert_eq!(norm_to_global(-500, 1920, 0.0).unwrap(), -500);
    }

    #[test]
    fn norm_to_global_rejects_nan_and_out_of_range() {
        assert!(norm_to_global(0, 1000, f64::NAN).is_err());
        assert!(norm_to_global(0, 1000, -0.1).is_err());
        assert!(norm_to_global(0, 1000, 1000.1).is_err());
        assert!(norm_to_global(0, 1000, f64::INFINITY).is_err());
    }

    #[test]
    fn map_key_accepts_modifier_and_named_keys() {
        assert_eq!(map_key("cmd").unwrap(), Key::Meta);
        assert_eq!(map_key("CTRL").unwrap(), Key::Control);
        assert_eq!(map_key("option").unwrap(), Key::Alt);
        assert_eq!(map_key("enter").unwrap(), Key::Return);
        assert_eq!(map_key("esc").unwrap(), Key::Escape);
        assert_eq!(map_key("up").unwrap(), Key::UpArrow);
        assert_eq!(map_key("pagedown").unwrap(), Key::PageDown);
        assert_eq!(map_key("f12").unwrap(), Key::F12);
        assert_eq!(map_key("a").unwrap(), Key::Unicode('a'));
    }

    #[test]
    fn map_key_rejects_unknown_names() {
        assert!(map_key("commandcenter").is_err());
        assert!(map_key("f13").is_err());
        assert!(map_key("").is_err());
    }
}
