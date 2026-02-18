use tauri::{AppHandle, Manager, PhysicalPosition, Position};
use std::sync::Mutex;

pub struct MagneticWindowState {
    pub _is_moving: Mutex<bool>,
}

impl MagneticWindowState {
    pub fn new() -> Self {
        Self {
            _is_moving: Mutex::new(false),
        }
    }
}

pub fn update_secondary_windows(app: &AppHandle) {
    let main_window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    if let Ok(main_pos) = main_window.outer_position() {
        if let Ok(main_size) = main_window.outer_size() {
            let gap = 10; // 10px gap

            // Update Dashboard (Right of Main)
            if let Some(dashboard) = app.get_webview_window("dashboard") {
                if dashboard.is_visible().unwrap_or(false) {
                    let new_x = main_pos.x + main_size.width as i32 + gap;
                    let new_y = main_pos.y;
                    let _ = dashboard.set_position(Position::Physical(PhysicalPosition { x: new_x, y: new_y }));
                }
            }

            // Update Settings (Below Main)
            if let Some(settings) = app.get_webview_window("settings") {
                if settings.is_visible().unwrap_or(false) {
                   // Ensure settings width matches main window width? 
                   // Or keep fixed size. Design says "Below".
                   // Let's align left edges.
                   let new_x = main_pos.x;
                   let new_y = main_pos.y + main_size.height as i32 + gap;
                   let _ = settings.set_position(Position::Physical(PhysicalPosition { x: new_x, y: new_y }));
                   
                   // Optional: Resize settings width to match main? 
                   // settings.set_size(Size::Physical(PhysicalSize { width: main_size.width, height: 400 }));
                }
            }
        }
    }
}

// Command to manually sync positions (can be called after show/hide)
#[tauri::command]
pub fn sync_window_positions(app: AppHandle) {
    update_secondary_windows(&app);
}
