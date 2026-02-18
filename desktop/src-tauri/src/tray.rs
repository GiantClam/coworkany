use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tracing::info;

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    fn t(_app: &AppHandle, en: &str, zh: &str) -> String {
        let locale = std::env::var("LC_ALL")
            .or_else(|_| std::env::var("LANG"))
            .unwrap_or_else(|_| String::from("en"))
            .to_lowercase();

        if locale.starts_with("zh") {
            zh.to_string()
        } else {
            en.to_string()
        }
    }

    // Load tray icon
    let icon = Image::from_path("icons/icon.png")
        .or_else(|_| Image::from_path("icons/logo.ico"))
        .unwrap_or_else(|_| {
            // Fallback to embedded minimal icon
            Image::from_bytes(include_bytes!("../icons/icon.png"))
                .expect("Failed to load embedded tray icon")
        });
    // Create menu items
    let open_main = MenuItemBuilder::new(t(app, "Open Main Window", "打开主窗口"))
        .id("open_main")
        .build(app)?;

    let quick_chat = MenuItemBuilder::new(t(app, "Quick Chat", "快速对话"))
        .id("quick_chat")
        .build(app)?;

    let new_task = MenuItemBuilder::new(t(app, "New Task", "新建任务"))
        .id("new_task")
        .build(app)?;

    let task_list = MenuItemBuilder::new(t(app, "Task List", "任务列表"))
        .id("task_list")
        .build(app)?;

    let separator1 = PredefinedMenuItem::separator(app)?;

    let settings = MenuItemBuilder::new(t(app, "Settings", "设置"))
        .id("settings")
        .build(app)?;

    let shortcuts = MenuItemBuilder::new(t(app, "Shortcut Help", "快捷键帮助"))
        .id("shortcuts")
        .build(app)?;

    let separator2 = PredefinedMenuItem::separator(app)?;

    let quit = MenuItemBuilder::new(t(app, "Quit", "退出"))
        .id("quit")
        .build(app)?;

    // Build the menu
    let menu = MenuBuilder::new(app)
        .item(&open_main)
        .item(&separator1)
        .item(&quick_chat)
        .item(&new_task)
        .item(&task_list)
        .item(&separator2)
        .item(&settings)
        .item(&shortcuts)
        .item(&separator2)
        .item(&quit)
        .build()?;

    // Build the tray icon
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip(t(app, "CoworkAny - AI Assistant", "CoworkAny - AI 助手"))
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open_main" => {
                let _ = app.emit("command-executed", serde_json::json!({ "id": "new-task" }));
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quick_chat" => {
                let _ = app.emit(
                    "command-executed",
                    serde_json::json!({ "id": "quick-chat" }),
                );
                if let Some(window) = app.get_webview_window("quickchat") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "new_task" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("command-executed", serde_json::json!({ "id": "new-task" }));
            }
            "task_list" => {
                let _ = app.emit("command-executed", serde_json::json!({ "id": "task-list" }));
                if let Some(window) = app.get_webview_window("dashboard") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                let _ = app.emit("command-executed", serde_json::json!({ "id": "settings" }));
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "shortcuts" => {
                let _ = app.emit("command-executed", serde_json::json!({ "id": "shortcuts" }));
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    info!("System tray initialized");
    Ok(())
}
