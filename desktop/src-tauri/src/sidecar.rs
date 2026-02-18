//! CoworkAny Desktop - Sidecar Manager
//!
//! Manages the Bun sidecar process lifecycle and IPC communication.
//! - Spawns sidecar with stdin/stdout pipes
//! - Sends IpcCommand JSON lines to stdin
//! - Reads TaskEvent JSON lines from stdout and emits to frontend

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::diff::{apply_patch as apply_patch_diff, DiffHunk, FilePatch, PatchOperation};
use crate::policy::commands as policy_commands;
use crate::policy::{EffectContext, EffectPayload, EffectRequest, EffectResponse, EffectScope, EffectSource, EffectType, PolicyEngineState};
use crate::shadow_fs::{self, ShadowFsState};

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
    #[serde(rename = "selectedText", skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    #[serde(rename = "openFiles", skip_serializing_if = "Option::is_none")]
    pub open_files: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    #[serde(rename = "modelId", skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(rename = "maxTokens", skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(rename = "maxHistoryMessages", skip_serializing_if = "Option::is_none")]
    pub max_history_messages: Option<u32>,
    #[serde(rename = "enabledClaudeSkills", skip_serializing_if = "Option::is_none")]
    pub enabled_claude_skills: Option<Vec<String>>,
    #[serde(rename = "enabledToolpacks", skip_serializing_if = "Option::is_none")]
    pub enabled_toolpacks: Option<Vec<String>>,
    #[serde(rename = "enabledSkills", skip_serializing_if = "Option::is_none")]
    pub enabled_skills: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SendTaskMessagePayload {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub content: String,
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
        config: Option<TaskConfig>,
    ) -> Self {
        IpcCommand::SendTaskMessage {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono_now(),
            payload: SendTaskMessagePayload {
                task_id,
                content,
                config,
            },
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
    stdin_tx: Option<Sender<String>>,
    stdout_handle: Option<thread::JoinHandle<()>>,
    stdin_handle: Option<thread::JoinHandle<()>>,
    stderr_handle: Option<thread::JoinHandle<()>>,
    pending_responses: Arc<Mutex<HashMap<String, Sender<serde_json::Value>>>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin_tx: None,
            stdout_handle: None,
            stdin_handle: None,
            stderr_handle: None,
            pending_responses: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn the sidecar process and start listening for events
    pub fn spawn(&mut self, app_handle: AppHandle) -> Result<(), SidecarError> {
        if self.child.is_some() {
            warn!("Sidecar already running, skipping spawn");
            return Ok(());
        }

        info!("Spawning sidecar process...");

        // Get sidecar path relative to app
        // Get sidecar path relative to app (handle both project root and src-tauri CWD)
        let cwd = std::env::current_dir().unwrap_or_default();
        let mut sidecar_path = cwd.join("../sidecar/src/main.ts");
        
        if !sidecar_path.exists() {
             sidecar_path = cwd.join("../../sidecar/src/main.ts");
             if !sidecar_path.exists() {
                 warn!("Could not find sidecar main.ts at {:?} or ../{:?}", sidecar_path, sidecar_path);
             }
        }

        // Try to use bun for TypeScript execution (sidecar uses Bun runtime)
        let sidecar_dir = sidecar_path.parent().unwrap().parent().unwrap();
        
        let mut child = Command::new("bun")
            .current_dir(sidecar_dir)
            .args(["run", "src/main.ts"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()) // Capture stderr
            .spawn()
            .or_else(|_| {
                let sidecar_dir = sidecar_path.parent().unwrap().parent().unwrap();
                let tsx_path = sidecar_dir.join("node_modules/tsx/dist/cli.mjs");
                
                // Fallback 1: Try local tsx with node (most robust)
                if tsx_path.exists() {
                    Command::new("node")
                        .current_dir(sidecar_dir)
                        .args([tsx_path.to_str().unwrap(), "src/main.ts"])
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                } else {
                    // Fallback 2: Try global npx (legacy)
                    let cmd = if cfg!(target_os = "windows") { "npx.cmd" } else { "npx" };
                    Command::new(cmd)
                        .current_dir(sidecar_dir)
                        .args(["tsx", "src/main.ts"])
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn()
                }
            })?;

        info!("Sidecar spawned with PID: {:?}", child.id());

        // Take ownership of stdin/stdout/stderr
        let stdin = child.stdin.take().expect("Failed to get stdin");
        let stdout = child.stdout.take().expect("Failed to get stdout");
        let stderr = child.stderr.take().expect("Failed to get stderr");

        // Create channel for sending commands to stdin writer thread
        let (tx, rx): (Sender<String>, Receiver<String>) = mpsc::channel();
        self.stdin_tx = Some(tx.clone());

        // Spawn stdin writer thread
        let stdin_handle = thread::spawn(move || {
            Self::stdin_writer_loop(stdin, rx);
        });
        self.stdin_handle = Some(stdin_handle);

        // Spawn stdout reader thread
        let stdout_tx = tx.clone();
        let pending_responses = self.pending_responses.clone();
        let stdout_handle = thread::spawn(move || {
            Self::stdout_reader_loop(stdout, app_handle, stdout_tx, pending_responses);
        });
        self.stdout_handle = Some(stdout_handle);

        // Spawn stderr reader thread
        let stderr_handle = thread::spawn(move || {
            Self::stderr_reader_loop(stderr);
        });
        self.stderr_handle = Some(stderr_handle);

        self.child = Some(child);

        Ok(())
    }

    /// Send a command to the sidecar
    pub fn send_command(&self, command: IpcCommand) -> Result<(), SidecarError> {
        let tx = self.stdin_tx.as_ref().ok_or(SidecarError::NotRunning)?;

        let json = serde_json::to_string(&command)?;
        debug!("Sending command to sidecar: {}", json);

        tx.send(json)
            .map_err(|e| SidecarError::SendError(e.to_string()))?;

        Ok(())
    }

    /// Send a raw JSON command to the sidecar
    pub fn send_raw_command(&self, command: serde_json::Value) -> Result<(), SidecarError> {
        let tx = self.stdin_tx.as_ref().ok_or(SidecarError::NotRunning)?;
        let json = serde_json::to_string(&command)?;
        debug!("Sending raw command to sidecar: {}", json);
        tx.send(json)
            .map_err(|e| SidecarError::SendError(e.to_string()))?;
        Ok(())
    }

    /// Send a command and wait for a matching ipc-response (by commandId).
    pub fn send_and_wait(
        &self,
        command: serde_json::Value,
        timeout_ms: u64,
    ) -> Result<serde_json::Value, SidecarError> {
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

        self.send_raw_command(command)?;

        match rx.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
            Ok(response) => Ok(response),
            Err(err) => Err(SidecarError::SendError(format!(
                "response timeout: {}",
                err
            ))),
        }
    }

    /// Shutdown the sidecar process
    pub fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            info!("Shutting down sidecar...");

            // Drop stdin to signal EOF
            drop(self.stdin_tx.take());

            // Give it a moment to exit gracefully
            std::thread::sleep(std::time::Duration::from_millis(100));

            // Force kill if still running
            let _ = child.kill();
            let _ = child.wait();

            info!("Sidecar shutdown complete");
        }
    }

    /// Check if sidecar is running
    pub fn is_running(&mut self) -> bool {
        if let Some(ref mut child) = self.child {
            // try_wait checks if the process has exited without blocking
            match child.try_wait() {
                Ok(Some(status)) => {
                    // Process has exited
                    warn!("Sidecar process exited with status: {:?}", status);
                    // Clean up the dead process
                    self.child = None;
                    self.stdin_tx = None;
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
            false
        }
    }

    // -------------------------------------------------------------------------
    // Internal threads
    // -------------------------------------------------------------------------

    fn stdin_writer_loop(mut stdin: ChildStdin, rx: Receiver<String>) {
        for line in rx {
            if let Err(e) = writeln!(stdin, "{}", line) {
                error!("Failed to write to sidecar stdin: {}", e);
                break;
            }
            if let Err(e) = stdin.flush() {
                error!("Failed to flush sidecar stdin: {}", e);
                break;
            }
        }
        debug!("Stdin writer loop ended");
    }

    fn stdout_reader_loop(
        stdout: ChildStdout,
        app_handle: AppHandle,
        tx: Sender<String>,
        pending_responses: Arc<Mutex<HashMap<String, Sender<serde_json::Value>>>>,
    ) {
        let reader = BufReader::new(stdout);

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }

                    debug!("Received from sidecar: {}", line);

                    match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(message) => {
                            match classify_sidecar_message(&message) {
                                Some(SidecarMessageKind::TaskEvent) => {
                                    if let Err(e) = app_handle.emit("task-event", &message) {
                                        error!("Failed to emit task-event: {}", e);
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
                                    handle_sidecar_command(message, app_handle.clone(), tx.clone());
                                }
                                None => warn!("Ignoring unclassified sidecar message: {}", line),
                            }
                        }
                        Err(e) => warn!("Failed to parse sidecar output as JSON: {} - line: {}", e, line),
                    }
                }
                Err(e) => {
                    error!("Error reading from sidecar stdout: {}", e);
                    break;
                }
            }
        }

        info!("Stdout reader loop ended (sidecar closed stdout)");

        // Notify frontend that sidecar has disconnected
        let _ = app_handle.emit("sidecar-disconnected", ());
    }

    fn stderr_reader_loop(
        stderr: std::process::ChildStderr,
    ) {
        let reader = BufReader::new(stderr);

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    // Log as warn/info to keep it visible but distinct
                    warn!("Sidecar stderr: {}", line);
                }
                Err(e) => {
                    error!("Error reading from sidecar stderr: {}", e);
                    break;
                }
            }
        }
        debug!("Stderr reader loop ended");
    }
}

// -------------------------------------------------------------------------
// Message classification
// -------------------------------------------------------------------------

enum SidecarMessageKind {
    TaskEvent,
    IpcResponse,
    IpcCommand,
}

fn classify_sidecar_message(message: &serde_json::Value) -> Option<SidecarMessageKind> {
    let msg_type = message.get("type")?.as_str()?;
    if msg_type.ends_with("_response") {
        return Some(SidecarMessageKind::IpcResponse);
    }
    if msg_type == "request_effect"
        || msg_type == "propose_patch"
        || msg_type == "apply_patch"
        || msg_type == "reject_patch"
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

fn build_effect_request_for_patch(
    operation: PatchOperation,
    path: &str,
) -> EffectRequest {
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

fn handle_sidecar_command(message: serde_json::Value, app_handle: AppHandle, tx: Sender<String>) {
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
                    send_raw(&tx, build_error_response(&command_id, "request_effect_response", "invalid_request"));
                    return;
                };

                let state = app_handle.state::<PolicyEngineState>();
                let result = policy_commands::request_effect(request.clone(), state, app_handle.clone()).await;

                let response = match result {
                    Ok(res) => res,
                    Err(err) => EffectResponse {
                        request_id: request.id.clone(),
                        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        approved: false,
                        approval_type: None,
                        expires_at: None,
                        denial_reason: Some(err),
                        denial_code: Some("policy_error".to_string()),
                        modified_scope: None,
                    },
                };

                let payload = json!({ "response": response });
                let response_msg = json!({
                    "type": "request_effect_response",
                    "commandId": command_id,
                    "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    "payload": payload
                });

                send_raw(&tx, response_msg);
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
                let patch: Option<ProtocolFilePatch> = serde_json::from_value(patch_value.clone()).ok();

                let Some(patch) = patch else {
                    send_raw(
                        &tx,
                        build_error_response(&command_id, "propose_patch_response", "invalid_patch"),
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
                            &tx,
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

                send_raw(&tx, response_msg);
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
                    send_raw(&tx, build_error_response(&command_id, "apply_patch_response", "missing_patch_id"));
                    return;
                };

                let shadow_state = app_handle.state::<ShadowFsState>();
                let (patch_operation, patch_path) = {
                    let guard = shadow_state.lock().await;
                    let shadow_fs = guard.as_ref();
                    let entry = shadow_fs.and_then(|fs| fs.get(patch_id));
                    let operation = entry
                        .and_then(|e| e.patch.as_ref())
                        .map(|p| p.operation);
                    let path = entry.map(|e| e.original_path.to_string_lossy().to_string());
                    (operation, path)
                };

                if let (Some(operation), Some(path)) = (patch_operation, patch_path.clone()) {
                    if matches!(operation, PatchOperation::Delete | PatchOperation::Rename) {
                        let request = build_effect_request_for_patch(operation, &path);
                        let state = app_handle.state::<PolicyEngineState>();
                        let policy = policy_commands::request_effect(request, state, app_handle.clone()).await;

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
                                send_raw(&tx, response_msg);
                                return;
                            }
                        }
                    }
                }

                let result = shadow_fs::apply_patch(shadow_state, patch_id.to_string(), create_backup).await;

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

                send_raw(&tx, response_msg);
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

                send_raw(&tx, response_msg);
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
                    send_raw(&tx, build_error_response(&command_id, "register_agent_identity_response", "invalid_identity"));
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
                    Err(err) => build_error_response(&command_id, "register_agent_identity_response", &err),
                };

                send_raw(&tx, response_msg);
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
                    send_raw(&tx, build_error_response(&command_id, "record_agent_delegation_response", "invalid_delegation"));
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
                    Err(err) => build_error_response(&command_id, "record_agent_delegation_response", &err),
                };

                send_raw(&tx, response_msg);
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
                    send_raw(&tx, build_error_response(&command_id, "report_mcp_gateway_decision_response", "invalid_decision"));
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
                    Err(err) => build_error_response(&command_id, "report_mcp_gateway_decision_response", &err),
                };

                send_raw(&tx, response_msg);
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
                    send_raw(&tx, build_error_response(&command_id, "report_runtime_security_alert_response", "invalid_alert"));
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
                    Err(err) => build_error_response(&command_id, "report_runtime_security_alert_response", &err),
                };

                send_raw(&tx, response_msg);
            });
        }
        _ => {
            warn!("Unhandled sidecar command: {}", msg_type);
        }
    }
}

fn send_raw(tx: &Sender<String>, message: serde_json::Value) {
    if let Ok(line) = serde_json::to_string(&message) {
        let _ = tx.send(line);
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

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
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
