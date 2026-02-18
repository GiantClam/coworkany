use super::engine::PolicyOutcome;
use super::types::{EffectRequest, EffectResponse};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{Result as IoResult, Write};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub timestamp: String,
    pub event_type: String,
    pub request: EffectRequest,
    pub response: Option<EffectResponse>,
    pub note: Option<String>,
}

impl AuditEvent {
    /// Create audit event for initial request
    pub fn request(request: &EffectRequest, outcome: &PolicyOutcome) -> Self {
        Self {
            id: format!("audit-{}", request.id),
            timestamp: Utc::now().to_rfc3339(),
            event_type: "request".to_string(),
            request: request.clone(),
            response: None,
            note: Some(format!("Policy decision: {:?}", outcome.decision)),
        }
    }

    /// Create audit event for user confirmation
    pub fn confirmed(request: &EffectRequest, remember: bool) -> Self {
        Self {
            id: format!("audit-confirm-{}", request.id),
            timestamp: Utc::now().to_rfc3339(),
            event_type: "confirmed".to_string(),
            request: request.clone(),
            response: None,
            note: Some(format!("User confirmed (remember: {})", remember)),
        }
    }

    /// Create audit event for user denial
    pub fn denied(request: &EffectRequest, reason: Option<&str>) -> Self {
        Self {
            id: format!("audit-denied-{}", request.id),
            timestamp: Utc::now().to_rfc3339(),
            event_type: "denied".to_string(),
            request: request.clone(),
            response: None,
            note: reason.map(String::from),
        }
    }
}

pub trait AuditSink: Send {
    fn log(&mut self, event: AuditEvent) -> IoResult<()>;
}

#[allow(dead_code)]
pub struct FileAuditSink {
    path: PathBuf,
}

#[allow(dead_code)]
impl FileAuditSink {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn open_append(&self) -> IoResult<File> {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
    }
}

impl AuditSink for FileAuditSink {
    fn log(&mut self, event: AuditEvent) -> IoResult<()> {
        let mut file = self.open_append()?;
        let line = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        writeln!(file, "{}", line)?;
        Ok(())
    }
}

/// Console audit sink for development
pub struct ConsoleAuditSink;

impl AuditSink for ConsoleAuditSink {
    fn log(&mut self, event: AuditEvent) -> IoResult<()> {
        println!(
            "[AUDIT] {} {} {}",
            event.timestamp, event.event_type, event.request.id
        );
        Ok(())
    }
}
