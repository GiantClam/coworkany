use super::types::{
    ConfirmationPolicy, EffectRequest, EffectResponse, EffectScope, EffectType, PolicyConfig,
};
use chrono::Utc;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub enum PolicyDecision {
    Approved {
        approval_type: ConfirmationPolicy,
        modified_scope: Option<EffectScope>,
    },
    RequiresUserConfirmation {
        policy: ConfirmationPolicy,
        modified_scope: Option<EffectScope>,
    },
    Denied {
        reason: String,
        code: String,
    },
}

#[derive(Debug, Clone)]
pub struct PolicyOutcome {
    pub request_id: String,
    pub timestamp: String,
    pub decision: PolicyDecision,
}

#[derive(Debug, Clone)]
pub struct PolicyEngine {
    pub config: PolicyConfig,
    session_command_allowlist: HashSet<String>,
}

impl PolicyEngine {
    pub fn new(config: PolicyConfig) -> Self {
        Self {
            config: normalize_policy_config(config),
            session_command_allowlist: HashSet::new(),
        }
    }

    pub fn replace_config(&mut self, config: PolicyConfig) {
        self.config = normalize_policy_config(config);
    }

    pub fn approve_command_for_session(&mut self, command: &str) {
        let normalized = normalize_command_name(command);
        if !normalized.is_empty() {
            self.session_command_allowlist.insert(normalized);
        }
    }

    pub fn approve_command_permanently(&mut self, command: &str) -> bool {
        let normalized = normalize_command_name(command);
        if normalized.is_empty() {
            return false;
        }

        if !self
            .config
            .allowlists
            .commands
            .iter()
            .any(|existing| normalize_command_name(existing) == normalized)
        {
            self.config.allowlists.commands.push(normalized);
            return true;
        }

        false
    }

    pub fn evaluate(&self, request: &EffectRequest) -> PolicyOutcome {
        let now = Utc::now().to_rfc3339();
        if self.config.denied_effects.contains(&request.effect_type) {
            return PolicyOutcome {
                request_id: request.id.clone(),
                timestamp: now,
                decision: PolicyDecision::Denied {
                    reason: "effect type denied by policy".to_string(),
                    code: "policy_blocked".to_string(),
                },
            };
        }

        if self.is_blocklisted(request) {
            return PolicyOutcome {
                request_id: request.id.clone(),
                timestamp: now,
                decision: PolicyDecision::Denied {
                    reason: "request blocked by policy lists".to_string(),
                    code: "policy_blocked".to_string(),
                },
            };
        }

        let policy = self
            .config
            .default_policies
            .get(&request.effect_type)
            .cloned()
            .unwrap_or(ConfirmationPolicy::Always);

        let modified_scope = self.apply_allowlists(request);

        if let Some(auto_approval) = self.get_command_auto_approval(request) {
            return PolicyOutcome {
                request_id: request.id.clone(),
                timestamp: now,
                decision: PolicyDecision::Approved {
                    approval_type: auto_approval,
                    modified_scope,
                },
            };
        }

        match policy {
            ConfirmationPolicy::Never => PolicyOutcome {
                request_id: request.id.clone(),
                timestamp: now,
                decision: PolicyDecision::Approved {
                    approval_type: policy,
                    modified_scope,
                },
            },
            ConfirmationPolicy::Always
            | ConfirmationPolicy::Once
            | ConfirmationPolicy::Session
            | ConfirmationPolicy::Permanent => PolicyOutcome {
                request_id: request.id.clone(),
                timestamp: now,
                decision: PolicyDecision::RequiresUserConfirmation {
                    policy,
                    modified_scope,
                },
            },
        }
    }

    pub fn to_response(&self, outcome: PolicyOutcome, approved: bool) -> EffectResponse {
        let mut response = EffectResponse {
            request_id: outcome.request_id,
            timestamp: outcome.timestamp,
            approved,
            approval_type: None,
            expires_at: None,
            denial_reason: None,
            denial_code: None,
            modified_scope: None,
        };

        match outcome.decision {
            PolicyDecision::Approved {
                approval_type,
                modified_scope,
            } => {
                response.approval_type = Some(approval_type);
                response.modified_scope = modified_scope;
            }
            PolicyDecision::RequiresUserConfirmation {
                policy,
                modified_scope,
            } => {
                response.approval_type = Some(policy);
                response.modified_scope = modified_scope;
            }
            PolicyDecision::Denied { reason, code } => {
                response.denial_reason = Some(reason);
                response.denial_code = Some(code);
            }
        }

        response
    }

    fn is_blocklisted(&self, request: &EffectRequest) -> bool {
        let blocklists = &self.config.blocklists;
        if let Some(command) = &request.payload.command {
            if blocklists.commands.iter().any(|c| command.starts_with(c)) {
                return true;
            }
        }
        if let Some(url) = &request.payload.url {
            if blocklists.domains.iter().any(|d| url.contains(d)) {
                return true;
            }
        }
        if let Some(path) = &request.payload.path {
            if blocklists.paths.iter().any(|p| path.starts_with(p)) {
                return true;
            }
        }
        false
    }

    fn apply_allowlists(&self, request: &EffectRequest) -> Option<EffectScope> {
        let allowlists = &self.config.allowlists;
        let mut scope = request.scope.clone().unwrap_or_default();
        if !allowlists.commands.is_empty() && scope.command_allowlist.is_none() {
            scope.command_allowlist = Some(allowlists.commands.clone());
        }
        if !allowlists.domains.is_empty() && scope.domain_allowlist.is_none() {
            scope.domain_allowlist = Some(allowlists.domains.clone());
        }
        if !allowlists.paths.is_empty() && scope.workspace_paths.is_none() {
            scope.workspace_paths = Some(allowlists.paths.clone());
        }
        Some(scope)
    }

    fn get_command_auto_approval(&self, request: &EffectRequest) -> Option<ConfirmationPolicy> {
        if !matches!(
            request.effect_type,
            EffectType::ShellRead | EffectType::ShellWrite
        ) {
            return None;
        }

        let base_command = request
            .payload
            .command
            .as_ref()
            .map(|command| normalize_command_name(command))
            .filter(|command| !command.is_empty())?;

        if self.session_command_allowlist.contains(&base_command) {
            return Some(ConfirmationPolicy::Session);
        }

        if self
            .config
            .allowlists
            .commands
            .iter()
            .any(|command| normalize_command_name(command) == base_command)
        {
            return Some(ConfirmationPolicy::Permanent);
        }

        None
    }
}

pub fn normalize_policy_config(mut config: PolicyConfig) -> PolicyConfig {
    let defaults = PolicyConfig::default_config();
    let mut merged_defaults: HashMap<EffectType, ConfirmationPolicy> = defaults.default_policies;

    for (effect_type, policy) in config.default_policies {
        merged_defaults.insert(effect_type, policy);
    }

    config.default_policies = merged_defaults;
    config.allowlists.commands = normalize_string_list(&config.allowlists.commands);
    config.allowlists.domains = normalize_string_list(&config.allowlists.domains);
    config.allowlists.paths = normalize_string_list(&config.allowlists.paths);
    config.blocklists.commands = normalize_string_list(&config.blocklists.commands);
    config.blocklists.domains = normalize_string_list(&config.blocklists.domains);
    config.blocklists.paths = normalize_string_list(&config.blocklists.paths);
    config.denied_effects = normalize_effect_list(&config.denied_effects);

    config
}

fn normalize_string_list(entries: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for entry in entries {
        let candidate = entry.trim();
        if candidate.is_empty() {
            continue;
        }

        let key = candidate.to_lowercase();
        if seen.insert(key) {
            normalized.push(candidate.to_string());
        }
    }

    normalized.sort_by_key(|entry| entry.to_lowercase());
    normalized
}

fn normalize_effect_list(entries: &[EffectType]) -> Vec<EffectType> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for entry in entries {
        if seen.insert(entry.clone()) {
            normalized.push(entry.clone());
        }
    }

    normalized.sort_by_key(|entry| entry.as_str().to_string());
    normalized
}

fn normalize_command_name(command: &str) -> String {
    command
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches('"')
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim_end_matches(".exe")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::types::{EffectContext, EffectPayload, EffectRequest, EffectSource};

    fn make_shell_request(command: &str) -> EffectRequest {
        EffectRequest {
            id: "req-1".to_string(),
            timestamp: Utc::now().to_rfc3339(),
            effect_type: EffectType::ShellWrite,
            source: EffectSource::Agent,
            source_id: None,
            payload: EffectPayload {
                command: Some(command.to_string()),
                cwd: Some("C:/workspace".to_string()),
                description: Some("test".to_string()),
                ..Default::default()
            },
            context: Some(EffectContext {
                task_id: Some("task-1".to_string()),
                tool_name: Some("run_command".to_string()),
                reasoning: Some("test".to_string()),
            }),
            scope: Some(EffectScope::default()),
        }
    }

    #[test]
    fn session_command_approval_auto_approves_matching_command() {
        let mut engine = PolicyEngine::new(PolicyConfig::default_config());
        engine.approve_command_for_session("schtasks");

        let outcome = engine.evaluate(&make_shell_request("schtasks /query"));
        match outcome.decision {
            PolicyDecision::Approved { approval_type, .. } => {
                assert_eq!(approval_type, ConfirmationPolicy::Session);
            }
            other => panic!("expected approved decision, got {:?}", other),
        }
    }

    #[test]
    fn persistent_command_allowlist_auto_approves_matching_command() {
        let mut engine = PolicyEngine::new(PolicyConfig::default_config());
        assert!(engine.approve_command_permanently("systemctl"));

        let outcome = engine.evaluate(&make_shell_request("systemctl status nginx"));
        match outcome.decision {
            PolicyDecision::Approved { approval_type, .. } => {
                assert_eq!(approval_type, ConfirmationPolicy::Permanent);
            }
            other => panic!("expected approved decision, got {:?}", other),
        }
    }

    #[test]
    fn replace_config_normalizes_and_merges_defaults() {
        let mut engine = PolicyEngine::new(PolicyConfig::default_config());
        let mut config = PolicyConfig::default_config();
        config.allowlists.commands = vec![
            "  SchTasks  ".to_string(),
            "schtasks".to_string(),
            "".to_string(),
        ];
        config.default_policies.remove(&EffectType::NetworkOutbound);

        engine.replace_config(config);

        assert_eq!(
            engine.config.allowlists.commands,
            vec!["SchTasks".to_string()]
        );
        assert_eq!(
            engine
                .config
                .default_policies
                .get(&EffectType::NetworkOutbound),
            Some(&ConfirmationPolicy::Once)
        );
    }
}
