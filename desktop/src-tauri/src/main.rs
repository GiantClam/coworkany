//! CoworkAny Desktop - Main Entry Point
//!
//! Tauri application entry point that sets up:
//! - Sidecar process management (Bun agent)
//! - Process manager (Python RAG service)
//! - IPC command handlers
//! - Shadow FS for non-destructive edits
//! - Policy engine for effect approval

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod diff;
mod git_integration;
mod ipc;
mod magnetic_window;
mod policy;
mod process_manager;
mod shadow_fs;
mod sidecar;
mod screen_capture;
mod tray;
mod window_manager;


use policy::{ConsoleAuditSink, PolicyEngineState};
use process_manager::ProcessManagerState;
use shadow_fs::ShadowFsState;
use sidecar::SidecarState;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use tracing::{info, warn, error};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// IPC command to update the global shortcut for toggling the main window.
/// Unregisters the old shortcut and registers the new one.
#[tauri::command]
fn update_global_shortcut(
    app: tauri::AppHandle,
    old_shortcut: String,
    new_shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Unregister the old shortcut (ignore errors — may not be registered)
    let _ = app.global_shortcut().unregister(old_shortcut.as_str());

    // Register the new shortcut
    app.global_shortcut()
        .register(new_shortcut.as_str())
        .map_err(|e| format!("Failed to register shortcut '{}': {}", new_shortcut, e))?;

    info!("Global shortcut updated: '{}' -> '{}'", old_shortcut, new_shortcut);
    Ok(())
}

fn main() {
    // ---------- Log directory setup ----------
    // Logs go to .coworkany/logs/ under the current working directory.
    let log_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join(".coworkany")
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    // Daily-rotated file appender: desktop-YYYY-MM-DD.log
    let file_appender = tracing_appender::rolling::daily(&log_dir, "desktop.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Initialize tracing — logs to both stderr (console) and file
    let env_filter =
        EnvFilter::from_default_env().add_directive("coworkany=debug".parse().unwrap());

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().with_writer(std::io::stderr))             // console
        .with(fmt::layer().with_ansi(false).with_writer(non_blocking)) // file
        .init();

    info!("CoworkAny Desktop starting...");
    info!("Log directory: {}", log_dir.display());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarState::new())
        .manage(ProcessManagerState::new())
        .manage::<ShadowFsState>(Arc::new(Mutex::new(None)))
        .manage(PolicyEngineState::new(Box::new(ConsoleAuditSink)))
        .manage(magnetic_window::MagneticWindowState::new()) // Added
        .invoke_handler(tauri::generate_handler![
            // Sidecar commands
            ipc::start_task,
            ipc::cancel_task,
            ipc::send_task_message,
            ipc::clear_task_history,
            ipc::get_tasks, // Previously added
            ipc::get_sidecar_status,
            ipc::get_llm_settings,
            ipc::save_llm_settings,
            ipc::validate_llm_settings,
            ipc::get_workspace_root,
            ipc::load_sessions,
            ipc::save_sessions,
            ipc::spawn_sidecar,
            ipc::shutdown_sidecar,
            ipc::list_toolpacks,
            ipc::get_toolpack,
            ipc::install_toolpack,
            ipc::set_toolpack_enabled,
            ipc::remove_toolpack,
            ipc::list_claude_skills,
            ipc::get_claude_skill,
            ipc::import_claude_skill,
            ipc::set_claude_skill_enabled,
            ipc::remove_claude_skill,
            // Workspace commands
            ipc::list_workspaces,
            ipc::create_workspace,
            ipc::update_workspace,
            ipc::delete_workspace,
            ipc::install_from_github,
            // Scanning commands
            ipc::scan_default_repos,
            ipc::scan_skills,
            ipc::scan_mcp_servers,
            ipc::validate_skill,
            ipc::validate_mcp,
            ipc::validate_github_url,
            // Shadow FS commands
            shadow_fs::stage_file,
            shadow_fs::list_pending_patches,
            shadow_fs::approve_patch,
            shadow_fs::reject_patch,
            shadow_fs::apply_patch,
            shadow_fs::cleanup_trash,
            // Policy commands
            policy::commands::request_effect,
            policy::commands::confirm_effect,
            policy::commands::deny_effect,
            policy::commands::get_pending_confirmations,
            policy::commands::register_agent_identity,
            policy::commands::record_agent_delegation,
            policy::commands::report_mcp_gateway_decision,
            policy::commands::report_runtime_security_alert,
            // Service management commands
            ipc::start_all_services,
            ipc::stop_all_services,
            ipc::start_service,
            ipc::stop_service,
            ipc::get_all_services_status,
            ipc::get_service_status,
            ipc::health_check_service,
            // Window commands
            window_manager::set_window_state,
            window_manager::open_quickchat,
            window_manager::close_quickchat,
            magnetic_window::sync_window_positions, // Added
            // Git commands
            git_integration::git_status,
            git_integration::git_commit,
            git_integration::git_log,
            git_integration::git_checkpoint,
            git_integration::git_rollback,
            // Screen Capture
            screen_capture::capture_screen,
            // Shortcut management
            update_global_shortcut,
        ])
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state == ShortcutState::Pressed {
                        // Any registered global shortcut toggles the main window
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            let is_focused = window.is_focused().unwrap_or(false);

                            if is_visible && is_focused {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            info!("Tauri app setup complete");

            let app_handle = app.handle().clone();

            // Register global shortcut — unregister first to avoid "already registered"
            // errors that occur during dev-mode hot reloads.
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let _ = app_handle.global_shortcut().unregister("Alt+Space");
            if let Err(e) = app_handle.global_shortcut().register("Alt+Space") {
                tracing::warn!("Failed to register global shortcut 'Alt+Space': {}", e);
                // Continue application startup even if shortcut fails
            }

            // Initialize Shadow FS with workspace path
            let shadow_state = app.state::<ShadowFsState>();

            // Get workspace path (current dir for now, can be configurable)
            if let Ok(cwd) = std::env::current_dir() {
                let mut guard = shadow_state.blocking_lock();
                match shadow_fs::ShadowFs::new(cwd) {
                    Ok(fs) => {
                        *guard = Some(fs);
                        info!("Shadow FS initialized");
                    }
                    Err(e) => {
                        tracing::warn!("Failed to initialize Shadow FS: {}", e);
                    }
                }
            }

            // Initialize Process Manager with app handle
            {
                let process_state = app.state::<ProcessManagerState>();
                let mut manager = process_state.0.lock().unwrap();
                manager.set_app_handle(app_handle.clone());
                info!("Process Manager initialized");
            }

            // Start sidecar and backend services asynchronously so the first window paints faster.
            {
                let app_for_boot = app_handle.clone();
                std::thread::spawn(move || {
                    // Auto-spawn sidecar on startup
                    {
                        let state = app_for_boot.state::<SidecarState>();
                        let mut manager = state.0.lock().unwrap();
                        if let Err(e) = manager.spawn(app_for_boot.clone()) {
                            tracing::warn!("Failed to auto-spawn sidecar on startup: {}", e);
                            // Non-fatal - sidecar will be spawned on first command
                        } else {
                            let _ = app_for_boot.emit("service-status", serde_json::json!({
                                "name": "sidecar",
                                "status": "running"
                            }));
                        }
                    }

                    // NOTE: backend services are warmed by frontend after first paint.
                    // We intentionally skip startup here to reduce time-to-interactive.
                });
            }

            // Sidecar watchdog — auto-restart on crash (max 3 attempts, exponential backoff)
            {
                let sidecar_state = app.state::<SidecarState>().0.clone();
                let watchdog_handle = app_handle.clone();
                std::thread::spawn(move || {
                    let max_restarts = 3u32;
                    let mut restart_count = 0u32;
                    let mut last_restart = std::time::Instant::now();

                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(5));

                        let running = {
                            if let Ok(mut mgr) = sidecar_state.lock() {
                                mgr.is_running()
                            } else {
                                continue;
                            }
                        };

                        if !running {
                            // Reset counter if last restart was > 2 minutes ago
                            if last_restart.elapsed() > std::time::Duration::from_secs(120) {
                                restart_count = 0;
                            }

                            if restart_count >= max_restarts {
                                error!("Sidecar watchdog: max restarts ({}) exceeded, giving up", max_restarts);
                                let _ = watchdog_handle.emit("sidecar-failed", serde_json::json!({
                                    "message": "Sidecar process failed to stay running after multiple restarts"
                                }));
                                // Wait longer before trying again
                                std::thread::sleep(std::time::Duration::from_secs(60));
                                restart_count = 0;
                                continue;
                            }

                            let backoff_secs = 2u64.pow(restart_count);
                            warn!(
                                "Sidecar watchdog: process not running, restarting in {}s (attempt {}/{})",
                                backoff_secs, restart_count + 1, max_restarts
                            );

                            let _ = watchdog_handle.emit("sidecar-restarting", serde_json::json!({
                                "attempt": restart_count + 1,
                                "maxAttempts": max_restarts,
                                "backoffSecs": backoff_secs
                            }));

                            std::thread::sleep(std::time::Duration::from_secs(backoff_secs));

                            if let Ok(mut mgr) = sidecar_state.lock() {
                                match mgr.spawn(watchdog_handle.clone()) {
                                    Ok(()) => {
                                        info!("Sidecar watchdog: restarted successfully (attempt {})", restart_count + 1);
                                        let _ = watchdog_handle.emit("sidecar-reconnected", ());
                                    }
                                    Err(e) => {
                                        error!("Sidecar watchdog: restart failed: {}", e);
                                    }
                                }
                            }

                            restart_count += 1;
                            last_restart = std::time::Instant::now();
                        }
                    }
                });
                info!("Sidecar watchdog thread started");
            }

            // Listen for move events on main window
            if let Some(main_window) = app.get_webview_window("main") {
                let handle = app_handle.clone();
                main_window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                            magnetic_window::update_secondary_windows(&handle);
                        }
                        _ => {}
                    }
                });
            }

            // Initialize system tray
            if let Err(e) = tray::setup_tray(&app_handle) {
                tracing::warn!("Failed to setup system tray: {}", e);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
