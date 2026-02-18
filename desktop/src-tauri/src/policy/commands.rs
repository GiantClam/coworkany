//! Policy Gate Tauri Commands
//!
//! Exposes PolicyEngine functionality via Tauri invoke commands.
//! Handles effect requests, user confirmations, and audit logging.

use super::audit::{AuditEvent, AuditSink};
use super::engine::{PolicyDecision, PolicyEngine, PolicyOutcome};
use super::types::{
    AgentDelegation, AgentIdentity, ConfirmationPolicy, EffectRequest, EffectResponse, EffectType,
    McpGatewayDecision, RuntimeSecurityAlert,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

// ============================================================================
// State Types
// ============================================================================

/// Thread-safe wrapper for PolicyEngine with pending confirmations
pub struct PolicyEngineState {
    pub engine: Arc<Mutex<PolicyEngine>>,
    pub pending_confirmations: Arc<Mutex<HashMap<String, PendingConfirmation>>>,
    pub audit_sink: Arc<Mutex<Box<dyn AuditSink + Send>>>,
    pub identities: Arc<Mutex<HashMap<String, AgentIdentity>>>,
    pub delegations: Arc<Mutex<Vec<AgentDelegation>>>,
    pub mcp_decisions: Arc<Mutex<Vec<McpGatewayDecision>>>,
    pub runtime_alerts: Arc<Mutex<Vec<RuntimeSecurityAlert>>>,
}

#[derive(Debug, Clone)]
pub struct PendingConfirmation {
    pub request: EffectRequest,
    pub outcome: PolicyOutcome,
    pub _requested_at: String,
}

impl PolicyEngineState {
    pub fn new(audit_sink: Box<dyn AuditSink + Send>) -> Self {
        let config = super::types::PolicyConfig::default_config();
        Self {
            engine: Arc::new(Mutex::new(PolicyEngine::new(config))),
            pending_confirmations: Arc::new(Mutex::new(HashMap::new())),
            audit_sink: Arc::new(Mutex::new(audit_sink)),
            identities: Arc::new(Mutex::new(HashMap::new())),
            delegations: Arc::new(Mutex::new(Vec::new())),
            mcp_decisions: Arc::new(Mutex::new(Vec::new())),
            runtime_alerts: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

// ============================================================================
// Confirmation Request (sent to UI)
// ============================================================================

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

// ============================================================================
// Input Types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmEffectInput {
    pub request_id: String,
    pub remember: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DenyEffectInput {
    pub request_id: String,
    pub reason: Option<String>,
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Request approval for an effect
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

    // Evaluate with policy engine
    let outcome = {
        let engine = state.engine.lock().await;
        engine.evaluate(&request)
    };

    debug!("Policy decision: {:?}", outcome.decision);

    // Log to audit
    {
        let mut audit = state.audit_sink.lock().await;
        let _ = audit.log(AuditEvent::request(&request, &outcome));
    }

    match &outcome.decision {
        PolicyDecision::Approved {
            approval_type: _,
            modified_scope: _,
        } => {
            info!("Effect auto-approved: {}", request.id);
            let engine = state.engine.lock().await;
            Ok(engine.to_response(outcome, true))
        }

        PolicyDecision::RequiresUserConfirmation { policy, .. } => {
            info!("Effect requires confirmation: {}", request.id);

            // Store pending confirmation
            {
                let mut pending = state.pending_confirmations.lock().await;
                pending.insert(
                    request.id.clone(),
                    PendingConfirmation {
                        request: request.clone(),
                        outcome: outcome.clone(),
                        _requested_at: Utc::now().to_rfc3339(),
                    },
                );
            }

            // Emit confirmation request to UI
            let confirmation_req = ConfirmationRequest::from_request(&request, policy);
            if let Err(e) = app.emit("effect-confirmation-required", &confirmation_req) {
                error!("Failed to emit confirmation request: {}", e);
            }

            // Return pending response (caller should wait for confirm/deny)
            Ok(EffectResponse {
                request_id: request.id,
                timestamp: Utc::now().to_rfc3339(),
                approved: false, // Not yet approved
                approval_type: None,
                expires_at: None,
                denial_reason: Some("awaiting_confirmation".to_string()),
                denial_code: None,
                modified_scope: None,
            })
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

/// User confirms an effect
#[tauri::command]
pub async fn confirm_effect(
    input: ConfirmEffectInput,
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<EffectResponse, String> {
    info!(
        "Effect confirmed by user: {} (remember: {})",
        input.request_id, input.remember
    );

    // Get pending confirmation
    let pending = {
        let mut pending_map = state.pending_confirmations.lock().await;
        pending_map.remove(&input.request_id)
    };

    let Some(pending) = pending else {
        return Err(format!(
            "No pending confirmation found for {}",
            input.request_id
        ));
    };

    // Build response
    let engine = state.engine.lock().await;
    let response = engine.to_response(pending.outcome, true);

    // Log to audit
    {
        let mut audit = state.audit_sink.lock().await;
        let _ = audit.log(AuditEvent::confirmed(&pending.request, input.remember));
    }

    // Emit confirmation result
    if let Err(e) = app.emit("effect-confirmed", &response) {
        warn!("Failed to emit effect-confirmed: {}", e);
    }

    Ok(response)
}

/// User denies an effect
#[tauri::command]
pub async fn deny_effect(
    input: DenyEffectInput,
    state: State<'_, PolicyEngineState>,
    app: AppHandle,
) -> Result<EffectResponse, String> {
    info!("Effect denied by user: {}", input.request_id);

    // Get pending confirmation
    let pending = {
        let mut pending_map = state.pending_confirmations.lock().await;
        pending_map.remove(&input.request_id)
    };

    let Some(pending) = pending else {
        return Err(format!(
            "No pending confirmation found for {}",
            input.request_id
        ));
    };

    let response = EffectResponse {
        request_id: input.request_id.clone(),
        timestamp: Utc::now().to_rfc3339(),
        approved: false,
        approval_type: None,
        expires_at: None,
        denial_reason: input.reason.clone().or(Some("user_denied".to_string())),
        denial_code: Some("user_denied".to_string()),
        modified_scope: None,
    };

    // Log to audit
    {
        let mut audit = state.audit_sink.lock().await;
        let _ = audit.log(AuditEvent::denied(&pending.request, input.reason.as_deref()));
    }

    // Emit denial result
    if let Err(e) = app.emit("effect-denied", &response) {
        warn!("Failed to emit effect-denied: {}", e);
    }

    Ok(response)
}

/// Get pending confirmations (for UI display)
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

// ============================================================================
// Identity and Security Commands
// ============================================================================

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
