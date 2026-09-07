use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::ffi::OsStr;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const WEBVIEW2_BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn webview_repair_progress_messages_for(chinese: bool) -> [&'static str; 3] {
    if chinese {
        [
            "正在检查 WebView2 运行时…",
            "正在下载 WebView2 修复程序…",
            "正在安装 WebView2 并重新探测…",
        ]
    } else {
        [
            "Checking the WebView2 runtime…",
            "Downloading the WebView2 repair package…",
            "Installing WebView2 and probing again…",
        ]
    }
}

pub(crate) enum StartupStage {
    Starting,
    WebView,
    Runtime,
    Workbench,
}

impl StartupStage {
    fn message(self, chinese: bool) -> &'static str {
        match (self, chinese) {
            (Self::Starting, true) => "正在启动 CoworkAny…",
            (Self::Starting, false) => "Starting CoworkAny…",
            (Self::WebView, true) => "正在检查 WebView2 运行时…",
            (Self::WebView, false) => "Checking the WebView2 runtime…",
            (Self::Runtime, true) => "正在准备本地运行环境…",
            (Self::Runtime, false) => "Preparing the local runtime…",
            (Self::Workbench, true) => "正在打开工作台…",
            (Self::Workbench, false) => "Opening the workbench…",
        }
    }
}

pub(crate) struct StartupProgress {
    #[cfg(windows)]
    hwnd: windows_sys::Win32::Foundation::HWND,
    chinese: bool,
}

impl StartupProgress {
    pub(crate) fn new(stage: StartupStage) -> Self {
        let chinese = startup_is_chinese();
        #[cfg(windows)]
        {
            use std::ptr::{null, null_mut};
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                CreateWindowExW, ShowWindow, WS_CAPTION, WS_EX_TOOLWINDOW,
                WS_OVERLAPPED, WS_SYSMENU, SW_SHOW,
            };

            let class = wide("STATIC");
            let title = wide(if chinese { "CoworkAny 启动中" } else { "CoworkAny starting" });
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW,
                    class.as_ptr(),
                    title.as_ptr(),
                    WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
                    0,
                    0,
                    520,
                    140,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null(),
                )
            };
            let progress = Self { hwnd, chinese };
            if !progress.hwnd.is_null() {
                unsafe { ShowWindow(progress.hwnd, SW_SHOW); }
            }
            progress.show_stage(stage);
            progress
        }
        #[cfg(not(windows))]
        {
            let progress = Self { chinese };
            progress.show_stage(stage);
            progress
        }
    }

    pub(crate) fn show_stage(&self, stage: StartupStage) {
        self.update(stage.message(self.chinese));
    }

    pub(crate) fn update(&self, message: &str) {
        #[cfg(windows)]
        {
            if self.hwnd.is_null() { return; }
            let text = wide(message);
            use windows_sys::Win32::Graphics::Gdi::UpdateWindow;
            use windows_sys::Win32::UI::WindowsAndMessaging::SetWindowTextW;
            unsafe {
                SetWindowTextW(self.hwnd, text.as_ptr());
                UpdateWindow(self.hwnd);
            }
        }
        #[cfg(not(windows))]
        eprintln!("NATIVE_STATUS: {message}");
    }
}

impl Drop for StartupProgress {
    fn drop(&mut self) {
        #[cfg(windows)]
        if !self.hwnd.is_null() {
            use windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow;
            unsafe { DestroyWindow(self.hwnd); }
        }
    }
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

pub fn ensure_webview2(progress: &StartupProgress) -> Result<(), String> {
    if webview2_installed() { return Ok(()); }
    let chinese = startup_is_chinese();
    let progress_messages = webview_repair_progress_messages_for(chinese);
    progress.update(progress_messages[0]);
    let bootstrapper = bundled_bootstrapper().unwrap_or_else(|| std::env::temp_dir().join("CoworkAny-WebView2Bootstrapper.exe"));
    if !bootstrapper.is_file() {
        progress.update(progress_messages[1]);
        download_bootstrapper(&bootstrapper)?;
    }
    progress.update(progress_messages[2]);
    install_bootstrapper(&bootstrapper)?;
    if webview2_installed() { return Ok(()); }
    Err("webview2_install_incomplete".to_string())
}

fn startup_is_chinese() -> bool {
    #[cfg(windows)]
    {
        let mut buffer = [0_u16; 85];
        let length = unsafe {
            windows_sys::Win32::Globalization::GetUserDefaultLocaleName(
                buffer.as_mut_ptr(),
                buffer.len() as i32,
            )
        };
        if length > 1 {
            return String::from_utf16_lossy(&buffer[..(length - 1) as usize])
                .to_ascii_lowercase()
                .starts_with("zh");
        }
        false
    }
    #[cfg(not(windows))]
    {
        std::env::var("LANG")
            .map(|value| value.to_ascii_lowercase().starts_with("zh"))
            .unwrap_or(false)
    }
}

pub(crate) fn powershell_compatible_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

pub(crate) fn font_asset_works(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else { return false; };
    if !metadata.is_file() || metadata.len() < 12 { return false; }
    let Ok(mut file) = std::fs::File::open(path) else { return false; };
    let mut header = [0_u8; 12];
    if file.read_exact(&mut header).is_err() { return false; }
    match &header[..4] {
        b"ttcf" => u32::from_be_bytes(header[8..12].try_into().unwrap_or_default()) > 0,
        b"OTTO" | [0, 1, 0, 0] => u16::from_be_bytes(header[4..6].try_into().unwrap_or_default()) > 0,
        _ => false,
    }
}

pub fn show_startup_error(error: &str) {
    #[cfg(windows)]
    {
        use std::iter::once;
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let (title_text, message_text) = startup_error_messages_for(startup_is_chinese(), error);
        let title: Vec<u16> = title_text.encode_utf16().chain(once(0)).collect();
        let message: Vec<u16> = message_text.encode_utf16().chain(once(0)).collect();
        unsafe { MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR); }
    }
}

fn startup_error_messages_for(chinese: bool, error: &str) -> (String, String) {
    if chinese {
        ("CoworkAny 启动失败".to_string(), format!("无法准备 Windows 本地运行环境。\\n\\n{error}\\n请检查网络或运行时安装包后重新启动。"))
    } else {
        ("CoworkAny startup failed".to_string(), format!("Unable to prepare the Windows local runtime.\\n\\n{error}\\nCheck the network or runtime installer and restart the app."))
    }
}

fn bundled_bootstrapper() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let executable_dir = executable.parent()?;
    [
        executable_dir.join("WebView2Bootstrapper.exe"),
        executable_dir.join("_up_").join("WebView2Bootstrapper.exe"),
        executable_dir.join("dist-runtime").join("WebView2Bootstrapper.exe"),
    ].into_iter().find(|path| path.is_file())
}

fn download_bootstrapper(destination: &Path) -> Result<(), String> {
    let destination = destination.to_string_lossy().replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'",
        WEBVIEW2_BOOTSTRAPPER_URL, destination,
    );
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .status()
        .map_err(|error| format!("webview2_download_spawn_failed: {error}"))?;
    if !status.success() { return Err(format!("webview2_download_failed:{}", status.code().unwrap_or(-1))); }
    Ok(())
}

fn install_bootstrapper(bootstrapper: &Path) -> Result<(), String> {
    let status = Command::new(bootstrapper)
        .args(["/silent", "/install"])
        .status()
        .map_err(|error| format!("webview2_install_spawn_failed: {error}"))?;
    if !status.success() { return Err(format!("webview2_install_failed:{}", status.code().unwrap_or(-1))); }
    Ok(())
}

fn webview2_installed() -> bool {
    #[cfg(windows)]
    {
        let registry_keys = [
            r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ];
        if registry_keys.iter().any(|key| {
            Command::new("reg.exe")
                .args(["query", key, "/v", "pv"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map(|output| output.status.success() && String::from_utf8_lossy(&output.stdout).contains("pv"))
                .unwrap_or(false)
        }) { return true; }
        let roots = [
            std::env::var_os("PROGRAMFILES(X86)").map(PathBuf::from),
            std::env::var_os("PROGRAMFILES").map(PathBuf::from),
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
        ];
        return roots.into_iter().flatten().any(|root| root.join("Microsoft/EdgeWebView/Application").is_dir());
    }
    #[cfg(not(windows))]
    { true }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrapper_url_is_official_webview2_endpoint() {
        assert!(WEBVIEW2_BOOTSTRAPPER_URL.starts_with("https://go.microsoft.com/"));
    }

    #[test]
    fn powershell_path_escaping_doubles_single_quotes() {
        assert_eq!("C:\\Users\\O''Brien\\setup.exe", "C:\\Users\\O'Brien\\setup.exe".replace('\'', "''"));
    }

    #[test]
    fn powershell_path_strips_windows_extended_prefixes() {
        assert_eq!(powershell_compatible_path(PathBuf::from(r"\\?\C:\runtime.zip")), PathBuf::from(r"C:\runtime.zip"));
        assert_eq!(powershell_compatible_path(PathBuf::from(r"\\?\UNC\server\share\runtime.zip")), PathBuf::from(r"\\server\share\runtime.zip"));
    }

    #[test]
    fn font_probe_rejects_corrupt_files_and_accepts_valid_font_headers() {
        let root = std::env::temp_dir().join(format!("coworkany-font-probe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let font = root.join("msyh.ttc");
        std::fs::write(&font, b"corrupt-font").unwrap();
        assert!(!font_asset_works(&font));
        let mut valid = [0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1];
        std::fs::write(&font, valid).unwrap();
        assert!(font_asset_works(&font));
        valid[0] = b'x';
        std::fs::write(&font, valid).unwrap();
        assert!(!font_asset_works(&font));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn webview_repair_progress_has_visible_ordered_stages() {
        assert_eq!(
            webview_repair_progress_messages_for(true),
            [
                "正在检查 WebView2 运行时…",
                "正在下载 WebView2 修复程序…",
                "正在安装 WebView2 并重新探测…",
            ]
        );
        assert_eq!(
            webview_repair_progress_messages_for(false),
            [
                "Checking the WebView2 runtime…",
                "Downloading the WebView2 repair package…",
                "Installing WebView2 and probing again…",
            ]
        );
    }

    #[test]
    fn startup_errors_follow_the_selected_locale() {
        assert_eq!(startup_error_messages_for(true, "runtime_install_incomplete"), (
            "CoworkAny 启动失败".to_string(),
            "无法准备 Windows 本地运行环境。\\n\\nruntime_install_incomplete\\n请检查网络或运行时安装包后重新启动。".to_string(),
        ));
        assert_eq!(startup_error_messages_for(false, "runtime_install_incomplete"), (
            "CoworkAny startup failed".to_string(),
            "Unable to prepare the Windows local runtime.\\n\\nruntime_install_incomplete\\nCheck the network or runtime installer and restart the app.".to_string(),
        ));
    }
}
