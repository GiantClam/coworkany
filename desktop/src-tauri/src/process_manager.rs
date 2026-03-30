//! CoworkAny Desktop - Process manager (Mastra single-path runtime)
//!
//! Legacy Python managed services (`rag-service`, `browser-use-service`) were
//! removed from the runtime architecture. We keep a small compatibility shell so
//! existing IPC commands and UI status panels remain stable while returning
//! deterministic no-op behavior.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use thiserror::Error;
use tracing::{info, warn};

// ============================================================================
// Error Types
// ============================================================================

#[derive(Error, Debug)]
pub enum ProcessError {
    #[error("Failed to spawn process: {0}")]
    SpawnError(#[from] std::io::Error),

    #[error("Service not running: {0}")]
    NotRunning(String),

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
// No-op compatibility services
// ============================================================================

struct NoopManagedService {
    config: ServiceConfig,
    startup_notice: &'static str,
}

impl NoopManagedService {
    fn new(name: &str, health_check_url: Option<&str>, startup_notice: &'static str) -> Self {
        Self {
            config: ServiceConfig {
                name: name.to_string(),
                enabled: true,
                auto_start: false,
                auto_restart: false,
                health_check_url: health_check_url.map(str::to_string),
                health_check_interval_secs: 30,
                startup_timeout_secs: 1,
                max_restart_attempts: 0,
            },
            startup_notice,
        }
    }
}

impl ManagedService for NoopManagedService {
    fn name(&self) -> &str {
        &self.config.name
    }

    fn config(&self) -> &ServiceConfig {
        &self.config
    }

    fn spawn(&mut self, _app_handle: &AppHandle) -> Result<(), ProcessError> {
        warn!(
            "[ProcessManager] '{}' start requested but service is retired: {}",
            self.config.name,
            self.startup_notice,
        );
        Ok(())
    }

    fn shutdown(&mut self) {
        // No-op: retired service has no process to stop.
    }

    fn is_running(&self) -> bool {
        false
    }

    fn pid(&self) -> Option<u32> {
        None
    }

    fn health_check(&self) -> Result<bool, ProcessError> {
        Ok(false)
    }
}

fn retired_service_noop_message(name: &str) -> Option<&'static str> {
    match name {
        "rag-service" => Some(
            "RAG runtime is embedded in the Mastra single-process stack; no external service runtime is required.",
        ),
        "browser-use-service" => Some(
            "Browser smart runtime no longer uses a Python sidecar service; start request is treated as a compatibility no-op.",
        ),
        _ => None,
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
        _app_handle: &AppHandle,
        name: &str,
    ) -> Result<String, ProcessError> {
        if let Some(message) = retired_service_noop_message(name) {
            return Ok(message.to_string());
        }

        Err(ProcessError::NotRunning(format!(
            "Unknown managed runtime: {}",
            name
        )))
    }

    pub fn new() -> Self {
        let mut manager = Self {
            services: HashMap::new(),
            app_handle: None,
        };

        manager.register_service(Box::new(NoopManagedService::new(
            "rag-service",
            Some("http://127.0.0.1:8787/health"),
            "RAG Python sidecar has been retired",
        )));
        manager.register_service(Box::new(NoopManagedService::new(
            "browser-use-service",
            Some("http://127.0.0.1:8100/health"),
            "browser-use Python sidecar has been retired",
        )));

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
                uptime_secs: None,
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
        Ok("RAG embedding predownload is no longer required in Mastra single-process mode."
            .to_string())
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
