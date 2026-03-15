use super::engine::PolicyOutcome;
use super::types::{EffectRequest, EffectResponse};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Result as IoResult, Write};
use std::path::{Path, PathBuf};

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

pub fn read_recent_audit_events(path: &Path, limit: usize) -> IoResult<Vec<AuditEvent>> {
    if limit == 0 || !path.exists() {
        return Ok(Vec::new());
    }

    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut recent = VecDeque::with_capacity(limit);

    for line in reader.lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(event) = serde_json::from_str::<AuditEvent>(trimmed) else {
            continue;
        };

        if recent.len() == limit {
            recent.pop_front();
        }
        recent.push_back(event);
    }

    Ok(recent.into_iter().collect())
}

/// Console audit sink for development
#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::{read_recent_audit_events, AuditEvent, AuditSink, FileAuditSink};
    use crate::policy::types::{EffectPayload, EffectRequest, EffectSource, EffectType};
    use chrono::Utc;
    use std::fs;

    fn sample_event(id: &str) -> AuditEvent {
        AuditEvent {
            id: format!("audit-{}", id),
            timestamp: Utc::now().to_rfc3339(),
            event_type: "request".to_string(),
            request: EffectRequest {
                id: id.to_string(),
                timestamp: Utc::now().to_rfc3339(),
                effect_type: EffectType::ShellRead,
                source: EffectSource::Agent,
                source_id: None,
                payload: EffectPayload {
                    path: None,
                    content: None,
                    operation: None,
                    command: Some("schtasks /query".to_string()),
                    args: None,
                    cwd: None,
                    url: None,
                    method: None,
                    headers: None,
                    description: None,
                },
                context: None,
                scope: None,
            },
            response: None,
            note: None,
        }
    }

    #[test]
    fn read_recent_audit_events_returns_tail_of_log() {
        let audit_path = std::env::temp_dir().join(format!(
            "coworkany-policy-audit-test-{}.jsonl",
            std::process::id()
        ));
        let _ = fs::remove_file(&audit_path);
        let mut sink = FileAuditSink::new(audit_path.clone());

        for idx in 0..5 {
            sink.log(sample_event(&format!("req-{}", idx)))
                .expect("log");
        }

        let events = read_recent_audit_events(&audit_path, 2).expect("read");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].request.id, "req-3");
        assert_eq!(events[1].request.id, "req-4");
        let _ = fs::remove_file(&audit_path);
    }
}
