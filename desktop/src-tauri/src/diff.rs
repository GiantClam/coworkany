//! CoworkAny Desktop - Diff Algorithm
//!
//! Implements unified diff generation using the Myers algorithm.
//! Used by Shadow FS to compute file changes for user review.

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};
use uuid::Uuid;

// ============================================================================
// Types
// ============================================================================

/// A single hunk in a unified diff
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    /// Starting line in original file (0-indexed)
    pub old_start: usize,
    /// Number of lines from original
    pub old_lines: usize,
    /// Starting line in new file (0-indexed)
    pub new_start: usize,
    /// Number of lines in new version
    pub new_lines: usize,
    /// The diff content with +/- prefixes
    pub content: String,
    /// The @@ header line
    pub header: String,
    /// Optional context (function/class name)
    pub context: Option<String>,
}

/// A complete file patch
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePatch {
    pub id: String,
    pub timestamp: String,
    pub file_path: String,
    pub operation: PatchOperation,
    pub new_file_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
    pub full_content: Option<String>,
    pub additions: usize,
    pub deletions: usize,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchOperation {
    Create,
    Modify,
    Delete,
    Rename,
}

/// Error types for diff operations
#[derive(Debug, thiserror::Error)]
pub enum DiffError {
    #[error("Failed to read file: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Hunk does not apply cleanly at line {line}: expected '{expected}', found '{found}'")]
    #[allow(dead_code)]
    HunkMismatch {
        line: usize,
        expected: String,
        found: String,
    },

    #[error("Line {0} is out of bounds")]
    #[allow(dead_code)]
    OutOfBounds(usize),
}

// ============================================================================
// Diff Generation
// ============================================================================

/// Compute a unified diff between original and modified content
pub fn compute_unified_diff(
    original: &str,
    modified: &str,
    file_path: &str,
    context_lines: usize,
) -> FilePatch {
    let diff = TextDiff::from_lines(original, modified);

    let mut hunks = Vec::new();
    let mut additions = 0;
    let mut deletions = 0;

    // Group changes into hunks with context
    for group in diff.grouped_ops(context_lines) {
        let mut hunk_content = String::new();
        let mut old_start = 0;
        let mut old_lines = 0;
        let mut new_start = 0;
        let mut new_lines = 0;
        let mut first = true;

        for op in &group {
            for change in diff.iter_changes(op) {
                if first {
                    old_start = change.old_index().unwrap_or(0);
                    new_start = change.new_index().unwrap_or(0);
                    first = false;
                }

                let prefix = match change.tag() {
                    ChangeTag::Delete => {
                        deletions += 1;
                        old_lines += 1;
                        "-"
                    }
                    ChangeTag::Insert => {
                        additions += 1;
                        new_lines += 1;
                        "+"
                    }
                    ChangeTag::Equal => {
                        old_lines += 1;
                        new_lines += 1;
                        " "
                    }
                };

                hunk_content.push_str(prefix);
                hunk_content.push_str(change.value());
                if !hunk_content.ends_with('\n') {
                    hunk_content.push('\n');
                }
            }
        }

        if !hunk_content.is_empty() {
            let header = format!(
                "@@ -{},{} +{},{} @@",
                old_start + 1,
                old_lines,
                new_start + 1,
                new_lines
            );

            hunks.push(DiffHunk {
                old_start,
                old_lines,
                new_start,
                new_lines,
                content: hunk_content,
                header,
                context: None,
            });
        }
    }

    let operation = if original.is_empty() {
        PatchOperation::Create
    } else if modified.is_empty() {
        PatchOperation::Delete
    } else {
        PatchOperation::Modify
    };

    FilePatch {
        id: Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        file_path: file_path.to_string(),
        operation,
        new_file_path: None,
        hunks,
        full_content: if operation == PatchOperation::Create {
            Some(modified.to_string())
        } else {
            None
        },
        additions,
        deletions,
        description: None,
    }
}

// ============================================================================
// Patch Application
// ============================================================================

/// Apply a patch to the original content
pub fn apply_patch(original: &str, patch: &FilePatch) -> Result<String, DiffError> {
    // For create operations, return full content
    if patch.operation == PatchOperation::Create {
        return Ok(patch.full_content.clone().unwrap_or_default());
    }

    // For delete operations, return empty
    if patch.operation == PatchOperation::Delete {
        return Ok(String::new());
    }

    // Apply hunks
    let lines: Vec<&str> = original.lines().collect();
    let mut result: Vec<String> = Vec::new();
    let mut current_line = 0;

    for hunk in &patch.hunks {
        // Copy unchanged lines before this hunk
        while current_line < hunk.old_start {
            if current_line < lines.len() {
                result.push(lines[current_line].to_string());
            }
            current_line += 1;
        }

        // Apply hunk changes
        for line in hunk.content.lines() {
            if line.starts_with('+') && !line.starts_with("+++") {
                // Add new line
                result.push(line[1..].to_string());
            } else if line.starts_with('-') && !line.starts_with("---") {
                // Skip deleted line (just advance current_line)
                current_line += 1;
            } else if line.starts_with(' ') {
                // Context line - copy and advance
                result.push(line[1..].to_string());
                current_line += 1;
            }
        }
    }

    // Copy remaining lines after last hunk
    while current_line < lines.len() {
        result.push(lines[current_line].to_string());
        current_line += 1;
    }

    Ok(result.join("\n"))
}

// ============================================================================
// Unified Diff String Generation
// ============================================================================

/// Generate a unified diff string for display
#[allow(dead_code)]
pub fn generate_unified_diff_string(patch: &FilePatch) -> String {
    let mut output = String::new();

    // Header
    let old_path = if patch.operation == PatchOperation::Create {
        "/dev/null".to_string()
    } else {
        format!("a/{}", patch.file_path)
    };

    let new_path = if patch.operation == PatchOperation::Delete {
        "/dev/null".to_string()
    } else if let Some(ref new_file) = patch.new_file_path {
        format!("b/{}", new_file)
    } else {
        format!("b/{}", patch.file_path)
    };

    output.push_str(&format!("--- {}\n", old_path));
    output.push_str(&format!("+++ {}\n", new_path));

    // Hunks
    for hunk in &patch.hunks {
        output.push_str(&hunk.header);
        output.push('\n');
        output.push_str(&hunk.content);
    }

    output
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_diff() {
        let original = "line1\nline2\nline3\n";
        let modified = "line1\nmodified\nline3\n";

        let patch = compute_unified_diff(original, modified, "test.txt", 3);

        assert_eq!(patch.additions, 1);
        assert_eq!(patch.deletions, 1);
        assert_eq!(patch.operation, PatchOperation::Modify);
        assert!(!patch.hunks.is_empty());
    }

    #[test]
    fn test_create_file() {
        let original = "";
        let modified = "new content\n";

        let patch = compute_unified_diff(original, modified, "new.txt", 3);

        assert_eq!(patch.operation, PatchOperation::Create);
        assert!(patch.full_content.is_some());
    }

    #[test]
    fn test_apply_patch() {
        let original = "line1\nline2\nline3\n";
        let modified = "line1\nmodified\nline3\n";

        let patch = compute_unified_diff(original, modified, "test.txt", 3);
        let result = apply_patch(original, &patch).unwrap();

        assert_eq!(result.trim(), modified.trim());
    }
}
