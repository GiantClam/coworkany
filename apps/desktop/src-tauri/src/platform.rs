use std::path::{Path, PathBuf};
use std::process::Command;

pub fn runtime_executable(component: &str) -> &str {
    #[cfg(windows)]
    {
        return match component {
            "node" => "node.exe",
            "opencode" => "opencode.exe",
            "python" => "python.exe",
            _ => component,
        };
    }
    #[cfg(not(windows))]
    {
        match component {
            "python" => "python3",
            _ => component,
        }
    }
}

pub fn font_asset_name() -> &'static str {
    #[cfg(windows)]
    {
        "msyh.ttc"
    }
    #[cfg(not(windows))]
    {
        "NotoSansCJKsc-Regular.otf"
    }
}

pub fn portable_data_directory() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "CoworkAny Data"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "data"
    }
}

pub fn distribution_root(executable: &Path) -> PathBuf {
    let executable_dir = executable.parent().unwrap_or(executable);
    #[cfg(target_os = "macos")]
    {
        // CoworkAny.app/Contents/MacOS/coworkany -> directory beside the app.
        if executable_dir.file_name().is_some_and(|name| name == "MacOS")
            && executable_dir.parent().is_some_and(|path| path.file_name().is_some_and(|name| name == "Contents"))
        {
            if let Some(app_bundle) = executable_dir.parent().and_then(Path::parent) {
                return app_bundle.parent().unwrap_or(app_bundle).to_path_buf();
            }
        }
    }
    executable_dir.to_path_buf()
}

pub fn configure_child_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
}

pub fn open_path_command(path: &Path) -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.arg(path);
        return command;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        return command;
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        command.arg(path);
        command
    }
}

pub fn reveal_path_command(path: &Path) -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.args(["-R"]).arg(path);
        return command;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or(path));
        return command;
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        command.arg("/select,").arg(path);
        command
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_executables_match_the_current_platform() {
        #[cfg(windows)]
        assert_eq!(runtime_executable("python"), "python.exe");
        #[cfg(not(windows))]
        assert_eq!(runtime_executable("python"), "python3");
    }

    #[test]
    fn distribution_root_defaults_to_the_executable_directory() {
        let executable = Path::new("release").join("coworkany");
        assert_eq!(distribution_root(&executable), PathBuf::from("release"));
    }
}
