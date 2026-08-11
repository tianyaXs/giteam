// Windows 发行版用 WINDOWS 子系统，避免双击打开时多出一个会拖垮应用的 cmd 窗口；
// debug 仍保留控制台，方便看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod remote_repo;

use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
mod macos_context_menu {
    use std::sync::atomic::{AtomicBool, Ordering};

    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::sel;
    use objc2_app_kit::{NSEvent, NSMenu, NSView, NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;
    use tauri::{App, Manager};

    static PATCHED: AtomicBool = AtomicBool::new(false);
    const TRAFFIC_LIGHT_OFFSET_X: f64 = 6.0;
    const TRAFFIC_LIGHT_OFFSET_Y: f64 = -7.0;

    // Instead of suppressing menuForEvent: (which also breaks the JS contextmenu
    // event chain), we let the native menu build normally and intercept
    // willOpenMenu:withEvent: to clear the menu just before it is shown.
    // This keeps right-mouse-down events flowing to the frontend while hiding
    // the native Reload / Inspect Element menu.
    unsafe extern "C-unwind" fn suppress_will_open_menu(
        _this: &AnyObject,
        _cmd: Sel,
        menu: &NSMenu,
        _event: &NSEvent,
    ) {
        menu.removeAllItems();
    }

    fn offset_standard_window_button(window: &NSWindow, button: NSWindowButton) {
        let Some(button) = window.standardWindowButton(button) else {
            return;
        };
        let frame = button.frame();
        button.setFrameOrigin(NSPoint::new(
            frame.origin.x + TRAFFIC_LIGHT_OFFSET_X,
            frame.origin.y + TRAFFIC_LIGHT_OFFSET_Y,
        ));
    }

    fn align_standard_window_buttons(window: &NSWindow) {
        offset_standard_window_button(window, NSWindowButton::CloseButton);
        offset_standard_window_button(window, NSWindowButton::MiniaturizeButton);
        offset_standard_window_button(window, NSWindowButton::ZoomButton);
    }

    pub fn install(app: &App) {
        if PATCHED.swap(true, Ordering::SeqCst) {
            return;
        }

        let Some(window) = app.get_webview_window("main") else {
            return;
        };

        let _ = window.with_webview(|webview| unsafe {
            let native_view = &*webview.inner().cast::<NSView>();
            if let Some(native_window) = native_view.window() {
                align_standard_window_buttons(&native_window);
            }

            let view = &*webview.inner().cast::<AnyObject>();
            let cls = view.class();

            // willOpenMenu:withEvent: is called on NSView right before the
            // context menu is presented.  Clearing the items here makes the
            // menu empty so nothing native is shown, but the right-click
            // event has already propagated through the responder chain and
            // reaches the web view / JS layer.
            if let Some(method) = cls.instance_method(sel!(willOpenMenu:withEvent:)) {
                let replacement: Imp = std::mem::transmute(
                    suppress_will_open_menu
                        as unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSMenu, &NSEvent),
                );
                method.set_implementation(replacement);
            }
        });
    }
}

/// 把临时目录放到与应用同一卷，避免 updater `rename` 触发 EXDEV（os error 18）。
fn align_temp_dir_with_app_volume() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let app_path = resolve_app_install_path(&exe);
    let Ok(app_meta) = std::fs::metadata(&app_path) else {
        return;
    };

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(parent) = app_path.parent() {
        candidates.push(parent.join(".giteam-updater-tmp"));
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = std::path::PathBuf::from(home);
        candidates.push(home.join(".giteam").join("updater-tmp"));
        candidates.push(home.join("Library").join("Caches").join("giteam-updater"));
    }

    for candidate in candidates {
        if std::fs::create_dir_all(&candidate).is_err() {
            continue;
        }
        let Ok(tmp_meta) = std::fs::metadata(&candidate) else {
            continue;
        };
        if !same_fs_device(&app_path, &candidate, &app_meta, &tmp_meta) {
            continue;
        }
        std::env::set_var("TMPDIR", &candidate);
        #[cfg(windows)]
        {
            std::env::set_var("TEMP", &candidate);
            std::env::set_var("TMP", &candidate);
        }
        return;
    }
}

fn resolve_app_install_path(exe: &std::path::Path) -> std::path::PathBuf {
    #[cfg(target_os = "macos")]
    {
        // …/App.app/Contents/MacOS/binary → App.app
        if let (Some(macos), Some(contents), Some(bundle)) = (
            exe.parent(),
            exe.parent().and_then(|p| p.parent()),
            exe.parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent()),
        ) {
            let _ = macos;
            let _ = contents;
            if bundle.extension().and_then(|ext| ext.to_str()) == Some("app") {
                return bundle.to_path_buf();
            }
        }
    }
    exe.to_path_buf()
}

fn same_fs_device(
    a_path: &std::path::Path,
    b_path: &std::path::Path,
    a: &std::fs::Metadata,
    b: &std::fs::Metadata,
) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = (a_path, b_path);
        return a.dev() == b.dev();
    }
    #[cfg(windows)]
    {
        // `MetadataExt::volume_serial_number` 仍是 unstable，稳定版用盘符/UNC 根比较。
        let _ = (a, b);
        fn volume_root(path: &std::path::Path) -> Option<std::path::PathBuf> {
            use std::path::{Component, PathBuf};
            let abs = if path.is_absolute() {
                path.to_path_buf()
            } else {
                std::env::current_dir().ok()?.join(path)
            };
            let mut components = abs.components();
            match components.next()? {
                Component::Prefix(prefix) => {
                    let mut root = PathBuf::new();
                    root.push(Component::Prefix(prefix));
                    if matches!(components.next(), Some(Component::RootDir)) {
                        root.push(Component::RootDir);
                    }
                    Some(root)
                }
                _ => None,
            }
        }
        return volume_root(a_path) == volume_root(b_path);
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (a_path, b_path, a, b);
        true
    }
}

fn main() {
    // Updater 用 rename 安装；TMPDIR 与 .app 跨卷会触发 Cross-device link (os error 18)。
    align_temp_dir_with_app_volume();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(commands::watch::GitWorktreeWatcherState::default())
        // 窗口状态持久化：保存/恢复 size、position、maximized（首次启动用 tauri.conf 默认）。
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    let app = builder
        .setup(|app| {
            // 统一权威数据根（~/.giteam），并迁入旧 Application Support / Tauri bundle 残留。
            giteam_core::pi_agent::migrate_legacy_tauri_data_into_canonical();
            let pi_dir = giteam_core::pi_agent::ensure_pi_agent_dir_env();
            // #35 诊断：asupersync connect 全生命周期日志，排查 Windows WSAENOTCONN 10057。
            // 落 PI_CODING_AGENT_DIR/asupersync-connect.log；asupersync 仅在设此环境变量时写文件。
            if let Some(dir) = pi_dir {
                std::env::set_var("ASUPERSYNC_CONNECT_LOG", dir.join("asupersync-connect.log"));
            }
            commands::ui::apply_saved_window_theme(app.handle());
            // 内置浏览器 controller（desktop 全局注入）：service 跨 session 持有，
            // 冷启动恢复 / set_session_options 重建 handle 时复用，避免 browser_use
            // 在热切/恢复后失效（旧 session 报「内置浏览器仅在桌面端可用」）。
            // CDP 版：chromiumoxide 经 Chrome DevTools Protocol 操作真实 Chrome，绕开 Tauri
            // 外部 URL 子 webview 的 IPC 断链（旧 TauriBrowserController 保留作 fallback，不再注入）。
            giteam_core::pi_agent::PiAgentService::global().set_browser_controller(Some(
                commands::chromiumoxide_controller::new_controller(),
            ));
            // browser_use action 的 requestId 配对注册表（app state 共享）：
            // controller 注册 sender + eval JS，browser_event command 按 request_id 唤醒。
            app.manage(std::sync::Arc::new(
                commands::browser_controller::BrowserActionRegistry::default(),
            ));
            // 钳制主窗口不超出当前屏幕可用区：Windows 高 DPI（125%/150%）+ 任务栏下，
            // 默认或恢复的窗口尺寸可能超出屏幕致底部被任务栏遮挡，需手动最大化才完整。
            if let Some(window) = app.get_webview_window("main") {
                let _ = clamp_window_to_monitor(&window);
            }
            // 系统托盘：关闭最小化到托盘时，点托盘图标或菜单恢复窗口、或真正退出。
            let _ = build_tray(app.handle());

            #[cfg(target_os = "macos")]
            macos_context_menu::install(app);

            // 手机端模型开关双向同步：后台线程轮询 mobile-model-state.json，
            // updatedAt 变化时 emit 给前端 apply（手机端 toggle → control server
            // 合并写文件 → 这里 30s 内感知 → 前端 diff 应用 enabled/hidden →
            // 重算 availableModels push 回手机）。control server 在独立 CLI 子进程，
            // 无 Tauri event 通道，故走文件 + 轮询（非实时是架构约束，非 bug）。
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut last_updated_at: Option<u64> = None;
                    loop {
                        let value = giteam_core::control::get_mobile_model_state_for_desktop()
                            .unwrap_or(serde_json::Value::Null);
                        let ts = value.get("updatedAt").and_then(|v| v.as_u64());
                        if !value.is_null() && ts != last_updated_at {
                            let _ = handle.emit("mobile-model-state-pulled", value);
                            last_updated_at = ts;
                        }
                        std::thread::sleep(std::time::Duration::from_secs(30));
                    }
                });
            }

            std::thread::spawn(|| {
                commands::giteam_cli::start_managed_mobile_service();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::entire::run_entire_status_detailed,
            commands::entire::run_entire_explain_commit,
            commands::entire::run_entire_explain_commit_short,
            commands::entire::run_entire_explain_checkpoint,
            commands::entire::run_entire_explain_checkpoint_raw_transcript,
            commands::env::check_runtime_requirements,
            commands::env::check_runtime_dependency,
            commands::env::start_runtime_dependency_action,
            commands::env::get_runtime_dependency_action,
            commands::release_notes::fetch_latest_release,
            commands::ui::pick_agent_attachments,
            commands::ui::read_agent_attachments_from_paths,
            commands::ui::read_clipboard_file_paths,
            commands::ui::read_clipboard_image_attachment,
            commands::ui::stage_agent_prompt_images,
            commands::ui::read_local_attachment_preview,
            commands::ui::open_local_path,
            commands::git::run_git_head_commit,
            commands::git::run_git_pull,
            commands::git::run_git_push,
            commands::git::run_git_commit,
            commands::git::run_git_show_patch,
            commands::git::run_git_recent_commits,
            commands::git::run_git_local_branches,
            commands::git::run_git_branch_commits,
            commands::git::run_git_commit_graph,
            commands::git::run_git_commit_changed_files,
            commands::git::run_git_commit_file_patch,
            commands::git::run_git_worktree_overview,
            commands::git::run_git_worktree_list,
            commands::git::run_git_worktree_file_patch,
            commands::git::run_git_worktree_file_content,
            commands::git::run_git_checkout_branch,
            commands::git::run_git_checkout_remote_branch,
            commands::git::run_git_discard_changes,
            commands::git::run_git_cherry_pick_commit,
            commands::git::run_git_revert_commit,
            commands::git::run_git_stage_file,
            commands::git::run_git_unstage_file,
            commands::git::run_git_create_branch,
            commands::git::run_git_delete_branch,
            commands::git::run_git_create_worktree_from_branch,
            commands::git::run_git_create_detached_worktree,
            commands::git::run_git_remove_worktree,
            commands::git::run_repo_terminal_command,
            commands::git::start_repo_terminal_session,
            commands::git::send_repo_terminal_input,
            commands::git::resize_repo_terminal_session,
            commands::git::read_repo_terminal_output,
            commands::git::complete_repo_terminal_input,
            commands::git::list_repo_terminal_completions,
            commands::git::clear_repo_terminal_session,
            commands::git::close_repo_terminal_session,
            commands::git::run_git_user_identity,
            commands::pi_agent::agent_runtime_info,
            commands::pi_agent::agent_create_session,
            commands::pi_agent::agent_list_sessions,
            commands::pi_agent::agent_list_child_sessions,
            commands::pi_agent::agent_get_session,
            commands::pi_agent::agent_get_session_messages,
            commands::pi_agent::agent_prompt,
            commands::pi_agent::agent_abort,
            commands::pi_agent::agent_delete_session,
            commands::pi_agent::agent_list_providers,
            commands::pi_agent::agent_list_models,
            commands::pi_agent::agent_find_model,
            commands::pi_agent::agent_save_api_key,
            commands::pi_agent::agent_remove_api_key,
            commands::pi_agent::agent_has_credential,
            commands::pi_agent::agent_save_custom_provider,
            commands::pi_agent::agent_remove_custom_provider,
            commands::pi_agent::agent_connect_openai_compatible,
            commands::pi_agent::agent_update_provider_endpoint,
            commands::pi_agent::agent_refresh_provider_models,
            commands::pi_agent::agent_set_model,
            commands::pi_agent::agent_set_thinking,
            commands::pi_agent::agent_list_interactions,
            commands::pi_agent::agent_reply_interaction,
            commands::pi_agent::agent_set_auto_approve,
            commands::pi_agent::agent_set_session_options,
            commands::pi_agent::list_installed_agent_skills,
            commands::pi_agent::install_builtin_agent_skill,
            commands::pi_agent::remove_installed_agent_skills_by_path,
            commands::pi_agent::save_agent_skill_source_groups,
            commands::pi_agent::fetch_agent_skill_detail_api,
            commands::pi_agent::fetch_agent_skill_audit_api,
            commands::pi_agent::fetch_skillsmp_skill_search,
            commands::pi_agent::fetch_skillsmp_ai_search,
            commands::db::db_save_review_record,
            commands::db::db_list_review_records,
            commands::db::db_save_review_action,
            commands::db::db_list_review_actions,
            commands::db::db_add_repository,
            commands::db::db_list_repositories,
            commands::db::db_remove_repository,
            remote_repo::commands::remote_repo,
            commands::db::pick_repository_folder,
            commands::ui::set_window_theme,
            commands::ui::open_external_url,
            commands::browser_panel::open_browser_embedded,
            commands::browser_panel::select_browser_tab,
            commands::browser_panel::navigate_browser,
            commands::browser_panel::set_browser_bounds,
            commands::browser_panel::hide_browser,
            commands::browser_panel::hide_all_browser,
            commands::browser_panel::close_browser,
            commands::browser_panel::reload_browser,
            commands::browser_panel::browser_go,
            commands::browser_panel::browser_event,
            commands::ui::send_desktop_notification,
            commands::giteam_cli::giteam_cli_get_settings,
            commands::giteam_cli::giteam_cli_get_mobile_service_status,
            commands::giteam_cli::giteam_cli_start_mobile_service_background,
            commands::giteam_cli::giteam_cli_set_settings,
            commands::giteam_cli::giteam_cli_get_pair_code,
            commands::giteam_cli::giteam_cli_refresh_pair_code,
            commands::giteam_cli::giteam_cli_get_access_info,
            commands::control::set_mobile_model_state_from_desktop,
            commands::control::get_mobile_model_state_for_desktop,
            commands::watch::start_git_worktree_watcher,
            commands::watch::stop_git_worktree_watcher
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    app.run(|_app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            giteam_core::pi_agent::PiAgentService::global().shutdown();
        }
    });
}

/// 钳制主窗口不超出当前屏幕可用区。最大化状态由 window-state 插件恢复、不干预；
/// 仅对非最大化的窗口，按 monitor 尺寸（扣除任务栏/dock + 标题栏余量）约束宽高并居中。
fn clamp_window_to_monitor(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if window.is_maximized().unwrap_or(false) {
        return Ok(());
    }
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    // 全部转逻辑像素统一比较。
    let mon_w = monitor.size().width as f64 / scale;
    let mon_h = monitor.size().height as f64 / scale;
    // monitor.size() 是显示器全分辨率（含任务栏区），扣保守余量估算工作区：
    // Windows 任务栏约 48px + 标题栏，macOS/Linux dock 可变，统一取 80。
    let max_w = (mon_w - 16.0).max(640.0);
    let max_h = (mon_h - 80.0).max(480.0);
    let cur = window.outer_size()?;
    let cur_w = cur.width as f64 / scale;
    let cur_h = cur.height as f64 / scale;
    if cur_w <= max_w && cur_h <= max_h {
        return Ok(());
    }
    let new_w = cur_w.min(max_w).round();
    let new_h = cur_h.min(max_h).round();
    window.set_size(tauri::LogicalSize::new(new_w, new_h))?;
    let mon_pos = monitor.position();
    let mon_x = mon_pos.x as f64 / scale;
    let mon_y = mon_pos.y as f64 / scale;
    let x = (mon_x + (mon_w - new_w) / 2.0).round();
    let y = (mon_y + (mon_h - new_h) / 2.0).round();
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    Ok(())
}

/// 构建系统托盘图标与菜单。关闭按钮由前端按 `closeBehavior` 决定 hide（最小化到
/// 托盘）或 destroy（退出）；托盘提供「显示窗口」恢复、「退出 Giteam」真正关闭
/// （触发 `RunEvent::Exit` 走既有 pi_agent shutdown）。
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = tauri::menu::MenuItem::with_id(app, "tray_show", "显示窗口", true, None::<&str>)?;
    let quit = tauri::menu::MenuItem::with_id(app, "tray_quit", "退出 Giteam", true, None::<&str>)?;
    let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;
    let icon = app.default_window_icon().cloned();
    let mut builder = tauri::tray::TrayIconBuilder::new()
        .tooltip("Giteam")
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击恢复窗口（menu_on_left_click=false 让左键不弹菜单，改由这里处理）。
            if matches!(
                event,
                tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. }
            ) {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
