//! CoworkAny Desktop - Tauri IPC Command Handlers
//!
//! These are the Tauri commands that the React frontend can invoke.
//! They forward to the SidecarManager for actual processing.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tracing::{debug, error, info};
use uuid::Uuid;

use crate::process_manager::{ProcessManagerState, ServiceInfo};
use crate::sidecar::{IpcCommand, SidecarState, TaskConfig, TaskContext};

// ============================================================================
// Command Input Types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct StartTaskInput {
    pub title: String,
    #[serde(rename = "userQuery")]
    pub user_query: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "activeFile")]
    pub active_file: Option<String>,
    pub config: Option<StartTaskConfigInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartTaskConfigInput {
    #[serde(rename = "modelId")]
    pub model_id: Option<String>,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<u32>,
    #[serde(rename = "maxHistoryMessages")]
    pub max_history_messages: Option<u32>,
    #[serde(rename = "enabledClaudeSkills")]
    pub enabled_claude_skills: Option<Vec<String>>,
    #[serde(rename = "enabledToolpacks")]
    pub enabled_toolpacks: Option<Vec<String>>,
    #[serde(rename = "enabledSkills")]
    pub enabled_skills: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CancelTaskInput {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClearTaskHistoryInput {
    #[serde(rename = "taskId")]
    pub task_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetTasksInput {
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    pub limit: Option<u32>,
    pub status: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SendTaskMessageInput {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub content: String,
    pub config: Option<StartTaskConfigInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListToolpacksInput {
    #[serde(rename = "includeDisabled")]
    pub include_disabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetToolpackInput {
    #[serde(rename = "toolpackId")]
    pub toolpack_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstallToolpackInput {
    pub source: String,
    pub path: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "allowUnsigned")]
    pub allow_unsigned: Option<bool>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetToolpackEnabledInput {
    #[serde(rename = "toolpackId")]
    pub toolpack_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveToolpackInput {
    #[serde(rename = "toolpackId")]
    pub toolpack_id: String,
    #[serde(rename = "deleteFiles")]
    pub delete_files: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListClaudeSkillsInput {
    #[serde(rename = "includeDisabled")]
    pub include_disabled: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetClaudeSkillInput {
    #[serde(rename = "skillId")]
    pub skill_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportClaudeSkillInput {
    pub source: String,
    pub path: Option<String>,
    pub url: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetClaudeSkillEnabledInput {
    #[serde(rename = "skillId")]
    pub skill_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveClaudeSkillInput {
    #[serde(rename = "skillId")]
    pub skill_id: String,
    #[serde(rename = "deleteFiles")]
    pub delete_files: Option<bool>,
}

// ============================================================================
// Command Response Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct StartTaskResult {
    pub success: bool,
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CancelTaskResult {
    pub success: bool,
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClearTaskHistoryResult {
    pub success: bool,
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SendTaskMessageResult {
    pub success: bool,
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub error: Option<String>,
}

/// Provider-specific settings for Anthropic
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnthropicProviderSettings {
    pub api_key: Option<String>,
    pub model: Option<String>,
}

/// Provider-specific settings for OpenRouter
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterProviderSettings {
    pub api_key: Option<String>,
    pub model: Option<String>,
}

/// Provider-specific settings for OpenAI
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenAIProviderSettings {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

/// Provider-specific settings for Ollama
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OllamaProviderSettings {
    pub base_url: Option<String>,
    pub model: Option<String>,
}

/// Provider-specific settings for Custom
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderSettings {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_format: Option<String>,
}

/// A verified LLM profile
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LlmProfile {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub anthropic: Option<AnthropicProviderSettings>,
    pub openrouter: Option<OpenRouterProviderSettings>,
    pub openai: Option<OpenAIProviderSettings>,
    pub ollama: Option<OllamaProviderSettings>,
    pub custom: Option<CustomProviderSettings>,
    pub verified: bool,
}

/// LLM Config matching llm-config.json structure
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub provider: Option<String>,
    pub anthropic: Option<AnthropicProviderSettings>,
    pub openrouter: Option<OpenRouterProviderSettings>,
    pub openai: Option<OpenAIProviderSettings>,
    pub ollama: Option<OllamaProviderSettings>,
    pub custom: Option<CustomProviderSettings>,
    pub profiles: Option<Vec<LlmProfile>>,
    pub active_profile_id: Option<String>,
    pub max_history_messages: Option<u32>,
    /// Web search provider settings (serper, tavily, brave, searxng)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<Value>,
    /// Browser-use AI automation settings
    #[serde(rename = "browserUse", skip_serializing_if = "Option::is_none")]
    pub browser_use: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmConfigResult {
    pub success: bool,
    pub payload: LlmConfig,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionsSnapshot {
    pub sessions: Vec<Value>,
    pub active_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionsSnapshotResult {
    pub success: bool,
    pub payload: SessionsSnapshot,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SidecarStatusResult {
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GenericIpcResult {
    pub success: bool,
    pub payload: Value,
}

// ============================================================================
// Helpers
// ============================================================================

fn now_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn build_command(command_type: &str, payload: Value) -> Value {
    json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": now_timestamp(),
        "type": command_type,
        "payload": payload
    })
}

async fn ensure_sidecar_running(
    state: &State<'_, SidecarState>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    if !manager.is_running() {
        debug!("Sidecar not running, spawning...");
        manager.spawn(app_handle.clone()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn send_command_and_wait(
    state: &State<'_, SidecarState>,
    command: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    let manager = state.0.lock().map_err(|e| e.to_string())?;
    manager
        .send_and_wait(command, timeout_ms)
        .map_err(|e| e.to_string())
}

fn llm_config_path() -> Result<PathBuf, String> {
    // Get the current working directory (should be the project root when running with tauri dev)
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    
    // Build path to sidecar/llm-config.json
    let config_path = cwd.join("..").join("sidecar").join("llm-config.json");
    
    // Canonicalize to get absolute path (this will fail if path doesn't exist)
    let canonical = config_path.canonicalize().unwrap_or_else(|_| config_path.clone());
    
    debug!("llm_config_path: cwd={:?}, resolved={:?}", cwd, canonical);
    
    Ok(canonical)
}

fn sessions_path() -> Result<PathBuf, String> {
    std::env::current_dir()
        .map_err(|e| e.to_string())
        .map(|cwd| cwd.join(".coworkany").join("sessions.json"))
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Start a new task
#[tauri::command]
pub async fn start_task(
    input: StartTaskInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<StartTaskResult, String> {
    info!("start_task command received: {:?}", input);

    // Generate new task ID
    let task_id = Uuid::new_v4().to_string();

    // Ensure sidecar is running
    ensure_sidecar_running(&state, &app_handle).await?;

    // Build context
    let context = TaskContext {
        workspace_path: input.workspace_path,
        active_file: input.active_file,
        selected_text: None,
        open_files: None,
    };

    let config = input.config.map(|cfg| TaskConfig {
        model_id: cfg.model_id,
        max_tokens: cfg.max_tokens,
        max_history_messages: cfg.max_history_messages,
        enabled_claude_skills: cfg.enabled_claude_skills,
        enabled_toolpacks: cfg.enabled_toolpacks,
        enabled_skills: cfg.enabled_skills,
    });

    // Send command to sidecar
    let command = IpcCommand::start_task(
        task_id.clone(),
        input.title,
        input.user_query,
        context,
        config,
    );

    {
        let manager = state.0.lock().map_err(|e| e.to_string())?;
        manager.send_command(command).map_err(|e| {
            error!("Failed to send start_task command: {}", e);
            e.to_string()
        })?;
    }

    Ok(StartTaskResult {
        success: true,
        task_id,
        error: None,
    })
}

/// Cancel a running task
#[tauri::command]
pub async fn cancel_task(
    input: CancelTaskInput,
    state: State<'_, SidecarState>,
) -> Result<CancelTaskResult, String> {
    info!("cancel_task command received: {:?}", input);

    let mut manager = state.0.lock().map_err(|e| e.to_string())?;

    if !manager.is_running() {
        return Ok(CancelTaskResult {
            success: false,
            task_id: input.task_id,
            error: Some("Sidecar not running".to_string()),
        });
    }

    let command = IpcCommand::cancel_task(input.task_id.clone(), input.reason);
    manager.send_command(command).map_err(|e| {
        error!("Failed to send cancel_task command: {}", e);
        e.to_string()
    })?;

    Ok(CancelTaskResult {
        success: true,
        task_id: input.task_id,
        error: None,
    })
}

/// Clear task conversation history
#[tauri::command]
pub async fn clear_task_history(
    input: ClearTaskHistoryInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<ClearTaskHistoryResult, String> {
    info!("clear_task_history command received: {:?}", input);

    ensure_sidecar_running(&state, &app_handle).await?;

    let command = IpcCommand::clear_task_history(input.task_id.clone());

    {
        let manager = state.0.lock().map_err(|e| e.to_string())?;
        manager.send_command(command).map_err(|e| {
            error!("Failed to send clear_task_history command: {}", e);
            e.to_string()
        })?;
    }

    Ok(ClearTaskHistoryResult {
        success: true,
        task_id: input.task_id,
        error: None,
    })
}

/// Get tasks from sidecar
#[tauri::command]
pub async fn get_tasks(
    input: GetTasksInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "workspacePath": input.workspace_path,
        "limit": input.limit,
        "status": input.status
    });
    let command = build_command("get_tasks", payload);
    
    // Sidecar returns Full Response Object (with type, commandId, payload)
    let response = send_command_and_wait(&state, command, 3000)?;
    
    // meaningful data is in response.payload
    let inner_payload = response.get("payload").cloned().unwrap_or(json!({}));

    Ok(GenericIpcResult {
        success: true,
        payload: inner_payload,
    })
}

/// Send a message to an existing task
#[tauri::command]
pub async fn send_task_message(
    input: SendTaskMessageInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<SendTaskMessageResult, String> {
    info!("send_task_message command received: {:?}", input);

    ensure_sidecar_running(&state, &app_handle).await?;

    let config = input.config.map(|cfg| TaskConfig {
        model_id: cfg.model_id,
        max_tokens: cfg.max_tokens,
        max_history_messages: cfg.max_history_messages,
        enabled_claude_skills: cfg.enabled_claude_skills,
        enabled_toolpacks: cfg.enabled_toolpacks,
        enabled_skills: cfg.enabled_skills,
    });

    let command = IpcCommand::send_task_message(
        input.task_id.clone(),
        input.content,
        config,
    );

    {
        let manager = state.0.lock().map_err(|e| e.to_string())?;
        manager.send_command(command).map_err(|e| {
            error!("Failed to send send_task_message command: {}", e);
            e.to_string()
        })?;
    }

    Ok(SendTaskMessageResult {
        success: true,
        task_id: input.task_id,
        error: None,
    })
}

/// Get sidecar status
#[tauri::command]
pub fn get_sidecar_status(state: State<'_, SidecarState>) -> Result<SidecarStatusResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;

    Ok(SidecarStatusResult {
        running: manager.is_running(),
    })
}

/// Get LLM config from sidecar/llm-config.json
#[tauri::command]
pub fn get_llm_settings() -> Result<LlmConfigResult, String> {
    let path = llm_config_path()?;
    info!("get_llm_settings: reading from {:?}", path);
    
    if !path.exists() {
        info!("get_llm_settings: file does not exist, returning default");
        return Ok(LlmConfigResult {
            success: true,
            payload: LlmConfig::default(),
            error: None,
        });
    }

    let raw = fs::read_to_string(&path).map_err(|e| {
        error!("get_llm_settings: failed to read file: {}", e);
        e.to_string()
    })?;
    info!("get_llm_settings: read {} bytes", raw.len());
    
    let config: LlmConfig = serde_json::from_str(&raw).map_err(|e| {
        error!("get_llm_settings: failed to parse JSON: {}", e);
        e.to_string()
    })?;
    
    info!("get_llm_settings: parsed config, provider={:?}", config.provider);
    Ok(LlmConfigResult {
        success: true,
        payload: config,
        error: None,
    })
}

/// Save LLM config to sidecar/llm-config.json
#[tauri::command]
pub fn save_llm_settings(mut input: LlmConfig, app: AppHandle) -> Result<LlmConfigResult, String> {
    let path = llm_config_path()?;
    info!("save_llm_settings: saving to {:?}", path);
    
    // Preserve the $schema field
    if input.schema.is_none() {
        input.schema = Some("./llm-config.schema.json".to_string());
    }
    
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| {
        error!("save_llm_settings: failed to write file: {}", e);
        e.to_string()
    })?;
    
    info!("save_llm_settings: saved config, provider={:?}", input.provider);

    if let Err(e) = app.emit("llm-settings-updated", &input) {
        tracing::warn!("Failed to emit llm-settings-updated: {}", e);
    }

    Ok(LlmConfigResult {
        success: true,
        payload: input,
        error: None,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateLlmInput {
    pub provider: String,
    pub anthropic: Option<AnthropicProviderSettings>,
    pub openrouter: Option<OpenRouterProviderSettings>,
    pub custom: Option<CustomProviderSettings>,
}

/// Validate LLM connectivity
#[tauri::command]
pub async fn validate_llm_settings(input: ValidateLlmInput) -> Result<GenericIpcResult, String> {
    info!("validate_llm_settings: validating connectivity for {}", input.provider);
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let (url, api_key, body) = match input.provider.as_str() {
        "anthropic" => {
            let settings = input.anthropic.ok_or("Missing Anthropic settings")?;
            let key = settings.api_key.ok_or("Missing API key")?;
            let model = settings.model.unwrap_or_else(|| "claude-3-5-sonnet-20240620".to_string());
            (
                "https://api.anthropic.com/v1/messages".to_string(),
                key,
                json!({
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}]
                }),
            )
        }
        "openrouter" => {
            let settings = input.openrouter.ok_or("Missing OpenRouter settings")?;
            let key = settings.api_key.ok_or("Missing API key")?;
            let model = settings.model.unwrap_or_else(|| "anthropic/claude-3.5-sonnet".to_string());
            (
                "https://openrouter.ai/api/v1/chat/completions".to_string(),
                key,
                json!({
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}]
                }),
            )
        }
        "custom" => {
            let settings = input.custom.ok_or("Missing Custom settings")?;
            let key = settings.api_key.ok_or("Missing API key")?;
            let base_url = settings.base_url.ok_or("Missing Base URL")?;
            let model = settings.model.ok_or("Missing Model ID")?;
            let format = settings.api_format.unwrap_or_else(|| "openai".to_string());
            
            if format == "anthropic" {
                (
                    base_url,
                    key,
                    json!({
                        "model": model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}]
                    }),
                )
            } else {
                (
                    base_url,
                    key,
                    json!({
                        "model": model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}]
                    }),
                )
            }
        }
        _ => return Err(format!("Unknown provider: {}", input.provider)),
    };

    let mut request = client.post(url);

    if input.provider == "anthropic" {
        request = request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json");
    } else {
        request = request
            .header("Authorization", format!("Bearer {}", api_key))
            .header("content-type", "application/json");
    }

    let res = request.json(&body).send().await.map_err(|e| format!("Request failed: {}", e))?;
    
    let status = res.status();
    if status.is_success() {
        Ok(GenericIpcResult {
            success: true,
            payload: json!({ "message": "Connection successful" }),
        })
    } else {
        let error_text = res.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        error!("Validation failed with status {}: {}", status, error_text);
        Ok(GenericIpcResult {
            success: false,
            payload: json!({ "error": format!("Provider returned status {}: {}", status, error_text) }),
        })
    }
}

/// Get sessions snapshot from workspace .coworkany/sessions.json
#[tauri::command]
pub fn load_sessions() -> Result<SessionsSnapshotResult, String> {
    let path = sessions_path()?;
    if !path.exists() {
        return Ok(SessionsSnapshotResult {
            success: true,
            payload: SessionsSnapshot::default(),
            error: None,
        });
    }

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let snapshot: SessionsSnapshot = serde_json::from_str(&raw).unwrap_or_default();
    Ok(SessionsSnapshotResult {
        success: true,
        payload: snapshot,
        error: None,
    })
}

/// Save sessions snapshot to workspace .coworkany/sessions.json
#[tauri::command]
pub fn save_sessions(input: SessionsSnapshot) -> Result<SessionsSnapshotResult, String> {
    let path = sessions_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(SessionsSnapshotResult {
        success: true,
        payload: input,
        error: None,
    })
}

/// Get current workspace root (process cwd)
#[tauri::command]
pub fn get_workspace_root() -> Result<String, String> {
    std::env::current_dir()
        .map_err(|e| e.to_string())
        .map(|path| path.to_string_lossy().to_string())
}

/// Manually spawn the sidecar (for testing)
#[tauri::command]
pub async fn spawn_sidecar(
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    info!("spawn_sidecar command received");

    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.spawn(app_handle).map_err(|e| e.to_string())?;

    Ok(())
}

/// Shutdown the sidecar
#[tauri::command]
pub fn shutdown_sidecar(state: State<'_, SidecarState>) -> Result<(), String> {
    info!("shutdown_sidecar command received");

    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.shutdown();

    Ok(())
}

// ============================================================================
// Toolpack & Skill Management Commands
// ============================================================================

#[tauri::command]
pub async fn list_toolpacks(
    input: Option<ListToolpacksInput>,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "includeDisabled": input.and_then(|v| v.include_disabled).unwrap_or(true)
    });
    let command = build_command("list_toolpacks", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn get_toolpack(
    input: GetToolpackInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "toolpackId": input.toolpack_id
    });
    let command = build_command("get_toolpack", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn install_toolpack(
    input: InstallToolpackInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "source": input.source,
        "path": input.path,
        "url": input.url,
        "allowUnsigned": input.allow_unsigned.unwrap_or(false),
        "overwrite": input.overwrite.unwrap_or(false),
    });
    let command = build_command("install_toolpack", payload);
    let response = send_command_and_wait(&state, command, 5000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn set_toolpack_enabled(
    input: SetToolpackEnabledInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "toolpackId": input.toolpack_id,
        "enabled": input.enabled,
    });
    let command = build_command("set_toolpack_enabled", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn remove_toolpack(
    input: RemoveToolpackInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "toolpackId": input.toolpack_id,
        "deleteFiles": input.delete_files.unwrap_or(true),
    });
    let command = build_command("remove_toolpack", payload);
    let response = send_command_and_wait(&state, command, 5000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn list_claude_skills(
    input: Option<ListClaudeSkillsInput>,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "includeDisabled": input.and_then(|v| v.include_disabled).unwrap_or(true)
    });
    let command = build_command("list_claude_skills", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn get_claude_skill(
    input: GetClaudeSkillInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "skillId": input.skill_id
    });
    let command = build_command("get_claude_skill", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn import_claude_skill(
    input: ImportClaudeSkillInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "source": input.source,
        "path": input.path,
        "url": input.url,
        "overwrite": input.overwrite.unwrap_or(false),
    });
    let command = build_command("import_claude_skill", payload);
    let response = send_command_and_wait(&state, command, 5000)?;
    if response
        .get("payload")
        .and_then(|p| p.get("success"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let _ = app_handle.emit("skills-updated", ());
    }
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn set_claude_skill_enabled(
    input: SetClaudeSkillEnabledInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "skillId": input.skill_id,
        "enabled": input.enabled,
    });
    let command = build_command("set_claude_skill_enabled", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    if response
        .get("payload")
        .and_then(|p| p.get("success"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let _ = app_handle.emit("skills-updated", ());
    }
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn remove_claude_skill(
    input: RemoveClaudeSkillInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "skillId": input.skill_id,
        "deleteFiles": input.delete_files.unwrap_or(true),
    });
    let command = build_command("remove_claude_skill", payload);
    let response = send_command_and_wait(&state, command, 5000)?;
    if response
        .get("payload")
        .and_then(|p| p.get("success"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let _ = app_handle.emit("skills-updated", ());
    }
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

// ============================================================================
// Workspace Commands
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct CreateWorkspaceInput {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteWorkspaceInput {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstallFromGitHubInput {
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    pub source: String,
    #[serde(rename = "targetType")]
    pub target_type: String, // "skill" | "mcp"
}

#[tauri::command]
pub async fn list_workspaces(
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let command = build_command("list_workspaces", json!({}));
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn create_workspace(
    input: CreateWorkspaceInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "name": input.name,
        "path": input.path,
    });
    let command = build_command("create_workspace", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UpdateWorkspaceFields {
    pub name: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UpdateWorkspaceInput {
    pub id: String,
    pub updates: UpdateWorkspaceFields,
}

#[tauri::command]
pub async fn update_workspace(
    input: UpdateWorkspaceInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "id": input.id,
        "updates": input.updates,
    });
    let command = build_command("update_workspace", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn delete_workspace(
    input: DeleteWorkspaceInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "id": input.id,
    });
    let command = build_command("delete_workspace", payload);
    let response = send_command_and_wait(&state, command, 3000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn install_from_github(
    input: InstallFromGitHubInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "workspacePath": input.workspace_path,
        "source": input.source,
        "targetType": input.target_type,
    });
    let command = build_command("install_from_github", payload);
    // GitHub downloads may take a while
    let response = send_command_and_wait(&state, command, 30000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

// ============================================================================
// Repository Scanning Commands
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct ScanSourceInput {
    pub source: String,
}

#[tauri::command]
pub async fn scan_default_repos(
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let command = build_command("scan_default_repos", json!({}));
    // Scanning may take a while due to many API calls
    let response = send_command_and_wait(&state, command, 60000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn scan_skills(
    input: ScanSourceInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({ "source": input.source });
    let command = build_command("scan_skills", payload);
    let response = send_command_and_wait(&state, command, 30000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn scan_mcp_servers(
    input: ScanSourceInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({ "source": input.source });
    let command = build_command("scan_mcp_servers", payload);
    let response = send_command_and_wait(&state, command, 30000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn validate_skill(
    input: ScanSourceInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({ "source": input.source });
    let command = build_command("validate_skill", payload);
    let response = send_command_and_wait(&state, command, 15000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn validate_mcp(
    input: ScanSourceInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({ "source": input.source });
    let command = build_command("validate_mcp", payload);
    let response = send_command_and_wait(&state, command, 15000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct ValidateGitHubUrlInput {
    pub url: String,
    #[serde(rename = "type")]
    pub validation_type: String, // "skill" | "mcp"
}

#[tauri::command]
pub async fn validate_github_url(
    input: ValidateGitHubUrlInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "url": input.url,
        "type": input.validation_type,
    });
    let command = build_command("validate_github_url", payload);
    let response = send_command_and_wait(&state, command, 15000)?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

// ============================================================================
// Service Management Commands
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatusResult {
    pub success: bool,
    pub services: Vec<ServiceInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SingleServiceStatusResult {
    pub success: bool,
    pub service: Option<ServiceInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServiceOperationResult {
    pub success: bool,
    pub message: String,
    pub errors: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthCheckResult {
    pub success: bool,
    pub service: String,
    pub healthy: bool,
    pub error: Option<String>,
}

/// Start all registered services (RAG service, etc.)
#[tauri::command]
pub fn start_all_services(
    state: State<'_, ProcessManagerState>,
    app_handle: AppHandle,
) -> Result<ServiceOperationResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.set_app_handle(app_handle);

    let results = manager.start_all();

    let mut errors = Vec::new();
    let mut started = Vec::new();

    for (name, result) in results {
        match result {
            Ok(()) => started.push(name),
            Err(e) => errors.push(format!("{}: {}", name, e)),
        }
    }

    Ok(ServiceOperationResult {
        success: errors.is_empty(),
        message: if errors.is_empty() {
            format!("Started {} service(s): {}", started.len(), started.join(", "))
        } else {
            format!(
                "Started {} service(s), {} failed",
                started.len(),
                errors.len()
            )
        },
        errors: if errors.is_empty() { None } else { Some(errors) },
    })
}

/// Stop all registered services
#[tauri::command]
pub fn stop_all_services(
    state: State<'_, ProcessManagerState>,
) -> Result<ServiceOperationResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.stop_all();

    Ok(ServiceOperationResult {
        success: true,
        message: "All services stopped".to_string(),
        errors: None,
    })
}

/// Start a specific service by name
#[tauri::command]
pub fn start_service(
    name: String,
    state: State<'_, ProcessManagerState>,
) -> Result<ServiceOperationResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;

    match manager.start_service(&name) {
        Ok(()) => Ok(ServiceOperationResult {
            success: true,
            message: format!("Service '{}' started", name),
            errors: None,
        }),
        Err(e) => Ok(ServiceOperationResult {
            success: false,
            message: format!("Failed to start service '{}'", name),
            errors: Some(vec![e.to_string()]),
        }),
    }
}

/// Stop a specific service by name
#[tauri::command]
pub fn stop_service(
    name: String,
    state: State<'_, ProcessManagerState>,
) -> Result<ServiceOperationResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;

    match manager.stop_service(&name) {
        Ok(()) => Ok(ServiceOperationResult {
            success: true,
            message: format!("Service '{}' stopped", name),
            errors: None,
        }),
        Err(e) => Ok(ServiceOperationResult {
            success: false,
            message: format!("Failed to stop service '{}'", name),
            errors: Some(vec![e.to_string()]),
        }),
    }
}

/// Get status of all services
#[tauri::command]
pub fn get_all_services_status(
    state: State<'_, ProcessManagerState>,
) -> Result<ServiceStatusResult, String> {
    let manager = state.0.lock().map_err(|e| e.to_string())?;
    let services = manager.get_all_status();

    Ok(ServiceStatusResult {
        success: true,
        services,
    })
}

/// Get status of a specific service
#[tauri::command]
pub fn get_service_status(
    name: String,
    state: State<'_, ProcessManagerState>,
) -> Result<SingleServiceStatusResult, String> {
    let manager = state.0.lock().map_err(|e| e.to_string())?;
    let service = manager.get_service_status(&name);

    Ok(SingleServiceStatusResult {
        success: service.is_some(),
        service,
    })
}

/// Health check for a specific service
#[tauri::command]
pub fn health_check_service(
    name: String,
    state: State<'_, ProcessManagerState>,
) -> Result<HealthCheckResult, String> {
    let manager = state.0.lock().map_err(|e| e.to_string())?;

    match manager.health_check(&name) {
        Ok(healthy) => Ok(HealthCheckResult {
            success: true,
            service: name,
            healthy,
            error: None,
        }),
        Err(e) => Ok(HealthCheckResult {
            success: false,
            service: name,
            healthy: false,
            error: Some(e.to_string()),
        }),
    }
}
