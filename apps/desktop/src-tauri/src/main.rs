mod commands;

fn main() {
    let app = tauri::Builder::default()
        .setup(|_app| {
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
            commands::git::run_git_show_patch,
            commands::git::run_git_recent_commits,
            commands::git::run_git_local_branches,
            commands::git::run_git_branch_commits,
            commands::git::run_git_commit_graph,
            commands::git::run_git_commit_changed_files,
            commands::git::run_git_commit_file_patch,
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
            commands::giteam_cli::giteam_cli_get_access_info
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    app.run(|_app_handle, _event| {});
}
