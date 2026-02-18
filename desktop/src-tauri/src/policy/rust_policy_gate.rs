// desktop/src-tauri/src/policy/rust_policy_gate.rs
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use uuid::Uuid;

// ============================================================================
// Types (aligned with protocol schema)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIdentity {
    pub session_id: Uuid,
    pub parent_session: Option<Uuid>,
    pub user_id: String,
    pub created_at: u64,
    pub capabilities: Vec<EffectType>,
    pub ephemeral: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectType {
    FilesystemRead,
    FilesystemWrite,
    ShellRead,
    ShellWrite,
    NetworkOutbound,
    SecretsRead,
    ScreenCapture,
    UiControl,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EffectPayload {
    FilesystemWrite {
        mode: WriteMode,
        target_path: String,
        content: Option<String>,
        patch: Option<String>,
        backup: bool,
    },
    ShellWrite {
        command: String,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
        timeout_ms: u64,
    },
    NetworkOutbound {
        url: String,
        method: String,
        headers: Option<HashMap<String, String>>,
        body: Option<String>,
    },
    ScreenCapture {
        region: Option<CaptureRegion>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteMode {
    Shadow,
    Direct,
    Patch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectRequest {
    pub request_id: Uuid,
    pub session_id: Uuid,
    pub source: EffectSource,
    pub source_id: String,
    pub effect: EffectPayload,
    pub risk_score: Option<u8>,
    pub justification: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectSource {
    Agent,
    Toolpack,
    ClaudeSkill,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub request_id: Uuid,
    pub decision: Decision,
    pub reason: Option<String>,
    pub scope_restrictions: Option<ScopeRestrictions>,
    pub auto_approve_similar: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Approve,
    Deny,
    ConfirmRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeRestrictions {
    pub allowlist: Option<Vec<String>>,
    pub denylist: Option<Vec<String>>,
    pub redact_patterns: Option<Vec<String>>,
}

// ============================================================================
// Policy engine
// ============================================================================

pub struct PolicyEngine {
    active_sessions: HashMap<Uuid, AgentIdentity>,
    user_policies: UserPolicies,
    session_approvals: HashMap<Uuid, Vec<ApprovalPattern>>,
    audit_writer: AuditWriter,
}

#[derive(Debug, Clone)]
struct ApprovalPattern {
    effect_type: EffectType,
    pattern: String,
    expires_at: u64,
}

#[derive(Debug, Clone)]
pub struct UserPolicies {
    pub global_denylist: HashMap<EffectType, Vec<String>>,
    pub workspace_allowlist: Vec<PathBuf>,
    pub command_allowlist: Vec<String>,
    pub domain_allowlist: Vec<String>,
    pub requires_confirmation: Vec<EffectType>,
}

impl Default for UserPolicies {
    fn default() -> Self {
        Self {
            global_denylist: HashMap::from([
                (EffectType::ShellWrite, vec!["rm -rf /".to_string(), "sudo".to_string()]),
                (EffectType::NetworkOutbound, vec!["*.onion".to_string()]),
            ]),
            workspace_allowlist: vec![],
            command_allowlist: vec![
                "git".to_string(),
                "npm".to_string(),
                "cargo".to_string(),
                "python".to_string(),
            ],
            domain_allowlist: vec!["github.com".to_string(), "anthropic.com".to_string()],
            requires_confirmation: vec![
                EffectType::FilesystemWrite,
                EffectType::ShellWrite,
                EffectType::SecretsRead,
                EffectType::UiControl,
            ],
        }
    }
}

impl PolicyEngine {
    pub fn new(audit_writer: AuditWriter) -> Self {
        Self {
            active_sessions: HashMap::new(),
            user_policies: UserPolicies::default(),
            session_approvals: HashMap::new(),
            audit_writer,
        }
    }

    pub fn register_session(&mut self, identity: AgentIdentity) {
        self.active_sessions.insert(identity.session_id, identity);
    }

    pub async fn evaluate(&mut self, request: EffectRequest) -> PolicyDecision {
        let session = match self.active_sessions.get(&request.session_id) {
            Some(s) => s,
            None => {
                return PolicyDecision {
                    request_id: request.request_id,
                    decision: Decision::Deny,
                    reason: Some("Unknown session".to_string()),
                    scope_restrictions: None,
                    auto_approve_similar: false,
                };
            }
        };

        let effect_type = self.get_effect_type(&request.effect);
        if !session.capabilities.contains(&effect_type) {
            return self.deny(request.request_id, "Session lacks capability");
        }

        if self.check_auto_approval(&request) {
            self.audit_writer.log_auto_approval(&request);
            return PolicyDecision {
                request_id: request.request_id,
                decision: Decision::Approve,
                reason: Some("Auto-approved (session pattern)".to_string()),
                scope_restrictions: None,
                auto_approve_similar: false,
            };
        }

        if let Some(violation) = self.check_static_rules(&request) {
            return self.deny(request.request_id, &violation);
        }

        let risk_score = self.calculate_risk(&request);
        let decision = if risk_score >= 80 {
            Decision::Deny
        } else if risk_score >= 40 || self.user_policies.requires_confirmation.contains(&effect_type) {
            Decision::ConfirmRequired
        } else {
            Decision::Approve
        };

        let policy_decision = PolicyDecision {
            request_id: request.request_id,
            decision,
            reason: Some(format!("Risk score: {}", risk_score)),
            scope_restrictions: self.build_restrictions(&request),
            auto_approve_similar: false,
        };

        self.audit_writer.log_decision(&request, &policy_decision);
        policy_decision
    }

    pub fn approve_with_memory(
        &mut self,
        request_id: Uuid,
        session_id: Uuid,
        remember: bool,
    ) -> Result<(), String> {
        if remember {
            let pattern = ApprovalPattern {
                effect_type: EffectType::FilesystemWrite,
                pattern: "**/*.rs".to_string(),
                expires_at: chrono::Utc::now().timestamp() as u64 + 3600,
            };
            self.session_approvals
                .entry(session_id)
                .or_insert_with(Vec::new)
                .push(pattern);
        }
        let _ = request_id;
        Ok(())
    }

    fn get_effect_type(&self, effect: &EffectPayload) -> EffectType {
        match effect {
            EffectPayload::FilesystemWrite { .. } => EffectType::FilesystemWrite,
            EffectPayload::ShellWrite { .. } => EffectType::ShellWrite,
            EffectPayload::NetworkOutbound { .. } => EffectType::NetworkOutbound,
            EffectPayload::ScreenCapture { .. } => EffectType::ScreenCapture,
        }
    }

    fn check_auto_approval(&self, request: &EffectRequest) -> bool {
        if let Some(patterns) = self.session_approvals.get(&request.session_id) {
            let now = chrono::Utc::now().timestamp() as u64;
            for pattern in patterns {
                if pattern.expires_at > now && self.matches_pattern(request, pattern) {
                    return true;
                }
            }
        }
        false
    }

    fn matches_pattern(&self, request: &EffectRequest, _pattern: &ApprovalPattern) -> bool {
        match &request.effect {
            EffectPayload::FilesystemWrite { target_path, .. } => target_path.ends_with(".rs"),
            _ => false,
        }
    }

    fn check_static_rules(&self, request: &EffectRequest) -> Option<String> {
        match &request.effect {
            EffectPayload::ShellWrite { command, .. } => {
                if let Some(denylist) = self.user_policies.global_denylist.get(&EffectType::ShellWrite) {
                    for blocked in denylist {
                        if command.contains(blocked) {
                            return Some(format!("Blocked command pattern: {}", blocked));
                        }
                    }
                }

                let cmd_parts: Vec<&str> = command.split_whitespace().collect();
                if let Some(cmd) = cmd_parts.first() {
                    if !self.user_policies.command_allowlist.iter().any(|allowed| cmd.starts_with(allowed)) {
                        return Some(format!("Command not in allowlist: {}", cmd));
                    }
                }
            }
            EffectPayload::FilesystemWrite { target_path, .. } => {
                if !self.user_policies.workspace_allowlist.is_empty() {
                    let path = PathBuf::from(target_path);
                    if !self.user_policies.workspace_allowlist.iter().any(|ws| path.starts_with(ws)) {
                        return Some("Path outside workspace".to_string());
                    }
                }
            }
            EffectPayload::NetworkOutbound { url, .. } => {
                if let Ok(parsed) = url::Url::parse(url) {
                    if let Some(host) = parsed.host_str() {
                        if !self.user_policies.domain_allowlist.iter().any(|d| host.ends_with(d)) {
                            return Some(format!("Domain not in allowlist: {}", host));
                        }
                    }
                }
            }
            _ => {}
        }
        None
    }

    fn calculate_risk(&self, request: &EffectRequest) -> u8 {
        let base_risk = match &request.effect {
            EffectPayload::FilesystemWrite { mode, .. } => match mode {
                WriteMode::Shadow => 30,
                WriteMode::Patch => 50,
                WriteMode::Direct => 70,
            },
            EffectPayload::ShellWrite { .. } => 80,
            EffectPayload::NetworkOutbound { .. } => 40,
            EffectPayload::ScreenCapture { .. } => 30,
        };

        let source_modifier = match request.source {
            EffectSource::Agent => 0,
            EffectSource::Toolpack => 10,
            EffectSource::ClaudeSkill => 5,
        };

        let sidecar_score = request.risk_score.unwrap_or(0) as i16;
        (base_risk as i16 + source_modifier + sidecar_score / 2).min(100).max(0) as u8
    }

    fn build_restrictions(&self, request: &EffectRequest) -> Option<ScopeRestrictions> {
        match &request.effect {
            EffectPayload::ShellWrite { .. } => Some(ScopeRestrictions {
                allowlist: Some(self.user_policies.command_allowlist.clone()),
                denylist: self.user_policies.global_denylist.get(&EffectType::ShellWrite).cloned(),
                redact_patterns: Some(vec!["password=\S+".to_string(), "token=\S+".to_string()]),
            }),
            _ => None,
        }
    }

    fn deny(&self, request_id: Uuid, reason: &str) -> PolicyDecision {
        PolicyDecision {
            request_id,
            decision: Decision::Deny,
            reason: Some(reason.to_string()),
            scope_restrictions: None,
            auto_approve_similar: false,
        }
    }
}

// ============================================================================
// Audit writer
// ============================================================================

pub struct AuditWriter {
    log_path: PathBuf,
}

impl AuditWriter {
    pub fn new(log_path: PathBuf) -> Self {
        Self { log_path }
    }

    pub fn log_decision(&self, request: &EffectRequest, decision: &PolicyDecision) {
        let _ = (&self.log_path, request, decision);
        println!("AUDIT: {:?} -> {:?}", request.request_id, decision.decision);
    }

    pub fn log_auto_approval(&self, request: &EffectRequest) {
        let _ = &self.log_path;
        println!("AUDIT: Auto-approved {:?}", request.request_id);
    }

    pub fn log_execution(&self, request_id: Uuid, result: &str) {
        let _ = (&self.log_path, result);
        println!("AUDIT: Executed {:?} -> {}", request_id, result);
    }
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub async fn request_effect(
    state: tauri::State<'_, std::sync::Arc<tokio::sync::Mutex<PolicyEngine>>>,
    request: EffectRequest,
) -> Result<PolicyDecision, String> {
    let mut engine = state.lock().await;
    Ok(engine.evaluate(request).await)
}

#[tauri::command]
pub async fn confirm_effect(
    state: tauri::State<'_, std::sync::Arc<tokio::sync::Mutex<PolicyEngine>>>,
    request_id: String,
    session_id: String,
    remember: bool,
) -> Result<(), String> {
    let mut engine = state.lock().await;
    let req_uuid = Uuid::parse_str(&request_id).map_err(|e| e.to_string())?;
    let sess_uuid = Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    engine.approve_with_memory(req_uuid, sess_uuid, remember)
}
