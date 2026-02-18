use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum EffectType {
    #[serde(rename = "filesystem:read")]
    FilesystemRead,
    #[serde(rename = "filesystem:write")]
    FilesystemWrite,
    #[serde(rename = "shell:read")]
    ShellRead,
    #[serde(rename = "shell:write")]
    ShellWrite,
    #[serde(rename = "network:outbound")]
    NetworkOutbound,
    #[serde(rename = "secrets:read")]
    SecretsRead,
    #[serde(rename = "screen:capture")]
    ScreenCapture,
    #[serde(rename = "ui:control")]
    UiControl,
}

impl EffectType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EffectType::FilesystemRead => "filesystem:read",
            EffectType::FilesystemWrite => "filesystem:write",
            EffectType::ShellRead => "shell:read",
            EffectType::ShellWrite => "shell:write",
            EffectType::NetworkOutbound => "network:outbound",
            EffectType::SecretsRead => "secrets:read",
            EffectType::ScreenCapture => "screen:capture",
            EffectType::UiControl => "ui:control",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EffectSource {
    Agent,
    Toolpack,
    ClaudeSkill,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationPolicy {
    Always,
    Once,
    Session,
    Permanent,
    Never,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EffectScope {
    pub workspace_paths: Option<Vec<String>>,
    pub allowed_extensions: Option<Vec<String>>,
    pub excluded_paths: Option<Vec<String>>,
    pub command_allowlist: Option<Vec<String>>,
    pub command_blocklist: Option<Vec<String>>,
    pub domain_allowlist: Option<Vec<String>>,
    pub domain_blocklist: Option<Vec<String>>,
    pub max_file_size_bytes: Option<u64>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EffectPayload {
    pub path: Option<String>,
    pub content: Option<String>,
    pub operation: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EffectContext {
    pub task_id: Option<String>,
    pub tool_name: Option<String>,
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRequest {
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "effectType")]
    pub effect_type: EffectType,
    pub source: EffectSource,
    #[serde(rename = "sourceId")]
    pub source_id: Option<String>,
    pub payload: EffectPayload,
    pub context: Option<EffectContext>,
    pub scope: Option<EffectScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectResponse {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub timestamp: String,
    pub approved: bool,
    #[serde(rename = "approvalType")]
    pub approval_type: Option<ConfirmationPolicy>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
    #[serde(rename = "denialReason")]
    pub denial_reason: Option<String>,
    #[serde(rename = "denialCode")]
    pub denial_code: Option<String>,
    #[serde(rename = "modifiedScope")]
    pub modified_scope: Option<EffectScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIdentity {
    pub session_id: String,
    pub parent_session_id: Option<String>,
    pub user_id: Option<String>,
    pub capabilities: Vec<String>,
    pub ephemeral: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegation {
    pub parent_session_id: String,
    pub child_session_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpGatewayDecision {
    pub server_id: String,
    pub tool_name: String,
    pub tool_id: Option<String>,
    pub decision: String,
    pub risk_score: Option<u8>,
    pub reason: Option<String>,
    pub policy_id: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSecurityAlert {
    pub threat_type: String,
    pub score: u8,
    pub action: String,
    pub detail: Option<String>,
    pub redaction_applied: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PolicyLists {
    pub commands: Vec<String>,
    pub domains: Vec<String>,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PolicyOverrides {
    // ...
}

// ...

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyConfig {
    pub default_policies: HashMap<EffectType, ConfirmationPolicy>,
    pub allowlists: PolicyLists,
    pub blocklists: PolicyLists,
    pub denied_effects: Vec<EffectType>,
}

impl PolicyConfig {
    pub fn default_config() -> Self {
        let mut default_policies = HashMap::new();
        default_policies.insert(EffectType::FilesystemRead, ConfirmationPolicy::Never);
        default_policies.insert(EffectType::FilesystemWrite, ConfirmationPolicy::Always);
        default_policies.insert(EffectType::ShellRead, ConfirmationPolicy::Once);
        default_policies.insert(EffectType::ShellWrite, ConfirmationPolicy::Always);
        default_policies.insert(EffectType::NetworkOutbound, ConfirmationPolicy::Once);
        default_policies.insert(EffectType::SecretsRead, ConfirmationPolicy::Always);
        default_policies.insert(EffectType::ScreenCapture, ConfirmationPolicy::Always);
        default_policies.insert(EffectType::UiControl, ConfirmationPolicy::Always);

        Self {
            default_policies,
            allowlists: PolicyLists::default(),
            blocklists: PolicyLists::default(),
            denied_effects: vec![EffectType::SecretsRead, EffectType::UiControl],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct RequestOrigin {
    pub source: EffectSource,
    #[serde(rename = "sourceId")]
    pub source_id: Option<String>,
}
