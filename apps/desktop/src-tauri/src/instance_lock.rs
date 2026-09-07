use std::fs::{remove_file, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use std::os::windows::ffi::OsStringExt;

pub struct InstanceLock {
    path: PathBuf,
    file: File,
}

impl InstanceLock {
    pub fn acquire(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("desktop_lock_directory_failed: {error}"))?;
        }
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                write_owner(&mut file).map_err(|error| format!("desktop_lock_write_failed: {error}"))?;
                Ok(Self { path, file })
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let owner = read_owner(&path);
                if owner.is_some_and(|pid| !process_is_current_instance(pid)) {
                    remove_file(&path).map_err(|remove_error| lock_conflict(&path, owner, &remove_error))?;
                    let mut file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|retry_error| lock_conflict(&path, owner, &retry_error))?;
                    write_owner(&mut file).map_err(|write_error| format!("desktop_lock_write_failed: {write_error}"))?;
                    Ok(Self { path, file })
                } else {
                    Err(lock_conflict(&path, owner, "close the existing CoworkAny instance first"))
                }
            }
            Err(error) => Err(format!("desktop_lock_open_failed: {error}")),
        }
    }

    pub fn release(&self) {
        let _ = self.file.sync_all();
        let _ = remove_file(&self.path);
    }
}

fn lock_conflict(path: &Path, owner: Option<u32>, detail: impl std::fmt::Display) -> String {
    let owner = owner.map_or_else(|| "unknown".to_string(), |pid| pid.to_string());
    format!(
        "desktop_instance_already_running: {} (owner_pid={owner}; {detail})",
        path.display()
    )
}

fn read_owner(path: &Path) -> Option<u32> {
    let mut content = String::new();
    File::open(path).ok()?.read_to_string(&mut content).ok()?;
    content.lines().next()?.trim().parse().ok()
}

fn write_owner(file: &mut File) -> std::io::Result<()> {
    writeln!(file, "{}", std::process::id())?;
    if let Ok(executable) = std::env::current_exe() {
        writeln!(file, "{}", executable.display())?;
    }
    Ok(())
}

fn process_is_current_instance(pid: u32) -> bool {
    process_alive(pid) && process_matches_current_executable(pid)
}

fn process_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let filter = format!("PID eq {pid}");
        let mut command = Command::new("tasklist");
        command.creation_flags(0x08000000);
        return command.args(["/FI", &filter, "/NH"]).output().map(|output| output.status.success() && String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())).unwrap_or(true);
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            // Preserve the lock when process inspection is unavailable rather
            // than deleting a potentially live lock on an unusual Unix host.
            .unwrap_or(true)
    }
}

#[cfg(windows)]
fn process_matches_current_executable(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let Some(current) = std::env::current_exe().ok().and_then(|path| std::fs::canonicalize(path).ok()) else { return false; };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() { return false; }
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let success = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) != 0 };
    unsafe { CloseHandle(handle); }
    if !success { return false; }
    buffer.truncate(length as usize);
    let owner = std::ffi::OsString::from_wide(&buffer);
    std::fs::canonicalize(owner).map(|path| paths_equal(&path, &current)).unwrap_or(false)
}

#[cfg(not(windows))]
fn process_matches_current_executable(pid: u32) -> bool {
    let Some(current) = std::env::current_exe().ok().and_then(|path| std::fs::canonicalize(path).ok()) else { return false; };
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output();
    let Ok(output) = output else { return true; };
    if !output.status.success() { return false; }
    let command_line = String::from_utf8_lossy(&output.stdout);
    let current = current.to_string_lossy();
    command_line.lines().any(|line| {
        let line = line.trim_start();
        line == current || line.strip_prefix(current.as_ref()).is_some_and(|rest| rest.starts_with(char::is_whitespace))
    })
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy().eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_writer_can_hold_a_path() {
        let root = std::env::temp_dir().join(format!("coworkany-instance-lock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("instance.lock");
        let first = InstanceLock::acquire(path.clone()).expect("first lock");
        let error = match InstanceLock::acquire(path.clone()) {
            Ok(_) => panic!("second lock must fail"),
            Err(error) => error,
        };
        assert!(error.contains("desktop_instance_already_running:"));
        assert!(error.contains(&format!("owner_pid={}", std::process::id())));
        assert!(error.contains("close the existing CoworkAny instance first"));
        first.release();
        let second = InstanceLock::acquire(path.clone()).expect("released lock can be reused");
        second.release();
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn lock_conflict_explains_unknown_owner() {
        let message = lock_conflict(Path::new("C:/CoworkAny/data/instance.lock"), None, "repair the lock file");
        assert!(message.contains("owner_pid=unknown"));
        assert!(message.contains("repair the lock file"));
    }

    #[cfg(windows)]
    #[test]
    fn current_process_identity_matches_its_executable() {
        assert!(process_matches_current_executable(std::process::id()));
    }
}
