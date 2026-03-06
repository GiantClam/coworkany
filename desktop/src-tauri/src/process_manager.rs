//! CoworkAny Desktop - Unified Process Manager
//!
//! Manages multiple backend services with automatic startup, health checks, and restart.
//! Services:
//! - Bun Sidecar: Core agent orchestration (existing)
//! - Python RAG Service: Memory vault semantic search (new)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::fs;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use thiserror::Error;
use tracing::{debug, error, info, warn};

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

// ============================================================================
// Python RAG Service
// ============================================================================

pub struct RagService {
    config: ServiceConfig,
    process: Option<Child>,
    process_pid: Option<u32>,  // Store PID separately for is_running check
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
                auto_start: true,
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

    fn find_python() -> Option<String> {
        // Try different Python commands
        for cmd in &["python3", "python", "py"] {
            if let Ok(output) = Command::new(cmd)
                .arg("--version")
                .output()
            {
                if output.status.success() {
                    return Some(cmd.to_string());
                }
            }
        }
        None
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
        command.env("NO_PROXY", &no_proxy).env("no_proxy", &no_proxy);
    }

    fn model_cache_dirs() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let base = dirs::home_dir()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
            .join(".coworkany")
            .join("models");
        let hf_home = base.join("hf");
        let sentence_transformers_home = base.join("sentence-transformers");
        let transformers_cache = hf_home.join("hub");

        if let Err(e) = fs::create_dir_all(&hf_home) {
            warn!("[RAG] Failed to create HF_HOME directory {:?}: {}", hf_home, e);
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
            .env("TRANSFORMERS_CACHE", transformers_cache.to_string_lossy().as_ref());
    }

    fn get_rag_service_path(&self) -> std::path::PathBuf {
        // Try multiple paths to find rag-service directory
        let candidates = vec![
            // 1. Environment variable (can be set by user)
            std::env::var("RAG_SERVICE_PATH").ok().map(std::path::PathBuf::from),

            // 2. Development path from Cargo manifest dir
            // CARGO_MANIFEST_DIR is desktop/src-tauri, so go up 2 levels
            std::env::var("CARGO_MANIFEST_DIR").ok().map(|dir| {
                std::path::PathBuf::from(dir)
                    .join("..")
                    .join("..")
                    .join("rag-service")
            }),

            // 3. From executable path (debug: target/debug/exe)
            // Path: desktop/src-tauri/target/debug/exe -> ../../../../rag-service
            std::env::current_exe().ok().and_then(|exe| {
                exe.parent().map(|dir| {
                    dir.join("..").join("..").join("..").join("..").join("rag-service")
                })
            }),

            // 4. From current working directory
            std::env::current_dir().ok().map(|cwd| cwd.join("rag-service")),

            // 5. From current working directory going up (if CWD is desktop)
            std::env::current_dir().ok().map(|cwd| cwd.join("..").join("rag-service")),

            // 6. Absolute path for this specific project (fallback)
            Some(std::path::PathBuf::from(r"d:\private\coworkany\rag-service")),
        ];

        for candidate in candidates.into_iter().flatten() {
            let main_py = candidate.join("main.py");
            if main_py.exists() {
                info!("[RAG] Found service at: {:?}", candidate);
                return candidate.canonicalize().unwrap_or(candidate);
            }
        }

        // Final fallback - return the project-specific path
        warn!("[RAG] Could not find rag-service directory, using default");
        std::path::PathBuf::from(r"d:\private\coworkany\rag-service")
    }

    pub fn predownload_embedding_model(app_handle: &AppHandle) -> Result<String, ProcessError> {
        let python = Self::find_python().ok_or_else(|| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Python not found. Please install Python 3.8+",
            ))
        })?;

        let rag_path = Self::new().get_rag_service_path();
        let model_name = std::env::var("EMBEDDING_MODEL").unwrap_or_else(|_| "all-MiniLM-L6-v2".to_string());
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

    fn spawn(&mut self, _app_handle: &AppHandle) -> Result<(), ProcessError> {
        if self.is_running() {
            info!("[RAG] Service already running");
            return Ok(());
        }

        // Kill any stale process occupying the RAG service port.
        // This prevents the new instance from failing to bind AND prevents
        // the health-check from succeeding against an orphaned process.
        Self::kill_stale_process_on_port(8787);

        let python = Self::find_python().ok_or_else(|| {
            ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Python not found. Please install Python 3.8+",
            ))
        })?;

        let rag_path = self.get_rag_service_path();
        let main_py = rag_path.join("main.py");

        if !main_py.exists() {
            self.last_error = Some(format!("RAG service not found at {:?}", main_py));
            return Err(ProcessError::SpawnError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("RAG service main.py not found at {:?}", main_py),
            )));
        }

        info!("[RAG] Starting service with {} at {:?}", python, main_py);

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
        Self::apply_proxy_env(&mut cmd, _app_handle);
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
    /// Kill any stale process occupying the given TCP port.
    /// On Windows uses `netstat` + `taskkill`; on Unix uses `lsof` + `kill`.
    fn kill_stale_process_on_port(port: u16) {
        #[cfg(target_os = "windows")]
        {
            // Run: netstat -ano | findstr :<port> | findstr LISTENING
            let output = Command::new("cmd")
                .args(["/C", &format!("netstat -ano | findstr :{} | findstr LISTENING", port)])
                .output();

            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    // Typical line: "  TCP    127.0.0.1:8787    0.0.0.0:0    LISTENING    12345"
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(pid_str) = parts.last() {
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            if pid > 0 {
                                warn!("[RAG] Killing stale process on port {} (PID {})", port, pid);
                                let _ = Command::new("taskkill")
                                    .args(["/PID", &pid.to_string(), "/F"])
                                    .output();
                                // Give the OS time to release the port
                                thread::sleep(Duration::from_millis(500));
                            }
                        }
                    }
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // Run: lsof -ti :<port>
            let output = Command::new("lsof")
                .args(["-ti", &format!(":{}", port)])
                .output();

            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for pid_str in stdout.lines() {
                    if let Ok(pid) = pid_str.trim().parse::<u32>() {
                        if pid > 0 {
                            warn!("[RAG] Killing stale process on port {} (PID {})", port, pid);
                            let _ = Command::new("kill")
                                .args(["-9", &pid.to_string()])
                                .output();
                            thread::sleep(Duration::from_millis(500));
                        }
                    }
                }
            }
        }
    }

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

// ============================================================================
// Unified Process Manager
// ============================================================================

pub struct ProcessManager {
    services: HashMap<String, Box<dyn ManagedService>>,
    app_handle: Option<AppHandle>,
}

impl ProcessManager {
    pub fn new() -> Self {
        let mut manager = Self {
            services: HashMap::new(),
            app_handle: None,
        };

        // Register RAG service
        manager.register_service(Box::new(RagService::new()));

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
