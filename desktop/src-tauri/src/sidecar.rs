//! CoworkAny Desktop - Sidecar Manager
//!
//! Manages the Bun sidecar process lifecycle and IPC communication.
//! - Spawns sidecar with stdin/stdout pipes
//! - Sends IpcCommand JSON lines to stdin
//! - Reads TaskEvent JSON lines from stdout and emits to frontend

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(unix)]
use std::net::Shutdown;
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::process::Command as TokioCommand;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::diff::{apply_patch as apply_patch_diff, DiffHunk, FilePatch, PatchOperation};
use crate::platform_runtime::{
    build_platform_runtime_context, resolve_app_data_dir, resolve_app_dir,
    resolve_sidecar_entry_path, PlatformRuntimeContext,
};
use crate::policy::commands as policy_commands;
use crate::policy::{
    EffectContext, EffectPayload, EffectRequest, EffectResponse, EffectScope, EffectSource,
    EffectType, PolicyEngineState,
};
use crate::shadow_fs::{self, ShadowFsState};

struct PackagedSidecar {
    executable: std::path::PathBuf,
    node_entry: Option<std::path::PathBuf>,
    bridge_script: Option<std::path::PathBuf>,
    node_binary: Option<std::path::PathBuf>,
    playwright_browsers_path: Option<std::path::PathBuf>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SidecarProxySettings {
    enabled: Option<bool>,
    url: Option<String>,
    bypass: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SidecarLlmConfig {
    proxy: Option<SidecarProxySettings>,
    provider: Option<String>,
    anthropic: Option<SidecarProviderSettings>,
    openrouter: Option<SidecarProviderSettings>,
    openai: Option<SidecarProviderSettings>,
    custom: Option<SidecarProviderSettings>,
    profiles: Option<Vec<SidecarLlmProfile>>,
    active_profile_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SidecarProviderSettings {
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_format: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SidecarLlmProfile {
    id: Option<String>,
    provider: Option<String>,
    anthropic: Option<SidecarProviderSettings>,
    openrouter: Option<SidecarProviderSettings>,
    openai: Option<SidecarProviderSettings>,
    custom: Option<SidecarProviderSettings>,
}

const STDERR_NOISE_LOG_INTERVAL: Duration = Duration::from_secs(30);
const JSON_LOG_PREVIEW_MAX_CHARS: usize = 2_048;
const STREAM_DELTA_LOG_PREVIEW_MAX_CHARS: usize = 320;
const SIDECAR_METRICS_LOG_PREFIX: &str = "[coworkany-metrics]";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum SidecarStderrCategory {
    Heartbeat,
    LlmConfig,
    IpcDebug,
    RoutineInfo,
    Important,
}

// ============================================================================
// Error Types
// ============================================================================

#[derive(Error, Debug)]
pub enum SidecarError {
    #[error("Failed to spawn sidecar: {0}")]
    SpawnError(#[from] std::io::Error),

    #[error("Sidecar not running")]
    NotRunning,

    #[error("Failed to send command: {0}")]
    SendError(String),

    #[error("Failed to serialize command: {0}")]
    SerializeError(#[from] serde_json::Error),
}

// ============================================================================
// IPC Types (mirror of sidecar/src/protocol types)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StartTaskPayload {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub title: String,
    #[serde(rename = "userQuery")]
    pub user_query: String,
    pub context: TaskContext,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<TaskConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskContext {
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "activeFile", skip_serializing_if = "Option::is_none")]
    pub active_file: Option<String>,
    #[serde(rename = "displayText", skip_serializing_if = "Option::is_none")]
    pub display_text: Option<String>,
    #[serde(rename = "selectedText", skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    #[serde(rename = "openFiles", skip_serializing_if = "Option::is_none")]
    pub open_files: Option<Vec<String>>,
    #[serde(rename = "environmentContext", skip_serializing_if = "Option::is_none")]
    pub environment_context: Option<PlatformRuntimeContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    #[serde(rename = "modelId", skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(rename = "executionPath", skip_serializing_if = "Option::is_none")]
    pub execution_path: Option<String>,
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(rename = "maxHistoryMessages", skip_serializing_if = "Option::is_none")]
    pub max_history_messages: Option<u32>,
    #[serde(
        rename = "enabledClaudeSkills",
        skip_serializing_if = "Option::is_none"
    )]
    pub enabled_claude_skills: Option<Vec<String>>,
    #[serde(rename = "enabledToolpacks", skip_serializing_if = "Option::is_none")]
    pub enabled_toolpacks: Option<Vec<String>>,
    #[serde(rename = "enabledSkills", skip_serializing_if = "Option::is_none")]
    pub enabled_skills: Option<Vec<String>>,
    #[serde(rename = "voiceProviderMode", skip_serializing_if = "Option::is_none")]
    pub voice_provider_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SendTaskMessagePayload {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub content: String,
    #[serde(rename = "environmentContext", skip_serializing_if = "Option::is_none")]
    pub environment_context: Option<PlatformRuntimeContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<TaskConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ResumeInterruptedTaskPayload {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<TaskConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CancelTaskPayload {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ClearTaskHistoryPayload {
    #[serde(rename = "taskId")]
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IpcCommand {
    #[serde(rename = "start_task")]
    StartTask {
        id: String,
        timestamp: String,
        payload: StartTaskPayload,
    },
    #[serde(rename = "cancel_task")]
    CancelTask {
        id: String,
        timestamp: String,
        payload: CancelTaskPayload,
    },
    #[serde(rename = "clear_task_history")]
    ClearTaskHistory {
        id: String,
        timestamp: String,
        payload: ClearTaskHistoryPayload,
    },
    #[serde(rename = "send_task_message")]
    SendTaskMessage {
        id: String,
        timestamp: String,
        payload: SendTaskMessagePayload,
    },
    #[serde(rename = "resume_interrupted_task")]
    ResumeInterruptedTask {
        id: String,
        timestamp: String,
        payload: ResumeInterruptedTaskPayload,
    },
}

impl IpcCommand {
    pub fn start_task(
        task_id: String,
        title: String,
        user_query: String,
        context: TaskContext,
        config: Option<TaskConfig>,
    ) -> Self {
        IpcCommand::StartTask {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono_now(),
            payload: StartTaskPayload {
                task_id,
                title,
                user_query,
                context,
                config,
            },
        }
    }

    pub fn cancel_task(task_id: String, reason: Option<String>) -> Self {
        IpcCommand::CancelTask {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono_now(),
            payload: CancelTaskPayload { task_id, reason },
        }
    }

    pub fn clear_task_history(task_id: String) -> Self {
        IpcCommand::ClearTaskHistory {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono_now(),
            payload: ClearTaskHistoryPayload { task_id },
        }
    }

    pub fn send_task_message(
        task_id: String,
        content: String,
        environment_context: Option<PlatformRuntimeContext>,
        config: Option<TaskConfig>,
    ) -> Self {
        IpcCommand::SendTaskMessage {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono_now(),
            payload: SendTaskMessagePayload {
                task_id,
                content,
                environment_context,
                config,
            },
        }
    }

    pub fn resume_interrupted_task(task_id: String, config: Option<TaskConfig>) -> Self {
        IpcCommand::ResumeInterruptedTask {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono_now(),
            payload: ResumeInterruptedTaskPayload { task_id, config },
        }
    }
}

fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

// ============================================================================
// Sidecar Manager
// ============================================================================

pub struct SidecarManager {
    child: Option<Child>,
    command_writer: Option<SharedCommandWriter>,
    stdout_handle: Option<thread::JoinHandle<()>>,
    stdout_drain_handle: Option<thread::JoinHandle<()>>,
    stderr_handle: Option<thread::JoinHandle<()>>,
    pending_responses: Arc<Mutex<HashMap<String, Sender<serde_json::Value>>>>,
    transport_healthy: Arc<AtomicBool>,
}

enum CommandWriter {
    Child(std::process::ChildStdin),
    #[cfg(unix)]
    Unix(UnixStream),
    #[cfg(windows)]
    WindowsPipe(std::fs::File),
}

impl CommandWriter {
    fn shutdown(&mut self) {
        #[cfg(unix)]
        if let Self::Unix(stream) = self {
            let _ = stream.shutdown(Shutdown::Both);
        }
        #[cfg(windows)]
        if let Self::WindowsPipe(file) = self {
            let _ = file.flush();
        }
    }
}

impl Write for CommandWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Child(stdin) => stdin.write(buf),
            #[cfg(unix)]
            Self::Unix(stream) => stream.write(buf),
            #[cfg(windows)]
            Self::WindowsPipe(file) => file.write(buf),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Child(stdin) => stdin.flush(),
            #[cfg(unix)]
            Self::Unix(stream) => stream.flush(),
            #[cfg(windows)]
            Self::WindowsPipe(file) => file.flush(),
        }
    }
}

type SharedCommandWriter = Arc<Mutex<CommandWriter>>;

struct AttachedSingletonTransport {
    reader: Box<dyn Read + Send>,
    writer: SharedCommandWriter,
    descriptor: String,
}

impl SidecarManager {
    fn force_development_sidecar() -> bool {
        matches!(
            std::env::var("COWORKANY_FORCE_DEVELOPMENT_SIDECAR")
                .ok()
                .map(|value| value.trim().to_ascii_lowercase())
                .as_deref(),
            Some("1" | "true" | "yes" | "on")
        )
    }

    fn running_from_app_bundle() -> bool {
        std::env::current_exe()
            .ok()
            .map(|path| path.to_string_lossy().contains(".app/Contents/MacOS/"))
            .unwrap_or(false)
    }

    pub fn new() -> Self {
        Self {
            child: None,
            command_writer: None,
            stdout_handle: None,
            stdout_drain_handle: None,
            stderr_handle: None,
            pending_responses: Arc::new(Mutex::new(HashMap::new())),
            transport_healthy: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Spawn the sidecar process and start listening for events
    pub fn spawn(&mut self, app_handle: AppHandle) -> Result<(), SidecarError> {
        if self.transport_healthy.load(Ordering::SeqCst) && self.command_writer.is_some() {
            warn!("Sidecar transport already running, skipping spawn");
            return Ok(());
        }

        info!("Ensuring sidecar transport...");
        self.transport_healthy = Arc::new(AtomicBool::new(true));

        let app_dir = resolve_app_dir();
        let app_data_dir = resolve_app_data_dir(&app_handle);
        let mut launch_mode = "development".to_string();

        if let Some(attached) = Self::try_attach_singleton_transport(&app_data_dir)? {
            info!(
                "Attached to existing sidecar singleton transport: {}",
                attached.descriptor
            );
            launch_mode = "singleton_attach".to_string();
            self.command_writer = Some(attached.writer.clone());
            self.child = None;

            let runtime_context = build_platform_runtime_context(&app_handle, Some(&launch_mode));
            self.start_reader_threads(attached.reader, None, app_handle, attached.writer);

            if let Err(error) = self.send_runtime_bootstrap(&runtime_context) {
                self.invalidate_transport("failed to bootstrap attached sidecar runtime context");
                return Err(error);
            }
            if let Err(error) = self.wait_for_runtime_snapshot(Duration::from_secs(5)) {
                self.invalidate_transport("runtime snapshot handshake failed after sidecar attach");
                return Err(error);
            }

            return Ok(());
        }

        info!("No reusable sidecar transport found; spawning new sidecar process");

        let force_development = Self::force_development_sidecar();
        let prefer_packaged = Self::running_from_app_bundle();
        let packaged = if force_development || !prefer_packaged {
            None
        } else {
            Self::resolve_packaged_sidecar(&app_handle)
        };
        let mut child = if let Some(packaged) = packaged {
            launch_mode = "packaged".to_string();
            Self::spawn_packaged_sidecar(&packaged, &app_dir, &app_data_dir).or_else(|error| {
                warn!(
                    "Failed to start packaged sidecar ({}), falling back to development entry",
                    error
                );
                launch_mode = "development".to_string();
                Self::spawn_development_sidecar(&app_dir, &app_data_dir)
            })?
        } else {
            if force_development {
                info!("COWORKANY_FORCE_DEVELOPMENT_SIDECAR enabled; skipping packaged sidecar");
            } else if !prefer_packaged {
                info!("Running outside app bundle; using development sidecar");
            }
            Self::spawn_development_sidecar(&app_dir, &app_data_dir)?
        };

        info!("Sidecar spawned with PID: {:?}", child.id());

        // Keep consuming child stdout to avoid pipe backpressure.
        let stdout = child.stdout.take().expect("Failed to get stdout");
        let stderr = child.stderr.take().expect("Failed to get stderr");
        let attached = Self::try_attach_singleton_transport_with_retry(
            &app_data_dir,
            300,
            Duration::from_millis(50),
        )?;
        let (reader, command_writer, using_socket_transport): (
            Box<dyn Read + Send>,
            SharedCommandWriter,
            bool,
        ) = if let Some(attached) = attached {
            info!(
                "Connected to spawned sidecar singleton transport; routing commands+events via {}",
                attached.descriptor
            );
            // Close the direct stdin pipe when singleton transport is active so command
            // delivery does not depend on stdin behavior of the packaged runtime.
            let _ = child.stdin.take();
            self.stdout_drain_handle = Some(Self::start_stdout_drain_thread(stdout));
            (attached.reader, attached.writer, true)
        } else {
            warn!(
                    "Spawned sidecar singleton transport not available yet; falling back to stdin/stdout transport"
                );
            (
                Box::new(stdout),
                Arc::new(Mutex::new(CommandWriter::Child(
                    child.stdin.take().expect("Failed to get stdin"),
                ))),
                false,
            )
        };
        self.command_writer = Some(command_writer.clone());
        self.child = Some(child);

        let runtime_context = build_platform_runtime_context(&app_handle, Some(&launch_mode));
        self.start_reader_threads(reader, Some(stderr), app_handle, command_writer);

        if let Err(error) = self.send_runtime_bootstrap(&runtime_context) {
            self.invalidate_transport("failed to bootstrap sidecar runtime context");
            return Err(error);
        }
        if let Err(error) = self.wait_for_runtime_snapshot(Duration::from_secs(5)) {
            if using_socket_transport {
                self.invalidate_transport("runtime snapshot handshake failed after sidecar spawn");
                return Err(error);
            }
            warn!(
                "Runtime snapshot handshake failed on stdin/stdout fallback transport: {}",
                error
            );
        }
        if let Err(error) = self.warmup_chat_runtime(Duration::from_secs(10)) {
            self.invalidate_transport("chat runtime warmup failed after sidecar spawn");
            return Err(error);
        }

        Ok(())
    }

    /// Send a command to the sidecar
    pub fn send_command(&self, command: IpcCommand) -> Result<(), SidecarError> {
        let json = serde_json::to_string(&command)?;
        debug!(
            "Sending command to sidecar: {}",
            truncate_log_line(&json, JSON_LOG_PREVIEW_MAX_CHARS)
        );
        self.write_stdin_line(&json)
    }

    /// Send a raw JSON command to the sidecar
    pub fn send_raw_command(&self, command: serde_json::Value) -> Result<(), SidecarError> {
        let json = serde_json::to_string(&command)?;
        debug!(
            "Sending raw command to sidecar: {}",
            truncate_log_line(&json, JSON_LOG_PREVIEW_MAX_CHARS)
        );
        self.write_stdin_line(&json)
    }

    /// Send a raw JSON command to the sidecar and return a receiver for the response
    pub fn send_command_async(
        &self,
        command: serde_json::Value,
    ) -> Result<Receiver<serde_json::Value>, SidecarError> {
        let command_id = command
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SidecarError::SendError("command id missing".to_string()))?
            .to_string();

        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self
                .pending_responses
                .lock()
                .map_err(|e| SidecarError::SendError(e.to_string()))?;
            pending.insert(command_id.clone(), tx);
        }

        if let Err(error) = self.send_raw_command(command) {
            self.clear_pending_response(&command_id);
            return Err(error);
        }

        Ok(rx)
    }

    pub fn clear_pending_response(&self, command_id: &str) {
        if let Ok(mut pending) = self.pending_responses.lock() {
            pending.remove(command_id);
        }
    }

    fn send_runtime_bootstrap(
        &self,
        runtime_context: &crate::platform_runtime::PlatformRuntimeContext,
    ) -> Result<(), SidecarError> {
        let command = json!({
            "id": Uuid::new_v4().to_string(),
            "timestamp": chrono_now(),
            "type": "bootstrap_runtime_context",
            "payload": {
                "runtimeContext": runtime_context
            }
        });
        self.send_raw_command(command)
    }

    fn wait_for_runtime_snapshot(&self, timeout: Duration) -> Result<(), SidecarError> {
        let command = json!({
            "id": Uuid::new_v4().to_string(),
            "timestamp": chrono_now(),
            "type": "get_runtime_snapshot",
            "payload": {}
        });
        let receiver = self.send_command_async(command)?;
        let response = receiver.recv_timeout(timeout).map_err(|error| {
            SidecarError::SendError(format!("runtime snapshot handshake timeout: {}", error))
        })?;
        let success = response
            .get("payload")
            .and_then(|payload| payload.get("success"))
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if success {
            return Ok(());
        }
        Err(SidecarError::SendError(
            "runtime snapshot handshake returned unsuccessful response".to_string(),
        ))
    }

    fn warmup_chat_runtime(&self, timeout: Duration) -> Result<(), SidecarError> {
        let command = json!({
            "id": Uuid::new_v4().to_string(),
            "timestamp": chrono_now(),
            "type": "warmup_chat_runtime",
            "payload": {}
        });
        let receiver = self.send_command_async(command)?;
        let response = receiver.recv_timeout(timeout).map_err(|error| {
            SidecarError::SendError(format!("chat runtime warmup timeout: {}", error))
        })?;
        let payload = response
            .get("payload")
            .and_then(|value| value.as_object())
            .cloned()
            .unwrap_or_default();
        let success = payload
            .get("success")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if success {
            let warmup = payload
                .get("warmup")
                .and_then(|value| value.as_object())
                .cloned()
                .unwrap_or_default();
            let mcp_server_count = warmup
                .get("mcpServerCount")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let mcp_tool_count = warmup
                .get("mcpToolCount")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let duration_ms = warmup
                .get("durationMs")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            info!(
                "Sidecar chat warmup finished: mcp_servers={} mcp_tools={} duration_ms={}",
                mcp_server_count, mcp_tool_count, duration_ms
            );
            return Ok(());
        }
        let error = payload
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("chat runtime warmup failed");
        Err(SidecarError::SendError(error.to_string()))
    }

    /// Shutdown the sidecar process
    pub fn shutdown(&mut self) {
        self.transport_healthy.store(false, Ordering::SeqCst);
        fail_pending_responses(
            &self.pending_responses,
            "sidecar_shutdown",
            "Sidecar was shut down before the request completed",
        );
        self.close_command_writer();

        if let Some(mut child) = self.child.take() {
            info!("Shutting down sidecar...");

            // Give it a moment to exit gracefully
            std::thread::sleep(std::time::Duration::from_millis(100));

            // Force kill if still running
            let _ = child.kill();
            let _ = child.wait();

            info!("Sidecar shutdown complete");
        }

        if let Some(handle) = self.stdout_drain_handle.take() {
            let _ = handle.join();
        }
    }

    pub fn invalidate_transport(&mut self, reason: &str) {
        let was_healthy = self.transport_healthy.swap(false, Ordering::SeqCst);
        if was_healthy {
            warn!("Invalidating sidecar transport: {}", reason);
        } else {
            debug!("Sidecar transport already unhealthy: {}", reason);
        }

        fail_pending_responses(&self.pending_responses, "sidecar_disconnected", reason);
        self.close_command_writer();

        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        if let Some(handle) = self.stdout_drain_handle.take() {
            let _ = handle.join();
        }
    }

    /// Check if sidecar is running
    pub fn is_running(&mut self) -> bool {
        if !self.transport_healthy.load(Ordering::SeqCst) {
            if self.child.is_some() || self.command_writer.is_some() {
                self.invalidate_transport("sidecar transport marked unhealthy");
            }
            return false;
        }

        if let Some(ref mut child) = self.child {
            // try_wait checks if the process has exited without blocking
            match child.try_wait() {
                Ok(Some(status)) => {
                    // Process has exited
                    warn!("Sidecar process exited with status: {:?}", status);
                    // Clean up the dead process
                    self.child = None;
                    self.command_writer = None;
                    false
                }
                Ok(None) => {
                    // Process is still running
                    true
                }
                Err(e) => {
                    error!("Failed to check sidecar status: {}", e);
                    false
                }
            }
        } else {
            self.command_writer.is_some()
        }
    }

    fn start_reader_threads(
        &mut self,
        reader: Box<dyn Read + Send>,
        stderr: Option<std::process::ChildStderr>,
        app_handle: AppHandle,
        command_writer: SharedCommandWriter,
    ) {
        let transport_healthy = self.transport_healthy.clone();
        let pending_responses = self.pending_responses.clone();

        let stdout_handle = thread::spawn(move || {
            Self::stdout_reader_loop(
                reader,
                app_handle,
                command_writer,
                pending_responses,
                transport_healthy,
            );
        });
        self.stdout_handle = Some(stdout_handle);

        self.stderr_handle = stderr.map(|stderr| {
            thread::spawn(move || {
                Self::stderr_reader_loop(stderr);
            })
        });
    }

    fn start_stdout_drain_thread(stdout: std::process::ChildStdout) -> JoinHandle<()> {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line_result in reader.lines() {
                match line_result {
                    Ok(_line) => {}
                    Err(error) => {
                        debug!("Error draining sidecar stdout: {}", error);
                        break;
                    }
                }
            }
            debug!("Stdout drain loop ended");
        })
    }

    fn close_command_writer(&mut self) {
        let Some(command_writer) = self.command_writer.take() else {
            return;
        };

        match command_writer.lock() {
            Ok(mut guard) => guard.shutdown(),
            Err(error) => warn!(
                "Failed to lock sidecar command writer for shutdown: {}",
                error
            ),
        };
    }

    // -------------------------------------------------------------------------
    // Internal threads
    // -------------------------------------------------------------------------

    fn stdout_reader_loop(
        stdout: Box<dyn Read + Send>,
        app_handle: AppHandle,
        command_writer: SharedCommandWriter,
        pending_responses: Arc<Mutex<HashMap<String, Sender<serde_json::Value>>>>,
        transport_healthy: Arc<AtomicBool>,
    ) {
        let reader = BufReader::new(stdout);
        let mut suppressed_non_protocol_lines = 0usize;
        let mut stream_delta_log_aggregator = StreamDeltaLogAggregator::default();

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }

                    if !is_json_object_line(&line) {
                        if is_sidecar_metrics_line(&line) {
                            stream_delta_log_aggregator.flush();
                            debug!(
                                "Received sidecar metrics: {}",
                                truncate_log_line(&line, JSON_LOG_PREVIEW_MAX_CHARS)
                            );
                            continue;
                        }
                        suppressed_non_protocol_lines += 1;
                        continue;
                    }
                    if suppressed_non_protocol_lines > 0 {
                        debug!(
                            "Suppressed {} non-protocol sidecar stdout lines",
                            suppressed_non_protocol_lines
                        );
                        suppressed_non_protocol_lines = 0;
                    }

                    match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(message) => {
                            if !message.is_object() {
                                warn!("Ignoring sidecar stdout JSON value that is not an object");
                                continue;
                            }
                            if let Some(stream_entry) = extract_stream_delta_log_entry(&message) {
                                stream_delta_log_aggregator.push(stream_entry);
                            } else {
                                stream_delta_log_aggregator.flush();
                                debug!(
                                    "Received from sidecar: {}",
                                    truncate_log_line(&line, JSON_LOG_PREVIEW_MAX_CHARS)
                                );
                            }

                            match classify_sidecar_message(&message) {
                                Some(SidecarMessageKind::TaskEvent) => {
                                    if let Err(e) = app_handle.emit("task-event", &message) {
                                        error!("Failed to emit task-event: {}", e);
                                    }
                                }
                                Some(SidecarMessageKind::CanonicalStreamEvent) => {
                                    if let Err(e) =
                                        app_handle.emit("canonical-stream-event", &message)
                                    {
                                        error!("Failed to emit canonical-stream-event: {}", e);
                                    }
                                }
                                Some(SidecarMessageKind::VoiceState) => {
                                    let payload =
                                        message.get("payload").cloned().unwrap_or(message.clone());
                                    if let Err(e) = app_handle.emit("voice-state", payload) {
                                        error!("Failed to emit voice-state: {}", e);
                                    }
                                }
                                Some(SidecarMessageKind::IpcResponse) => {
                                    if let Some(command_id) = message
                                        .get("commandId")
                                        .and_then(|v| v.as_str())
                                        .map(|v| v.to_string())
                                    {
                                        if let Ok(mut pending) = pending_responses.lock() {
                                            if let Some(waiter) = pending.remove(&command_id) {
                                                let _ = waiter.send(message.clone());
                                            }
                                        }
                                    }
                                    if let Err(e) = app_handle.emit("ipc-response", &message) {
                                        error!("Failed to emit ipc-response: {}", e);
                                    }
                                }
                                Some(SidecarMessageKind::IpcCommand) => {
                                    handle_sidecar_command(
                                        message,
                                        app_handle.clone(),
                                        command_writer.clone(),
                                    );
                                }
                                None => warn!(
                                    "Ignoring unclassified sidecar message: {}",
                                    truncate_log_line(&line, JSON_LOG_PREVIEW_MAX_CHARS)
                                ),
                            }
                        }
                        Err(e) => {
                            stream_delta_log_aggregator.flush();
                            warn!(
                                "Failed to parse sidecar output as JSON: {} - preview: {}",
                                e,
                                truncate_log_line(&line, 256)
                            );
                        }
                    }
                }
                Err(e) => {
                    stream_delta_log_aggregator.flush();
                    error!("Error reading from sidecar stdout: {}", e);
                    break;
                }
            }
        }
        stream_delta_log_aggregator.flush();
        if suppressed_non_protocol_lines > 0 {
            debug!(
                "Suppressed {} non-protocol sidecar stdout lines before stream closed",
                suppressed_non_protocol_lines
            );
        }

        transport_healthy.store(false, Ordering::SeqCst);
        fail_pending_responses(
            &pending_responses,
            "sidecar_disconnected",
            "Sidecar connection closed before the request completed",
        );
        info!("Stdout reader loop ended (sidecar closed stdout)");

        // Notify frontend that sidecar has disconnected
        let _ = app_handle.emit("sidecar-disconnected", ());
    }

    fn classify_sidecar_stderr_line(line: &str) -> SidecarStderrCategory {
        if line.contains("[Heartbeat]") {
            return SidecarStderrCategory::Heartbeat;
        }
        if line.starts_with("[LlmConfig] Loaded config")
            || line.starts_with("[LlmConfig] Search provider configured")
        {
            return SidecarStderrCategory::LlmConfig;
        }
        if line.starts_with("[DEBUG] stdin data chunk")
            || line.starts_with("[DEBUG] Received line:")
            || line.starts_with("[DEBUG] Parsed JSON")
            || line.starts_with("[DEBUG] Valid command, handling:")
        {
            return SidecarStderrCategory::IpcDebug;
        }
        if line.starts_with("[INFO]") || line.starts_with("[LOG]") {
            return SidecarStderrCategory::RoutineInfo;
        }
        SidecarStderrCategory::Important
    }

    fn is_noisy_sidecar_stderr_category(category: SidecarStderrCategory) -> bool {
        matches!(
            category,
            SidecarStderrCategory::Heartbeat
                | SidecarStderrCategory::LlmConfig
                | SidecarStderrCategory::IpcDebug
        )
    }

    fn sidecar_stderr_category_label(category: SidecarStderrCategory) -> &'static str {
        match category {
            SidecarStderrCategory::Heartbeat => "heartbeat",
            SidecarStderrCategory::LlmConfig => "llm-config",
            SidecarStderrCategory::IpcDebug => "ipc-debug",
            SidecarStderrCategory::RoutineInfo => "info",
            SidecarStderrCategory::Important => "important",
        }
    }

    fn is_likely_error_stderr_line(line: &str) -> bool {
        line.contains("[ERR]")
            || line.contains("[ERROR]")
            || line.to_ascii_lowercase().contains("error")
            || line.to_ascii_lowercase().contains("failed")
    }

    fn log_sidecar_stderr_line(line: &str, category: SidecarStderrCategory) {
        match category {
            SidecarStderrCategory::Heartbeat
            | SidecarStderrCategory::LlmConfig
            | SidecarStderrCategory::IpcDebug => {
                debug!(
                    "Sidecar[{}] {}",
                    Self::sidecar_stderr_category_label(category),
                    line
                );
            }
            SidecarStderrCategory::RoutineInfo => {
                info!("Sidecar {}", line);
            }
            SidecarStderrCategory::Important => {
                if Self::is_likely_error_stderr_line(line) {
                    error!("Sidecar {}", line);
                } else {
                    warn!("Sidecar {}", line);
                }
            }
        }
    }

    fn stderr_reader_loop(stderr: std::process::ChildStderr) {
        let reader = BufReader::new(stderr);
        let mut noisy_state: HashMap<SidecarStderrCategory, (Instant, usize)> = HashMap::new();

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let category = Self::classify_sidecar_stderr_line(&line);
                    if Self::is_noisy_sidecar_stderr_category(category) {
                        let now = Instant::now();
                        let entry = noisy_state
                            .entry(category)
                            .or_insert_with(|| (now - STDERR_NOISE_LOG_INTERVAL, 0));

                        if category == SidecarStderrCategory::Heartbeat {
                            if now.duration_since(entry.0) >= STDERR_NOISE_LOG_INTERVAL {
                                if entry.1 > 0 {
                                    debug!(
                                        "Sidecar[{}]: suppressed {} similar lines in last {}s",
                                        Self::sidecar_stderr_category_label(category),
                                        entry.1,
                                        STDERR_NOISE_LOG_INTERVAL.as_secs()
                                    );
                                    entry.1 = 0;
                                }
                                entry.0 = now;
                            }
                            // Fully silence heartbeat samples; keep only suppression summaries.
                            entry.1 += 1;
                            continue;
                        }

                        if now.duration_since(entry.0) < STDERR_NOISE_LOG_INTERVAL {
                            entry.1 += 1;
                            continue;
                        }

                        if entry.1 > 0 {
                            debug!(
                                "Sidecar[{}]: suppressed {} similar lines in last {}s",
                                Self::sidecar_stderr_category_label(category),
                                entry.1,
                                STDERR_NOISE_LOG_INTERVAL.as_secs()
                            );
                            entry.1 = 0;
                        }
                        entry.0 = now;
                    }

                    Self::log_sidecar_stderr_line(&line, category);
                }
                Err(e) => {
                    error!("Error reading from sidecar stderr: {}", e);
                    break;
                }
            }
        }

        for (category, (_last_logged, suppressed_count)) in noisy_state {
            if suppressed_count == 0 {
                continue;
            }
            debug!(
                "Sidecar[{}]: suppressed {} similar lines before stderr closed",
                Self::sidecar_stderr_category_label(category),
                suppressed_count
            );
        }
        debug!("Stderr reader loop ended");
    }

    fn write_stdin_line(&self, line: &str) -> Result<(), SidecarError> {
        if !self.transport_healthy.load(Ordering::SeqCst) {
            return Err(SidecarError::NotRunning);
        }
        let command_writer = self
            .command_writer
            .as_ref()
            .ok_or(SidecarError::NotRunning)?;
        write_json_line(command_writer, line)
    }

    fn try_attach_singleton_transport(
        app_data_dir: &str,
    ) -> Result<Option<AttachedSingletonTransport>, SidecarError> {
        #[cfg(unix)]
        {
            let socket_path = Self::sidecar_singleton_socket_path(app_data_dir);
            let stream = match UnixStream::connect(&socket_path) {
                Ok(stream) => stream,
                Err(error) => {
                    use std::io::ErrorKind;
                    if matches!(
                        error.kind(),
                        ErrorKind::NotFound
                            | ErrorKind::ConnectionRefused
                            | ErrorKind::ConnectionReset
                            | ErrorKind::AddrNotAvailable
                    ) {
                        return Ok(None);
                    }
                    warn!(
                        "Failed to connect sidecar singleton socket {}: {}",
                        socket_path, error
                    );
                    return Ok(None);
                }
            };

            let reader_stream = stream.try_clone()?;
            let writer: SharedCommandWriter = Arc::new(Mutex::new(CommandWriter::Unix(stream)));

            return Ok(Some(AttachedSingletonTransport {
                reader: Box::new(reader_stream),
                writer,
                descriptor: format!("unix:{}", socket_path),
            }));
        }

        #[cfg(windows)]
        {
            let socket_path = Self::sidecar_singleton_socket_path(app_data_dir);
            let mut last_busy_error: Option<std::io::Error> = None;

            for _ in 0..3 {
                match std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(&socket_path)
                {
                    Ok(pipe) => {
                        let reader_pipe = pipe.try_clone()?;
                        let writer: SharedCommandWriter =
                            Arc::new(Mutex::new(CommandWriter::WindowsPipe(pipe)));

                        return Ok(Some(AttachedSingletonTransport {
                            reader: Box::new(reader_pipe),
                            writer,
                            descriptor: format!("pipe:{}", socket_path),
                        }));
                    }
                    Err(error) => {
                        use std::io::ErrorKind;
                        if error.kind() == ErrorKind::NotFound || error.raw_os_error() == Some(2) {
                            return Ok(None);
                        }
                        if error.raw_os_error() == Some(231) {
                            // ERROR_PIPE_BUSY: retry briefly to avoid racing startup.
                            last_busy_error = Some(error);
                            std::thread::sleep(std::time::Duration::from_millis(40));
                            continue;
                        }
                        warn!(
                            "Failed to connect sidecar singleton pipe {}: {}",
                            socket_path, error
                        );
                        return Ok(None);
                    }
                }
            }

            if let Some(error) = last_busy_error {
                warn!(
                    "Sidecar singleton pipe remained busy after retries {}: {}",
                    socket_path, error
                );
            }

            return Ok(None);
        }

        #[cfg(all(not(unix), not(windows)))]
        {
            let _ = app_data_dir;
            Ok(None)
        }
    }

    fn try_attach_singleton_transport_with_retry(
        app_data_dir: &str,
        attempts: usize,
        delay: Duration,
    ) -> Result<Option<AttachedSingletonTransport>, SidecarError> {
        let attempts = attempts.max(1);
        for attempt in 0..attempts {
            if let Some(attached) = Self::try_attach_singleton_transport(app_data_dir)? {
                return Ok(Some(attached));
            }
            if attempt + 1 < attempts {
                thread::sleep(delay);
            }
        }
        Ok(None)
    }

    fn spawn_packaged_sidecar(
        packaged: &PackagedSidecar,
        app_dir: &str,
        app_data_dir: &str,
    ) -> Result<Child, SidecarError> {
        info!(
            "Resolved packaged sidecar binary: {}",
            packaged.executable.display()
        );

        let working_dir = packaged
            .node_entry
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .or_else(|| packaged.executable.parent().map(|path| path.to_path_buf()))
            .unwrap_or_else(|| std::path::PathBuf::from(app_dir));

        let use_node_runtime = Self::should_launch_packaged_sidecar_via_node();
        let can_launch_via_node = packaged.node_binary.is_some() && packaged.node_entry.is_some();

        if use_node_runtime && !can_launch_via_node {
            warn!(
                "COWORKANY_PACKAGED_SIDECAR_MODE=node requested, but bundled Node runtime is incomplete; falling back to compiled binary"
            );
        }

        let mut command = if use_node_runtime && can_launch_via_node {
            let node_binary = packaged
                .node_binary
                .as_ref()
                .expect("checked by can_launch_via_node");
            let node_entry = packaged
                .node_entry
                .as_ref()
                .expect("checked by can_launch_via_node");
            info!(
                "Launching packaged sidecar via bundled Node entry (COWORKANY_PACKAGED_SIDECAR_MODE=node): {}",
                node_entry.display()
            );
            let mut command = Command::new(node_binary);
            command.arg(node_entry);
            command
        } else {
            info!("Launching packaged sidecar via compiled binary");
            Command::new(&packaged.executable)
        };
        command
            .current_dir(&working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("COWORKANY_APP_DIR", app_dir)
            .env("COWORKANY_APP_DATA_DIR", app_data_dir);

        if let Some(bridge_script) = &packaged.bridge_script {
            command.env("COWORKANY_PLAYWRIGHT_BRIDGE", bridge_script);
        }
        if let Some(node_binary) = &packaged.node_binary {
            command.env("COWORKANY_BUNDLED_NODE", node_binary);
        }
        if let Some(playwright_browsers_path) = &packaged.playwright_browsers_path {
            command
                .env(
                    "COWORKANY_PLAYWRIGHT_BROWSERS_PATH",
                    playwright_browsers_path,
                )
                .env("PLAYWRIGHT_BROWSERS_PATH", playwright_browsers_path);
        }

        Self::apply_singleton_env(&mut command, app_data_dir);
        Self::apply_proxy_env(&mut command, app_data_dir);
        Self::apply_llm_env(&mut command, app_data_dir);
        Self::apply_chat_runtime_env(&mut command);
        command.spawn().map_err(SidecarError::from)
    }

    fn spawn_development_sidecar(app_dir: &str, app_data_dir: &str) -> Result<Child, SidecarError> {
        let sidecar_path = resolve_sidecar_entry_path().map_err(SidecarError::SendError)?;
        let sidecar_dir = sidecar_path.parent().unwrap().parent().unwrap();
        let tsx_path = sidecar_dir.join("node_modules/tsx/dist/cli.mjs");

        info!(
            "Resolved development sidecar entry: {}",
            sidecar_path.display()
        );

        // Prefer Node/tsx in development. Bun has been observed to delay
        // stdin delivery for desktop-spawned sidecar IPC, which surfaces as
        // `timed out waiting on channel` on the desktop side.
        if tsx_path.exists() {
            let mut node_cmd = Command::new("node");
            node_cmd
                .current_dir(sidecar_dir)
                .args([tsx_path.to_str().unwrap(), "src/main.ts"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("COWORKANY_APP_DIR", app_dir)
                .env("COWORKANY_APP_DATA_DIR", app_data_dir);
            Self::apply_singleton_env(&mut node_cmd, app_data_dir);
            Self::apply_proxy_env(&mut node_cmd, app_data_dir);
            Self::apply_llm_env(&mut node_cmd, app_data_dir);
            Self::apply_chat_runtime_env(&mut node_cmd);

            return node_cmd.spawn().map_err(SidecarError::from);
        }

        let cmd = if cfg!(target_os = "windows") {
            "npx.cmd"
        } else {
            "npx"
        };
        let mut npx_cmd = Command::new(cmd);
        npx_cmd
            .current_dir(sidecar_dir)
            .args(["tsx", "src/main.ts"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("COWORKANY_APP_DIR", app_dir)
            .env("COWORKANY_APP_DATA_DIR", app_data_dir);
        Self::apply_singleton_env(&mut npx_cmd, app_data_dir);
        Self::apply_proxy_env(&mut npx_cmd, app_data_dir);
        Self::apply_llm_env(&mut npx_cmd, app_data_dir);
        Self::apply_chat_runtime_env(&mut npx_cmd);

        npx_cmd
            .spawn()
            .or_else(|_| {
                let mut bun_cmd = Command::new("bun");
                bun_cmd
                    .current_dir(sidecar_dir)
                    .args(["run", "src/main.ts"])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .env("COWORKANY_APP_DIR", app_dir)
                    .env("COWORKANY_APP_DATA_DIR", app_data_dir);
                Self::apply_singleton_env(&mut bun_cmd, app_data_dir);
                Self::apply_proxy_env(&mut bun_cmd, app_data_dir);
                Self::apply_llm_env(&mut bun_cmd, app_data_dir);
                Self::apply_chat_runtime_env(&mut bun_cmd);
                bun_cmd.spawn()
            })
            .map_err(SidecarError::from)
    }

    fn resolve_packaged_sidecar(app_handle: &AppHandle) -> Option<PackagedSidecar> {
        let resource_dir = app_handle.path().resource_dir().ok()?;

        let executable = [
            resource_dir.join("sidecar/coworkany-sidecar.exe"),
            resource_dir.join("sidecar/coworkany-sidecar"),
            resource_dir.join("coworkany-sidecar.exe"),
            resource_dir.join("coworkany-sidecar"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists())?;

        let bridge_script = [
            resource_dir.join("sidecar/playwright-bridge.cjs"),
            resource_dir.join("playwright-bridge.cjs"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists());

        let node_entry = [
            resource_dir.join("sidecar/coworkany-sidecar-node.mjs"),
            resource_dir.join("coworkany-sidecar-node.mjs"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists());

        let node_binary = [
            resource_dir.join("sidecar/node/bin/node.exe"),
            resource_dir.join("sidecar/node/bin/node"),
            resource_dir.join("node/bin/node.exe"),
            resource_dir.join("node/bin/node"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists())
        .and_then(|candidate| {
            if Self::is_packaged_node_runtime_usable(&candidate) {
                Some(candidate)
            } else {
                None
            }
        });

        let playwright_browsers_path = [
            resource_dir.join("sidecar/ms-playwright"),
            resource_dir.join("ms-playwright"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists());

        Some(PackagedSidecar {
            executable,
            node_entry,
            bridge_script,
            node_binary,
            playwright_browsers_path,
        })
    }

    fn should_launch_packaged_sidecar_via_node() -> bool {
        matches!(
            std::env::var("COWORKANY_PACKAGED_SIDECAR_MODE")
                .ok()
                .map(|value| value.trim().to_ascii_lowercase())
                .as_deref(),
            Some("node")
        )
    }

    fn is_packaged_node_runtime_usable(node_binary: &Path) -> bool {
        #[cfg(target_os = "macos")]
        {
            let Some(bin_dir) = node_binary.parent() else {
                return false;
            };
            let direct_lib = bin_dir.join("libnode.141.dylib");
            if direct_lib.exists() {
                return true;
            }

            let fallback_lib_dir = bin_dir.join("../lib");
            if let Ok(entries) = fs::read_dir(&fallback_lib_dir) {
                for entry in entries.flatten() {
                    if let Some(file_name) = entry.file_name().to_str() {
                        if file_name.starts_with("libnode.") && file_name.ends_with(".dylib") {
                            return true;
                        }
                    }
                }
            }

            warn!(
                "Bundled Node runtime missing libnode*.dylib next to {}; disabling packaged Node launch path",
                node_binary.display()
            );
            return false;
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = node_binary;
            true
        }
    }

    fn first_non_empty_env(keys: &[&str]) -> Option<String> {
        keys.iter()
            .find_map(|key| std::env::var(key).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn resolve_bounded_env_usize(keys: &[&str], fallback: usize, min: usize, max: usize) -> usize {
        let parsed = Self::first_non_empty_env(keys).and_then(|value| value.parse::<usize>().ok());
        let value = parsed.unwrap_or(fallback);
        value.clamp(min, max)
    }

    fn apply_chat_runtime_env(command: &mut Command) {
        let guardrails = Self::first_non_empty_env(&["COWORKANY_ENABLE_GUARDRAILS"])
            .unwrap_or_else(|| "0".to_string());
        let output_guardrails = Self::first_non_empty_env(&["COWORKANY_ENABLE_OUTPUT_GUARDRAILS"])
            .unwrap_or_else(|| "0".to_string());
        let start_retry_count = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT"],
            5,
            0,
            10,
        );
        let start_retry_delay_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS"],
            1_000,
            100,
            30_000,
        );
        let start_timeout_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS"],
            12_000,
            2_000,
            30_000,
        );
        let forward_retry_count = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT"],
            5,
            0,
            10,
        );
        let forward_retry_delay_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_DELAY_MS"],
            1_000,
            100,
            30_000,
        );
        let startup_budget_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS"],
            90_000,
            15_000,
            120_000,
        );
        let generate_fallback_timeout_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS"],
            30_000,
            3_000,
            60_000,
        );
        let turn_timeout_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS"],
            180_000,
            30_000,
            180_000,
        );
        let stream_max_duration_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS"],
            180_000,
            30_000,
            180_000,
        );
        let post_assistant_max_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS"],
            30_000,
            5_000,
            90_000,
        );
        let mcp_toolsets_timeout_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS"],
            2_000,
            200,
            20_000,
        );
        let task_workflow_timeout_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS"],
            120_000,
            15_000,
            180_000,
        );
        let task_workflow_retry_count = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT"],
            5,
            0,
            5,
        );
        let task_workflow_retry_delay_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS"],
            1_000,
            100,
            10_000,
        );
        let task_execute_step_timeout_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS"],
            90_000,
            15_000,
            90_000,
        );
        let task_execute_step_retry_count = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT"],
            5,
            0,
            5,
        );
        let task_execute_step_retry_delay_ms = Self::resolve_bounded_env_usize(
            &["COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS"],
            1_000,
            100,
            10_000,
        );

        command
            .env("COWORKANY_ENABLE_GUARDRAILS", &guardrails)
            .env("COWORKANY_ENABLE_OUTPUT_GUARDRAILS", &output_guardrails)
            .env(
                "COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT",
                start_retry_count.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS",
                start_retry_delay_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS",
                start_timeout_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT",
                forward_retry_count.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_DELAY_MS",
                forward_retry_delay_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS",
                startup_budget_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS",
                generate_fallback_timeout_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS",
                turn_timeout_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS",
                stream_max_duration_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS",
                post_assistant_max_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS",
                mcp_toolsets_timeout_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS",
                task_workflow_timeout_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT",
                task_workflow_retry_count.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS",
                task_workflow_retry_delay_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS",
                task_execute_step_timeout_ms.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT",
                task_execute_step_retry_count.to_string(),
            )
            .env(
                "COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS",
                task_execute_step_retry_delay_ms.to_string(),
            );

        info!(
            "Sidecar chat runtime configured: guardrails={} output_guardrails={} start_retry={}x{}ms start_timeout_ms={} forward_retry={}x{}ms startup_budget_ms={} generate_fallback_timeout_ms={} turn_timeout_ms={} stream_max_ms={} post_assistant_max_ms={} mcp_toolsets_timeout_ms={} task_workflow_timeout_ms={} task_workflow_retry={}x{}ms task_execute_step_timeout_ms={} task_execute_step_retry={}x{}ms",
            guardrails,
            output_guardrails,
            start_retry_count,
            start_retry_delay_ms,
            start_timeout_ms,
            forward_retry_count,
            forward_retry_delay_ms,
            startup_budget_ms,
            generate_fallback_timeout_ms,
            turn_timeout_ms,
            stream_max_duration_ms,
            post_assistant_max_ms,
            mcp_toolsets_timeout_ms,
            task_workflow_timeout_ms,
            task_workflow_retry_count,
            task_workflow_retry_delay_ms,
            task_execute_step_timeout_ms,
            task_execute_step_retry_count,
            task_execute_step_retry_delay_ms
        );
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

    fn load_llm_config(app_data_dir: &str) -> Option<SidecarLlmConfig> {
        let path = std::path::Path::new(app_data_dir).join("llm-config.json");
        let raw = fs::read_to_string(path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    fn is_openai_compatible_provider(provider: &str) -> bool {
        matches!(
            provider,
            "openai" | "aiberm" | "nvidia" | "siliconflow" | "gemini" | "qwen" | "minimax"
                | "kimi"
        )
    }

    fn normalize_model_id(provider: &str, model: &str) -> String {
        const KNOWN_PREFIXES: [&str; 15] = [
            "anthropic/",
            "openai/",
            "openrouter/",
            "aiberm/",
            "nvidia/",
            "siliconflow/",
            "gemini/",
            "qwen/",
            "minimax/",
            "kimi/",
            "google/",
            "xai/",
            "groq/",
            "deepseek/",
            "mistral/",
        ];
        let normalized = model.trim();
        if KNOWN_PREFIXES
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
        {
            return normalized.to_string();
        }
        match provider {
            "anthropic" => format!("anthropic/{normalized}"),
            "openrouter" => format!("openrouter/{normalized}"),
            provider if Self::is_openai_compatible_provider(provider) => {
                format!("{provider}/{normalized}")
            }
            _ => format!("openai/{normalized}"),
        }
    }

    fn normalize_openai_compatible_model_for_provider(provider: &str, model: &str) -> String {
        let selected = model.trim();
        let without_openai_prefix = selected.strip_prefix("openai/").unwrap_or(selected).trim();

        if provider == "minimax" {
            let normalized = without_openai_prefix.to_ascii_lowercase();
            if normalized == "codex-minimax-m2.7" || normalized == "minimax-m2.7" {
                return "MiniMax-M2.7".to_string();
            }
        }

        without_openai_prefix.to_string()
    }

    fn resolve_openai_compatible_base_url_for_provider(
        provider: &str,
        base_url: &str,
        normalized_model: &str,
    ) -> String {
        let selected = base_url.trim().trim_end_matches('/');
        if provider == "minimax"
            && normalized_model.eq_ignore_ascii_case("MiniMax-M2.7")
            && selected.eq_ignore_ascii_case("https://api.minimax.chat/v1")
        {
            return "https://api.minimaxi.com/v1".to_string();
        }
        selected.to_string()
    }

    fn openai_compatible_default(provider: &str) -> Option<(&'static str, &'static str)> {
        match provider {
            "openai" => Some(("https://api.openai.com/v1", "gpt-4o")),
            "aiberm" => Some(("https://aiberm.com/v1", "gpt-5.3-codex")),
            "nvidia" => Some((
                "https://integrate.api.nvidia.com/v1",
                "meta/llama-3.1-70b-instruct",
            )),
            "siliconflow" => Some(("https://api.siliconflow.cn/v1", "Qwen/Qwen2.5-7B-Instruct")),
            "gemini" => Some((
                "https://generativelanguage.googleapis.com/v1beta/openai",
                "gemini-2.0-flash",
            )),
            "qwen" => Some((
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "qwen-plus",
            )),
            "minimax" => Some(("https://api.minimaxi.com/v1", "MiniMax-M2.7")),
            "kimi" => Some(("https://api.moonshot.cn/v1", "moonshot-v1-8k")),
            _ => None,
        }
    }

    fn apply_llm_env(command: &mut Command, app_data_dir: &str) {
        let Some(config) = Self::load_llm_config(app_data_dir) else {
            return;
        };

        let active_profile = config.profiles.as_ref().and_then(|profiles| {
            let preferred_id = config.active_profile_id.as_deref().map(str::trim);
            preferred_id
                .and_then(|id| {
                    profiles
                        .iter()
                        .find(|profile| profile.id.as_deref().map(str::trim) == Some(id))
                })
                .or_else(|| profiles.first())
        });

        let provider = active_profile
            .and_then(|profile| profile.provider.as_deref())
            .or(config.provider.as_deref())
            .map(str::trim)
            .filter(|provider| !provider.is_empty());
        let Some(provider) = provider else {
            return;
        };

        let provider_settings = match provider {
            "anthropic" => active_profile
                .and_then(|profile| profile.anthropic.as_ref())
                .or(config.anthropic.as_ref()),
            "openrouter" => active_profile
                .and_then(|profile| profile.openrouter.as_ref())
                .or(config.openrouter.as_ref()),
            "custom" => active_profile
                .and_then(|profile| profile.custom.as_ref())
                .or(config.custom.as_ref()),
            _ => active_profile
                .and_then(|profile| profile.openai.as_ref())
                .or(config.openai.as_ref()),
        };

        let Some(settings) = provider_settings else {
            return;
        };

        command.env("COWORKANY_LLM_CONFIG_PROVIDER", provider);

        let mut resolved_model: Option<String> = None;
        match provider {
            "anthropic" => {
                if let Some(api_key) = settings
                    .api_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    command.env("ANTHROPIC_API_KEY", api_key);
                }
                if let Some(model) = settings
                    .model
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    resolved_model = Some(Self::normalize_model_id(provider, model));
                }
            }
            "openrouter" => {
                if let Some(api_key) = settings
                    .api_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    command.env("OPENROUTER_API_KEY", api_key);
                }
                if let Some(model) = settings
                    .model
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    resolved_model = Some(Self::normalize_model_id(provider, model));
                }
            }
            "custom" => {
                let api_format = settings
                    .api_format
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("openai");
                command.env("COWORKANY_LLM_CUSTOM_API_FORMAT", api_format);

                if let Some(api_key) = settings
                    .api_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    if api_format.eq_ignore_ascii_case("anthropic") {
                        command.env("ANTHROPIC_API_KEY", api_key);
                    } else {
                        command.env("OPENAI_API_KEY", api_key);
                    }
                }
                if let Some(base_url) = settings
                    .base_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    command.env("OPENAI_BASE_URL", base_url);
                }
                if let Some(model) = settings
                    .model
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    let model_provider = if api_format.eq_ignore_ascii_case("anthropic") {
                        "anthropic"
                    } else {
                        "openai"
                    };
                    resolved_model = Some(Self::normalize_model_id(model_provider, model));
                }
            }
            openai_compatible_provider => {
                if let Some(api_key) = settings
                    .api_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    command.env("OPENAI_API_KEY", api_key);
                }
                if let Some((default_base_url, default_model)) =
                    Self::openai_compatible_default(openai_compatible_provider)
                {
                    let raw_base_url = settings
                        .base_url
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(default_base_url);
                    let model = settings
                        .model
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(default_model);
                    let normalized_model = Self::normalize_openai_compatible_model_for_provider(
                        openai_compatible_provider,
                        model,
                    );
                    let base_url = Self::resolve_openai_compatible_base_url_for_provider(
                        openai_compatible_provider,
                        raw_base_url,
                        &normalized_model,
                    );
                    command.env("OPENAI_BASE_URL", &base_url);
                    resolved_model = Some(Self::normalize_model_id(
                        openai_compatible_provider,
                        &normalized_model,
                    ));
                }
            }
        }

        if let Some(model_id) = resolved_model {
            command.env("COWORKANY_MODEL", &model_id);
            info!(
                "Sidecar LLM runtime configured from llm-config: provider={} model={}",
                provider, model_id
            );
        }
    }

    fn proxy_from_llm_config(app_data_dir: &str) -> Option<(String, Option<String>)> {
        let config = Self::load_llm_config(app_data_dir)?;
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
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Some((url, bypass))
    }

    fn sidecar_singleton_socket_path(app_data_dir: &str) -> String {
        let mut hasher = DefaultHasher::new();
        app_data_dir.hash(&mut hasher);
        let fingerprint = hasher.finish();

        #[cfg(target_os = "windows")]
        {
            return format!(r"\\.\pipe\coworkany-sidecar-{fingerprint:016x}");
        }

        #[cfg(not(target_os = "windows"))]
        {
            return std::env::temp_dir()
                .join(format!("coworkany-sidecar-{fingerprint:016x}.sock"))
                .to_string_lossy()
                .to_string();
        }
    }

    fn apply_singleton_env(command: &mut Command, app_data_dir: &str) {
        let socket_path = Self::sidecar_singleton_socket_path(app_data_dir);
        command
            .env("COWORKANY_SIDECAR_SINGLETON", "1")
            .env("COWORKANY_SIDECAR_SOCKET_PATH", socket_path);
    }

    fn apply_proxy_env(command: &mut Command, app_data_dir: &str) {
        let proxy_from_config = Self::proxy_from_llm_config(app_data_dir);
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
            // Populate both uppercase and lowercase to maximize runtime compatibility.
            command
                .env("COWORKANY_PROXY_URL", &proxy_url)
                .env("HTTPS_PROXY", &proxy_url)
                .env("https_proxy", &proxy_url)
                .env("HTTP_PROXY", &proxy_url)
                .env("http_proxy", &proxy_url)
                .env("ALL_PROXY", &proxy_url)
                .env("all_proxy", &proxy_url)
                .env("GLOBAL_AGENT_HTTPS_PROXY", &proxy_url)
                .env("GLOBAL_AGENT_HTTP_PROXY", &proxy_url)
                .env(
                    "COWORKANY_PROXY_SOURCE",
                    if proxy_from_config.is_some() {
                        "config"
                    } else {
                        "env"
                    },
                )
                .env("NODE_USE_ENV_PROXY", "1");

            let log_proxy = Self::sanitize_proxy_for_log(&proxy_url);
            if proxy_from_config.is_some() {
                info!("Sidecar proxy enabled from llm-config: {}", log_proxy);
            } else {
                info!("Sidecar proxy enabled from environment: {}", log_proxy);
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
}

// -------------------------------------------------------------------------
// Message classification
// -------------------------------------------------------------------------

enum SidecarMessageKind {
    TaskEvent,
    CanonicalStreamEvent,
    IpcResponse,
    IpcCommand,
    VoiceState,
}

fn is_json_object_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with('{') && trimmed.ends_with('}')
}

fn is_sidecar_metrics_line(line: &str) -> bool {
    line.trim_start().starts_with(SIDECAR_METRICS_LOG_PREFIX)
}

fn truncate_log_line(line: &str, max_chars: usize) -> String {
    let mut iter = line.chars();
    let preview: String = iter.by_ref().take(max_chars).collect();
    if iter.next().is_none() {
        return preview;
    }
    format!("{}…", preview)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StreamDeltaLogKey {
    message_type: String,
    task_id: Option<String>,
    turn_id: Option<String>,
    message_id: Option<String>,
    correlation_id: Option<String>,
    role: Option<String>,
    part_type: Option<String>,
}

#[derive(Debug, Clone)]
struct StreamDeltaLogEntry {
    key: StreamDeltaLogKey,
    delta: String,
}

#[derive(Debug, Default)]
struct StreamDeltaLogAggregator {
    current_key: Option<StreamDeltaLogKey>,
    chunk_count: usize,
    total_chars: usize,
    preview: String,
}

impl StreamDeltaLogAggregator {
    fn push(&mut self, entry: StreamDeltaLogEntry) {
        if self.current_key.as_ref() != Some(&entry.key) {
            self.flush();
            self.current_key = Some(entry.key);
        }

        self.chunk_count += 1;
        self.total_chars += entry.delta.chars().count();

        let preview_chars = self.preview.chars().count();
        if preview_chars < STREAM_DELTA_LOG_PREVIEW_MAX_CHARS {
            let remaining = STREAM_DELTA_LOG_PREVIEW_MAX_CHARS - preview_chars;
            self.preview
                .push_str(&entry.delta.chars().take(remaining).collect::<String>());
        }
    }

    fn flush(&mut self) {
        let Some(key) = self.current_key.as_ref() else {
            return;
        };

        let escaped_preview = self.preview.replace('\r', "\\r").replace('\n', "\\n");
        debug!(
            "Received stream text from sidecar: type={} taskId={} turnId={} messageId={} correlationId={} role={} partType={} chunks={} chars={} preview=\"{}\"",
            key.message_type,
            key.task_id.as_deref().unwrap_or("-"),
            key.turn_id.as_deref().unwrap_or("-"),
            key.message_id.as_deref().unwrap_or("-"),
            key.correlation_id.as_deref().unwrap_or("-"),
            key.role.as_deref().unwrap_or("-"),
            key.part_type.as_deref().unwrap_or("-"),
            self.chunk_count,
            self.total_chars,
            truncate_log_line(&escaped_preview, STREAM_DELTA_LOG_PREVIEW_MAX_CHARS)
        );
        self.reset();
    }

    fn reset(&mut self) {
        self.current_key = None;
        self.chunk_count = 0;
        self.total_chars = 0;
        self.preview.clear();
    }
}

fn value_as_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|node| node.as_str())
        .map(|node| node.to_string())
}

fn extract_stream_delta_log_entry(message: &serde_json::Value) -> Option<StreamDeltaLogEntry> {
    let message_type = value_as_string(message.get("type"))?;

    if message_type == "TEXT_DELTA" {
        let payload = message.get("payload")?;
        let delta = value_as_string(
            payload
                .get("delta")
                .or_else(|| payload.get("text"))
                .or_else(|| payload.get("content")),
        )
        .unwrap_or_default();
        return Some(StreamDeltaLogEntry {
            key: StreamDeltaLogKey {
                message_type,
                task_id: value_as_string(message.get("taskId")),
                turn_id: value_as_string(payload.get("turnId")),
                message_id: value_as_string(payload.get("messageId")),
                correlation_id: value_as_string(payload.get("correlationId")),
                role: value_as_string(payload.get("role")),
                part_type: None,
            },
            delta,
        });
    }

    if message_type == "canonical_message_delta" {
        let payload = message.get("payload")?;
        let part = payload.get("part");
        return Some(StreamDeltaLogEntry {
            key: StreamDeltaLogKey {
                message_type,
                task_id: value_as_string(payload.get("taskId"))
                    .or_else(|| value_as_string(message.get("taskId"))),
                turn_id: value_as_string(payload.get("turnId")),
                message_id: value_as_string(payload.get("id")),
                correlation_id: value_as_string(payload.get("correlationId")),
                role: value_as_string(payload.get("role")),
                part_type: value_as_string(part.and_then(|node| node.get("type"))),
            },
            delta: value_as_string(part.and_then(|node| node.get("delta"))).unwrap_or_default(),
        });
    }

    None
}

fn classify_sidecar_message(message: &serde_json::Value) -> Option<SidecarMessageKind> {
    let msg_type = message.get("type")?.as_str()?;
    if msg_type == "voice_state" {
        return Some(SidecarMessageKind::VoiceState);
    }
    if msg_type == "canonical_message" || msg_type == "canonical_message_delta" {
        return Some(SidecarMessageKind::CanonicalStreamEvent);
    }
    if msg_type.ends_with("_response") {
        return Some(SidecarMessageKind::IpcResponse);
    }
    if msg_type == "request_effect"
        || msg_type == "propose_patch"
        || msg_type == "apply_patch"
        || msg_type == "reject_patch"
        || msg_type == "read_file"
        || msg_type == "list_dir"
        || msg_type == "exec_shell"
        || msg_type == "capture_screen"
        || msg_type == "get_policy_config"
        || msg_type == "register_agent_identity"
        || msg_type == "record_agent_delegation"
        || msg_type == "report_mcp_gateway_decision"
        || msg_type == "report_runtime_security_alert"
    {
        return Some(SidecarMessageKind::IpcCommand);
    }
    Some(SidecarMessageKind::TaskEvent)
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum ProtocolPatchOperation {
    Create,
    Modify,
    Delete,
    Rename,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProtocolDiffHunk {
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
    content: String,
    header: Option<String>,
    context: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProtocolFilePatch {
    id: String,
    timestamp: String,
    file_path: String,
    operation: ProtocolPatchOperation,
    new_file_path: Option<String>,
    hunks: Vec<ProtocolDiffHunk>,
    full_content: Option<String>,
    additions: usize,
    deletions: usize,
    description: Option<String>,
}

fn convert_patch_operation(operation: ProtocolPatchOperation) -> PatchOperation {
    match operation {
        ProtocolPatchOperation::Create => PatchOperation::Create,
        ProtocolPatchOperation::Modify => PatchOperation::Modify,
        ProtocolPatchOperation::Delete => PatchOperation::Delete,
        ProtocolPatchOperation::Rename => PatchOperation::Rename,
    }
}

fn convert_hunks(hunks: Vec<ProtocolDiffHunk>) -> Vec<DiffHunk> {
    hunks
        .into_iter()
        .map(|hunk| DiffHunk {
            old_start: hunk.old_start,
            old_lines: hunk.old_lines,
            new_start: hunk.new_start,
            new_lines: hunk.new_lines,
            content: hunk.content,
            header: hunk.header.unwrap_or_default(),
            context: hunk.context,
        })
        .collect()
}

fn build_file_patch(patch: ProtocolFilePatch) -> FilePatch {
    FilePatch {
        id: patch.id,
        timestamp: patch.timestamp,
        file_path: patch.file_path,
        operation: convert_patch_operation(patch.operation),
        new_file_path: patch.new_file_path,
        hunks: convert_hunks(patch.hunks),
        full_content: patch.full_content,
        additions: patch.additions,
        deletions: patch.deletions,
        description: patch.description,
    }
}

fn apply_patch_to_content(original: &str, patch: FilePatch) -> Result<String, String> {
    apply_patch_diff(original, &patch).map_err(|e| e.to_string())
}

fn build_effect_request_for_patch(operation: PatchOperation, path: &str) -> EffectRequest {
    EffectRequest {
        id: Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        effect_type: EffectType::FilesystemWrite,
        source: EffectSource::Agent,
        source_id: None,
        payload: EffectPayload {
            path: Some(path.to_string()),
            content: None,
            operation: Some(match operation {
                PatchOperation::Delete => "delete".to_string(),
                PatchOperation::Rename => "rename".to_string(),
                PatchOperation::Create => "create".to_string(),
                PatchOperation::Modify => "modify".to_string(),
            }),
            command: None,
            args: None,
            cwd: None,
            url: None,
            method: None,
            headers: None,
            description: Some(format!("patch {}", operation_as_str(&operation))),
        },
        context: Some(EffectContext {
            task_id: None,
            tool_name: Some("apply_patch".to_string()),
            reasoning: Some("Patch apply requires filesystem write".to_string()),
        }),
        scope: Some(EffectScope::default()),
    }
}

fn operation_as_str(operation: &PatchOperation) -> &'static str {
    match operation {
        PatchOperation::Create => "create",
        PatchOperation::Modify => "modify",
        PatchOperation::Delete => "delete",
        PatchOperation::Rename => "rename",
    }
}

fn collect_list_dir_entries(
    root: &Path,
    recursive: bool,
    max_depth: usize,
    include_hidden: bool,
    depth: usize,
    out: &mut Vec<serde_json::Value>,
) -> Result<(), String> {
    let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry_result in entries {
        let entry = entry_result.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let is_directory = metadata.is_dir();
        let modified = metadata.modified().ok().map(|timestamp| {
            let dt: chrono::DateTime<chrono::Utc> = timestamp.into();
            dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        });
        out.push(json!({
            "name": file_name,
            "path": path.to_string_lossy().to_string(),
            "isDirectory": is_directory,
            "size": metadata.is_file().then_some(metadata.len()),
            "modified": modified,
        }));

        if recursive && is_directory && depth < max_depth {
            collect_list_dir_entries(&path, recursive, max_depth, include_hidden, depth + 1, out)?;
        }
    }
    Ok(())
}

fn capture_primary_screen_base64() -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine as _;
    use screenshots::Screen;
    use std::io::Cursor;

    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen = screens.first().ok_or("No screen found")?;
    let image = screen.capture().map_err(|e| e.to_string())?;
    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, image::ImageOutputFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(BASE64.encode(buffer.get_ref()))
}

fn handle_sidecar_command(
    message: serde_json::Value,
    app_handle: AppHandle,
    command_writer: SharedCommandWriter,
) {
    let msg_type = match message.get("type").and_then(|v| v.as_str()) {
        Some(value) => value.to_string(),
        None => return,
    };

    match msg_type.as_str() {
        "request_effect" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                let request: Option<EffectRequest> = message
                    .get("payload")
                    .and_then(|p| p.get("request"))
                    .and_then(|r| serde_json::from_value(r.clone()).ok());

                let Some(request) = request else {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "request_effect_response",
                            "invalid_request",
                        ),
                    );
                    return;
                };
                let task_id = request
                    .context
                    .as_ref()
                    .and_then(|context| context.task_id.clone());
                let effect_type = request.effect_type.clone();

                let state = app_handle.state::<PolicyEngineState>();
                let result = policy_commands::request_effect(request.clone(), state).await;

                let response = match result {
                    Ok(res) => res,
                    Err(err) => EffectResponse {
                        request_id: request.id.clone(),
                        timestamp: chrono::Utc::now()
                            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        approved: false,
                        approval_type: None,
                        expires_at: None,
                        denial_reason: Some(err),
                        denial_code: Some("policy_error".to_string()),
                        modified_scope: None,
                    },
                };

                let payload = json!({
                    "response": response,
                    "taskId": task_id,
                    "effectType": effect_type,
                });
                let response_msg = json!({
                    "type": "request_effect_response",
                    "commandId": command_id,
                    "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    "payload": payload
                });

                // Surface the same IPC response to the renderer so task state can
                // immediately reflect awaiting confirmations (no sidecar round-trip needed).
                if let Err(error) = app_handle.emit("ipc-response", response_msg.clone()) {
                    warn!(
                        "Failed to emit ipc-response for request_effect_response: {}",
                        error
                    );
                }

                send_raw(&command_writer, response_msg);
            });
        }
        "propose_patch" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                let payload = message.get("payload").cloned().unwrap_or_default();
                let patch_value = payload.get("patch").cloned().unwrap_or_default();
                let patch: Option<ProtocolFilePatch> =
                    serde_json::from_value(patch_value.clone()).ok();

                let Some(patch) = patch else {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "propose_patch_response",
                            "invalid_patch",
                        ),
                    );
                    return;
                };

                let source_path = patch.file_path.clone();
                let target_path = patch
                    .new_file_path
                    .clone()
                    .unwrap_or_else(|| patch.file_path.clone());
                let stage_path = if matches!(patch.operation, ProtocolPatchOperation::Rename) {
                    source_path.clone()
                } else {
                    target_path.clone()
                };

                let patch_override = build_file_patch(patch.clone());
                let content_result = if let Some(full_content) = patch.full_content.clone() {
                    Ok(full_content)
                } else if matches!(patch.operation, ProtocolPatchOperation::Delete) {
                    Ok(String::new())
                } else if matches!(patch.operation, ProtocolPatchOperation::Rename) {
                    fs::read_to_string(&source_path).map_err(|e| e.to_string())
                } else {
                    let original_content = fs::read_to_string(&source_path).unwrap_or_default();
                    apply_patch_to_content(&original_content, patch_override.clone())
                };

                let content = match content_result {
                    Ok(value) => value,
                    Err(err) => {
                        send_raw(
                            &command_writer,
                            build_error_response(&command_id, "propose_patch_response", &err),
                        );
                        return;
                    }
                };

                let state = app_handle.state::<ShadowFsState>();
                let result = shadow_fs::stage_file_with_patch(
                    state,
                    stage_path,
                    content,
                    Some(patch_override),
                )
                .await;

                let response_msg = match result {
                    Ok(entry) => json!({
                        "type": "propose_patch_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "patchId": entry.id,
                            "shadowPath": entry.shadow_path.to_string_lossy().to_string()
                        }
                    }),
                    Err(err) => build_error_response(&command_id, "propose_patch_response", &err),
                };

                send_raw(&command_writer, response_msg);
            });
        }
        "apply_patch" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                let payload = message.get("payload").cloned().unwrap_or_default();
                let patch_id = payload.get("patchId").and_then(|v| v.as_str());
                let create_backup = payload
                    .get("createBackup")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                let Some(patch_id) = patch_id else {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "apply_patch_response",
                            "missing_patch_id",
                        ),
                    );
                    return;
                };

                let shadow_state = app_handle.state::<ShadowFsState>();
                let (patch_operation, patch_path) = {
                    let guard = shadow_state.lock().await;
                    let shadow_fs = guard.as_ref();
                    let entry = shadow_fs.and_then(|fs| fs.get(patch_id));
                    let operation = entry.and_then(|e| e.patch.as_ref()).map(|p| p.operation);
                    let path = entry.map(|e| e.original_path.to_string_lossy().to_string());
                    (operation, path)
                };

                if let (Some(operation), Some(path)) = (patch_operation, patch_path.clone()) {
                    if matches!(operation, PatchOperation::Delete | PatchOperation::Rename) {
                        let request = build_effect_request_for_patch(operation, &path);
                        let state = app_handle.state::<PolicyEngineState>();
                        let policy = policy_commands::request_effect(request, state).await;

                        if let Ok(response) = &policy {
                            if !response.approved {
                                let response_msg = json!({
                                    "type": "apply_patch_response",
                                    "commandId": command_id,
                                    "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                                    "payload": {
                                        "patchId": patch_id,
                                        "success": false,
                                        "filePath": path,
                                        "error": response.denial_reason.clone().unwrap_or_else(|| "awaiting_confirmation".to_string())
                                    }
                                });
                                send_raw(&command_writer, response_msg);
                                return;
                            }
                        }
                    }
                }

                let result =
                    shadow_fs::apply_patch(shadow_state, patch_id.to_string(), create_backup).await;

                let response_msg = match &result {
                    Ok(apply_result) => json!({
                        "type": "apply_patch_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "patchId": patch_id,
                            "success": apply_result.success,
                            "filePath": apply_result.file_path,
                            "appliedAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                            "backupPath": apply_result.backup_path,
                            "error": apply_result.error,
                        }
                    }),
                    Err(err) => build_error_response(&command_id, "apply_patch_response", err),
                };

                if let Ok(apply_result) = &result {
                    if apply_result.success {
                        let action = match patch_operation {
                            Some(PatchOperation::Delete) => "delete",
                            Some(PatchOperation::Rename) => "rename",
                            Some(PatchOperation::Create) => "create",
                            Some(PatchOperation::Modify) => "modify",
                            None => "apply",
                        };

                        let audit = json!({
                            "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                            "action": action,
                            "id": patch_id,
                            "originalPath": patch_path,
                            "targetPath": apply_result.file_path,
                            "status": "applied"
                        });
                        let _ = app_handle.emit("audit-event", audit);
                    }
                }

                send_raw(&command_writer, response_msg);
            });
        }
        "reject_patch" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                let payload = message.get("payload").cloned().unwrap_or_default();
                let patch_id = payload.get("patchId").and_then(|v| v.as_str());

                let Some(patch_id) = patch_id else {
                    return;
                };

                let state = app_handle.state::<ShadowFsState>();
                let _ = shadow_fs::reject_patch(state, patch_id.to_string()).await;

                let response_msg = json!({
                    "type": "reject_patch_response",
                    "commandId": command_id,
                    "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    "payload": {
                        "patchId": patch_id
                    }
                });

                send_raw(&command_writer, response_msg);
            });
        }
        "read_file" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let payload = message.get("payload").cloned().unwrap_or_default();
                let path = payload
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let encoding = payload
                    .get("encoding")
                    .and_then(|v| v.as_str())
                    .unwrap_or("utf-8")
                    .to_lowercase();
                let max_bytes = payload
                    .get("maxBytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(u64::MAX);

                if path.is_empty() {
                    send_raw(
                        &command_writer,
                        build_error_response(&command_id, "read_file_response", "missing_path"),
                    );
                    return;
                }
                if encoding != "utf-8" && encoding != "utf8" {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "read_file_response",
                            "unsupported_encoding",
                        ),
                    );
                    return;
                }

                let response_msg = match fs::read(&path) {
                    Ok(content_bytes) => {
                        let truncated = content_bytes.len() as u64 > max_bytes;
                        let visible = if truncated {
                            &content_bytes[..max_bytes as usize]
                        } else {
                            &content_bytes[..]
                        };
                        let content = String::from_utf8_lossy(visible).to_string();
                        json!({
                            "type": "read_file_response",
                            "commandId": command_id,
                            "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                            "payload": {
                                "success": true,
                                "content": content,
                                "truncated": truncated,
                            }
                        })
                    }
                    Err(err) => {
                        build_error_response(&command_id, "read_file_response", &err.to_string())
                    }
                };
                send_raw(&command_writer, response_msg);
            });
        }
        "list_dir" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let payload = message.get("payload").cloned().unwrap_or_default();
                let path = payload
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let recursive = payload
                    .get("recursive")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let max_depth = payload
                    .get("maxDepth")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3) as usize;
                let include_hidden = payload
                    .get("includeHidden")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                if path.is_empty() {
                    send_raw(
                        &command_writer,
                        build_error_response(&command_id, "list_dir_response", "missing_path"),
                    );
                    return;
                }

                let mut entries = Vec::new();
                let response_msg = match collect_list_dir_entries(
                    Path::new(&path),
                    recursive,
                    max_depth,
                    include_hidden,
                    0,
                    &mut entries,
                ) {
                    Ok(()) => json!({
                        "type": "list_dir_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "success": true,
                            "entries": entries,
                        }
                    }),
                    Err(err) => build_error_response(&command_id, "list_dir_response", &err),
                };
                send_raw(&command_writer, response_msg);
            });
        }
        "exec_shell" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let payload = message.get("payload").cloned().unwrap_or_default();
                let command = payload
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let args = payload
                    .get("args")
                    .and_then(|v| v.as_array())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(|s| s.to_string()))
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default();
                let cwd = payload
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string());
                let timeout_ms = payload
                    .get("timeout")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(30_000);
                let stdin = payload
                    .get("stdin")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string());
                let env_vars = payload
                    .get("env")
                    .and_then(|v| v.as_object())
                    .map(|object| {
                        object
                            .iter()
                            .filter_map(|(key, value)| {
                                value.as_str().map(|s| (key.clone(), s.to_string()))
                            })
                            .collect::<Vec<(String, String)>>()
                    })
                    .unwrap_or_default();

                if command.is_empty() {
                    send_raw(
                        &command_writer,
                        build_error_response(&command_id, "exec_shell_response", "missing_command"),
                    );
                    return;
                }

                let mut process = TokioCommand::new(&command);
                process.args(args);
                process.stdin(Stdio::piped());
                process.stdout(Stdio::piped());
                process.stderr(Stdio::piped());
                process.kill_on_drop(true);
                if let Some(workdir) = cwd {
                    process.current_dir(workdir);
                }
                for (key, value) in env_vars {
                    process.env(key, value);
                }

                let mut child = match process.spawn() {
                    Ok(child) => child,
                    Err(err) => {
                        send_raw(
                            &command_writer,
                            build_error_response(
                                &command_id,
                                "exec_shell_response",
                                &err.to_string(),
                            ),
                        );
                        return;
                    }
                };

                if let Some(input) = stdin {
                    if let Some(mut stdin_pipe) = child.stdin.take() {
                        if let Err(err) = stdin_pipe.write_all(input.as_bytes()).await {
                            send_raw(
                                &command_writer,
                                build_error_response(
                                    &command_id,
                                    "exec_shell_response",
                                    &err.to_string(),
                                ),
                            );
                            return;
                        }
                    }
                }

                let output = tokio::time::timeout(
                    Duration::from_millis(timeout_ms),
                    child.wait_with_output(),
                )
                .await;

                let response_msg = match output {
                    Ok(Ok(output)) => json!({
                        "type": "exec_shell_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "success": output.status.success(),
                            "exitCode": output.status.code(),
                            "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
                            "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
                            "timedOut": false,
                        }
                    }),
                    Ok(Err(err)) => {
                        build_error_response(&command_id, "exec_shell_response", &err.to_string())
                    }
                    Err(_) => json!({
                        "type": "exec_shell_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "success": false,
                            "error": "command_timeout",
                            "timedOut": true,
                        }
                    }),
                };
                send_raw(&command_writer, response_msg);
            });
        }
        "capture_screen" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let response_msg = match capture_primary_screen_base64() {
                    Ok(image_base64) => json!({
                        "type": "capture_screen_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "success": true,
                            "imageBase64": image_base64,
                        }
                    }),
                    Err(err) => build_error_response(&command_id, "capture_screen_response", &err),
                };
                send_raw(&command_writer, response_msg);
            });
        }
        "get_policy_config" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let state = app_handle.state::<PolicyEngineState>();
                let config = {
                    let engine = state.engine.lock().await;
                    engine.config.clone()
                };
                let default_policies = config
                    .default_policies
                    .iter()
                    .map(|(effect, policy)| {
                        (
                            effect.as_str().to_string(),
                            format!("{:?}", policy).to_lowercase(),
                        )
                    })
                    .collect::<HashMap<String, String>>();

                let response_msg = json!({
                    "type": "get_policy_config_response",
                    "commandId": command_id,
                    "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    "payload": {
                        "defaultPolicies": default_policies,
                        "allowlists": config.allowlists,
                        "blocklists": config.blocklists,
                    }
                });
                send_raw(&command_writer, response_msg);
            });
        }
        "register_agent_identity" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let payload = message.get("payload").cloned().unwrap_or_default();
                let identity = payload
                    .get("identity")
                    .and_then(|v| serde_json::from_value(v.clone()).ok());

                let Some(identity) = identity else {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "register_agent_identity_response",
                            "invalid_identity",
                        ),
                    );
                    return;
                };

                let state = app_handle.state::<PolicyEngineState>();
                let result = policy_commands::register_agent_identity(identity, state).await;

                let response_msg = match result {
                    Ok(_) => json!({
                        "type": "register_agent_identity_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "success": true,
                            "sessionId": message.get("payload").and_then(|p| p.get("identity")).and_then(|i| i.get("sessionId")).cloned().unwrap_or_default()
                        }
                    }),
                    Err(err) => {
                        build_error_response(&command_id, "register_agent_identity_response", &err)
                    }
                };

                send_raw(&command_writer, response_msg);
            });
        }
        "record_agent_delegation" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let payload = message.get("payload").cloned().unwrap_or_default();
                let delegation_value = payload.get("delegation").cloned().unwrap_or_default();
                let delegation = serde_json::from_value(delegation_value.clone()).ok();
                let parent_session = delegation_value
                    .get("parentSessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let child_session = delegation_value
                    .get("childSessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                let Some(delegation) = delegation else {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "record_agent_delegation_response",
                            "invalid_delegation",
                        ),
                    );
                    return;
                };

                let state = app_handle.state::<PolicyEngineState>();
                let result = policy_commands::record_agent_delegation(delegation, state).await;

                let response_msg = match result {
                    Ok(_) => json!({
                        "type": "record_agent_delegation_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": {
                            "success": true,
                            "parentSessionId": parent_session,
                            "childSessionId": child_session
                        }
                    }),
                    Err(err) => {
                        build_error_response(&command_id, "record_agent_delegation_response", &err)
                    }
                };

                send_raw(&command_writer, response_msg);
            });
        }
        "report_mcp_gateway_decision" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let payload = message.get("payload").cloned().unwrap_or_default();
                let decision = payload
                    .get("decision")
                    .and_then(|v| serde_json::from_value(v.clone()).ok());

                let Some(decision) = decision else {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "report_mcp_gateway_decision_response",
                            "invalid_decision",
                        ),
                    );
                    return;
                };

                let state = app_handle.state::<PolicyEngineState>();
                let result = policy_commands::report_mcp_gateway_decision(decision, state).await;

                let response_msg = match result {
                    Ok(_) => json!({
                        "type": "report_mcp_gateway_decision_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": { "success": true }
                    }),
                    Err(err) => build_error_response(
                        &command_id,
                        "report_mcp_gateway_decision_response",
                        &err,
                    ),
                };

                send_raw(&command_writer, response_msg);
            });
        }
        "report_runtime_security_alert" => {
            tauri::async_runtime::spawn(async move {
                let command_id = message
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let payload = message.get("payload").cloned().unwrap_or_default();
                let alert = payload
                    .get("alert")
                    .and_then(|v| serde_json::from_value(v.clone()).ok());

                let Some(alert) = alert else {
                    send_raw(
                        &command_writer,
                        build_error_response(
                            &command_id,
                            "report_runtime_security_alert_response",
                            "invalid_alert",
                        ),
                    );
                    return;
                };

                let state = app_handle.state::<PolicyEngineState>();
                let result = policy_commands::report_runtime_security_alert(alert, state).await;

                let response_msg = match result {
                    Ok(_) => json!({
                        "type": "report_runtime_security_alert_response",
                        "commandId": command_id,
                        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "payload": { "success": true }
                    }),
                    Err(err) => build_error_response(
                        &command_id,
                        "report_runtime_security_alert_response",
                        &err,
                    ),
                };

                send_raw(&command_writer, response_msg);
            });
        }
        _ => {
            warn!("Unhandled sidecar command: {}", msg_type);
        }
    }
}

fn write_json_line(command_writer: &SharedCommandWriter, line: &str) -> Result<(), SidecarError> {
    let mut guard = command_writer
        .lock()
        .map_err(|e| SidecarError::SendError(e.to_string()))?;
    writeln!(&mut *guard, "{}", line).map_err(|e| SidecarError::SendError(e.to_string()))?;
    guard
        .flush()
        .map_err(|e| SidecarError::SendError(e.to_string()))?;
    Ok(())
}

fn send_raw(command_writer: &SharedCommandWriter, message: serde_json::Value) {
    if let Ok(line) = serde_json::to_string(&message) {
        if let Err(error) = write_json_line(command_writer, &line) {
            error!(
                "Failed to write sidecar response to transport bridge: {}",
                error
            );
        }
    }
}

fn build_error_response(command_id: &str, response_type: &str, error: &str) -> serde_json::Value {
    json!({
        "type": response_type,
        "commandId": command_id,
        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "payload": {
            "success": false,
            "error": error
        }
    })
}

fn fail_pending_responses(
    pending_responses: &Arc<Mutex<HashMap<String, Sender<serde_json::Value>>>>,
    error_code: &str,
    error_message: &str,
) {
    let pending = match pending_responses.lock() {
        Ok(mut guard) => std::mem::take(&mut *guard),
        Err(error) => {
            error!("Failed to lock pending sidecar responses: {}", error);
            return;
        }
    };

    for (command_id, waiter) in pending {
        let _ = waiter.send(json!({
            "type": "transport_error_response",
            "commandId": command_id,
            "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "payload": {
                "success": false,
                "error": error_code,
                "details": error_message,
            }
        }));
    }
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}

pub fn forward_effect_response_to_sidecar(
    state: &SidecarState,
    response: &EffectResponse,
) -> Result<(), String> {
    let manager = state
        .0
        .lock()
        .map_err(|e| format!("failed to lock sidecar state: {}", e))?;

    manager
        .send_raw_command(json!({
            "id": Uuid::new_v4().to_string(),
            "type": "request_effect_response",
            "commandId": Uuid::new_v4().to_string(),
            "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "payload": {
                "response": response
            }
        }))
        .map_err(|e| e.to_string())
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ============================================================================
// Thread-safe wrapper for Tauri state
// ============================================================================

pub struct SidecarState(pub Arc<Mutex<SidecarManager>>);

impl SidecarState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(SidecarManager::new())))
    }
}

impl Default for SidecarState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_sidecar_message, extract_stream_delta_log_entry, is_json_object_line,
        is_sidecar_metrics_line,
        truncate_log_line, SidecarManager, SidecarMessageKind,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::fs;
    use std::io::{BufRead, BufReader};
    #[cfg(unix)]
    use std::os::unix::net::UnixListener;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::{LazyLock, Mutex};
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn unique_temp_dir(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis();
        std::env::temp_dir().join(format!("coworkany-{name}-{}-{millis}", std::process::id()))
    }

    fn command_env_map(command: &Command) -> HashMap<String, String> {
        command
            .get_envs()
            .filter_map(|(key, value)| {
                value.map(|value| {
                    (
                        key.to_string_lossy().to_string(),
                        value.to_string_lossy().to_string(),
                    )
                })
            })
            .collect()
    }

    fn snapshot_env(keys: &[&str]) -> Vec<(String, Option<OsString>)> {
        keys.iter()
            .map(|key| (key.to_string(), std::env::var_os(key)))
            .collect()
    }

    fn restore_env(snapshot: Vec<(String, Option<OsString>)>) {
        for (key, value) in snapshot {
            match value {
                Some(v) => std::env::set_var(key, v),
                None => std::env::remove_var(key),
            }
        }
    }

    #[test]
    fn apply_proxy_env_uses_llm_config_proxy_settings() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let app_data_dir = unique_temp_dir("sidecar-proxy-config");
        fs::create_dir_all(&app_data_dir).expect("create temp app data dir");
        fs::write(
            app_data_dir.join("llm-config.json"),
            r#"{
                "proxy": {
                    "enabled": true,
                    "url": "http://127.0.0.1:7890",
                    "bypass": "localhost,127.0.0.1,::1,.local"
                }
            }"#,
        )
        .expect("write llm-config");

        let original_https_proxy = std::env::var_os("HTTPS_PROXY");
        let original_coworkany_proxy = std::env::var_os("COWORKANY_PROXY_URL");
        std::env::remove_var("HTTPS_PROXY");
        std::env::remove_var("COWORKANY_PROXY_URL");

        let mut command = Command::new("env");
        SidecarManager::apply_proxy_env(&mut command, app_data_dir.to_str().expect("utf8 path"));
        let envs = command_env_map(&command);

        assert_eq!(
            envs.get("COWORKANY_PROXY_URL"),
            Some(&"http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            envs.get("HTTPS_PROXY"),
            Some(&"http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            envs.get("http_proxy"),
            Some(&"http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            envs.get("GLOBAL_AGENT_HTTPS_PROXY"),
            Some(&"http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_PROXY_SOURCE"),
            Some(&"config".to_string())
        );
        assert_eq!(envs.get("NODE_USE_ENV_PROXY"), Some(&"1".to_string()));
        assert_eq!(
            envs.get("NO_PROXY"),
            Some(&"localhost,127.0.0.1,::1,.local".to_string())
        );

        match original_https_proxy {
            Some(value) => std::env::set_var("HTTPS_PROXY", value),
            None => std::env::remove_var("HTTPS_PROXY"),
        }
        match original_coworkany_proxy {
            Some(value) => std::env::set_var("COWORKANY_PROXY_URL", value),
            None => std::env::remove_var("COWORKANY_PROXY_URL"),
        }

        let _ = fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn apply_chat_runtime_env_sets_safe_defaults() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let keys = [
            "COWORKANY_ENABLE_GUARDRAILS",
            "COWORKANY_ENABLE_OUTPUT_GUARDRAILS",
            "COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT",
            "COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS",
            "COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS",
            "COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT",
            "COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_DELAY_MS",
            "COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS",
            "COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS",
            "COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS",
            "COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS",
            "COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS",
            "COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS",
            "COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS",
            "COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT",
            "COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS",
            "COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS",
            "COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT",
            "COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS",
        ];
        let snapshot = snapshot_env(&keys);
        for key in &keys {
            std::env::remove_var(key);
        }

        let mut command = Command::new("env");
        SidecarManager::apply_chat_runtime_env(&mut command);
        let envs = command_env_map(&command);

        assert_eq!(
            envs.get("COWORKANY_ENABLE_GUARDRAILS"),
            Some(&"0".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_ENABLE_OUTPUT_GUARDRAILS"),
            Some(&"0".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT"),
            Some(&"5".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS"),
            Some(&"1000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS"),
            Some(&"12000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT"),
            Some(&"5".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_DELAY_MS"),
            Some(&"1000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS"),
            Some(&"90000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS"),
            Some(&"30000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS"),
            Some(&"180000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS"),
            Some(&"180000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS"),
            Some(&"30000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS"),
            Some(&"2000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS"),
            Some(&"120000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT"),
            Some(&"5".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS"),
            Some(&"1000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS"),
            Some(&"90000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT"),
            Some(&"5".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS"),
            Some(&"1000".to_string())
        );

        restore_env(snapshot);
    }

    #[test]
    fn apply_chat_runtime_env_clamps_extreme_values() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let keys = [
            "COWORKANY_ENABLE_GUARDRAILS",
            "COWORKANY_ENABLE_OUTPUT_GUARDRAILS",
            "COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT",
            "COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS",
            "COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS",
            "COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT",
            "COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_DELAY_MS",
            "COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS",
            "COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS",
            "COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS",
            "COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS",
            "COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS",
            "COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS",
            "COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS",
            "COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT",
            "COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS",
            "COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS",
            "COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT",
            "COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS",
        ];
        let snapshot = snapshot_env(&keys);

        std::env::set_var("COWORKANY_ENABLE_GUARDRAILS", "1");
        std::env::set_var("COWORKANY_ENABLE_OUTPUT_GUARDRAILS", "1");
        std::env::set_var("COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT", "99");
        std::env::set_var("COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT", "-1");
        std::env::set_var(
            "COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_DELAY_MS",
            "999999",
        );
        std::env::set_var("COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS", "9999999");
        std::env::set_var("COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS", "999999");
        std::env::set_var("COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT", "99");
        std::env::set_var("COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS", "1");
        std::env::set_var("COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS", "999999");
        std::env::set_var("COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT", "-1");
        std::env::set_var("COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS", "999999");

        let mut command = Command::new("env");
        SidecarManager::apply_chat_runtime_env(&mut command);
        let envs = command_env_map(&command);

        assert_eq!(
            envs.get("COWORKANY_ENABLE_GUARDRAILS"),
            Some(&"1".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_ENABLE_OUTPUT_GUARDRAILS"),
            Some(&"1".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT"),
            Some(&"10".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS"),
            Some(&"100".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS"),
            Some(&"2000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT"),
            Some(&"5".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_DELAY_MS"),
            Some(&"30000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS"),
            Some(&"15000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS"),
            Some(&"3000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS"),
            Some(&"30000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS"),
            Some(&"180000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS"),
            Some(&"5000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS"),
            Some(&"20000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_WORKFLOW_TIMEOUT_MS"),
            Some(&"15000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_COUNT"),
            Some(&"5".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_WORKFLOW_RETRY_DELAY_MS"),
            Some(&"100".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_EXECUTE_STEP_TIMEOUT_MS"),
            Some(&"90000".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_COUNT"),
            Some(&"5".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MASTRA_TASK_EXECUTE_STEP_RETRY_DELAY_MS"),
            Some(&"10000".to_string())
        );

        restore_env(snapshot);
    }

    #[test]
    fn apply_llm_env_uses_active_openai_compatible_profile() {
        let app_data_dir = unique_temp_dir("sidecar-llm-config");
        fs::create_dir_all(&app_data_dir).expect("create temp app data dir");
        fs::write(
            app_data_dir.join("llm-config.json"),
            r#"{
                "provider": "aiberm",
                "activeProfileId": "profile-aiberm",
                "profiles": [
                    {
                        "id": "profile-anthropic",
                        "provider": "anthropic",
                        "anthropic": {
                            "apiKey": "sk-ant-wrong",
                            "model": "claude-sonnet-4-5"
                        }
                    },
                    {
                        "id": "profile-aiberm",
                        "provider": "aiberm",
                        "openai": {
                            "apiKey": "sk-aiberm-real",
                            "baseUrl": "https://aiberm.com/v1",
                            "model": "gpt-5.3-codex"
                        }
                    }
                ]
            }"#,
        )
        .expect("write llm-config");

        let mut command = Command::new("env");
        SidecarManager::apply_llm_env(&mut command, app_data_dir.to_str().expect("utf8 path"));
        let envs = command_env_map(&command);

        assert_eq!(
            envs.get("OPENAI_API_KEY"),
            Some(&"sk-aiberm-real".to_string())
        );
        assert_eq!(
            envs.get("OPENAI_BASE_URL"),
            Some(&"https://aiberm.com/v1".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_LLM_CONFIG_PROVIDER"),
            Some(&"aiberm".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MODEL"),
            Some(&"aiberm/gpt-5.3-codex".to_string())
        );
        assert!(
            !envs.contains_key("ANTHROPIC_API_KEY"),
            "active profile should decide provider key propagation"
        );

        let _ = fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn apply_llm_env_routes_custom_openai_format_via_openai_compatible_env() {
        let app_data_dir = unique_temp_dir("sidecar-llm-config-custom-openai");
        fs::create_dir_all(&app_data_dir).expect("create temp app data dir");
        fs::write(
            app_data_dir.join("llm-config.json"),
            r#"{
                "provider": "custom",
                "activeProfileId": "profile-custom",
                "profiles": [
                    {
                        "id": "profile-custom",
                        "provider": "custom",
                        "custom": {
                            "apiKey": "sk-custom-real",
                            "baseUrl": "https://api.example.com/v1",
                            "model": "claude-sonnet-4-6",
                            "apiFormat": "openai"
                        }
                    }
                ]
            }"#,
        )
        .expect("write llm-config");

        let mut command = Command::new("env");
        SidecarManager::apply_llm_env(&mut command, app_data_dir.to_str().expect("utf8 path"));
        let envs = command_env_map(&command);

        assert_eq!(
            envs.get("COWORKANY_LLM_CONFIG_PROVIDER"),
            Some(&"custom".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_LLM_CUSTOM_API_FORMAT"),
            Some(&"openai".to_string())
        );
        assert_eq!(
            envs.get("OPENAI_API_KEY"),
            Some(&"sk-custom-real".to_string())
        );
        assert_eq!(
            envs.get("OPENAI_BASE_URL"),
            Some(&"https://api.example.com/v1".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MODEL"),
            Some(&"openai/claude-sonnet-4-6".to_string())
        );
        assert!(
            !envs.contains_key("ANTHROPIC_API_KEY"),
            "custom openai-format profile should not inject anthropic key"
        );

        let _ = fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn apply_llm_env_normalizes_minimax_codex_alias_model() {
        let app_data_dir = unique_temp_dir("sidecar-llm-config-minimax");
        fs::create_dir_all(&app_data_dir).expect("create temp app data dir");
        fs::write(
            app_data_dir.join("llm-config.json"),
            r#"{
                "provider": "minimax",
                "activeProfileId": "profile-minimax",
                "profiles": [
                    {
                        "id": "profile-minimax",
                        "provider": "minimax",
                        "openai": {
                            "apiKey": "sk-minimax-real",
                            "baseUrl": "https://api.minimax.chat/v1",
                            "model": "codex-minimax-m2.7"
                        }
                    }
                ]
            }"#,
        )
        .expect("write llm-config");

        let mut command = Command::new("env");
        SidecarManager::apply_llm_env(&mut command, app_data_dir.to_str().expect("utf8 path"));
        let envs = command_env_map(&command);

        assert_eq!(
            envs.get("OPENAI_API_KEY"),
            Some(&"sk-minimax-real".to_string())
        );
        assert_eq!(
            envs.get("OPENAI_BASE_URL"),
            Some(&"https://api.minimaxi.com/v1".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_LLM_CONFIG_PROVIDER"),
            Some(&"minimax".to_string())
        );
        assert_eq!(
            envs.get("COWORKANY_MODEL"),
            Some(&"minimax/MiniMax-M2.7".to_string())
        );

        let _ = fs::remove_dir_all(&app_data_dir);
    }

    #[cfg(unix)]
    #[test]
    fn try_attach_singleton_transport_connects_existing_unix_socket() {
        let app_data_dir = unique_temp_dir("sidecar-singleton-attach");
        fs::create_dir_all(&app_data_dir).expect("create temp app data dir");
        let app_data_dir_str = app_data_dir.to_string_lossy().to_string();

        let socket_path = SidecarManager::sidecar_singleton_socket_path(&app_data_dir_str);
        let socket_path_buf = PathBuf::from(&socket_path);
        if socket_path_buf.exists() {
            let _ = fs::remove_file(&socket_path_buf);
        }

        let listener = UnixListener::bind(&socket_path_buf).expect("bind singleton socket");
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept singleton connection");
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .expect("read command from singleton client");
            line
        });

        let attached = SidecarManager::try_attach_singleton_transport(&app_data_dir_str)
            .expect("attach to singleton transport")
            .expect("singleton transport should exist");
        assert!(attached.descriptor.contains("unix:"));
        super::write_json_line(&attached.writer, "{\"type\":\"ping\"}")
            .expect("write command through singleton transport");
        drop(attached);

        let line = server.join().expect("join socket server thread");
        assert_eq!(line.trim(), "{\"type\":\"ping\"}");

        let _ = fs::remove_file(&socket_path_buf);
        let _ = fs::remove_dir_all(&app_data_dir);
    }

    #[test]
    fn classify_sidecar_message_recognizes_policy_gate_forwarded_commands() {
        let command_types = [
            "read_file",
            "list_dir",
            "exec_shell",
            "capture_screen",
            "get_policy_config",
        ];

        for msg_type in command_types {
            let message = json!({ "type": msg_type });
            let kind = classify_sidecar_message(&message);
            assert!(matches!(kind, Some(SidecarMessageKind::IpcCommand)));
        }
    }

    #[test]
    fn classify_sidecar_message_recognizes_policy_gate_forwarded_responses() {
        let response_types = [
            "read_file_response",
            "list_dir_response",
            "exec_shell_response",
            "capture_screen_response",
            "get_policy_config_response",
        ];

        for msg_type in response_types {
            let message = json!({
                "type": msg_type,
                "commandId": "cmd-1",
            });
            let kind = classify_sidecar_message(&message);
            assert!(matches!(kind, Some(SidecarMessageKind::IpcResponse)));
        }
    }

    #[test]
    fn is_json_object_line_filters_non_protocol_stdout_lines() {
        assert!(is_json_object_line(
            r#"{"type":"ready","runtime":"mastra"}"#
        ));
        assert!(!is_json_object_line("[SkillStore] Loaded 8 skills"));
        assert!(!is_json_object_line("\"null\""));
        assert!(!is_json_object_line("{"));
        assert!(!is_json_object_line("error: {"));
    }

    #[test]
    fn is_sidecar_metrics_line_recognizes_prefixed_metric_output() {
        assert!(is_sidecar_metrics_line(
            r#"[coworkany-metrics] {"event":"llm_timing","outcome":"success"}"#
        ));
        assert!(is_sidecar_metrics_line(
            r#"   [coworkany-metrics] {"event":"llm_timing"}"#
        ));
        assert!(!is_sidecar_metrics_line("[SkillStore] Loaded 8 skills"));
        assert!(!is_sidecar_metrics_line(r#"{"type":"TASK_EVENT"}"#));
    }

    #[test]
    fn truncate_log_line_limits_json_log_length() {
        assert_eq!(truncate_log_line("short", 16), "short");
        assert_eq!(truncate_log_line("1234567890", 5), "12345…");
    }

    #[test]
    fn extract_stream_delta_log_entry_parses_text_delta_payload() {
        let message = json!({
            "type": "TEXT_DELTA",
            "taskId": "task-123",
            "payload": {
                "turnId": "turn-1",
                "messageId": "msg-1",
                "correlationId": "corr-1",
                "role": "assistant",
                "delta": "hello"
            }
        });

        let entry = extract_stream_delta_log_entry(&message).expect("stream log entry");
        assert_eq!(entry.delta, "hello");
        assert_eq!(entry.key.message_type, "TEXT_DELTA");
        assert_eq!(entry.key.task_id.as_deref(), Some("task-123"));
        assert_eq!(entry.key.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(entry.key.message_id.as_deref(), Some("msg-1"));
        assert_eq!(entry.key.correlation_id.as_deref(), Some("corr-1"));
        assert_eq!(entry.key.role.as_deref(), Some("assistant"));
        assert_eq!(entry.key.part_type, None);
    }

    #[test]
    fn extract_stream_delta_log_entry_parses_canonical_message_delta_payload() {
        let message = json!({
            "type": "canonical_message_delta",
            "payload": {
                "id": "canon-1",
                "taskId": "task-123",
                "turnId": "turn-1",
                "correlationId": "corr-1",
                "role": "assistant",
                "part": {
                    "type": "text",
                    "delta": "world"
                }
            }
        });

        let entry = extract_stream_delta_log_entry(&message).expect("stream log entry");
        assert_eq!(entry.delta, "world");
        assert_eq!(entry.key.message_type, "canonical_message_delta");
        assert_eq!(entry.key.task_id.as_deref(), Some("task-123"));
        assert_eq!(entry.key.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(entry.key.message_id.as_deref(), Some("canon-1"));
        assert_eq!(entry.key.correlation_id.as_deref(), Some("corr-1"));
        assert_eq!(entry.key.role.as_deref(), Some("assistant"));
        assert_eq!(entry.key.part_type.as_deref(), Some("text"));
    }

    #[test]
    fn extract_stream_delta_log_entry_ignores_non_stream_events() {
        let message = json!({
            "type": "TASK_STATUS",
            "taskId": "task-123",
            "payload": {
                "status": "running"
            }
        });

        assert!(extract_stream_delta_log_entry(&message).is_none());
    }
}
