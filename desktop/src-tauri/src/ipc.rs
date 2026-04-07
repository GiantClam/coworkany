//! CoworkAny Desktop - Tauri IPC Command Handlers
//!
//! These are the Tauri commands that the React frontend can invoke.
//! They forward to the SidecarManager for actual processing.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::platform_asr;
use crate::platform_runtime::{
    build_platform_runtime_context, build_runtime_snapshot, resolve_skillhub_executable,
};
use crate::process_manager::{ProcessManagerState, ServiceInfo};
use crate::sidecar::{IpcCommand, SidecarState, TaskConfig, TaskContext};

static STARTUP_PROCESS_INSTANT: OnceLock<Instant> = OnceLock::new();
static STARTUP_PROCESS_EPOCH_MS: OnceLock<u128> = OnceLock::new();
const SKILLHUB_INSTALL_SCRIPT_URL: &str =
    "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh";

pub fn init_startup_clock() {
    STARTUP_PROCESS_INSTANT.get_or_init(Instant::now);
    STARTUP_PROCESS_EPOCH_MS.get_or_init(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    });
}

// ============================================================================
// Command Input Types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct StartTaskInput {
    pub title: String,
    #[serde(rename = "userQuery")]
    pub user_query: String,
    #[serde(rename = "displayText")]
    pub display_text: Option<String>,
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
    #[serde(rename = "executionPath")]
    pub execution_path: Option<String>,
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
    #[serde(rename = "voiceProviderMode")]
    pub voice_provider_mode: Option<String>,
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
pub struct ResumeInterruptedTaskInput {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub config: Option<StartTaskConfigInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorPreflightInput {
    pub startup_profile: Option<String>,
    pub readiness_report_path: Option<String>,
    pub control_plane_threshold_profile: Option<String>,
    pub incident_log_paths: Option<Vec<String>>,
    pub output_dir: Option<String>,
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
    #[serde(rename = "approvePermissionExpansion")]
    pub approve_permission_expansion: Option<bool>,
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
    #[serde(rename = "autoInstallDependencies")]
    pub auto_install_dependencies: Option<bool>,
    #[serde(rename = "approvePermissionExpansion")]
    pub approve_permission_expansion: Option<bool>,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DirectivePayload {
    pub id: String,
    pub name: String,
    pub content: String,
    pub enabled: bool,
    pub priority: i32,
    pub trigger: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertDirectiveInput {
    pub directive: DirectivePayload,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveDirectiveInput {
    #[serde(rename = "directiveId")]
    pub directive_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareServiceRuntimeInput {
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemoteFileInput {
    pub url: String,
    pub suggested_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextFilePreviewInput {
    pub path: String,
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRemoteTextPreviewInput {
    pub url: String,
    pub max_bytes: Option<u64>,
}

// ============================================================================
// Command Response Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct StartTaskResult {
    pub success: bool,
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "turnId", skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(rename = "queuePosition", skip_serializing_if = "Option::is_none")]
    pub queue_position: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<Value>,
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
    #[serde(rename = "turnId", skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(rename = "queuePosition", skip_serializing_if = "Option::is_none")]
    pub queue_position: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deduplicated: Option<bool>,
    #[serde(rename = "dedupReason", skip_serializing_if = "Option::is_none")]
    pub dedup_reason: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResumeInterruptedTaskResult {
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
    pub allow_insecure_tls: Option<bool>,
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
    pub allow_insecure_tls: Option<bool>,
}

/// Proxy settings for outbound HTTP(S) calls from sidecar
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    pub enabled: Option<bool>,
    pub url: Option<String>,
    pub bypass: Option<String>,
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
    #[serde(default)]
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
    /// Outbound proxy settings for sidecar/provider requests
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<ProxySettings>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemoteFileResult {
    pub saved_path: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPreviewResult {
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMeasurementConfig {
    pub enabled: bool,
    pub profile: String,
    pub run_label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMetricInput {
    pub mark: String,
    pub frontend_elapsed_ms: Option<f64>,
    pub perf_now_ms: Option<f64>,
    pub window_label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeAudioInput {
    pub audio_base64: String,
    pub mime_type: Option<String>,
    pub language: Option<String>,
    pub provider_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProviderStatusInput {
    pub provider_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAsrInput {
    pub language: Option<String>,
}

#[derive(Debug, Clone)]
struct TranscriptionProvider {
    provider: String,
    request_url: String,
    models_url: String,
    api_key: String,
    fallback_model: String,
    allow_insecure_tls: bool,
}

// ============================================================================
// Helpers
// ============================================================================

fn now_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn build_command(command_type: &str, payload: Value) -> Value {
    fn prune_nulls(value: Value) -> Value {
        match value {
            Value::Object(map) => {
                let mut cleaned = serde_json::Map::new();
                for (key, inner) in map {
                    let next = prune_nulls(inner);
                    if !next.is_null() {
                        cleaned.insert(key, next);
                    }
                }
                Value::Object(cleaned)
            }
            Value::Array(items) => Value::Array(
                items
                    .into_iter()
                    .map(prune_nulls)
                    .filter(|item| !item.is_null())
                    .collect(),
            ),
            other => other,
        }
    }

    json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": now_timestamp(),
        "type": command_type,
        "payload": prune_nulls(payload)
    })
}

fn build_doctor_preflight_payload(input: Option<&DoctorPreflightInput>) -> Value {
    json!({
        "startupProfile": input.and_then(|value| value.startup_profile.clone()),
        "readinessReportPath": input.and_then(|value| value.readiness_report_path.clone()),
        "controlPlaneThresholdProfile": input.and_then(|value| value.control_plane_threshold_profile.clone()),
        "incidentLogPaths": input.and_then(|value| value.incident_log_paths.clone()),
        "outputDir": input.and_then(|value| value.output_dir.clone()),
    })
}

fn runtime_snapshot_payload(
    app_handle: &AppHandle,
    manager: Option<&crate::process_manager::ProcessManager>,
    extras: Value,
) -> Value {
    let snapshot = build_runtime_snapshot(app_handle, manager, None);
    let mut payload = json!({
        "runtimeContext": snapshot.runtime_context,
        "dependencies": snapshot.dependencies,
    });

    if let (Value::Object(base), Value::Object(extra)) = (&mut payload, extras) {
        base.extend(extra);
    }

    payload
}

fn collect_dependency_statuses(
    app_handle: &AppHandle,
    manager: &crate::process_manager::ProcessManager,
) -> Value {
    runtime_snapshot_payload(app_handle, Some(manager), json!({}))
}

fn run_skillhub(args: &[String]) -> Result<String, String> {
    let executable = resolve_skillhub_executable()?;
    let output = Command::new(executable)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run skillhub: {e}"))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if !stderr.is_empty() { stderr } else { stdout })
}

fn sanitize_skillhub_name(slug: &str, raw_name: Option<&str>) -> String {
    let candidate = raw_name.unwrap_or("").trim();
    if candidate.is_empty() || candidate.starts_with("description:") {
        return slug.to_string();
    }
    candidate.to_string()
}

async fn ensure_sidecar_running(
    state: &State<'_, SidecarState>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    if !manager.is_running() {
        debug!("Sidecar not running, spawning...");
        manager
            .spawn(app_handle.clone())
            .map_err(|e| e.to_string())?;
        let _ = app_handle.emit("sidecar-reconnected", ());
    }
    Ok(())
}

async fn send_command_and_wait(
    state: &State<'_, SidecarState>,
    command: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    send_command_and_wait_with_timeout_policy(state, command, timeout_ms, true).await
}

async fn send_command_and_wait_with_timeout_policy(
    state: &State<'_, SidecarState>,
    command: Value,
    timeout_ms: u64,
    invalidate_transport_on_timeout: bool,
) -> Result<Value, String> {
    let command_id = command
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "command id missing".to_string())?
        .to_string();
    let rx = {
        let manager = state.0.lock().map_err(|e| e.to_string())?;
        manager
            .send_command_async(command)
            .map_err(|e| e.to_string())?
    };

    // Use tokio::task::spawn_blocking since recv_timeout blocks the thread
    let result = tokio::task::spawn_blocking(move || {
        match rx.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
            Ok(response) => Ok(response),
            Err(err) => Err(format!("response timeout: {}", err)),
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(response) => {
            if response.get("type").and_then(Value::as_str) == Some("transport_error_response") {
                let payload = response
                    .get("payload")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let error_message = payload
                    .get("details")
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("error").and_then(Value::as_str))
                    .unwrap_or("sidecar transport failed")
                    .to_string();
                if let Ok(mut manager) = state.0.lock() {
                    manager.invalidate_transport(&error_message);
                }
                return Err(error_message);
            }

            Ok(response)
        }
        Err(error_message) => {
            if let Ok(mut manager) = state.0.lock() {
                manager.clear_pending_response(&command_id);
                if invalidate_transport_on_timeout {
                    manager.invalidate_transport(&format!(
                        "command {} timed out waiting for sidecar ack",
                        command_id
                    ));
                }
            }
            Err(error_message)
        }
    }
}

fn is_response_timeout_error(error: &str) -> bool {
    error.starts_with("response timeout:")
}

fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle.path().app_data_dir().map_err(|e| e.to_string())
}

fn llm_config_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("llm-config.json"))
}

fn settings_store_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("settings.json"))
}

fn legacy_llm_config_path() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    Ok(cwd.join("..").join("sidecar").join("llm-config.json"))
}

fn normalize_openai_compatible_url(raw: &str, endpoint: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.ends_with(endpoint) {
        return trimmed.to_string();
    }
    format!("{trimmed}{endpoint}")
}

fn preferred_transcription_model_ids() -> &'static [&'static str] {
    &[
        "gpt-4o-mini-transcribe",
        "openai/gpt-4o-mini-transcribe",
        "gpt-4o-transcribe",
        "openai/gpt-4o-transcribe",
        "whisper-1",
        "openai/whisper-1",
    ]
}

fn default_transcription_model(provider: &str) -> String {
    match provider {
        "openai" => "gpt-4o-mini-transcribe".to_string(),
        _ => "whisper-1".to_string(),
    }
}

fn select_transcription_model_from_catalog(model_ids: &[String]) -> Option<String> {
    preferred_transcription_model_ids()
        .iter()
        .find_map(|candidate| {
            model_ids
                .iter()
                .find(|model_id| model_id.as_str() == *candidate)
                .cloned()
        })
}

fn openai_compatible_default(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("https://api.openai.com/v1"),
        "aiberm" => Some("https://aiberm.com/v1"),
        "nvidia" => Some("https://integrate.api.nvidia.com/v1"),
        "siliconflow" => Some("https://api.siliconflow.cn/v1"),
        "gemini" => Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        "qwen" => Some("https://dashscope.aliyuncs.com/compatible-mode/v1"),
        "minimax" => Some("https://api.minimaxi.com/v1"),
        "kimi" => Some("https://api.moonshot.cn/v1"),
        _ => None,
    }
}

fn openai_compatible_default_model(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("gpt-4o"),
        "aiberm" => Some("gpt-5.3-codex"),
        "nvidia" => Some("meta/llama-3.1-70b-instruct"),
        "siliconflow" => Some("Qwen/Qwen2.5-7B-Instruct"),
        "gemini" => Some("gemini-2.0-flash"),
        "qwen" => Some("qwen-plus"),
        "minimax" => Some("MiniMax-M2.7"),
        "kimi" => Some("moonshot-v1-8k"),
        _ => None,
    }
}

fn is_minimax_coding_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized == "codex-minimax-m2.7" || normalized == "minimax-m2.7"
}

fn normalize_openai_compatible_model(
    provider: &str,
    model: Option<&str>,
    default_model: &str,
) -> String {
    let selected = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_model);
    let without_openai_prefix = selected.strip_prefix("openai/").unwrap_or(selected).trim();

    if provider == "minimax" && is_minimax_coding_model(without_openai_prefix) {
        return "MiniMax-M2.7".to_string();
    }

    without_openai_prefix.to_string()
}

fn resolve_openai_compatible_base_url(
    provider: &str,
    base_url: Option<&str>,
    normalized_model: &str,
    default_base_url: &str,
) -> String {
    let selected = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_base_url)
        .trim()
        .trim_end_matches('/');

    if provider == "minimax"
        && is_minimax_coding_model(normalized_model)
        && selected.eq_ignore_ascii_case("https://api.minimax.chat/v1")
    {
        return "https://api.minimaxi.com/v1".to_string();
    }

    selected.to_string()
}

fn build_transcription_provider_from_profile(
    profile: &LlmProfile,
) -> Option<TranscriptionProvider> {
    let default_model = default_transcription_model(&profile.provider);

    match profile.provider.as_str() {
        "custom" => {
            let settings = profile.custom.as_ref()?;
            if settings.api_format.as_deref() == Some("anthropic") {
                return None;
            }
            let api_key = settings.api_key.as_ref()?.trim();
            let base_url = settings.base_url.as_ref()?.trim();
            if api_key.is_empty() || base_url.is_empty() {
                return None;
            }
            Some(TranscriptionProvider {
                provider: profile.provider.clone(),
                request_url: normalize_openai_compatible_url(base_url, "/audio/transcriptions"),
                models_url: normalize_openai_compatible_url(base_url, "/models"),
                api_key: api_key.to_string(),
                fallback_model: default_model,
                allow_insecure_tls: settings.allow_insecure_tls.unwrap_or(false),
            })
        }
        provider => {
            let settings = profile.openai.as_ref()?;
            let api_key = settings.api_key.as_ref()?.trim();
            if api_key.is_empty() {
                return None;
            }
            let base_url = settings
                .base_url
                .as_deref()
                .or_else(|| openai_compatible_default(provider))?;
            Some(TranscriptionProvider {
                provider: profile.provider.clone(),
                request_url: normalize_openai_compatible_url(base_url, "/audio/transcriptions"),
                models_url: normalize_openai_compatible_url(base_url, "/models"),
                api_key: api_key.to_string(),
                fallback_model: default_model,
                allow_insecure_tls: settings.allow_insecure_tls.unwrap_or(false),
            })
        }
    }
}

fn build_transcription_provider_from_legacy_config(
    config: &LlmConfig,
) -> Option<TranscriptionProvider> {
    let provider = config.provider.as_deref()?.to_string();
    let default_model = default_transcription_model(&provider);

    match provider.as_str() {
        "custom" => {
            let settings = config.custom.as_ref()?;
            if settings.api_format.as_deref() == Some("anthropic") {
                return None;
            }
            let api_key = settings.api_key.as_ref()?.trim();
            let base_url = settings.base_url.as_ref()?.trim();
            if api_key.is_empty() || base_url.is_empty() {
                return None;
            }
            Some(TranscriptionProvider {
                provider,
                request_url: normalize_openai_compatible_url(base_url, "/audio/transcriptions"),
                models_url: normalize_openai_compatible_url(base_url, "/models"),
                api_key: api_key.to_string(),
                fallback_model: default_model,
                allow_insecure_tls: settings.allow_insecure_tls.unwrap_or(false),
            })
        }
        other => {
            let settings = config.openai.as_ref()?;
            let api_key = settings.api_key.as_ref()?.trim();
            if api_key.is_empty() {
                return None;
            }
            let base_url = settings
                .base_url
                .as_deref()
                .or_else(|| openai_compatible_default(other))?;
            Some(TranscriptionProvider {
                provider,
                request_url: normalize_openai_compatible_url(base_url, "/audio/transcriptions"),
                models_url: normalize_openai_compatible_url(base_url, "/models"),
                api_key: api_key.to_string(),
                fallback_model: default_model,
                allow_insecure_tls: settings.allow_insecure_tls.unwrap_or(false),
            })
        }
    }
}

fn resolve_transcription_provider(config: &LlmConfig) -> Option<TranscriptionProvider> {
    if let Some(profiles) = &config.profiles {
        if let Some(active_profile_id) = &config.active_profile_id {
            if let Some(active) = profiles
                .iter()
                .find(|profile| &profile.id == active_profile_id)
            {
                if let Some(provider) = build_transcription_provider_from_profile(active) {
                    return Some(provider);
                }
            }
        }

        for profile in profiles {
            if Some(&profile.id) == config.active_profile_id.as_ref() {
                continue;
            }
            if let Some(provider) = build_transcription_provider_from_profile(profile) {
                return Some(provider);
            }
        }
    }

    build_transcription_provider_from_legacy_config(config)
}

async fn discover_transcription_model(
    provider: &TranscriptionProvider,
    proxy_settings: Option<&ProxySettings>,
) -> Result<Option<String>, String> {
    let mut client_builder = reqwest::Client::builder().timeout(Duration::from_secs(30));
    if provider.allow_insecure_tls {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }
    client_builder = apply_proxy_to_client_builder(client_builder, proxy_settings)?;
    let client = client_builder.build().map_err(|e| e.to_string())?;

    let response = client
        .get(&provider.models_url)
        .bearer_auth(&provider.api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "model discovery failed with status {}",
            response.status()
        ));
    }

    let payload = response.json::<Value>().await.map_err(|e| e.to_string())?;
    let model_ids = payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str).map(str::to_string))
        .collect::<Vec<_>>();

    Ok(select_transcription_model_from_catalog(&model_ids))
}

fn apply_proxy_to_client_builder(
    builder: reqwest::ClientBuilder,
    proxy_settings: Option<&ProxySettings>,
) -> Result<reqwest::ClientBuilder, String> {
    let Some(proxy) = proxy_settings else {
        return Ok(builder);
    };

    if proxy.enabled != Some(true) {
        return Ok(builder);
    }

    let Some(url) = proxy.url.as_ref() else {
        return Ok(builder);
    };

    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(builder);
    }

    Ok(builder.proxy(reqwest::Proxy::all(trimmed).map_err(|e| e.to_string())?))
}

fn sessions_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("sessions.json"))
}

fn startup_metrics_path(app_handle: &AppHandle, profile: &str) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("startup-metrics").join(format!("{profile}.jsonl")))
}

fn startup_profile() -> String {
    match std::env::var("COWORKANY_STARTUP_PROFILE") {
        Ok(value) if value.eq_ignore_ascii_case("baseline") => "baseline".to_string(),
        _ => "optimized".to_string(),
    }
}

fn startup_measurement_enabled() -> bool {
    matches!(
        std::env::var("COWORKANY_STARTUP_MEASURE")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn summarize_attachment_content_for_log(content: &str) -> String {
    let image_count = content.matches("<image_base64").count();
    let file_count = content.matches("<attached_file").count();
    let text_preview = content
        .replace('\n', " ")
        .replace('\r', " ")
        .chars()
        .take(120)
        .collect::<String>();

    format!(
        "len={}, image_tags={}, file_tags={}, preview=\"{}{}\"",
        content.len(),
        image_count,
        file_count,
        text_preview,
        if content.chars().count() > 120 {
            "…"
        } else {
            ""
        }
    )
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
    info!(
        "start_task command received: title={:?}, workspace_path={:?}, active_file={:?}, user_query={}",
        input.title,
        input.workspace_path,
        input.active_file,
        summarize_attachment_content_for_log(&input.user_query)
    );

    // Generate new task ID
    let task_id = Uuid::new_v4().to_string();

    // Ensure sidecar is running
    ensure_sidecar_running(&state, &app_handle).await?;

    // Build context
    let context = TaskContext {
        workspace_path: input.workspace_path,
        active_file: input.active_file,
        display_text: input.display_text,
        selected_text: None,
        open_files: None,
        environment_context: Some(build_platform_runtime_context(&app_handle, None)),
    };

    let config = input.config.map(|cfg| TaskConfig {
        model_id: cfg.model_id,
        execution_path: cfg.execution_path,
        max_tokens: cfg.max_tokens,
        max_history_messages: cfg.max_history_messages,
        enabled_claude_skills: cfg.enabled_claude_skills,
        enabled_toolpacks: cfg.enabled_toolpacks,
        enabled_skills: cfg.enabled_skills,
        voice_provider_mode: cfg.voice_provider_mode,
    });

    // Send command to sidecar and wait for the immediate ack so the frontend
    // can stay in sync with any workspace metadata updates (e.g. auto-rename).
    let command = serde_json::to_value(IpcCommand::start_task(
        task_id.clone(),
        input.title,
        input.user_query,
        context,
        config,
    ))
    .map_err(|e| e.to_string())?;

    let response = send_command_and_wait(&state, command, 10000).await?;
    let payload = response
        .get("payload")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let success = payload
        .get("success")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let response_task_id = payload
        .get("taskId")
        .and_then(|value| value.as_str())
        .unwrap_or(task_id.as_str())
        .to_string();
    let workspace = payload.get("workspace").cloned();
    let turn_id = payload
        .get("turnId")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let queue_position = payload
        .get("queuePosition")
        .and_then(|value| value.as_u64())
        .map(|value| value as u32);
    let error = payload
        .get("error")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    Ok(StartTaskResult {
        success,
        task_id: response_task_id,
        turn_id,
        queue_position,
        workspace,
        error,
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
    let response = send_command_and_wait(&state, command, 3000).await?;

    // meaningful data is in response.payload
    let inner_payload = response.get("payload").cloned().unwrap_or(json!({}));

    Ok(GenericIpcResult {
        success: true,
        payload: inner_payload,
    })
}

#[tauri::command]
pub async fn run_doctor_preflight(
    input: Option<DoctorPreflightInput>,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let command = build_command(
        "doctor_preflight",
        build_doctor_preflight_payload(input.as_ref()),
    );
    let response = send_command_and_wait(&state, command, 120000).await?;
    let inner_payload = response.get("payload").cloned().unwrap_or(json!({}));
    let success = inner_payload
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Ok(GenericIpcResult {
        success,
        payload: inner_payload,
    })
}

/// Get current voice playback state from sidecar
#[tauri::command]
pub async fn get_voice_state(
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let command = build_command("get_voice_state", json!({}));
    let response =
        match send_command_and_wait_with_timeout_policy(&state, command, 3000, false).await {
            Ok(response) => response,
            Err(error) => {
                warn!(
                    "get_voice_state timed out without invalidating sidecar transport: {}",
                    error
                );
                return Ok(GenericIpcResult {
                    success: true,
                    payload: json!({
                        "success": true,
                        "state": {
                            "isSpeaking": false,
                            "canStop": false
                        },
                        "degraded": true,
                        "error": error
                    }),
                });
            }
        };
    let inner_payload = response.get("payload").cloned().unwrap_or(json!({}));

    Ok(GenericIpcResult {
        success: true,
        payload: inner_payload,
    })
}

/// Get current voice provider preference from sidecar
#[tauri::command]
pub async fn get_voice_provider_status(
    input: Option<VoiceProviderStatusInput>,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let provider_mode = input.and_then(|value| value.provider_mode);
    let command = build_command(
        "get_voice_provider_status",
        json!({
            "providerMode": provider_mode,
        }),
    );
    let response =
        match send_command_and_wait_with_timeout_policy(&state, command, 3000, false).await {
            Ok(response) => response,
            Err(error) => {
                warn!(
                "get_voice_provider_status timed out without invalidating sidecar transport: {}",
                error
            );
                return Ok(GenericIpcResult {
                    success: true,
                    payload: json!({
                        "success": true,
                        "preferredAsr": "system",
                        "hasCustomAsr": false,
                        "degraded": true,
                        "error": error
                    }),
                });
            }
        };
    let inner_payload = response.get("payload").cloned().unwrap_or(json!({}));

    Ok(GenericIpcResult {
        success: true,
        payload: inner_payload,
    })
}

/// Stop current voice playback in sidecar
#[tauri::command]
pub async fn stop_voice(
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let command = build_command("stop_voice", json!({}));
    let response =
        match send_command_and_wait_with_timeout_policy(&state, command, 3000, false).await {
            Ok(response) => response,
            Err(error) => {
                warn!(
                    "stop_voice timed out without invalidating sidecar transport: {}",
                    error
                );
                return Ok(GenericIpcResult {
                    success: true,
                    payload: json!({
                        "success": false,
                        "stopped": false,
                        "state": {
                            "isSpeaking": false,
                            "canStop": false
                        },
                        "error": error
                    }),
                });
            }
        };
    let inner_payload = response.get("payload").cloned().unwrap_or(json!({}));

    Ok(GenericIpcResult {
        success: true,
        payload: inner_payload,
    })
}

/// Start native system ASR when the host platform supports it.
#[tauri::command]
pub async fn start_native_asr(
    input: Option<NativeAsrInput>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    if !platform_asr::is_supported() {
        return Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": "speech_not_supported",
            }),
        });
    }

    let app_for_emit = app_handle.clone();
    platform_asr::set_segment_callback(Some(std::sync::Arc::new(move |event| {
        info!(
            "native_asr segment locale={:?} confidence={:?} text={}",
            event.locale, event.confidence, event.text
        );
        let _ = app_for_emit.emit(
            "native-asr-segment",
            json!({
                "text": event.text,
                "locale": event.locale,
                "confidence": event.confidence,
            }),
        );
    })));

    let language = input
        .and_then(|value| value.language)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    info!("start_native_asr: language_hint={:?}", language);

    match platform_asr::start(language.as_deref()) {
        Ok(()) => Ok(GenericIpcResult {
            success: true,
            payload: json!({
                "supported": true,
            }),
        }),
        Err(err) => {
            platform_asr::set_segment_callback(None);
            Ok(GenericIpcResult {
                success: false,
                payload: json!({
                    "error": err.code,
                    "details": err.message,
                }),
            })
        }
    }
}

/// Stop native system ASR and return the captured transcript.
#[tauri::command]
pub async fn stop_native_asr() -> Result<GenericIpcResult, String> {
    if !platform_asr::is_supported() {
        return Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": "speech_not_supported",
            }),
        });
    }

    info!("stop_native_asr");
    let result = match platform_asr::stop() {
        Ok(transcript) => Ok(GenericIpcResult {
            success: true,
            payload: json!({
                "text": transcript,
            }),
        }),
        Err(err) => Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": err.code,
                "details": err.message,
            }),
        }),
    };
    platform_asr::set_segment_callback(None);
    result
}

/// Transcribe recorded voice input using a configured OpenAI-compatible endpoint.
#[tauri::command]
pub async fn transcribe_audio(
    input: TranscribeAudioInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let provider_mode = input.provider_mode.as_deref();
    let allow_remote_provider_fallback = provider_mode.is_none();
    ensure_sidecar_running(&state, &app_handle).await?;
    let custom_command = build_command(
        "transcribe_voice",
        json!({
            "audioBase64": input.audio_base64.clone(),
            "mimeType": input.mime_type.clone(),
            "language": input.language.clone(),
            "providerMode": input.provider_mode.clone(),
        }),
    );
    let custom_response = send_command_and_wait(&state, custom_command, 30000).await?;
    let custom_payload = custom_response.get("payload").cloned().unwrap_or(json!({}));
    if custom_payload.get("success").and_then(Value::as_bool) == Some(true) {
        return Ok(GenericIpcResult {
            success: true,
            payload: json!({
                "text": custom_payload.get("text").and_then(Value::as_str).unwrap_or_default(),
                "provider": custom_payload.get("providerName").cloned().unwrap_or_else(|| json!("custom")),
            }),
        });
    }
    if custom_payload.get("error").and_then(Value::as_str) != Some("transcription_unavailable") {
        return Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": custom_payload.get("error").and_then(Value::as_str).unwrap_or("transcription_failed"),
                "provider": custom_payload.get("providerName").cloned().unwrap_or_else(|| json!("custom")),
            }),
        });
    }

    if !allow_remote_provider_fallback {
        return Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": "transcription_unavailable",
            }),
        });
    }

    let config = get_llm_settings(app_handle.clone()).await?.payload;
    let Some(provider) = resolve_transcription_provider(&config) else {
        return Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": "transcription_unavailable",
            }),
        });
    };
    let selected_model = match discover_transcription_model(&provider, config.proxy.as_ref()).await
    {
        Ok(Some(model)) => model,
        Ok(None) => {
            return Ok(GenericIpcResult {
                success: false,
                payload: json!({
                    "error": "transcription_unavailable",
                    "provider": provider.provider,
                }),
            });
        }
        Err(err) => {
            debug!(
                "transcribe_audio: model discovery failed for provider {}: {}. Falling back to {}",
                provider.provider, err, provider.fallback_model
            );
            provider.fallback_model.clone()
        }
    };

    let audio_bytes = match BASE64_STANDARD.decode(input.audio_base64.as_bytes()) {
        Ok(bytes) if !bytes.is_empty() => bytes,
        Ok(_) => {
            return Ok(GenericIpcResult {
                success: false,
                payload: json!({
                    "error": "empty_audio",
                }),
            });
        }
        Err(err) => {
            error!("transcribe_audio: failed to decode base64 audio: {}", err);
            return Ok(GenericIpcResult {
                success: false,
                payload: json!({
                    "error": "invalid_audio",
                }),
            });
        }
    };

    let mime_type = input
        .mime_type
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("audio/webm");

    let mut form = reqwest::multipart::Form::new()
        .text("model", selected_model.clone())
        .part(
            "file",
            reqwest::multipart::Part::bytes(audio_bytes)
                .file_name("voice-input.webm")
                .mime_str(mime_type)
                .map_err(|e| e.to_string())?,
        );

    if let Some(language) = input
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        form = form.text("language", language.to_string());
    }

    let mut client_builder = reqwest::Client::builder().timeout(Duration::from_secs(120));
    if provider.allow_insecure_tls {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }
    client_builder = apply_proxy_to_client_builder(client_builder, config.proxy.as_ref())?;
    let client = client_builder.build().map_err(|e| e.to_string())?;

    let response = client
        .post(&provider.request_url)
        .bearer_auth(&provider.api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        let error_code = if error_body.contains("\"model_not_found\"") {
            "transcription_unavailable"
        } else {
            "transcription_failed"
        };
        error!(
            "transcribe_audio: provider={} model={} status={} body={}",
            provider.provider, selected_model, status, error_body
        );
        return Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": error_code,
                "details": format!("{} {}", status, error_body),
                "provider": provider.provider,
            }),
        });
    }

    let payload = response.json::<Value>().await.map_err(|e| e.to_string())?;
    let text = payload
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();

    if text.is_empty() {
        return Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": "no_speech",
                "provider": provider.provider,
            }),
        });
    }

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "text": text,
            "provider": provider.provider,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        apply_proxy_to_client_builder, build_doctor_preflight_payload,
        build_validation_request_plan, normalize_openai_compatible_model,
        resolve_openai_compatible_base_url, select_transcription_model_from_catalog,
        AnthropicProviderSettings, CustomProviderSettings, DoctorPreflightInput,
        OpenAIProviderSettings, OpenRouterProviderSettings, ProxySettings, StartTaskConfigInput,
        ValidateLlmInput, ValidationAuthScheme,
    };
    use crate::sidecar::TaskConfig;
    use serde_json::json;
    use std::env;
    use std::time::Duration;

    #[test]
    fn prefers_openai_realtime_transcription_models_over_whisper() {
        let models = vec![
            "whisper-1".to_string(),
            "gpt-4o-mini-transcribe".to_string(),
        ];

        assert_eq!(
            select_transcription_model_from_catalog(&models),
            Some("gpt-4o-mini-transcribe".to_string())
        );
    }

    #[test]
    fn returns_none_when_provider_catalog_has_no_supported_transcription_model() {
        let models = vec![
            "gpt-5.3-codex".to_string(),
            "text-embedding-3-small".to_string(),
        ];

        assert_eq!(select_transcription_model_from_catalog(&models), None);
    }

    #[test]
    fn normalize_openai_compatible_model_canonicalizes_minimax_coding_model() {
        assert_eq!(
            normalize_openai_compatible_model(
                "minimax",
                Some("codex-minimax-m2.7"),
                "MiniMax-M2.7"
            ),
            "MiniMax-M2.7"
        );
    }

    #[test]
    fn normalize_openai_compatible_model_strips_openai_prefix() {
        assert_eq!(
            normalize_openai_compatible_model(
                "minimax",
                Some("openai/MiniMax-Text-01"),
                "MiniMax-M2.7"
            ),
            "MiniMax-Text-01"
        );
    }

    #[test]
    fn resolve_openai_compatible_base_url_upgrades_minimax_coding_model_endpoint() {
        assert_eq!(
            resolve_openai_compatible_base_url(
                "minimax",
                Some("https://api.minimax.chat/v1"),
                "MiniMax-M2.7",
                "https://api.minimaxi.com/v1"
            ),
            "https://api.minimaxi.com/v1"
        );
    }

    #[test]
    fn start_task_config_input_parses_execution_path_and_maps_to_sidecar_task_config() {
        let cfg: StartTaskConfigInput = serde_json::from_value(json!({
            "modelId": "openai/gpt-5.3-codex",
            "executionPath": "direct",
            "maxTokens": 2048
        }))
        .expect("deserialize StartTaskConfigInput");

        assert_eq!(cfg.execution_path.as_deref(), Some("direct"));

        let sidecar_cfg = TaskConfig {
            model_id: cfg.model_id,
            execution_path: cfg.execution_path,
            max_tokens: cfg.max_tokens,
            max_history_messages: cfg.max_history_messages,
            enabled_claude_skills: cfg.enabled_claude_skills,
            enabled_toolpacks: cfg.enabled_toolpacks,
            enabled_skills: cfg.enabled_skills,
            voice_provider_mode: cfg.voice_provider_mode,
        };
        let serialized = serde_json::to_value(sidecar_cfg).expect("serialize TaskConfig");
        assert_eq!(serialized.get("executionPath"), Some(&json!("direct")));
    }

    #[test]
    fn build_doctor_preflight_payload_maps_all_fields() {
        let payload = build_doctor_preflight_payload(Some(&DoctorPreflightInput {
            startup_profile: Some("beta".to_string()),
            readiness_report_path: Some("/tmp/readiness.json".to_string()),
            control_plane_threshold_profile: Some("ga".to_string()),
            incident_log_paths: Some(vec!["/tmp/incidents".to_string()]),
            output_dir: Some("/tmp/doctor".to_string()),
        }));

        assert_eq!(
            payload,
            json!({
                "startupProfile": "beta",
                "readinessReportPath": "/tmp/readiness.json",
                "controlPlaneThresholdProfile": "ga",
                "incidentLogPaths": ["/tmp/incidents"],
                "outputDir": "/tmp/doctor",
            })
        );
    }

    #[test]
    fn build_doctor_preflight_payload_allows_empty_input() {
        let payload = build_doctor_preflight_payload(None);
        assert_eq!(
            payload,
            json!({
                "startupProfile": null,
                "readinessReportPath": null,
                "controlPlaneThresholdProfile": null,
                "incidentLogPaths": null,
                "outputDir": null,
            })
        );
    }

    async fn send_validation_request_real(
        client: &reqwest::Client,
        input: ValidateLlmInput,
    ) -> Result<reqwest::StatusCode, String> {
        let plan = build_validation_request_plan(input)?;
        let mut last_error: Option<String> = None;
        for attempt in 1..=2 {
            let mut request = client.post(&plan.url);
            if plan.auth_scheme == ValidationAuthScheme::Anthropic {
                request = request
                    .header("x-api-key", plan.api_key.clone())
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json");
            } else {
                request = request
                    .header("Authorization", format!("Bearer {}", plan.api_key.clone()))
                    .header("content-type", "application/json");
            }

            match request.json(&plan.body).send().await {
                Ok(response) => return Ok(response.status()),
                Err(err) => {
                    last_error = Some(format!("attempt {attempt}: {}", err));
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
        Err(last_error.unwrap_or_else(|| "request failed without error message".to_string()))
    }

    fn openai_compatible_real_input(provider: &str, api_key: String) -> ValidateLlmInput {
        ValidateLlmInput {
            provider: provider.to_string(),
            anthropic: None,
            openrouter: None,
            openai: Some(OpenAIProviderSettings {
                api_key: Some(api_key),
                base_url: None,
                model: None,
                allow_insecure_tls: None,
            }),
            custom: None,
            proxy: None,
        }
    }

    #[tokio::test]
    #[ignore = "Real connectivity test. Run manually with RUN_REAL_LLM_CONNECTIVITY_TESTS=1."]
    async fn real_llm_provider_connectivity_matrix() {
        if env::var("RUN_REAL_LLM_CONNECTIVITY_TESTS").ok().as_deref() != Some("1") {
            eprintln!("skip: set RUN_REAL_LLM_CONNECTIVITY_TESTS=1 to run real provider connectivity checks");
            return;
        }

        let strict = matches!(
            env::var("RUN_REAL_LLM_CONNECTIVITY_STRICT").ok().as_deref(),
            Some("1") | Some("true") | Some("TRUE")
        );
        let proxy_url = env::var("REAL_LLM_PROXY_URL")
            .ok()
            .or_else(|| env::var("COWORKANY_PROXY_URL").ok())
            .or_else(|| env::var("HTTPS_PROXY").ok())
            .or_else(|| env::var("https_proxy").ok());
        let proxy = proxy_url.and_then(|raw| {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(ProxySettings {
                    enabled: Some(true),
                    url: Some(trimmed),
                    bypass: env::var("REAL_LLM_PROXY_BYPASS").ok(),
                })
            }
        });

        let mut client_builder = reqwest::Client::builder().timeout(Duration::from_secs(20));
        client_builder = apply_proxy_to_client_builder(client_builder, proxy.as_ref())
            .expect("proxy settings should be valid");
        let client = client_builder
            .build()
            .expect("build connectivity test client");

        let mut cases: Vec<(&str, ValidateLlmInput)> = Vec::new();
        let mut missing: Vec<&str> = Vec::new();

        let anthropic_key = env::var("REAL_ANTHROPIC_API_KEY").ok();
        if let Some(key) = anthropic_key {
            cases.push((
                "anthropic",
                ValidateLlmInput {
                    provider: "anthropic".to_string(),
                    anthropic: Some(AnthropicProviderSettings {
                        api_key: Some(key),
                        model: Some("claude-sonnet-4-5".to_string()),
                    }),
                    openrouter: None,
                    openai: None,
                    custom: None,
                    proxy: None,
                },
            ));
        } else {
            missing.push("anthropic");
        }

        let openrouter_key = env::var("REAL_OPENROUTER_API_KEY").ok();
        if let Some(key) = openrouter_key {
            cases.push((
                "openrouter",
                ValidateLlmInput {
                    provider: "openrouter".to_string(),
                    anthropic: None,
                    openrouter: Some(OpenRouterProviderSettings {
                        api_key: Some(key),
                        model: Some("anthropic/claude-sonnet-4.5".to_string()),
                    }),
                    openai: None,
                    custom: None,
                    proxy: None,
                },
            ));
        } else {
            missing.push("openrouter");
        }

        for provider in [
            "openai",
            "aiberm",
            "nvidia",
            "siliconflow",
            "gemini",
            "qwen",
            "minimax",
            "kimi",
        ] {
            let env_key = format!("REAL_{}_API_KEY", provider.to_ascii_uppercase());
            match env::var(&env_key).ok() {
                Some(key) => cases.push((provider, openai_compatible_real_input(provider, key))),
                None => missing.push(provider),
            }
        }

        if strict && !missing.is_empty() {
            panic!(
                "missing API keys for strict real connectivity matrix: {}",
                missing.join(", ")
            );
        }

        if cases.is_empty() {
            eprintln!(
                "skip: no real provider API keys found. Set REAL_<PROVIDER>_API_KEY env vars."
            );
            return;
        }

        let custom_openai_key = env::var("REAL_CUSTOM_OPENAI_API_KEY").ok();
        if let Some(key) = custom_openai_key {
            let base_url = env::var("REAL_CUSTOM_OPENAI_BASE_URL")
                .unwrap_or_else(|_| "https://api.openai.com/v1/chat/completions".to_string());
            let model =
                env::var("REAL_CUSTOM_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o".to_string());
            cases.push((
                "custom-openai",
                ValidateLlmInput {
                    provider: "custom".to_string(),
                    anthropic: None,
                    openrouter: None,
                    openai: None,
                    custom: Some(CustomProviderSettings {
                        api_key: Some(key),
                        base_url: Some(base_url),
                        model: Some(model),
                        allow_insecure_tls: None,
                        api_format: Some("openai".to_string()),
                    }),
                    proxy: None,
                },
            ));
        }

        let custom_anthropic_key = env::var("REAL_CUSTOM_ANTHROPIC_API_KEY").ok();
        if let Some(key) = custom_anthropic_key {
            let base_url = env::var("REAL_CUSTOM_ANTHROPIC_BASE_URL")
                .unwrap_or_else(|_| "https://api.anthropic.com/v1/messages".to_string());
            let model = env::var("REAL_CUSTOM_ANTHROPIC_MODEL")
                .unwrap_or_else(|_| "claude-sonnet-4-5".to_string());
            cases.push((
                "custom-anthropic",
                ValidateLlmInput {
                    provider: "custom".to_string(),
                    anthropic: None,
                    openrouter: None,
                    openai: None,
                    custom: Some(CustomProviderSettings {
                        api_key: Some(key),
                        base_url: Some(base_url),
                        model: Some(model),
                        allow_insecure_tls: None,
                        api_format: Some("anthropic".to_string()),
                    }),
                    proxy: None,
                },
            ));
        }

        let mut failures: Vec<String> = Vec::new();
        for (label, input) in cases {
            match send_validation_request_real(&client, input).await {
                Ok(status) if status.is_success() => {}
                Ok(status) => failures.push(format!("{label}: status={status}")),
                Err(err) => failures.push(format!("{label}: request_error={err}")),
            }
        }

        assert!(
            failures.is_empty(),
            "real connectivity matrix failed:\n{}",
            failures.join("\n")
        );
    }
}

/// Send a message to an existing task
#[tauri::command]
pub async fn send_task_message(
    input: SendTaskMessageInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<SendTaskMessageResult, String> {
    info!(
        "send_task_message command received: task_id={}, content={}",
        input.task_id,
        summarize_attachment_content_for_log(&input.content)
    );

    ensure_sidecar_running(&state, &app_handle).await?;

    let config = input.config.map(|cfg| TaskConfig {
        model_id: cfg.model_id,
        execution_path: cfg.execution_path,
        max_tokens: cfg.max_tokens,
        max_history_messages: cfg.max_history_messages,
        enabled_claude_skills: cfg.enabled_claude_skills,
        enabled_toolpacks: cfg.enabled_toolpacks,
        enabled_skills: cfg.enabled_skills,
        voice_provider_mode: cfg.voice_provider_mode,
    });

    let task_id = input.task_id.clone();
    let command = serde_json::to_value(IpcCommand::send_task_message(
        task_id.clone(),
        input.content,
        Some(build_platform_runtime_context(&app_handle, None)),
        config,
    ))
    .map_err(|e| e.to_string())?;

    let response = match send_command_and_wait_with_timeout_policy(&state, command, 30000, false)
        .await
    {
        Ok(value) => value,
        Err(error_message) => {
            if error_message.starts_with("response timeout:") {
                warn!(
                    "send_task_message ack timed out; keeping transport healthy and treating as queued: task_id={}, detail={}",
                    task_id,
                    error_message
                );
                return Ok(SendTaskMessageResult {
                    success: true,
                    task_id,
                    turn_id: None,
                    queue_position: None,
                    deduplicated: None,
                    dedup_reason: None,
                    error: None,
                });
            }
            error!(
                "Failed to send send_task_message command: {}",
                error_message
            );
            return Ok(SendTaskMessageResult {
                success: false,
                task_id,
                turn_id: None,
                queue_position: None,
                deduplicated: None,
                dedup_reason: None,
                error: Some(error_message),
            });
        }
    };

    let payload = response
        .get("payload")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let success = payload
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let task_id = payload
        .get("taskId")
        .and_then(Value::as_str)
        .unwrap_or(task_id.as_str())
        .to_string();
    let error = payload
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| (!success).then(|| "send_task_message_failed".to_string()));
    let turn_id = payload
        .get("turnId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let queue_position = payload
        .get("queuePosition")
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let deduplicated = payload
        .get("deduplicated")
        .and_then(Value::as_bool);
    let dedup_reason = payload
        .get("dedupReason")
        .and_then(Value::as_str)
        .map(str::to_string);

    Ok(SendTaskMessageResult {
        success,
        task_id,
        turn_id,
        queue_position,
        deduplicated,
        dedup_reason,
        error,
    })
}

/// Resume a recoverable interrupted task from saved context
#[tauri::command]
pub async fn resume_interrupted_task(
    input: ResumeInterruptedTaskInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<ResumeInterruptedTaskResult, String> {
    info!(
        "resume_interrupted_task command received: task_id={}",
        input.task_id
    );

    ensure_sidecar_running(&state, &app_handle).await?;

    let config = input.config.map(|cfg| TaskConfig {
        model_id: cfg.model_id,
        execution_path: cfg.execution_path,
        max_tokens: cfg.max_tokens,
        max_history_messages: cfg.max_history_messages,
        enabled_claude_skills: cfg.enabled_claude_skills,
        enabled_toolpacks: cfg.enabled_toolpacks,
        enabled_skills: cfg.enabled_skills,
        voice_provider_mode: cfg.voice_provider_mode,
    });

    let command = IpcCommand::resume_interrupted_task(input.task_id.clone(), config);
    let command_value = serde_json::to_value(command).map_err(|e| e.to_string())?;
    let response = match send_command_and_wait(&state, command_value, 10000).await {
        Ok(value) => value,
        Err(error) => {
            return Ok(ResumeInterruptedTaskResult {
                success: false,
                task_id: input.task_id,
                error: Some(error),
            });
        }
    };
    let payload = response
        .get("payload")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let success = payload
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let error = payload
        .get("error")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| (!success).then(|| "resume_interrupted_task_failed".to_string()));

    Ok(ResumeInterruptedTaskResult {
        success,
        task_id: input.task_id,
        error,
    })
}

/// Get sidecar status
#[tauri::command]
pub async fn get_sidecar_status(
    state: State<'_, SidecarState>,
) -> Result<SidecarStatusResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;

    Ok(SidecarStatusResult {
        running: manager.is_running(),
    })
}

/// Get LLM config from the shared app data directory.
#[tauri::command]
pub async fn get_llm_settings(app_handle: AppHandle) -> Result<LlmConfigResult, String> {
    let path = llm_config_path(&app_handle)?;
    info!("get_llm_settings: reading from {:?}", path);

    let raw = if path.exists() {
        tokio::fs::read_to_string(&path).await.map_err(|e| {
            error!("get_llm_settings: failed to read file: {}", e);
            e.to_string()
        })?
    } else {
        let store_path = settings_store_path(&app_handle)?;
        if store_path.exists() {
            let store_raw = tokio::fs::read_to_string(&store_path).await.map_err(|e| {
                error!("get_llm_settings: failed to read settings store: {}", e);
                e.to_string()
            })?;
            if let Ok(store_json) = serde_json::from_str::<Value>(&store_raw) {
                if let Some(llm_config) = store_json.get("llmConfig") {
                    let migrated =
                        serde_json::to_string_pretty(llm_config).map_err(|e| e.to_string())?;
                    if let Some(parent) = path.parent() {
                        tokio::fs::create_dir_all(parent)
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                    tokio::fs::write(&path, &migrated)
                        .await
                        .map_err(|e| e.to_string())?;
                    info!("get_llm_settings: migrated llmConfig from settings.json");
                    migrated
                } else {
                    let legacy_path = legacy_llm_config_path()?;
                    if legacy_path.exists() {
                        let legacy_raw = tokio::fs::read_to_string(&legacy_path)
                            .await
                            .map_err(|e| e.to_string())?;
                        if let Some(parent) = path.parent() {
                            tokio::fs::create_dir_all(parent)
                                .await
                                .map_err(|e| e.to_string())?;
                        }
                        tokio::fs::write(&path, &legacy_raw)
                            .await
                            .map_err(|e| e.to_string())?;
                        info!("get_llm_settings: migrated legacy llm-config.json");
                        legacy_raw
                    } else {
                        info!("get_llm_settings: no config file found, returning default");
                        return Ok(LlmConfigResult {
                            success: true,
                            payload: LlmConfig::default(),
                            error: None,
                        });
                    }
                }
            } else {
                info!("get_llm_settings: settings.json invalid, returning default");
                return Ok(LlmConfigResult {
                    success: true,
                    payload: LlmConfig::default(),
                    error: None,
                });
            }
        } else {
            let legacy_path = legacy_llm_config_path()?;
            if legacy_path.exists() {
                let legacy_raw = tokio::fs::read_to_string(&legacy_path)
                    .await
                    .map_err(|e| e.to_string())?;
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                tokio::fs::write(&path, &legacy_raw)
                    .await
                    .map_err(|e| e.to_string())?;
                info!("get_llm_settings: migrated legacy llm-config.json");
                legacy_raw
            } else {
                info!("get_llm_settings: no config file found, returning default");
                return Ok(LlmConfigResult {
                    success: true,
                    payload: LlmConfig::default(),
                    error: None,
                });
            }
        }
    };

    info!("get_llm_settings: read {} bytes", raw.len());

    let config: LlmConfig = serde_json::from_str(&raw).map_err(|e| {
        error!("get_llm_settings: failed to parse JSON: {}", e);
        e.to_string()
    })?;

    info!(
        "get_llm_settings: parsed config, provider={:?}",
        config.provider
    );
    Ok(LlmConfigResult {
        success: true,
        payload: config,
        error: None,
    })
}

/// Save LLM config to the shared app data directory.
#[tauri::command]
pub async fn save_llm_settings(
    mut input: LlmConfig,
    app: AppHandle,
) -> Result<LlmConfigResult, String> {
    let path = llm_config_path(&app)?;
    info!("save_llm_settings: saving to {:?}", path);
    // Preserve the $schema field
    if input.schema.is_none() {
        input.schema = Some("./llm-config.schema.json".to_string());
    }

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, content).await.map_err(|e| {
        error!("save_llm_settings: failed to write file: {}", e);
        e.to_string()
    })?;

    info!(
        "save_llm_settings: saved config, provider={:?}",
        input.provider
    );

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
    pub openai: Option<OpenAIProviderSettings>,
    pub custom: Option<CustomProviderSettings>,
    pub proxy: Option<ProxySettings>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ValidationAuthScheme {
    Anthropic,
    Bearer,
}

#[derive(Debug, Clone)]
struct ValidationRequestPlan {
    provider: String,
    url: String,
    api_key: String,
    body: Value,
    auth_scheme: ValidationAuthScheme,
}

fn build_validation_request_plan(input: ValidateLlmInput) -> Result<ValidationRequestPlan, String> {
    let normalize_openai_compatible_url = |raw: &str| -> String {
        let trimmed = raw.trim().trim_end_matches('/');
        if trimmed.ends_with("/chat/completions") {
            trimmed.to_string()
        } else {
            format!("{}/chat/completions", trimmed)
        }
    };

    let provider = input.provider;
    match provider.as_str() {
        "anthropic" => {
            let settings = input.anthropic.ok_or("Missing Anthropic settings")?;
            let api_key = settings.api_key.ok_or("Missing API key")?;
            let model = settings
                .model
                .unwrap_or_else(|| "claude-3-5-sonnet-20240620".to_string());
            Ok(ValidationRequestPlan {
                provider,
                url: "https://api.anthropic.com/v1/messages".to_string(),
                api_key,
                body: json!({
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}]
                }),
                auth_scheme: ValidationAuthScheme::Anthropic,
            })
        }
        "openrouter" => {
            let settings = input.openrouter.ok_or("Missing OpenRouter settings")?;
            let api_key = settings.api_key.ok_or("Missing API key")?;
            let model = settings
                .model
                .unwrap_or_else(|| "anthropic/claude-3.5-sonnet".to_string());
            Ok(ValidationRequestPlan {
                provider,
                url: "https://openrouter.ai/api/v1/chat/completions".to_string(),
                api_key,
                body: json!({
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}]
                }),
                auth_scheme: ValidationAuthScheme::Bearer,
            })
        }
        "custom" => {
            let settings = input.custom.ok_or("Missing Custom settings")?;
            let api_key = settings.api_key.ok_or("Missing API key")?;
            let base_url = settings.base_url.ok_or("Missing Base URL")?;
            let model = settings.model.ok_or("Missing Model ID")?;
            let format = settings.api_format.unwrap_or_else(|| "openai".to_string());
            let auth_scheme = if format.eq_ignore_ascii_case("anthropic") {
                ValidationAuthScheme::Anthropic
            } else {
                ValidationAuthScheme::Bearer
            };

            Ok(ValidationRequestPlan {
                provider,
                url: base_url,
                api_key,
                body: json!({
                    "model": model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}]
                }),
                auth_scheme,
            })
        }
        provider_name => {
            if let (Some(default_url), Some(default_model)) = (
                openai_compatible_default(provider_name),
                openai_compatible_default_model(provider_name),
            ) {
                let settings = input.openai.ok_or("Missing OpenAI-compatible settings")?;
                let api_key = settings.api_key.ok_or("Missing API key")?;
                let model = normalize_openai_compatible_model(
                    provider_name,
                    settings.model.as_deref(),
                    default_model,
                );
                let base_url = resolve_openai_compatible_base_url(
                    provider_name,
                    settings.base_url.as_deref(),
                    &model,
                    default_url,
                );
                Ok(ValidationRequestPlan {
                    provider,
                    url: normalize_openai_compatible_url(&base_url),
                    api_key,
                    body: json!({
                        "model": model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}]
                    }),
                    auth_scheme: ValidationAuthScheme::Bearer,
                })
            } else {
                Err(format!("Unknown provider: {}", provider_name))
            }
        }
    }
}

/// Validate LLM connectivity
#[tauri::command]
pub async fn validate_llm_settings(
    input: ValidateLlmInput,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    info!(
        "validate_llm_settings: validating connectivity for {}",
        input.provider
    );

    let configured_proxy = match llm_config_path(&app_handle) {
        Ok(path) if path.exists() => tokio::fs::read_to_string(path)
            .await
            .ok()
            .and_then(|raw| serde_json::from_str::<LlmConfig>(&raw).ok())
            .and_then(|config| config.proxy),
        _ => None,
    };
    let proxy_settings = input.proxy.as_ref().or(configured_proxy.as_ref());

    let mut client_builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10));
    client_builder = apply_proxy_to_client_builder(client_builder, proxy_settings)?;
    let client = client_builder.build().map_err(|e| e.to_string())?;
    let plan = build_validation_request_plan(input)?;

    let mut request = client.post(&plan.url);

    if plan.auth_scheme == ValidationAuthScheme::Anthropic {
        request = request
            .header("x-api-key", plan.api_key.clone())
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json");
    } else {
        request = request
            .header("Authorization", format!("Bearer {}", plan.api_key))
            .header("content-type", "application/json");
    }

    let res = request
        .json(&plan.body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = res.status();
    if status.is_success() {
        info!(
            "validate_llm_settings: connectivity verified for {}",
            plan.provider
        );
        Ok(GenericIpcResult {
            success: true,
            payload: json!({ "message": "Connection successful" }),
        })
    } else {
        let error_text = res
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        error!("Validation failed with status {}: {}", status, error_text);
        Ok(GenericIpcResult {
            success: false,
            payload: json!({ "error": format!("Provider returned status {}: {}", status, error_text) }),
        })
    }
}

/// Get sessions snapshot from the shared app data directory.
#[tauri::command]
pub async fn load_sessions(app_handle: AppHandle) -> Result<SessionsSnapshotResult, String> {
    let path = sessions_path(&app_handle)?;
    if !path.exists() {
        return Ok(SessionsSnapshotResult {
            success: true,
            payload: SessionsSnapshot::default(),
            error: None,
        });
    }

    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;
    let snapshot: SessionsSnapshot = serde_json::from_str(&raw).unwrap_or_default();
    Ok(SessionsSnapshotResult {
        success: true,
        payload: snapshot,
        error: None,
    })
}

/// Get startup measurement configuration (driven by process env).
#[tauri::command]
pub fn get_startup_measurement_config() -> StartupMeasurementConfig {
    StartupMeasurementConfig {
        enabled: startup_measurement_enabled(),
        profile: startup_profile(),
        run_label: std::env::var("COWORKANY_STARTUP_RUN_LABEL").unwrap_or_default(),
    }
}

/// Record startup metric mark to .coworkany/startup-metrics/<profile>.jsonl
#[tauri::command]
pub async fn record_startup_metric(
    app_handle: AppHandle,
    input: StartupMetricInput,
) -> Result<GenericIpcResult, String> {
    init_startup_clock();

    let enabled = startup_measurement_enabled();
    let profile = startup_profile();
    let run_label = std::env::var("COWORKANY_STARTUP_RUN_LABEL").unwrap_or_default();

    let process_elapsed_ms = STARTUP_PROCESS_INSTANT
        .get_or_init(Instant::now)
        .elapsed()
        .as_millis();
    let process_start_epoch_ms = *STARTUP_PROCESS_EPOCH_MS.get_or_init(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    });
    let now_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let record = json!({
        "runLabel": run_label,
        "profile": profile,
        "mark": input.mark,
        "windowLabel": input.window_label,
        "processStartEpochMs": process_start_epoch_ms,
        "processElapsedMs": process_elapsed_ms,
        "frontendElapsedMs": input.frontend_elapsed_ms,
        "frontendPerfNowMs": input.perf_now_ms,
        "timestampEpochMs": now_epoch_ms,
    });

    let path = startup_metrics_path(&app_handle, &profile)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(format!("{}\n", record).as_bytes())
        .map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;

    if enabled && input.mark == "frontend_ready" {
        let app_to_exit = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(220)).await;
            app_to_exit.exit(0);
        });
    }

    Ok(GenericIpcResult {
        success: true,
        payload: json!({ "recorded": true }),
    })
}

/// Save sessions snapshot to the shared app data directory.
#[tauri::command]
pub async fn save_sessions(
    app_handle: AppHandle,
    input: SessionsSnapshot,
) -> Result<SessionsSnapshotResult, String> {
    let path = sessions_path(&app_handle)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string(&input).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SessionsSnapshotResult {
        success: true,
        payload: input,
        error: None,
    })
}

/// Get current workspace root (process cwd)
#[tauri::command]
pub async fn get_workspace_root() -> Result<String, String> {
    std::env::current_dir()
        .map_err(|e| e.to_string())
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_default_workspace_path(app_handle: AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app_handle)?
        .join("workspaces")
        .join("workspace");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

fn open_with_system_default(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

fn sanitize_filename(name: &str) -> String {
    let trimmed = name.trim();
    let fallback = "downloaded-file".to_string();
    if trimmed.is_empty() {
        return fallback;
    }

    let sanitized = trimmed
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();

    let collapsed = sanitized.trim_matches('.').trim().to_string();
    if collapsed.is_empty() {
        fallback
    } else {
        collapsed
    }
}

fn dedupe_download_path(dir: &PathBuf, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let original = PathBuf::from(file_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("downloaded-file");
    let extension = original
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value))
        .unwrap_or_default();

    for index in 1..10_000 {
        let next = dir.join(format!("{stem} ({index}){extension}"));
        if !next.exists() {
            return next;
        }
    }

    dir.join(format!("{stem}-{}", Uuid::new_v4()))
}

#[tauri::command]
pub async fn open_local_file(path: String) -> Result<(), String> {
    let candidate = PathBuf::from(path);
    if !candidate.exists() {
        return Err("File does not exist".to_string());
    }

    open_with_system_default(&candidate)
}

#[tauri::command]
pub async fn download_remote_file(
    input: DownloadRemoteFileInput,
) -> Result<DownloadRemoteFileResult, String> {
    let parsed = url::Url::parse(&input.url).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(parsed.clone())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status {}", response.status()));
    }

    let inferred_name = input
        .suggested_name
        .as_deref()
        .map(sanitize_filename)
        .or_else(|| {
            parsed
                .path_segments()
                .and_then(|segments| segments.last())
                .filter(|segment| !segment.is_empty())
                .map(sanitize_filename)
        })
        .unwrap_or_else(|| format!("download-{}", Uuid::new_v4()));

    let downloads_dir =
        dirs::download_dir().ok_or("Unable to resolve the system Downloads directory")?;
    fs::create_dir_all(&downloads_dir).map_err(|e| e.to_string())?;
    let target_path = dedupe_download_path(&downloads_dir, &inferred_name);

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&target_path, bytes)
        .await
        .map_err(|e| e.to_string())?;

    Ok(DownloadRemoteFileResult {
        saved_path: target_path.to_string_lossy().to_string(),
        file_name: target_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&inferred_name)
            .to_string(),
    })
}

#[tauri::command]
pub async fn read_text_file_preview(
    input: ReadTextFilePreviewInput,
) -> Result<TextPreviewResult, String> {
    let max_bytes = input.max_bytes.unwrap_or(1024 * 1024) as usize;
    let bytes = tokio::fs::read(&input.path)
        .await
        .map_err(|e| e.to_string())?;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated {
        &bytes[..max_bytes]
    } else {
        &bytes[..]
    };

    Ok(TextPreviewResult {
        content: String::from_utf8_lossy(slice).to_string(),
        truncated,
    })
}

#[tauri::command]
pub async fn fetch_remote_text_preview(
    input: FetchRemoteTextPreviewInput,
) -> Result<TextPreviewResult, String> {
    let max_bytes = input.max_bytes.unwrap_or(1024 * 1024) as usize;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&input.url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Preview request failed with status {}",
            response.status()
        ));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated {
        &bytes[..max_bytes]
    } else {
        &bytes[..]
    };

    Ok(TextPreviewResult {
        content: String::from_utf8_lossy(slice).to_string(),
        truncated,
    })
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
pub async fn shutdown_sidecar(state: State<'_, SidecarState>) -> Result<(), String> {
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
    let response =
        match send_command_and_wait_with_timeout_policy(&state, command, 3000, false).await {
            Ok(response) => response,
            Err(error) => {
                if is_response_timeout_error(&error) {
                    warn!(
                        "list_toolpacks timed out without invalidating sidecar transport: {}",
                        error
                    );
                    json!({
                        "type": "list_toolpacks_response",
                        "payload": {
                            "success": true,
                            "toolpacks": [],
                            "degraded": true,
                            "error": error,
                        }
                    })
                } else {
                    return Err(error);
                }
            }
        };
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
        "approvePermissionExpansion": input.approve_permission_expansion.unwrap_or(false),
    });
    let command = build_command("install_toolpack", payload);
    let response = send_command_and_wait(&state, command, 5000).await?;
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
    let response = send_command_and_wait(&state, command, 5000).await?;
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
    let response =
        match send_command_and_wait_with_timeout_policy(&state, command, 3000, false).await {
            Ok(response) => response,
            Err(error) => {
                if is_response_timeout_error(&error) {
                    warn!(
                        "list_claude_skills timed out without invalidating sidecar transport: {}",
                        error
                    );
                    json!({
                        "type": "list_claude_skills_response",
                        "payload": {
                            "success": true,
                            "skills": [],
                            "degraded": true,
                            "error": error,
                        }
                    })
                } else {
                    return Err(error);
                }
            }
        };
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
        "autoInstallDependencies": input.auto_install_dependencies.unwrap_or(true),
        "approvePermissionExpansion": input.approve_permission_expansion.unwrap_or(false),
    });
    let command = build_command("import_claude_skill", payload);
    let response = send_command_and_wait(&state, command, 5000).await?;
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
pub async fn list_directives(
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let command = build_command("list_directives", json!({}));
    let response = send_command_and_wait(&state, command, 3000).await?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn upsert_directive(
    input: UpsertDirectiveInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "directive": input.directive,
    });
    let command = build_command("upsert_directive", payload);
    let response = send_command_and_wait(&state, command, 3000).await?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn remove_directive(
    input: RemoveDirectiveInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "directiveId": input.directive_id,
    });
    let command = build_command("remove_directive", payload);
    let response = send_command_and_wait(&state, command, 3000).await?;
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
    let response = send_command_and_wait(&state, command, 5000).await?;
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
    #[serde(rename = "approvePermissionExpansion")]
    pub approve_permission_expansion: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSkillhubInput {
    pub query: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallFromSkillhubInput {
    pub slug: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
}

#[tauri::command]
pub async fn list_workspaces(
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let command = build_command("list_workspaces", json!({}));
    let response =
        match send_command_and_wait_with_timeout_policy(&state, command, 3000, false).await {
            Ok(response) => response,
            Err(error) => {
                if is_response_timeout_error(&error) {
                    warn!(
                        "list_workspaces timed out without invalidating sidecar transport: {}",
                        error
                    );
                    json!({
                        "type": "list_workspaces_response",
                        "payload": {
                            "success": true,
                            "workspaces": [],
                            "degraded": true,
                            "error": error,
                        }
                    })
                } else {
                    return Err(error);
                }
            }
        };
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
    let response = send_command_and_wait(&state, command, 3000).await?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UpdateWorkspaceFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(rename = "autoNamed")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_named: Option<bool>,
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
        "approvePermissionExpansion": input.approve_permission_expansion.unwrap_or(false),
    });
    let command = build_command("install_from_github", payload);
    // GitHub downloads may take a while
    let response = send_command_and_wait(&state, command, 30000).await?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn search_skillhub_skills(
    input: SearchSkillhubInput,
) -> Result<GenericIpcResult, String> {
    let mut args = vec!["--skip-self-upgrade".to_string(), "search".to_string()];
    if let Some(query) = input.query {
        let trimmed = query.trim();
        if !trimmed.is_empty() {
            args.extend(trimmed.split_whitespace().map(|part| part.to_string()));
        }
    }
    args.push("--json".to_string());

    let stdout = run_skillhub(&args)?;
    let raw: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse skillhub search output: {e}"))?;

    let skills = raw
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            let slug = entry.get("slug")?.as_str()?.trim().to_string();
            if slug.is_empty() {
                return None;
            }
            let name = sanitize_skillhub_name(&slug, entry.get("name").and_then(|v| v.as_str()));
            let description = entry
                .get("description")
                .and_then(|v| v.as_str())
                .or_else(|| entry.get("summary").and_then(|v| v.as_str()))
                .unwrap_or("")
                .trim()
                .to_string();

            Some(json!({
                "name": name,
                "description": description,
                "path": slug,
                "source": format!("skillhub:{slug}"),
                "runtime": "unknown",
                "hasScripts": false,
            }))
        })
        .collect::<Vec<_>>();

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "skills": skills,
            "source": "skillhub",
        }),
    })
}

#[tauri::command]
pub async fn install_from_skillhub(
    input: InstallFromSkillhubInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let install_root = PathBuf::from(&input.workspace_path)
        .join(".coworkany")
        .join("skills");

    fs::create_dir_all(&install_root)
        .map_err(|e| format!("Failed to create skill install dir: {e}"))?;

    let args = vec![
        "--skip-self-upgrade".to_string(),
        "--dir".to_string(),
        install_root.to_string_lossy().to_string(),
        "install".to_string(),
        input.slug.clone(),
    ];

    let stdout = run_skillhub(&args)?;
    let skill_path = install_root.join(&input.slug);
    if !skill_path.exists() {
        return Err(format!(
            "Skillhub reported success, but installed skill directory was not found: {}",
            skill_path.display()
        ));
    }

    ensure_sidecar_running(&state, &app_handle).await?;
    let import_payload = json!({
        "source": "local_folder",
        "path": skill_path,
        "overwrite": true,
    });
    let command = build_command("import_claude_skill", import_payload);
    let response = send_command_and_wait(&state, command, 5000).await?;
    let imported = response
        .get("payload")
        .and_then(|p| p.get("success"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if imported {
        let _ = app_handle.emit("skills-updated", ());
    }

    Ok(GenericIpcResult {
        success: imported,
        payload: json!({
            "success": imported,
            "slug": input.slug,
            "path": skill_path,
            "cliOutput": stdout,
            "sidecar": response,
        }),
    })
}

#[tauri::command]
pub fn get_dependency_statuses(
    state: State<'_, ProcessManagerState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.set_app_handle(app_handle.clone());

    Ok(GenericIpcResult {
        success: true,
        payload: collect_dependency_statuses(&app_handle, &manager),
    })
}

const SKILLHUB_KIT_URL: &str =
    "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz";

fn install_skillhub_windows() -> Result<PathBuf, String> {
    info!("install_skillhub_windows: using npm to install skillhub");

    // Use npm to install skillhub globally
    let npm_output = Command::new("npm")
        .args(["install", "-g", "@skills-hub-ai/cli"])
        .output()
        .map_err(|e| format!("Failed to run npm: {e}. Make sure Node.js is installed."))?;

    if !npm_output.status.success() {
        let stderr = String::from_utf8_lossy(&npm_output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&npm_output.stdout).to_string();
        let message = if !stderr.is_empty() { stderr } else { stdout };
        error!("install_skillhub_windows: npm install failed: {}", message);
        return Err(format!("npm install failed: {message}"));
    }

    info!("install_skillhub_windows: npm install completed successfully");

    // Try to find the installed binary
    // First check if it's in PATH (global npm install should add it)
    if let Some(userprofile) = std::env::var_os("USERPROFILE") {
        // Check common npm global install locations on Windows
        let npm_global = PathBuf::from(&userprofile)
            .join("AppData")
            .join("Roaming")
            .join("npm");
        let candidate = npm_global.join("skills-hub-ai.cmd");
        if candidate.exists() {
            info!("install_skillhub_windows: found at {:?}", candidate);
            return Ok(candidate);
        }

        // Also check for skillhub.exe directly
        let candidate2 = npm_global.join("skillhub.cmd");
        if candidate2.exists() {
            info!("install_skillhub_windows: found at {:?}", candidate2);
            return Ok(candidate2);
        }
    }

    // Try to find via where command
    let where_output = Command::new("where").arg("skills-hub-ai").output();
    if let Ok(output) = where_output {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                let path = PathBuf::from(path_str);
                info!("install_skillhub_windows: found via where at {:?}", path);
                return Ok(path);
            }
        }
    }

    // Fallback: try resolve_skillhub_executable
    resolve_skillhub_executable().map_err(|_| {
        "Skillhub CLI installed via npm but executable was not found. Try restarting the application.".to_string()
    })
}

#[tauri::command]
pub async fn install_skillhub_cli(app_handle: AppHandle) -> Result<GenericIpcResult, String> {
    let extras =
        tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
            info!("install_skillhub_cli: starting installer");
            if let Ok(path) = resolve_skillhub_executable() {
                info!("install_skillhub_cli: already installed at {:?}", path);
                return Ok(json!({
                    "message": "Skillhub CLI already installed",
                    "path": path,
                    "errors": Value::Null,
                }));
            }

            #[cfg(target_os = "windows")]
            {
                let executable = install_skillhub_windows()?;
                info!("install_skillhub_cli: completed at {:?}", executable);
                return Ok(json!({
                    "message": "Skillhub CLI installed",
                    "path": executable,
                    "errors": Value::Null,
                }));
            }

            #[cfg(not(target_os = "windows"))]
            {
                let mut command = Command::new("bash");
                command.arg("-lc").arg(format!(
                    "curl -fsSL {url} | bash -s -- --cli-only",
                    url = SKILLHUB_INSTALL_SCRIPT_URL
                ));

                let output = command
                    .output()
                    .map_err(|e| format!("Failed to run Skillhub installer: {e}"))?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let message = if !stderr.is_empty() { stderr } else { stdout };
                    error!("install_skillhub_cli: installer failed: {}", message);
                    return Err(message);
                }

                let executable = resolve_skillhub_executable().map_err(|_| {
                "Skillhub installer finished but executable was not found in ~/.local/bin or PATH"
                    .to_string()
            })?;

                info!("install_skillhub_cli: completed at {:?}", executable);
                Ok(json!({
                    "message": "Skillhub CLI installed",
                    "path": executable,
                    "stdout": String::from_utf8_lossy(&output.stdout).trim().to_string(),
                    "errors": Value::Null,
                }))
            }
        })
        .await
        .map_err(|e| e.to_string())??;

    Ok(GenericIpcResult {
        success: true,
        payload: runtime_snapshot_payload(&app_handle, None, extras),
    })
}

#[tauri::command]
pub async fn prepare_service_runtime(
    input: PrepareServiceRuntimeInput,
    state: State<'_, ProcessManagerState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let service_name = input.name.clone();
    let app_handle_for_task = app_handle.clone();

    let message = tauri::async_runtime::spawn_blocking(move || {
        info!("prepare_service_runtime: preparing {}", service_name);
        let message = crate::process_manager::ProcessManager::prepare_managed_runtime(
            &app_handle_for_task,
            &service_name,
        )
        .map_err(|e| e.to_string())?;
        info!("prepare_service_runtime: prepared {}", service_name);
        Ok::<String, String>(message)
    })
    .await
    .map_err(|e| e.to_string())??;

    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.set_app_handle(app_handle.clone());
    Ok(GenericIpcResult {
        success: true,
        payload: runtime_snapshot_payload(
            &app_handle,
            Some(&manager),
            json!({
                "message": message,
                "service": input.name,
                "errors": Value::Null,
            }),
        ),
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
    let response = send_command_and_wait(&state, command, 60000).await?;
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
    let response = send_command_and_wait(&state, command, 30000).await?;
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
    let response = send_command_and_wait(&state, command, 30000).await?;
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
    let response = send_command_and_wait(&state, command, 15000).await?;
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
    let response = send_command_and_wait(&state, command, 15000).await?;
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
    let response = send_command_and_wait(&state, command, 15000).await?;
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
            format!(
                "Started {} service(s): {}",
                started.len(),
                started.join(", ")
            )
        } else {
            format!(
                "Started {} service(s), {} failed",
                started.len(),
                errors.len()
            )
        },
        errors: if errors.is_empty() {
            None
        } else {
            Some(errors)
        },
    })
}

/// Start all registered services in background.
/// Returns immediately so frontend startup-critical IPC is not blocked by
/// service health checks (which can take multiple seconds).
#[tauri::command]
pub fn start_all_services_background(
    state: State<'_, ProcessManagerState>,
    app_handle: AppHandle,
) -> Result<ServiceOperationResult, String> {
    let manager_state = state.0.clone();
    let app_for_emit = app_handle.clone();

    {
        let mut manager = manager_state.lock().map_err(|e| e.to_string())?;
        manager.set_app_handle(app_handle);
    }

    std::thread::spawn(move || {
        let mut errors = Vec::new();
        let mut started = Vec::new();

        let results = match manager_state.lock() {
            Ok(mut manager) => manager.start_all(),
            Err(err) => {
                let _ = app_for_emit.emit(
                    "services-warmup-finished",
                    json!({
                        "success": false,
                        "message": format!("Failed to acquire manager lock: {}", err),
                        "errors": [err.to_string()],
                    }),
                );
                return;
            }
        };

        for (name, result) in results {
            match result {
                Ok(()) => started.push(name),
                Err(e) => errors.push(format!("{}: {}", name, e)),
            }
        }

        let success = errors.is_empty();
        let message = if success {
            format!(
                "Started {} service(s): {}",
                started.len(),
                started.join(", ")
            )
        } else {
            format!(
                "Started {} service(s), {} failed",
                started.len(),
                errors.len()
            )
        };

        let _ = app_for_emit.emit(
            "services-warmup-finished",
            json!({
                "success": success,
                "message": message,
                "errors": if success { Value::Null } else { json!(errors) },
            }),
        );
    });

    Ok(ServiceOperationResult {
        success: true,
        message: "Service warmup scheduled in background".to_string(),
        errors: None,
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
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.set_app_handle(app_handle.clone());

    match manager.start_service(&name) {
        Ok(()) => Ok(GenericIpcResult {
            success: true,
            payload: runtime_snapshot_payload(
                &app_handle,
                Some(&manager),
                json!({
                    "message": format!("Service '{}' started", name),
                    "service": name,
                    "errors": Value::Null,
                }),
            ),
        }),
        Err(e) => Ok(GenericIpcResult {
            success: false,
            payload: runtime_snapshot_payload(
                &app_handle,
                Some(&manager),
                json!({
                    "message": format!("Failed to start service '{}'", name),
                    "service": name,
                    "errors": [e.to_string()],
                }),
            ),
        }),
    }
}

/// Stop a specific service by name
#[tauri::command]
pub fn stop_service(
    name: String,
    state: State<'_, ProcessManagerState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.set_app_handle(app_handle.clone());

    match manager.stop_service(&name) {
        Ok(()) => Ok(GenericIpcResult {
            success: true,
            payload: runtime_snapshot_payload(
                &app_handle,
                Some(&manager),
                json!({
                    "message": format!("Service '{}' stopped", name),
                    "service": name,
                    "errors": Value::Null,
                }),
            ),
        }),
        Err(e) => Ok(GenericIpcResult {
            success: false,
            payload: runtime_snapshot_payload(
                &app_handle,
                Some(&manager),
                json!({
                    "message": format!("Failed to stop service '{}'", name),
                    "service": name,
                    "errors": [e.to_string()],
                }),
            ),
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

/// Predownload embedding model for RAG on first-run setup.
/// Uses persistent cache path so subsequent runs do not redownload.
#[tauri::command]
pub async fn prepare_rag_embedding_model(
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let _ = app_handle;
    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "message": "RAG embedding predownload is no longer required in Mastra single-process mode."
        }),
    })
}
