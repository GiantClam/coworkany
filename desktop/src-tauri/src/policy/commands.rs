use super::audit::{read_recent_audit_events, AuditEvent, AuditSink};
use super::engine::{normalize_policy_config, PolicyDecision, PolicyEngine, PolicyOutcome};
use super::types::{
    AgentDelegation, AgentIdentity, ConfirmationPolicy, EffectRequest, EffectResponse, EffectType,
    McpGatewayDecision, PolicyConfig, RuntimeSecurityAlert,
};
use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};
use tracing::{debug, error, info, warn};

const CONFIRMATION_TIMEOUT_SECS: u64 = 300;
const POLICY_CONFIG_FILE: &str = "policy-config.json";
const POLICY_AUDIT_FILE: &str = "policy-audit.jsonl";

pub struct PolicyEngineState {
    pub engine: Arc<Mutex<PolicyEngine>>,
    pub pending_confirmations: Arc<Mutex<HashMap<String, PendingConfirmation>>>,
    pub audit_sink: Arc<Mutex<Box<dyn AuditSink + Send>>>,
    pub audit_events: Arc<Mutex<Vec<AuditEvent>>>,
    pub identities: Arc<Mutex<HashMap<String, AgentIdentity>>>,
    pub delegations: Arc<Mutex<Vec<AgentDelegation>>>,
    pub mcp_decisions: Arc<Mutex<Vec<McpGatewayDecision>>>,
    pub runtime_alerts: Arc<Mutex<Vec<RuntimeSecurityAlert>>>,
}

pub struct PendingConfirmation {
    pub request: EffectRequest,
    pub outcome: PolicyOutcome,
    pub _requested_at: String,
    pub responder: Option<oneshot::Sender<EffectResponse>>,
}

impl PolicyEngineState {
    pub fn new(audit_sink: Box<dyn AuditSink + Send>) -> Self {
        let config = PolicyConfig::default_config();
        Self {
            engine: Arc::new(Mutex::new(PolicyEngine::new(config))),
            pending_confirmations: Arc::new(Mutex::new(HashMap::new())),
            audit_sink: Arc::new(Mutex::new(audit_sink)),
            audit_events: Arc::new(Mutex::new(Vec::new())),
            identities: Arc::new(Mutex::new(HashMap::new())),
            delegations: Arc::new(Mutex::new(Vec::new())),
            mcp_decisions: Arc::new(Mutex::new(Vec::new())),
            runtime_alerts: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

const MAX_POLICY_AUDIT_EVENTS: usize = 200;

async fn record_policy_audit_event(
    state: &PolicyEngineState,
    app: &AppHandle,
    event: AuditEvent,
) {
    {
        let mut audit = state.audit_sink.lock().await;
        let _ = audit.log(event.clone());
    }

    {
        let mut events = state.audit_events.lock().await;
        events.push(event.clone());
        if events.len() > MAX_POLICY_AUDIT_EVENTS {
            let overflow = events.len() - MAX_POLICY_AUDIT_EVENTS;
            events.drain(0..overflow);
        }
    }

    if let Err(e) = app.emit("policy-audit-event", &event) {
        warn!("Failed to emit policy-audit-event: {}", e);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationRequest {
    pub request_id: String,
    pub effect_type: String,
    pub source: String,
    pub source_id: Option<String>,
    pub description: String,
    pub details: HashMap<String, serde_json::Value>,
    pub risk_level: u8,
    pub policy: String,
    pub allowed_approval_modes: Vec<String>,
    pub command_base: Option<String>,
}

impl ConfirmationRequest {
    fn from_request(request: &EffectRequest, policy: &ConfirmationPolicy) -> Self {
        let mut details = HashMap::new();

        if let Some(ref path) = request.payload.path {
            details.insert("path".to_string(), serde_json::json!(path));
        }
        if let Some(ref command) = request.payload.command {
            details.insert("command".to_string(), serde_json::json!(command));
        }
        if let Some(ref cwd) = request.payload.cwd {
            details.insert("cwd".to_string(), serde_json::json!(cwd));
        }
        if let Some(ref url) = request.payload.url {
            details.insert("url".to_string(), serde_json::json!(url));
        }
        if let Some(ref desc) = request.payload.description {
            details.insert("description".to_string(), serde_json::json!(desc));
        }

        let description = request
            .payload
            .description
            .clone()
            .or_else(|| request.context.as_ref().and_then(|c| c.reasoning.clone()))
            .unwrap_or_else(|| format!("Request for {} access", request.effect_type.as_str()));

        let source = match request.source {
            super::types::EffectSource::Agent => "agent",
            super::types::EffectSource::Toolpack => "toolpack",
            super::types::EffectSource::ClaudeSkill => "claude_skill",
        };

        Self {
            request_id: request.id.clone(),
            effect_type: request.effect_type.as_str().to_string(),
            source: source.to_string(),
            source_id: request.source_id.clone(),
            description,
            details,
            risk_level: Self::calculate_risk(&request.effect_type),
            policy: format!("{:?}", policy).to_lowercase(),
            allowed_approval_modes: approval_modes_for_request(request),
            command_base: extract_command_base(request),
        }
    }

    fn calculate_risk(effect_type: &EffectType) -> u8 {
        match effect_type {
            EffectType::FilesystemRead => 20,
            EffectType::FilesystemWrite => 70,
            EffectType::ShellRead => 30,
            EffectType::ShellWrite => 90,
            EffectType::NetworkOutbound => 50,
            EffectType::SecretsRead => 100,
            EffectType::ScreenCapture => 60,
            EffectType::UiControl => 100,
        }
    }
}

fn approval_modes_for_request(request: &EffectRequest) -> Vec<String> {
    if matches!(request.effect_type, EffectType::ShellRead | EffectType::ShellWrite) {
        vec!["once".to_string(), "session".to_string(), "permanent".to_string()]
    } else {
        vec!["once".to_string(), "session".to_string()]
    }
}

fn normalize_approval_type(value: Option<String>) -> ConfirmationPolicy {
    match value.as_deref() {
        Some("session") => ConfirmationPolicy::Session,
        Some("permanent") => ConfirmationPolicy::Permanent,
        Some("never") => ConfirmationPolicy::Never,
        Some("always") => ConfirmationPolicy::Always,
        _ => ConfirmationPolicy::Once,
    }
}

fn extract_command_base(request: &EffectRequest) -> Option<String> {
    request
        .payload
        .command
        .as_ref()
        .and_then(|command| command.split_whitespace().next())
        .map(|command| {
            command
                .trim_matches('"')
                .trim()
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(command)
                .trim_end_matches(".exe")
                .to_lowercase()
        })
        .filter(|command| !command.is_empty())
}

fn policy_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {}", e))?;
    Ok(app_data_dir.join(POLICY_CONFIG_FILE))
}

fn policy_audit_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {}", e))?;
    Ok(app_data_dir.join(POLICY_AUDIT_FILE))
}

async fn load_policy_config(app: &AppHandle) -> Result<PolicyConfig, String> {
    let path = policy_config_path(app)?;
    if !path.exists() {
        return Ok(normalize_policy_config(PolicyConfig::default_config()));
    }

    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("failed to read policy config: {}", e))?;
    serde_json::from_str::<PolicyConfig>(&raw)
        .map(normalize_policy_config)
        .map_err(|e| format!("failed to parse policy config: {}", e))
}

async fn persist_policy_config(app: &AppHandle, config: &PolicyConfig) -> Result<(), String> {
    let normalized = normalize_policy_config(config.clone());
    let path = policy_config_path(app)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create policy config dir: {}", e))?;
    }

    let raw = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("failed to serialize policy config: {}", e))?;
    tokio::fs::write(&path, raw)
        .await
        .map_err(|e| format!("failed to write policy config: {}", e))
}

async fn refresh_engine_config(
    state: &PolicyEngineState,
    app: &AppHandle,
) -> Result<(), String> {
    let config = load_policy_config(app).await.unwrap_or_else(|_| PolicyConfig::default_config());
    let mut engine = state.engine.lock().await;
    engine.replace_config(config);
    Ok(())
}

#[tauri::command]
pub async fn request_effect(
    request: EffectRequest,
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<EffectResponse, String> {
    info!(
        "Effect request received: {:?} from {:?}",
        request.effect_type, request.source
    );

    refresh_engine_config(&state, &app).await?;

    let outcome = {
        let engine = state.engine.lock().await;
        engine.evaluate(&request)
    };

    debug!("Policy decision: {:?}", outcome.decision);

    record_policy_audit_event(&state, &app, AuditEvent::request(&request, &outcome)).await;

    match &outcome.decision {
        PolicyDecision::Approved { .. } => {
            info!("Effect auto-approved: {}", request.id);
            let engine = state.engine.lock().await;
            Ok(engine.to_response(outcome, true))
        }
        PolicyDecision::RequiresUserConfirmation { policy, .. } => {
            info!("Effect requires confirmation: {}", request.id);

            let (tx, rx) = oneshot::channel::<EffectResponse>();
            {
                let mut pending = state.pending_confirmations.lock().await;
                pending.insert(
                    request.id.clone(),
                    PendingConfirmation {
                        request: request.clone(),
                        outcome: outcome.clone(),
                        _requested_at: Utc::now().to_rfc3339(),
                        responder: Some(tx),
                    },
                );
            }

            let confirmation_req = ConfirmationRequest::from_request(&request, policy);
            if let Err(e) = app.emit("effect-confirmation-required", &confirmation_req) {
                error!("Failed to emit confirmation request: {}", e);
            }

            match timeout(Duration::from_secs(CONFIRMATION_TIMEOUT_SECS), rx).await {
                Ok(Ok(response)) => Ok(response),
                Ok(Err(_)) => Err("confirmation channel closed unexpectedly".to_string()),
                Err(_) => {
                    let mut pending = state.pending_confirmations.lock().await;
                    pending.remove(&request.id);
                    Ok(EffectResponse {
                        request_id: request.id,
                        timestamp: Utc::now().to_rfc3339(),
                        approved: false,
                        approval_type: None,
                        expires_at: None,
                        denial_reason: Some("approval timeout".to_string()),
                        denial_code: Some("timeout".to_string()),
                        modified_scope: None,
                    })
                }
            }
        }
        PolicyDecision::Denied { reason, code } => {
            warn!("Effect denied: {}", request.id);
            Ok(EffectResponse {
                request_id: request.id,
                timestamp: Utc::now().to_rfc3339(),
                approved: false,
                approval_type: None,
                expires_at: None,
                denial_reason: Some(reason.clone()),
                denial_code: Some(code.clone()),
                modified_scope: None,
            })
        }
    }
}

#[tauri::command]
pub async fn confirm_effect(
    request_id: String,
    approval_type: Option<String>,
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<EffectResponse, String> {
    let approval_type = normalize_approval_type(approval_type);
    info!(
        "Effect confirmed by user: {} (approval_type: {:?})",
        request_id, approval_type
    );

    let pending = {
        let mut pending_map = state.pending_confirmations.lock().await;
        pending_map.remove(&request_id)
    };

    let Some(mut pending) = pending else {
        return Err(format!("No pending confirmation found for {}", request_id));
    };

    refresh_engine_config(&state, &app).await?;

    let mut config_to_persist: Option<PolicyConfig> = None;
    let mut response = {
        let mut engine = state.engine.lock().await;
        if let Some(command_base) = extract_command_base(&pending.request) {
            match approval_type {
                ConfirmationPolicy::Session => engine.approve_command_for_session(&command_base),
                ConfirmationPolicy::Permanent => {
                    if engine.approve_command_permanently(&command_base) {
                        config_to_persist = Some(engine.config.clone());
                    }
                }
                _ => {}
            }
        }
        engine.to_response(pending.outcome.clone(), true)
    };

    if let Some(config) = config_to_persist {
        persist_policy_config(&app, &config).await?;
    }

    response.approval_type = Some(approval_type.clone());

    let remember = !matches!(approval_type, ConfirmationPolicy::Once);
    record_policy_audit_event(&state, &app, AuditEvent::confirmed(&pending.request, remember)).await;

    if let Some(responder) = pending.responder.take() {
        let _ = responder.send(response.clone());
    }

    if let Err(e) = app.emit("effect-confirmed", &response) {
        warn!("Failed to emit effect-confirmed: {}", e);
    }

    Ok(response)
}

#[tauri::command]
pub async fn deny_effect(
    request_id: String,
    reason: Option<String>,
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<EffectResponse, String> {
    info!("Effect denied by user: {}", request_id);

    let pending = {
        let mut pending_map = state.pending_confirmations.lock().await;
        pending_map.remove(&request_id)
    };

    let Some(mut pending) = pending else {
        return Err(format!("No pending confirmation found for {}", request_id));
    };

    let response = EffectResponse {
        request_id: request_id.clone(),
        timestamp: Utc::now().to_rfc3339(),
        approved: false,
        approval_type: None,
        expires_at: None,
        denial_reason: reason.clone().or(Some("user_denied".to_string())),
        denial_code: Some("user_denied".to_string()),
        modified_scope: None,
    };

    record_policy_audit_event(&state, &app, AuditEvent::denied(&pending.request, reason.as_deref())).await;

    if let Some(responder) = pending.responder.take() {
        let _ = responder.send(response.clone());
    }

    if let Err(e) = app.emit("effect-denied", &response) {
        warn!("Failed to emit effect-denied: {}", e);
    }

    Ok(response)
}

#[tauri::command]
pub async fn get_pending_confirmations(
    state: State<'_, PolicyEngineState>,
) -> Result<Vec<ConfirmationRequest>, String> {
    let pending = state.pending_confirmations.lock().await;

    let requests: Vec<_> = pending
        .values()
        .map(|p| {
            let policy = match &p.outcome.decision {
                PolicyDecision::RequiresUserConfirmation { policy, .. } => policy.clone(),
                _ => ConfirmationPolicy::Always,
            };
            ConfirmationRequest::from_request(&p.request, &policy)
        })
        .collect();

    Ok(requests)
}

#[tauri::command]
pub async fn get_policy_config(
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<PolicyConfig, String> {
    refresh_engine_config(&state, &app).await?;
    let engine = state.engine.lock().await;
    Ok(engine.config.clone())
}

#[tauri::command]
pub async fn save_policy_config(
    config: PolicyConfig,
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<PolicyConfig, String> {
    let normalized = normalize_policy_config(config);
    persist_policy_config(&app, &normalized).await?;
    let mut engine = state.engine.lock().await;
    engine.replace_config(normalized.clone());
    Ok(normalized)
}

#[tauri::command]
pub async fn list_policy_audit_events(
    limit: Option<usize>,
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<Vec<AuditEvent>, String> {
    let limit = limit.unwrap_or(30).min(MAX_POLICY_AUDIT_EVENTS);
    if let Ok(path) = policy_audit_path(&app) {
        match read_recent_audit_events(&path, limit) {
            Ok(events) => return Ok(events),
            Err(err) => warn!("Failed to read persistent policy audit log: {}", err),
        }
    }

    let events = state.audit_events.lock().await;
    let start = events.len().saturating_sub(limit);
    Ok(events[start..].to_vec())
}

#[tauri::command]
pub async fn clear_policy_audit_events(
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut events = state.audit_events.lock().await;
        events.clear();
    }

    let path = policy_audit_path(&app)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("failed to create audit log dir: {}", e))?;
    }

    tokio::fs::write(&path, "")
        .await
        .map_err(|e| format!("failed to clear policy audit log: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn register_agent_identity(
    identity: AgentIdentity,
    state: State<'_, PolicyEngineState>,
) -> Result<(), String> {
    let mut identities = state.identities.lock().await;
    identities.insert(identity.session_id.clone(), identity);
    Ok(())
}

#[tauri::command]
pub async fn record_agent_delegation(
    delegation: AgentDelegation,
    state: State<'_, PolicyEngineState>,
) -> Result<(), String> {
    let mut delegations = state.delegations.lock().await;
    delegations.push(delegation);
    Ok(())
}

#[tauri::command]
pub async fn report_mcp_gateway_decision(
    decision: McpGatewayDecision,
    state: State<'_, PolicyEngineState>,
) -> Result<(), String> {
    let mut decisions = state.mcp_decisions.lock().await;
    decisions.push(decision);
    Ok(())
}

#[tauri::command]
pub async fn report_runtime_security_alert(
    alert: RuntimeSecurityAlert,
    state: State<'_, PolicyEngineState>,
) -> Result<(), String> {
    let mut alerts = state.runtime_alerts.lock().await;
    alerts.push(alert);
    Ok(())
}
