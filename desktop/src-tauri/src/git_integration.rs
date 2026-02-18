use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;



#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatus {
    pub file: String,
    pub status: String, // "M" | "A" | "D" | "??"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

pub struct GitManager;

impl GitManager {
    pub fn new() -> Self {
        Self
    }

    fn run_git(&self, cwd: &Path, args: &[&str]) -> Result<String, String> {
        let output = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to execute git: {}", e))?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn init(&self, path: &Path) -> Result<String, String> {
        self.run_git(path, &["init"])
    }

    pub fn status(&self, path: &Path) -> Result<Vec<GitStatus>, String> {
        let output = self.run_git(path, &["status", "--porcelain"])?;
        let mut results = Vec::new();

        for line in output.lines() {
            if line.len() > 3 {
                let status = line[0..2].trim().to_string();
                let file = line[3..].to_string();
                results.push(GitStatus { file, status });
            }
        }
        Ok(results)
    }

    pub fn add(&self, path: &Path, files: Vec<String>) -> Result<(), String> {
        let mut args = vec!["add"];
        for file in &files {
            args.push(file);
        }
        if files.is_empty() {
             args.push(".");
        }
        self.run_git(path, &args)?;
        Ok(())
    }

    pub fn commit(&self, path: &Path, message: &str) -> Result<String, String> {
        self.run_git(path, &["commit", "-m", message])
    }

    pub fn create_branch(&self, path: &Path, branch_name: &str) -> Result<(), String> {
        // Create and switch
        self.run_git(path, &["checkout", "-b", branch_name])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn checkout(&self, path: &Path, target: &str) -> Result<(), String> {
        self.run_git(path, &["checkout", target])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn get_current_branch(&self, path: &Path) -> Result<String, String> {
        self.run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
    }

    pub fn log(&self, path: &Path, limit: usize) -> Result<Vec<GitCommit>, String> {
        let limit_str = format!("-{}", limit);
        // format: hash|author|date|message
        let output = self.run_git(path, &["log", &limit_str, "--pretty=format:%h|%an|%ad|%s", "--date=iso"])?;
        
        let mut commits = Vec::new();
        for line in output.lines() {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() >= 4 {
                commits.push(GitCommit {
                    hash: parts[0].to_string(),
                    author: parts[1].to_string(),
                    date: parts[2].to_string(),
                    message: parts[3..].join("|"),
                });
            }
        }
        Ok(commits)
    }

    pub fn reset_hard(&self, path: &Path) -> Result<(), String> {
        self.run_git(path, &["reset", "--hard"])?;
        Ok(())
    }

    pub fn clean_fd(&self, path: &Path) -> Result<(), String> {
        // Remove untracked files and directories
        self.run_git(path, &["clean", "-fd"])?;
        Ok(())
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
pub async fn git_status(cwd: String) -> Result<GitResult<Vec<GitStatus>>, String> {
    let manager = GitManager::new();
    match manager.status(Path::new(&cwd)) {
        Ok(data) => Ok(GitResult { success: true, data: Some(data), error: None }),
        Err(e) => Ok(GitResult { success: false, data: None, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn git_commit(cwd: String, message: String, files: Option<Vec<String>>) -> Result<GitResult<String>, String> {
    let manager = GitManager::new();
    let path = Path::new(&cwd);
    
    // Auto add files or all
    if let Err(e) = manager.add(path, files.unwrap_or_default()) {
         return Ok(GitResult { success: false, data: None, error: Some(format!("Add failed: {}", e)) });
    }

    match manager.commit(path, &message) {
        Ok(hash) => Ok(GitResult { success: true, data: Some(hash), error: None }),
        Err(e) => Ok(GitResult { success: false, data: None, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn git_log(cwd: String, limit: Option<usize>) -> Result<GitResult<Vec<GitCommit>>, String> {
    let manager = GitManager::new();
    match manager.log(Path::new(&cwd), limit.unwrap_or(10)) {
        Ok(data) => Ok(GitResult { success: true, data: Some(data), error: None }),
        Err(e) => Ok(GitResult { success: false, data: None, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn git_checkpoint(cwd: String, branch_name: String) -> Result<GitResult<String>, String> {
    let manager = GitManager::new();
    let path = Path::new(&cwd);

    // Check if git is initialized
    if !path.join(".git").exists() {
        if let Err(e) = manager.init(path) {
             return Ok(GitResult { success: false, data: None, error: Some(format!("Init failed: {}", e)) });
        }
    }

    // Pass 1: Commit any pending changes to current branch to avoid losing them
    // Check status first
    if let Ok(status) = manager.status(path) {
        if !status.is_empty() {
             let _ = manager.add(path, vec![]); // add .
             let _ = manager.commit(path, "Auto-save before checkpoint");
        }
    }

    // Pass 2: Create new branch
    match manager.create_branch(path, &branch_name) {
        Ok(_) => Ok(GitResult { success: true, data: Some(format!("Switched to {}", branch_name)), error: None }),
        Err(e) => Ok(GitResult { success: false, data: None, error: Some(e) }),
    }
}

#[tauri::command]
pub async fn git_rollback(cwd: String) -> Result<GitResult<String>, String> {
    let manager = GitManager::new();
    let path = Path::new(&cwd);

    // Hard reset and clean
    if let Err(e) = manager.reset_hard(path) {
        return Ok(GitResult { success: false, data: None, error: Some(format!("Reset failed: {}", e)) });
    }
    if let Err(e) = manager.clean_fd(path) {
        return Ok(GitResult { success: false, data: None, error: Some(format!("Clean failed: {}", e)) });
    }

    Ok(GitResult { success: true, data: Some("Rollback successful".to_string()), error: None })
}
