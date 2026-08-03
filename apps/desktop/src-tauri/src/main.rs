mod commands;
mod remote_repo;

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

fn main() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .manage(commands::watch::GitWorktreeWatcherState::default());

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    let app = builder
        .setup(|app| {
            // 统一权威数据根，并迁入旧 Tauri bundle 目录残留。
            giteam_core::pi_agent::migrate_legacy_tauri_data_into_canonical();
            let _ = giteam_core::pi_agent::ensure_pi_agent_dir_env();
            commands::ui::apply_saved_window_theme(app.handle());

            #[cfg(target_os = "macos")]
            macos_context_menu::install(app);

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
            commands::pi_agent::list_installed_agent_skills,
            commands::pi_agent::install_builtin_agent_skill,
            commands::pi_agent::remove_installed_agent_skills_by_path,
            commands::pi_agent::save_agent_skill_source_groups,
            commands::pi_agent::fetch_agent_skill_detail_api,
            commands::pi_agent::fetch_agent_skill_audit_api,
            commands::pi_agent::fetch_skillsmp_skill_search,
            commands::pi_agent::fetch_skillsmp_ai_search,
            // MCP UI 由 feature flag 关闭，命令暂留 PR8。
            commands::opencode::list_opencode_mcp_status,
            commands::opencode::add_opencode_mcp_server,
            commands::opencode::delete_opencode_mcp_server,
            commands::opencode::connect_opencode_mcp_server,
            commands::opencode::disconnect_opencode_mcp_server,
            commands::opencode::authenticate_opencode_mcp_server,
            commands::opencode::remove_opencode_mcp_auth,
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
            commands::ui::send_desktop_notification,
            commands::giteam_cli::giteam_cli_get_settings,
            commands::giteam_cli::giteam_cli_get_mobile_service_status,
            commands::giteam_cli::giteam_cli_start_mobile_service_background,
            commands::giteam_cli::giteam_cli_set_settings,
            commands::giteam_cli::giteam_cli_get_pair_code,
            commands::giteam_cli::giteam_cli_refresh_pair_code,
            commands::giteam_cli::giteam_cli_get_access_info,
            commands::control::set_mobile_model_state_from_desktop,
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
