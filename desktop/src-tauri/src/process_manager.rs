//! CoworkAny Desktop - Unified Process Manager
//!
//! Manages multiple backend services with automatic startup, health checks, and restart.
//! Services:
//! - Bun Sidecar: Core agent orchestration (existing)
//! - Python RAG Service: Memory vault semantic search (new)

use crate::platform_runtime::find_system_python;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use thiserror::Error;
use tracing::{debug, error, info, warn};

const MANAGED_PYTHON_RELEASE_TAG: &str = "20251217";
const MANAGED_PYTHON_VERSION: &str = "3.10.19";

// ============================================================================
// Error Types
// ============================================================================

#[derive(Error, Debug)]
pub enum ProcessError {
    #[error("Failed to spawn process: {0}")]
    SpawnError(#[from] std::io::Error),

    #[error("Service not running: {0}")]
    NotRunning(String),

    #[error("Health check failed: {0}")]
    #[allow(dead_code)]
    HealthCheckFailed(String),

    #[error("Service timeout: {0}")]
    Timeout(String),
}

// ============================================================================
// Service Configuration
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub name: String,
    pub enabled: bool,
    pub auto_start: bool,
    pub auto_restart: bool,
    pub health_check_url: Option<String>,
    pub health_check_interval_secs: u64,
    pub startup_timeout_secs: u64,
    pub max_restart_attempts: u32,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            enabled: true,
            auto_start: true,
            auto_restart: true,
            health_check_url: None,
            health_check_interval_secs: 30,
            startup_timeout_secs: 60,
            max_restart_attempts: 3,
        }
    }
}

// ============================================================================
// Service Status
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    Stopped,
    Starting,
    Running,
    Unhealthy,
    Restarting,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfo {
    pub name: String,
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub restart_count: u32,
    pub last_error: Option<String>,
    pub health_check_url: Option<String>,
}

// ============================================================================
// Service Trait
// ============================================================================

pub trait ManagedService: Send + Sync {
    fn name(&self) -> &str;
    fn config(&self) -> &ServiceConfig;
    fn spawn(&mut self, app_handle: &AppHandle) -> Result<(), ProcessError>;
    fn shutdown(&mut self);
    fn is_running(&self) -> bool;
    fn pid(&self) -> Option<u32>;
    fn health_check(&self) -> Result<bool, ProcessError>;
}

fn managed_python_asset_name() -> Result<String, ProcessError> {
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => {
            return Err(ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                format!("Unsupported macOS architecture for managed Python: {other}"),
            )))
        }
    };

    Ok(format!(
        "cpython-{version}+{tag}-{arch}-apple-darwin-install_only.tar.gz",
        version = MANAGED_PYTHON_VERSION,
        tag = MANAGED_PYTHON_RELEASE_TAG,
        arch = arch,
    ))
}

fn managed_python_download_url() -> Result<String, ProcessError> {
    let asset = managed_python_asset_name()?;
    Ok(format!(
        "https://github.com/astral-sh/python-build-standalone/releases/download/{tag}/{asset}",
        tag = MANAGED_PYTHON_RELEASE_TAG,
        asset = asset,
    ))
}

fn managed_python_root(app_handle: &AppHandle) -> Result<PathBuf, ProcessError> {
    let base = app_handle.path().app_data_dir().map_err(|e| {
        ProcessError::SpawnError(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    Ok(base.join("managed-python"))
}

fn find_python_binary_under(root: &Path) -> Option<PathBuf> {
    let direct = [
        root.join("python")
            .join("install")
            .join("bin")
            .join("python3"),
        root.join("install").join("bin").join("python3"),
        root.join("bin").join("python3"),
    ];

    if let Some(found) = direct.into_iter().find(|candidate| candidate.exists()) {
        return Some(found);
    }

    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_python_binary_under(&path) {
                return Some(found);
            }
        }
    }
    None
}

fn install_managed_python(app_handle: &AppHandle) -> Result<PathBuf, ProcessError> {
    let root = managed_python_root(app_handle)?;
    if let Some(existing) = find_python_binary_under(&root) {
        return Ok(existing);
    }

    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })?
        .join("python-downloads");
    fs::create_dir_all(&cache_dir)?;

    let asset_name = managed_python_asset_name()?;
    let archive_path = cache_dir.join(&asset_name);
    let download_url = managed_python_download_url()?;

    let mut curl = Command::new("curl");
    curl.arg("-L")
        .arg("--fail")
        .arg("--output")
        .arg(&archive_path)
        .arg(&download_url);
    RagService::apply_proxy_env(&mut curl, app_handle);
    run_checked_command(curl, "Download managed Python runtime")?;

    if root.exists() {
        fs::remove_dir_all(&root)?;
    }
    fs::create_dir_all(&root)?;

    let mut untar = Command::new("tar");
    untar.arg("-xzf").arg(&archive_path).arg("-C").arg(&root);
    run_checked_command(untar, "Extract managed Python runtime")?;

    find_python_binary_under(&root).ok_or_else(|| {
        ProcessError::SpawnError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Managed Python downloaded but python3 binary was not found after extraction.",
        ))
    })
}

fn running_from_app_bundle() -> bool {
    std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().contains(".app/Contents/MacOS/"))
        .unwrap_or(false)
}

fn bootstrap_python_path(app_handle: &AppHandle) -> Result<PathBuf, ProcessError> {
    if running_from_app_bundle() {
        match install_managed_python(app_handle) {
            Ok(path) => return Ok(path),
            Err(err) => warn!("[ProcessManager] Failed to prepare managed Python, falling back to system Python: {}", err),
        }
    }

    if let Some(system) = find_system_python() {
        return Ok(system);
    }

    install_managed_python(app_handle)
}

fn venv_python_path(venv_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return venv_dir.join("Scripts").join("python.exe");
    }

    #[cfg(not(target_os = "windows"))]
    {
        venv_dir.join("bin").join("python3")
    }
}

fn run_checked_command(mut cmd: Command, label: &str) -> Result<(), ProcessError> {
    let output = cmd.output()?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    Err(ProcessError::SpawnError(std::io::Error::new(
        std::io::ErrorKind::Other,
        format!("{label} failed: {detail}"),
    )))
}

fn python_runtime_identity(python: &Path) -> Result<String, ProcessError> {
    let output = Command::new(python)
        .arg("-c")
        .arg("import platform, sys; print(platform.python_implementation() + ':' + '.'.join(map(str, sys.version_info[:3])))")
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(ProcessError::SpawnError(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Unable to inspect Python runtime: {}", stderr),
        )));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let resolved_path = python
        .canonicalize()
        .unwrap_or_else(|_| python.to_path_buf())
        .display()
        .to_string();

    Ok(format!("python={resolved_path}\nversion={version}"))
}

fn resource_service_dir(
    app_handle: &AppHandle,
    env_key: &str,
    resource_subdir: &str,
    dev_dir_name: &str,
) -> Result<PathBuf, ProcessError> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(path) = std::env::var(env_key) {
        candidates.push(PathBuf::from(path));
    }

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join(resource_subdir));
    }

    if let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(dir).join("..").join("..").join(dev_dir_name));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(
                dir.join("..")
                    .join("..")
                    .join("..")
                    .join("..")
                    .join(dev_dir_name),
            );
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(dev_dir_name));
        candidates.push(cwd.join("..").join(dev_dir_name));
    }

    for candidate in candidates {
        let main_py = candidate.join("main.py");
        if main_py.exists() {
            return Ok(candidate.canonicalize().unwrap_or(candidate));
        }
    }

    Err(ProcessError::SpawnError(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!(
            "Unable to locate {dev_dir_name}/main.py. Bundle the service resources or set {env_key}."
        ),
    )))
}

fn service_venv_dir(app_handle: &AppHandle, service_name: &str) -> Result<PathBuf, ProcessError> {
    let base = app_handle.path().app_data_dir().map_err(|e| {
        ProcessError::SpawnError(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    Ok(base
        .join("managed-services")
        .join(service_name)
        .join(".venv"))
}

fn pip_cache_dir(app_handle: &AppHandle, service_name: &str) -> Result<PathBuf, ProcessError> {
    let base = app_handle.path().app_cache_dir().map_err(|e| {
        ProcessError::SpawnError(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    Ok(base.join("pip").join(service_name))
}

fn ensure_service_runtime(
    app_handle: &AppHandle,
    service_name: &str,
    env_key: &str,
    resource_subdir: &str,
    dev_dir_name: &str,
    display_name: &str,
) -> Result<(PathBuf, PathBuf), ProcessError> {
    let service_dir = resource_service_dir(app_handle, env_key, resource_subdir, dev_dir_name)?;
    let requirements_path = service_dir.join("requirements.txt");
    let requirements = fs::read_to_string(&requirements_path).map_err(|e| {
        ProcessError::SpawnError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Missing requirements for {display_name}: {e}"),
        ))
    })?;

    let bootstrap_python = bootstrap_python_path(app_handle)?;
    let runtime_identity = python_runtime_identity(&bootstrap_python)?;

    let venv_dir = service_venv_dir(app_handle, service_name)?;
    let venv_python = venv_python_path(&venv_dir);
    let stamp_path = venv_dir.join(".requirements-stamp");
    let runtime_stamp = format!("{requirements}\n---\n{runtime_identity}");
    let stamp_matches = stamp_path.exists()
        && fs::read_to_string(&stamp_path).ok().as_deref() == Some(runtime_stamp.as_str())
        && venv_python.exists();

    if stamp_matches {
        return Ok((service_dir, venv_python));
    }

    if let Some(parent) = venv_dir.parent() {
        fs::create_dir_all(parent)?;
    }

    if venv_dir.exists() {
        fs::remove_dir_all(&venv_dir)?;
    }

    let mut create_venv = Command::new(&bootstrap_python);
    create_venv.arg("-m").arg("venv").arg(&venv_dir);
    RagService::apply_proxy_env(&mut create_venv, app_handle);
    run_checked_command(
        create_venv,
        &format!("Create virtualenv for {display_name}"),
    )?;

    let cache_dir = pip_cache_dir(app_handle, service_name)?;
    fs::create_dir_all(&cache_dir)?;

    let mut upgrade_pip = Command::new(&venv_python);
    upgrade_pip
        .arg("-m")
        .arg("pip")
        .arg("install")
        .arg("--upgrade")
        .arg("pip")
        .env("PIP_CACHE_DIR", &cache_dir);
    RagService::apply_proxy_env(&mut upgrade_pip, app_handle);
    run_checked_command(upgrade_pip, &format!("Upgrade pip for {display_name}"))?;

    let mut install_requirements = Command::new(&venv_python);
    install_requirements
        .arg("-m")
        .arg("pip")
        .arg("install")
        .arg("-r")
        .arg(&requirements_path)
        .env("PIP_CACHE_DIR", &cache_dir);
    RagService::apply_proxy_env(&mut install_requirements, app_handle);
    run_checked_command(
        install_requirements,
        &format!("Install Python dependencies for {display_name}"),
    )?;

    fs::write(&stamp_path, runtime_stamp)?;

    Ok((service_dir, venv_python))
}

// ============================================================================
// Python RAG Service
// ============================================================================

pub struct RagService {
    config: ServiceConfig,
    process: Option<Child>,
    process_pid: Option<u32>, // Store PID separately for is_running check
    started_at: Option<Instant>,
    #[allow(dead_code)]
    restart_count: u32,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RagProxySettings {
    enabled: Option<bool>,
    url: Option<String>,
    bypass: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RagLlmConfig {
    proxy: Option<RagProxySettings>,
}

impl RagService {
    pub fn new() -> Self {
        Self {
            config: ServiceConfig {
                name: "rag-service".to_string(),
                enabled: true,
                auto_start: false,
                auto_restart: true,
                health_check_url: Some("http://127.0.0.1:8787/health".to_string()),
                health_check_interval_secs: 30,
                startup_timeout_secs: 120, // Python startup can be slow (model loading)
                max_restart_attempts: 3,
            },
            process: None,
            process_pid: None,
            started_at: None,
            restart_count: 0,
            last_error: None,
        }
    }

    fn first_non_empty_env(keys: &[&str]) -> Option<String> {
        keys.iter()
            .find_map(|key| std::env::var(key).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn sanitize_proxy_for_log(proxy_url: &str) -> String {
        if let Some(at_pos) = proxy_url.rfind('@') {
            let scheme_end = proxy_url.find("://").map(|pos| pos + 3).unwrap_or(0);
            let tail = &proxy_url[at_pos + 1..];
            if scheme_end > 0 {
                return format!("{}***@{}", &proxy_url[..scheme_end], tail);
            }
            return format!("***@{}", tail);
        }
        proxy_url.to_string()
    }

    fn llm_config_path(app_handle: &AppHandle) -> Option<std::path::PathBuf> {
        app_handle
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| dir.join("llm-config.json"))
    }

    fn proxy_from_llm_config(app_handle: &AppHandle) -> Option<(String, Option<String>)> {
        let path = Self::llm_config_path(app_handle)?;
        let raw = fs::read_to_string(path).ok()?;
        let config: RagLlmConfig = serde_json::from_str(&raw).ok()?;
        let proxy = config.proxy?;
        if proxy.enabled != Some(true) {
            return None;
        }
        let url = proxy.url?.trim().to_string();
        if url.is_empty() {
            return None;
        }
        let bypass = proxy
            .bypass
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        Some((url, bypass))
    }

    fn apply_proxy_env(command: &mut Command, app_handle: &AppHandle) {
        let proxy_from_config = Self::proxy_from_llm_config(app_handle);
        let proxy = proxy_from_config
            .as_ref()
            .map(|(url, _)| url.to_string())
            .or_else(|| {
                Self::first_non_empty_env(&[
                    "COWORKANY_PROXY_URL",
                    "HTTPS_PROXY",
                    "https_proxy",
                    "ALL_PROXY",
                    "all_proxy",
                    "HTTP_PROXY",
                    "http_proxy",
                    "GLOBAL_AGENT_HTTPS_PROXY",
                    "GLOBAL_AGENT_HTTP_PROXY",
                ])
            });

        if let Some(proxy_url) = proxy {
            command
                .env("HTTPS_PROXY", &proxy_url)
                .env("https_proxy", &proxy_url)
                .env("HTTP_PROXY", &proxy_url)
                .env("http_proxy", &proxy_url)
                .env("ALL_PROXY", &proxy_url)
                .env("all_proxy", &proxy_url)
                .env("GLOBAL_AGENT_HTTPS_PROXY", &proxy_url)
                .env("GLOBAL_AGENT_HTTP_PROXY", &proxy_url);

            let log_proxy = Self::sanitize_proxy_for_log(&proxy_url);
            if proxy_from_config.is_some() {
                info!("[RAG] Proxy enabled from llm-config: {}", log_proxy);
            } else {
                info!("[RAG] Proxy enabled from environment: {}", log_proxy);
            }
        }

        let no_proxy = proxy_from_config
            .as_ref()
            .and_then(|(_, bypass)| bypass.clone())
            .or_else(|| Self::first_non_empty_env(&["NO_PROXY", "no_proxy"]))
            .unwrap_or_else(|| "localhost,127.0.0.1,::1".to_string());
        command
            .env("NO_PROXY", &no_proxy)
            .env("no_proxy", &no_proxy);
    }

    fn model_cache_dirs() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let base = dirs::home_dir()
            .unwrap_or_else(|| {
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
            })
            .join(".coworkany")
            .join("models");
        let hf_home = base.join("hf");
        let sentence_transformers_home = base.join("sentence-transformers");
        let transformers_cache = hf_home.join("hub");

        if let Err(e) = fs::create_dir_all(&hf_home) {
            warn!(
                "[RAG] Failed to create HF_HOME directory {:?}: {}",
                hf_home, e
            );
        }
        if let Err(e) = fs::create_dir_all(&sentence_transformers_home) {
            warn!(
                "[RAG] Failed to create SENTENCE_TRANSFORMERS_HOME directory {:?}: {}",
                sentence_transformers_home, e
            );
        }
        if let Err(e) = fs::create_dir_all(&transformers_cache) {
            warn!(
                "[RAG] Failed to create TRANSFORMERS_CACHE directory {:?}: {}",
                transformers_cache, e
            );
        }

        (hf_home, sentence_transformers_home, transformers_cache)
    }

    fn apply_model_cache_env(command: &mut Command) {
        let (hf_home, sentence_transformers_home, transformers_cache) = Self::model_cache_dirs();
        command
            .env("HF_HOME", hf_home.to_string_lossy().as_ref())
            .env(
                "SENTENCE_TRANSFORMERS_HOME",
                sentence_transformers_home.to_string_lossy().as_ref(),
            )
            .env(
                "TRANSFORMERS_CACHE",
                transformers_cache.to_string_lossy().as_ref(),
            );
    }

    fn ensure_rag_port_available(&self) -> Result<(), ProcessError> {
        if let Ok(true) = self.health_check() {
            return Err(ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::AddrInUse,
                "Port 8787 is already serving requests. Stop the existing RAG service before starting CoworkAny.".to_string(),
            )));
        }
        Ok(())
    }

    pub fn predownload_embedding_model(app_handle: &AppHandle) -> Result<String, ProcessError> {
        let (rag_path, python) = ensure_service_runtime(
            app_handle,
            "rag-service",
            "RAG_SERVICE_PATH",
            "rag-service",
            "rag-service",
            "RAG service",
        )?;
        let model_name =
            std::env::var("EMBEDDING_MODEL").unwrap_or_else(|_| "all-MiniLM-L6-v2".to_string());
        info!("[RAG] Predownloading embedding model: {}", model_name);

        let mut cmd = Command::new(&python);
        cmd.current_dir(&rag_path)
            .arg("-c")
            .arg(
                "from sentence_transformers import SentenceTransformer; import os; m=os.getenv('EMBEDDING_MODEL','all-MiniLM-L6-v2'); model=SentenceTransformer(m); print(f'model_ready:{m}:{model.get_sentence_embedding_dimension()}')",
            )
            .env("EMBEDDING_MODEL", &model_name)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        Self::apply_proxy_env(&mut cmd, app_handle);
        Self::apply_model_cache_env(&mut cmd);

        let output = cmd.output()?;
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let message = stdout
                .lines()
                .rev()
                .find(|line| line.contains("model_ready:"))
                .unwrap_or("model_ready")
                .to_string();
            info!("[RAG] Predownload complete: {}", message);
            Ok(message)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            Err(ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("RAG model predownload failed: {}", stderr),
            )))
        }
    }
}

impl ManagedService for RagService {
    fn name(&self) -> &str {
        &self.config.name
    }

    fn config(&self) -> &ServiceConfig {
        &self.config
    }

    fn spawn(&mut self, app_handle: &AppHandle) -> Result<(), ProcessError> {
        if self.is_running() {
            info!("[RAG] Service already running");
            return Ok(());
        }

        // Never kill arbitrary user processes. If the expected RAG endpoint is
        // already live, surface a clear error so beta users can resolve it.
        self.ensure_rag_port_available()?;

        let (rag_path, python) = ensure_service_runtime(
            app_handle,
            "rag-service",
            "RAG_SERVICE_PATH",
            "rag-service",
            "rag-service",
            "RAG service",
        )?;
        let main_py = rag_path.join("main.py");

        if !main_py.exists() {
            self.last_error = Some(format!("RAG service not found at {:?}", main_py));
            return Err(ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("RAG service main.py not found at {:?}", main_py),
            )));
        }

        info!(
            "[RAG] Starting service with {} at {}",
            python.display(),
            main_py.display()
        );

        // Set environment variables
        let vault_path = dirs::home_dir()
            .map(|h| h.join(".coworkany").join("vault"))
            .unwrap_or_else(|| std::path::PathBuf::from(".coworkany/vault"));

        let chroma_path = dirs::home_dir()
            .map(|h| h.join(".coworkany").join("chromadb"))
            .unwrap_or_else(|| std::path::PathBuf::from(".coworkany/chromadb"));

        let mut cmd = Command::new(&python);
        cmd.arg(&main_py)
            .current_dir(&rag_path)
            .env("VAULT_PATH", vault_path.to_string_lossy().as_ref())
            .env("CHROMA_PATH", chroma_path.to_string_lossy().as_ref())
            .env("RAG_HOST", "127.0.0.1")
            .env("RAG_PORT", "8787")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Self::apply_proxy_env(&mut cmd, app_handle);
        Self::apply_model_cache_env(&mut cmd);

        let mut child = cmd.spawn()?;
        let pid = child.id();

        // Spawn stderr reader for logging
        if let Some(stderr) = child.stderr.take() {
            let service_name = self.config.name.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        debug!("[{}] {}", service_name, line);
                    }
                }
            });
        }

        self.process = Some(child);
        self.process_pid = Some(pid);
        self.started_at = Some(Instant::now());

        info!("[RAG] Service started with PID {}", pid);

        // Wait for health check
        self.wait_for_healthy()?;

        Ok(())
    }

    fn shutdown(&mut self) {
        if let Some(mut process) = self.process.take() {
            info!("[RAG] Shutting down service");

            // Try graceful shutdown first on Unix
            #[cfg(unix)]
            {
                if let Some(pid) = self.process_pid {
                    let _ = Command::new("kill")
                        .args(["-TERM", &pid.to_string()])
                        .output();
                }
            }

            // Wait briefly for graceful shutdown
            thread::sleep(Duration::from_millis(500));

            // Force kill if still running
            let _ = process.kill();
            let _ = process.wait();

            self.process_pid = None;
            self.started_at = None;
            info!("[RAG] Service stopped");
        }
    }

    fn is_running(&self) -> bool {
        // Use health check to determine if service is running
        // This is more reliable for HTTP services
        if self.process_pid.is_some() {
            if let Some(ref url) = self.config.health_check_url {
                match ureq::get(url).timeout(Duration::from_secs(2)).call() {
                    Ok(response) => response.status() == 200,
                    Err(_) => false,
                }
            } else {
                // Fallback: assume running if we have a PID
                true
            }
        } else {
            false
        }
    }

    fn pid(&self) -> Option<u32> {
        self.process_pid
    }

    fn health_check(&self) -> Result<bool, ProcessError> {
        if let Some(ref url) = self.config.health_check_url {
            // Use blocking HTTP client for health check
            match ureq::get(url).timeout(Duration::from_secs(5)).call() {
                Ok(response) => {
                    if response.status() == 200 {
                        Ok(true)
                    } else {
                        Ok(false)
                    }
                }
                Err(_) => Ok(false),
            }
        } else {
            // No health check URL, check if we have a PID
            Ok(self.process_pid.is_some())
        }
    }
}

impl RagService {
    fn wait_for_healthy(&self) -> Result<(), ProcessError> {
        let timeout = Duration::from_secs(self.config.startup_timeout_secs);
        let start = Instant::now();
        let check_interval = Duration::from_millis(500);

        info!("[RAG] Waiting for service to become healthy...");

        while start.elapsed() < timeout {
            if let Ok(true) = self.health_check() {
                info!("[RAG] Service is healthy");
                return Ok(());
            }
            thread::sleep(check_interval);
        }

        Err(ProcessError::Timeout(format!(
            "RAG service failed to start within {} seconds",
            self.config.startup_timeout_secs
        )))
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BrowserUseSettings {
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
}

pub struct BrowserUseService {
    config: ServiceConfig,
    process: Option<Child>,
    process_pid: Option<u32>,
    started_at: Option<Instant>,
}

impl BrowserUseService {
    pub fn new() -> Self {
        Self {
            config: ServiceConfig {
                name: "browser-use-service".to_string(),
                enabled: true,
                auto_start: false,
                auto_restart: true,
                health_check_url: Some("http://127.0.0.1:8100/health".to_string()),
                health_check_interval_secs: 30,
                startup_timeout_secs: 90,
                max_restart_attempts: 3,
            },
            process: None,
            process_pid: None,
            started_at: None,
        }
    }

    fn llm_config_path(app_handle: &AppHandle) -> Result<PathBuf, ProcessError> {
        app_handle
            .path()
            .app_data_dir()
            .map(|dir| dir.join("llm-config.json"))
            .map_err(|e| {
                ProcessError::SpawnError(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    e.to_string(),
                ))
            })
    }

    fn normalize_base_url(url: Option<String>) -> Option<String> {
        url.map(|raw| raw.trim().trim_end_matches('/').to_string())
            .filter(|raw| !raw.is_empty())
            .map(|raw| {
                if raw.ends_with("/chat/completions") {
                    raw.trim_end_matches("/chat/completions").to_string()
                } else {
                    raw
                }
            })
    }

    fn active_openai_compatible_settings(
        app_handle: &AppHandle,
    ) -> Result<BrowserUseSettings, ProcessError> {
        let path = Self::llm_config_path(app_handle)?;
        let raw = fs::read_to_string(&path)?;
        let data: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                e.to_string(),
            ))
        })?;

        let provider = data
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("openai");

        let active_profile_id = data.get("activeProfileId").and_then(|v| v.as_str());
        let profile = data
            .get("profiles")
            .and_then(|v| v.as_array())
            .and_then(|profiles| {
                active_profile_id.and_then(|id| {
                    profiles
                        .iter()
                        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(id))
                })
            });

        let root = profile.unwrap_or(&data);
        let openai_block = if provider == "openrouter" {
            root.get("openrouter")
        } else if provider == "custom" {
            root.get("custom")
        } else if provider == "anthropic" {
            None
        } else {
            root.get("openai")
        };

        let settings = openai_block.ok_or_else(|| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Browser smart mode requires an OpenAI-compatible profile (OpenAI/Aiberm/OpenRouter/Custom).",
            ))
        })?;

        let api_key = settings
            .get("apiKey")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let mut base_url = settings
            .get("baseUrl")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());
        let model = settings
            .get("model")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string());

        if provider == "openrouter" && base_url.is_none() {
            base_url = Some("https://openrouter.ai/api/v1".to_string());
        }

        let api_key = api_key.ok_or_else(|| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Browser smart mode requires an API key in the active OpenAI-compatible profile.",
            ))
        })?;

        Ok(BrowserUseSettings {
            api_key: Some(api_key),
            base_url: Self::normalize_base_url(base_url),
            model,
        })
    }

    fn ensure_port_available(&self) -> Result<(), ProcessError> {
        if let Ok(true) = self.health_check() {
            return Err(ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::AddrInUse,
                "Port 8100 is already serving browser-use requests. Stop the existing service before starting CoworkAny's managed instance.",
            )));
        }
        Ok(())
    }

    fn wait_for_healthy(&self) -> Result<(), ProcessError> {
        let timeout = Duration::from_secs(self.config.startup_timeout_secs);
        let start = Instant::now();
        let check_interval = Duration::from_millis(500);

        while start.elapsed() < timeout {
            if let Ok(true) = self.health_check() {
                return Ok(());
            }
            thread::sleep(check_interval);
        }

        Err(ProcessError::Timeout(format!(
            "browser-use service failed to start within {} seconds",
            self.config.startup_timeout_secs
        )))
    }
}

impl ManagedService for BrowserUseService {
    fn name(&self) -> &str {
        &self.config.name
    }

    fn config(&self) -> &ServiceConfig {
        &self.config
    }

    fn spawn(&mut self, app_handle: &AppHandle) -> Result<(), ProcessError> {
        if self.is_running() {
            info!("[BrowserUse] Service already running");
            return Ok(());
        }

        self.ensure_port_available()?;

        let (service_dir, python) = ensure_service_runtime(
            app_handle,
            "browser-use-service",
            "BROWSER_USE_SERVICE_PATH",
            "browser-use-service",
            "browser-use-service",
            "browser-use service",
        )?;
        let settings = Self::active_openai_compatible_settings(app_handle)?;
        let main_py = service_dir.join("main.py");

        let mut cmd = Command::new(&python);
        cmd.arg(&main_py)
            .current_dir(&service_dir)
            .env("BROWSER_USE_HOST", "127.0.0.1")
            .env("BROWSER_USE_PORT", "8100")
            .env(
                "BROWSER_USE_LLM_MODEL",
                settings.model.unwrap_or_else(|| "gpt-4o".to_string()),
            )
            .env("OPENAI_API_KEY", settings.api_key.unwrap_or_default())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(base_url) = settings.base_url {
            cmd.env("LITELLM_BASE_URL", base_url);
        }

        RagService::apply_proxy_env(&mut cmd, app_handle);

        let mut child = cmd.spawn()?;
        let pid = child.id();

        if let Some(stderr) = child.stderr.take() {
            let service_name = self.config.name.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        debug!("[{}] {}", service_name, line);
                    }
                }
            });
        }

        self.process = Some(child);
        self.process_pid = Some(pid);
        self.started_at = Some(Instant::now());

        self.wait_for_healthy()?;
        Ok(())
    }

    fn shutdown(&mut self) {
        if let Some(mut process) = self.process.take() {
            #[cfg(unix)]
            {
                if let Some(pid) = self.process_pid {
                    let _ = Command::new("kill")
                        .args(["-TERM", &pid.to_string()])
                        .output();
                }
            }

            thread::sleep(Duration::from_millis(300));
            let _ = process.kill();
            let _ = process.wait();
            self.process_pid = None;
            self.started_at = None;
        }
    }

    fn is_running(&self) -> bool {
        if self.process_pid.is_some() {
            if let Some(ref url) = self.config.health_check_url {
                matches!(ureq::get(url).timeout(Duration::from_secs(2)).call(), Ok(response) if response.status() == 200)
            } else {
                true
            }
        } else {
            false
        }
    }

    fn pid(&self) -> Option<u32> {
        self.process_pid
    }

    fn health_check(&self) -> Result<bool, ProcessError> {
        if let Some(ref url) = self.config.health_check_url {
            match ureq::get(url).timeout(Duration::from_secs(5)).call() {
                Ok(response) => Ok(response.status() == 200),
                Err(_) => Ok(false),
            }
        } else {
            Ok(self.process_pid.is_some())
        }
    }
}

// ============================================================================
// Unified Process Manager
// ============================================================================

pub struct ProcessManager {
    services: HashMap<String, Box<dyn ManagedService>>,
    app_handle: Option<AppHandle>,
}

impl ProcessManager {
    pub fn prepare_managed_runtime(
        app_handle: &AppHandle,
        name: &str,
    ) -> Result<String, ProcessError> {
        match name {
            "rag-service" => {
                ensure_service_runtime(
                    app_handle,
                    "rag-service",
                    "RAG_SERVICE_PATH",
                    "rag-service",
                    "rag-service",
                    "RAG service",
                )?;
                Ok("RAG service runtime prepared".to_string())
            }
            "browser-use-service" => {
                ensure_service_runtime(
                    app_handle,
                    "browser-use-service",
                    "BROWSER_USE_SERVICE_PATH",
                    "browser-use-service",
                    "browser-use-service",
                    "browser-use service",
                )?;
                Ok("browser-use service runtime prepared".to_string())
            }
            other => Err(ProcessError::NotRunning(format!(
                "Unknown managed runtime: {}",
                other
            ))),
        }
    }

    pub fn new() -> Self {
        let mut manager = Self {
            services: HashMap::new(),
            app_handle: None,
        };

        // Register RAG service
        manager.register_service(Box::new(RagService::new()));
        manager.register_service(Box::new(BrowserUseService::new()));

        manager
    }

    pub fn set_app_handle(&mut self, handle: AppHandle) {
        self.app_handle = Some(handle);
    }

    pub fn register_service(&mut self, service: Box<dyn ManagedService>) {
        let name = service.name().to_string();
        self.services.insert(name, service);
    }

    /// Start all enabled services
    pub fn start_all(&mut self) -> Vec<(String, Result<(), ProcessError>)> {
        let mut results = Vec::new();

        let app_handle = match &self.app_handle {
            Some(h) => h.clone(),
            None => {
                error!("[ProcessManager] No app handle set");
                return results;
            }
        };

        let service_names: Vec<String> = self.services.keys().cloned().collect();

        for name in service_names {
            if let Some(service) = self.services.get_mut(&name) {
                if service.config().enabled && service.config().auto_start {
                    info!("[ProcessManager] Starting service: {}", name);
                    let result = service.spawn(&app_handle);
                    results.push((name, result));
                }
            }
        }

        results
    }

    /// Stop all services
    pub fn stop_all(&mut self) {
        for (name, service) in self.services.iter_mut() {
            info!("[ProcessManager] Stopping service: {}", name);
            service.shutdown();
        }
    }

    /// Start a specific service
    pub fn start_service(&mut self, name: &str) -> Result<(), ProcessError> {
        let app_handle = self.app_handle.clone().ok_or_else(|| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::Other,
                "No app handle set",
            ))
        })?;

        if let Some(service) = self.services.get_mut(name) {
            service.spawn(&app_handle)
        } else {
            Err(ProcessError::NotRunning(format!(
                "Service not found: {}",
                name
            )))
        }
    }

    /// Stop a specific service
    pub fn stop_service(&mut self, name: &str) -> Result<(), ProcessError> {
        if let Some(service) = self.services.get_mut(name) {
            service.shutdown();
            Ok(())
        } else {
            Err(ProcessError::NotRunning(format!(
                "Service not found: {}",
                name
            )))
        }
    }

    /// Get status of all services
    pub fn get_all_status(&self) -> Vec<ServiceInfo> {
        self.services
            .values()
            .map(|service| ServiceInfo {
                name: service.name().to_string(),
                status: if service.is_running() {
                    ServiceStatus::Running
                } else {
                    ServiceStatus::Stopped
                },
                pid: service.pid(),
                uptime_secs: None, // TODO: Track uptime
                restart_count: 0,
                last_error: None,
                health_check_url: service.config().health_check_url.clone(),
            })
            .collect()
    }

    /// Get status of a specific service
    pub fn get_service_status(&self, name: &str) -> Option<ServiceInfo> {
        self.services.get(name).map(|service| ServiceInfo {
            name: service.name().to_string(),
            status: if service.is_running() {
                ServiceStatus::Running
            } else {
                ServiceStatus::Stopped
            },
            pid: service.pid(),
            uptime_secs: None,
            restart_count: 0,
            last_error: None,
            health_check_url: service.config().health_check_url.clone(),
        })
    }

    /// Check health of a specific service
    pub fn health_check(&self, name: &str) -> Result<bool, ProcessError> {
        if let Some(service) = self.services.get(name) {
            service.health_check()
        } else {
            Err(ProcessError::NotRunning(format!(
                "Service not found: {}",
                name
            )))
        }
    }

    pub fn predownload_rag_model(&mut self) -> Result<String, ProcessError> {
        let app_handle = self.app_handle.clone().ok_or_else(|| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::Other,
                "No app handle set",
            ))
        })?;
        RagService::predownload_embedding_model(&app_handle)
    }

    pub fn prepare_service_runtime(&mut self, name: &str) -> Result<String, ProcessError> {
        let app_handle = self.app_handle.clone().ok_or_else(|| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::Other,
                "No app handle set",
            ))
        })?;

        Self::prepare_managed_runtime(&app_handle, name)
    }
}

impl Drop for ProcessManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

// ============================================================================
// Tauri State Wrapper
// ============================================================================

pub struct ProcessManagerState(pub Arc<Mutex<ProcessManager>>);

impl ProcessManagerState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(ProcessManager::new())))
    }
}
