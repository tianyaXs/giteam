//! 桌面宠物窗口：独立于主窗口的透明置顶层。
//!
//! 主窗口失焦、最小化或收到托盘时，这扇窗仍然留在桌面上。点击由前端转成
//! `pet_open_client`，把主窗口拉回前台。macOS 走 NSPanel，避免 release 包里普通
//! 窗口置顶失效；不穿透鼠标，这样拖动和点击都落在宠物上。

use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const PET_LABEL: &str = "desktop-pet";
const PET_EVENT: &str = "giteam://pet-sync";
/// 与 bot-avatars 的 BOT_AVATAR_OVERSCAN 对齐，给跳跃和翻转留出透明边。
const WINDOW_OVERSCAN: f64 = 1.5;

static PET_WINDOW: Mutex<Option<WebviewWindow>> = Mutex::new(None);
static PET_SNAPSHOT: Mutex<Option<PetSync>> = Mutex::new(None);
static PET_READY: AtomicBool = AtomicBool::new(false);
static PET_PLACED: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
static PET_PANEL: OnceLock<tauri_nspanel::PanelHandle<tauri::Wry>> = OnceLock::new();

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(PetPanel {
        config: {
            can_become_key_window: false
        }
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetSync {
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default = "default_type", rename = "type")]
    shape: String,
    #[serde(default = "default_shading")]
    shading: String,
    #[serde(default = "default_face")]
    face: String,
    #[serde(default = "default_none")]
    hat: String,
    #[serde(default = "default_none")]
    glasses: String,
    #[serde(default)]
    headphones: bool,
    #[serde(default)]
    bow_tie: bool,
    #[serde(default)]
    color: String,
    #[serde(default)]
    accessory_color: String,
    #[serde(default = "default_size")]
    size: u32,
    #[serde(default = "default_sleep")]
    sleep_minutes: u32,
    #[serde(default)]
    busy: bool,
    #[serde(default)]
    last_activity_at: u64,
}

fn default_enabled() -> bool { true }
fn default_type() -> String { "circle".into() }
fn default_shading() -> String { "flat".into() }
fn default_face() -> String { "eyes".into() }
fn default_none() -> String { "none".into() }
fn default_size() -> u32 { 168 }
fn default_sleep() -> u32 { 5 }

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

fn current_snapshot() -> PetSync {
    PET_SNAPSHOT
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_else(|| serde_json::from_value(serde_json::json!({})).unwrap_or_else(|_| PetSync {
            enabled: true,
            shape: default_type(),
            shading: default_shading(),
            face: default_face(),
            hat: default_none(),
            glasses: default_none(),
            headphones: false,
            bow_tie: false,
            color: String::new(),
            accessory_color: String::new(),
            size: default_size(),
            sleep_minutes: default_sleep(),
            busy: false,
            last_activity_at: 0,
        }))
}

fn avatar_size(size: u32) -> u32 {
    size.clamp(112, 240)
}

fn window_side(size: u32) -> f64 {
    (avatar_size(size) as f64 * WINDOW_OVERSCAN).round()
}

fn position_path() -> Option<std::path::PathBuf> {
    Some(giteam_core::pi_agent::giteam_data_dir()?.join("desktop-pet-position.json"))
}

fn load_position() -> Option<(i32, i32)> {
    let text = fs::read_to_string(position_path()?).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let x = value.get("x")?.as_i64()? as i32;
    let y = value.get("y")?.as_i64()? as i32;
    Some((x, y))
}

fn save_position(x: i32, y: i32) {
    let Some(path) = position_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(path, format!("{{\"x\":{x},\"y\":{y}}}"));
}

fn position_visible(app: &AppHandle, x: i32, y: i32) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };
    monitors.iter().any(|monitor| {
        let mx = monitor.position().x;
        let my = monitor.position().y;
        let mw = monitor.size().width as i32;
        let mh = monitor.size().height as i32;
        x >= mx - 80 && y >= my - 80 && x < mx + mw && y < my + mh
    })
}

fn place_default(window: &WebviewWindow, side: f64) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|err| err.to_string())?
        .ok_or("没有可用显示器")?;
    let scale = monitor.scale_factor();
    let mon_w = monitor.size().width as f64 / scale;
    let mon_h = monitor.size().height as f64 / scale;
    let origin_x = monitor.position().x as f64 / scale;
    let origin_y = monitor.position().y as f64 / scale;
    let x = origin_x + mon_w - side - 28.0;
    let y = origin_y + mon_h - side - 72.0;
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|err| err.to_string())
}

fn living_window() -> Option<WebviewWindow> {
    let window = PET_WINDOW.lock().ok()?.clone()?;
    match window.is_visible() {
        Ok(_) => Some(window),
        Err(_) => {
            if let Ok(mut guard) = PET_WINDOW.lock() {
                *guard = None;
            }
            PET_PLACED.store(false, Ordering::SeqCst);
            None
        }
    }
}

fn show_pet(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(panel) = PET_PANEL.get() {
            panel.show();
            return Ok(());
        }
    }
    window.show().map_err(|err| err.to_string())?;
    let _ = window.set_always_on_top(true);
    Ok(())
}

fn hide_pet(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(panel) = PET_PANEL.get() {
            panel.hide();
            return Ok(());
        }
    }
    window.hide().map_err(|err| err.to_string())
}

/// ⚠️ 仅主线程调用。
fn ensure_pet_window(app: &AppHandle, size: u32) -> Result<WebviewWindow, String> {
    if let Some(window) = living_window() {
        let side = window_side(size);
        let _ = window.set_size(tauri::LogicalSize::new(side, side));
        return Ok(window);
    }
    let side = window_side(size);
    let window = WebviewWindowBuilder::new(app, PET_LABEL, WebviewUrl::App("pet.html".into()))
        .title("")
        .inner_size(side, side)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .focusable(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .visible(false)
        .build()
        .map_err(|err| format!("创建宠物窗口失败：{err}"))?;

    let watched = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = watched.hide();
        }
    });

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::{CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};
        match window.to_panel::<PetPanel<tauri::Wry>>() {
            Ok(panel) => {
                panel.set_level(PanelLevel::Floating.value());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .full_screen_auxiliary()
                        .move_to_active_space()
                        .into(),
                );
                let _ = panel.add_style_mask(StyleMask::empty().nonactivating_panel().into());
                // 默认 NSPanel 会在应用失焦时隐藏。宠物要在主窗口不在前台时继续悬浮。
                panel.set_hides_on_deactivate(false);
                panel.set_released_when_closed(false);
                let _ = PET_PANEL.set(panel);
            }
            Err(err) => eprintln!("宠物窗口转 NSPanel 失败（降级普通窗口）：{err}"),
        }
    }

    if !PET_PLACED.swap(true, Ordering::SeqCst) {
        if let Some((x, y)) = load_position().filter(|(x, y)| position_visible(app, *x, *y)) {
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        } else if let Err(err) = place_default(&window, side) {
            eprintln!("宠物默认位置失败：{err}");
        }
    }

    if let Ok(mut guard) = PET_WINDOW.lock() {
        *guard = Some(window.clone());
    }
    Ok(window)
}

fn apply_snapshot(app: &AppHandle, snapshot: PetSync) -> Result<(), String> {
    if let Ok(mut guard) = PET_SNAPSHOT.lock() {
        *guard = Some(snapshot.clone());
    }
    if !snapshot.enabled {
        if let Some(window) = living_window() {
            hide_pet(&window)?;
        }
        return Ok(());
    }
    let window = ensure_pet_window(app, snapshot.size)?;
    let _ = window.emit(PET_EVENT, &snapshot);
    if PET_READY.load(Ordering::SeqCst) {
        show_pet(&window)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn pet_sync(app: AppHandle, snapshot: PetSync) -> Result<(), String> {
    let app_main = app.clone();
    on_main(&app, move || apply_snapshot(&app_main, snapshot))
}

#[tauri::command]
pub(crate) fn pet_ready(app: AppHandle) -> Result<PetSync, String> {
    PET_READY.store(true, Ordering::SeqCst);
    let snapshot = current_snapshot();
    let enabled = snapshot.enabled;
    let app_main = app.clone();
    on_main(&app, move || {
        if !enabled {
            return Ok(());
        }
        if let Some(window) = living_window() {
            show_pet(&window)?;
        } else {
            let window = ensure_pet_window(&app_main, current_snapshot().size)?;
            show_pet(&window)?;
        }
        Ok(())
    })?;
    Ok(current_snapshot())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPointer {
    x: f64,
    y: f64,
}

/// 鼠标相对宠物窗口视口左上角的逻辑像素。窗口外的坐标也可以是负数。
#[tauri::command]
pub(crate) fn pet_pointer(app: AppHandle) -> Result<PetPointer, String> {
    let app_main = app.clone();
    on_main(&app, move || {
        let window = living_window().ok_or_else(|| "宠物窗口不在".to_string())?;
        let cursor = app_main
            .cursor_position()
            .map_err(|err| format!("读取鼠标失败：{err}"))?;
        let origin = window
            .outer_position()
            .map_err(|err| format!("读取窗口位置失败：{err}"))?;
        let scale = window
            .scale_factor()
            .map_err(|err| format!("读取缩放失败：{err}"))?
            .max(0.01);
        Ok(PetPointer {
            x: (cursor.x - f64::from(origin.x)) / scale,
            y: (cursor.y - f64::from(origin.y)) / scale,
        })
    })
}

#[tauri::command]
pub(crate) fn pet_open_client(app: AppHandle) {
    crate::show_main_window(&app);
}

#[tauri::command]
pub(crate) fn pet_save_position(x: i32, y: i32) {
    save_position(x, y);
}
