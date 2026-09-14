use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, serde::Serialize)]
pub struct ArtifactMetadata { pub relative_path: String, pub mime_type: String, pub byte_length: u64, pub sha256: String }

pub fn is_available(project_root: &Path, relative_path: &str, mime_type: &str) -> bool {
    let relative = PathBuf::from(relative_path);
    if relative.is_absolute() || relative.components().any(|component| matches!(component, std::path::Component::ParentDir)) { return false; }
    let Ok(root) = project_root.canonicalize() else { return false; };
    let Ok(target) = root.join(&relative).canonicalize() else { return false; };
    target.starts_with(&root)
        && target.metadata().map(|metadata| metadata.is_file()).unwrap_or(false)
        && mime_matches_extension(&relative, mime_type)
}

pub fn inspect(project_root: &Path, relative_path: &str, mime_type: &str) -> Result<ArtifactMetadata, String> {
    let relative = PathBuf::from(relative_path);
    if relative.is_absolute() || relative.components().any(|component| matches!(component, std::path::Component::ParentDir)) { return Err("artifact_path_escape".to_string()); }
    let root = project_root.canonicalize().map_err(|error| error.to_string())?;
    let target = root.join(&relative).canonicalize().map_err(|error| error.to_string())?;
    if !target.starts_with(&root) { return Err("artifact_path_escape".to_string()); }
    let metadata = target.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() { return Err("artifact_not_file".to_string()); }
    if !mime_matches_extension(&relative, mime_type) { return Err("artifact_mime_mismatch".to_string()); }
    let mut file = File::open(&target).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new(); let mut buffer = [0_u8; 64 * 1024];
    loop { let read = file.read(&mut buffer).map_err(|error| error.to_string())?; if read == 0 { break; } digest.update(&buffer[..read]); }
    Ok(ArtifactMetadata { relative_path: relative.to_string_lossy().replace('\\', "/"), mime_type: mime_type.to_string(), byte_length: metadata.len(), sha256: format!("{:x}", digest.finalize()) })
}

fn mime_matches_extension(path: &Path, mime_type: &str) -> bool {
    let mime = mime_type.trim().to_ascii_lowercase();
    if mime == "application/octet-stream" { return true; }
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "pptx" => mime == "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "svg" => mime == "image/svg+xml",
        "png" => mime == "image/png",
        "jpg" | "jpeg" => mime == "image/jpeg",
        "webp" => mime == "image/webp",
        "mp3" => mime == "audio/mpeg",
        "wav" => mime == "audio/wav",
        "mp4" => mime == "video/mp4",
        "webm" => mime == "video/webm",
        "md" => mime == "text/markdown",
        "txt" => mime == "text/plain",
        "json" => mime == "application/json",
        "html" | "htm" => mime == "text/html",
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_hash_and_rejects_escape() {
        let root = std::env::temp_dir().join(format!("coworkany-artifacts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root); std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("deck.pptx"), b"ppt").unwrap();
        let metadata = inspect(&root, "deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation").unwrap();
        assert_eq!(metadata.byte_length, 3); assert_eq!(metadata.sha256.len(), 64);
        assert_eq!(inspect(&root, "deck.pptx", "image/png").unwrap_err(), "artifact_mime_mismatch");
        assert_eq!(inspect(&root, "../deck.pptx", "application/octet-stream").unwrap_err(), "artifact_path_escape");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn availability_check_validates_without_rehashing_file() {
        let root = std::env::temp_dir().join(format!("coworkany-artifact-availability-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root); std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("clip.mp4"), vec![0_u8; 1024]).unwrap();
        assert!(is_available(&root, "clip.mp4", "video/mp4"));
        assert!(!is_available(&root, "clip.mp4", "image/png"));
        assert!(!is_available(&root, "../clip.mp4", "video/mp4"));
        assert!(!is_available(&root, "missing.mp4", "video/mp4"));
        let _ = std::fs::remove_dir_all(root);
    }
}
