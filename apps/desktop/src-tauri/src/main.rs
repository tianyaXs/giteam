mod commands;

#[cfg(target_os = "macos")]
mod macos_context_menu {
    use std::sync::atomic::{AtomicBool, Ordering};

    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::sel;
    use objc2_app_kit::{NSEvent, NSMenu};
    use tauri::{App, Manager};

    static PATCHED: AtomicBool = AtomicBool::new(false);

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

    pub fn install(app: &App) {
        if PATCHED.swap(true, Ordering::SeqCst) {
            return;
        }

        let Some(window) = app.get_webview_window("main") else {
            return;
        };

        let _ = window.with_webview(|webview| unsafe {
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
    let app = tauri::Builder::default()
        .manage(commands::watch::GitWorktreeWatcherState::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            macos_context_menu::install(app);

            std::thread::spawn(|| {
                commands::opencode::warmup_managed_opencode_service();
            });
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
            commands::git::run_git_discard_changes,
            commands::git::run_git_stage_file,
            commands::git::run_git_unstage_file,
            commands::git::run_git_create_branch,
            commands::git::run_git_delete_branch,
            commands::git::run_git_create_worktree_from_branch,
            commands::git::run_git_remove_worktree,
            commands::git::run_repo_terminal_command,
            commands::git::start_repo_terminal_session,
            commands::git::send_repo_terminal_input,
            commands::git::read_repo_terminal_output,
            commands::git::clear_repo_terminal_session,
            commands::git::close_repo_terminal_session,
            commands::git::run_git_user_identity,
            commands::opencode::run_opencode_version,
            commands::opencode::run_opencode_providers,
            commands::opencode::run_opencode_models,
            commands::opencode::get_opencode_models_dev_catalog,
            commands::opencode::run_opencode_agent,
            commands::opencode::run_opencode_mcp,
            commands::opencode::run_opencode_stats,
            commands::opencode::test_opencode_model,
            commands::opencode::run_opencode_prompt,
            commands::opencode::run_opencode_prompt_stream,
            commands::opencode::post_opencode_session_prompt_async,
            commands::opencode::abort_opencode_session,
            commands::opencode::list_opencode_sessions,
            commands::opencode::create_opencode_session,
            commands::opencode::delete_opencode_session,
            commands::opencode::get_opencode_session_messages,
            commands::opencode::get_opencode_session_messages_detailed,
            commands::opencode::get_opencode_model_config,
            commands::opencode::get_opencode_config_provider_catalog,
            commands::opencode::get_opencode_server_provider_catalog,
            commands::opencode::get_opencode_server_provider_state,
            commands::opencode::get_opencode_server_provider_auth,
            commands::opencode::get_opencode_server_config,
            commands::opencode::get_opencode_service_base,
            commands::opencode::get_opencode_service_settings,
            commands::opencode::set_opencode_service_settings,
            commands::opencode::get_opencode_server_global_config,
            commands::opencode::patch_opencode_server_config,
            commands::opencode::set_opencode_server_current_model,
            commands::opencode::put_opencode_server_auth,
            commands::opencode::delete_opencode_server_auth,
            commands::opencode::disconnect_opencode_server_provider,
            commands::opencode::set_opencode_model_config,
            commands::opencode::get_opencode_provider_config,
            commands::opencode::set_opencode_provider_config,
            commands::db::db_save_review_record,
            commands::db::db_list_review_records,
            commands::db::db_save_review_action,
            commands::db::db_list_review_actions,
            commands::db::db_add_repository,
            commands::db::db_list_repositories,
            commands::db::db_remove_repository,
            commands::db::pick_repository_folder,
            commands::ui::set_window_theme,
            commands::giteam_cli::giteam_cli_get_settings,
            commands::giteam_cli::giteam_cli_get_mobile_service_status,
            commands::giteam_cli::giteam_cli_start_mobile_service_background,
            commands::giteam_cli::giteam_cli_set_settings,
            commands::giteam_cli::giteam_cli_get_pair_code,
            commands::giteam_cli::giteam_cli_refresh_pair_code,
            commands::giteam_cli::giteam_cli_get_access_info,
            commands::watch::start_git_worktree_watcher,
            commands::watch::stop_git_worktree_watcher
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    app.run(|_app_handle, _event| {});
}
