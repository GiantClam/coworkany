use rusqlite::{params, Connection, OpenFlags, Result, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Digest;
use std::fs;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BACKUP_INTERVAL: Duration = Duration::from_secs(5 * 60);
const REDACTED: &str = "[REDACTED]";
static BACKUP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK (id = 1), device_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT NOT NULL, opencode_session_id TEXT, agent_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, parts_json TEXT, metadata_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id), status TEXT NOT NULL, model TEXT, source TEXT, assistant_message_id TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT);
CREATE TABLE IF NOT EXISTS run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), sequence INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(run_id, sequence));
CREATE TABLE IF NOT EXISTS run_invocations (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), invocation_id TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(run_id, category, invocation_id, attempt));
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), relative_path TEXT NOT NULL, mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS deleted_artifacts (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS usage_records (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT REFERENCES runs(id), usage_id TEXT, provider TEXT, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER, reasoning_tokens INTEGER, provider_cost REAL, estimated_cost REAL, aggregation TEXT NOT NULL DEFAULT 'delta', scope TEXT NOT NULL DEFAULT 'step', idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, definition_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS workflow_revisions (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id), revision INTEGER NOT NULL, definition_json TEXT NOT NULL, definition_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(workflow_id, revision));
CREATE TABLE IF NOT EXISTS workflow_ai_operation_groups (workflow_id TEXT NOT NULL REFERENCES workflows(id), id TEXT NOT NULL, conversation_id TEXT NOT NULL, base_revision INTEGER NOT NULL, result_revision INTEGER, commands_json TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workflow_id, id));
CREATE TABLE IF NOT EXISTS run_nodes (run_id TEXT NOT NULL REFERENCES runs(id), node_key TEXT NOT NULL, status TEXT NOT NULL, output_json TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(run_id, node_key));
CREATE TABLE IF NOT EXISTS run_attempts (idempotency_key TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), node_key TEXT NOT NULL, provider TEXT, provider_task_id TEXT, status TEXT NOT NULL, payload_json TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS run_checkpoints (run_id TEXT NOT NULL REFERENCES runs(id), checkpoint_key TEXT NOT NULL, sequence INTEGER NOT NULL, output_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(run_id, checkpoint_key));
CREATE TABLE IF NOT EXISTS vault_mappings (id TEXT PRIMARY KEY, vault_path TEXT NOT NULL UNIQUE, index_path TEXT NOT NULL, embedding_model TEXT NOT NULL, embedding_dimension INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
"#;

pub fn data_root(executable: &Path, local_app_data: Option<PathBuf>) -> PathBuf {
    if executable.join("portable.flag").exists() { return executable.join(crate::platform::portable_data_directory()); }
    local_app_data.unwrap_or_else(|| PathBuf::from(".").join("CoworkAny"))
}

pub fn initialize(path: &Path) -> Result<()> {
    match initialize_schema(path) {
        Ok(()) => ensure_recent_consistent_backup(path),
        Err(error) if is_database_corruption(&error) && restore_latest_consistent_backup(path).is_ok() => {
            initialize_schema(path)?;
            ensure_recent_consistent_backup(path)
        }
        Err(error) => Err(error),
    }
}

fn initialize_schema(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|_| rusqlite::Error::InvalidPath(parent.to_path_buf()))?; }
    let connection = open(path)?;
    connection.execute_batch(SCHEMA)?;
    let device_id = stable_device_id(path);
    connection.execute("INSERT OR IGNORE INTO identity(id, device_id) VALUES (1, ?1)", [device_id])?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)", [])?;
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN idempotency_key TEXT", []);
    let _ = connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS usage_idempotency_key ON usage_records(idempotency_key) WHERE idempotency_key IS NOT NULL", []);
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)", [])?;
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN provider TEXT", []);
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN provider_cost REAL", []);
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (3)", [])?;
    connection.execute("CREATE TABLE IF NOT EXISTS run_checkpoints (run_id TEXT NOT NULL REFERENCES runs(id), checkpoint_key TEXT NOT NULL, sequence INTEGER NOT NULL, output_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(run_id, checkpoint_key))", [])?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (4)", [])?;
    let _ = connection.execute("ALTER TABLE messages ADD COLUMN parts_json TEXT", []);
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (5)", [])?;
    let _ = connection.execute("ALTER TABLE conversations ADD COLUMN agent_id TEXT", []);
    connection.execute("CREATE INDEX IF NOT EXISTS conversations_agent_updated_idx ON conversations(agent_id, updated_at DESC)", [])?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (6)", [])?;
    let _ = connection.execute("ALTER TABLE messages ADD COLUMN metadata_json TEXT", []);
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (7)", [])?;
    // SQLite preserves the storage class of values written by older clients,
    // even when the column is declared TEXT. Normalize historical workflow
    // definitions so rusqlite can safely deserialize them as String values.
    connection.execute("UPDATE workflows SET definition_json=CAST(definition_json AS TEXT) WHERE typeof(definition_json)='blob'", [])?;
    connection.execute("UPDATE workflow_revisions SET definition_json=CAST(definition_json AS TEXT) WHERE typeof(definition_json)='blob'", [])?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (8)", [])?;
    connection.execute("CREATE TABLE IF NOT EXISTS workflow_ai_operation_groups (workflow_id TEXT NOT NULL REFERENCES workflows(id), id TEXT NOT NULL, conversation_id TEXT NOT NULL, base_revision INTEGER NOT NULL, result_revision INTEGER, commands_json TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workflow_id, id))", [])?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (9)", [])?;
    let _ = connection.execute("ALTER TABLE runs ADD COLUMN source TEXT", []);
    let _ = connection.execute("ALTER TABLE runs ADD COLUMN assistant_message_id TEXT", []);
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN usage_id TEXT", []);
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN cached_input_tokens INTEGER", []);
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN reasoning_tokens INTEGER", []);
    // Legacy rows did not declare delta-vs-snapshot semantics. Keep these
    // columns null during migration so history remains explicitly partial.
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN aggregation TEXT", []);
    let _ = connection.execute("ALTER TABLE usage_records ADD COLUMN scope TEXT", []);
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS usage_record_usage_id ON usage_records(run_id, usage_id) WHERE usage_id IS NOT NULL", [])?;
    connection.execute("CREATE INDEX IF NOT EXISTS usage_records_created_idx ON usage_records(created_at DESC)", [])?;
    connection.execute("CREATE INDEX IF NOT EXISTS runs_started_idx ON runs(started_at DESC)", [])?;
    connection.execute("CREATE TABLE IF NOT EXISTS run_invocations (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), invocation_id TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(run_id, category, invocation_id, attempt))", [])?;
    connection.execute("CREATE INDEX IF NOT EXISTS run_invocations_run_category_idx ON run_invocations(run_id, category)", [])?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version) VALUES (10)", [])?;
    Ok(())
}

fn backup_path(path: &Path) -> PathBuf { sibling_path(path, ".backup") }
fn previous_backup_path(path: &Path) -> PathBuf { sibling_path(path, ".backup.previous") }
fn temporary_backup_path(path: &Path) -> PathBuf { sibling_path(path, ".backup.next") }

fn sibling_path(path: &Path, suffix: &str) -> PathBuf {
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("app.db");
    path.with_file_name(format!("{file_name}{suffix}"))
}

fn is_database_corruption(error: &rusqlite::Error) -> bool {
    let text = error.to_string().to_ascii_lowercase();
    ["database disk image is malformed", "file is not a database", "database corruption", "malformed database schema"].iter().any(|needle| text.contains(needle))
}

fn ensure_recent_consistent_backup(path: &Path) -> Result<()> {
    let _guard = BACKUP_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| rusqlite::Error::InvalidQuery)?;
    let backup = backup_path(path);
    // Re-check after waiting for another reader that may have just refreshed
    // the backup. Without this second check, parallel startup reads all run
    // VACUUM INTO against the same temporary file.
    let stale = backup.metadata().and_then(|metadata| metadata.modified()).ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_none_or(|age| age >= BACKUP_INTERVAL);
    if stale { create_consistent_backup(path)?; }
    Ok(())
}

/// Create a SQLite-consistent backup outside WAL by asking SQLite to copy it.
/// The previous verified copy is retained until the new one has been written.
fn create_consistent_backup(path: &Path) -> Result<()> {
    let backup = backup_path(path);
    let previous = previous_backup_path(path);
    let temporary = temporary_backup_path(path);
    let _ = fs::remove_file(&temporary);
    let quoted_temporary = temporary.to_string_lossy().replace('\'', "''");
    let connection = open(path)?;
    connection.execute_batch(&format!("VACUUM INTO '{quoted_temporary}';"))?;
    drop(connection);
    if !backup_is_consistent(&temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(rusqlite::Error::InvalidPath(temporary));
    }
    if backup.exists() {
        let _ = fs::remove_file(&previous);
        fs::rename(&backup, &previous).map_err(|_| rusqlite::Error::InvalidPath(backup.clone()))?;
    }
    if let Err(error) = fs::rename(&temporary, &backup) {
        if previous.exists() { let _ = fs::rename(&previous, &backup); }
        return Err(rusqlite::Error::InvalidPath(PathBuf::from(error.to_string())));
    }
    Ok(())
}

fn backup_is_consistent(path: &Path) -> bool {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|connection| connection.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0)))
        .is_ok_and(|result| result == "ok")
}

fn restore_latest_consistent_backup(path: &Path) -> Result<()> {
    let backup = [backup_path(path), previous_backup_path(path)].into_iter().find(|candidate| backup_is_consistent(candidate))
        .ok_or_else(|| rusqlite::Error::InvalidPath(path.to_path_buf()))?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    if path.exists() {
        let quarantine = sibling_path(path, &format!(".corrupt-{stamp}"));
        fs::rename(path, quarantine).map_err(|_| rusqlite::Error::InvalidPath(path.to_path_buf()))?;
    }
    for suffix in ["-wal", "-shm"] {
        let sidecar = sibling_path(path, suffix);
        if sidecar.exists() {
            let quarantine = sibling_path(path, &format!("{suffix}.corrupt-{stamp}"));
            fs::rename(&sidecar, quarantine).map_err(|_| rusqlite::Error::InvalidPath(sidecar.clone()))?;
        }
    }
    let restore_temporary = sibling_path(path, ".restore");
    let _ = fs::remove_file(&restore_temporary);
    fs::copy(&backup, &restore_temporary).map_err(|_| rusqlite::Error::InvalidPath(backup))?;
    fs::rename(&restore_temporary, path).map_err(|_| rusqlite::Error::InvalidPath(path.to_path_buf()))?;
    Ok(())
}

/// Marks non-terminal runs as interrupted during startup. A crash must never
/// make an unfinished OpenCode/provider request look successful.
pub fn recover_interrupted(path: &Path) -> Result<i64> {
    let connection = open(path)?;
    let changed = connection.execute("UPDATE runs SET status='interrupted', finished_at=CURRENT_TIMESTAMP WHERE status IN ('running', 'queued', 'started')", [])?;
    connection.execute("UPDATE run_nodes SET status='interrupted', updated_at=CURRENT_TIMESTAMP WHERE status IN ('queued', 'running', 'started') AND run_id IN (SELECT id FROM runs WHERE status='interrupted')", [])?;
    Ok(changed as i64)
}

fn stable_device_id(path: &Path) -> String {
    let mut digest = sha2::Sha256::new();
    digest.update(path.to_string_lossy().as_bytes());
    digest.update(std::env::var("COMPUTERNAME").unwrap_or_default().as_bytes());
    digest.update(std::env::var("USERNAME").unwrap_or_default().as_bytes());
    format!("local-{:x}", digest.finalize())
}

pub fn integrity(path: &Path) -> Result<bool> {
    let connection = open(path)?;
    Ok(connection.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))? == "ok")
}

#[cfg(test)]
pub fn migrations_ready(path: &Path) -> Result<bool> {
    initialize(path)?;
    migrations_ready_without_initialization(path)
}

/// Check the migration marker after the caller has already initialized the
/// database. This avoids repeating schema creation and backup work during
/// the desktop startup probe.
pub fn migrations_ready_without_initialization(path: &Path) -> Result<bool> {
    let connection = open(path)?;
    let latest: i64 = connection.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |row| row.get(0))?;
    Ok(latest >= 10)
}

fn open(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    Ok(connection)
}

fn redact_json_payload(raw: &str) -> Result<String> {
    let mut value: Value = serde_json::from_str(raw).map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    redact_json_value(&mut value);
    serde_json::to_string(&value).map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

fn redact_json_value(value: &mut Value) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(redact_json_value),
        Value::Object(fields) => {
            for (key, nested) in fields.iter_mut() {
                let normalized = key.chars().filter(|character| character.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
                // Workflow identity fields such as `nodeKey` and `edgeKey`
                // are structural data, not credentials. Redacting every key
                // ending with "key" corrupts saved workflow graphs.
                if normalized == "apikey"
                    || normalized == "key"
                    || normalized == "privatekey"
                    || normalized == "secretkey"
                    || normalized == "clientsecret"
                    || normalized == "accesstoken"
                    || normalized == "refreshtoken"
                    || normalized == "idtoken"
                    || normalized == "token"
                    || normalized.ends_with("token")
                    || normalized == "secret"
                    || normalized.ends_with("secret")
                    || normalized == "password"
                    || normalized.ends_with("password")
                    || normalized == "authorization"
                    || normalized.ends_with("authorization")
                    || normalized == "credential"
                    || normalized.ends_with("credential")
                {
                    *nested = Value::String(REDACTED.to_string());
                } else {
                    redact_json_value(nested);
                }
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMetricCount {
    pub total: i64,
    pub completed: i64,
    pub failed: i64,
    pub rejected: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMetricNameCount {
    pub name: String,
    pub total: i64,
    pub completed: i64,
    pub failed: i64,
    pub rejected: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunMetricsRow {
    pub run_id: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub model_tools: RunMetricCount,
    pub capabilities: RunMetricCount,
    pub model_tool_breakdown: Vec<RunMetricNameCount>,
    pub capability_breakdown: Vec<RunMetricNameCount>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cached_input_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    pub provider_cost: Option<f64>,
    pub estimated_cost: Option<f64>,
    pub completeness: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsQueryFilters {
    pub range: String,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub source: Option<String>,
    pub query: Option<String>,
    pub run_id: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsOverview {
    pub tokens: i64,
    pub model_tools: i64,
    pub capabilities: i64,
    pub provider_cost: Option<f64>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSeriesBucket {
    pub date: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub model_tools: i64,
    pub capabilities: i64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsBreakdownRow {
    pub name: String,
    pub runs: i64,
    pub invocations: i64,
    pub completed: i64,
    pub failed: i64,
    pub tokens: Option<i64>,
    pub provider_cost: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsRunRow {
    pub run_id: String,
    pub conversation_id: Option<String>,
    pub message_id: Option<String>,
    pub title: String,
    pub source: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub started_at: String,
    pub metrics: RunMetricsRow,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsQueryResult {
    pub overview: MetricsOverview,
    pub series: Vec<MetricsSeriesBucket>,
    pub models: Vec<MetricsBreakdownRow>,
    pub tools: Vec<MetricsBreakdownRow>,
    pub capabilities: Vec<MetricsBreakdownRow>,
    pub runs: Vec<MetricsRunRow>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConversationRow { pub id: String, pub title: String, pub opencode_session_id: Option<String>, pub agent_id: Option<String>, pub updated_at: String }

#[derive(Debug, Serialize)]
pub struct ArtifactRow { pub id: String, pub project_id: Option<String>, pub relative_path: String, pub mime_type: String, pub byte_length: i64, pub sha256: String, pub created_at: String, pub available: bool }

#[derive(Debug, PartialEq, Eq)]
pub struct ArtifactReconciliationCandidate { pub id: String, pub relative_path: String, pub mime_type: String }

#[derive(Debug, Serialize)]
pub struct MessageRow { pub id: String, pub conversation_id: String, pub role: String, pub content: String, pub parts_json: Option<String>, pub metadata_json: Option<String>, pub created_at: String }

#[derive(Debug, Serialize)]
pub struct RunRow { pub id: String, pub conversation_id: Option<String>, pub status: String, pub model: Option<String>, pub started_at: String, pub finished_at: Option<String> }

#[derive(Debug, Serialize)]
pub struct RunAttemptRow { pub idempotency_key: String, pub run_id: String, pub node_key: String, pub provider: Option<String>, pub provider_task_id: Option<String>, pub status: String, pub payload_json: Option<String>, pub updated_at: String }

#[derive(Debug, Serialize)]
pub struct RunEventRow { pub sequence: i64, pub event_type: String, pub payload_json: String, pub created_at: String }

#[derive(Debug, Serialize)]
pub struct RunNodeRow { pub node_key: String, pub status: String, pub output_json: Option<String>, pub updated_at: String }

#[derive(Debug, Serialize)]
pub struct RunUsageRow { pub provider: Option<String>, pub model: String, pub input_tokens: Option<i64>, pub output_tokens: Option<i64>, pub provider_cost: Option<f64>, pub estimated_cost: Option<f64>, pub created_at: String }

#[derive(Debug, Serialize)]
pub struct RunDetail { pub run: RunRow, pub nodes: Vec<RunNodeRow>, pub events: Vec<RunEventRow>, pub usage: Vec<RunUsageRow> }

#[derive(Debug, Serialize)]
pub struct WorkflowRow { pub id: String, pub project_id: Option<String>, pub name: String, pub definition_json: String, pub updated_at: String }

#[derive(Debug, Serialize)]
pub struct WorkflowAiOperationGroupRow {
    pub id: String,
    pub conversation_id: String,
    pub workflow_id: String,
    pub base_revision: i64,
    pub result_revision: Option<i64>,
    pub commands_json: String,
    pub status: String,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct WorkflowAiOperationGroupWrite {
    pub id: String,
    pub conversation_id: String,
    pub workflow_id: String,
    pub base_revision: i64,
    pub result_revision: Option<i64>,
    pub commands_json: String,
    pub status: String,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug)]
pub enum WorkflowAiStorageError {
    Database(rusqlite::Error),
    InvalidOperation(String),
    RevisionConflict { expected: i64, actual: i64 },
}

impl std::fmt::Display for WorkflowAiStorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "{error}"),
            Self::InvalidOperation(message) => write!(formatter, "workflow_ai_invalid_operation:{message}"),
            Self::RevisionConflict { expected, actual } => write!(formatter, "workflow_ai_revision_conflict:expected={expected}:actual={actual}"),
        }
    }
}

impl std::error::Error for WorkflowAiStorageError {}

impl From<rusqlite::Error> for WorkflowAiStorageError {
    fn from(error: rusqlite::Error) -> Self { Self::Database(error) }
}

#[derive(Debug, Serialize)]
pub struct UsageSummary { pub runs: i64, pub input_tokens: i64, pub output_tokens: i64, pub provider_cost: Option<f64>, pub estimated_cost: Option<f64>, pub artifacts: i64 }

pub fn create_conversation(path: &Path, id: &str, title: &str, project_id: Option<&str>, agent_id: Option<&str>) -> Result<ConversationRow> {
    initialize(path)?;
    let connection = open(path)?;
    connection.execute("INSERT INTO conversations(id, project_id, title, agent_id) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET title=excluded.title, agent_id=COALESCE(excluded.agent_id, conversations.agent_id), updated_at=CURRENT_TIMESTAMP", params![id, project_id, title, agent_id])?;
    connection.query_row("SELECT id, title, opencode_session_id, agent_id, updated_at FROM conversations WHERE id=?1", [id], |row| Ok(ConversationRow { id: row.get(0)?, title: row.get(1)?, opencode_session_id: row.get(2)?, agent_id: row.get(3)?, updated_at: row.get(4)? }))
}

pub fn upsert_project(path: &Path, root_path: &str, name: &str) -> Result<String> {
    initialize(path)?;
    let connection = open(path)?;
    let id = format!("project-{:x}", sha2::Sha256::digest(root_path.as_bytes()));
    connection.execute("INSERT INTO projects(id, name, root_path) VALUES (?1, ?2, ?3) ON CONFLICT(root_path) DO UPDATE SET name=excluded.name", params![id, name, root_path])?;
    Ok(id)
}

pub fn set_session_id(path: &Path, conversation_id: &str, session_id: &str) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    connection.execute("UPDATE conversations SET opencode_session_id=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?1", params![conversation_id, session_id])?;
    Ok(())
}

pub fn append_message(path: &Path, id: &str, conversation_id: &str, role: &str, content: &str, parts_json: Option<&str>, metadata_json: Option<&str>, created_at: Option<&str>) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    connection.execute("INSERT INTO messages(id, conversation_id, role, content, parts_json, metadata_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, CURRENT_TIMESTAMP)) ON CONFLICT(id) DO NOTHING", params![id, conversation_id, role, content, parts_json, metadata_json, created_at])?;
    connection.execute("UPDATE conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?1", [conversation_id])?;
    Ok(())
}

pub fn create_run(path: &Path, id: &str, conversation_id: Option<&str>, model: Option<&str>) -> Result<()> {
    create_run_with_context(path, id, conversation_id, model, None, None)
}

pub fn create_run_with_context(
    path: &Path,
    id: &str,
    conversation_id: Option<&str>,
    model: Option<&str>,
    source: Option<&str>,
    assistant_message_id: Option<&str>,
) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    connection.execute("INSERT INTO runs(id, conversation_id, status, model, source, assistant_message_id) VALUES (?1, ?2, 'running', ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET source=COALESCE(excluded.source, runs.source), assistant_message_id=COALESCE(excluded.assistant_message_id, runs.assistant_message_id)", params![id, conversation_id, model, source, assistant_message_id])?;
    Ok(())
}

pub fn append_run_event(path: &Path, run_id: &str, sequence: i64, event_type: &str, payload_json: &str) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    let payload_json = redact_json_payload(payload_json)?;
    connection.execute("INSERT INTO run_events(run_id, sequence, event_type, payload_json) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(run_id, sequence) DO NOTHING", params![run_id, sequence, event_type, payload_json])?;
    Ok(())
}

pub fn register_artifact(path: &Path, id: &str, project_id: Option<&str>, metadata: &crate::artifacts::ArtifactMetadata) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    connection.execute("DELETE FROM deleted_artifacts WHERE id=?1", [id])?;
    connection.execute("INSERT INTO artifacts(id, project_id, relative_path, mime_type, byte_length, sha256) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO UPDATE SET relative_path=excluded.relative_path, mime_type=excluded.mime_type, byte_length=excluded.byte_length, sha256=excluded.sha256", params![id, project_id, metadata.relative_path, metadata.mime_type, metadata.byte_length as i64, metadata.sha256])?;
    Ok(())
}

pub fn finish_run(path: &Path, run_id: &str, status: &str) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    connection.execute("UPDATE runs SET status=?2, finished_at=CURRENT_TIMESTAMP WHERE id=?1", params![run_id, status])?;
    let node_status = match status {
        "cancelled" => Some("cancelled"),
        "interrupted" => Some("interrupted"),
        "failed" => Some("failed"),
        _ => None,
    };
    if let Some(node_status) = node_status {
        connection.execute("UPDATE run_nodes SET status=?2, updated_at=CURRENT_TIMESTAMP WHERE run_id=?1 AND status IN ('queued', 'running', 'started')", params![run_id, node_status])?;
    }
    Ok(())
}

#[allow(dead_code)]
pub fn record_usage(path: &Path, run_id: &str, provider: Option<&str>, model: &str, input_tokens: Option<i64>, output_tokens: Option<i64>, provider_cost: Option<f64>, estimated_cost: Option<f64>, idempotency_key: Option<&str>) -> Result<()> {
    let usage_id = idempotency_key.unwrap_or("");
    record_usage_detailed(
        path,
        run_id,
        usage_id,
        provider,
        model,
        input_tokens,
        output_tokens,
        None,
        None,
        provider_cost,
        estimated_cost,
        "delta",
        "step",
    )
}

#[allow(clippy::too_many_arguments)]
pub fn record_usage_detailed(
    path: &Path,
    run_id: &str,
    usage_id: &str,
    provider: Option<&str>,
    model: &str,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cached_input_tokens: Option<i64>,
    reasoning_tokens: Option<i64>,
    provider_cost: Option<f64>,
    estimated_cost: Option<f64>,
    aggregation: &str,
    scope: &str,
) -> Result<()> {
    if [
        input_tokens,
        output_tokens,
        cached_input_tokens,
        reasoning_tokens,
    ]
    .into_iter()
    .flatten()
    .any(|value| value < 0)
        || [provider_cost, estimated_cost]
            .into_iter()
            .flatten()
            .any(|value| !value.is_finite() || value < 0.0)
        || !matches!(aggregation, "delta" | "snapshot")
        || !matches!(scope, "step" | "run")
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    initialize(path)?;
    let connection = open(path)?;
    let persisted_usage_id = (!usage_id.is_empty()).then_some(usage_id);
    connection.execute("INSERT INTO usage_records(run_id, usage_id, provider, model, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, provider_cost, estimated_cost, aggregation, scope, idempotency_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT DO NOTHING", params![run_id, persisted_usage_id, provider, model, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, provider_cost, estimated_cost, aggregation, scope, persisted_usage_id])?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn record_run_invocation(
    path: &Path,
    run_id: &str,
    invocation_id: &str,
    category: &str,
    name: &str,
    status: &str,
    attempt: i64,
    started_at: Option<&str>,
    finished_at: Option<&str>,
) -> Result<()> {
    if !matches!(category, "model_tool" | "capability")
        || !matches!(
            status,
            "running" | "completed" | "failed" | "rejected" | "cancelled" | "interrupted"
        )
        || invocation_id.trim().is_empty()
        || name.trim().is_empty()
        || attempt < 1
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    initialize(path)?;
    let connection = open(path)?;
    connection.execute(
        "INSERT INTO run_invocations(run_id, invocation_id, category, name, status, attempt, started_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(run_id, category, invocation_id, attempt) DO UPDATE SET name=excluded.name, status=CASE WHEN run_invocations.status IN ('completed','failed','rejected','cancelled','interrupted') AND excluded.status='running' THEN run_invocations.status ELSE excluded.status END, started_at=COALESCE(run_invocations.started_at, excluded.started_at), finished_at=COALESCE(excluded.finished_at, run_invocations.finished_at), updated_at=CURRENT_TIMESTAMP",
        params![run_id, invocation_id, category, name, status, attempt, started_at, finished_at],
    )?;
    Ok(())
}

fn invocation_counts(
    connection: &Connection,
    run_id: &str,
    category: &str,
) -> Result<(RunMetricCount, Vec<RunMetricNameCount>)> {
    let mut statement = connection.prepare("SELECT name, COUNT(*), SUM(status='completed'), SUM(status IN ('failed','cancelled','interrupted')), SUM(status='rejected') FROM run_invocations WHERE run_id=?1 AND category=?2 GROUP BY name ORDER BY COUNT(*) DESC, name ASC")?;
    let breakdown = statement
        .query_map(params![run_id, category], |row| {
            Ok(RunMetricNameCount {
                name: row.get(0)?,
                total: row.get(1)?,
                completed: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                failed: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                rejected: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let counts = breakdown
        .iter()
        .fold(RunMetricCount::default(), |mut total, row| {
            total.total += row.total;
            total.completed += row.completed;
            total.failed += row.failed;
            total.rejected += row.rejected;
            total
        });
    Ok((counts, breakdown))
}

#[derive(Debug)]
struct UsageMetricRecord {
    provider: Option<String>,
    model: String,
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cached_input_tokens: Option<i64>,
    reasoning_tokens: Option<i64>,
    provider_cost: Option<f64>,
    estimated_cost: Option<f64>,
    aggregation: Option<String>,
    scope: Option<String>,
}

fn sum_optional_i64(
    records: &[UsageMetricRecord],
    value: impl Fn(&UsageMetricRecord) -> Option<i64>,
) -> Option<i64> {
    records
        .iter()
        .filter_map(value)
        .reduce(|left, right| left + right)
}

fn sum_optional_f64(
    records: &[UsageMetricRecord],
    value: impl Fn(&UsageMetricRecord) -> Option<f64>,
) -> Option<f64> {
    records
        .iter()
        .filter_map(value)
        .reduce(|left, right| left + right)
}

pub fn get_run_metrics(path: &Path, run_id: &str) -> Result<RunMetricsRow> {
    initialize(path)?;
    let connection = open(path)?;
    let (model_tools, model_tool_breakdown) = invocation_counts(&connection, run_id, "model_tool")?;
    let (capabilities, capability_breakdown) =
        invocation_counts(&connection, run_id, "capability")?;
    let run_model =
        connection.query_row("SELECT model FROM runs WHERE id=?1", [run_id], |row| {
            row.get::<_, Option<String>>(0)
        })?;
    let mut statement = connection.prepare("SELECT provider, model, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, provider_cost, estimated_cost, aggregation, scope FROM usage_records WHERE run_id=?1 ORDER BY id ASC")?;
    let all_records = statement
        .query_map([run_id], |row| {
            Ok(UsageMetricRecord {
                provider: row.get(0)?,
                model: row.get(1)?,
                input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
                cached_input_tokens: row.get(4)?,
                reasoning_tokens: row.get(5)?,
                provider_cost: row.get(6)?,
                estimated_cost: row.get(7)?,
                aggregation: row.get(8)?,
                scope: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let latest_snapshot = all_records.iter().rposition(|record| {
        record.aggregation.as_deref() == Some("snapshot") && record.scope.as_deref() == Some("run")
    });
    let selected: &[UsageMetricRecord] = latest_snapshot
        .map(|index| &all_records[index..=index])
        .unwrap_or(&all_records);
    let input_tokens = sum_optional_i64(selected, |record| record.input_tokens);
    let output_tokens = sum_optional_i64(selected, |record| record.output_tokens);
    let cached_input_tokens = sum_optional_i64(selected, |record| record.cached_input_tokens);
    let reasoning_tokens = sum_optional_i64(selected, |record| record.reasoning_tokens);
    let provider_cost = sum_optional_f64(selected, |record| record.provider_cost);
    let estimated_cost = sum_optional_f64(selected, |record| record.estimated_cost);
    let latest_identity = selected.last().or_else(|| all_records.last());
    let provider = latest_identity.and_then(|record| record.provider.clone());
    let model = latest_identity
        .map(|record| record.model.clone())
        .or(run_model);
    let invocation_total = model_tools.total + capabilities.total;
    let completeness = if selected.is_empty() {
        if invocation_total > 0 {
            "partial"
        } else {
            "unavailable"
        }
    } else if selected.iter().all(|record| {
        record.input_tokens.is_some()
            && record.output_tokens.is_some()
            && record.aggregation.is_some()
            && record.scope.is_some()
    }) {
        "complete"
    } else {
        "partial"
    };
    Ok(RunMetricsRow {
        run_id: run_id.to_string(),
        provider,
        model,
        model_tools,
        capabilities,
        model_tool_breakdown,
        capability_breakdown,
        input_tokens,
        output_tokens,
        cached_input_tokens,
        reasoning_tokens,
        provider_cost,
        estimated_cost,
        completeness: completeness.to_string(),
    })
}

pub fn query_metrics(path: &Path, filters: &MetricsQueryFilters) -> Result<MetricsQueryResult> {
    initialize(path)?;
    if !matches!(filters.range.as_str(), "7d" | "30d" | "all") {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let connection = open(path)?;
    let date_modifier = match filters.range.as_str() {
        "7d" => "-7 days",
        "30d" => "-30 days",
        _ => "-100 years",
    };
    let query_pattern = filters
        .query
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("%{}%", value.trim()));
    let mut statement = connection.prepare(
        "SELECT r.id, r.conversation_id, r.assistant_message_id, COALESCE(c.title, r.id), COALESCE(r.source, 'conversation'), r.status, r.started_at
         FROM runs r LEFT JOIN conversations c ON c.id=r.conversation_id
         WHERE (?1='all' OR datetime(r.started_at)>=datetime('now', ?2))
           AND (?3 IS NULL OR r.model=?3)
           AND (?4 IS NULL OR COALESCE(r.source, 'conversation')=?4)
           AND (?5 IS NULL OR r.id=?5)
           AND (?6 IS NULL OR r.id LIKE ?6 OR COALESCE(c.title, '') LIKE ?6)
           AND (?7 IS NULL OR EXISTS(SELECT 1 FROM usage_records u WHERE u.run_id=r.id AND u.provider=?7))
         ORDER BY datetime(r.started_at) DESC, r.id DESC",
    )?;
    let run_headers = statement
        .query_map(
            params![
                filters.range,
                date_modifier,
                filters.model,
                filters.source,
                filters.run_id,
                query_pattern,
                filters.provider
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    let mut all_rows = Vec::with_capacity(run_headers.len());
    for (run_id, conversation_id, message_id, title, source, status, started_at) in run_headers {
        let metrics = get_run_metrics(path, &run_id)?;
        all_rows.push(MetricsRunRow {
            provider: metrics.provider.clone(),
            model: metrics.model.clone(),
            run_id,
            conversation_id,
            message_id,
            title,
            source,
            status,
            started_at,
            metrics,
        });
    }

    let mut overview = MetricsOverview::default();
    let mut series = BTreeMap::<String, MetricsSeriesBucket>::new();
    let mut models = HashMap::<String, MetricsBreakdownRow>::new();
    let mut tools = HashMap::<String, MetricsBreakdownRow>::new();
    let mut capabilities = HashMap::<String, MetricsBreakdownRow>::new();
    for row in &all_rows {
        let input = row.metrics.input_tokens.unwrap_or(0);
        let output = row.metrics.output_tokens.unwrap_or(0);
        overview.tokens += input + output;
        overview.model_tools += row.metrics.model_tools.total;
        overview.capabilities += row.metrics.capabilities.total;
        if let Some(cost) = row.metrics.provider_cost {
            overview.provider_cost = Some(overview.provider_cost.unwrap_or(0.0) + cost);
        }
        let date = row.started_at.chars().take(10).collect::<String>();
        let bucket = series
            .entry(date.clone())
            .or_insert_with(|| MetricsSeriesBucket {
                date,
                ..Default::default()
            });
        bucket.input_tokens += input;
        bucket.output_tokens += output;
        bucket.model_tools += row.metrics.model_tools.total;
        bucket.capabilities += row.metrics.capabilities.total;
        if let Some(model) = row.model.as_ref() {
            let model_row = models
                .entry(model.clone())
                .or_insert_with(|| MetricsBreakdownRow {
                    name: model.clone(),
                    ..Default::default()
                });
            model_row.runs += 1;
            model_row.tokens = Some(model_row.tokens.unwrap_or(0) + input + output);
            model_row.provider_cost = match (model_row.provider_cost, row.metrics.provider_cost) {
                (Some(total), Some(cost)) => Some(total + cost),
                (None, Some(cost)) => Some(cost),
                (current, None) => current,
            };
        }
        for item in &row.metrics.model_tool_breakdown {
            let aggregate = tools
                .entry(item.name.clone())
                .or_insert_with(|| MetricsBreakdownRow {
                    name: item.name.clone(),
                    ..Default::default()
                });
            aggregate.runs += 1;
            aggregate.invocations += item.total;
            aggregate.completed += item.completed;
            aggregate.failed += item.failed + item.rejected;
        }
        for item in &row.metrics.capability_breakdown {
            let aggregate =
                capabilities
                    .entry(item.name.clone())
                    .or_insert_with(|| MetricsBreakdownRow {
                        name: item.name.clone(),
                        ..Default::default()
                    });
            aggregate.runs += 1;
            aggregate.invocations += item.total;
            aggregate.completed += item.completed;
            aggregate.failed += item.failed + item.rejected;
        }
    }
    let sort_breakdown = |rows: HashMap<String, MetricsBreakdownRow>| {
        let mut rows = rows.into_values().collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            right
                .invocations
                .cmp(&left.invocations)
                .then_with(|| right.tokens.unwrap_or(0).cmp(&left.tokens.unwrap_or(0)))
                .then_with(|| left.name.cmp(&right.name))
        });
        rows
    };
    let limit = filters.limit.unwrap_or(50).clamp(1, 200) as usize;
    let start = filters
        .cursor
        .as_ref()
        .and_then(|cursor| all_rows.iter().position(|row| &row.run_id == cursor))
        .map(|index| index + 1)
        .unwrap_or(0);
    let end = (start + limit).min(all_rows.len());
    let next_cursor = (end < all_rows.len()).then(|| all_rows[end - 1].run_id.clone());
    let runs = all_rows.into_iter().skip(start).take(limit).collect();
    Ok(MetricsQueryResult {
        overview,
        series: series.into_values().collect(),
        models: sort_breakdown(models),
        tools: sort_breakdown(tools),
        capabilities: sort_breakdown(capabilities),
        runs,
        next_cursor,
    })
}

pub fn record_run_node(path: &Path, run_id: &str, node_key: &str, status: &str, output_json: Option<&str>) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    let output_json = output_json.map(redact_json_payload).transpose()?;
    connection.execute("INSERT INTO run_nodes(run_id, node_key, status, output_json) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(run_id, node_key) DO UPDATE SET status=excluded.status, output_json=excluded.output_json, updated_at=CURRENT_TIMESTAMP", params![run_id, node_key, status, output_json])?;
    Ok(())
}

pub fn record_run_checkpoint(path: &Path, run_id: &str, checkpoint_key: &str, sequence: i64, output_json: &str) -> Result<()> {
    if output_json.len() > 64 * 1024 { return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, "run_checkpoint_too_large")))); }
    initialize(path)?;
    let connection = open(path)?;
    let output_json = redact_json_payload(output_json)?;
    connection.execute("INSERT INTO run_checkpoints(run_id, checkpoint_key, sequence, output_json) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(run_id, checkpoint_key) DO UPDATE SET sequence=excluded.sequence, output_json=excluded.output_json, updated_at=CURRENT_TIMESTAMP", params![run_id, checkpoint_key, sequence, output_json])?;
    Ok(())
}

pub fn record_run_attempt(path: &Path, idempotency_key: &str, run_id: &str, node_key: &str, provider: Option<&str>, provider_task_id: Option<&str>, status: &str, payload_json: Option<&str>) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    let payload_json = payload_json.map(redact_json_payload).transpose()?;
    connection.execute("INSERT INTO run_attempts(idempotency_key, run_id, node_key, provider, provider_task_id, status, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(idempotency_key) DO UPDATE SET provider_task_id=COALESCE(excluded.provider_task_id, run_attempts.provider_task_id), status=excluded.status, payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP", params![idempotency_key, run_id, node_key, provider, provider_task_id, status, payload_json])?;
    Ok(())
}

pub fn upsert_vault_mapping(path: &Path, vault_path: &str, index_path: &str, embedding_model: &str, embedding_dimension: i64) -> Result<()> {
    initialize(path)?;
    let connection = open(path)?;
    let id = format!("vault-{:x}", sha2::Sha256::digest(vault_path.as_bytes()));
    connection.execute("INSERT INTO vault_mappings(id, vault_path, index_path, embedding_model, embedding_dimension) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(vault_path) DO UPDATE SET index_path=excluded.index_path, embedding_model=excluded.embedding_model, embedding_dimension=excluded.embedding_dimension, updated_at=CURRENT_TIMESTAMP", params![id, vault_path, index_path, embedding_model, embedding_dimension])?;
    Ok(())
}

pub fn list_conversations(path: &Path) -> Result<Vec<ConversationRow>> {
    initialize(path)?;
    let connection = open(path)?;
    let mut statement = connection.prepare("SELECT id, title, opencode_session_id, agent_id, updated_at FROM conversations ORDER BY updated_at DESC")?;
    let rows = statement.query_map([], |row| Ok(ConversationRow { id: row.get(0)?, title: row.get(1)?, opencode_session_id: row.get(2)?, agent_id: row.get(3)?, updated_at: row.get(4)? }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_artifacts(path: &Path) -> Result<Vec<ArtifactRow>> {
    initialize(path)?;
    let connection = open(path)?;
    let mut statement = connection.prepare("SELECT id, project_id, relative_path, mime_type, byte_length, sha256, created_at FROM artifacts ORDER BY created_at DESC")?;
    let rows = statement.query_map([], |row| Ok(ArtifactRow { id: row.get(0)?, project_id: row.get(1)?, relative_path: row.get(2)?, mime_type: row.get(3)?, byte_length: row.get(4)?, sha256: row.get(5)?, created_at: row.get(6)?, available: false }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn safe_artifact_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.trim().is_empty()
        && !value.contains('\0')
        && !path.is_absolute()
        && path.components().all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

pub fn artifact_reconciliation_candidates(path: &Path) -> Result<Vec<ArtifactReconciliationCandidate>> {
    initialize(path)?;
    let connection = open(path)?;
    let existing_ids = connection
        .prepare("SELECT id FROM artifacts")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    let events = connection
        .prepare("SELECT run_id, payload_json FROM run_events WHERE event_type='artifact' ORDER BY id ASC")?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut candidates = Vec::new();
    for (run_id, payload_json) in events {
        let Ok(payload) = serde_json::from_str::<Value>(&payload_json) else { continue; };
        let Some(artifact) = payload.get("artifact").and_then(Value::as_object) else { continue; };
        let Some(relative_path) = artifact.get("relativePath").and_then(Value::as_str).filter(|value| safe_artifact_relative_path(value)) else { continue; };
        let mime_type = artifact.get("mimeType").and_then(Value::as_str).filter(|value| !value.trim().is_empty()).unwrap_or("application/octet-stream");
        let id = artifact.get("id").and_then(Value::as_str).filter(|value| !value.trim().is_empty()).map(str::to_owned).unwrap_or_else(|| format!("{run_id}:{relative_path}"));
        if existing_ids.contains(&id) || candidates.iter().any(|candidate: &ArtifactReconciliationCandidate| candidate.id == id) { continue; }
        let deleted: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM deleted_artifacts WHERE id=?1)", [&id], |row| row.get(0))?;
        if deleted { continue; }
        candidates.push(ArtifactReconciliationCandidate { id, relative_path: relative_path.to_owned(), mime_type: mime_type.to_owned() });
    }
    Ok(candidates)
}

pub fn remove_artifact(path: &Path, artifact_id: &str) -> Result<()> {
    initialize(path)?;
    let mut connection = open(path)?;
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM artifacts WHERE id=?1", [artifact_id])?;
    transaction.execute("INSERT OR IGNORE INTO deleted_artifacts(id) VALUES (?1)", [artifact_id])?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
pub fn list_messages(path: &Path, conversation_id: &str) -> Result<Vec<MessageRow>> {
    list_messages_page(path, conversation_id, None, None, None)
}

pub fn list_messages_page(path: &Path, conversation_id: &str, limit: Option<i64>, before_created_at: Option<&str>, before_id: Option<&str>) -> Result<Vec<MessageRow>> {
    initialize(path)?;
    let connection = open(path)?;
    let mut rows = if let Some(raw_limit) = limit.filter(|value| *value > 0) {
        let bounded_limit = raw_limit.min(100);
        if let (Some(cursor_created_at), Some(cursor_id)) = (before_created_at.filter(|value| !value.is_empty()), before_id.filter(|value| !value.is_empty())) {
            let mut statement = connection.prepare("SELECT id, conversation_id, role, content, parts_json, metadata_json, created_at FROM messages WHERE conversation_id=?1 AND (created_at < ?2 OR (created_at = ?2 AND rowid < (SELECT rowid FROM messages WHERE id=?3))) ORDER BY created_at DESC, rowid DESC LIMIT ?4")?;
            let rows = statement.query_map(rusqlite::params![conversation_id, cursor_created_at, cursor_id, bounded_limit], |row| Ok(MessageRow { id: row.get(0)?, conversation_id: row.get(1)?, role: row.get(2)?, content: row.get(3)?, parts_json: row.get(4)?, metadata_json: row.get(5)?, created_at: row.get(6)? }))?.collect::<Result<Vec<_>, _>>()?;
            rows
        } else {
            let mut statement = connection.prepare("SELECT id, conversation_id, role, content, parts_json, metadata_json, created_at FROM messages WHERE conversation_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2")?;
            let rows = statement.query_map(rusqlite::params![conversation_id, bounded_limit], |row| Ok(MessageRow { id: row.get(0)?, conversation_id: row.get(1)?, role: row.get(2)?, content: row.get(3)?, parts_json: row.get(4)?, metadata_json: row.get(5)?, created_at: row.get(6)? }))?.collect::<Result<Vec<_>, _>>()?;
            rows
        }
    } else {
        let mut statement = connection.prepare("SELECT id, conversation_id, role, content, parts_json, metadata_json, created_at FROM messages WHERE conversation_id=?1 ORDER BY created_at ASC, rowid ASC")?;
        let rows = statement.query_map([conversation_id], |row| Ok(MessageRow { id: row.get(0)?, conversation_id: row.get(1)?, role: row.get(2)?, content: row.get(3)?, parts_json: row.get(4)?, metadata_json: row.get(5)?, created_at: row.get(6)? }))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    if limit.is_some() { rows.reverse(); }
    Ok(rows)
}

pub fn list_runs(path: &Path) -> Result<Vec<RunRow>> {
    initialize(path)?;
    let connection = open(path)?;
    let mut statement = connection.prepare("SELECT id, conversation_id, status, model, started_at, finished_at FROM runs ORDER BY started_at DESC LIMIT 100")?;
    let rows = statement.query_map([], |row| Ok(RunRow { id: row.get(0)?, conversation_id: row.get(1)?, status: row.get(2)?, model: row.get(3)?, started_at: row.get(4)?, finished_at: row.get(5)? }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn inspect_run(path: &Path, run_id: &str) -> Result<RunDetail> {
    initialize(path)?;
    let connection = open(path)?;
    let run = connection.query_row("SELECT id, conversation_id, status, model, started_at, finished_at FROM runs WHERE id=?1", [run_id], |row| Ok(RunRow { id: row.get(0)?, conversation_id: row.get(1)?, status: row.get(2)?, model: row.get(3)?, started_at: row.get(4)?, finished_at: row.get(5)? }))?;
    let events = connection.prepare("SELECT sequence, event_type, payload_json, created_at FROM run_events WHERE run_id=?1 ORDER BY sequence ASC")?.query_map([run_id], |row| Ok(RunEventRow { sequence: row.get(0)?, event_type: row.get(1)?, payload_json: row.get(2)?, created_at: row.get(3)? }))?.collect::<Result<Vec<_>, _>>()?;
    let nodes = connection.prepare("SELECT node_key, status, output_json, updated_at FROM run_nodes WHERE run_id=?1 ORDER BY node_key ASC")?.query_map([run_id], |row| Ok(RunNodeRow { node_key: row.get(0)?, status: row.get(1)?, output_json: row.get(2)?, updated_at: row.get(3)? }))?.collect::<Result<Vec<_>, _>>()?;
    let usage = connection.prepare("SELECT provider, model, input_tokens, output_tokens, provider_cost, estimated_cost, created_at FROM usage_records WHERE run_id=?1 ORDER BY created_at ASC, id ASC")?.query_map([run_id], |row| Ok(RunUsageRow { provider: row.get(0)?, model: row.get(1)?, input_tokens: row.get(2)?, output_tokens: row.get(3)?, provider_cost: row.get(4)?, estimated_cost: row.get(5)?, created_at: row.get(6)? }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(RunDetail { run, nodes, events, usage })
}

pub fn list_recoverable_attempts(path: &Path) -> Result<Vec<RunAttemptRow>> {
    initialize(path)?;
    let connection = open(path)?;
    // Only active or interrupted runs are eligible for automatic recovery.
    // A terminal failed run must stay visible as evidence, but must not cause
    // the desktop shell to resubmit or poll the same provider task forever.
    let mut statement = connection.prepare("SELECT attempts.idempotency_key, attempts.run_id, attempts.node_key, attempts.provider, attempts.provider_task_id, attempts.status, attempts.payload_json, attempts.updated_at FROM run_attempts attempts JOIN runs ON runs.id = attempts.run_id WHERE runs.status IN ('running', 'interrupted') AND attempts.status IN ('queued', 'running', 'submitted', 'download_failed') AND attempts.provider_task_id IS NOT NULL ORDER BY attempts.updated_at ASC")?;
    let rows = statement.query_map([], |row| Ok(RunAttemptRow {
        idempotency_key: row.get(0)?,
        run_id: row.get(1)?,
        node_key: row.get(2)?,
        provider: row.get(3)?,
        provider_task_id: row.get(4)?,
        status: row.get(5)?,
        payload_json: row.get(6)?,
        updated_at: row.get(7)?,
    }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn save_workflow(path: &Path, id: &str, name: &str, project_id: Option<&str>, definition_json: &str) -> Result<WorkflowRow> {
    initialize(path)?;
    let definition_json = redact_json_payload(definition_json)?;
    let mut definition = serde_json::from_str::<Value>(&definition_json).map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let mut connection = open(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let latest_revision: i64 = transaction.query_row("SELECT COALESCE(MAX(revision), 0) FROM workflow_revisions WHERE workflow_id=?1", [id], |row| row.get(0))?;
    let requested_revision = definition.get("revision").and_then(Value::as_i64).filter(|revision| *revision > 0);
    let revision = std::cmp::max(latest_revision + 1, requested_revision.unwrap_or(1));
    if let Some(object) = definition.as_object_mut() { object.insert("revision".to_string(), Value::from(revision)); }
    let definition_json = serde_json::to_string(&definition).map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    let hash = format!("{:x}", sha2::Sha256::digest(definition_json.as_bytes()));
    transaction.execute("INSERT INTO workflows(id, project_id, name, definition_json) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, name=excluded.name, definition_json=excluded.definition_json, updated_at=CURRENT_TIMESTAMP", params![id, project_id, name, definition_json])?;
    let revision_id = format!("{id}:revision:{revision}");
    transaction.execute("INSERT INTO workflow_revisions(id, workflow_id, revision, definition_json, definition_hash) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(workflow_id, revision) DO UPDATE SET definition_json=excluded.definition_json, definition_hash=excluded.definition_hash", params![revision_id, id, revision, definition_json, hash])?;
    let workflow = transaction.query_row("SELECT id, project_id, name, definition_json, updated_at FROM workflows WHERE id=?1", [id], |row| Ok(WorkflowRow { id: row.get(0)?, project_id: row.get(1)?, name: row.get(2)?, definition_json: row.get(3)?, updated_at: row.get(4)? }))?;
    transaction.commit()?;
    Ok(workflow)
}

pub fn list_workflows(path: &Path) -> Result<Vec<WorkflowRow>> {
    initialize(path)?;
    let connection = open(path)?;
    let mut statement = connection.prepare("SELECT id, project_id, name, definition_json, updated_at FROM workflows ORDER BY updated_at DESC")?;
    let rows = statement.query_map([], |row| Ok(WorkflowRow { id: row.get(0)?, project_id: row.get(1)?, name: row.get(2)?, definition_json: row.get(3)?, updated_at: row.get(4)? }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn apply_workflow_ai_operation(
    path: &Path,
    workflow_id: &str,
    expected_revision: i64,
    definition_json: &str,
    operation_group: &WorkflowAiOperationGroupWrite,
) -> std::result::Result<WorkflowRow, WorkflowAiStorageError> {
    initialize(path)?;
    if operation_group.workflow_id != workflow_id {
        return Err(WorkflowAiStorageError::InvalidOperation("workflow_id_mismatch".to_string()));
    }
    if operation_group.base_revision != expected_revision {
        return Err(WorkflowAiStorageError::InvalidOperation("base_revision_mismatch".to_string()));
    }
    if operation_group.status != "applied" && operation_group.status != "rolled_back" {
        return Err(WorkflowAiStorageError::InvalidOperation("status_must_create_revision".to_string()));
    }
    let definition_json = redact_json_payload(definition_json)?;
    let commands_json = redact_json_payload(&operation_group.commands_json)?;
    let definition: Value = serde_json::from_str(&definition_json)
        .map_err(|error| WorkflowAiStorageError::InvalidOperation(format!("definition_json:{error}")))?;
    let mut connection = open(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let actual_revision: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(revisions.revision), 0) FROM workflows LEFT JOIN workflow_revisions revisions ON revisions.workflow_id=workflows.id WHERE workflows.id=?1 GROUP BY workflows.id",
        [workflow_id],
        |row| row.get(0),
    )?;
    if actual_revision != expected_revision {
        return Err(WorkflowAiStorageError::RevisionConflict { expected: expected_revision, actual: actual_revision });
    }
    let result_revision = actual_revision + 1;
    if operation_group.result_revision != Some(result_revision) {
        return Err(WorkflowAiStorageError::InvalidOperation("result_revision_mismatch".to_string()));
    }
    if definition.get("revision").and_then(Value::as_i64) != Some(result_revision) {
        return Err(WorkflowAiStorageError::InvalidOperation("definition_revision_mismatch".to_string()));
    }

    let definition_hash = format!("{:x}", sha2::Sha256::digest(definition_json.as_bytes()));
    let revision_id = format!("{workflow_id}:revision:{result_revision}");
    transaction.execute(
        "UPDATE workflows SET definition_json=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![workflow_id, definition_json],
    )?;
    transaction.execute(
        "INSERT INTO workflow_revisions(id, workflow_id, revision, definition_json, definition_hash) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![revision_id, workflow_id, result_revision, definition_json, definition_hash],
    )?;
    transaction.execute(
        "INSERT INTO workflow_ai_operation_groups(workflow_id, id, conversation_id, base_revision, result_revision, commands_json, status, summary, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![workflow_id, operation_group.id, operation_group.conversation_id, operation_group.base_revision, operation_group.result_revision, commands_json, operation_group.status, operation_group.summary, operation_group.created_at],
    )?;
    let workflow = transaction.query_row(
        "SELECT id, project_id, name, definition_json, updated_at FROM workflows WHERE id=?1",
        [workflow_id],
        |row| Ok(WorkflowRow { id: row.get(0)?, project_id: row.get(1)?, name: row.get(2)?, definition_json: row.get(3)?, updated_at: row.get(4)? }),
    )?;
    transaction.commit()?;
    Ok(workflow)
}

pub fn list_workflow_ai_operation_groups(path: &Path, workflow_id: &str) -> Result<Vec<WorkflowAiOperationGroupRow>> {
    initialize(path)?;
    let connection = open(path)?;
    let mut statement = connection.prepare("SELECT id, conversation_id, workflow_id, base_revision, result_revision, commands_json, status, summary, created_at FROM workflow_ai_operation_groups WHERE workflow_id=?1 ORDER BY result_revision ASC, created_at ASC, id ASC")?;
    let rows = statement.query_map([workflow_id], |row| Ok(WorkflowAiOperationGroupRow {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        workflow_id: row.get(2)?,
        base_revision: row.get(3)?,
        result_revision: row.get(4)?,
        commands_json: row.get(5)?,
        status: row.get(6)?,
        summary: row.get(7)?,
        created_at: row.get(8)?,
    }))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn remove_workflow(path: &Path, workflow_id: &str) -> Result<()> {
    initialize(path)?;
    let mut connection = open(path)?;
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM workflow_ai_operation_groups WHERE workflow_id=?1", [workflow_id])?;
    transaction.execute("DELETE FROM workflow_revisions WHERE workflow_id=?1", [workflow_id])?;
    transaction.execute("DELETE FROM workflows WHERE id=?1", [workflow_id])?;
    transaction.commit()?;
    Ok(())
}

pub fn usage_summary(path: &Path) -> Result<UsageSummary> {
    initialize(path)?;
    let connection = open(path)?;
    let runs: i64 = connection.query_row("SELECT COUNT(*) FROM runs", [], |row| row.get(0))?;
    let (input_tokens, output_tokens, provider_cost, estimated_cost):
        (i64, i64, Option<f64>, Option<f64>) = connection.query_row(
        "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), SUM(provider_cost), SUM(estimated_cost)
         FROM usage_records current
         WHERE (current.aggregation='snapshot' AND current.scope='run' AND current.id=(SELECT MAX(snapshot.id) FROM usage_records snapshot WHERE snapshot.run_id=current.run_id AND snapshot.aggregation='snapshot' AND snapshot.scope='run'))
            OR (NOT EXISTS(SELECT 1 FROM usage_records snapshot WHERE snapshot.run_id=current.run_id AND snapshot.aggregation='snapshot' AND snapshot.scope='run') AND (current.aggregation='delta' OR current.aggregation IS NULL))",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let artifacts: i64 = connection.query_row("SELECT COUNT(*) FROM artifacts", [], |row| row.get(0))?;
    Ok(UsageSummary { runs, input_tokens, output_tokens, provider_cost, estimated_cost, artifacts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn finds_unregistered_local_artifacts_from_persisted_artifact_events() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-artifact-reconcile-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_run(&path, "run-ppt", None, Some("local")).unwrap();
        append_run_event(&path, "run-ppt", 1, "artifact", r#"{"event":"artifact","artifact":{"id":"run-ppt:exports/deck.pptx","relativePath":"exports/deck.pptx","mimeType":"application/vnd.openxmlformats-officedocument.presentationml.presentation"}}"#).unwrap();
        append_run_event(&path, "run-ppt", 2, "artifact", r#"{"event":"artifact","artifact":{"relativePath":"../outside.pptx","mimeType":"application/vnd.openxmlformats-officedocument.presentationml.presentation"}}"#).unwrap();
        append_run_event(&path, "run-ppt", 3, "text_delta", r#"{"event":"text_delta","delta":"deck.pptx"}"#).unwrap();

        let candidates = artifact_reconciliation_candidates(&path).unwrap();

        assert_eq!(candidates, vec![ArtifactReconciliationCandidate {
            id: "run-ppt:exports/deck.pptx".to_string(),
            relative_path: "exports/deck.pptx".to_string(),
            mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation".to_string(),
        }]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn removed_artifacts_are_not_recreated_from_persisted_events() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-artifact-remove-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_run(&path, "run-remove", None, Some("local")).unwrap();
        append_run_event(&path, "run-remove", 1, "artifact", r#"{"event":"artifact","artifact":{"id":"artifact-remove","relativePath":"exports/remove.txt","mimeType":"text/plain"}}"#).unwrap();

        remove_artifact(&path, "artifact-remove").unwrap();

        assert!(artifact_reconciliation_candidates(&path).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn repository_round_trip_is_idempotent() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        let row = create_conversation(&path, "conversation-1", "本地会话", None, Some("executive-brand")).unwrap();
        assert_eq!(row.title, "本地会话");
        assert_eq!(row.agent_id.as_deref(), Some("executive-brand"));
        let parts = r#"[{"id":"message-1:text","type":"text","text":"你好"}]"#;
        let metadata = r#"{"conversationId":"conversation-1","providerId":"deepseek","modelId":"deepseek-v4-flash"}"#;
        append_message(&path, "message-1", "conversation-1", "user", "你好", Some(parts), Some(metadata), Some("2026-08-12T00:00:00Z")).unwrap();
        append_message(&path, "message-1", "conversation-1", "user", "重复不会覆盖", None, None, None).unwrap();
        set_session_id(&path, "conversation-1", "lost-session").unwrap();
        set_session_id(&path, "conversation-1", "recovered-session").unwrap();
        create_run(&path, "run-1", Some("conversation-1"), Some("local-model")).unwrap();
        append_run_event(&path, "run-1", 1, "text_delta", r#"{"text":"你好"}"#).unwrap();
        record_run_node(&path, "run-1", "writer", "succeeded", Some(r#"{"text":"完成"}"#)).unwrap();
        record_run_checkpoint(&path, "run-1", "writer", 2, r#"{"text":"完成"}"#).unwrap();
        record_run_checkpoint(&path, "run-1", "writer", 3, r#"{"text":"最终"}"#).unwrap();
        record_run_attempt(&path, "run-1:media:1", "run-1", "media", Some("openai"), Some("provider-task-1"), "download_failed", Some(r#"{"provider":"openai","status":"download_failed"}"#)).unwrap();
        record_run_attempt(&path, "run-1:terminal:1", "run-1", "terminal", Some("openai"), Some("provider-task-terminal"), "failed", Some(r#"{"provider":"openai","status":"failed"}"#)).unwrap();
        assert_eq!(list_recoverable_attempts(&path).unwrap().len(), 1);
        finish_run(&path, "run-1", "succeeded").unwrap();
        assert_eq!(list_conversations(&path).unwrap().len(), 1);
        assert_eq!(list_conversations(&path).unwrap()[0].opencode_session_id.as_deref(), Some("recovered-session"));
        assert_eq!(list_conversations(&path).unwrap()[0].agent_id.as_deref(), Some("executive-brand"));
        assert_eq!(list_messages(&path, "conversation-1").unwrap()[0].content, "你好");
        assert_eq!(list_messages(&path, "conversation-1").unwrap()[0].parts_json.as_deref(), Some(parts));
        assert_eq!(list_messages(&path, "conversation-1").unwrap()[0].metadata_json.as_deref(), Some(metadata));
        assert_eq!(list_messages(&path, "conversation-1").unwrap()[0].created_at, "2026-08-12T00:00:00Z");
        assert_eq!(list_runs(&path).unwrap().len(), 1);
        let connection = open(&path).unwrap();
        assert_eq!(connection.query_row("SELECT status FROM run_nodes WHERE run_id='run-1' AND node_key='writer'", [], |row| row.get::<_, String>(0)).unwrap(), "succeeded");
        assert_eq!(connection.query_row("SELECT sequence FROM run_checkpoints WHERE run_id='run-1' AND checkpoint_key='writer'", [], |row| row.get::<_, i64>(0)).unwrap(), 3);
        assert_eq!(connection.query_row("SELECT output_json FROM run_checkpoints WHERE run_id='run-1' AND checkpoint_key='writer'", [], |row| row.get::<_, String>(0)).unwrap(), r#"{"text":"最终"}"#);
        assert_eq!(connection.query_row("SELECT provider_task_id FROM run_attempts WHERE idempotency_key='run-1:media:1'", [], |row| row.get::<_, String>(0)).unwrap(), "provider-task-1");
        let detail = inspect_run(&path, "run-1").unwrap();
        assert_eq!(detail.run.status, "succeeded");
        assert!(list_recoverable_attempts(&path).unwrap().is_empty());
        assert_eq!(detail.nodes.iter().find(|node| node.node_key == "writer").and_then(|node| node.output_json.as_deref()), Some(r#"{"text":"完成"}"#));
        assert_eq!(detail.events.len(), 1);
        assert_eq!(detail.events[0].event_type, "text_delta");
        assert!(integrity(&path).unwrap());
        let identity: String = open(&path).unwrap().query_row("SELECT device_id FROM identity WHERE id=1", [], |row| row.get(0)).unwrap();
        assert!(identity.starts_with("local-") && identity.len() > 20);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn messages_with_the_same_timestamp_follow_append_order() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-message-order-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_conversation(&path, "conversation-order", "回合顺序", None, None).unwrap();
        let created_at = Some("2026-08-12T00:00:00Z");
        append_message(&path, "z-user-1", "conversation-order", "user", "问题一", None, None, created_at).unwrap();
        append_message(&path, "a-assistant-1", "conversation-order", "assistant", "回答一", None, None, created_at).unwrap();
        append_message(&path, "z-user-2", "conversation-order", "user", "问题二", None, None, created_at).unwrap();
        append_message(&path, "a-assistant-2", "conversation-order", "assistant", "回答二", None, None, created_at).unwrap();

        let rows = list_messages(&path, "conversation-order").unwrap();

        assert_eq!(rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), ["z-user-1", "a-assistant-1", "z-user-2", "a-assistant-2"]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_readers_and_single_writer_keep_wal_storage_consistent() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-concurrency-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_conversation(&path, "conversation-concurrency", "并发读写", None, None).unwrap();

        let barrier = Arc::new(Barrier::new(5));
        let writer_path = path.clone();
        let writer_barrier = Arc::clone(&barrier);
        let writer = thread::spawn(move || {
            writer_barrier.wait();
            for index in 0..32 {
                append_message(
                    &writer_path,
                    &format!("message-{index}"),
                    "conversation-concurrency",
                    "user",
                    &format!("消息 {index}"),
                    None,
                    None,
                    None,
                )
                .unwrap();
            }
        });

        let readers = (0..4)
            .map(|_| {
                let reader_path = path.clone();
                let reader_barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    reader_barrier.wait();
                    for _ in 0..24 {
                        let rows = list_messages(&reader_path, "conversation-concurrency").unwrap();
                        assert!(rows.len() <= 32);
                    }
                })
            })
            .collect::<Vec<_>>();

        writer.join().unwrap();
        for reader in readers {
            reader.join().unwrap();
        }
        assert_eq!(list_messages(&path, "conversation-concurrency").unwrap().len(), 32);
        assert!(integrity(&path).unwrap());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn paged_messages_return_newest_first_page_and_older_cursor_pages() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-pages-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_conversation(&path, "conversation-pages", "分页会话", None, None).unwrap();
        for index in 0..25 {
            let id = format!("message-{index:02}");
            let created_at = format!("2026-08-12T00:00:{index:02}Z");
            append_message(&path, &id, "conversation-pages", "user", &id, None, None, Some(&created_at)).unwrap();
        }

        let latest = list_messages_page(&path, "conversation-pages", Some(10), None, None).unwrap();
        assert_eq!(latest.first().map(|row| row.id.as_str()), Some("message-15"));
        assert_eq!(latest.last().map(|row| row.id.as_str()), Some("message-24"));
        let older = list_messages_page(&path, "conversation-pages", Some(10), Some(&latest[0].created_at), Some(&latest[0].id)).unwrap();
        assert_eq!(older.first().map(|row| row.id.as_str()), Some("message-05"));
        assert_eq!(older.last().map(|row| row.id.as_str()), Some("message-14"));
        let oldest = list_messages_page(&path, "conversation-pages", Some(10), Some(&older[0].created_at), Some(&older[0].id)).unwrap();
        assert_eq!(oldest.len(), 5);
        assert_eq!(oldest.first().map(|row| row.id.as_str()), Some("message-00"));
        assert_eq!(oldest.last().map(|row| row.id.as_str()), Some("message-04"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn startup_recovery_marks_active_runs_interrupted() {
        let root = std::env::temp_dir().join(format!("coworkany-recovery-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_run(&path, "run-active", None, Some("local")).unwrap();
        record_run_node(&path, "run-active", "writer", "running", None).unwrap();
        assert_eq!(recover_interrupted(&path).unwrap(), 1);
        assert_eq!(open(&path).unwrap().query_row("SELECT status FROM runs WHERE id='run-active'", [], |row| row.get::<_, String>(0)).unwrap(), "interrupted");
        assert_eq!(open(&path).unwrap().query_row("SELECT status FROM run_nodes WHERE run_id='run-active' AND node_key='writer'", [], |row| row.get::<_, String>(0)).unwrap(), "interrupted");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn finishing_a_run_closes_unfinished_nodes_with_the_same_terminal_status() {
        let root = std::env::temp_dir().join(format!("coworkany-node-finish-{}", std::process::id()));
        let path = root.join("app.db");
        let _ = fs::remove_dir_all(&root);
        initialize(&path).unwrap();
        create_run(&path, "run-node-finish", None, Some("model")).unwrap();
        record_run_node(&path, "run-node-finish", "writer", "running", None).unwrap();
        finish_run(&path, "run-node-finish", "cancelled").unwrap();
        let connection = open(&path).unwrap();
        let status: String = connection.query_row("SELECT status FROM run_nodes WHERE run_id='run-node-finish' AND node_key='writer'", [], |row| row.get(0)).unwrap();
        assert_eq!(status, "cancelled");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn workflow_revisions_and_usage_summary_are_persisted() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        let workflow = save_workflow(&path, "wf-1", "内容流水线", None, r#"{"version":1,"nodes":[]}"#).unwrap();
        assert_eq!(workflow.name, "内容流水线");
        save_workflow(&path, "wf-1", "内容流水线 v2", None, r#"{"version":1,"nodes":[{"type":"text_input"}]}"#).unwrap();
        assert_eq!(list_workflows(&path).unwrap().len(), 1);
        let revisions: i64 = open(&path).unwrap().query_row("SELECT COUNT(*) FROM workflow_revisions WHERE workflow_id='wf-1'", [], |row| row.get(0)).unwrap();
        assert_eq!(revisions, 2);
        create_run(&path, "run-1", None, Some("local")).unwrap();
        finish_run(&path, "run-1", "succeeded").unwrap();
        record_usage(&path, "run-1", Some("openai"), "local", Some(3), Some(5), Some(0.08), Some(0.1), Some("run-1:usage")).unwrap();
        let summary = usage_summary(&path).unwrap();
        assert_eq!(summary.runs, 1);
        assert_eq!(summary.input_tokens + summary.output_tokens, 8);
        assert_eq!(summary.provider_cost, Some(0.08));
        assert_eq!(summary.estimated_cost, Some(0.1));
        assert_eq!(open(&path).unwrap().query_row("SELECT provider, provider_cost FROM usage_records WHERE idempotency_key='run-1:usage'", [], |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<f64>>(1)?))).unwrap(), (Some("openai".to_string()), Some(0.08)));
        assert_eq!(summary.artifacts, 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_save_allocates_monotonic_revision_and_rewrites_embedded_revision() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-save-revision-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        let initial = save_workflow(&path, "wf-save-revision", "Workflow", None, r#"{"schemaVersion":2,"revision":2,"definitionHash":"initial","nodes":[],"edges":[]}"#).unwrap();
        assert!(initial.definition_json.contains(r#""revision":2"#));
        let connection = open(&path).unwrap();
        connection.execute("INSERT INTO workflow_revisions(id, workflow_id, revision, definition_json, definition_hash) VALUES ('wf-save-revision:revision:10', 'wf-save-revision', 10, '{\"schemaVersion\":2,\"revision\":10}', 'max10')", []).unwrap();
        drop(connection);
        let saved = save_workflow(&path, "wf-save-revision", "Workflow", None, r#"{"schemaVersion":2,"revision":2,"definitionHash":"stale","nodes":[],"edges":[]}"#).unwrap();
        assert!(saved.definition_json.contains(r#""revision":11"#));
        let revisions: Vec<i64> = open(&path).unwrap().prepare("SELECT revision FROM workflow_revisions WHERE workflow_id='wf-save-revision' ORDER BY revision").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
        assert_eq!(revisions, vec![2, 10, 11]);
        let _ = std::fs::remove_dir_all(root);
    }

    fn workflow_ai_group(workflow_id: &str, id: &str, base_revision: i64, result_revision: i64, status: &str) -> WorkflowAiOperationGroupWrite {
        WorkflowAiOperationGroupWrite {
            id: id.to_string(),
            conversation_id: "conversation-ai".to_string(),
            workflow_id: workflow_id.to_string(),
            base_revision,
            result_revision: Some(result_revision),
            commands_json: r#"[{"type":"update_node","nodeKey":"writer","patch":{"title":"Updated"}}]"#.to_string(),
            status: status.to_string(),
            summary: "Updated the writer node".to_string(),
            created_at: "2026-09-21T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn workflow_ai_operation_creates_one_revision_and_one_group_atomically() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-ai-apply-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        save_workflow(&path, "wf-ai", "AI workflow", None, r#"{"schemaVersion":2,"revision":1,"definitionHash":"initial","nodes":[],"edges":[]}"#).unwrap();
        let group = workflow_ai_group("wf-ai", "group-1", 1, 2, "applied");

        let workflow = apply_workflow_ai_operation(
            &path,
            "wf-ai",
            1,
            r#"{"schemaVersion":2,"revision":2,"definitionHash":"next","nodes":[],"edges":[]}"#,
            &group,
        ).unwrap();

        assert!(workflow.definition_json.contains(r#""revision":2"#));
        let connection = open(&path).unwrap();
        let revisions: i64 = connection.query_row("SELECT COUNT(*) FROM workflow_revisions WHERE workflow_id='wf-ai'", [], |row| row.get(0)).unwrap();
        let groups: i64 = connection.query_row("SELECT COUNT(*) FROM workflow_ai_operation_groups WHERE workflow_id='wf-ai'", [], |row| row.get(0)).unwrap();
        assert_eq!((revisions, groups), (2, 1));
        assert_eq!(list_workflow_ai_operation_groups(&path, "wf-ai").unwrap()[0].id, "group-1");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn workflow_ai_operation_rejects_a_stale_revision_without_overwriting_definition() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-ai-conflict-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        save_workflow(&path, "wf-ai-conflict", "AI workflow", None, r#"{"schemaVersion":2,"revision":1,"definitionHash":"initial","nodes":[],"edges":[]}"#).unwrap();
        let applied = workflow_ai_group("wf-ai-conflict", "group-applied", 1, 2, "applied");
        apply_workflow_ai_operation(&path, "wf-ai-conflict", 1, r#"{"schemaVersion":2,"revision":2,"definitionHash":"applied","nodes":[],"edges":[]}"#, &applied).unwrap();
        let stale = workflow_ai_group("wf-ai-conflict", "group-stale", 1, 2, "applied");

        let error = apply_workflow_ai_operation(&path, "wf-ai-conflict", 1, r#"{"schemaVersion":2,"revision":2,"definitionHash":"stale","nodes":[],"edges":[]}"#, &stale).unwrap_err();

        assert_eq!(error.to_string(), "workflow_ai_revision_conflict:expected=1:actual=2");
        let stored = list_workflows(&path).unwrap().into_iter().find(|workflow| workflow.id == "wf-ai-conflict").unwrap();
        assert!(stored.definition_json.contains("applied"));
        assert!(!stored.definition_json.contains("stale"));
        assert_eq!(list_workflow_ai_operation_groups(&path, "wf-ai-conflict").unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn workflow_ai_operation_persists_rolled_back_groups() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-ai-rollback-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        save_workflow(&path, "wf-ai-rollback", "AI workflow", None, r#"{"schemaVersion":2,"revision":1,"definitionHash":"initial","nodes":[],"edges":[]}"#).unwrap();
        let group = workflow_ai_group("wf-ai-rollback", "group-rollback", 1, 2, "rolled_back");

        apply_workflow_ai_operation(&path, "wf-ai-rollback", 1, r#"{"schemaVersion":2,"revision":2,"definitionHash":"rollback","nodes":[],"edges":[]}"#, &group).unwrap();

        let groups = list_workflow_ai_operation_groups(&path, "wf-ai-rollback").unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].status, "rolled_back");
        assert_eq!(groups[0].result_revision, Some(2));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn removing_workflow_also_removes_its_revisions_and_ai_operation_groups() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-remove-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        save_workflow(&path, "wf-remove", "待删除工作流", None, r#"{"version":1,"nodes":[]}"#).unwrap();
        save_workflow(&path, "wf-remove", "待删除工作流", None, r#"{"version":1,"nodes":[{"type":"text_input"}]}"#).unwrap();
        let group = workflow_ai_group("wf-remove", "group-remove", 2, 3, "applied");
        apply_workflow_ai_operation(&path, "wf-remove", 2, r#"{"schemaVersion":2,"revision":3,"definitionHash":"remove","nodes":[],"edges":[]}"#, &group).unwrap();

        remove_workflow(&path, "wf-remove").unwrap();

        assert!(list_workflows(&path).unwrap().is_empty());
        let revisions: i64 = open(&path).unwrap().query_row("SELECT COUNT(*) FROM workflow_revisions WHERE workflow_id='wf-remove'", [], |row| row.get(0)).unwrap();
        assert_eq!(revisions, 0);
        let groups: i64 = open(&path).unwrap().query_row("SELECT COUNT(*) FROM workflow_ai_operation_groups WHERE workflow_id='wf-remove'", [], |row| row.get(0)).unwrap();
        assert_eq!(groups, 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn upgrades_legacy_usage_records_with_provider_cost_columns() {
        let root = std::env::temp_dir().join(format!("coworkany-usage-migration-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        std::fs::create_dir_all(&root).unwrap();
        let legacy = Connection::open(&path).unwrap();
        legacy.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO schema_migrations(version) VALUES (1), (2); CREATE TABLE usage_records(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, estimated_cost REAL, idempotency_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);").unwrap();
        drop(legacy);
        initialize(&path).unwrap();
        let connection = open(&path).unwrap();
        let columns: Vec<String> = connection.prepare("PRAGMA table_info(usage_records)").unwrap().query_map([], |row| row.get(1)).unwrap().collect::<Result<_, _>>().unwrap();
        assert!(columns.iter().any(|column| column == "provider"));
        assert!(columns.iter().any(|column| column == "provider_cost"));
        assert!(migrations_ready(&path).unwrap());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn upgrades_blob_workflow_definitions_to_text() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-blob-migration-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        initialize(&path).unwrap();
        let connection = open(&path).unwrap();
        let definition = br#"{\"version\":1,\"nodes\":[]}"#.to_vec();
        connection.execute("INSERT INTO workflows(id, name, definition_json) VALUES (?1, ?2, ?3)", params!["workflow-blob", "Legacy workflow", definition.clone()]).unwrap();
        connection.execute("INSERT INTO workflow_revisions(id, workflow_id, revision, definition_json, definition_hash) VALUES (?1, ?2, ?3, ?4, ?5)", params!["workflow-blob:revision:1", "workflow-blob", 1, definition, "legacy-hash"]).unwrap();
        drop(connection);

        let workflows = list_workflows(&path).unwrap();

        assert_eq!(workflows.len(), 1);
        assert_eq!(workflows[0].definition_json, r#"{\"version\":1,\"nodes\":[]}"#);
        let connection = open(&path).unwrap();
        for (table, column) in [("workflows", "definition_json"), ("workflow_revisions", "definition_json")] {
            let sql = format!("SELECT typeof({column}) FROM {table}");
            assert_eq!(connection.query_row(&sql, [], |row| row.get::<_, String>(0)).unwrap(), "text");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn usage_summary_keeps_an_unknown_cost_unknown() {
        let root = std::env::temp_dir().join(format!("coworkany-usage-unknown-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_run(&path, "run-unknown", None, Some("local")).unwrap();
        record_usage(&path, "run-unknown", Some("openai"), "local", Some(3), Some(5), None, None, Some("run-unknown:usage")).unwrap();
        let summary = usage_summary(&path).unwrap();
        assert_eq!(summary.provider_cost, None);
        assert_eq!(summary.estimated_cost, None);
        assert_eq!(summary.input_tokens + summary.output_tokens, 8);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn run_metrics_deduplicate_lifecycle_events_and_keep_real_retries() {
        let root =
            std::env::temp_dir().join(format!("coworkany-run-metrics-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_run(&path, "run-metrics", None, Some("model-a")).unwrap();
        record_run_invocation(
            &path,
            "run-metrics",
            "tool-1",
            "model_tool",
            "read",
            "running",
            1,
            Some("2026-09-29T00:00:00Z"),
            None,
        )
        .unwrap();
        record_run_invocation(
            &path,
            "run-metrics",
            "tool-1",
            "model_tool",
            "read",
            "completed",
            1,
            Some("2026-09-29T00:00:00Z"),
            Some("2026-09-29T00:00:01Z"),
        )
        .unwrap();
        record_run_invocation(
            &path,
            "run-metrics",
            "tool-1",
            "model_tool",
            "read",
            "running",
            1,
            None,
            None,
        )
        .unwrap();
        record_run_invocation(
            &path,
            "run-metrics",
            "image",
            "capability",
            "image_generate",
            "failed",
            1,
            None,
            Some("2026-09-29T00:00:02Z"),
        )
        .unwrap();
        record_run_invocation(
            &path,
            "run-metrics",
            "image",
            "capability",
            "image_generate",
            "completed",
            2,
            None,
            Some("2026-09-29T00:00:03Z"),
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-metrics",
            "step-1",
            Some("provider-a"),
            "model-a",
            Some(10),
            Some(4),
            Some(2),
            None,
            Some(0.01),
            None,
            "delta",
            "step",
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-metrics",
            "step-1",
            Some("provider-a"),
            "model-a",
            Some(10),
            Some(4),
            Some(2),
            None,
            Some(0.01),
            None,
            "delta",
            "step",
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-metrics",
            "step-2",
            Some("provider-a"),
            "model-a",
            Some(8),
            Some(3),
            None,
            Some(1),
            Some(0.02),
            None,
            "delta",
            "step",
        )
        .unwrap();
        let metrics = get_run_metrics(&path, "run-metrics").unwrap();
        assert_eq!(metrics.model_tools.total, 1);
        assert_eq!(metrics.model_tools.completed, 1);
        assert_eq!(metrics.capabilities.total, 2);
        assert_eq!(metrics.capabilities.failed, 1);
        assert_eq!(metrics.capabilities.completed, 1);
        assert_eq!(metrics.input_tokens, Some(18));
        assert_eq!(metrics.output_tokens, Some(7));
        assert_eq!(metrics.cached_input_tokens, Some(2));
        assert_eq!(metrics.reasoning_tokens, Some(1));
        assert_eq!(metrics.provider_cost, Some(0.03));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn run_metrics_prefer_latest_run_snapshot_over_step_deltas() {
        let root = std::env::temp_dir().join(format!(
            "coworkany-run-metrics-snapshot-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_run(&path, "run-snapshot", None, Some("model-a")).unwrap();
        record_usage_detailed(
            &path,
            "run-snapshot",
            "step-1",
            Some("provider-a"),
            "model-a",
            Some(10),
            Some(4),
            None,
            None,
            None,
            None,
            "delta",
            "step",
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-snapshot",
            "step-2",
            Some("provider-a"),
            "model-a",
            Some(8),
            Some(3),
            None,
            None,
            None,
            None,
            "delta",
            "step",
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-snapshot",
            "final",
            Some("provider-a"),
            "model-a",
            Some(18),
            Some(7),
            Some(2),
            Some(1),
            Some(0.05),
            None,
            "snapshot",
            "run",
        )
        .unwrap();
        let metrics = get_run_metrics(&path, "run-snapshot").unwrap();
        assert_eq!(metrics.input_tokens, Some(18));
        assert_eq!(metrics.output_tokens, Some(7));
        assert_eq!(metrics.provider_cost, Some(0.05));
        let summary = usage_summary(&path).unwrap();
        assert_eq!(summary.input_tokens, 18);
        assert_eq!(summary.output_tokens, 7);
        assert_eq!(summary.provider_cost, Some(0.05));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn migrated_usage_without_aggregation_semantics_stays_partial() {
        let root = std::env::temp_dir().join(format!(
            "coworkany-run-metrics-legacy-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("app.db");
        let connection = open(&path).unwrap();
        connection.execute_batch("CREATE TABLE runs (id TEXT PRIMARY KEY, conversation_id TEXT, status TEXT NOT NULL, model TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT); CREATE TABLE usage_records (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT REFERENCES runs(id), model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, estimated_cost REAL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO runs(id, status, model) VALUES ('run-legacy', 'succeeded', 'legacy-model'); INSERT INTO usage_records(run_id, model, input_tokens, output_tokens) VALUES ('run-legacy', 'legacy-model', 4, 2);").unwrap();
        drop(connection);
        initialize(&path).unwrap();
        assert_eq!(
            get_run_metrics(&path, "run-legacy").unwrap().completeness,
            "partial"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn metrics_query_filters_source_and_paginates_without_changing_overview() {
        let root =
            std::env::temp_dir().join(format!("coworkany-metrics-query-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_run_with_context(
            &path,
            "run-new-1",
            None,
            Some("model-a"),
            Some("conversation"),
            None,
        )
        .unwrap();
        create_run_with_context(
            &path,
            "run-new-2",
            None,
            Some("model-a"),
            Some("conversation"),
            None,
        )
        .unwrap();
        create_run_with_context(
            &path,
            "run-media",
            None,
            Some("model-b"),
            Some("media"),
            None,
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-new-1",
            "u1",
            Some("provider-a"),
            "model-a",
            Some(5),
            Some(2),
            None,
            None,
            None,
            None,
            "delta",
            "step",
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-new-2",
            "u2",
            Some("provider-a"),
            "model-a",
            Some(7),
            Some(3),
            None,
            None,
            None,
            None,
            "delta",
            "step",
        )
        .unwrap();
        record_usage_detailed(
            &path,
            "run-media",
            "u3",
            Some("provider-b"),
            "model-b",
            Some(100),
            Some(20),
            None,
            None,
            None,
            None,
            "delta",
            "step",
        )
        .unwrap();
        let first = query_metrics(
            &path,
            &MetricsQueryFilters {
                range: "all".into(),
                model: None,
                provider: Some("provider-a".into()),
                source: Some("conversation".into()),
                query: None,
                run_id: None,
                cursor: None,
                limit: Some(1),
            },
        )
        .unwrap();
        assert_eq!(first.overview.tokens, 17);
        assert_eq!(first.runs.len(), 1);
        let second = query_metrics(
            &path,
            &MetricsQueryFilters {
                range: "all".into(),
                model: None,
                provider: Some("provider-a".into()),
                source: Some("conversation".into()),
                query: None,
                run_id: None,
                cursor: first.next_cursor.clone(),
                limit: Some(1),
            },
        )
        .unwrap();
        assert_eq!(second.overview.tokens, first.overview.tokens);
        assert_eq!(second.runs.len(), 1);
        assert_ne!(second.runs[0].run_id, first.runs[0].run_id);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn structured_json_storage_redacts_credentials_without_losing_usage_fields() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-redaction-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        let fixture_value = "fixture-value-must-not-reach-sqlite";
        let payload = format!(r#"{{"provider":{{"apiKey":"{fixture_value}","access_token":"{fixture_value}"}},"usage":{{"input_tokens":7,"output_tokens":11}},"nested":[{{"privateKey":"{fixture_value}"}}]}}"#);
        create_run(&path, "run-redaction", None, Some("provider/model")).unwrap();
        append_run_event(&path, "run-redaction", 1, "provider_result", &payload).unwrap();
        record_run_node(&path, "run-redaction", "writer", "succeeded", Some(&payload)).unwrap();
        record_run_checkpoint(&path, "run-redaction", "writer", 1, &payload).unwrap();
        record_run_attempt(&path, "run-redaction:attempt", "run-redaction", "writer", Some("provider"), None, "failed", Some(&payload)).unwrap();
        save_workflow(&path, "workflow-redaction", "Safe workflow", None, &format!(r#"{{"version":1,"provider":{{"apiKey":"{fixture_value}"}},"nodes":[]}}"#)).unwrap();

        let connection = open(&path).unwrap();
        for (table, column) in [("run_events", "payload_json"), ("run_nodes", "output_json"), ("run_checkpoints", "output_json"), ("run_attempts", "payload_json"), ("workflows", "definition_json")] {
            let sql = format!("SELECT COALESCE({column}, '') FROM {table}");
            let values = connection.prepare(&sql).unwrap().query_map([], |row| row.get::<_, String>(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
            assert!(values.iter().all(|value| !value.contains(fixture_value)), "credential leaked into {table}.{column}");
            assert!(values.iter().any(|value| value.contains(REDACTED)), "redaction marker missing in {table}.{column}");
        }
        let event: String = connection.query_row("SELECT payload_json FROM run_events WHERE run_id='run-redaction'", [], |row| row.get(0)).unwrap();
        assert!(event.contains(r#""input_tokens":7"#));
        assert!(event.contains(r#""output_tokens":11"#));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn workflow_storage_keeps_graph_identity_keys_while_redacting_credentials() {
        let root = std::env::temp_dir().join(format!("coworkany-workflow-identity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        let definition = r#"{"nodes":[{"nodeKey":"avatar-image","config":{"apiKey":"secret"}}],"edges":[{"edgeKey":"avatar-to-human","sourceNodeKey":"avatar-image","targetNodeKey":"digital-human"}]}"#;

        save_workflow(&path, "workflow-identity", "Identity", None, definition).unwrap();

        let stored: String = open(&path).unwrap().query_row("SELECT definition_json FROM workflows WHERE id='workflow-identity'", [], |row| row.get(0)).unwrap();
        assert!(stored.contains("avatar-image"));
        assert!(stored.contains("avatar-to-human"));
        assert!(!stored.contains("\"apiKey\":\"secret\""));
        assert!(stored.contains(REDACTED));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn restores_a_corrupt_database_from_the_latest_consistent_backup() {
        let root = std::env::temp_dir().join(format!("coworkany-storage-backup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let path = root.join("app.db");
        create_conversation(&path, "conversation-backup", "恢复会话", None, None).unwrap();
        create_consistent_backup(&path).unwrap();

        std::fs::write(sibling_path(&path, "-wal"), b"stale WAL sidecar").unwrap();
        std::fs::write(&path, b"not a SQLite database").unwrap();
        initialize(&path).unwrap();

        assert_eq!(list_conversations(&path).unwrap().len(), 1);
        assert!(integrity(&path).unwrap());
        assert!(!sibling_path(&path, "-wal").exists());
        assert!(root.read_dir().unwrap().filter_map(Result::ok).any(|entry| entry.file_name().to_string_lossy().contains("corrupt")));
        let _ = std::fs::remove_dir_all(root);
    }
}
