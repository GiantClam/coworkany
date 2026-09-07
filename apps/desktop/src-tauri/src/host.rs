use serde::Serialize;
use std::io::{self, BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct HostState {
    process: Arc<Mutex<Option<HostProcess>>>,
    knowledge: Arc<Mutex<Option<KnowledgeProcess>>>,
    generation: Arc<AtomicU64>,
}

impl Default for HostState {
    fn default() -> Self { Self { process: Arc::new(Mutex::new(None)), knowledge: Arc::new(Mutex::new(None)), generation: Arc::new(AtomicU64::new(0)) } }
}

struct HostProcess { child: Child, stdin: Arc<Mutex<ChildStdin>>, job: Option<crate::supervisor::JobObject>, generation: u64 }
struct KnowledgeProcess { child: Child, stdin: ChildStdin, stdout: BufReader<ChildStdout>, job: Option<crate::supervisor::JobObject> }

#[derive(Clone, Debug, Serialize)]
struct HostEvent { raw: String, generation: u64 }

fn is_current_generation(active: &AtomicU64, generation: u64) -> bool {
    active.load(Ordering::Acquire) == generation
}

fn emit_for_current_host(app: &AppHandle, process: &Arc<Mutex<Option<HostProcess>>>, generation: u64, event: &str, raw: String) {
    let Ok(guard) = process.lock() else { return; };
    if guard.as_ref().map(|host| host.generation) == Some(generation) {
        let _ = app.emit(event, HostEvent { raw, generation });
    }
}

const MAX_RUNTIME_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_RUNTIME_FRAME_BYTES: usize = MAX_RUNTIME_MESSAGE_BYTES + 32;

fn parse_response_frame(raw: &[u8]) -> Result<serde_json::Value, &'static str> {
    let separator = raw.iter().position(|byte| *byte == b':').ok_or("runtime_frame_invalid_prefix")?;
    let (declared, payload) = raw.split_at(separator);
    if declared.is_empty() || !declared.iter().all(u8::is_ascii_digit) { return Err("runtime_frame_invalid_prefix"); }
    let expected = std::str::from_utf8(declared).ok().and_then(|value| value.parse::<usize>().ok()).ok_or("runtime_frame_invalid_prefix")?;
    if expected > MAX_RUNTIME_MESSAGE_BYTES { return Err("runtime_message_too_large"); }
    let payload = &payload[1..];
    if payload.len() != expected { return Err("runtime_frame_length_mismatch"); }
    let payload = std::str::from_utf8(payload).map_err(|_| "runtime_frame_invalid_utf8")?;
    let value = serde_json::from_str::<serde_json::Value>(payload).map_err(|_| "runtime_frame_invalid_json")?;
    if value.get("version").and_then(serde_json::Value::as_u64) != Some(1)
        || value.get("requestId").and_then(serde_json::Value::as_str).is_none()
        || value.get("ok").and_then(serde_json::Value::as_bool).is_none() {
        return Err("runtime_frame_invalid_response");
    }
    Ok(value)
}

fn parse_host_frame(raw: &[u8]) -> Result<serde_json::Value, &'static str> {
    let separator = raw.iter().position(|byte| *byte == b':').ok_or("runtime_frame_invalid_prefix")?;
    let (declared, payload) = raw.split_at(separator);
    if declared.is_empty() || !declared.iter().all(u8::is_ascii_digit) { return Err("runtime_frame_invalid_prefix"); }
    let expected = std::str::from_utf8(declared).ok().and_then(|value| value.parse::<usize>().ok()).ok_or("runtime_frame_invalid_prefix")?;
    if expected > MAX_RUNTIME_MESSAGE_BYTES { return Err("runtime_message_too_large"); }
    let payload = &payload[1..];
    if payload.len() != expected { return Err("runtime_frame_length_mismatch"); }
    let payload = std::str::from_utf8(payload).map_err(|_| "runtime_frame_invalid_utf8")?;
    let value = serde_json::from_str::<serde_json::Value>(payload).map_err(|_| "runtime_frame_invalid_json")?;
    if value.get("version").and_then(serde_json::Value::as_u64) != Some(1)
        || value.get("requestId").and_then(serde_json::Value::as_str).is_none() {
        return Err("runtime_frame_invalid_request");
    }
    if value.get("type").and_then(serde_json::Value::as_str) == Some("service_request") {
        let method = value.get("method").and_then(serde_json::Value::as_str).ok_or("runtime_frame_invalid_service_request")?;
        if !matches!(method, "knowledge.index" | "knowledge.search" | "knowledge.write" | "workflow.repository.create" | "workflow.repository.update_status" | "workflow.artifact.register" | "workflow.event.append" | "runtime.artifact.write") { return Err("runtime_frame_invalid_service_method"); }
        return Ok(value);
    }
    if value.get("ok").and_then(serde_json::Value::as_bool).is_none() { return Err("runtime_frame_invalid_response"); }
    Ok(value)
}

fn encode_frame(value: &serde_json::Value) -> Result<String, String> {
    let body = serde_json::to_string(value).map_err(|error| error.to_string())?;
    let bytes = body.as_bytes().len();
    if bytes > MAX_RUNTIME_MESSAGE_BYTES { return Err("runtime_message_too_large".to_string()); }
    Ok(format!("{bytes}:{body}\n"))
}

fn discard_until_newline(reader: &mut impl BufRead) -> io::Result<()> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() { return Ok(()); }
        if let Some(index) = available.iter().position(|byte| *byte == b'\n') {
            reader.consume(index + 1);
            return Ok(());
        }
        let length = available.len();
        reader.consume(length);
    }
}

fn read_bounded_line(reader: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() { return if line.is_empty() { Ok(None) } else { Ok(Some(line)) }; }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let length = newline.map(|index| index + 1).unwrap_or(available.len());
        if line.len().saturating_add(length) > MAX_RUNTIME_FRAME_BYTES {
            reader.consume(length);
            if newline.is_none() { discard_until_newline(reader)?; }
            return Err(io::Error::new(io::ErrorKind::InvalidData, "runtime_frame_too_large"));
        }
        line.extend_from_slice(&available[..length]);
        reader.consume(length);
        if newline.is_some() {
            if line.last() == Some(&b'\n') { line.pop(); }
            if line.last() == Some(&b'\r') { line.pop(); }
            return Ok(Some(line));
        }
    }
}

fn host_script(app: &AppHandle) -> Result<PathBuf, String> {
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let packaged = resource.join("dist-runtime").join("host.mjs");
    if packaged.is_file() { return std::fs::canonicalize(packaged).map(crate::bootstrap::powershell_compatible_path).map_err(|error| error.to_string()); }
    let up_packaged = resource.join("_up_").join("dist-runtime").join("host.mjs");
    if up_packaged.is_file() { return std::fs::canonicalize(up_packaged).map(crate::bootstrap::powershell_compatible_path).map_err(|error| error.to_string()); }
    let flattened = resource.join("host.mjs");
    if flattened.is_file() { return std::fs::canonicalize(flattened).map(crate::bootstrap::powershell_compatible_path).map_err(|error| error.to_string()); }
    if let Some(path) = configured_runtime_path(app, "hostPath").filter(|path| path.is_file()) { return Ok(path); }
    let development = std::env::current_dir().map_err(|error| error.to_string())?.join("apps").join("desktop").join("dist-runtime").join("host.mjs");
    if development.is_file() { return std::fs::canonicalize(development).map(crate::bootstrap::powershell_compatible_path).map_err(|error| error.to_string()); }
    Err(format!("workflow_host_bundle_missing: {}", packaged.display()))
}

fn knowledge_script(app: &AppHandle) -> Result<PathBuf, String> {
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let mut candidates = [
        resource.join("dist-runtime").join("knowledge.mjs"),
        resource.join("_up_").join("dist-runtime").join("knowledge.mjs"),
        resource.join("knowledge.mjs"),
        std::env::current_dir().map_err(|error| error.to_string())?.join("apps").join("desktop").join("dist-runtime").join("knowledge.mjs"),
    ].into_iter().chain(configured_runtime_path(app, "knowledgePath"));
    candidates.find(|path| path.is_file()).and_then(|path| std::fs::canonicalize(path).ok().map(crate::bootstrap::powershell_compatible_path)).ok_or_else(|| "knowledge_service_bundle_missing".to_string())
}

fn node_executable(app: &AppHandle) -> Result<String, String> {
    let data = crate::data_dir(app)?;
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let private = [data.join("runtime").join("node").join(crate::platform::runtime_executable("node"))];
    let packaged = [
        resource.join("dist-runtime").join("runtime").join("node").join(crate::platform::runtime_executable("node")),
        resource.join("_up_").join("dist-runtime").join("runtime").join("node").join(crate::platform::runtime_executable("node")),
        resource.join("runtime").join("node").join(crate::platform::runtime_executable("node")),
        resource.join(crate::platform::runtime_executable("node")),
    ];
    let configured = configured_runtime_path(app, "nodePath");
    Ok(crate::ordered_runtime_candidates(private, packaged, configured, std::iter::empty())
        .into_iter()
        .find(|path| path.is_file() && executable_works(path, &["--version"]))
        .and_then(|path| std::fs::canonicalize(path).ok().map(crate::bootstrap::powershell_compatible_path))
        .or_else(|| system_executable("node"))
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "node".to_string()))
}

pub(crate) fn opencode_executable(app: &AppHandle) -> Result<Option<String>, String> {
    let data = crate::data_dir(app)?;
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    // App-managed Runtime paths must win over stale paths persisted by an
    // older install. Configured paths remain a compatibility fallback.
    let private = [data.join("runtime").join("opencode").join(crate::platform::runtime_executable("opencode"))];
    let packaged = [
        resource.join("dist-runtime").join("runtime").join("opencode").join(crate::platform::runtime_executable("opencode")),
        resource.join("_up_").join("dist-runtime").join("runtime").join("opencode").join(crate::platform::runtime_executable("opencode")),
        resource.join("runtime").join("opencode").join(crate::platform::runtime_executable("opencode")),
    ];
    let configured = configured_runtime_path(app, "opencodePath").into_iter().flat_map(crate::resolve_windows_command_shim);
    Ok(crate::ordered_runtime_candidates(private, packaged, configured, std::iter::empty())
        .into_iter()
        .find(|path| path.is_file() && executable_works(path, &["--version"]))
        .and_then(|path| std::fs::canonicalize(path).ok().map(crate::bootstrap::powershell_compatible_path))
        .or_else(|| system_executable("opencode"))
        .map(|path| path.to_string_lossy().into_owned()))
}

fn system_executable(command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
    let mut where_command = Command::new("where.exe");
    where_command.creation_flags(0x08000000);
    let output = where_command.arg(command).output().ok()?;
    if !output.status.success() { return None; }
    return String::from_utf8_lossy(&output.stdout).lines().map(str::trim).filter(|line| !line.is_empty()).map(PathBuf::from).flat_map(crate::resolve_windows_command_shim).filter(|path| path.is_file() && executable_works(path, &["--version"])).find_map(|path| std::fs::canonicalize(path).ok().map(crate::bootstrap::powershell_compatible_path));
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("which").arg(command).output().ok()?;
        if !output.status.success() { return None; }
        String::from_utf8_lossy(&output.stdout).lines().map(str::trim).find(|line| !line.is_empty()).map(PathBuf::from).filter(|path| path.is_file() && executable_works(path, &["--version"])).and_then(|path| std::fs::canonicalize(path).ok())
    }
}

fn executable_works(path: &std::path::Path, args: &[&str]) -> bool {
    let mut command = Command::new(path);
    crate::platform::configure_child_command(&mut command);
    command.args(args).output().map(|output| output.status.success()).unwrap_or(false)
}

fn configured_runtime_path(app: &AppHandle, key: &str) -> Option<PathBuf> {
    let data = crate::data_dir(app).ok()?;
    let value = crate::config::read(&data.join("config.json"), &data).ok()?;
    let path = value.get("runtime")?.get(key)?.as_str().map(PathBuf::from)?;
    std::fs::canonicalize(path).ok().map(crate::bootstrap::powershell_compatible_path)
}

pub(crate) fn python_executable(app: &AppHandle) -> Result<Option<String>, String> {
    let data = crate::data_dir(app)?;
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    // Application-managed Python must win over stale paths persisted by an
    // older install. Configured paths remain a compatibility fallback.
    let private = [data.join("runtime").join("python").join(crate::platform::runtime_executable("python"))];
    let bundled = [
        resource.join("dist-runtime").join("runtime").join("python").join(crate::platform::runtime_executable("python")),
        resource.join("_up_").join("dist-runtime").join("runtime").join("python").join(crate::platform::runtime_executable("python")),
    ];
    let configured = configured_runtime_path(app, "pythonPath").into_iter();
    if let Some(path) = crate::ordered_runtime_candidates(private, bundled, configured, std::iter::empty())
        .into_iter()
        .find(|path| path.is_file() && python_capable(path))
        .and_then(|path| std::fs::canonicalize(path).ok().map(crate::bootstrap::powershell_compatible_path)) { return Ok(Some(path.to_string_lossy().into_owned())); }
    let system = system_executable(crate::platform::runtime_executable("python")).filter(|path| python_capable(path));
    Ok(system.map(|path| path.to_string_lossy().into_owned()))
}

pub(crate) fn skills_directory(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let data = crate::data_dir(app)?;
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let configured = configured_runtime_path(app, "skillsPath");
    Ok(select_skills_directory(crate::ordered_runtime_candidates(
        [data.join("skills")],
        [resource.join("dist-runtime/skills"), resource.join("_up_/dist-runtime/skills"), resource.join("skills")],
        configured,
        std::iter::empty(),
    )))
}

fn select_skills_directory(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| {
            ["ppt-master", "dashi-ppt"].iter().all(|id| {
                path.join(id).join("SKILL.md").is_file() && path.join(format!("{id}.manifest.json")).is_file()
            })
        })
}

fn python_capable(path: &std::path::Path) -> bool {
    let mut command = Command::new(path);
    crate::platform::configure_child_command(&mut command);
    command.args(["-c", crate::PPT_PYTHON_PROBE]).output().map(|output| output.status.success()).unwrap_or(false)
}

fn lancedb_runtime_directory(app: &AppHandle) -> Result<Option<String>, String> {
    let data = crate::data_dir(app)?;
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let configured = configured_runtime_path(app, "lancedbPath");
    let candidates = crate::ordered_runtime_candidates(
        [data.join("runtime").join("lancedb")],
        [
        resource.join("dist-runtime").join("runtime").join("lancedb"),
        resource.join("_up_").join("dist-runtime").join("runtime").join("lancedb"),
        ],
        configured,
        std::iter::empty(),
    );
    Ok(candidates.into_iter().find(|path| path.join("node_modules").join("@lancedb").join("lancedb").join("dist").join("index.js").is_file()).and_then(|path| std::fs::canonicalize(path).ok().map(crate::bootstrap::powershell_compatible_path)).map(|path| path.to_string_lossy().into_owned()))
}

fn service_response(request_id: &str, result: Result<serde_json::Value, String>) -> serde_json::Value {
    match result {
        Ok(data) => serde_json::json!({ "version": 1, "requestId": request_id, "type": "service_response", "ok": true, "data": data }),
        Err(message) => serde_json::json!({ "version": 1, "requestId": request_id, "type": "service_response", "ok": false, "error": { "code": "knowledge_service_failed", "message": message, "retryable": true } }),
    }
}

fn payload_string<'a>(request: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    request.get("payload").and_then(|payload| payload.get(key)).and_then(serde_json::Value::as_str).filter(|value| !value.trim().is_empty()).ok_or_else(|| format!("service_payload_required:{key}"))
}

fn dispatch_workflow_service_request(app: &AppHandle, request: &serde_json::Value) -> Result<serde_json::Value, String> {
    let method = request.get("method").and_then(serde_json::Value::as_str).ok_or_else(|| "service_method_required".to_string())?;
    let database = crate::database_path(app)?;
    match method {
        "workflow.repository.create" => {
            let run_id = payload_string(request, "runId")?;
            crate::storage::create_run(&database, run_id, None, None).map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "runId": run_id }))
        }
        "workflow.repository.update_status" => {
            let run_id = payload_string(request, "runId")?;
            let status = payload_string(request, "status")?;
            if !matches!(status, "running" | "succeeded" | "failed" | "cancelled" | "interrupted") { return Err("workflow_status_invalid".to_string()); }
            if status == "running" { crate::storage::create_run(&database, run_id, None, None).map_err(|error| error.to_string())?; }
            else { crate::storage::finish_run(&database, run_id, status).map_err(|error| error.to_string())?; }
            Ok(serde_json::json!({ "runId": run_id, "status": status }))
        }
        "workflow.event.append" => {
            let run_id = payload_string(request, "runId")?;
            let event_type = payload_string(request, "type")?;
            let sequence = request.get("payload").and_then(|payload| payload.get("sequence")).and_then(serde_json::Value::as_i64).ok_or_else(|| "service_payload_required:sequence".to_string())?;
            let event_payload = request.get("payload").and_then(|payload| payload.get("payload")).cloned().unwrap_or_else(|| serde_json::json!({}));
            let payload_json = serde_json::to_string(&event_payload).map_err(|error| error.to_string())?;
            crate::storage::append_run_event(&database, run_id, sequence, event_type, &payload_json).map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "runId": run_id, "sequence": sequence }))
        }
        "workflow.artifact.register" => {
            let run_id = payload_string(request, "runId")?;
            let relative_path = payload_string(request, "relativePath")?;
            let mime_type = payload_string(request, "mimeType")?;
            let metadata = crate::artifacts::inspect(&crate::project_root(app)?, relative_path, mime_type)?;
            let artifact_id = format!("{run_id}:{relative_path}");
            crate::storage::register_artifact(&database, &artifact_id, None, &metadata).map_err(|error| error.to_string())?;
            Ok(serde_json::json!({ "artifactId": artifact_id, "relativePath": metadata.relative_path, "mimeType": metadata.mime_type, "byteLength": metadata.byte_length, "sha256": metadata.sha256 }))
        }
        "runtime.artifact.write" => {
            let relative_path = payload_string(request, "relativePath")?;
            let mime_type = payload_string(request, "mimeType")?;
            let content = payload_string(request, "content")?;
            if content.len() > 4 * 1024 * 1024 { return Err("runtime_artifact_content_too_large".to_string()); }
            let relative = std::path::PathBuf::from(relative_path);
            if relative.is_absolute() || relative.components().any(|component| matches!(component, std::path::Component::ParentDir)) { return Err("runtime_artifact_path_escape".to_string()); }
            let root = crate::project_root(app)?;
            if let Some(workspace_path) = request.get("payload").and_then(|value| value.get("workspacePath")).and_then(serde_json::Value::as_str) {
                let requested_root = std::path::PathBuf::from(workspace_path).canonicalize().map_err(|error| error.to_string())?;
                let configured_root = root.canonicalize().map_err(|error| error.to_string())?;
                if requested_root != configured_root { return Err("runtime_artifact_workspace_mismatch".to_string()); }
            }
            let target = root.join(relative_path.replace('/', "\\"));
            if !target.starts_with(&root) { return Err("runtime_artifact_path_escape".to_string()); }
            if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or(0);
            let temporary = target.with_extension(format!("{}.{}.tmp", target.extension().and_then(|value| value.to_str()).unwrap_or("artifact"), stamp));
            std::fs::write(&temporary, content.as_bytes()).map_err(|error| error.to_string())?;
            std::fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
            let metadata = crate::artifacts::inspect(&root, relative_path, mime_type)?;
            Ok(serde_json::json!({ "relativePath": metadata.relative_path, "mimeType": metadata.mime_type, "byteLength": metadata.byte_length, "sha256": metadata.sha256 }))
        }
        _ => Err("service_method_not_supported".to_string()),
    }
}

fn ensure_knowledge_process(app: &AppHandle, state: &Arc<Mutex<Option<KnowledgeProcess>>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "knowledge_state_poisoned".to_string())?;
    if let Some(process) = guard.as_mut() {
        if process.child.try_wait().map_err(|error| error.to_string())?.is_none() { return Ok(()); }
        *guard = None;
    }
    let script = knowledge_script(app)?;
    let mut command = Command::new(node_executable(app)?);
    command
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::platform::configure_child_command(&mut command);
    let mut child = command.spawn()
        .map_err(|error| format!("knowledge_service_spawn_failed: {error}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "knowledge_service_stdin_missing".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "knowledge_service_stdout_missing".to_string())?;
    let job = match crate::supervisor::JobObject::new() {
        Ok(mut job) => {
            if let Err(error) = job.assign(&child) {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("knowledge_service_job_assign_failed: {error}"));
            }
            Some(job)
        }
        Err(error) => {
            let mut child = child;
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("knowledge_service_job_create_failed: {error}"));
        }
    };
    *guard = Some(KnowledgeProcess { child, stdin, stdout: BufReader::new(stdout), job });
    Ok(())
}

fn dispatch_service_request(app: &AppHandle, state: &Arc<Mutex<Option<KnowledgeProcess>>>, request: &serde_json::Value) -> serde_json::Value {
    let request_id = request.get("requestId").and_then(serde_json::Value::as_str).unwrap_or("unknown");
    let result = (|| {
        ensure_knowledge_process(app, state)?;
        let mut guard = state.lock().map_err(|_| "knowledge_state_poisoned".to_string())?;
        let process = guard.as_mut().ok_or_else(|| "knowledge_service_not_running".to_string())?;
        let frame = encode_frame(request)?;
        process.stdin.write_all(frame.as_bytes()).and_then(|_| process.stdin.flush()).map_err(|error| format!("knowledge_service_write_failed: {error}"))?;
        let line = read_bounded_line(&mut process.stdout).map_err(|error| format!("knowledge_service_read_failed: {error}"))?.ok_or_else(|| "knowledge_service_eof".to_string())?;
        let response = parse_response_frame(&line).map_err(|error| error.to_string())?;
        if response.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
            Ok(response.get("data").cloned().unwrap_or_else(|| serde_json::json!({})))
        } else {
            Err(response.get("error").and_then(|error| error.get("message")).and_then(serde_json::Value::as_str).unwrap_or("knowledge_service_failed").to_string())
        }
    })();
    service_response(request_id, result)
}

#[tauri::command]
pub fn host_start(app: AppHandle, state: State<'_, HostState>) -> Result<u64, String> {
    let mut guard = state.process.lock().map_err(|_| "host_state_poisoned".to_string())?;
    if let Some(process) = guard.as_mut() {
        if process.child.try_wait().map_err(|error| error.to_string())?.is_none() { return Ok(process.generation); }
        *guard = None;
    }
    // Invalidate every event source owned by the exited process before doing
    // any startup preparation. Its stderr/stdout reader threads may still be
    // draining while paths and runtime assets for the replacement are resolved.
    let generation = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    let script = host_script(&app)?;
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let skills = skills_directory(&app)?;
    let agents = [crate::data_dir(&app)?.join("agents"), resource.join("dist-runtime").join("agents"), resource.join("_up_").join("dist-runtime").join("agents"), resource.join("agents"), std::env::current_dir().map_err(|error| error.to_string())?.join("apps").join("desktop").join("dist-runtime").join("agents")]
        .into_iter()
        .find(|path| path.is_dir());
    let python = python_executable(&app)?;
    // A packaged app may be launched with an arbitrary or read-only working
    // directory (for example the launcher application's install directory).
    // Keep OpenCode's sockets and lock files under CoworkAny's writable data
    // root; this is runtime plumbing, not Skill-specific behavior.
    let opencode_runtime = crate::data_dir(&app)?;
    let mut command = Command::new(node_executable(&app)?);
    command
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .envs(skills.as_ref().map(|path| [("COWORKANY_SKILLS_DIR", path.to_string_lossy().to_string())]).into_iter().flatten())
        .envs(agents.as_ref().map(|path| [("COWORKANY_AGENTS_DIR", path.to_string_lossy().to_string())]).into_iter().flatten())
        .envs(opencode_executable(&app)?.map(|path| [("COWORKANY_OPENCODE_PATH", path)]).into_iter().flatten())
        .envs(python.map(|path| [("COWORKANY_PYTHON_PATH", path)]).into_iter().flatten())
        .envs(lancedb_runtime_directory(&app)?.map(|path| [("COWORKANY_LANCEDB_DIR", path)]).into_iter().flatten())
        .env("OPENCODE_RUNTIME_DIR", opencode_runtime);
    crate::platform::configure_child_command(&mut command);
    let mut child = command.spawn()
        .map_err(|error| format!("workflow_host_spawn_failed: {error}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "workflow_host_stdout_missing".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "workflow_host_stderr_missing".to_string())?;
    let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or_else(|| "workflow_host_stdin_missing".to_string())?));
    let event_app = app.clone();
    let host_stdin = Arc::clone(&stdin);
    let knowledge_state = Arc::clone(&state.knowledge);
    let response_generation = Arc::clone(&state.generation);
    let log_generation = Arc::clone(&state.generation);
    let response_process = Arc::clone(&state.process);
    let log_process = Arc::clone(&state.process);
    let log_root = crate::data_dir(&app).map_err(|error| error.to_string())?;
    let stderr_log_root = log_root.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            if !is_current_generation(&response_generation, generation) { break; }
            let line = match read_bounded_line(&mut reader) {
                Ok(Some(line)) => line,
                Ok(None) => break,
                Err(error) => {
                    let raw = serde_json::json!({ "type": "workflow_host_protocol_error", "code": error.to_string() }).to_string();
                    crate::logs::append(&log_root, "host", &raw);
                    emit_for_current_host(&event_app, &response_process, generation, "desktop://runtime-log", raw);
                    if error.kind() != io::ErrorKind::InvalidData { break; }
                    continue;
                }
            };
            let value = match parse_host_frame(&line) {
                Ok(value) => value,
                Err(code) => {
                    let raw = serde_json::json!({ "type": "workflow_host_protocol_error", "code": code }).to_string();
                    crate::logs::append(&log_root, "host", &raw);
                    emit_for_current_host(&event_app, &response_process, generation, "desktop://runtime-log", raw);
                    continue;
                }
            };
            if value.get("type").and_then(serde_json::Value::as_str) == Some("service_request") {
                let process_guard = response_process.lock().map_err(|_| ()).ok();
                if process_guard.as_ref().and_then(|guard| guard.as_ref()).map(|host| host.generation) != Some(generation) { break; }
                let method = value.get("method").and_then(serde_json::Value::as_str).unwrap_or("");
                let response = if method.starts_with("workflow.") || method.starts_with("runtime.") {
                    service_response(value.get("requestId").and_then(serde_json::Value::as_str).unwrap_or("unknown"), dispatch_workflow_service_request(&event_app, &value))
                } else {
                    dispatch_service_request(&event_app, &knowledge_state, &value)
                };
                if let Ok(frame) = encode_frame(&response) {
                    if let Ok(mut writer) = host_stdin.lock() {
                        let _ = writer.write_all(frame.as_bytes()).and_then(|_| writer.flush());
                    }
                }
                drop(process_guard);
                continue;
            }
            let run_id = value.get("data").and_then(|data| data.get("event")).and_then(|event| event.get("runId")).and_then(serde_json::Value::as_str).unwrap_or("host");
            let raw = String::from_utf8(line).expect("validated UTF-8 RPC frame");
            crate::logs::append(&log_root, run_id, &raw);
            emit_for_current_host(&event_app, &response_process, generation, "desktop://runtime-response", raw);
        }
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            crate::logs::append(&stderr_log_root, "stderr", &line);
            if is_current_generation(&log_generation, generation) {
                emit_for_current_host(&app, &log_process, generation, "desktop://runtime-log", line);
            }
        }
        if is_current_generation(&log_generation, generation) {
            emit_for_current_host(&app, &log_process, generation, "desktop://runtime-log", "{\"type\":\"workflow_host_exit\"}".to_string());
        }
    });
    let job = match crate::supervisor::JobObject::new() {
        Ok(mut job) => {
            if let Err(error) = job.assign(&child) {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("workflow_host_job_assign_failed: {error}"));
            }
            Some(job)
        }
        Err(error) => {
            let mut child = child;
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("workflow_host_job_create_failed: {error}"));
        }
    };
    *guard = Some(HostProcess { child, stdin, job, generation });
    Ok(generation)
}

#[tauri::command]
pub fn host_send(state: State<'_, HostState>, message: serde_json::Value) -> Result<(), String> {
    let body = serde_json::to_string(&message).map_err(|error| error.to_string())?;
    let bytes = body.as_bytes().len();
    if bytes > MAX_RUNTIME_MESSAGE_BYTES { return Err("runtime_message_too_large".to_string()); }
    let mut guard = state.process.lock().map_err(|_| "host_state_poisoned".to_string())?;
    let process = guard.as_mut().ok_or_else(|| "workflow_host_not_running".to_string())?;
    let write_result = process.stdin.lock().map_err(|_| "workflow_host_stdin_poisoned".to_string()).and_then(|mut stdin| write!(stdin, "{bytes}:{body}\n").and_then(|_| stdin.flush()).map_err(|error| error.to_string()));
    if let Err(error) = write_result {
        let _ = process.child.kill(); *guard = None; return Err(format!("workflow_host_write_failed: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub fn host_stop(state: State<'_, HostState>) -> Result<(), String> {
    stop_state(state.inner())
}

pub fn stop_state(state: &HostState) -> Result<(), String> {
    let mut guard = state.process.lock().map_err(|_| "host_state_poisoned".to_string())?;
    if let Some(mut process) = guard.take() { if let Some(job) = process.job.as_ref() { let _ = job.terminate(); } let _ = process.child.kill(); let _ = process.child.wait(); }
    let mut knowledge = state.knowledge.lock().map_err(|_| "knowledge_state_poisoned".to_string())?;
    if let Some(mut process) = knowledge.take() { if let Some(job) = process.job.as_ref() { let _ = job.terminate(); } let _ = process.child.kill(); let _ = process.child.wait(); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_skills_replace_cached_old_catalog_without_touching_it() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("coworkany-skill-selection-{}-{stamp}", std::process::id()));
        let cached = root.join("cached");
        let bundled = root.join("_up_/dist-runtime/skills");
        for path in [&cached, &bundled] {
            for id in ["ppt-master", "dashi-ppt"] {
                std::fs::create_dir_all(path.join(id)).unwrap();
                std::fs::write(path.join(id).join("SKILL.md"), b"original").unwrap();
                std::fs::write(path.join(format!("{id}.manifest.json")), b"{}").unwrap();
            }
        }
        assert_eq!(select_skills_directory(crate::ordered_runtime_candidates([], [bundled.clone()], [cached.clone()], std::iter::empty())), Some(bundled.clone()));
        std::fs::remove_file(bundled.join("dashi-ppt/SKILL.md")).unwrap();
        assert_eq!(select_skills_directory(crate::ordered_runtime_candidates([], [bundled.clone()], [cached.clone()], std::iter::empty())), Some(cached.clone()));
        assert_eq!(std::fs::read(cached.join("ppt-master/SKILL.md")).unwrap(), b"original");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_skills_replace_packaged_skills_before_using_stale_config() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("coworkany-private-skill-selection-{}-{stamp}", std::process::id()));
        let private = root.join("skills");
        let bundled = root.join("bundled");
        let cached = root.join("cached");
        for path in [&private, &bundled, &cached] {
            for id in ["ppt-master", "dashi-ppt"] {
                std::fs::create_dir_all(path.join(id)).unwrap();
                std::fs::write(path.join(id).join("SKILL.md"), b"skill").unwrap();
                std::fs::write(path.join(format!("{id}.manifest.json")), b"{}").unwrap();
            }
        }

        assert_eq!(
            select_skills_directory(crate::ordered_runtime_candidates([private.clone()], [bundled], [cached], std::iter::empty())),
            Some(private)
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stdout_frames_require_a_bounded_utf8_json_payload() {
        let payload = br#"{"version":1,"requestId":"request","ok":true}"#;
        let valid = format!("{}:{}", payload.len(), std::str::from_utf8(payload).unwrap());
        assert_eq!(parse_response_frame(valid.as_bytes()).unwrap()["requestId"], "request");
        assert_eq!(parse_response_frame(br#"42:{"version":1}"#).unwrap_err(), "runtime_frame_length_mismatch");
        assert_eq!(parse_response_frame(b"not-a-frame").unwrap_err(), "runtime_frame_invalid_prefix");
        assert_eq!(parse_response_frame(br#"2:{]"#).unwrap_err(), "runtime_frame_invalid_json");
        assert_eq!(parse_response_frame(br#"2:{}"#).unwrap_err(), "runtime_frame_invalid_response");
        assert_eq!(parse_response_frame(b"8388609:{}").unwrap_err(), "runtime_message_too_large");
    }

    #[test]
    fn reverse_service_requests_are_validated_separately_from_responses() {
        let payload = br#"{"version":1,"requestId":"reverse","type":"service_request","method":"knowledge.search","payload":{"query":"hello"}}"#;
        let frame = format!("{}:{}", payload.len(), std::str::from_utf8(payload).unwrap());
        let parsed = parse_host_frame(frame.as_bytes()).unwrap();
        assert_eq!(parsed["type"], "service_request");
        let malformed = br#"{"version":1,"requestId":"bad"}"#;
        let malformed_frame = format!("{}:{}", malformed.len(), std::str::from_utf8(malformed).unwrap());
        assert_eq!(parse_host_frame(malformed_frame.as_bytes()).unwrap_err(), "runtime_frame_invalid_response");
        let unsupported = br#"{"version":1,"requestId":"bad","type":"service_request","method":"shell.exec"}"#;
        let unsupported_frame = format!("{}:{}", unsupported.len(), std::str::from_utf8(unsupported).unwrap());
        assert_eq!(parse_host_frame(unsupported_frame.as_bytes()).unwrap_err(), "runtime_frame_invalid_service_method");
    }

    #[test]
    fn stdout_reader_discards_an_oversized_line_before_parsing_the_next_frame() {
        let mut source = vec![b'x'; MAX_RUNTIME_FRAME_BYTES + 1];
        source.push(b'\n');
        source.extend_from_slice(b"2:[]\n");
        let mut reader = BufReader::new(std::io::Cursor::new(source));

        let error = read_bounded_line(&mut reader).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(read_bounded_line(&mut reader).unwrap().unwrap(), b"2:[]");
    }

    #[test]
    fn stale_host_generation_cannot_emit_events_for_a_restarted_host() {
        let active = AtomicU64::new(1);
        assert!(is_current_generation(&active, 1));
        active.store(2, Ordering::Release);
        assert!(!is_current_generation(&active, 1));
        assert!(is_current_generation(&active, 2));
        let event = serde_json::to_value(HostEvent { raw: "{}".to_string(), generation: 2 }).unwrap();
        assert_eq!(event["generation"], 2);
    }
}
