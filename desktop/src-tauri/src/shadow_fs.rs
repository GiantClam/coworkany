//! CoworkAny Desktop - Shadow File System
//!
//! Implements a staging area for file modifications.
//! All agent file writes go to shadow first, then user reviews diff,
//! then atomic apply to real filesystem.
//!
//! Flow: Agent write → Shadow FS → Diff preview → User approve → Atomic write

use crate::diff::{compute_unified_diff, FilePatch, PatchOperation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use thiserror::Error;
use tracing::{debug, info, warn};
use uuid::Uuid;

// ============================================================================
// Error Types
// ============================================================================

#[derive(Error, Debug)]
pub enum ShadowFsError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Shadow file not found: {0}")]
    NotFound(String),

    #[error("Conflict detected: file changed since shadow was created")]
    Conflict {
        expected_hash: String,
        actual_hash: String,
    },

    #[error("Shadow directory not initialized")]
    #[allow(dead_code)]
    NotInitialized,

    #[error("Target already exists: {0}")]
    TargetExists(String),

    #[error("Failed to serialize: {0}")]
    Serialize(#[from] serde_json::Error),
}

// ============================================================================
// Types
// ============================================================================

/// Status of a shadow file
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShadowStatus {
    Pending,
    Approved,
    Rejected,
    Applied,
    Conflict,
}

/// A file staged in the shadow filesystem
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShadowFileEntry {
    pub id: String,
    pub original_path: PathBuf,
    pub original_exists: bool,
    pub original_hash: Option<String>,
    pub shadow_path: PathBuf,
    pub shadow_hash: String,
    pub status: ShadowStatus,
    pub created_at: String,
    pub reviewed_at: Option<String>,
    pub patch: Option<FilePatch>,
}

/// Result of applying a shadow file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyResult {
    pub success: bool,
    pub file_path: String,
    pub backup_path: Option<String>,
    pub error: Option<String>,
}

// ============================================================================
// Shadow FS
// ============================================================================

pub struct ShadowFs {
    /// Root directory for shadow files (e.g., .coworkany/shadow/)
    shadow_root: PathBuf,
    /// Root directory for trashed files
    trash_root: PathBuf,
    /// Workspace root (for relative path calculation)
    workspace_root: PathBuf,
    /// In-memory index of shadow files
    files: HashMap<String, ShadowFileEntry>,
    /// Path to index file
    index_path: PathBuf,
    /// Path to audit log file
    audit_path: PathBuf,
}

impl ShadowFs {
    /// Create a new ShadowFs instance
    pub fn new(workspace_root: PathBuf) -> Result<Self, ShadowFsError> {
        let shadow_root = workspace_root.join(".coworkany").join("shadow");
        let trash_root = workspace_root.join(".coworkany").join("trash");
        let index_path = shadow_root.join("index.json");
        let audit_path = workspace_root.join(".coworkany").join("audit-shadow.jsonl");

        // Create shadow directory if it doesn't exist
        fs::create_dir_all(&shadow_root)?;
        fs::create_dir_all(&trash_root)?;

        // Load existing index
        let files = if index_path.exists() {
            let content = fs::read_to_string(&index_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

        Ok(Self {
            shadow_root,
            trash_root,
            workspace_root,
            files,
            index_path,
            audit_path,
        })
    }

    /// Stage a file modification
    pub fn stage_file(
        &mut self,
        original_path: &Path,
        new_content: &str,
    ) -> Result<ShadowFileEntry, ShadowFsError> {
        self.stage_file_with_patch(original_path, new_content, None)
    }

    /// Stage a file modification with an explicit patch override.
    pub fn stage_file_with_patch(
        &mut self,
        original_path: &Path,
        new_content: &str,
        patch_override: Option<FilePatch>,
    ) -> Result<ShadowFileEntry, ShadowFsError> {
        let id = Uuid::new_v4().to_string();

        // Read original if it exists
        let (original_exists, original_content, original_hash) = if original_path.exists() {
            let content = fs::read_to_string(original_path)?;
            let hash = compute_hash(&content);
            (true, content, Some(hash))
        } else {
            (false, String::new(), None)
        };

        // Write to shadow location
        let shadow_path = self.shadow_root.join(&id);
        fs::write(&shadow_path, new_content)?;
        let shadow_hash = compute_hash(new_content);

        let patch = match patch_override {
            Some(mut patch) => {
                patch.id = id.clone();
                Some(patch)
            }
            None => {
                // Compute diff
                let relative_path = original_path
                    .strip_prefix(&self.workspace_root)
                    .unwrap_or(original_path)
                    .to_string_lossy()
                    .to_string();
                Some(compute_unified_diff(&original_content, new_content, &relative_path, 3))
            }
        };

        let entry = ShadowFileEntry {
            id: id.clone(),
            original_path: original_path.to_path_buf(),
            original_exists,
            original_hash,
            shadow_path,
            shadow_hash,
            status: ShadowStatus::Pending,
            created_at: chrono::Utc::now().to_rfc3339(),
            reviewed_at: None,
            patch,
        };

        self.files.insert(id, entry.clone());
        self.save_index()?;

        info!("Staged file: {:?}", original_path);
        Ok(entry)
    }

    /// Get a shadow file entry
    pub fn get(&self, id: &str) -> Option<&ShadowFileEntry> {
        self.files.get(id)
    }

    /// List all pending shadow files
    pub fn list_pending(&self) -> Vec<&ShadowFileEntry> {
        self.files
            .values()
            .filter(|e| e.status == ShadowStatus::Pending)
            .collect()
    }

    /// Approve a shadow file for application
    pub fn approve(&mut self, id: &str) -> Result<&ShadowFileEntry, ShadowFsError> {
        let entry = self
            .files
            .get_mut(id)
            .ok_or_else(|| ShadowFsError::NotFound(id.to_string()))?;

        entry.status = ShadowStatus::Approved;
        entry.reviewed_at = Some(chrono::Utc::now().to_rfc3339());

        self.save_index()?;
        Ok(self.files.get(id).unwrap())
    }

    /// Reject a shadow file
    pub fn reject(&mut self, id: &str) -> Result<(), ShadowFsError> {
        let entry = self
            .files
            .get_mut(id)
            .ok_or_else(|| ShadowFsError::NotFound(id.to_string()))?;

        entry.status = ShadowStatus::Rejected;
        entry.reviewed_at = Some(chrono::Utc::now().to_rfc3339());

        // Clean up shadow file
        if entry.shadow_path.exists() {
            fs::remove_file(&entry.shadow_path)?;
        }

        self.save_index()?;
        Ok(())
    }

    /// Apply an approved shadow file to the real filesystem
    pub fn apply(&mut self, id: &str, create_backup: bool) -> Result<ApplyResult, ShadowFsError> {
        let entry = self
            .files
            .get(id)
            .ok_or_else(|| ShadowFsError::NotFound(id.to_string()))?
            .clone();

        if entry.status != ShadowStatus::Approved {
            return Ok(ApplyResult {
                success: false,
                file_path: entry.original_path.to_string_lossy().to_string(),
                backup_path: None,
                error: Some("File not approved".to_string()),
            });
        }

        // Check for conflicts
        if entry.original_exists {
            if let Some(ref expected_hash) = entry.original_hash {
                let current_content = fs::read_to_string(&entry.original_path)?;
                let current_hash = compute_hash(&current_content);

                if &current_hash != expected_hash {
                    // Mark as conflict
                    if let Some(e) = self.files.get_mut(id) {
                        e.status = ShadowStatus::Conflict;
                    }
                    self.save_index()?;

                    return Err(ShadowFsError::Conflict {
                        expected_hash: expected_hash.clone(),
                        actual_hash: current_hash,
                    });
                }
            }
        }

        let patch = entry.patch.clone();
        let target_path = patch
            .as_ref()
            .and_then(|p| p.new_file_path.clone())
            .unwrap_or_else(|| entry.original_path.to_string_lossy().to_string());
        let target_path = PathBuf::from(target_path);

        let original_exists = entry.original_path.exists();

        // Create backup if requested
        let backup_path = if create_backup && original_exists {
            let backup = entry.original_path.with_extension("bak");
            fs::copy(&entry.original_path, &backup)?;
            Some(backup.to_string_lossy().to_string())
        } else {
            None
        };

        match patch.as_ref().map(|p| &p.operation) {
            Some(PatchOperation::Delete) => {
                if entry.original_path.exists() {
                    let trashed_path = self.build_trash_path(&entry.original_path, &entry.id);
                    if let Some(parent) = trashed_path.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    if let Err(err) = fs::rename(&entry.original_path, &trashed_path) {
                        // Fallback to copy+remove
                        fs::copy(&entry.original_path, &trashed_path)?;
                        fs::remove_file(&entry.original_path)?;
                        debug!("Trash rename failed, copied instead: {}", err);
                    }
                    self.audit("delete", &entry, Some(&trashed_path));
                }
            }
            Some(PatchOperation::Rename) => {
                if entry.original_path.exists() {
                    if target_path.exists() && target_path != entry.original_path {
                        return Err(ShadowFsError::TargetExists(
                            target_path.to_string_lossy().to_string(),
                        ));
                    }
                    if let Some(parent) = target_path.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::rename(&entry.original_path, &target_path)?;
                }

                let shadow_content = fs::read_to_string(&entry.shadow_path)?;
                fs::write(&target_path, shadow_content)?;
                self.audit("rename", &entry, Some(&target_path));
            }
            _ => {
                let shadow_content = fs::read_to_string(&entry.shadow_path)?;
                if let Some(parent) = entry.original_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&entry.original_path, shadow_content)?;
                self.audit("apply", &entry, Some(&entry.original_path));
            }
        }

        // Update status
        if let Some(e) = self.files.get_mut(id) {
            e.status = ShadowStatus::Applied;
            if let Some(PatchOperation::Rename) = patch.as_ref().map(|p| &p.operation) {
                e.original_path = target_path.clone();
            }
        }

        // Clean up shadow file
        if entry.shadow_path.exists() {
            fs::remove_file(&entry.shadow_path)?;
        }

        self.save_index()?;

        info!("Applied shadow file: {:?}", target_path);

        Ok(ApplyResult {
            success: true,
            file_path: target_path.to_string_lossy().to_string(),
            backup_path,
            error: None,
        })
    }

    /// Rollback an applied change using backup
    #[allow(dead_code)]
    pub fn rollback(&mut self, id: &str) -> Result<(), ShadowFsError> {
        let entry = self
            .files
            .get(id)
            .ok_or_else(|| ShadowFsError::NotFound(id.to_string()))?;

        let backup_path = entry.original_path.with_extension("bak");
        if backup_path.exists() {
            fs::copy(&backup_path, &entry.original_path)?;
            fs::remove_file(&backup_path)?;
            info!("Rolled back: {:?}", entry.original_path);
        } else {
            warn!("No backup found for rollback: {:?}", entry.original_path);
        }

        Ok(())
    }

    /// Clean up old shadow files
    #[allow(dead_code)]
    pub fn cleanup(&mut self, max_age_hours: u64) -> Result<usize, ShadowFsError> {
        let now = chrono::Utc::now();
        let mut removed = 0;

        let to_remove: Vec<String> = self
            .files
            .iter()
            .filter(|(_, entry)| {
                if let Ok(created) = chrono::DateTime::parse_from_rfc3339(&entry.created_at) {
                    let age = now.signed_duration_since(created);
                    age.num_hours() as u64 > max_age_hours
                        && (entry.status == ShadowStatus::Applied
                            || entry.status == ShadowStatus::Rejected)
                } else {
                    false
                }
            })
            .map(|(id, _)| id.clone())
            .collect();

        for id in to_remove {
            if let Some(entry) = self.files.remove(&id) {
                if entry.shadow_path.exists() {
                    let _ = fs::remove_file(&entry.shadow_path);
                }
                removed += 1;
            }
        }

        if removed > 0 {
            self.save_index()?;
        }

        let _ = self.cleanup_trash(max_age_hours);

        Ok(removed)
    }

    /// Clean up trashed files older than the given hours.
    pub fn cleanup_trash(&mut self, max_age_hours: u64) -> Result<usize, ShadowFsError> {
        let now = chrono::Utc::now();
        let mut removed = 0;

        if !self.trash_root.exists() {
            return Ok(0);
        }

        for entry in fs::read_dir(&self.trash_root)? {
            let entry = entry?;
            let metadata = entry.metadata()?;
            let modified = metadata.modified().ok();
            let should_remove = if let Some(modified) = modified {
                let modified_dt: chrono::DateTime<chrono::Utc> = modified.into();
                let age = now.signed_duration_since(modified_dt);
                age.num_hours() as u64 > max_age_hours
            } else {
                false
            };

            if should_remove {
                let path = entry.path();
                if path.is_file() {
                    fs::remove_file(path)?;
                    removed += 1;
                }
            }
        }

        Ok(removed)
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    fn save_index(&self) -> Result<(), ShadowFsError> {
        let content = serde_json::to_string_pretty(&self.files)?;
        fs::write(&self.index_path, content)?;
        Ok(())
    }

    fn build_trash_path(&self, original_path: &Path, id: &str) -> PathBuf {
        let filename = original_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        self.trash_root.join(format!("{}-{}", id, filename))
    }

    fn audit(&self, action: &str, entry: &ShadowFileEntry, target: Option<&Path>) {
        let record = serde_json::json!({
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "action": action,
            "id": entry.id,
            "originalPath": entry.original_path.to_string_lossy(),
            "targetPath": target.map(|p| p.to_string_lossy()),
            "status": format!("{:?}", entry.status).to_lowercase(),
        });

        if let Ok(line) = serde_json::to_string(&record) {
            let _ = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.audit_path)
                .and_then(|mut file| writeln!(file, "{}", line));
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

// ============================================================================
// Tauri Commands
// ============================================================================

use std::sync::Arc;
use tokio::sync::Mutex;

pub type ShadowFsState = Arc<Mutex<Option<ShadowFs>>>;

#[tauri::command]
pub async fn stage_file(
    state: tauri::State<'_, ShadowFsState>,
    file_path: String,
    content: String,
) -> Result<ShadowFileEntry, String> {
    let mut guard = state.lock().await;
    let shadow_fs = guard.as_mut().ok_or("Shadow FS not initialized")?;

    shadow_fs
        .stage_file(Path::new(&file_path), &content)
        .map_err(|e| e.to_string())
}

pub async fn stage_file_with_patch(
    state: tauri::State<'_, ShadowFsState>,
    file_path: String,
    content: String,
    patch: Option<FilePatch>,
) -> Result<ShadowFileEntry, String> {
    let mut guard = state.lock().await;
    let shadow_fs = guard.as_mut().ok_or("Shadow FS not initialized")?;

    shadow_fs
        .stage_file_with_patch(Path::new(&file_path), &content, patch)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_pending_patches(
    state: tauri::State<'_, ShadowFsState>,
) -> Result<Vec<ShadowFileEntry>, String> {
    let guard = state.lock().await;
    let shadow_fs = guard.as_ref().ok_or("Shadow FS not initialized")?;

    Ok(shadow_fs.list_pending().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn approve_patch(
    state: tauri::State<'_, ShadowFsState>,
    patch_id: String,
) -> Result<ShadowFileEntry, String> {
    let mut guard = state.lock().await;
    let shadow_fs = guard.as_mut().ok_or("Shadow FS not initialized")?;

    shadow_fs
        .approve(&patch_id)
        .map(|e| e.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reject_patch(
    state: tauri::State<'_, ShadowFsState>,
    patch_id: String,
) -> Result<(), String> {
    let mut guard = state.lock().await;
    let shadow_fs = guard.as_mut().ok_or("Shadow FS not initialized")?;

    shadow_fs.reject(&patch_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn apply_patch(
    state: tauri::State<'_, ShadowFsState>,
    patch_id: String,
    create_backup: bool,
) -> Result<ApplyResult, String> {
    let mut guard = state.lock().await;
    let shadow_fs = guard.as_mut().ok_or("Shadow FS not initialized")?;

    shadow_fs
        .apply(&patch_id, create_backup)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_trash(
    state: tauri::State<'_, ShadowFsState>,
    max_age_hours: u64,
) -> Result<usize, String> {
    let mut guard = state.lock().await;
    let shadow_fs = guard.as_mut().ok_or("Shadow FS not initialized")?;

    shadow_fs
        .cleanup_trash(max_age_hours)
        .map_err(|e| e.to_string())
}
