#[cfg(windows)]
#[allow(dead_code)]
mod platform {
    use std::io;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::IO_COUNTERS;

    pub struct JobObject(HANDLE);

    // A Windows kernel job handle is safe to move behind the HostState mutex;
    // all operations remain serialized by that mutex and the handle is closed
    // exactly once by Drop.
    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn new() -> io::Result<Self> {
            let handle = unsafe { CreateJobObjectW(null(), null()) };
            if handle == null_mut() {
                return Err(io::Error::last_os_error());
            }
            // The Tauri process owns the only job handle. If it crashes or is
            // terminated, Windows closes this handle and kills the complete
            // workflow-host/OpenCode descendant tree automatically.
            let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    PerProcessUserTimeLimit: 0,
                    PerJobUserTimeLimit: 0,
                    LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    MinimumWorkingSetSize: 0,
                    MaximumWorkingSetSize: 0,
                    ActiveProcessLimit: 0,
                    Affinity: 0,
                    PriorityClass: 0,
                    SchedulingClass: 0,
                },
                IoInfo: IO_COUNTERS {
                    ReadOperationCount: 0,
                    WriteOperationCount: 0,
                    OtherOperationCount: 0,
                    ReadTransferCount: 0,
                    WriteTransferCount: 0,
                    OtherTransferCount: 0,
                },
                ProcessMemoryLimit: 0,
                JobMemoryLimit: 0,
                PeakProcessMemoryUsed: 0,
                PeakJobMemoryUsed: 0,
            };
            let configured = unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if configured == 0 {
                unsafe {
                    CloseHandle(handle);
                }
                return Err(io::Error::last_os_error());
            }
            Ok(Self(handle))
        }

        pub fn assign(&mut self, child: &Child) -> io::Result<()> {
            let process = child.as_raw_handle() as HANDLE;
            if unsafe { AssignProcessToJobObject(self.0, process) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub fn terminate(&self) -> io::Result<()> {
            if unsafe { TerminateJobObject(self.0, 1) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::io;
    use std::process::Child;
    pub struct JobObject {
        process_group: Option<u32>,
    }
    impl JobObject {
        pub fn new() -> io::Result<Self> {
            Ok(Self { process_group: None })
        }
        pub fn assign(&mut self, child: &Child) -> io::Result<()> {
            self.process_group = child.id().into();
            Ok(())
        }
        pub fn terminate(&self) -> io::Result<()> {
            if let Some(process_group) = self.process_group {
                // Every host command is spawned in its own Unix process group by
                // platform::configure_child_command. Killing the group prevents
                // OpenCode descendants from surviving an app exit.
                let status = std::process::Command::new("kill")
                    .args(["-TERM", &format!("-{process_group}")])
                    .status()?;
                if !status.success() { return Err(io::Error::other("process_group_terminate_failed")); }
            }
            Ok(())
        }
    }
}

#[allow(unused_imports)]
pub use platform::JobObject;

#[cfg(all(test, windows))]
mod tests {
    use super::JobObject;
    use std::process::{Command, Stdio};

    #[test]
    fn job_object_terminates_a_windows_child_tree() {
        let mut child = Command::new("cmd.exe")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("cmd.exe should be available on Windows");
        let mut job = JobObject::new().expect("Windows job object should be created");
        if let Err(error) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("child should be assigned to the job object: {error}");
        }
        job.terminate()
            .expect("job object should terminate the child tree");
        let status = child.wait().expect("terminated child should be waitable");
        assert!(
            !status.success(),
            "terminated child unexpectedly exited successfully"
        );
    }
}
