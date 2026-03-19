use super::types::{
    ConfirmationPolicy, EffectRequest, EffectResponse, EffectScope, EffectType, PolicyConfig,
};
use chrono::Utc;
use std::path::PathBuf;

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
}

impl PolicyEngine {
    pub fn new(config: PolicyConfig) -> Self {
        Self { config }
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

        let mut policy = self
            .config
            .default_policies
            .get(&request.effect_type)
            .cloned()
            .unwrap_or(ConfirmationPolicy::Always);

        if self.requires_host_folder_confirmation(request) {
            policy = ConfirmationPolicy::Once;
        }

        let modified_scope = self.apply_allowlists(request);

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

    fn requires_host_folder_confirmation(&self, request: &EffectRequest) -> bool {
        if request.effect_type != EffectType::FilesystemRead {
            return false;
        }

        let Some(target_path) = &request.payload.path else {
            return false;
        };
        let Some(scope) = &request.scope else {
            return false;
        };
        let Some(workspace_paths) = &scope.workspace_paths else {
            return false;
        };

        let target = PathBuf::from(target_path);
        !workspace_paths
            .iter()
            .map(PathBuf::from)
            .any(|workspace| target.starts_with(&workspace))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{EffectContext, EffectPayload, EffectSource};

    fn make_request(path: &str, workspace_paths: Vec<&str>) -> EffectRequest {
        EffectRequest {
            id: "request-1".to_string(),
            timestamp: "2026-03-19T00:00:00Z".to_string(),
            effect_type: EffectType::FilesystemRead,
            source: EffectSource::Agent,
            source_id: None,
            payload: EffectPayload {
                path: Some(path.to_string()),
                content: None,
                operation: Some("read".to_string()),
                command: None,
                args: None,
                cwd: None,
                url: None,
                method: None,
                headers: None,
                description: Some("test".to_string()),
            },
            context: Some(EffectContext {
                task_id: Some("task-1".to_string()),
                tool_name: Some("list_dir".to_string()),
                reasoning: Some("test".to_string()),
            }),
            scope: Some(EffectScope {
                workspace_paths: Some(workspace_paths.into_iter().map(String::from).collect()),
                allowed_extensions: None,
                excluded_paths: None,
                command_allowlist: None,
                command_blocklist: None,
                domain_allowlist: None,
                domain_blocklist: None,
                max_file_size_bytes: None,
                timeout_ms: None,
            }),
        }
    }

    #[test]
    fn host_folder_read_requires_confirmation() {
        let engine = PolicyEngine::new(PolicyConfig::default_config());
        let outcome = engine.evaluate(&make_request(
            "/Users/tester/Downloads",
            vec!["/Users/tester/workspace"],
        ));

        match outcome.decision {
            PolicyDecision::RequiresUserConfirmation { policy, .. } => {
                assert_eq!(policy, ConfirmationPolicy::Once);
            }
            _ => panic!("expected host folder read to require confirmation"),
        }
    }

    #[test]
    fn workspace_read_remains_auto_approved() {
        let engine = PolicyEngine::new(PolicyConfig::default_config());
        let outcome = engine.evaluate(&make_request(
            "/Users/tester/workspace/src",
            vec!["/Users/tester/workspace"],
        ));

        match outcome.decision {
            PolicyDecision::Approved { approval_type, .. } => {
                assert_eq!(approval_type, ConfirmationPolicy::Never);
            }
            _ => panic!("expected workspace read to remain auto approved"),
        }
    }
}
