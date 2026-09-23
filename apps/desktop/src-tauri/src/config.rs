use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
#[cfg(unix)]
use std::fs::File;
use std::io::Write;
use std::path::Path;

pub fn default_config(workspace_path: &Path) -> Value {
    json!({
        "schemaVersion": 1,
        "locale": "auto",
        "workspacePath": workspace_path.join("projects"),
        "provider": { "id": "local", "source": "local", "model": "", "baseUrl": "http://127.0.0.1:11434/v1", "apiKey": "" },
        "runtime": { "source": "system" }
    })
}

pub fn read(path: &Path, workspace_path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            let json = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
            let mut value: Value = serde_json::from_str(json).map_err(|error| format!("invalid_config_json: {error}"))?;
            if !is_customer_package(&value) {
                remove_development_runninghub_workflow_ids(&mut value);
            }
            normalize_runtime_and_workspace(&mut value, workspace_path);
            Ok(value)
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(default_config(workspace_path)),
        Err(error) => Err(error.to_string()),
    }
}

fn normalize_runtime_and_workspace(value: &mut Value, workspace_path: &Path) {
    let Some(object) = value.as_object_mut() else { return; };
    if object.get("workspacePath").and_then(Value::as_str).is_none() {
        object.insert("workspacePath".to_string(), Value::String(workspace_path.join("projects").to_string_lossy().into_owned()));
    }
    if object.get("runtime").and_then(Value::as_object).is_none() {
        object.insert("runtime".to_string(), json!({ "source": "system" }));
    }
}

pub fn write(path: &Path, value: &Value) -> Result<(), String> {
    let mut normalized = value.clone();
    if !is_customer_package(&normalized) {
        remove_development_runninghub_workflow_ids(&mut normalized);
    }
    validate(&normalized)?;
    let parent = path.parent().ok_or_else(|| "config_parent_missing".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let backup = parent.join("config.backup.json");
    if path.exists() { let _ = fs::copy(path, &backup); }
    let tmp = parent.join("config.json.tmp");
    let bytes = serde_json::to_vec_pretty(&normalized).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new().create(true).truncate(true).write(true).open(&tmp).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&tmp, path).map_err(|error| error.to_string())?;
    sync_parent(parent)
}

/// Older desktop test configurations contained workflow IDs owned by the
/// development RunningHub account. Retain user profiles while removing only
/// those known private IDs at the native config seam.
fn remove_development_runninghub_workflow_ids(value: &mut Value) {
    fn remove_from_profile(profile: &mut Value) {
        const DEVELOPMENT_IDS: [&str; 2] = ["2019410250268418050", "2064172986302812162"];
        if let Some(object) = profile.as_object_mut() {
            for field in ["workflowId", "digitalHumanWorkflowId", "videoEnhanceWorkflowId"] {
                let remove = object.get(field).and_then(Value::as_str).map(|id| DEVELOPMENT_IDS.contains(&id.trim())).unwrap_or(false);
                if remove { object.remove(field); }
            }
        }
    }
    if let Some(object) = value.as_object_mut() {
        if let Some(provider) = object.get_mut("provider") { remove_from_profile(provider); }
        if let Some(providers) = object.get_mut("providers").and_then(Value::as_object_mut) {
            for profile in providers.values_mut() { remove_from_profile(profile); }
        }
    }
}

fn is_customer_package(value: &Value) -> bool {
    value.get("packageType").and_then(Value::as_str) == Some("customer")
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> Result<(), String> {
    File::open(parent).map_err(|error| error.to_string())?.sync_all().map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) -> Result<(), String> { Ok(()) }

fn validate(value: &Value) -> Result<(), String> {
    if value.get("schemaVersion").and_then(Value::as_i64) != Some(1) { return Err("config_schema_version_unsupported".to_string()); }
    if value.get("workspacePath").and_then(Value::as_str).unwrap_or("").is_empty() { return Err("workspace_path_required".to_string()); }
    let provider = value.get("provider").and_then(Value::as_object).ok_or_else(|| "provider_required".to_string())?;
    if provider.get("model").and_then(Value::as_str).is_none() { return Err("provider_model_required".to_string()); }
    if value.get("runtime").and_then(Value::as_object).is_none() { return Err("runtime_required".to_string()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_round_trip_rejects_invalid_schema() {
        let root = std::env::temp_dir().join(format!("coworkany-config-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root); fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json"); let value = default_config(&root);
        write(&path, &value).unwrap(); assert_eq!(read(&path, &root).unwrap()["schemaVersion"], 1);
        assert!(write(&path, &json!({"schemaVersion": 2})).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn config_read_accepts_a_utf8_bom() {
        let root = std::env::temp_dir().join(format!("coworkany-config-bom-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root); fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend(serde_json::to_vec(&default_config(&root)).unwrap());
        fs::write(&path, bytes).unwrap();
        assert_eq!(read(&path, &root).unwrap()["schemaVersion"], 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn config_read_repairs_customer_config_without_runtime_fields() {
        let root = std::env::temp_dir().join(format!("coworkany-config-migration-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root); fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json");
        fs::write(&path, br#"{"schemaVersion":1,"provider":{"model":"customer-model"}}"#).unwrap();
        let value = read(&path, &root).unwrap();
        assert_eq!(value["workspacePath"], root.join("projects").to_string_lossy().as_ref());
        assert_eq!(value["runtime"]["source"], "system");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removes_development_runninghub_workflows_but_keeps_user_workflows() {
        let mut value = json!({
            "provider": { "digitalHumanWorkflowId": "2019410250268418050" },
            "providers": {
                "video": {
                    "digitalHumanWorkflowId": "user-workflow-42",
                    "videoEnhanceWorkflowId": "2064172986302812162"
                }
            }
        });
        remove_development_runninghub_workflow_ids(&mut value);
        assert!(value["provider"].get("digitalHumanWorkflowId").is_none());
        assert_eq!(value["providers"]["video"]["digitalHumanWorkflowId"], "user-workflow-42");
        assert!(value["providers"]["video"].get("videoEnhanceWorkflowId").is_none());
    }

    #[test]
    fn customer_package_preserves_provider_workflow_configuration() {
        let root = std::env::temp_dir().join(format!("coworkany-customer-config-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root); fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json");
        let value = json!({
            "schemaVersion": 1,
            "packageType": "customer",
            "workspacePath": root.join("projects"),
            "runtime": { "source": "system" },
            "provider": { "model": "customer-model", "apiKey": "customer-secret", "digitalHumanWorkflowId": "2019410250268418050" },
            "providers": { "asr": { "model": "1999879555714347010", "workflows": [{ "remoteWorkflowId": "1999879555714347010" }] } }
        });
        write(&path, &value).unwrap();
        let read_back = read(&path, &root).unwrap();
        assert_eq!(read_back["provider"]["apiKey"], "customer-secret");
        assert_eq!(read_back["provider"]["digitalHumanWorkflowId"], "2019410250268418050");
        assert_eq!(read_back["providers"]["asr"]["workflows"][0]["remoteWorkflowId"], "1999879555714347010");
        let _ = fs::remove_dir_all(root);
    }
}
