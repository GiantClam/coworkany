use tauri::{AppHandle, Manager, PhysicalSize, PhysicalPosition};

#[tauri::command]
pub async fn set_window_state(app: AppHandle, state: String) -> Result<(), String> {
    let main_window = app.get_webview_window("main").ok_or("Main window not found")?;
    let dashboard_window = app.get_webview_window("dashboard");
    let settings_window = app.get_webview_window("settings");
    
    let monitor = main_window.current_monitor().map_err(|e| e.to_string())?
        .ok_or("No monitor found")?;
    let screen_size = monitor.size();

    // Helper to visibility
    let set_vis = |win: Option<tauri::WebviewWindow>, show: bool| {
        if let Some(w) = win {
            if show {
                let _ = w.show();
            } else {
                let _ = w.hide();
            }
        }
    };

    match state.as_str() {
        "launcher" => {
            // Launcher: Small bar
            let width = 600;
            let height = 60;
            let x = (screen_size.width as i32 - width as i32) / 2;
            let y = (screen_size.height as i32 - height as i32) / 3;

            main_window.set_size(PhysicalSize::new(width, height)).map_err(|e| e.to_string())?;
            main_window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            main_window.set_resizable(false).map_err(|e| e.to_string())?;
            
            // Hide secondary windows
            set_vis(dashboard_window, false);
            set_vis(settings_window, false);
        },
        "panel" => {
            // Panel: Chat interaction mode
            let width = 600;
            let height = 600;
            let x = (screen_size.width as i32 - width as i32) / 2;
            let y = (screen_size.height as i32 - 60) / 3;

            main_window.set_size(PhysicalSize::new(width, height)).map_err(|e| e.to_string())?;
            main_window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
            main_window.set_resizable(true).map_err(|e| e.to_string())?;
        },
        "dashboard" => {
            // Show Dashboard Window, keep Main Window as Panel (or expand if was launcher)
            // Ensure Main is at least 'panel' size? Or just keep current?
            // Let's force Main to Panel size if it's in launcher mode, or just ensure Dashboard is visible.
            
            // We assume User wants to see Dashboard.
            if let Some(dash) = dashboard_window {
               dash.show().map_err(|e| e.to_string())?;
               dash.set_focus().map_err(|e| e.to_string())?;
            }
            // Hide settings?
            set_vis(settings_window, false);
            
            // Sync positions immediately
            crate::magnetic_window::update_secondary_windows(&app);
        },
        "settings" => {
            // Show Settings Window
            if let Some(set) = settings_window {
               set.show().map_err(|e| e.to_string())?;
               set.set_focus().map_err(|e| e.to_string())?;
            }
            // Hide dashboard?
            set_vis(dashboard_window, false);

            crate::magnetic_window::update_secondary_windows(&app);
        },
        _ => return Err(format!("Unknown state: {}", state)),
    }

    Ok(())
}

#[tauri::command]
pub async fn open_quickchat(app: AppHandle) -> Result<(), String> {
    let quickchat = app.get_webview_window("quickchat")
        .ok_or("Quick Chat window not found")?;
    
    quickchat.show().map_err(|e| e.to_string())?;
    quickchat.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn close_quickchat(app: AppHandle) -> Result<(), String> {
    let quickchat = app.get_webview_window("quickchat")
        .ok_or("Quick Chat window not found")?;
    
    quickchat.hide().map_err(|e| e.to_string())?;
    Ok(())
}
