//! CoworkAny Desktop - Tauri IPC Command Handlers
//!
//! These are the Tauri commands that the React frontend can invoke.
//! They forward to the SidecarManager for actual processing.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::process_manager::{ProcessManagerState, ServiceInfo};
use crate::sidecar::{IpcCommand, SidecarState, TaskConfig, TaskContext};

static STARTUP_PROCESS_INSTANT: OnceLock<Instant> = OnceLock::new();
static STARTUP_PROCESS_EPOCH_MS: OnceLock<u128> = OnceLock::new();

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
    #[serde(rename = "workspacePath")]
    pub workspace_path: Option<String>,
    pub config: Option<StartTaskConfigInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResumeRecoverableTasksInput {
    #[serde(rename = "taskIds")]
    pub task_ids: Option<Vec<String>>,
    pub tasks: Option<Vec<ResumeRecoverableTaskHintInput>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResumeRecoverableTaskHintInput {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
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

#[derive(Debug, Clone, Deserialize)]
pub struct CheckClaudeSkillUpdatesInput {
    #[serde(rename = "skillIds")]
    pub skill_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpgradeClaudeSkillInput {
    #[serde(rename = "skillId")]
    pub skill_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchOpenClawSkillStoreInput {
    pub store: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstallOpenClawSkillInput {
    pub store: String,
    #[serde(rename = "skillName")]
    pub skill_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SyncSkillEnvironmentInput {
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureSkillEvalsInput {
    pub skill_path: String,
    pub skill_name: Option<String>,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateSkillBenchmarkInput {
    pub benchmark_dir: String,
    pub skill_name: String,
    pub skill_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSkillReviewInput {
    pub workspace_path: String,
    pub skill_name: String,
    pub benchmark_path: Option<String>,
    pub previous_workspace_path: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillReviewFeedbackInput {
    pub workspace_path: String,
    pub feedback_path: String,
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSkillBenchmarkPreviewInput {
    pub benchmark_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSkillReviewServerInput {
    pub workspace_path: String,
    pub skill_name: String,
    pub benchmark_path: Option<String>,
    pub previous_workspace_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopSkillReviewServerInput {
    pub workspace_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSkillReviewServerStatusInput {
    pub workspace_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSkillBenchmarkNotesInput {
    pub benchmark_path: String,
    pub notes: Vec<String>,
    pub metadata: Option<BenchmarkNotesSaveMetadataInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSkillBenchmarkNotesInput {
    pub benchmark_path: String,
    pub skill_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckSkillBenchmarkAnalyzerInput {
    pub benchmark_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSkillBenchmarkAnalyzerStatusInput {
    pub benchmark_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSkillBenchmarkAnalyzerHistoryInput {
    pub benchmark_path: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSkillBenchmarkAnalyzerSmokeInput {
    pub benchmark_path: String,
    pub skill_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessSkillBenchmarkAnalyzerReadinessInput {
    pub benchmark_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSkillBenchmarkNotesHistoryInput {
    pub benchmark_path: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkNotesSaveMetadataInput {
    pub source: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub warning: Option<String>,
    pub generated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub version: Option<u32>,
    pub identity: Option<String>,
    pub stable_preferences: Option<Vec<String>>,
    pub working_style: Option<Vec<String>>,
    pub long_term_goals: Option<Vec<String>>,
    pub avoid: Option<Vec<String>>,
    pub output_rules: Option<Vec<String>>,
    pub updated_at: Option<String>,
}

// ============================================================================
// Command Response Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct StartTaskResult {
    pub success: bool,
    #[serde(rename = "taskId")]
    pub task_id: String,
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

#[derive(Debug, Clone)]
struct ResolvedLlmProfile {
    provider: String,
    api_format: String,
    endpoint: String,
    model: String,
    api_key: Option<String>,
    allow_insecure_tls: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmHttpClientConfig {
    proxy_url: Option<String>,
    proxy_bypassed: bool,
}

#[derive(Debug, Clone)]
struct LlmBenchmarkNotesResult {
    notes: Vec<String>,
    raw_text: String,
    response_json: Value,
    status_code: u16,
    attempts: u32,
    proxy_url: Option<String>,
    proxy_bypassed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzerInvocationLog {
    generated_at: String,
    benchmark_path: String,
    skill_path: String,
    provider: String,
    model: String,
    api_format: String,
    endpoint: String,
    proxy_url: Option<String>,
    proxy_bypassed: bool,
    attempt_count: u32,
    status_code: Option<u16>,
    result_source: String,
    notes: Vec<String>,
    warning: Option<String>,
    error: Option<String>,
    system_prompt: String,
    user_prompt: String,
    response_text: Option<String>,
    response_json: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzerHealthStatus {
    checked_at: String,
    benchmark_path: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    endpoint: Option<String>,
    configured: bool,
    reachable: bool,
    result_source: String,
    warning: Option<String>,
    error: Option<String>,
    status_code: Option<u16>,
    attempt_count: u32,
    proxy_url: Option<String>,
    proxy_bypassed: bool,
    log_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzerHealthHistoryEntry {
    id: String,
    status: AnalyzerHealthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzerReadinessAssessment {
    assessed_at: String,
    benchmark_path: String,
    level: String,
    summary: String,
    reasons: Vec<String>,
    recommendations: Vec<String>,
    recent_event_count: usize,
    recent_successes: usize,
    recent_failures: usize,
    latest_result_source: Option<String>,
    latest_reachable: Option<bool>,
    smoke_success_present: bool,
    recent_failure_budget: usize,
    recent_failure_budget_remaining: usize,
    recent_failure_rate: f64,
    consecutive_failures: usize,
    latest_event_age_hours: Option<f64>,
    smoke_success_age_hours: Option<f64>,
    latest_event_stale: bool,
    smoke_success_stale: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkNotesHistoryEntry {
    pub id: String,
    pub saved_at: String,
    pub notes: Vec<String>,
    pub previous_notes: Vec<String>,
    pub source: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub warning: Option<String>,
    pub generated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserProfileResult {
    pub success: bool,
    pub payload: UserProfile,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCreatorEvalPathsResult {
    pub success: bool,
    pub path: String,
    pub created: bool,
    pub output_path: Option<String>,
    pub benchmark_json_path: Option<String>,
    pub benchmark_markdown_path: Option<String>,
    pub stdout: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReviewServerResult {
    pub success: bool,
    pub workspace_path: String,
    pub url: Option<String>,
    pub port: Option<u16>,
    pub running: bool,
    pub restarted: bool,
    pub log_path: Option<String>,
    pub error: Option<String>,
}

pub struct ManagedSkillReviewServer {
    child: Child,
    url: String,
    port: u16,
    log_path: PathBuf,
}

pub type SkillReviewServerState =
    std::sync::Arc<tokio::sync::Mutex<HashMap<String, ManagedSkillReviewServer>>>;

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
pub struct OpenLocalPathInput {
    pub path: String,
    pub reveal_parent: Option<bool>,
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
    }
    Ok(())
}

async fn send_command_and_wait(
    state: &State<'_, SidecarState>,
    command: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    let rx = {
        let manager = state.0.lock().map_err(|e| e.to_string())?;
        manager
            .send_command_async(command)
            .map_err(|e| e.to_string())?
    };

    // Use tokio::task::spawn_blocking since recv_timeout blocks the thread
    tokio::task::spawn_blocking(move || {
        match rx.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
            Ok(response) => Ok(response),
            Err(err) => Err(format!("response timeout: {}", err)),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle.path().app_data_dir().map_err(|e| e.to_string())
}

fn llm_config_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("llm-config.json"))
}

fn user_profile_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("user-profile.json"))
}

fn settings_store_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("settings.json"))
}

fn legacy_llm_config_path() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    Ok(cwd.join("..").join("sidecar").join("llm-config.json"))
}

fn sessions_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app_handle).map(|dir| dir.join("sessions.json"))
}

fn openai_compatible_default(provider: &str) -> Option<(&'static str, &'static str)> {
    match provider {
        "openai" => Some(("https://api.openai.com/v1/chat/completions", "gpt-4o")),
        "aiberm" => Some((
            "https://aiberm.com/v1/chat/completions",
            "claude-sonnet-4-5-20250929-thinking",
        )),
        "nvidia" => Some((
            "https://integrate.api.nvidia.com/v1/chat/completions",
            "meta/llama-3.1-70b-instruct",
        )),
        "siliconflow" => Some((
            "https://api.siliconflow.cn/v1/chat/completions",
            "Qwen/Qwen2.5-7B-Instruct",
        )),
        "gemini" => Some((
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            "gemini-2.0-flash",
        )),
        "qwen" => Some((
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            "qwen-plus",
        )),
        "minimax" => Some((
            "https://api.minimax.chat/v1/chat/completions",
            "MiniMax-Text-01",
        )),
        "kimi" => Some((
            "https://api.moonshot.cn/v1/chat/completions",
            "moonshot-v1-8k",
        )),
        _ => None,
    }
}

fn resolve_active_llm_profile(config: &LlmConfig) -> Result<ResolvedLlmProfile, String> {
    let active_profile = config.active_profile_id.as_ref().and_then(|active_id| {
        config
            .profiles
            .as_ref()
            .and_then(|profiles| profiles.iter().find(|profile| profile.id == *active_id))
    });

    let provider = active_profile
        .map(|profile| profile.provider.clone())
        .or_else(|| config.provider.clone())
        .ok_or_else(|| "No active LLM provider is configured".to_string())?;

    match provider.as_str() {
        "anthropic" => {
            let settings = active_profile
                .and_then(|profile| profile.anthropic.clone())
                .or_else(|| config.anthropic.clone())
                .ok_or_else(|| {
                    "Anthropic settings are missing for the active profile".to_string()
                })?;
            Ok(ResolvedLlmProfile {
                provider,
                api_format: "anthropic".to_string(),
                endpoint: "https://api.anthropic.com/v1/messages".to_string(),
                model: settings
                    .model
                    .unwrap_or_else(|| "claude-3-5-sonnet-20240620".to_string()),
                api_key: settings.api_key,
                allow_insecure_tls: false,
            })
        }
        "openrouter" => {
            let settings = active_profile
                .and_then(|profile| profile.openrouter.clone())
                .or_else(|| config.openrouter.clone())
                .ok_or_else(|| {
                    "OpenRouter settings are missing for the active profile".to_string()
                })?;
            Ok(ResolvedLlmProfile {
                provider,
                api_format: "openai".to_string(),
                endpoint: "https://openrouter.ai/api/v1/chat/completions".to_string(),
                model: settings
                    .model
                    .unwrap_or_else(|| "anthropic/claude-3.5-sonnet".to_string()),
                api_key: settings.api_key,
                allow_insecure_tls: false,
            })
        }
        "custom" => {
            let settings = active_profile
                .and_then(|profile| profile.custom.clone())
                .or_else(|| config.custom.clone())
                .ok_or_else(|| {
                    "Custom provider settings are missing for the active profile".to_string()
                })?;
            let endpoint = settings
                .base_url
                .ok_or_else(|| "Custom provider base URL is missing".to_string())?;
            let model = settings
                .model
                .ok_or_else(|| "Custom provider model is missing".to_string())?;
            Ok(ResolvedLlmProfile {
                provider,
                api_format: settings
                    .api_format
                    .unwrap_or_else(|| "openai".to_string())
                    .to_lowercase(),
                endpoint,
                model,
                api_key: settings.api_key,
                allow_insecure_tls: settings.allow_insecure_tls.unwrap_or(false),
            })
        }
        "ollama" => {
            let settings = active_profile
                .and_then(|profile| profile.ollama.clone())
                .or_else(|| config.ollama.clone())
                .ok_or_else(|| "Ollama settings are missing for the active profile".to_string())?;
            Ok(ResolvedLlmProfile {
                provider,
                api_format: "openai".to_string(),
                endpoint: settings
                    .base_url
                    .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".to_string()),
                model: settings.model.unwrap_or_else(|| "llama3".to_string()),
                api_key: None,
                allow_insecure_tls: false,
            })
        }
        other => {
            if let Some((default_url, default_model)) = openai_compatible_default(other) {
                let settings = active_profile
                    .and_then(|profile| profile.openai.clone())
                    .or_else(|| config.openai.clone())
                    .ok_or_else(|| {
                        format!("OpenAI-compatible settings are missing for provider {other}")
                    })?;
                Ok(ResolvedLlmProfile {
                    provider,
                    api_format: "openai".to_string(),
                    endpoint: settings.base_url.unwrap_or_else(|| default_url.to_string()),
                    model: settings.model.unwrap_or_else(|| default_model.to_string()),
                    api_key: settings.api_key,
                    allow_insecure_tls: settings.allow_insecure_tls.unwrap_or(false),
                })
            } else {
                Err(format!(
                    "Unsupported LLM provider for benchmark analysis: {other}"
                ))
            }
        }
    }
}

fn should_bypass_proxy(endpoint: &str, proxy: &ProxySettings) -> bool {
    let bypass_raw = proxy
        .bypass
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(bypass_raw) = bypass_raw else {
        return false;
    };
    let Ok(url) = url::Url::parse(endpoint) else {
        return false;
    };
    let Some(host) = url.host_str().map(|value| value.to_ascii_lowercase()) else {
        return false;
    };

    bypass_raw
        .split([',', ';', ' '])
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(|token| token.trim_start_matches('.').to_ascii_lowercase())
        .any(|token| host == token || host.ends_with(&format!(".{token}")))
}

fn build_llm_http_client(
    profile: &ResolvedLlmProfile,
    config: &LlmConfig,
) -> Result<(reqwest::Client, LlmHttpClientConfig), String> {
    let mut client_builder = reqwest::Client::builder().timeout(Duration::from_secs(60));
    if profile.allow_insecure_tls {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }

    let mut proxy_url = None;
    let mut proxy_bypassed = false;
    if let Some(proxy) = config.proxy.as_ref() {
        let enabled = proxy.enabled.unwrap_or(false);
        let url = proxy
            .url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if enabled {
            if should_bypass_proxy(&profile.endpoint, proxy) {
                proxy_bypassed = true;
            } else if let Some(proxy_endpoint) = url {
                let reqwest_proxy = reqwest::Proxy::all(proxy_endpoint)
                    .map_err(|error| format!("Invalid outbound proxy URL: {error}"))?;
                client_builder = client_builder.proxy(reqwest_proxy);
                proxy_url = Some(proxy_endpoint.to_string());
            }
        }
    }

    let client = client_builder.build().map_err(|error| error.to_string())?;
    Ok((
        client,
        LlmHttpClientConfig {
            proxy_url,
            proxy_bypassed,
        },
    ))
}

fn find_python_command() -> Option<String> {
    for cmd in ["python3", "python", "py"] {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                return Some(cmd.to_string());
            }
        }
    }
    None
}

fn find_skill_creator_root(start: Option<&Path>) -> Result<PathBuf, String> {
    let current_dir = std::env::current_dir().map_err(|e| e.to_string())?;
    let mut roots = vec![current_dir.clone()];
    if let Some(path) = start {
        roots.insert(0, path.to_path_buf());
    }

    for root in roots {
        for ancestor in
            std::iter::once(root.clone()).chain(root.ancestors().skip(1).map(PathBuf::from))
        {
            let candidate = ancestor.join(".agent").join("skills").join("skill-creator");
            if candidate
                .join("scripts")
                .join("aggregate_benchmark.py")
                .exists()
            {
                return Ok(candidate);
            }
        }
    }

    Err("skill-creator not found under .agent/skills/skill-creator".to_string())
}

fn run_python_script(script_path: &Path, args: &[String], cwd: &Path) -> Result<String, String> {
    let python = find_python_command().ok_or_else(|| {
        "Python not found. Please install Python 3 and make it available on PATH.".to_string()
    })?;

    let output = Command::new(&python)
        .arg(script_path)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        return Ok(stdout);
    }

    let combined = if stderr.trim().is_empty() {
        stdout
    } else if stdout.trim().is_empty() {
        stderr
    } else {
        format!("{}\n{}", stdout, stderr)
    };
    Err(combined.trim().to_string())
}

fn import_feedback_json(
    workspace_path: &Path,
    source_path: &Path,
    overwrite: bool,
) -> Result<(PathBuf, bool, usize), String> {
    if !workspace_path.is_dir() {
        return Err(format!(
            "Workspace directory does not exist: {}",
            workspace_path.display()
        ));
    }

    if !source_path.is_file() {
        return Err(format!(
            "Feedback file does not exist: {}",
            source_path.display()
        ));
    }

    let raw_feedback = fs::read_to_string(source_path)
        .map_err(|error| format!("Failed to read feedback file: {error}"))?;
    let feedback: Value = serde_json::from_str(&raw_feedback)
        .map_err(|error| format!("Feedback file is not valid JSON: {error}"))?;
    let reviews = feedback
        .get("reviews")
        .and_then(Value::as_array)
        .ok_or_else(|| "Feedback JSON must contain a top-level 'reviews' array".to_string())?;
    let reviews_len = reviews.len();
    let has_status = feedback.get("status").and_then(Value::as_str).is_some();

    let destination_path = workspace_path.join("feedback.json");
    let destination_exists = destination_path.exists();
    if destination_exists && !overwrite {
        return Err(format!(
            "Feedback file already exists: {}",
            destination_path.display()
        ));
    }

    let normalized = if has_status {
        feedback
    } else {
        json!({
            "reviews": reviews,
            "status": "complete",
        })
    };

    fs::write(
        &destination_path,
        serde_json::to_string_pretty(&normalized)
            .map_err(|error| format!("Failed to serialize feedback JSON: {error}"))?,
    )
    .map_err(|error| format!("Failed to write feedback.json: {error}"))?;

    Ok((destination_path, !destination_exists, reviews_len))
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    if !path.is_file() {
        return Err(format!("JSON file not found: {}", path.display()));
    }

    let raw =
        fs::read_to_string(path).map_err(|error| format!("Failed to read JSON file: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("Failed to parse JSON file: {error}"))
}

fn read_benchmark_notes(path: &Path) -> Result<Vec<String>, String> {
    let benchmark = read_json_file(path)?;
    Ok(benchmark
        .get("notes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|note| note.as_str().map(str::trim))
        .filter(|note| !note.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn benchmark_notes_history_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        "{}.notes-history.jsonl",
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("benchmark")
    ))
}

fn append_benchmark_notes_history(
    benchmark_path: &Path,
    notes: &[String],
    previous_notes: &[String],
    metadata: Option<&BenchmarkNotesSaveMetadataInput>,
) -> Result<BenchmarkNotesHistoryEntry, String> {
    let history_path = benchmark_notes_history_path(benchmark_path);
    let entry = BenchmarkNotesHistoryEntry {
        id: Uuid::new_v4().to_string(),
        saved_at: chrono::Utc::now().to_rfc3339(),
        notes: notes.to_vec(),
        previous_notes: previous_notes.to_vec(),
        source: metadata.and_then(|value| value.source.clone()),
        provider: metadata.and_then(|value| value.provider.clone()),
        model: metadata.and_then(|value| value.model.clone()),
        warning: metadata.and_then(|value| value.warning.clone()),
        generated_at: metadata.and_then(|value| value.generated_at.clone()),
    };

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&history_path)
        .map_err(|error| format!("Failed to open benchmark notes history: {error}"))?;
    let line = serde_json::to_string(&entry)
        .map_err(|error| format!("Failed to serialize benchmark notes history entry: {error}"))?;
    file.write_all(format!("{line}\n").as_bytes())
        .map_err(|error| format!("Failed to append benchmark notes history: {error}"))?;
    file.flush()
        .map_err(|error| format!("Failed to flush benchmark notes history: {error}"))?;

    Ok(entry)
}

fn load_benchmark_notes_history(
    benchmark_path: &Path,
    limit: usize,
) -> Result<Vec<BenchmarkNotesHistoryEntry>, String> {
    let history_path = benchmark_notes_history_path(benchmark_path);
    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&history_path)
        .map_err(|error| format!("Failed to read benchmark notes history: {error}"))?;
    let mut entries = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let entry: BenchmarkNotesHistoryEntry = serde_json::from_str(trimmed).map_err(|error| {
            format!(
                "Failed to parse benchmark notes history at line {}: {error}",
                index + 1
            )
        })?;
        entries.push(entry);
    }

    entries.reverse();
    if entries.len() > limit {
        entries.truncate(limit);
    }
    Ok(entries)
}

fn analyzer_log_dir(benchmark_path: &Path) -> PathBuf {
    benchmark_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".coworkany-analyzer-logs")
}

fn analyzer_health_status_path(benchmark_path: &Path) -> PathBuf {
    benchmark_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".coworkany-analyzer-status.json")
}

fn analyzer_health_history_path(benchmark_path: &Path) -> PathBuf {
    benchmark_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".coworkany-analyzer-status-history.jsonl")
}

fn analyzer_readiness_path(benchmark_path: &Path) -> PathBuf {
    benchmark_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(".coworkany-analyzer-readiness.json")
}

fn write_analyzer_health_status(
    benchmark_path: &Path,
    status: &AnalyzerHealthStatus,
) -> Result<PathBuf, String> {
    let path = analyzer_health_status_path(benchmark_path);
    fs::write(
        &path,
        serde_json::to_string_pretty(status)
            .map_err(|error| format!("Failed to serialize analyzer health status: {error}"))?,
    )
    .map_err(|error| format!("Failed to write analyzer health status: {error}"))?;

    let history_path = analyzer_health_history_path(benchmark_path);
    let history_entry = AnalyzerHealthHistoryEntry {
        id: Uuid::new_v4().to_string(),
        status: status.clone(),
    };
    let mut history_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&history_path)
        .map_err(|error| format!("Failed to open analyzer health history: {error}"))?;
    let history_line = serde_json::to_string(&history_entry)
        .map_err(|error| format!("Failed to serialize analyzer health history: {error}"))?;
    history_file
        .write_all(format!("{history_line}\n").as_bytes())
        .map_err(|error| format!("Failed to append analyzer health history: {error}"))?;
    history_file
        .flush()
        .map_err(|error| format!("Failed to flush analyzer health history: {error}"))?;

    Ok(path)
}

fn load_analyzer_health_status(
    benchmark_path: &Path,
) -> Result<Option<AnalyzerHealthStatus>, String> {
    let path = analyzer_health_status_path(benchmark_path);
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read analyzer health status: {error}"))?;
    let status: AnalyzerHealthStatus = serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse analyzer health status: {error}"))?;
    Ok(Some(status))
}

fn load_analyzer_health_history(
    benchmark_path: &Path,
    limit: usize,
) -> Result<Vec<AnalyzerHealthHistoryEntry>, String> {
    let path = analyzer_health_history_path(benchmark_path);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read analyzer health history: {error}"))?;
    let mut entries = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let entry: AnalyzerHealthHistoryEntry = serde_json::from_str(trimmed).map_err(|error| {
            format!(
                "Failed to parse analyzer health history at line {}: {error}",
                index + 1
            )
        })?;
        entries.push(entry);
    }

    entries.reverse();
    if entries.len() > limit {
        entries.truncate(limit);
    }
    Ok(entries)
}

fn parse_timestamp_age_hours(timestamp: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| chrono::Utc::now().signed_duration_since(value.with_timezone(&chrono::Utc)))
        .map(|duration| duration.num_seconds().max(0) as f64 / 3600.0)
}

fn assess_analyzer_readiness(
    benchmark_path: &Path,
    history: &[AnalyzerHealthHistoryEntry],
) -> AnalyzerReadinessAssessment {
    const READINESS_WINDOW: usize = 5;
    const RECENT_FAILURE_BUDGET: usize = 1;
    const LATEST_EVENT_STALE_AFTER_HOURS: f64 = 24.0;
    const SMOKE_SUCCESS_STALE_AFTER_HOURS: f64 = 72.0;

    let recent = history.iter().take(READINESS_WINDOW).collect::<Vec<_>>();
    let recent_successes = recent.iter().filter(|entry| entry.status.reachable).count();
    let recent_failures = recent.len().saturating_sub(recent_successes);
    let recent_failure_rate = if recent.is_empty() {
        0.0
    } else {
        recent_failures as f64 / recent.len() as f64
    };
    let latest = recent.first().map(|entry| &entry.status);
    let latest_event_age_hours =
        latest.and_then(|status| parse_timestamp_age_hours(&status.checked_at));
    let latest_event_stale = latest_event_age_hours
        .map(|age| age > LATEST_EVENT_STALE_AFTER_HOURS)
        .unwrap_or(false);
    let most_recent_smoke_success = history
        .iter()
        .find(|entry| entry.status.result_source == "smoke" && entry.status.reachable)
        .map(|entry| &entry.status);
    let smoke_success_present = most_recent_smoke_success.is_some();
    let smoke_success_age_hours =
        most_recent_smoke_success.and_then(|status| parse_timestamp_age_hours(&status.checked_at));
    let smoke_success_stale = smoke_success_age_hours
        .map(|age| age > SMOKE_SUCCESS_STALE_AFTER_HOURS)
        .unwrap_or(false);
    let consecutive_failures = recent
        .iter()
        .take_while(|entry| !entry.status.reachable)
        .count();
    let recent_failure_budget_remaining =
        RECENT_FAILURE_BUDGET.saturating_sub(recent_failures.min(RECENT_FAILURE_BUDGET));

    let mut reasons = Vec::new();
    let mut recommendations = Vec::new();
    let level = if recent.is_empty() {
        reasons.push("No analyzer history exists for this benchmark workspace yet.".to_string());
        recommendations.push(
            "Run analyzer smoke before relying on model-backed benchmark analysis.".to_string(),
        );
        "blocked"
    } else if !smoke_success_present {
        reasons
            .push("No successful analyzer smoke has been recorded for this workspace.".to_string());
        recommendations.push(
            "Run analyzer smoke and confirm it succeeds before trusting analyzer output."
                .to_string(),
        );
        "blocked"
    } else if latest.map(|status| !status.reachable).unwrap_or(true) {
        reasons.push("The latest analyzer event is failing.".to_string());
        recommendations.push(
            "Fix the latest analyzer failure or rerun smoke until the latest event is healthy."
                .to_string(),
        );
        "blocked"
    } else if recent_failures > RECENT_FAILURE_BUDGET {
        reasons.push(format!(
            "Recent analyzer failures exhausted the error budget ({recent_failures}/{RECENT_FAILURE_BUDGET} across the last {} events).",
            recent.len()
        ));
        recommendations.push(
            "Hold release usage for this workspace until smoke and draft generation stay within the failure budget."
                .to_string(),
        );
        "blocked"
    } else if consecutive_failures >= 2 {
        reasons.push("Recent analyzer history shows repeated failures.".to_string());
        recommendations.push("Stabilize analyzer connectivity or output parsing before considering this workspace ready.".to_string());
        "blocked"
    } else if latest_event_stale || smoke_success_stale {
        if latest_event_stale {
            reasons.push(format!(
                "The latest analyzer event is stale ({:.1}h old).",
                latest_event_age_hours.unwrap_or_default()
            ));
        }
        if smoke_success_stale {
            reasons.push(format!(
                "The most recent successful analyzer smoke is stale ({:.1}h old).",
                smoke_success_age_hours.unwrap_or_default()
            ));
        }
        recommendations.push(
            "Refresh analyzer smoke before trusting this workspace for release decisions."
                .to_string(),
        );
        "warning"
    } else {
        "ready"
    };

    if recent_successes == 0 && !recent.is_empty() {
        reasons.push("No recent analyzer event succeeded.".to_string());
    }
    if recent_failures > 0 && level == "ready" {
        reasons.push(
            "Recent analyzer history contains isolated failures, but the gate still passes."
                .to_string(),
        );
    }
    if recommendations.is_empty() {
        recommendations.push(
            "Maintain periodic smoke checks to ensure the analyzer stays healthy.".to_string(),
        );
    }

    let summary = match level {
        "ready" => "Analyzer gate passed for this workspace.".to_string(),
        "warning" => "Analyzer gate is degraded; proceed with caution.".to_string(),
        _ => "Analyzer gate is blocked for this workspace.".to_string(),
    };

    AnalyzerReadinessAssessment {
        assessed_at: chrono::Utc::now().to_rfc3339(),
        benchmark_path: benchmark_path.to_string_lossy().to_string(),
        level: level.to_string(),
        summary,
        reasons,
        recommendations,
        recent_event_count: recent.len(),
        recent_successes,
        recent_failures,
        latest_result_source: latest.map(|status| status.result_source.clone()),
        latest_reachable: latest.map(|status| status.reachable),
        smoke_success_present,
        recent_failure_budget: RECENT_FAILURE_BUDGET,
        recent_failure_budget_remaining,
        recent_failure_rate,
        consecutive_failures,
        latest_event_age_hours,
        smoke_success_age_hours,
        latest_event_stale,
        smoke_success_stale,
    }
}

fn write_analyzer_readiness_assessment(
    benchmark_path: &Path,
    assessment: &AnalyzerReadinessAssessment,
) -> Result<PathBuf, String> {
    let path = analyzer_readiness_path(benchmark_path);
    fs::write(
        &path,
        serde_json::to_string_pretty(assessment).map_err(|error| {
            format!("Failed to serialize analyzer readiness assessment: {error}")
        })?,
    )
    .map_err(|error| format!("Failed to write analyzer readiness assessment: {error}"))?;
    Ok(path)
}

fn write_analyzer_invocation_log(
    benchmark_path: &Path,
    log: &AnalyzerInvocationLog,
) -> Result<PathBuf, String> {
    let dir = analyzer_log_dir(benchmark_path);
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create analyzer log directory: {error}"))?;
    let file_path = dir.join(format!(
        "benchmark-analyzer-{}-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        Uuid::new_v4()
    ));
    fs::write(
        &file_path,
        serde_json::to_string_pretty(log)
            .map_err(|error| format!("Failed to serialize analyzer invocation log: {error}"))?,
    )
    .map_err(|error| format!("Failed to write analyzer invocation log: {error}"))?;
    Ok(file_path)
}

fn write_benchmark_notes(path: &Path, notes: &[String]) -> Result<(), String> {
    let mut benchmark = read_json_file(path)?;
    let object = benchmark
        .as_object_mut()
        .ok_or_else(|| format!("Benchmark file is not a JSON object: {}", path.display()))?;
    object.insert("notes".to_string(), json!(notes));

    fs::write(
        path,
        serde_json::to_string_pretty(&benchmark)
            .map_err(|error| format!("Failed to serialize benchmark JSON: {error}"))?,
    )
    .map_err(|error| format!("Failed to write benchmark JSON: {error}"))?;

    let markdown = render_benchmark_markdown(&benchmark);
    fs::write(path.with_extension("md"), markdown)
        .map_err(|error| format!("Failed to write benchmark Markdown: {error}"))?;

    Ok(())
}

fn benchmark_mean(value: Option<&Value>) -> f64 {
    value
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("mean"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

fn benchmark_stddev(value: Option<&Value>) -> f64 {
    value
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("stddev"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

fn render_benchmark_markdown(benchmark: &Value) -> String {
    let metadata = benchmark
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let run_summary = benchmark
        .get("run_summary")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let notes = benchmark
        .get("notes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let configs: Vec<String> = run_summary
        .keys()
        .filter(|key| key.as_str() != "delta")
        .cloned()
        .collect();
    let config_a = configs
        .first()
        .cloned()
        .unwrap_or_else(|| "config_a".to_string());
    let config_b = configs
        .get(1)
        .cloned()
        .unwrap_or_else(|| "config_b".to_string());
    let label_a = config_a.replace('_', " ");
    let label_b = config_b.replace('_', " ");

    let config_a_summary = run_summary
        .get(&config_a)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let config_b_summary = run_summary
        .get(&config_b)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let delta = run_summary
        .get("delta")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let evals = metadata
        .get("evals_run")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .or_else(|| value.as_i64().map(|number| number.to_string()))
                .or_else(|| value.as_u64().map(|number| number.to_string()))
                .unwrap_or_else(|| "unknown".to_string())
        })
        .collect::<Vec<_>>()
        .join(", ");

    let mut lines = vec![
        format!(
            "# Skill Benchmark: {}",
            metadata
                .get("skill_name")
                .and_then(Value::as_str)
                .unwrap_or("<skill-name>")
        ),
        String::new(),
        format!(
            "**Model**: {}",
            metadata
                .get("executor_model")
                .and_then(Value::as_str)
                .unwrap_or("<model-name>")
        ),
        format!(
            "**Date**: {}",
            metadata
                .get("timestamp")
                .and_then(Value::as_str)
                .unwrap_or("<timestamp>")
        ),
        format!(
            "**Evals**: {} ({} runs each per configuration)",
            evals,
            metadata
                .get("runs_per_configuration")
                .and_then(Value::as_u64)
                .unwrap_or(0)
        ),
        String::new(),
        "## Summary".to_string(),
        String::new(),
        format!("| Metric | {} | {} | Delta |", label_a, label_b),
        "|--------|------------|---------------|-------|".to_string(),
        format!(
            "| Pass Rate | {:.0}% +/- {:.0}% | {:.0}% +/- {:.0}% | {} |",
            benchmark_mean(config_a_summary.get("pass_rate")) * 100.0,
            benchmark_stddev(config_a_summary.get("pass_rate")) * 100.0,
            benchmark_mean(config_b_summary.get("pass_rate")) * 100.0,
            benchmark_stddev(config_b_summary.get("pass_rate")) * 100.0,
            delta
                .get("pass_rate")
                .and_then(Value::as_str)
                .unwrap_or("-")
        ),
        format!(
            "| Time | {:.1}s +/- {:.1}s | {:.1}s +/- {:.1}s | {}s |",
            benchmark_mean(config_a_summary.get("time_seconds")),
            benchmark_stddev(config_a_summary.get("time_seconds")),
            benchmark_mean(config_b_summary.get("time_seconds")),
            benchmark_stddev(config_b_summary.get("time_seconds")),
            delta
                .get("time_seconds")
                .and_then(Value::as_str)
                .unwrap_or("-")
        ),
        format!(
            "| Tokens | {:.0} +/- {:.0} | {:.0} +/- {:.0} | {} |",
            benchmark_mean(config_a_summary.get("tokens")),
            benchmark_stddev(config_a_summary.get("tokens")),
            benchmark_mean(config_b_summary.get("tokens")),
            benchmark_stddev(config_b_summary.get("tokens")),
            delta.get("tokens").and_then(Value::as_str).unwrap_or("-")
        ),
    ];

    if !notes.is_empty() {
        lines.push(String::new());
        lines.push("## Notes".to_string());
        lines.push(String::new());
        for note in notes {
            if let Some(text) = note.as_str() {
                lines.push(format!("- {}", text));
            }
        }
    }

    lines.join("\n")
}

fn expectation_pattern_note(
    expectation: &str,
    with_skill: &[bool],
    without_skill: &[bool],
) -> Option<String> {
    let with_all_pass = !with_skill.is_empty() && with_skill.iter().all(|passed| *passed);
    let with_all_fail = !with_skill.is_empty() && with_skill.iter().all(|passed| !*passed);
    let without_all_pass = !without_skill.is_empty() && without_skill.iter().all(|passed| *passed);
    let without_all_fail = !without_skill.is_empty() && without_skill.iter().all(|passed| !*passed);

    if with_all_pass && without_all_fail {
        return Some(format!(
            "Expectation '{}' consistently passes with skill and fails without, indicating clear skill value",
            expectation
        ));
    }
    if with_all_fail && without_all_pass {
        return Some(format!(
            "Expectation '{}' consistently fails with skill but passes without, suggesting the skill may be hurting",
            expectation
        ));
    }
    if with_all_pass && without_all_pass {
        return Some(format!(
            "Expectation '{}' passes in every configuration and may not differentiate skill value",
            expectation
        ));
    }
    if with_all_fail && without_all_fail {
        return Some(format!(
            "Expectation '{}' fails in every configuration and may be broken or beyond current capability",
            expectation
        ));
    }

    None
}

fn generate_benchmark_notes_from_value(benchmark: &Value) -> Vec<String> {
    let mut notes = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let runs = benchmark
        .get("runs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut expectation_patterns: HashMap<String, (Vec<bool>, Vec<bool>)> = HashMap::new();
    let mut eval_pass_rates: HashMap<(String, String), Vec<f64>> = HashMap::new();

    for run in &runs {
        let configuration = run
            .get("configuration")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let eval_id = run
            .get("eval_id")
            .map(|value| {
                value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .or_else(|| value.as_i64().map(|number| number.to_string()))
                    .or_else(|| value.as_u64().map(|number| number.to_string()))
                    .unwrap_or_else(|| "unknown".to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());
        if let Some(pass_rate) = run
            .get("result")
            .and_then(Value::as_object)
            .and_then(|result| result.get("pass_rate"))
            .and_then(Value::as_f64)
        {
            eval_pass_rates
                .entry((eval_id.clone(), configuration.clone()))
                .or_default()
                .push(pass_rate);
        }

        for expectation in run
            .get("expectations")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let text = expectation
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty());
            let passed = expectation.get("passed").and_then(Value::as_bool);
            if let (Some(text), Some(passed)) = (text, passed) {
                let entry = expectation_patterns
                    .entry(text.to_string())
                    .or_insert_with(|| (Vec::new(), Vec::new()));
                match configuration.as_str() {
                    "with_skill" => entry.0.push(passed),
                    "without_skill" => entry.1.push(passed),
                    _ => {}
                }
            }
        }
    }

    for (expectation, (with_skill, without_skill)) in expectation_patterns {
        if let Some(note) = expectation_pattern_note(&expectation, &with_skill, &without_skill) {
            if seen.insert(note.clone()) {
                notes.push(note);
            }
        }
    }

    for ((eval_id, configuration), pass_rates) in eval_pass_rates {
        if pass_rates.len() < 2 {
            continue;
        }
        let min = pass_rates.iter().copied().fold(f64::INFINITY, f64::min);
        let max = pass_rates.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let spread = max - min;
        if spread >= 0.25 {
            let note = format!(
                "Eval {} shows high variance for {} (pass rate range {:.0}% to {:.0}%), which may indicate flakiness",
                eval_id,
                configuration.replace('_', " "),
                min * 100.0,
                max * 100.0
            );
            if seen.insert(note.clone()) {
                notes.push(note);
            }
        }
    }

    let run_summary = benchmark
        .get("run_summary")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let with_skill = run_summary
        .get("with_skill")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let without_skill = run_summary
        .get("without_skill")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let with_pass_rate = with_skill
        .get("pass_rate")
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("mean"))
        .and_then(Value::as_f64);
    let without_pass_rate = without_skill
        .get("pass_rate")
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("mean"))
        .and_then(Value::as_f64);
    let with_time = with_skill
        .get("time_seconds")
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("mean"))
        .and_then(Value::as_f64);
    let without_time = without_skill
        .get("time_seconds")
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("mean"))
        .and_then(Value::as_f64);
    let with_tokens = with_skill
        .get("tokens")
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("mean"))
        .and_then(Value::as_f64);
    let without_tokens = without_skill
        .get("tokens")
        .and_then(Value::as_object)
        .and_then(|metric| metric.get("mean"))
        .and_then(Value::as_f64);

    if let (Some(with_pass_rate), Some(without_pass_rate), Some(with_time), Some(without_time)) =
        (with_pass_rate, without_pass_rate, with_time, without_time)
    {
        let pass_rate_delta = with_pass_rate - without_pass_rate;
        let time_delta = with_time - without_time;
        if pass_rate_delta.abs() >= 0.1 {
            let note = format!(
                "Skill changes average pass rate by {:.0} percentage points while changing average execution time by {:.1}s",
                pass_rate_delta * 100.0,
                time_delta
            );
            if seen.insert(note.clone()) {
                notes.push(note);
            }
        }
    }

    if let (Some(with_tokens), Some(without_tokens)) = (with_tokens, without_tokens) {
        if without_tokens > 0.0 {
            let delta_ratio = (with_tokens - without_tokens) / without_tokens;
            if delta_ratio.abs() >= 0.3 {
                let note = format!(
                    "Token usage is {:.0}% {} with skill than without",
                    delta_ratio.abs() * 100.0,
                    if delta_ratio > 0.0 { "higher" } else { "lower" }
                );
                if seen.insert(note.clone()) {
                    notes.push(note);
                }
            }
        }
    }

    notes
}

fn extract_benchmark_analyzer_instructions(markdown: &str) -> String {
    markdown
        .split("# Analyzing Benchmark Results")
        .nth(1)
        .map(|section| format!("# Analyzing Benchmark Results{}", section))
        .unwrap_or_else(|| {
            "# Analyzing Benchmark Results\n\nReview benchmark results and return a JSON array of concise notes that surface patterns, anomalies, and tradeoffs across configurations.".to_string()
        })
}

fn load_benchmark_analyzer_instructions(benchmark_path: &Path) -> String {
    let Some(start_dir) = benchmark_path.parent() else {
        return "# Analyzing Benchmark Results\n\nReview benchmark results and return a JSON array of concise notes.".to_string();
    };

    let analyzer_path = match find_skill_creator_root(Some(start_dir)) {
        Ok(root) => root.join("agents").join("analyzer.md"),
        Err(_) => return "# Analyzing Benchmark Results\n\nReview benchmark results and return a JSON array of concise notes.".to_string(),
    };

    match fs::read_to_string(&analyzer_path) {
        Ok(contents) => extract_benchmark_analyzer_instructions(&contents),
        Err(_) => "# Analyzing Benchmark Results\n\nReview benchmark results and return a JSON array of concise notes.".to_string(),
    }
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let truncated = value.chars().take(max_chars).collect::<String>();
    format!("{truncated}...")
}

fn build_benchmark_analysis_context(benchmark: &Value) -> Value {
    let metadata = benchmark
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let run_summary = benchmark
        .get("run_summary")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let notes = benchmark.get("notes").cloned().unwrap_or_else(|| json!([]));

    let runs = benchmark
        .get("runs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|run| {
            let expectations = run
                .get("expectations")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|expectation| {
                    json!({
                        "text": expectation.get("text").cloned().unwrap_or(Value::Null),
                        "passed": expectation.get("passed").cloned().unwrap_or(Value::Null),
                        "evidence": expectation
                            .get("evidence")
                            .and_then(Value::as_str)
                            .map(|text| truncate_text(text, 240)),
                    })
                })
                .collect::<Vec<_>>();

            json!({
                "eval_id": run.get("eval_id").cloned().unwrap_or(Value::Null),
                "configuration": run.get("configuration").cloned().unwrap_or(Value::Null),
                "run_number": run.get("run_number").cloned().unwrap_or(Value::Null),
                "result": run.get("result").cloned().unwrap_or(Value::Null),
                "expectations": expectations,
                "notes": run.get("notes").cloned().unwrap_or_else(|| json!([])),
            })
        })
        .collect::<Vec<_>>();

    json!({
        "metadata": metadata,
        "run_summary": run_summary,
        "notes": notes,
        "runs": runs,
    })
}

fn build_benchmark_smoke_context() -> Value {
    json!({
        "metadata": {
            "skill_name": "smoke-test-skill",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "evals_run": [1],
            "runs_per_configuration": 1
        },
        "run_summary": {
            "with_skill": {
                "pass_rate": { "mean": 1.0, "stddev": 0.0 },
                "time_seconds": { "mean": 12.0, "stddev": 0.0 },
                "tokens": { "mean": 180.0, "stddev": 0.0 }
            },
            "without_skill": {
                "pass_rate": { "mean": 0.0, "stddev": 0.0 },
                "time_seconds": { "mean": 8.0, "stddev": 0.0 },
                "tokens": { "mean": 90.0, "stddev": 0.0 }
            },
            "delta": {
                "pass_rate": "+1.00",
                "time_seconds": "+4.0",
                "tokens": "+90"
            }
        },
        "notes": [],
        "runs": [
            {
                "eval_id": 1,
                "configuration": "with_skill",
                "run_number": 1,
                "result": { "pass_rate": 1.0, "time_seconds": 12.0, "tokens": 180 },
                "expectations": [
                    { "text": "Primary expectation", "passed": true, "evidence": "Output matched the expected structure" },
                    { "text": "Format validation", "passed": true, "evidence": "Validator script passed" }
                ],
                "notes": []
            },
            {
                "eval_id": 1,
                "configuration": "without_skill",
                "run_number": 1,
                "result": { "pass_rate": 0.0, "time_seconds": 8.0, "tokens": 90 },
                "expectations": [
                    { "text": "Primary expectation", "passed": false, "evidence": "Missing required output sections" },
                    { "text": "Format validation", "passed": false, "evidence": "Validator script failed" }
                ],
                "notes": []
            }
        ]
    })
}

fn strip_markdown_code_fence(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let mut lines = trimmed.lines();
    let _ = lines.next();
    let mut body = lines.collect::<Vec<_>>();
    if body.last().map(|line| line.trim()) == Some("```") {
        body.pop();
    }
    body.join("\n").trim().to_string()
}

fn parse_benchmark_notes_value(value: Value) -> Result<Vec<String>, String> {
    let candidate = match value {
        Value::Array(values) => Value::Array(values),
        Value::Object(map) => map
            .get("notes")
            .cloned()
            .or_else(|| {
                map.get("payload")
                    .and_then(|payload| payload.get("notes"))
                    .cloned()
            })
            .ok_or_else(|| "Model response JSON did not contain a notes array".to_string())?,
        _ => {
            return Err(
                "Model response JSON must be either an array or an object with a notes array"
                    .to_string(),
            )
        }
    };

    Ok(candidate
        .as_array()
        .ok_or_else(|| "Model notes response is not an array".to_string())?
        .iter()
        .filter_map(|note| note.as_str().map(str::trim))
        .filter(|note| !note.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>())
}

fn parse_benchmark_notes_response(text: &str) -> Result<Vec<String>, String> {
    let cleaned = strip_markdown_code_fence(text);
    if let Ok(value) = serde_json::from_str::<Value>(&cleaned) {
        return parse_benchmark_notes_value(value);
    }

    for (start_char, end_char) in [('[', ']'), ('{', '}')] {
        if let (Some(start), Some(end)) = (cleaned.find(start_char), cleaned.rfind(end_char)) {
            if start < end {
                if let Ok(value) = serde_json::from_str::<Value>(&cleaned[start..=end]) {
                    if let Ok(notes) = parse_benchmark_notes_value(value) {
                        return Ok(notes);
                    }
                }
            }
        }
    }

    Err("Model response was not valid JSON notes output".to_string())
}

fn extract_text_from_model_response(
    provider: &str,
    api_format: &str,
    response: &Value,
) -> Result<String, String> {
    if api_format == "anthropic" || provider == "anthropic" {
        let content = response
            .get("content")
            .and_then(Value::as_array)
            .ok_or_else(|| "Anthropic response did not contain a content array".to_string())?;
        let text = content
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        return if text.trim().is_empty() {
            Err("Anthropic response did not contain text output".to_string())
        } else {
            Ok(text)
        };
    }

    let message = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .ok_or_else(|| "Provider response did not contain a chat completion message".to_string())?;

    if let Some(text) = message.get("content").and_then(Value::as_str) {
        return Ok(text.to_string());
    }

    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        let text = parts
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !text.trim().is_empty() {
            return Ok(text);
        }
    }

    Err("Provider response did not contain text content".to_string())
}

async fn request_benchmark_notes_from_llm(
    profile: &ResolvedLlmProfile,
    config: &LlmConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<LlmBenchmarkNotesResult, String> {
    let (client, http_config) = build_llm_http_client(profile, config)?;
    let body = if profile.api_format == "anthropic" {
        json!({
            "model": profile.model,
            "max_tokens": 900,
            "temperature": 0.2,
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": user_prompt,
                }
            ]
        })
    } else {
        json!({
            "model": profile.model,
            "max_tokens": 900,
            "temperature": 0.2,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": user_prompt,
                }
            ]
        })
    };

    let max_attempts = 2u32;
    let mut last_error = "Benchmark analyzer request failed".to_string();
    for attempt in 1..=max_attempts {
        let mut request = client
            .post(&profile.endpoint)
            .header("content-type", "application/json");

        if profile.api_format == "anthropic" {
            let api_key = profile
                .api_key
                .clone()
                .filter(|key| !key.trim().is_empty())
                .ok_or_else(|| "Anthropic API key is missing".to_string())?;
            request = request
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01");
        } else if let Some(api_key) = profile.api_key.clone().filter(|key| !key.trim().is_empty()) {
            request = request.header("Authorization", format!("Bearer {api_key}"));
        }

        let response = match request.json(&body).send().await {
            Ok(value) => value,
            Err(error) => {
                last_error = format!("Benchmark analyzer request failed: {error}");
                if attempt < max_attempts {
                    tokio::time::sleep(Duration::from_millis(900)).await;
                    continue;
                }
                return Err(last_error);
            }
        };

        let status = response.status();
        let response_json = response.json::<Value>().await.map_err(|error| {
            format!("Failed to parse benchmark analyzer response JSON: {error}")
        })?;

        if !status.is_success() {
            last_error = format!(
                "Benchmark analyzer provider returned status {}: {}",
                status, response_json
            );
            let retryable =
                status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error();
            if retryable && attempt < max_attempts {
                tokio::time::sleep(Duration::from_millis(900)).await;
                continue;
            }
            return Err(last_error);
        }

        let text = extract_text_from_model_response(
            &profile.provider,
            &profile.api_format,
            &response_json,
        )?;
        let notes = parse_benchmark_notes_response(&text)?;
        return Ok(LlmBenchmarkNotesResult {
            notes,
            raw_text: text,
            response_json,
            status_code: status.as_u16(),
            attempts: attempt,
            proxy_url: http_config.proxy_url.clone(),
            proxy_bypassed: http_config.proxy_bypassed,
        });
    }

    Err(last_error)
}

async fn validate_resolved_llm_profile_connectivity(
    profile: &ResolvedLlmProfile,
    config: &LlmConfig,
) -> Result<(u16, u32, LlmHttpClientConfig), String> {
    let (client, http_config) = build_llm_http_client(profile, config)?;
    let body = if profile.api_format == "anthropic" {
        json!({
            "model": profile.model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}]
        })
    } else {
        json!({
            "model": profile.model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}]
        })
    };

    let max_attempts = 2u32;
    let mut last_error = "Analyzer connectivity probe failed".to_string();
    for attempt in 1..=max_attempts {
        let mut request = client
            .post(&profile.endpoint)
            .header("content-type", "application/json");

        if profile.api_format == "anthropic" {
            let api_key = profile
                .api_key
                .clone()
                .filter(|key| !key.trim().is_empty())
                .ok_or_else(|| "Anthropic API key is missing".to_string())?;
            request = request
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01");
        } else if let Some(api_key) = profile.api_key.clone().filter(|key| !key.trim().is_empty()) {
            request = request.header("Authorization", format!("Bearer {api_key}"));
        }

        let response = match request.json(&body).send().await {
            Ok(value) => value,
            Err(error) => {
                last_error = format!("Analyzer connectivity probe failed: {error}");
                if attempt < max_attempts {
                    tokio::time::sleep(Duration::from_millis(700)).await;
                    continue;
                }
                return Err(last_error);
            }
        };

        let status = response.status();
        let response_text = response.text().await.unwrap_or_else(|_| String::new());
        if status.is_success() {
            return Ok((status.as_u16(), attempt, http_config));
        }

        last_error = format!(
            "Analyzer connectivity probe returned status {}: {}",
            status,
            truncate_text(&response_text, 400)
        );
        let retryable =
            status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error();
        if retryable && attempt < max_attempts {
            tokio::time::sleep(Duration::from_millis(700)).await;
            continue;
        }
        return Err(last_error);
    }

    Err(last_error)
}

fn pick_free_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Failed to allocate a local TCP port: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Failed to inspect local TCP port: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

fn wait_for_local_server(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    let started_at = Instant::now();
    while started_at.elapsed() < timeout {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to poll review server process: {error}"))?
        {
            return Err(format!("Review server exited early with status: {status}"));
        }

        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(());
        }

        std::thread::sleep(Duration::from_millis(150));
    }

    Err(format!(
        "Timed out waiting for the review server to become ready on port {port}"
    ))
}

fn stop_review_server_entry(entry: &mut ManagedSkillReviewServer) -> Result<(), String> {
    if let Some(_status) = entry
        .child
        .try_wait()
        .map_err(|error| format!("Failed to inspect review server process: {error}"))?
    {
        return Ok(());
    }

    entry
        .child
        .kill()
        .map_err(|error| format!("Failed to stop review server process: {error}"))?;
    let _ = entry.child.wait();
    Ok(())
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

    let response = send_command_and_wait(&state, command, 3000).await?;
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
    let error = payload
        .get("error")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    Ok(StartTaskResult {
        success,
        task_id: response_task_id,
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
        input.workspace_path,
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

#[tauri::command]
pub async fn resume_recoverable_tasks(
    input: Option<ResumeRecoverableTasksInput>,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let (task_ids, task_hints) = match input {
        Some(value) => (value.task_ids, value.tasks),
        None => (None, None),
    };
    let payload = json!({
        "taskIds": task_ids,
        "tasks": task_hints.map(|tasks| {
            tasks.into_iter().map(|task| {
                json!({
                    "taskId": task.task_id,
                    "workspacePath": task.workspace_path,
                })
            }).collect::<Vec<_>>()
        }),
    });
    let command = build_command("resume_recoverable_tasks", payload);
    let response = send_command_and_wait(&state, command, 5000).await?;
    Ok(GenericIpcResult {
        success: true,
        payload: response.get("payload").cloned().unwrap_or_else(|| json!({})),
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
}

/// Validate LLM connectivity
#[tauri::command]
pub async fn validate_llm_settings(input: ValidateLlmInput) -> Result<GenericIpcResult, String> {
    info!(
        "validate_llm_settings: validating connectivity for {}",
        input.provider
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let (url, api_key, body) = match input.provider.as_str() {
        "anthropic" => {
            let settings = input.anthropic.ok_or("Missing Anthropic settings")?;
            let key = settings.api_key.ok_or("Missing API key")?;
            let model = settings
                .model
                .unwrap_or_else(|| "claude-3-5-sonnet-20240620".to_string());
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
            let model = settings
                .model
                .unwrap_or_else(|| "anthropic/claude-3.5-sonnet".to_string());
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
        "ollama" => (
            "http://localhost:11434/v1/chat/completions".to_string(),
            String::new(),
            json!({
                "model": "llama3",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "ping"}]
            }),
        ),
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
        provider => {
            if let Some((default_url, default_model)) = openai_compatible_default(provider) {
                let settings = input.openai.ok_or("Missing OpenAI-compatible settings")?;
                let key = settings.api_key.ok_or("Missing API key")?;
                let model = settings.model.unwrap_or_else(|| default_model.to_string());
                (
                    settings.base_url.unwrap_or_else(|| default_url.to_string()),
                    key,
                    json!({
                        "model": model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}]
                    }),
                )
            } else {
                return Err(format!("Unknown provider: {}", input.provider));
            }
        }
    };

    let mut request = client.post(url);

    if input.provider == "anthropic" {
        request = request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json");
    } else if !api_key.is_empty() {
        request = request
            .header("Authorization", format!("Bearer {}", api_key))
            .header("content-type", "application/json");
    } else {
        request = request.header("content-type", "application/json");
    }

    let res = request
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = res.status();
    if status.is_success() {
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
    let content = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| e.to_string())?;

    Ok(SessionsSnapshotResult {
        success: true,
        payload: input,
        error: None,
    })
}

#[tauri::command]
pub async fn get_user_profile(app_handle: AppHandle) -> Result<UserProfileResult, String> {
    let path = user_profile_path(&app_handle)?;
    if !path.exists() {
        return Ok(UserProfileResult {
            success: true,
            payload: UserProfile {
                version: Some(1),
                ..UserProfile::default()
            },
            error: None,
        });
    }

    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;
    let profile: UserProfile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(UserProfileResult {
        success: true,
        payload: UserProfile {
            version: Some(profile.version.unwrap_or(1)),
            ..profile
        },
        error: None,
    })
}

#[tauri::command]
pub async fn save_user_profile(
    app_handle: AppHandle,
    mut input: UserProfile,
) -> Result<UserProfileResult, String> {
    let path = user_profile_path(&app_handle)?;
    input.version = Some(1);
    input.updated_at = Some(chrono::Utc::now().to_rfc3339());

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| e.to_string())?;

    let _ = app_handle.emit("user-profile-updated", &input);

    Ok(UserProfileResult {
        success: true,
        payload: input,
        error: None,
    })
}

#[tauri::command]
pub async fn ensure_skill_evals_file(
    input: EnsureSkillEvalsInput,
) -> Result<SkillCreatorEvalPathsResult, String> {
    let skill_path = PathBuf::from(&input.skill_path);
    let skill_name = input.skill_name.unwrap_or_else(|| {
        skill_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("skill")
            .to_string()
    });
    let evals_dir = skill_path.join("evals");
    let evals_path = evals_dir.join("evals.json");
    let should_overwrite = input.overwrite.unwrap_or(false);
    let created = !evals_path.exists() || should_overwrite;

    if created {
        fs::create_dir_all(&evals_dir).map_err(|e| e.to_string())?;
        let payload = json!({
            "skill_name": skill_name,
            "evals": [],
        });
        fs::write(
            &evals_path,
            serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(SkillCreatorEvalPathsResult {
        success: true,
        path: evals_path.to_string_lossy().to_string(),
        created,
        output_path: None,
        benchmark_json_path: None,
        benchmark_markdown_path: None,
        stdout: None,
        error: None,
    })
}

#[tauri::command]
pub async fn aggregate_skill_benchmark(
    input: AggregateSkillBenchmarkInput,
) -> Result<SkillCreatorEvalPathsResult, String> {
    let benchmark_dir = PathBuf::from(&input.benchmark_dir);
    if !benchmark_dir.exists() {
        return Err(format!(
            "Benchmark directory not found: {}",
            benchmark_dir.display()
        ));
    }

    let skill_creator_root = find_skill_creator_root(Some(&benchmark_dir))?;
    let script_path = skill_creator_root
        .join("scripts")
        .join("aggregate_benchmark.py");
    let benchmark_json_path = benchmark_dir.join("benchmark.json");
    let benchmark_markdown_path = benchmark_dir.join("benchmark.md");

    let mut args = vec![
        benchmark_dir.to_string_lossy().to_string(),
        "--skill-name".to_string(),
        input.skill_name,
    ];
    if let Some(skill_path) = input.skill_path {
        args.push("--skill-path".to_string());
        args.push(skill_path);
    }

    let stdout = run_python_script(&script_path, &args, &skill_creator_root)?;

    Ok(SkillCreatorEvalPathsResult {
        success: true,
        path: benchmark_dir.to_string_lossy().to_string(),
        created: false,
        output_path: None,
        benchmark_json_path: Some(benchmark_json_path.to_string_lossy().to_string()),
        benchmark_markdown_path: Some(benchmark_markdown_path.to_string_lossy().to_string()),
        stdout: Some(stdout),
        error: None,
    })
}

#[tauri::command]
pub async fn generate_skill_review_viewer(
    input: GenerateSkillReviewInput,
) -> Result<SkillCreatorEvalPathsResult, String> {
    let workspace_path = PathBuf::from(&input.workspace_path);
    if !workspace_path.exists() {
        return Err(format!(
            "Workspace directory not found: {}",
            workspace_path.display()
        ));
    }

    let skill_creator_root = find_skill_creator_root(Some(&workspace_path))?;
    let script_path = skill_creator_root
        .join("eval-viewer")
        .join("generate_review.py");
    let output_path = input
        .output_path
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_path.join("review.html"));

    let mut args = vec![
        workspace_path.to_string_lossy().to_string(),
        "--skill-name".to_string(),
        input.skill_name,
        "--static".to_string(),
        output_path.to_string_lossy().to_string(),
    ];
    if let Some(benchmark_path) = input.benchmark_path {
        args.push("--benchmark".to_string());
        args.push(benchmark_path);
    }
    if let Some(previous_workspace_path) = input.previous_workspace_path {
        args.push("--previous-workspace".to_string());
        args.push(previous_workspace_path);
    }

    let stdout = run_python_script(&script_path, &args, &skill_creator_root)?;

    Ok(SkillCreatorEvalPathsResult {
        success: true,
        path: workspace_path.to_string_lossy().to_string(),
        created: false,
        output_path: Some(output_path.to_string_lossy().to_string()),
        benchmark_json_path: None,
        benchmark_markdown_path: None,
        stdout: Some(stdout),
        error: None,
    })
}

#[tauri::command]
pub async fn import_skill_review_feedback(
    input: ImportSkillReviewFeedbackInput,
) -> Result<SkillCreatorEvalPathsResult, String> {
    let workspace_path = PathBuf::from(&input.workspace_path);
    let source_path = PathBuf::from(&input.feedback_path);
    let (destination_path, created, reviews_len) = import_feedback_json(
        &workspace_path,
        &source_path,
        input.overwrite.unwrap_or(true),
    )?;

    Ok(SkillCreatorEvalPathsResult {
        success: true,
        path: destination_path.to_string_lossy().to_string(),
        created,
        output_path: None,
        benchmark_json_path: None,
        benchmark_markdown_path: None,
        stdout: Some(format!(
            "Imported {} review entr{} into {}",
            reviews_len,
            if reviews_len == 1 { "y" } else { "ies" },
            destination_path.display()
        )),
        error: None,
    })
}

#[tauri::command]
pub async fn load_skill_benchmark_preview(
    input: LoadSkillBenchmarkPreviewInput,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let benchmark = read_json_file(&benchmark_path)?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "path": benchmark_path,
            "benchmark": benchmark,
        }),
    })
}

#[tauri::command]
pub async fn load_skill_benchmark_notes_history(
    input: LoadSkillBenchmarkNotesHistoryInput,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let limit = input.limit.unwrap_or(10).max(1);
    let entries = load_benchmark_notes_history(&benchmark_path, limit)?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "path": benchmark_notes_history_path(&benchmark_path),
            "entries": entries,
        }),
    })
}

#[tauri::command]
pub async fn start_skill_review_server(
    input: StartSkillReviewServerInput,
    state: State<'_, SkillReviewServerState>,
) -> Result<SkillReviewServerResult, String> {
    let workspace_path = PathBuf::from(&input.workspace_path);
    if !workspace_path.is_dir() {
        return Err(format!(
            "Workspace directory not found: {}",
            workspace_path.display()
        ));
    }

    let skill_creator_root = find_skill_creator_root(Some(&workspace_path))?;
    let script_path = skill_creator_root
        .join("eval-viewer")
        .join("generate_review.py");
    let benchmark_path = input
        .benchmark_path
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_path.join("benchmark.json"));
    let port = pick_free_local_port()?;

    let log_dir = skill_creator_root.join(".coworkany-review-logs");
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Failed to create review log directory: {error}"))?;
    let log_path = log_dir.join(format!(
        "review-server-{}-{}.log",
        chrono::Utc::now().timestamp_millis(),
        port
    ));
    let stdout_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Failed to create review server log file: {error}"))?;
    let stderr_file = stdout_file
        .try_clone()
        .map_err(|error| format!("Failed to clone review server log file handle: {error}"))?;

    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        workspace_path.to_string_lossy().to_string(),
        "--port".to_string(),
        port.to_string(),
        "--skill-name".to_string(),
        input.skill_name,
    ];
    if benchmark_path.exists() {
        args.push("--benchmark".to_string());
        args.push(benchmark_path.to_string_lossy().to_string());
    }
    if let Some(previous_workspace_path) = input.previous_workspace_path {
        args.push("--previous-workspace".to_string());
        args.push(previous_workspace_path);
    }

    let python = find_python_command().ok_or_else(|| {
        "Python not found. Please install Python 3 and make it available on PATH.".to_string()
    })?;

    let mut child = Command::new(&python)
        .args(&args)
        .current_dir(&skill_creator_root)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|error| format!("Failed to start review server: {error}"))?;

    if let Err(error) = wait_for_local_server(&mut child, port, Duration::from_secs(10)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("{error}. See {}", log_path.display()));
    }

    let workspace_key = workspace_path.to_string_lossy().to_string();
    let url = format!("http://localhost:{port}");
    let mut servers = state.lock().await;
    let restarted = if let Some(existing) = servers.get_mut(&workspace_key) {
        stop_review_server_entry(existing)?;
        true
    } else {
        false
    };
    servers.insert(
        workspace_key.clone(),
        ManagedSkillReviewServer {
            child,
            url: url.clone(),
            port,
            log_path: log_path.clone(),
        },
    );

    Ok(SkillReviewServerResult {
        success: true,
        workspace_path: workspace_key,
        url: Some(url),
        port: Some(port),
        running: true,
        restarted,
        log_path: Some(log_path.to_string_lossy().to_string()),
        error: None,
    })
}

#[tauri::command]
pub async fn stop_skill_review_server(
    input: StopSkillReviewServerInput,
    state: State<'_, SkillReviewServerState>,
) -> Result<SkillReviewServerResult, String> {
    let workspace_key = input.workspace_path;
    let mut servers = state.lock().await;
    if let Some(mut server) = servers.remove(&workspace_key) {
        let url = server.url.clone();
        let port = server.port;
        let log_path = server.log_path.to_string_lossy().to_string();
        stop_review_server_entry(&mut server)?;
        return Ok(SkillReviewServerResult {
            success: true,
            workspace_path: workspace_key,
            url: Some(url),
            port: Some(port),
            running: false,
            restarted: false,
            log_path: Some(log_path),
            error: None,
        });
    }

    Ok(SkillReviewServerResult {
        success: true,
        workspace_path: workspace_key,
        url: None,
        port: None,
        running: false,
        restarted: false,
        log_path: None,
        error: None,
    })
}

#[tauri::command]
pub async fn get_skill_review_server_status(
    input: GetSkillReviewServerStatusInput,
    state: State<'_, SkillReviewServerState>,
) -> Result<SkillReviewServerResult, String> {
    let workspace_key = PathBuf::from(&input.workspace_path)
        .to_string_lossy()
        .to_string();
    let mut servers = state.lock().await;
    if let Some(server) = servers.get_mut(&workspace_key) {
        let exited = server
            .child
            .try_wait()
            .map_err(|error| format!("Failed to inspect review server process: {error}"))?;
        if exited.is_some() {
            let log_path = server.log_path.to_string_lossy().to_string();
            servers.remove(&workspace_key);
            return Ok(SkillReviewServerResult {
                success: true,
                workspace_path: workspace_key,
                url: None,
                port: None,
                running: false,
                restarted: false,
                log_path: Some(log_path),
                error: None,
            });
        }

        return Ok(SkillReviewServerResult {
            success: true,
            workspace_path: workspace_key,
            url: Some(server.url.clone()),
            port: Some(server.port),
            running: true,
            restarted: false,
            log_path: Some(server.log_path.to_string_lossy().to_string()),
            error: None,
        });
    }

    Ok(SkillReviewServerResult {
        success: true,
        workspace_path: workspace_key,
        url: None,
        port: None,
        running: false,
        restarted: false,
        log_path: None,
        error: None,
    })
}

#[tauri::command]
pub async fn save_skill_benchmark_notes(
    input: SaveSkillBenchmarkNotesInput,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let previous_notes = read_benchmark_notes(&benchmark_path)?;
    let notes: Vec<String> = input
        .notes
        .into_iter()
        .map(|note| note.trim().to_string())
        .filter(|note| !note.is_empty())
        .collect();
    write_benchmark_notes(&benchmark_path, &notes)?;
    let history_entry = append_benchmark_notes_history(
        &benchmark_path,
        &notes,
        &previous_notes,
        input.metadata.as_ref(),
    )?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "path": benchmark_path,
            "notes": notes,
            "historyEntry": history_entry,
            "historyPath": benchmark_notes_history_path(&benchmark_path),
        }),
    })
}

#[tauri::command]
pub async fn check_skill_benchmark_analyzer(
    input: Option<CheckSkillBenchmarkAnalyzerInput>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = input
        .and_then(|value| value.benchmark_path)
        .map(PathBuf::from);
    let settings = get_llm_settings(app_handle).await?;
    let config = settings.payload;
    let profile = match resolve_active_llm_profile(&config) {
        Ok(value) => value,
        Err(error) => {
            let status_path = if let Some(path) = benchmark_path.as_ref() {
                let status = AnalyzerHealthStatus {
                    checked_at: chrono::Utc::now().to_rfc3339(),
                    benchmark_path: Some(path.to_string_lossy().to_string()),
                    provider: None,
                    model: None,
                    endpoint: None,
                    configured: false,
                    reachable: false,
                    result_source: "probe".to_string(),
                    warning: None,
                    error: Some(error.clone()),
                    status_code: None,
                    attempt_count: 0,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                };
                write_analyzer_health_status(path, &status).ok()
            } else {
                None
            };
            return Ok(GenericIpcResult {
                success: true,
                payload: json!({
                    "configured": false,
                    "reachable": false,
                    "error": error,
                    "checkedAt": chrono::Utc::now().to_rfc3339(),
                    "resultSource": "probe",
                    "statusPath": status_path,
                }),
            });
        }
    };

    match validate_resolved_llm_profile_connectivity(&profile, &config).await {
        Ok((status_code, attempts, http_config)) => {
            let status_path = if let Some(path) = benchmark_path.as_ref() {
                let status = AnalyzerHealthStatus {
                    checked_at: chrono::Utc::now().to_rfc3339(),
                    benchmark_path: Some(path.to_string_lossy().to_string()),
                    provider: Some(profile.provider.clone()),
                    model: Some(profile.model.clone()),
                    endpoint: Some(profile.endpoint.clone()),
                    configured: true,
                    reachable: true,
                    result_source: "probe".to_string(),
                    warning: None,
                    error: None,
                    status_code: Some(status_code),
                    attempt_count: attempts,
                    proxy_url: http_config.proxy_url.clone(),
                    proxy_bypassed: http_config.proxy_bypassed,
                    log_path: None,
                };
                write_analyzer_health_status(path, &status).ok()
            } else {
                None
            };
            Ok(GenericIpcResult {
                success: true,
                payload: json!({
                    "configured": true,
                    "reachable": true,
                    "provider": profile.provider,
                    "model": profile.model,
                    "endpoint": profile.endpoint,
                    "statusCode": status_code,
                    "attemptCount": attempts,
                    "proxyUrl": http_config.proxy_url,
                    "proxyBypassed": http_config.proxy_bypassed,
                    "checkedAt": chrono::Utc::now().to_rfc3339(),
                    "resultSource": "probe",
                    "statusPath": status_path,
                }),
            })
        }
        Err(error) => {
            let status_path = if let Some(path) = benchmark_path.as_ref() {
                let status = AnalyzerHealthStatus {
                    checked_at: chrono::Utc::now().to_rfc3339(),
                    benchmark_path: Some(path.to_string_lossy().to_string()),
                    provider: Some(profile.provider.clone()),
                    model: Some(profile.model.clone()),
                    endpoint: Some(profile.endpoint.clone()),
                    configured: true,
                    reachable: false,
                    result_source: "probe".to_string(),
                    warning: None,
                    error: Some(error.clone()),
                    status_code: None,
                    attempt_count: 0,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                };
                write_analyzer_health_status(path, &status).ok()
            } else {
                None
            };
            Ok(GenericIpcResult {
                success: true,
                payload: json!({
                    "configured": true,
                    "reachable": false,
                    "provider": profile.provider,
                    "model": profile.model,
                    "endpoint": profile.endpoint,
                    "error": error,
                    "checkedAt": chrono::Utc::now().to_rfc3339(),
                    "resultSource": "probe",
                    "statusPath": status_path,
                }),
            })
        }
    }
}

#[tauri::command]
pub async fn load_skill_benchmark_analyzer_status(
    input: LoadSkillBenchmarkAnalyzerStatusInput,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let status = load_analyzer_health_status(&benchmark_path)?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "path": analyzer_health_status_path(&benchmark_path),
            "status": status,
        }),
    })
}

#[tauri::command]
pub async fn load_skill_benchmark_analyzer_history(
    input: LoadSkillBenchmarkAnalyzerHistoryInput,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let limit = input.limit.unwrap_or(10).max(1);
    let entries = load_analyzer_health_history(&benchmark_path, limit)?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "path": analyzer_health_history_path(&benchmark_path),
            "entries": entries,
        }),
    })
}

#[tauri::command]
pub async fn run_skill_benchmark_analyzer_smoke(
    input: RunSkillBenchmarkAnalyzerSmokeInput,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let skill_path = input
        .skill_path
        .unwrap_or_else(|| "<unknown-skill-path>".to_string());
    let benchmark_context = build_benchmark_smoke_context();
    let benchmark_context_json = serde_json::to_string_pretty(&benchmark_context)
        .map_err(|error| format!("Failed to serialize analyzer smoke context: {error}"))?;
    let system_prompt = format!(
        "{}\n\nReturn valid JSON only. The response must be either a JSON array of strings or an object with a top-level \"notes\" array of strings. Do not include markdown fences or explanatory text.",
        load_benchmark_analyzer_instructions(&benchmark_path)
    );
    let user_prompt = format!(
        "Run a benchmark-analysis smoke test for this skill.\n\nskill_path: {}\nbenchmark_data_path: {}\n\nbenchmark.json (synthetic smoke fixture):\n{}",
        skill_path,
        benchmark_path.display(),
        benchmark_context_json
    );
    let generated_at = chrono::Utc::now().to_rfc3339();

    let settings = get_llm_settings(app_handle).await?;
    let config = settings.payload;
    let profile = match resolve_active_llm_profile(&config) {
        Ok(value) => value,
        Err(error) => {
            let status = AnalyzerHealthStatus {
                checked_at: generated_at.clone(),
                benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                provider: None,
                model: None,
                endpoint: None,
                configured: false,
                reachable: false,
                result_source: "smoke".to_string(),
                warning: None,
                error: Some(error.clone()),
                status_code: None,
                attempt_count: 0,
                proxy_url: None,
                proxy_bypassed: false,
                log_path: None,
            };
            let status_path = write_analyzer_health_status(&benchmark_path, &status)?;
            return Ok(GenericIpcResult {
                success: true,
                payload: json!({
                    "configured": false,
                    "reachable": false,
                    "error": error,
                    "checkedAt": generated_at,
                    "resultSource": "smoke",
                    "statusPath": status_path,
                }),
            });
        }
    };

    match request_benchmark_notes_from_llm(&profile, &config, &system_prompt, &user_prompt).await {
        Ok(model_notes) => {
            let log = AnalyzerInvocationLog {
                generated_at: generated_at.clone(),
                benchmark_path: benchmark_path.to_string_lossy().to_string(),
                skill_path: skill_path.clone(),
                provider: profile.provider.clone(),
                model: profile.model.clone(),
                api_format: profile.api_format.clone(),
                endpoint: profile.endpoint.clone(),
                proxy_url: model_notes.proxy_url.clone(),
                proxy_bypassed: model_notes.proxy_bypassed,
                attempt_count: model_notes.attempts,
                status_code: Some(model_notes.status_code),
                result_source: "smoke".to_string(),
                notes: model_notes.notes.clone(),
                warning: None,
                error: None,
                system_prompt,
                user_prompt,
                response_text: Some(model_notes.raw_text.clone()),
                response_json: Some(model_notes.response_json.clone()),
            };
            let log_path = write_analyzer_invocation_log(&benchmark_path, &log)?;
            let status = AnalyzerHealthStatus {
                checked_at: generated_at.clone(),
                benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                provider: Some(profile.provider.clone()),
                model: Some(profile.model.clone()),
                endpoint: Some(profile.endpoint.clone()),
                configured: true,
                reachable: true,
                result_source: "smoke".to_string(),
                warning: None,
                error: None,
                status_code: Some(model_notes.status_code),
                attempt_count: model_notes.attempts,
                proxy_url: model_notes.proxy_url.clone(),
                proxy_bypassed: model_notes.proxy_bypassed,
                log_path: Some(log_path.to_string_lossy().to_string()),
            };
            let status_path = write_analyzer_health_status(&benchmark_path, &status)?;

            Ok(GenericIpcResult {
                success: true,
                payload: json!({
                    "configured": true,
                    "reachable": true,
                    "provider": profile.provider,
                    "model": profile.model,
                    "endpoint": profile.endpoint,
                    "checkedAt": generated_at,
                    "resultSource": "smoke",
                    "attemptCount": model_notes.attempts,
                    "statusCode": model_notes.status_code,
                    "proxyUrl": model_notes.proxy_url,
                    "proxyBypassed": model_notes.proxy_bypassed,
                    "logPath": log_path,
                    "statusPath": status_path,
                    "notes": model_notes.notes,
                }),
            })
        }
        Err(error) => {
            let log = AnalyzerInvocationLog {
                generated_at: generated_at.clone(),
                benchmark_path: benchmark_path.to_string_lossy().to_string(),
                skill_path: skill_path.clone(),
                provider: profile.provider.clone(),
                model: profile.model.clone(),
                api_format: profile.api_format.clone(),
                endpoint: profile.endpoint.clone(),
                proxy_url: None,
                proxy_bypassed: false,
                attempt_count: 0,
                status_code: None,
                result_source: "smoke".to_string(),
                notes: Vec::new(),
                warning: None,
                error: Some(error.clone()),
                system_prompt,
                user_prompt,
                response_text: None,
                response_json: None,
            };
            let log_path = write_analyzer_invocation_log(&benchmark_path, &log)?;
            let status = AnalyzerHealthStatus {
                checked_at: generated_at.clone(),
                benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                provider: Some(profile.provider.clone()),
                model: Some(profile.model.clone()),
                endpoint: Some(profile.endpoint.clone()),
                configured: true,
                reachable: false,
                result_source: "smoke".to_string(),
                warning: None,
                error: Some(error.clone()),
                status_code: None,
                attempt_count: 0,
                proxy_url: None,
                proxy_bypassed: false,
                log_path: Some(log_path.to_string_lossy().to_string()),
            };
            let status_path = write_analyzer_health_status(&benchmark_path, &status)?;

            Ok(GenericIpcResult {
                success: true,
                payload: json!({
                    "configured": true,
                    "reachable": false,
                    "provider": profile.provider,
                    "model": profile.model,
                    "endpoint": profile.endpoint,
                    "checkedAt": generated_at,
                    "resultSource": "smoke",
                    "error": error,
                    "logPath": log_path,
                    "statusPath": status_path,
                }),
            })
        }
    }
}

#[tauri::command]
pub async fn assess_skill_benchmark_analyzer_readiness(
    input: AssessSkillBenchmarkAnalyzerReadinessInput,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let history = load_analyzer_health_history(&benchmark_path, 20)?;
    let assessment = assess_analyzer_readiness(&benchmark_path, &history);
    let readiness_path = write_analyzer_readiness_assessment(&benchmark_path, &assessment)?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "path": readiness_path,
            "assessment": assessment,
        }),
    })
}

#[tauri::command]
pub async fn generate_skill_benchmark_notes(
    input: GenerateSkillBenchmarkNotesInput,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let benchmark_path = PathBuf::from(&input.benchmark_path);
    let benchmark = read_json_file(&benchmark_path)?;
    let heuristic_notes = generate_benchmark_notes_from_value(&benchmark);

    let benchmark_context = build_benchmark_analysis_context(&benchmark);
    let benchmark_context_json = serde_json::to_string_pretty(&benchmark_context)
        .map_err(|error| format!("Failed to serialize benchmark analysis context: {error}"))?;
    let skill_path = input
        .skill_path
        .clone()
        .unwrap_or_else(|| "<unknown-skill-path>".to_string());
    let system_prompt = format!(
        "{}\n\nReturn valid JSON only. The response must be either a JSON array of strings or an object with a top-level \"notes\" array of strings. Do not include markdown fences or explanatory text.",
        load_benchmark_analyzer_instructions(&benchmark_path)
    );
    let user_prompt = format!(
        "Generate benchmark-analysis notes for this skill.\n\nskill_path: {}\nbenchmark_data_path: {}\n\nbenchmark.json (curated for analysis):\n{}",
        skill_path,
        benchmark_path.display(),
        benchmark_context_json
    );

    let mut source = "heuristic".to_string();
    let mut provider_name: Option<String> = None;
    let mut model_name: Option<String> = None;
    let mut endpoint_name: Option<String> = None;
    let mut warning: Option<String> = None;
    let mut attempt_count = 0u32;
    let mut proxy_url: Option<String> = None;
    let mut proxy_bypassed = false;
    let generated_at = chrono::Utc::now().to_rfc3339();
    let (notes, log_path) = match get_llm_settings(app_handle).await {
        Ok(result) => match resolve_active_llm_profile(&result.payload) {
            Ok(profile) => {
                provider_name = Some(profile.provider.clone());
                model_name = Some(profile.model.clone());
                endpoint_name = Some(profile.endpoint.clone());
                match request_benchmark_notes_from_llm(
                    &profile,
                    &result.payload,
                    &system_prompt,
                    &user_prompt,
                )
                .await
                {
                    Ok(model_notes) if !model_notes.notes.is_empty() => {
                        source = "llm".to_string();
                        attempt_count = model_notes.attempts;
                        proxy_url = model_notes.proxy_url.clone();
                        proxy_bypassed = model_notes.proxy_bypassed;
                        let log = AnalyzerInvocationLog {
                            generated_at: generated_at.clone(),
                            benchmark_path: benchmark_path.to_string_lossy().to_string(),
                            skill_path: skill_path.clone(),
                            provider: profile.provider.clone(),
                            model: profile.model.clone(),
                            api_format: profile.api_format.clone(),
                            endpoint: profile.endpoint.clone(),
                            proxy_url: model_notes.proxy_url.clone(),
                            proxy_bypassed: model_notes.proxy_bypassed,
                            attempt_count: model_notes.attempts,
                            status_code: Some(model_notes.status_code),
                            result_source: "llm".to_string(),
                            notes: model_notes.notes.clone(),
                            warning: None,
                            error: None,
                            system_prompt: system_prompt.clone(),
                            user_prompt: user_prompt.clone(),
                            response_text: Some(model_notes.raw_text.clone()),
                            response_json: Some(model_notes.response_json.clone()),
                        };
                        (
                            model_notes.notes,
                            Some(write_analyzer_invocation_log(&benchmark_path, &log)?),
                        )
                    }
                    Ok(model_notes) => {
                        attempt_count = model_notes.attempts;
                        proxy_url = model_notes.proxy_url.clone();
                        proxy_bypassed = model_notes.proxy_bypassed;
                        warning = Some("Model analyzer returned an empty notes array; fell back to heuristic draft.".to_string());
                        let log = AnalyzerInvocationLog {
                            generated_at: generated_at.clone(),
                            benchmark_path: benchmark_path.to_string_lossy().to_string(),
                            skill_path: skill_path.clone(),
                            provider: profile.provider.clone(),
                            model: profile.model.clone(),
                            api_format: profile.api_format.clone(),
                            endpoint: profile.endpoint.clone(),
                            proxy_url: model_notes.proxy_url.clone(),
                            proxy_bypassed: model_notes.proxy_bypassed,
                            attempt_count: model_notes.attempts,
                            status_code: Some(model_notes.status_code),
                            result_source: "heuristic".to_string(),
                            notes: heuristic_notes.clone(),
                            warning: warning.clone(),
                            error: Some("Model analyzer returned an empty notes array".to_string()),
                            system_prompt: system_prompt.clone(),
                            user_prompt: user_prompt.clone(),
                            response_text: Some(model_notes.raw_text.clone()),
                            response_json: Some(model_notes.response_json.clone()),
                        };
                        (
                            heuristic_notes,
                            Some(write_analyzer_invocation_log(&benchmark_path, &log)?),
                        )
                    }
                    Err(error) => {
                        warn!(
                            "generate_skill_benchmark_notes: LLM analyzer failed for {}: {}",
                            benchmark_path.display(),
                            error
                        );
                        warning = Some(format!(
                            "Model analyzer failed and CoworkAny fell back to the heuristic draft: {error}"
                        ));
                        let log = AnalyzerInvocationLog {
                            generated_at: generated_at.clone(),
                            benchmark_path: benchmark_path.to_string_lossy().to_string(),
                            skill_path: skill_path.clone(),
                            provider: profile.provider.clone(),
                            model: profile.model.clone(),
                            api_format: profile.api_format.clone(),
                            endpoint: profile.endpoint.clone(),
                            proxy_url: None,
                            proxy_bypassed: false,
                            attempt_count: 0,
                            status_code: None,
                            result_source: "heuristic".to_string(),
                            notes: heuristic_notes.clone(),
                            warning: warning.clone(),
                            error: Some(error),
                            system_prompt: system_prompt.clone(),
                            user_prompt: user_prompt.clone(),
                            response_text: None,
                            response_json: None,
                        };
                        (
                            heuristic_notes,
                            Some(write_analyzer_invocation_log(&benchmark_path, &log)?),
                        )
                    }
                }
            }
            Err(error) => {
                warning = Some(format!(
                    "No active model-backed analyzer is available, so CoworkAny used the heuristic draft: {error}"
                ));
                let log = AnalyzerInvocationLog {
                    generated_at: generated_at.clone(),
                    benchmark_path: benchmark_path.to_string_lossy().to_string(),
                    skill_path: skill_path.clone(),
                    provider: "<unconfigured>".to_string(),
                    model: "<unconfigured>".to_string(),
                    api_format: "<unknown>".to_string(),
                    endpoint: "<unknown>".to_string(),
                    proxy_url: None,
                    proxy_bypassed: false,
                    attempt_count: 0,
                    status_code: None,
                    result_source: "heuristic".to_string(),
                    notes: heuristic_notes.clone(),
                    warning: warning.clone(),
                    error: Some(error),
                    system_prompt: system_prompt.clone(),
                    user_prompt: user_prompt.clone(),
                    response_text: None,
                    response_json: None,
                };
                (
                    heuristic_notes,
                    Some(write_analyzer_invocation_log(&benchmark_path, &log)?),
                )
            }
        },
        Err(error) => {
            warning = Some(format!(
                "LLM settings could not be loaded, so CoworkAny used the heuristic draft: {error}"
            ));
            let log = AnalyzerInvocationLog {
                generated_at: generated_at.clone(),
                benchmark_path: benchmark_path.to_string_lossy().to_string(),
                skill_path: skill_path.clone(),
                provider: "<settings-error>".to_string(),
                model: "<settings-error>".to_string(),
                api_format: "<unknown>".to_string(),
                endpoint: "<unknown>".to_string(),
                proxy_url: None,
                proxy_bypassed: false,
                attempt_count: 0,
                status_code: None,
                result_source: "heuristic".to_string(),
                notes: heuristic_notes.clone(),
                warning: warning.clone(),
                error: Some(error),
                system_prompt: system_prompt.clone(),
                user_prompt: user_prompt.clone(),
                response_text: None,
                response_json: None,
            };
            (
                heuristic_notes,
                Some(write_analyzer_invocation_log(&benchmark_path, &log)?),
            )
        }
    };

    let health_status = AnalyzerHealthStatus {
        checked_at: generated_at.clone(),
        benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
        provider: provider_name.clone(),
        model: model_name.clone(),
        endpoint: endpoint_name.clone(),
        configured: provider_name.is_some(),
        reachable: source == "llm",
        result_source: "generate".to_string(),
        warning: warning.clone(),
        error: if source == "llm" {
            None
        } else {
            warning.clone()
        },
        status_code: if source == "llm" { Some(200) } else { None },
        attempt_count,
        proxy_url: proxy_url.clone(),
        proxy_bypassed,
        log_path: log_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
    };
    let status_path = write_analyzer_health_status(&benchmark_path, &health_status)?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "path": benchmark_path,
            "notes": notes,
            "source": source,
            "provider": provider_name,
            "model": model_name,
            "warning": warning,
            "generatedAt": generated_at,
            "attemptCount": attempt_count,
            "proxyUrl": proxy_url,
            "proxyBypassed": proxy_bypassed,
            "logPath": log_path,
            "statusPath": status_path,
            "checkedAt": generated_at,
            "resultSource": "generate",
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        append_benchmark_notes_history, assess_analyzer_readiness, benchmark_notes_history_path,
        build_benchmark_smoke_context, generate_benchmark_notes_from_value, import_feedback_json,
        load_analyzer_health_history, load_analyzer_health_status, load_benchmark_notes_history,
        parse_benchmark_notes_response, pick_free_local_port, read_json_file,
        resolve_active_llm_profile, should_bypass_proxy, write_analyzer_health_status,
        write_analyzer_invocation_log, write_benchmark_notes, AnalyzerHealthHistoryEntry,
        AnalyzerHealthStatus, AnalyzerInvocationLog, AnthropicProviderSettings,
        BenchmarkNotesSaveMetadataInput, LlmConfig, LlmProfile, OpenAIProviderSettings,
        ProxySettings,
    };
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    #[test]
    fn import_feedback_json_normalizes_status_and_writes_workspace_file() {
        let root = std::env::temp_dir().join(format!("coworkany-feedback-test-{}", Uuid::new_v4()));
        let workspace = root.join("iteration-1");
        let source = root.join("downloaded-feedback.json");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::write(
            &source,
            r#"{
  "reviews": [
    {
      "run_id": "eval-1-with_skill-run-1",
      "feedback": "Looks good",
      "timestamp": "2026-03-14T10:00:00Z"
    }
  ]
}"#,
        )
        .expect("write source feedback");

        let (destination, created, reviews_len) =
            import_feedback_json(&workspace, &source, true).expect("import feedback");
        assert!(created);
        assert_eq!(reviews_len, 1);
        assert_eq!(destination, workspace.join("feedback.json"));

        let saved: Value = serde_json::from_str(
            &fs::read_to_string(&destination).expect("read imported feedback"),
        )
        .expect("parse imported feedback");
        assert_eq!(
            saved.get("status").and_then(Value::as_str),
            Some("complete")
        );
        assert_eq!(
            saved
                .get("reviews")
                .and_then(Value::as_array)
                .map(std::vec::Vec::len),
            Some(1)
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn read_json_file_returns_parsed_object() {
        let root =
            std::env::temp_dir().join(format!("coworkany-benchmark-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        let file = root.join("benchmark.json");
        fs::write(
            &file,
            r#"{ "metadata": { "skill_name": "sample-skill" }, "notes": ["note 1"] }"#,
        )
        .expect("write benchmark fixture");

        let parsed = read_json_file(&file).expect("read benchmark json");
        assert_eq!(
            parsed
                .get("metadata")
                .and_then(Value::as_object)
                .and_then(|metadata| metadata.get("skill_name"))
                .and_then(Value::as_str),
            Some("sample-skill")
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pick_free_local_port_returns_non_zero_port() {
        let port = pick_free_local_port().expect("allocate local port");
        assert!(port > 0);
    }

    #[test]
    fn write_benchmark_notes_updates_top_level_notes() {
        let root =
            std::env::temp_dir().join(format!("coworkany-benchmark-notes-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        let file = root.join("benchmark.json");
        fs::write(
            &file,
            r#"{
  "metadata": { "skill_name": "sample-skill" },
  "runs": [],
  "run_summary": {},
  "notes": []
}"#,
        )
        .expect("write benchmark fixture");

        write_benchmark_notes(
            &file,
            &[
                "Without-skill runs consistently fail on the primary expectation".to_string(),
                "Skill adds slight latency but improves pass rate".to_string(),
            ],
        )
        .expect("write benchmark notes");

        let parsed = read_json_file(&file).expect("reload benchmark");
        assert_eq!(
            parsed
                .get("notes")
                .and_then(Value::as_array)
                .map(std::vec::Vec::len),
            Some(2)
        );
        let markdown =
            fs::read_to_string(file.with_extension("md")).expect("read benchmark markdown");
        assert!(markdown.contains("## Notes"));
        assert!(
            markdown.contains("Without-skill runs consistently fail on the primary expectation")
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn benchmark_notes_history_records_provenance_and_previous_notes() {
        let root = std::env::temp_dir().join(format!(
            "coworkany-benchmark-history-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        let file = root.join("benchmark.json");
        fs::write(
            &file,
            r#"{
  "metadata": { "skill_name": "sample-skill" },
  "runs": [],
  "run_summary": {},
  "notes": ["old note"]
}"#,
        )
        .expect("write benchmark fixture");

        write_benchmark_notes(&file, &["new note".to_string()]).expect("write benchmark notes");
        let entry = append_benchmark_notes_history(
            &file,
            &["new note".to_string()],
            &["old note".to_string()],
            Some(&BenchmarkNotesSaveMetadataInput {
                source: Some("llm".to_string()),
                provider: Some("anthropic".to_string()),
                model: Some("claude-test".to_string()),
                warning: Some("fallback warning".to_string()),
                generated_at: Some("2026-03-14T12:00:00Z".to_string()),
            }),
        )
        .expect("append history");

        assert_eq!(entry.source.as_deref(), Some("llm"));
        assert_eq!(entry.previous_notes, vec!["old note".to_string()]);
        let history_path = benchmark_notes_history_path(&file);
        assert!(history_path.exists());

        let history = load_benchmark_notes_history(&file, 10).expect("load history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].notes, vec!["new note".to_string()]);
        assert_eq!(history[0].previous_notes, vec!["old note".to_string()]);
        assert_eq!(history[0].provider.as_deref(), Some("anthropic"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn should_bypass_proxy_matches_exact_and_suffix_hosts() {
        let proxy = ProxySettings {
            enabled: Some(true),
            url: Some("http://localhost:7890".to_string()),
            bypass: Some("localhost,internal.example.com,.corp.local".to_string()),
        };

        assert!(should_bypass_proxy(
            "https://internal.example.com/v1/chat/completions",
            &proxy
        ));
        assert!(should_bypass_proxy(
            "https://api.corp.local/v1/messages",
            &proxy
        ));
        assert!(!should_bypass_proxy(
            "https://openrouter.ai/api/v1/chat/completions",
            &proxy
        ));
    }

    #[test]
    fn write_analyzer_invocation_log_creates_json_artifact() {
        let root =
            std::env::temp_dir().join(format!("coworkany-analyzer-log-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        let benchmark_path = root.join("benchmark.json");
        fs::write(&benchmark_path, "{}").expect("write benchmark placeholder");

        let path = write_analyzer_invocation_log(
            &benchmark_path,
            &AnalyzerInvocationLog {
                generated_at: "2026-03-14T12:00:00Z".to_string(),
                benchmark_path: benchmark_path.to_string_lossy().to_string(),
                skill_path: "D:/skills/sample-skill".to_string(),
                provider: "anthropic".to_string(),
                model: "claude-test".to_string(),
                api_format: "anthropic".to_string(),
                endpoint: "https://api.anthropic.com/v1/messages".to_string(),
                proxy_url: Some("http://localhost:7890".to_string()),
                proxy_bypassed: false,
                attempt_count: 2,
                status_code: Some(200),
                result_source: "llm".to_string(),
                notes: vec!["note a".to_string()],
                warning: None,
                error: None,
                system_prompt: "system".to_string(),
                user_prompt: "user".to_string(),
                response_text: Some("[\"note a\"]".to_string()),
                response_json: Some(
                    serde_json::json!({"content":[{"type":"text","text":"[\"note a\"]"}]}),
                ),
            },
        )
        .expect("write analyzer log");

        assert!(path.exists());
        let raw = fs::read_to_string(&path).expect("read analyzer log");
        assert!(raw.contains("\"provider\": \"anthropic\""));
        assert!(raw.contains("\"attemptCount\": 2"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn analyzer_health_status_round_trips_from_workspace_file() {
        let root =
            std::env::temp_dir().join(format!("coworkany-analyzer-status-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        let benchmark_path = root.join("benchmark.json");
        fs::write(&benchmark_path, "{}").expect("write benchmark placeholder");

        write_analyzer_health_status(
            &benchmark_path,
            &AnalyzerHealthStatus {
                checked_at: "2026-03-14T13:00:00Z".to_string(),
                benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                provider: Some("openrouter".to_string()),
                model: Some("anthropic/claude-3.5-sonnet".to_string()),
                endpoint: Some("https://openrouter.ai/api/v1/chat/completions".to_string()),
                configured: true,
                reachable: false,
                result_source: "probe".to_string(),
                warning: None,
                error: Some("timeout".to_string()),
                status_code: None,
                attempt_count: 2,
                proxy_url: Some("http://localhost:7890".to_string()),
                proxy_bypassed: false,
                log_path: Some(root.join("log.json").to_string_lossy().to_string()),
            },
        )
        .expect("write analyzer health status");

        let loaded = load_analyzer_health_status(&benchmark_path)
            .expect("load analyzer health status")
            .expect("status should exist");
        assert_eq!(loaded.provider.as_deref(), Some("openrouter"));
        assert!(!loaded.reachable);
        assert_eq!(loaded.attempt_count, 2);
        assert_eq!(loaded.error.as_deref(), Some("timeout"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn analyzer_health_history_loads_newest_entries_first() {
        let root = std::env::temp_dir().join(format!(
            "coworkany-analyzer-history-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        let benchmark_path = root.join("benchmark.json");
        fs::write(&benchmark_path, "{}").expect("write benchmark placeholder");

        write_analyzer_health_status(
            &benchmark_path,
            &AnalyzerHealthStatus {
                checked_at: "2026-03-14T13:00:00Z".to_string(),
                benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                provider: Some("anthropic".to_string()),
                model: Some("claude-a".to_string()),
                endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                configured: true,
                reachable: false,
                result_source: "probe".to_string(),
                warning: None,
                error: Some("timeout".to_string()),
                status_code: None,
                attempt_count: 1,
                proxy_url: None,
                proxy_bypassed: false,
                log_path: None,
            },
        )
        .expect("write first status");

        write_analyzer_health_status(
            &benchmark_path,
            &AnalyzerHealthStatus {
                checked_at: "2026-03-14T13:05:00Z".to_string(),
                benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                provider: Some("anthropic".to_string()),
                model: Some("claude-a".to_string()),
                endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                configured: true,
                reachable: true,
                result_source: "generate".to_string(),
                warning: None,
                error: None,
                status_code: Some(200),
                attempt_count: 2,
                proxy_url: Some("http://localhost:7890".to_string()),
                proxy_bypassed: false,
                log_path: Some(root.join("log.json").to_string_lossy().to_string()),
            },
        )
        .expect("write second status");

        let history = load_analyzer_health_history(&benchmark_path, 10).expect("load history");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].status.checked_at, "2026-03-14T13:05:00Z");
        assert!(history[0].status.reachable);
        assert_eq!(history[1].status.checked_at, "2026-03-14T13:00:00Z");
        assert!(!history[1].status.reachable);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn build_benchmark_smoke_context_contains_comparison_runs() {
        let smoke = build_benchmark_smoke_context();
        let runs = smoke
            .get("runs")
            .and_then(Value::as_array)
            .expect("smoke runs array");
        assert_eq!(runs.len(), 2);
        let configurations = runs
            .iter()
            .filter_map(|run| run.get("configuration").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert!(configurations.contains(&"with_skill"));
        assert!(configurations.contains(&"without_skill"));
    }

    #[test]
    fn assess_analyzer_readiness_requires_smoke_success() {
        let benchmark_path = PathBuf::from("D:/tmp/benchmark.json");
        let blocked = assess_analyzer_readiness(
            &benchmark_path,
            &[AnalyzerHealthHistoryEntry {
                id: "1".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: "2026-03-14T13:00:00Z".to_string(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: true,
                    result_source: "probe".to_string(),
                    warning: None,
                    error: None,
                    status_code: Some(200),
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            }],
        );
        assert_eq!(blocked.level, "blocked");

        let ready = assess_analyzer_readiness(
            &benchmark_path,
            &[AnalyzerHealthHistoryEntry {
                id: "2".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: "2026-03-14T13:05:00Z".to_string(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: true,
                    result_source: "smoke".to_string(),
                    warning: None,
                    error: None,
                    status_code: Some(200),
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            }],
        );
        assert_eq!(ready.level, "ready");
    }

    #[test]
    fn assess_analyzer_readiness_blocks_when_failure_budget_is_exhausted() {
        let benchmark_path = PathBuf::from("D:/tmp/benchmark.json");
        let now = chrono::Utc::now();
        let history = vec![
            AnalyzerHealthHistoryEntry {
                id: "latest".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: now.to_rfc3339(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: true,
                    result_source: "generate".to_string(),
                    warning: None,
                    error: None,
                    status_code: Some(200),
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            },
            AnalyzerHealthHistoryEntry {
                id: "smoke".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: (now - chrono::Duration::hours(1)).to_rfc3339(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: true,
                    result_source: "smoke".to_string(),
                    warning: None,
                    error: None,
                    status_code: Some(200),
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            },
            AnalyzerHealthHistoryEntry {
                id: "failure-a".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: (now - chrono::Duration::hours(2)).to_rfc3339(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: false,
                    result_source: "probe".to_string(),
                    warning: None,
                    error: Some("timeout".to_string()),
                    status_code: None,
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            },
            AnalyzerHealthHistoryEntry {
                id: "failure-b".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: (now - chrono::Duration::hours(3)).to_rfc3339(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: false,
                    result_source: "generate".to_string(),
                    warning: None,
                    error: Some("parse failure".to_string()),
                    status_code: None,
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            },
        ];

        let assessment = assess_analyzer_readiness(&benchmark_path, &history);
        assert_eq!(assessment.level, "blocked");
        assert_eq!(assessment.recent_failure_budget, 1);
        assert_eq!(assessment.recent_failure_budget_remaining, 0);
        assert!(assessment
            .reasons
            .iter()
            .any(|reason| reason.contains("error budget")));
    }

    #[test]
    fn assess_analyzer_readiness_warns_when_smoke_is_stale() {
        let benchmark_path = PathBuf::from("D:/tmp/benchmark.json");
        let now = chrono::Utc::now();
        let history = vec![
            AnalyzerHealthHistoryEntry {
                id: "latest".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: now.to_rfc3339(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: true,
                    result_source: "generate".to_string(),
                    warning: None,
                    error: None,
                    status_code: Some(200),
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            },
            AnalyzerHealthHistoryEntry {
                id: "smoke".to_string(),
                status: AnalyzerHealthStatus {
                    checked_at: (now - chrono::Duration::hours(96)).to_rfc3339(),
                    benchmark_path: Some(benchmark_path.to_string_lossy().to_string()),
                    provider: Some("anthropic".to_string()),
                    model: Some("claude".to_string()),
                    endpoint: Some("https://api.anthropic.com/v1/messages".to_string()),
                    configured: true,
                    reachable: true,
                    result_source: "smoke".to_string(),
                    warning: None,
                    error: None,
                    status_code: Some(200),
                    attempt_count: 1,
                    proxy_url: None,
                    proxy_bypassed: false,
                    log_path: None,
                },
            },
        ];

        let assessment = assess_analyzer_readiness(&benchmark_path, &history);
        assert_eq!(assessment.level, "warning");
        assert!(assessment.smoke_success_stale);
        assert!(assessment
            .reasons
            .iter()
            .any(|reason| reason.contains("successful analyzer smoke is stale")));
    }

    #[test]
    fn generate_benchmark_notes_from_value_surfaces_expectation_patterns_and_metrics() {
        let benchmark: Value = serde_json::from_str(
            r#"{
  "runs": [
    {
      "eval_id": 1,
      "configuration": "with_skill",
      "run_number": 1,
      "result": { "pass_rate": 1.0, "time_seconds": 10.3, "tokens": 128 },
      "expectations": [
        { "text": "Primary expectation", "passed": true, "evidence": "ok" },
        { "text": "Non differentiator", "passed": true, "evidence": "ok" }
      ],
      "notes": []
    },
    {
      "eval_id": 1,
      "configuration": "without_skill",
      "run_number": 1,
      "result": { "pass_rate": 0.5, "time_seconds": 9.4, "tokens": 64 },
      "expectations": [
        { "text": "Primary expectation", "passed": false, "evidence": "missing" },
        { "text": "Non differentiator", "passed": true, "evidence": "ok" }
      ],
      "notes": []
    }
  ],
  "run_summary": {
    "with_skill": {
      "pass_rate": { "mean": 1.0, "stddev": 0.0 },
      "time_seconds": { "mean": 10.3, "stddev": 0.0 },
      "tokens": { "mean": 128.0, "stddev": 0.0 }
    },
    "without_skill": {
      "pass_rate": { "mean": 0.5, "stddev": 0.0 },
      "time_seconds": { "mean": 9.4, "stddev": 0.0 },
      "tokens": { "mean": 64.0, "stddev": 0.0 }
    },
    "delta": {
      "pass_rate": "+0.50",
      "time_seconds": "+0.9",
      "tokens": "+64"
    }
  }
}"#,
        )
        .expect("parse benchmark fixture");

        let notes = generate_benchmark_notes_from_value(&benchmark);
        assert!(notes
            .iter()
            .any(|note| note.contains("Primary expectation")));
        assert!(notes.iter().any(|note| note.contains("Non differentiator")));
        assert!(notes
            .iter()
            .any(|note| note.contains("Skill changes average pass rate")));
        assert!(notes
            .iter()
            .any(|note| note.contains("Token usage is 100% higher")));
    }

    #[test]
    fn parse_benchmark_notes_response_accepts_markdown_wrapped_notes_object() {
        let notes = parse_benchmark_notes_response(
            "```json\n{\"notes\":[\"Skill improves pass rate\",\"Latency increases slightly\"]}\n```",
        )
        .expect("parse wrapped notes response");

        assert_eq!(
            notes,
            vec![
                "Skill improves pass rate".to_string(),
                "Latency increases slightly".to_string(),
            ]
        );
    }

    #[test]
    fn resolve_active_llm_profile_prefers_active_profile_settings() {
        let config = LlmConfig {
            provider: Some("anthropic".to_string()),
            anthropic: Some(AnthropicProviderSettings {
                api_key: Some("top-level-key".to_string()),
                model: Some("claude-top-level".to_string()),
            }),
            openai: Some(OpenAIProviderSettings {
                api_key: Some("top-level-openai-key".to_string()),
                base_url: Some("https://api.openai.com/v1/chat/completions".to_string()),
                model: Some("gpt-4o".to_string()),
                allow_insecure_tls: Some(false),
            }),
            profiles: Some(vec![LlmProfile {
                id: "profile-openai".to_string(),
                name: "Primary OpenAI".to_string(),
                provider: "openai".to_string(),
                anthropic: None,
                openrouter: None,
                openai: Some(OpenAIProviderSettings {
                    api_key: Some("profile-openai-key".to_string()),
                    base_url: Some("https://example.com/v1/chat/completions".to_string()),
                    model: Some("gpt-4.1".to_string()),
                    allow_insecure_tls: Some(true),
                }),
                ollama: None,
                custom: None,
                verified: true,
            }]),
            active_profile_id: Some("profile-openai".to_string()),
            ..LlmConfig::default()
        };

        let resolved = resolve_active_llm_profile(&config).expect("resolve active profile");
        assert_eq!(resolved.provider, "openai");
        assert_eq!(resolved.endpoint, "https://example.com/v1/chat/completions");
        assert_eq!(resolved.model, "gpt-4.1");
        assert_eq!(resolved.api_key.as_deref(), Some("profile-openai-key"));
        assert!(resolved.allow_insecure_tls);
    }
}

#[tauri::command]
#[allow(deprecated)]
pub fn open_local_path(
    app_handle: AppHandle,
    input: OpenLocalPathInput,
) -> Result<GenericIpcResult, String> {
    let requested_path = PathBuf::from(&input.path);
    let target_path = if input.reveal_parent.unwrap_or(false) {
        requested_path
            .parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or_else(|| requested_path.clone())
    } else {
        requested_path.clone()
    };

    if !requested_path.exists() {
        return Err(format!("Path does not exist: {}", requested_path.display()));
    }

    if !target_path.exists() {
        return Err(format!(
            "Target path does not exist: {}",
            target_path.display()
        ));
    }

    app_handle
        .shell()
        .open(target_path.to_string_lossy().to_string(), None)
        .map_err(|error| error.to_string())?;

    Ok(GenericIpcResult {
        success: true,
        payload: json!({
            "requestedPath": requested_path,
            "openedPath": target_path,
        }),
    })
}

/// Get current workspace root (process cwd)
#[tauri::command]
pub async fn get_workspace_root() -> Result<String, String> {
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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

#[tauri::command]
pub async fn check_claude_skill_updates(
    input: Option<CheckClaudeSkillUpdatesInput>,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "skillIds": input.and_then(|v| v.skill_ids),
    });
    let command = build_command("check_claude_skill_updates", payload);
    let response = send_command_and_wait(&state, command, 60_000).await?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn upgrade_claude_skill(
    input: UpgradeClaudeSkillInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "skillId": input.skill_id,
    });
    let command = build_command("upgrade_claude_skill", payload);
    let response = send_command_and_wait(&state, command, 120_000).await?;
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
pub async fn search_openclaw_skill_store(
    input: SearchOpenClawSkillStoreInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "store": input.store,
        "query": input.query,
        "limit": input.limit.unwrap_or(20),
    });
    let command = build_command("search_openclaw_skill_store", payload);
    let response = send_command_and_wait(&state, command, 20_000).await?;
    Ok(GenericIpcResult {
        success: true,
        payload: response,
    })
}

#[tauri::command]
pub async fn install_openclaw_skill(
    input: InstallOpenClawSkillInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "store": input.store,
        "skillName": input.skill_name,
    });
    let command = build_command("install_openclaw_skill", payload);
    let response = send_command_and_wait(&state, command, 90_000).await?;
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
pub async fn sync_skill_environment(
    input: SyncSkillEnvironmentInput,
    state: State<'_, SidecarState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    ensure_sidecar_running(&state, &app_handle).await?;
    let payload = json!({
        "env": input.env.unwrap_or_default(),
    });
    let command = build_command("sync_skill_environment", payload);
    let response = send_command_and_wait(&state, command, 5000).await?;
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
    let response = send_command_and_wait(&state, command, 3000).await?;
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
    });
    let command = build_command("install_from_github", payload);
    // GitHub downloads may take a while
    let response = send_command_and_wait(&state, command, 30000).await?;
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

/// Predownload embedding model for RAG on first-run setup.
/// Uses persistent cache path so subsequent runs do not redownload.
#[tauri::command]
pub fn prepare_rag_embedding_model(
    state: State<'_, ProcessManagerState>,
    app_handle: AppHandle,
) -> Result<GenericIpcResult, String> {
    let mut manager = state.0.lock().map_err(|e| e.to_string())?;
    manager.set_app_handle(app_handle);

    match manager.predownload_rag_model() {
        Ok(message) => Ok(GenericIpcResult {
            success: true,
            payload: json!({
                "message": message
            }),
        }),
        Err(e) => Ok(GenericIpcResult {
            success: false,
            payload: json!({
                "error": e.to_string()
            }),
        }),
    }
}
