use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::process_manager::ProcessManager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBinaryInfo {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedServiceCapability {
    pub id: String,
    pub bundled: bool,
    pub runtime_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformRuntimeContext {
    pub platform: String,
    pub arch: String,
    pub app_dir: String,
    pub app_data_dir: String,
    pub shell: String,
    pub sidecar_launch_mode: Option<String>,
    pub python: RuntimeBinaryInfo,
    pub skillhub: RuntimeBinaryInfo,
    pub managed_services: Vec<ManagedServiceCapability>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installed: bool,
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running: Option<bool>,
    pub bundled: bool,
    pub optional: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub runtime_context: PlatformRuntimeContext,
    pub dependencies: Vec<RuntimeDependencyStatus>,
}

pub fn resolve_app_dir() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
        .to_string_lossy()
        .to_string()
}

pub fn resolve_app_data_dir(app_handle: &AppHandle) -> String {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default())
        .to_string_lossy()
        .to_string()
}

pub fn resolve_sidecar_entry_path() -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("COWORKANY_SIDECAR_ENTRY") {
        let explicit_path = PathBuf::from(explicit);
        if explicit_path.exists() {
            return Ok(explicit_path);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../sidecar/src/main.ts"));
        candidates.push(cwd.join("../../sidecar/src/main.ts"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("../../../../sidecar/src/main.ts"));
            candidates.push(exe_dir.join("../../../sidecar/src/main.ts"));
            candidates.push(exe_dir.join("../../sidecar/src/main.ts"));
            candidates.push(exe_dir.join("../sidecar/src/main.ts"));
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| {
            "Unable to locate sidecar/src/main.ts from current runtime paths".to_string()
        })
}

pub fn find_system_python() -> Option<PathBuf> {
    for cmd in ["python3", "python", "py"] {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                return Some(PathBuf::from(cmd));
            }
        }
    }
    None
}

pub fn managed_service_runtime_dir(
    app_handle: &AppHandle,
    service_name: &str,
) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_data_dir
        .join("managed-services")
        .join(service_name)
        .join(".venv"))
}

pub fn managed_service_runtime_ready(app_handle: &AppHandle, service_name: &str) -> bool {
    let Ok(venv_dir) = managed_service_runtime_dir(app_handle, service_name) else {
        return false;
    };

    #[cfg(target_os = "windows")]
    let python = venv_dir.join("Scripts").join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python = venv_dir.join("bin").join("python3");

    python.exists()
}

pub fn packaged_service_exists(app_handle: &AppHandle, service_name: &str) -> bool {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        if resource_dir.join(service_name).join("main.py").exists() {
            return true;
        }
    }
    if let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") {
        if PathBuf::from(dir)
            .join("..")
            .join("..")
            .join(service_name)
            .join("main.py")
            .exists()
        {
            return true;
        }
    }
    false
}

pub fn resolve_skillhub_executable() -> Result<PathBuf, String> {
    // Check HOME environment variable (Unix)
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = PathBuf::from(home).join(".local/bin/skillhub");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    // Check USERPROFILE environment variable (Windows)
    #[cfg(target_os = "windows")]
    {
        if let Some(userprofile) = std::env::var_os("USERPROFILE") {
            let base = PathBuf::from(&userprofile);

            // Check .local/bin (manual install location)
            let candidate = base.join(".local/bin/skillhub.exe");
            if candidate.exists() {
                return Ok(candidate);
            }

            // Check npm global install location
            let npm_global = base.join("AppData").join("Roaming").join("npm");
            let candidate = npm_global.join("skillhub.cmd");
            if candidate.exists() {
                return Ok(candidate);
            }

            // Check for skills-hub-ai (npm package name)
            let candidate = npm_global.join("skills-hub-ai.cmd");
            if candidate.exists() {
                return Ok(candidate);
            }

            // Check for npx-based skillhub
            let candidate = npm_global.join("skillhub");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join(skillhub_binary_name());
            if candidate.exists() {
                return Ok(candidate);
            }

            // Also check for npm-style names on Windows
            #[cfg(target_os = "windows")]
            {
                let candidate = dir.join("skillhub.cmd");
                if candidate.exists() {
                    return Ok(candidate);
                }
                let candidate = dir.join("skills-hub-ai.cmd");
                if candidate.exists() {
                    return Ok(candidate);
                }
                let candidate = dir.join("skills-hub-ai");
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }
    }

    Err("skillhub CLI not found. Install it first via the official installer.".to_string())
}

#[cfg(target_os = "windows")]
fn skillhub_binary_name() -> &'static str {
    "skillhub.exe"
}

#[cfg(not(target_os = "windows"))]
fn skillhub_binary_name() -> &'static str {
    "skillhub"
}

fn detect_shell() -> String {
    if cfg!(target_os = "windows") {
        return std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string());
    }

    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

fn binary_info(path: Option<PathBuf>, source: Option<&str>) -> RuntimeBinaryInfo {
    RuntimeBinaryInfo {
        available: path.is_some(),
        path: path.map(|value| value.to_string_lossy().to_string()),
        source: source.map(str::to_string),
    }
}

pub fn build_platform_runtime_context(
    app_handle: &AppHandle,
    sidecar_launch_mode: Option<&str>,
) -> PlatformRuntimeContext {
    let python = find_system_python();
    let skillhub = resolve_skillhub_executable().ok();

    PlatformRuntimeContext {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_dir: resolve_app_dir(),
        app_data_dir: resolve_app_data_dir(app_handle),
        shell: detect_shell(),
        sidecar_launch_mode: sidecar_launch_mode.map(str::to_string),
        python: binary_info(
            python,
            Some(if running_from_app_bundle() {
                "system_or_bundle"
            } else {
                "system"
            }),
        ),
        skillhub: binary_info(skillhub, Some("path_lookup")),
        managed_services: ["rag-service", "browser-use-service"]
            .into_iter()
            .map(|service_name| ManagedServiceCapability {
                id: service_name.to_string(),
                bundled: packaged_service_exists(app_handle, service_name),
                runtime_ready: managed_service_runtime_ready(app_handle, service_name),
            })
            .collect(),
    }
}

pub fn build_runtime_snapshot(
    app_handle: &AppHandle,
    manager: Option<&ProcessManager>,
    sidecar_launch_mode: Option<&str>,
) -> RuntimeSnapshot {
    let runtime_context = build_platform_runtime_context(app_handle, sidecar_launch_mode);

    let skillhub_path = resolve_skillhub_executable().ok();
    let skillhub_version = skillhub_path.as_ref().and_then(|path| {
        Command::new(path)
            .arg("--version")
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
                } else {
                    None
                }
            })
    });

    let rag_running = manager
        .and_then(|mgr| mgr.get_service_status("rag-service"))
        .map(|service| service.status == crate::process_manager::ServiceStatus::Running);

    let browser_running = manager
        .and_then(|mgr| mgr.get_service_status("browser-use-service"))
        .map(|service| service.status == crate::process_manager::ServiceStatus::Running);

    RuntimeSnapshot {
        runtime_context,
        dependencies: vec![
            RuntimeDependencyStatus {
                id: "skillhub-cli".to_string(),
                name: "Skillhub CLI".to_string(),
                description:
                    "Used by the in-app marketplace to search and install Tencent Skillhub skills."
                        .to_string(),
                installed: skillhub_path.is_some(),
                ready: skillhub_path.is_some(),
                running: None,
                bundled: false,
                optional: false,
                path: skillhub_path.map(|path| path.to_string_lossy().to_string()),
                version: skillhub_version,
                error: if resolve_skillhub_executable().is_err() {
                    Some(
                        "skillhub CLI not found. Install it first via the official installer."
                            .to_string(),
                    )
                } else {
                    None
                },
            },
            RuntimeDependencyStatus {
                id: "rag-service".to_string(),
                name: "RAG Service".to_string(),
                description: "Semantic memory indexing and retrieval for the local vault."
                    .to_string(),
                installed: packaged_service_exists(app_handle, "rag-service"),
                ready: managed_service_runtime_ready(app_handle, "rag-service"),
                running: rag_running,
                bundled: packaged_service_exists(app_handle, "rag-service"),
                optional: false,
                path: None,
                version: None,
                error: None,
            },
            RuntimeDependencyStatus {
                id: "browser-use-service".to_string(),
                name: "Browser Smart Mode".to_string(),
                description: "Optional AI browser automation backend used by browser_ai_action."
                    .to_string(),
                installed: packaged_service_exists(app_handle, "browser-use-service"),
                ready: managed_service_runtime_ready(app_handle, "browser-use-service"),
                running: browser_running,
                bundled: packaged_service_exists(app_handle, "browser-use-service"),
                optional: true,
                path: None,
                version: None,
                error: None,
            },
        ],
    }
}

fn running_from_app_bundle() -> bool {
    std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().contains(".app/Contents/MacOS/"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{RuntimeBinaryInfo, RuntimeDependencyStatus};

    #[test]
    fn runtime_binary_info_omits_null_optional_fields() {
        let value = serde_json::to_value(RuntimeBinaryInfo {
            available: false,
            path: None,
            source: None,
        })
        .expect("serialize runtime binary info");

        assert!(value.get("path").is_none());
        assert!(value.get("source").is_none());
    }

    #[test]
    fn runtime_dependency_status_omits_null_optional_fields() {
        let value = serde_json::to_value(RuntimeDependencyStatus {
            id: "skillhub-cli".to_string(),
            name: "Skillhub CLI".to_string(),
            description: "Optional CLI".to_string(),
            installed: false,
            ready: false,
            running: None,
            bundled: false,
            optional: true,
            path: None,
            version: None,
            error: None,
        })
        .expect("serialize runtime dependency status");

        assert!(value.get("running").is_none());
        assert!(value.get("path").is_none());
        assert!(value.get("version").is_none());
        assert!(value.get("error").is_none());
    }
}
