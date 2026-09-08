use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use std::fs;
mod storage;
mod supervisor;
mod platform;
mod host;
mod config;
mod artifacts;
mod logs;
mod bootstrap;
mod instance_lock;

pub(crate) const PPT_PYTHON_PROBE: &str = r#"
import sys, venv, pip
assert not sys.flags.isolated and not sys.flags.safe_path, "python_script_path_isolated"
"#;

/// Resolve Windows command shims to the executable they dispatch before a
/// path is persisted or passed to a child process. `where.exe` commonly
/// returns both `opencode` and `opencode.cmd`; neither shim is safe to pass
/// directly to `CreateProcess`.
pub(crate) fn resolve_windows_command_shim(path: PathBuf) -> Vec<PathBuf> {
    #[cfg(not(windows))]
    return vec![path];
    #[cfg(windows)]
    {
    let extension = path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase());
    if matches!(extension.as_deref(), Some("exe")) { return vec![path]; }
    let mut candidates = Vec::new();
    if let Some(parent) = path.parent() {
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            candidates.push(parent.join(format!("{stem}.exe")));
            if stem.eq_ignore_ascii_case("opencode") {
                candidates.push(parent.join("node_modules").join("opencode-ai").join("bin").join("opencode.exe"));
            }
        }
    }
    candidates.push(path.clone());
    candidates.sort_by_key(|candidate| if candidate.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("exe")) { 0 } else { 1 });
    candidates.dedup();
    candidates
    }
}

#[derive(Debug, Serialize)]
pub struct Health {
    pub status: &'static str,
    pub version: &'static str,
}

#[tauri::command]
fn health() -> Health {
    Health { status: "ok", version: env!("CARGO_PKG_VERSION") }
}

#[tauri::command]
fn runtime_probe(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let data = data_dir(&app)?;
    let cache_fingerprint = runtime_probe_fingerprint(&data, &resource);
    if let Some(cached) = read_runtime_probe_cache(&data, &cache_fingerprint) { return Ok(cached); }
    let database = data.join("app.db");
    let migrations = storage::migrations_ready_without_initialization(&database).unwrap_or(false);
    let configured_node = configured_runtime_executable(&data, "nodePath");
    let private_node = data.join("runtime").join("node").join(platform::runtime_executable("node"));
    let packaged_nodes = [
        resource.join("dist-runtime").join("runtime").join("node").join(platform::runtime_executable("node")),
        resource.join("_up_").join("dist-runtime").join("runtime").join("node").join(platform::runtime_executable("node")),
        resource.join("runtime").join("node").join(platform::runtime_executable("node")),
        resource.join(platform::runtime_executable("node")),
    ];
    let node_path = ordered_runtime_candidates([private_node], packaged_nodes, configured_node, std::iter::empty())
        .into_iter()
        .find(|path| path.is_file() && executable_works(path, &["--version"]))
        .or_else(|| system_executable("node"))
        .and_then(canonical_path);
    let opencode_path = host::opencode_executable(&app)?.map(PathBuf::from).and_then(canonical_path);
    let node = node_path.is_some();
    let opencode = opencode_path.is_some();
    let python_path = host::python_executable(&app)?.map(PathBuf::from).and_then(canonical_path);
    let python = python_path.is_some();
    let development = development_runtime_directory().unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("apps").join("desktop").join("dist-runtime"));
    let configured_host = configured_runtime_path(&data, "hostPath");
    let host_path = {
        let mut candidates = Vec::new();
        if cfg!(debug_assertions) { candidates.push(development.join("host.mjs")); }
        candidates.extend([resource.join("dist-runtime").join("host.mjs"), resource.join("_up_").join("dist-runtime").join("host.mjs")]);
        if let Some(path) = configured_host { candidates.push(path); }
        if !cfg!(debug_assertions) { candidates.push(development.join("host.mjs")); }
        candidates
        .into_iter()
        .find(|path| path.is_file())
        .and_then(canonical_path)
    };
    let host = host_path.is_some();
    let configured_knowledge = configured_runtime_path(&data, "knowledgePath");
    let knowledge_path = {
        let mut candidates = Vec::new();
        if cfg!(debug_assertions) { candidates.push(development.join("knowledge.mjs")); }
        candidates.extend([resource.join("dist-runtime").join("knowledge.mjs"), resource.join("_up_").join("dist-runtime").join("knowledge.mjs")]);
        if let Some(path) = configured_knowledge { candidates.push(path); }
        if !cfg!(debug_assertions) { candidates.push(development.join("knowledge.mjs")); }
        candidates
        .into_iter()
        .find(|path| path.is_file())
        .and_then(canonical_path)
    };
    let knowledge = knowledge_path.is_some();
    let skill_path = host::skills_directory(&app)?.and_then(canonical_path);
    let skills = skill_path.is_some();
    let configured_fonts = configured_runtime_path(&data, "fontsPath");
    let fonts_path = ordered_runtime_candidates(
        [data.join("runtime").join("fonts")],
        [resource.join("dist-runtime").join("runtime").join("fonts"), resource.join("_up_").join("dist-runtime").join("runtime").join("fonts")],
        configured_fonts,
        [development.join("runtime").join("fonts")],
    )
        .into_iter()
        .find(|path| bootstrap::font_asset_works(&path.join(platform::font_asset_name())))
        .and_then(canonical_path);
    let fonts = fonts_path.is_some();
    let configured_lancedb = configured_runtime_path(&data, "lancedbPath");
    let lancedb_path = ordered_runtime_candidates(
        [data.join("runtime").join("lancedb")],
        [resource.join("dist-runtime").join("runtime").join("lancedb"), resource.join("_up_").join("dist-runtime").join("runtime").join("lancedb")],
        configured_lancedb,
        std::iter::empty(),
    )
        .into_iter()
        .find(|path| path.join("node_modules").join("@lancedb").join("lancedb").join("dist").join("index.js").exists())
        .and_then(canonical_path);
    let lancedb = lancedb_path.is_some();
    let configured_embedding = configured_runtime_path(&data, "embeddingPath");
    let embedding_path = ordered_runtime_candidates(
        [data.join("runtime").join("embedding").join("local-hash-384-v1.json")],
        [resource.join("dist-runtime").join("runtime").join("embedding").join("local-hash-384-v1.json"), resource.join("_up_").join("dist-runtime").join("runtime").join("embedding").join("local-hash-384-v1.json")],
        configured_embedding,
        std::iter::empty(),
    )
        .into_iter()
        .find(|path| path.is_file())
        .and_then(canonical_path);
    let embedding = embedding_path.is_some();
    persist_runtime_paths(&data, &[
        ("nodePath", node_path.as_ref()), ("opencodePath", opencode_path.as_ref()), ("pythonPath", python_path.as_ref()),
        ("hostPath", host_path.as_ref()), ("knowledgePath", knowledge_path.as_ref()), ("skillsPath", skill_path.as_ref()), ("fontsPath", fonts_path.as_ref()),
        ("lancedbPath", lancedb_path.as_ref()), ("embeddingPath", embedding_path.as_ref()),
    ])?;
    let result = serde_json::json!({ "ready": node && opencode && python && skills && fonts && migrations && host && knowledge && lancedb && embedding, "development": cfg!(debug_assertions), "node": node, "opencode": opencode, "python": python, "skills": skills, "fonts": fonts, "migrations": migrations, "host": host, "knowledge": knowledge, "lancedb": lancedb, "embedding": embedding, "semanticRag": lancedb, "paths": { "node": node_path, "opencode": opencode_path, "python": python_path, "host": host_path, "knowledge": knowledge_path, "skills": skill_path, "fonts": fonts_path, "lancedb": lancedb_path, "embedding": embedding_path } });
    if result.get("ready").and_then(serde_json::Value::as_bool) == Some(true) {
        write_runtime_probe_cache(&data, &runtime_probe_fingerprint(&data, &resource), &result);
    }
    Ok(result)
}

const RUNTIME_PROBE_CACHE_FILE: &str = ".runtime-probe-cache.json";

fn development_runtime_directory() -> Option<PathBuf> {
    let manifest_runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist-runtime");
    let current_runtime = std::env::current_dir().ok()?.join("apps").join("desktop").join("dist-runtime");
    [manifest_runtime, current_runtime].into_iter().find(|path| path.is_dir())
}

#[derive(Debug, Deserialize, Serialize)]
struct RuntimeProbeCache {
    fingerprint: String,
    result: serde_json::Value,
}

fn runtime_probe_fingerprint(data: &Path, resource: &Path) -> String {
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("dist-runtime");
    [
        ("development-host", development.join("host.mjs")),
        ("development-knowledge", development.join("knowledge.mjs")),
        ("development-skill-catalog", development.join("skill-catalog.json")),
        ("development-skills", development.join("skills")),
        ("native-runtime-v3", resource.join("dist-runtime/skill-catalog.json")),
        ("up-skill-catalog", resource.join("_up_/dist-runtime/skill-catalog.json")),
        ("native-host", resource.join("dist-runtime/host.mjs")),
        ("up-host", resource.join("_up_/dist-runtime/host.mjs")),
        ("native-knowledge", resource.join("dist-runtime/knowledge.mjs")),
        ("up-knowledge", resource.join("_up_/dist-runtime/knowledge.mjs")),
        ("private-runtime-manifest", data.join("runtime/runtime-manifest.json")),
        ("config", data.join("config.json")),
        ("database", data.join("app.db")),
        ("resource", resource.to_path_buf()),
        ("manifest", resource.join("runtime-manifest.json")),
        ("dist-manifest", resource.join("dist-runtime").join("runtime").join("runtime-manifest.json")),
        ("up-dist-manifest", resource.join("_up_").join("dist-runtime").join("runtime").join("runtime-manifest.json")),
    ]
    .into_iter()
    .map(|(label, path)| format!("{label}={}:{}", path.to_string_lossy(), path_stamp(&path)))
    .collect::<Vec<_>>()
    .join("|")
}

fn path_stamp(path: &Path) -> String {
    let Ok(metadata) = fs::metadata(path) else { return "missing".to_string(); };
    let modified = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_nanos()).unwrap_or_default();
    format!("{}:{modified}", metadata.len())
}

fn read_runtime_probe_cache(data: &Path, fingerprint: &str) -> Option<serde_json::Value> {
    let path = data.join(RUNTIME_PROBE_CACHE_FILE);
    let cache = serde_json::from_str::<RuntimeProbeCache>(&fs::read_to_string(path).ok()?).ok()?;
    (cache.fingerprint == fingerprint && cache.result.get("ready").and_then(serde_json::Value::as_bool) == Some(true)).then_some(cache.result)
}

fn write_runtime_probe_cache(data: &Path, fingerprint: &str, result: &serde_json::Value) {
    let path = data.join(RUNTIME_PROBE_CACHE_FILE);
    let cache = RuntimeProbeCache { fingerprint: fingerprint.to_string(), result: result.clone() };
    if let Ok(serialized) = serde_json::to_vec(&cache) {
        let _ = fs::write(path, serialized);
    }
}

fn invalidate_runtime_probe_cache(data: &Path) {
    let _ = fs::remove_file(data.join(RUNTIME_PROBE_CACHE_FILE));
}

fn read_local_skill_catalog(candidates: impl IntoIterator<Item = PathBuf>) -> Result<serde_json::Value, String> {
    for candidate in candidates {
        if !candidate.is_file() { continue; }
        let raw = fs::read_to_string(&candidate).map_err(|error| error.to_string())?;
        let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| error.to_string())?;
        let valid = value.get("schemaVersion").and_then(serde_json::Value::as_u64) == Some(1)
            && value.get("skills").and_then(serde_json::Value::as_array).is_some();
        if valid { return Ok(value); }
    }
    Err("local_skill_catalog_unavailable".to_string())
}

#[tauri::command]
fn list_local_skill_catalog(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let data = data_dir(&app)?;
    let development = development_runtime_directory().unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("apps").join("desktop").join("dist-runtime"));
    let configured_catalog = configured_runtime_path(&data, "skillsPath").and_then(|path| path.parent().map(|parent| parent.join("skill-catalog.json")));
    let mut candidates = Vec::new();
    if cfg!(debug_assertions) { candidates.push(development.join("skill-catalog.json")); }
    candidates.extend([
        resource.join("dist-runtime").join("skill-catalog.json"),
        resource.join("_up_").join("dist-runtime").join("skill-catalog.json"),
    ]);
    if !cfg!(debug_assertions) { candidates.push(development.join("skill-catalog.json")); }
    read_local_skill_catalog(candidates.into_iter().chain(configured_catalog))
}

fn executable_works(path: &std::path::Path, args: &[&str]) -> bool {
    let mut command = Command::new(path);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command.args(args).output().map(|output| output.status.success()).unwrap_or(false)
}

fn canonical_path(path: PathBuf) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok().map(bootstrap::powershell_compatible_path)
}

fn configured_runtime_path(data: &std::path::Path, key: &str) -> Option<PathBuf> {
    let value = config::read(&data.join("config.json"), data).ok()?;
    let path = value.get("runtime")?.get(key)?.as_str().map(PathBuf::from)?;
    std::fs::canonicalize(path).ok().map(bootstrap::powershell_compatible_path)
}

fn configured_runtime_executable(data: &std::path::Path, key: &str) -> Option<PathBuf> {
    configured_runtime_path(data, key).and_then(|path| resolve_windows_command_shim(path).into_iter().find(|candidate| candidate.is_file()))
}

fn ordered_runtime_candidates(
    private: impl IntoIterator<Item = PathBuf>,
    packaged: impl IntoIterator<Item = PathBuf>,
    configured: impl IntoIterator<Item = PathBuf>,
    system: impl IntoIterator<Item = PathBuf>,
) -> Vec<PathBuf> {
    private.into_iter().chain(packaged).chain(configured).chain(system).collect()
}

fn persist_runtime_paths(data: &std::path::Path, updates: &[(&str, Option<&PathBuf>)]) -> Result<(), String> {
    let path = data.join("config.json");
    let mut value = config::read(&path, data)?;
    let runtime = value.get_mut("runtime").and_then(serde_json::Value::as_object_mut).ok_or_else(|| "runtime_required".to_string())?;
    let mut changed = false;
    for (key, candidate) in updates {
        let Some(candidate) = candidate else { continue; };
        let canonical = bootstrap::powershell_compatible_path((*candidate).clone()).to_string_lossy().into_owned();
        if runtime.get(*key).and_then(serde_json::Value::as_str) != Some(canonical.as_str()) {
            runtime.insert((*key).to_string(), serde_json::Value::String(canonical));
            changed = true;
        }
    }
    if changed { config::write(&path, &value)?; }
    Ok(())
}

fn system_executable(command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
    let mut where_command = Command::new("where.exe");
    where_command.creation_flags(0x08000000);
    let output = where_command.arg(command).output().ok()?;
    if !output.status.success() { return None; }
    return String::from_utf8_lossy(&output.stdout).lines().map(str::trim).filter(|line| !line.is_empty()).map(PathBuf::from).flat_map(resolve_windows_command_shim).filter(|path| path.exists() && executable_works(path, &["--version"])).find_map(canonical_path);
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("which").arg(command).output().ok()?;
        if !output.status.success() { return None; }
        String::from_utf8_lossy(&output.stdout).lines().map(str::trim).find(|line| !line.is_empty()).map(PathBuf::from).filter(|path| path.is_file() && executable_works(path, &["--version"])).and_then(canonical_path)
    }
}

#[derive(Debug, Deserialize, Default)]
struct RuntimeRepairOptions {
    #[serde(rename = "offlineZip")]
    offline_zip: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct RuntimeProgressEvent {
    message: String,
}

fn emit_runtime_progress(app: &tauri::AppHandle, message: impl Into<String>) {
    let _ = app.emit("desktop://runtime-progress", RuntimeProgressEvent { message: message.into() });
}

fn discover_offline_runtime_zip(resource: &Path) -> Option<PathBuf> {
    let executable = std::env::current_exe().ok();
    let mut candidates = vec![resource.join("CoworkAny-Runtime-x64.zip")];
    if let Some(parent) = resource.parent() { candidates.push(parent.join("CoworkAny-Runtime-x64.zip")); }
    if let Some(executable) = executable.and_then(|path| path.parent().map(Path::to_path_buf)) { candidates.push(executable.join("CoworkAny-Runtime-x64.zip")); }
    candidates.into_iter().find(|path| path.is_file()).and_then(|path| std::fs::canonicalize(path).ok()).map(bootstrap::powershell_compatible_path)
}

#[tauri::command]
#[cfg(windows)]
fn repair_runtime(app: tauri::AppHandle, options: Option<RuntimeRepairOptions>) -> Result<serde_json::Value, String> {
    let resource = app.path().resource_dir().map_err(|error| error.to_string())?;
    let manifest = [resource.join("runtime-manifest.json"), resource.join("dist-runtime").join("runtime").join("runtime-manifest.json"), resource.join("_up_").join("dist-runtime").join("runtime").join("runtime-manifest.json")]
        .into_iter().find(|path| path.exists()).ok_or_else(|| "runtime_manifest_missing".to_string())?;
    let script = [
        resource.join("dist-runtime").join("install-desktop-runtime.ps1"),
        resource.join("_up_").join("dist-runtime").join("install-desktop-runtime.ps1"),
        resource.join("install-desktop-runtime.ps1"),
        resource.join("_up_").join("install-desktop-runtime.ps1"),
    ]
        .into_iter().find(|path| path.exists()).ok_or_else(|| "runtime_installer_missing".to_string())?;
    let script_for_powershell = bootstrap::powershell_compatible_path(script);
    let manifest_for_powershell = bootstrap::powershell_compatible_path(manifest);
    // The installer stages `runtime/...` under its install root. Passing the
    // data root (rather than the runtime subdirectory) keeps the resulting
    // layout aligned with all probes and host path resolution.
    let install_root = data_dir(&app)?;
    let install_root_for_powershell = bootstrap::powershell_compatible_path(install_root.clone());
    invalidate_runtime_probe_cache(&install_root);
    let offline_zip = match options.and_then(|value| value.offline_zip) {
        Some(path) => Some(std::fs::canonicalize(PathBuf::from(path)).map(bootstrap::powershell_compatible_path).map_err(|error| format!("offline_runtime_zip_unavailable: {error}"))?),
        None => discover_offline_runtime_zip(&resource),
    };
    emit_runtime_progress(&app, if offline_zip.is_some() { "offline_archive_discovered" } else { "network_runtime_prepare" });
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script_for_powershell)
        .args(["-ManifestPath"])
        .arg(manifest_for_powershell)
        .args(["-InstallRoot"])
        .arg(install_root_for_powershell);
    if let Some(zip) = offline_zip.as_ref() { command.args(["-OfflineZip"]).arg(zip); }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|error| format!("runtime_installer_spawn_failed: {error}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "runtime_installer_stdout_missing".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "runtime_installer_stderr_missing".to_string())?;
    let progress_app = app.clone();
    let progress_root = install_root.clone();
    let stdout_reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            logs::append(&progress_root, "runtime-install", &line);
            if let Some(message) = line.strip_prefix("RUNTIME_PROGRESS:") { emit_runtime_progress(&progress_app, message.trim()); }
        }
    });
    let stderr_root = install_root.clone();
    let stderr_reader = std::thread::spawn(move || {
        BufReader::new(stderr).lines().map_while(Result::ok).inspect(|line| logs::append(&stderr_root, "runtime-install-stderr", line)).collect::<Vec<_>>()
    });
    let started_at = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| format!("runtime_installer_wait_failed: {error}"))? { break status; }
        if started_at.elapsed() > Duration::from_secs(30 * 60) {
            let _ = child.kill();
            let _ = child.wait();
            emit_runtime_progress(&app, "timeout");
            return Err("runtime_install_timeout".to_string());
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let _ = stdout_reader.join();
    let stderr_lines = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        let detail = stderr_lines.join(" ").trim().chars().take(800).collect::<String>();
        emit_runtime_progress(&app, "failed");
        return Err(format!("runtime_install_failed: {detail}"));
    }
    emit_runtime_progress(&app, "ready");
    Ok(serde_json::json!({ "status": "ok", "installRoot": install_root }))
}

#[tauri::command]
#[cfg(not(windows))]
fn repair_runtime(_app: tauri::AppHandle, _options: Option<RuntimeRepairOptions>) -> Result<serde_json::Value, String> {
    // macOS runtime executables are sealed inside the signed application bundle.
    // Downloading or replacing them after notarization would invalidate the
    // distribution security model, so repair is intentionally fail-closed.
    Err("runtime_repair_requires_signed_macos_bundle".to_string())
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(storage::data_root(&platform::distribution_root(&executable), configured_local_app_data(&app)))
}

/// Older green packages and user instructions sometimes placed `config.json`
/// beside the executable. Portable storage is intentionally rooted at
/// the platform-specific portable data directory, but importing that misplaced file is safe when the data config is
/// still uses the untouched first-run text provider. Merge only provider
/// configuration so existing portable media profiles and runtime paths are
/// preserved.
fn migrate_portable_root_config(executable_dir: &Path) -> Result<bool, String> {
    if !executable_dir.join("portable.flag").exists() { return Ok(false); }
    let misplaced = executable_dir.join("config.json");
    if !misplaced.is_file() { return Ok(false); }
    let data = executable_dir.join(platform::portable_data_directory());
    let target = data.join("config.json");
    let current = config::read(&target, &data)?;
    if !is_default_portable_text_config(&current) { return Ok(false); }
    let imported = config::read(&misplaced, executable_dir)?;
    if !is_usable_desktop_config(&imported) || is_default_portable_text_config(&imported) { return Ok(false); }
    let merged = merge_portable_provider_config(&current, &imported);
    if merged == current { return Ok(false); }
    config::write(&target, &merged)?;
    Ok(true)
}

fn portable_default_workspace_path(executable_dir: &Path, configured: &Path) -> Option<PathBuf> {
    if !executable_dir.join("portable.flag").is_file() { return None; }
    let configured_name = configured.file_name()?.to_str()?;
    let data_name = configured.parent()?.file_name()?.to_str()?;
    let portable_root = configured.parent()?.parent()?;
    let portable_name = portable_root.file_name()?.to_str()?;
    let generated_package = portable_name.starts_with("CoworkAny-Windows-") || portable_name.starts_with("CoworkAny-macOS-");
    if !configured_name.eq_ignore_ascii_case("projects") || !data_name.eq_ignore_ascii_case(platform::portable_data_directory()) || !generated_package { return None; }
    let current = executable_dir.join(platform::portable_data_directory()).join("projects");
    if configured == current { return None; }
    Some(current)
}

fn repair_portable_workspace_config(executable_dir: &Path, data: &Path, value: &mut serde_json::Value) -> Result<bool, String> {
    let Some(configured) = value.get("workspacePath").and_then(serde_json::Value::as_str).map(PathBuf::from) else { return Ok(false); };
    let Some(current) = portable_default_workspace_path(executable_dir, &configured) else { return Ok(false); };
    // This exact shape is the package-generated default. An external
    // workspace remains user-owned because it does not match this shape.
    value["workspacePath"] = serde_json::Value::String(current.to_string_lossy().into_owned());
    fs::create_dir_all(&current).map_err(|error| format!("portable_workspace_create_failed: {error}"))?;
    config::write(&data.join("config.json"), value)?;
    Ok(true)
}

fn is_usable_desktop_config(value: &serde_json::Value) -> bool {
    value.get("schemaVersion").and_then(serde_json::Value::as_i64) == Some(1)
        && value.get("workspacePath").and_then(serde_json::Value::as_str).is_some_and(|path| !path.trim().is_empty())
        && value.get("provider").and_then(serde_json::Value::as_object).and_then(|provider| provider.get("model")).and_then(serde_json::Value::as_str).is_some_and(|model| !model.trim().is_empty())
        && value.get("runtime").and_then(serde_json::Value::as_object).is_some()
}

fn is_default_portable_text_config(value: &serde_json::Value) -> bool {
    value.get("provider").and_then(serde_json::Value::as_object).is_some_and(|provider| {
        provider.get("id").and_then(serde_json::Value::as_str) == Some("local")
            && matches!(provider.get("model").and_then(serde_json::Value::as_str), Some("") | Some("ollama/qwen3:8b"))
    })
}

fn merge_portable_provider_config(current: &serde_json::Value, imported: &serde_json::Value) -> serde_json::Value {
    let mut merged = current.clone();
    if let Some(provider) = imported.get("provider") { merged["provider"] = provider.clone(); }
    if let Some(imported_profiles) = imported.get("providers").and_then(serde_json::Value::as_object) {
        let mut profiles = merged.get("providers").and_then(serde_json::Value::as_object).cloned().unwrap_or_default();
        for (id, profile) in imported_profiles { profiles.insert(id.clone(), profile.clone()); }
        merged["providers"] = serde_json::Value::Object(profiles);
    }
    if let Some(imported_defaults) = imported.get("defaults").and_then(serde_json::Value::as_object) {
        let mut defaults = merged.get("defaults").and_then(serde_json::Value::as_object).cloned().unwrap_or_default();
        for (capability, provider_id) in imported_defaults { defaults.insert(capability.clone(), provider_id.clone()); }
        merged["defaults"] = serde_json::Value::Object(defaults);
    }
    merged
}

fn configured_local_app_data(app: &tauri::AppHandle) -> Option<PathBuf> {
    #[cfg(windows)]
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return Some(PathBuf::from(local_app_data).join("CoworkAny"));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        return Some(PathBuf::from(home).join("Library").join("Application Support").join("CoworkAny"));
    }
    app.path().app_local_data_dir().ok()
}

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> { Ok(data_dir(app)?.join("app.db")) }

fn project_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = data_dir(app)?;
    let configured = config::read(&data.join("config.json"), &data)?.get("workspacePath").and_then(serde_json::Value::as_str).map(PathBuf::from);
    let root = configured.unwrap_or_else(|| data.join("projects"));
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let name = root.file_name().and_then(|value| value.to_str()).unwrap_or("CoworkAny");
    storage::upsert_project(&data.join("app.db"), &root.to_string_lossy(), name).map_err(|error| error.to_string())?;
    Ok(root)
}

const MAX_ATTACHMENT_BYTES: usize = 512 * 1024 * 1024;
const MAX_ATTACHMENT_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_ATTACHMENT_NAME_CHARS: usize = 180;
static ATTACHMENT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn safe_attachment_name(file_name: &str) -> String {
    let original = std::path::Path::new(&file_name).file_name().and_then(|value| value.to_str()).unwrap_or("attachment.bin");
    let safe_name: String = original.chars().map(|character| if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ' | '(' | ')') { character } else { '_' }).collect();
    if safe_name.trim().is_empty() { "attachment.bin".to_string() } else { safe_name.trim().chars().take(MAX_ATTACHMENT_NAME_CHARS).collect() }
}

fn attachment_relative_path(file_name: &str, stamp: u128) -> String {
    let sequence = ATTACHMENT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("attachments/{}-{}-{}", stamp, sequence, safe_attachment_name(file_name))
}

fn attachment_target(app: &tauri::AppHandle, relative_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = project_root(app)?;
    let relative = std::path::Path::new(relative_path);
    if relative.is_absolute() || relative.components().any(|component| matches!(component, std::path::Component::ParentDir)) || !relative_path.starts_with("attachments/") { return Err("attachment_path_escape".to_string()); }
    let target = root.join(&relative_path);
    if !target.starts_with(&root) { return Err("attachment_path_escape".to_string()); }
    Ok((root, target))
}

fn attachment_partial_target(target: &PathBuf) -> PathBuf { target.with_file_name(format!("{}.part", target.file_name().and_then(|value| value.to_str()).unwrap_or("attachment.bin"))) }

#[tauri::command]
fn begin_local_attachment(app: tauri::AppHandle, file_name: String, byte_length: usize) -> Result<serde_json::Value, String> {
    if byte_length > MAX_ATTACHMENT_BYTES { return Err("attachment_too_large".to_string()); }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or(0);
    let relative_path = attachment_relative_path(&file_name, stamp);
    let root = project_root(&app)?;
    let target = root.join(&relative_path);
    if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    fs::File::create(attachment_partial_target(&target)).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "relativePath": relative_path, "byteLength": 0, "expectedByteLength": byte_length }))
}

#[tauri::command]
fn append_local_attachment_chunk(app: tauri::AppHandle, relative_path: String, offset: usize, bytes: Vec<u8>) -> Result<serde_json::Value, String> {
    if bytes.len() > MAX_ATTACHMENT_CHUNK_BYTES { return Err("attachment_chunk_too_large".to_string()); }
    let (_root, target) = attachment_target(&app, &relative_path)?;
    let partial = attachment_partial_target(&target);
    let current = fs::metadata(&partial).map_err(|error| format!("attachment_unavailable: {error}"))?.len() as usize;
    if current != offset { return Err("attachment_chunk_offset_mismatch".to_string()); }
    if current.saturating_add(bytes.len()) > MAX_ATTACHMENT_BYTES { return Err("attachment_too_large".to_string()); }
    let mut file = fs::OpenOptions::new().append(true).open(&partial).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "relativePath": relative_path, "byteLength": current + bytes.len() }))
}

#[tauri::command]
fn finish_local_attachment(app: tauri::AppHandle, relative_path: String, expected_byte_length: usize) -> Result<serde_json::Value, String> {
    let (_root, target) = attachment_target(&app, &relative_path)?;
    let partial = attachment_partial_target(&target);
    let actual = fs::metadata(&partial).map_err(|error| format!("attachment_unavailable: {error}"))?.len() as usize;
    if actual != expected_byte_length { return Err("attachment_size_mismatch".to_string()); }
    fs::rename(&partial, &target).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "relativePath": relative_path, "byteLength": actual }))
}

#[tauri::command]
fn abort_local_attachment(app: tauri::AppHandle, relative_path: String) -> Result<(), String> {
    let (_root, target) = attachment_target(&app, &relative_path)?;
    let partial = attachment_partial_target(&target);
    if partial.exists() { fs::remove_file(partial).map_err(|error| error.to_string())?; }
    if target.exists() { fs::remove_file(target).map_err(|error| error.to_string())?; }
    Ok(())
}

fn safe_media_component(value: &str, fallback: &str) -> String {
    let sanitized: String = value.chars().map(|character| if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') { character } else { '_' }).collect();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() { fallback.to_string() } else { trimmed.chars().take(96).collect() }
}

#[tauri::command]
fn allocate_media_temp(app: tauri::AppHandle, run_id: String, node_key: String) -> Result<serde_json::Value, String> {
    if run_id.trim().is_empty() || node_key.trim().is_empty() { return Err("media_temp_identity_required".to_string()); }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or(0);
    let relative_path = format!("artifacts/.tmp/{}/{}/{}", safe_media_component(&run_id, "run"), safe_media_component(&node_key, "node"), stamp);
    let root = project_root(&app)?;
    let target = root.join(&relative_path);
    if !target.starts_with(&root) { return Err("media_temp_path_escape".to_string()); }
    fs::create_dir_all(&target).map_err(|error| format!("media_temp_create_failed: {error}"))?;
    Ok(serde_json::json!({ "relativePath": relative_path }))
}

#[tauri::command]
fn write_writer_draft(app: tauri::AppHandle, content: String) -> Result<artifacts::ArtifactMetadata, String> {
    if content.trim().is_empty() { return Err("writer_draft_empty".to_string()); }
    if content.len() > 10 * 1024 * 1024 { return Err("writer_draft_too_large".to_string()); }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or(0);
    let relative_path = format!("articles/coworkany-writer-{}.md", stamp);
    let root = project_root(&app)?;
    let target = root.join(&relative_path);
    if !target.starts_with(&root) { return Err("writer_draft_path_escape".to_string()); }
    write_file_atomically(&target, content.as_bytes())?;
    let metadata = artifacts::inspect(&root, &relative_path, "text/markdown")?;
    storage::register_artifact(&database_path(&app)?, &format!("writer-draft-{}", stamp), None, &metadata).map_err(|error| error.to_string())?;
    Ok(metadata)
}

#[tauri::command]
fn inspect_artifact(app: tauri::AppHandle, relative_path: String, mime_type: String) -> Result<artifacts::ArtifactMetadata, String> {
    artifacts::inspect(&project_root(&app)?, &relative_path, &mime_type)
}

#[tauri::command]
fn register_artifact(app: tauri::AppHandle, artifact_id: String, project_id: Option<String>, relative_path: String, mime_type: String) -> Result<artifacts::ArtifactMetadata, String> {
  let metadata = artifacts::inspect(&project_root(&app)?, &relative_path, &mime_type)?;
  storage::register_artifact(&database_path(&app)?, &artifact_id, project_id.as_deref(), &metadata).map_err(|error| error.to_string())?;
  Ok(metadata)
}

fn reconcile_persisted_artifacts(root: &std::path::Path, database: &std::path::Path) -> Result<(), String> {
  for candidate in storage::artifact_reconciliation_candidates(database).map_err(|error| error.to_string())? {
    if let Ok(metadata) = artifacts::inspect(root, &candidate.relative_path, &candidate.mime_type) {
      storage::register_artifact(database, &candidate.id, None, &metadata).map_err(|error| error.to_string())?;
    }
  }
  Ok(())
}

#[tauri::command]
fn list_artifacts(app: tauri::AppHandle) -> Result<Vec<storage::ArtifactRow>, String> {
  let root = project_root(&app)?;
  let database = database_path(&app)?;
  reconcile_persisted_artifacts(&root, &database)?;
  let mut rows = storage::list_artifacts(&database).map_err(|error| error.to_string())?;
    for row in &mut rows {
        row.available = artifacts::inspect(&root, &row.relative_path, &row.mime_type).is_ok();
    }
    Ok(rows)
}

#[tauri::command]
fn remove_artifact(app: tauri::AppHandle, artifact_id: String) -> Result<(), String> {
    storage::remove_artifact(&database_path(&app)?, &artifact_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_diagnostics(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let data = data_dir(&app)?;
    let diagnostics_root = data.join("diagnostics");
    fs::create_dir_all(&diagnostics_root).map_err(|error| error.to_string())?;
    let stamp = format!("{}-{}", chrono_like_timestamp(), std::process::id());
    let staging = diagnostics_root.join(format!("staging-{stamp}"));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let mut config_value = config::read(&data.join("config.json"), &data)?;
    redact_diagnostic_value(&mut config_value);
    fs::write(staging.join("config.redacted.json"), serde_json::to_vec_pretty(&config_value).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    fs::write(staging.join("metadata.json"), serde_json::to_vec_pretty(&serde_json::json!({ "version": env!("CARGO_PKG_VERSION"), "dataRoot": "[REDACTED]", "createdAt": stamp })).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let logs = data.join("logs");
    if logs.exists() { copy_directory(&logs, &staging.join("logs"))?; }
    let zip_path = diagnostics_root.join(format!("CoworkAny-diagnostics-{stamp}.zip"));
    archive_diagnostics(&staging, &zip_path)?;
    let _ = fs::remove_dir_all(&staging);
    Ok(serde_json::json!({ "path": zip_path, "redacted": true }))
}

fn redact_diagnostic_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Array(items) => items.iter_mut().for_each(redact_diagnostic_value),
        serde_json::Value::Object(object) => {
            for (key, nested) in object.iter_mut() {
                let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
                if normalized == "apikey"
                    || normalized == "key"
                    || normalized.ends_with("key")
                    || normalized.contains("token")
                    || normalized.contains("secret")
                    || normalized.contains("password")
                    || normalized.contains("authorization")
                    || normalized.contains("credential")
                {
                    *nested = serde_json::Value::String("[REDACTED]".to_string());
                } else {
                    redact_diagnostic_value(nested);
                }
            }
        }
        _ => {}
    }
}

fn chrono_like_timestamp() -> String {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_secs().to_string()).unwrap_or_else(|_| "unknown".to_string())
}

fn write_file_atomically(target: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    if target.exists() { return Err("atomic_target_exists".to_string()); }
    let parent = target.parent().ok_or_else(|| "atomic_target_parent_missing".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or(0);
    let temporary = target.with_extension(format!("{}.{}.tmp", target.extension().and_then(|value| value.to_str()).unwrap_or("artifact"), stamp));
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, target).map_err(|error| error.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

fn powershell_quote(value: &str) -> String { value.replace('\'', "''") }

fn archive_diagnostics(staging: &std::path::Path, zip_path: &std::path::Path) -> Result<(), String> {
    let source = powershell_quote(&staging.to_string_lossy());
    let destination = powershell_quote(&zip_path.to_string_lossy());
    let command = format!("Compress-Archive -Path '{}\\*' -DestinationPath '{}' -Force", source, destination);
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .map_err(|error| format!("diagnostics_archive_spawn_failed: {error}"))?;
    if !output.status.success() { return Err(format!("diagnostics_archive_failed: {}", String::from_utf8_lossy(&output.stderr).trim())); }
    Ok(())
}

fn copy_directory(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() { copy_directory(&entry.path(), &target)?; } else { fs::copy(entry.path(), target).map_err(|error| error.to_string())?; }
    }
    Ok(())
}

/// Open an artifact through the Windows shell without passing the path through
/// `cmd.exe`; this preserves spaces and shell metacharacters in user filenames.
#[cfg(windows)]
fn open_with_default_program(target: &Path) -> Result<(), String> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation: Vec<u16> = std::ffi::OsStr::new("open").encode_wide().chain(iter::once(0)).collect();
    let file: Vec<u16> = target.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    if (result as isize) <= 32 { return Err(format!("default_program_open_failed:{}", result as isize)); }
    Ok(())
}

#[cfg(not(windows))]
fn open_with_default_program(target: &Path) -> Result<(), String> {
    platform::open_path_command(target).spawn().map(|_| ()).map_err(|error| format!("default_program_spawn_failed: {error}"))
}

#[tauri::command]
fn open_workspace(app: tauri::AppHandle) -> Result<(), String> {
    let root = project_root(&app)?;
    platform::open_path_command(&root).spawn().map(|_| ()).map_err(|error| format!("workspace_open_failed: {error}"))
}

#[tauri::command]
fn pick_directory(initial_path: Option<String>) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let initial = initial_path.unwrap_or_default();
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.ShowNewFolderButton = $true
$initial = [Environment]::GetEnvironmentVariable('COWORKANY_PICK_INITIAL', 'Process')
if ($initial -and (Test-Path -LiteralPath $initial -PathType Container)) { $dialog.SelectedPath = $initial }
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }
"#;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script])
            .env("COWORKANY_PICK_INITIAL", initial)
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| format!("directory_picker_spawn_failed: {error}"))?;
        if !output.status.success() { return Err(format!("directory_picker_failed:{}", output.status.code().unwrap_or(-1))); }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((!selected.is_empty()).then_some(selected));
    }
    #[cfg(not(windows))]
    {
        let _ = initial_path;
        Ok(None)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalWorkflowFile {
    file_name: String,
    local_path: String,
    mime_type: String,
    byte_length: u64,
}

fn workflow_file_mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", "gif" => "image/gif",
        "mp4" => "video/mp4", "mov" => "video/quicktime", "webm" => "video/webm",
        "mp3" => "audio/mpeg", "wav" => "audio/wav", "m4a" => "audio/mp4", "ogg" => "audio/ogg",
        "pdf" => "application/pdf", "txt" => "text/plain", "md" => "text/markdown", "csv" => "text/csv", "json" => "application/json",
        "doc" => "application/msword", "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "ppt" => "application/vnd.ms-powerpoint", "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
fn pick_workflow_files() -> Result<Vec<LocalWorkflowFile>, String> {
    #[cfg(windows)]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $true
$dialog.Filter = 'Supported files|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.mp4;*.mov;*.webm;*.mp3;*.wav;*.m4a;*.ogg;*.pdf;*.txt;*.md;*.doc;*.docx;*.csv;*.json;*.ppt;*.pptx|All files|*.*'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.FileNames | ForEach-Object { [Console]::Out.WriteLine($_) } }
"#;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| format!("workflow_file_picker_spawn_failed: {error}"))?;
        if !output.status.success() { return Err(format!("workflow_file_picker_failed:{}", output.status.code().unwrap_or(-1))); }
        let files = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let path = PathBuf::from(line.trim());
                let metadata = fs::metadata(&path).ok()?;
                if !metadata.is_file() { return None; }
                Some(LocalWorkflowFile {
                    file_name: path.file_name()?.to_string_lossy().to_string(),
                    local_path: path.to_string_lossy().to_string(),
                    mime_type: workflow_file_mime_type(&path).to_string(),
                    byte_length: metadata.len(),
                })
            })
            .take(8)
            .collect::<Vec<_>>();
        return Ok(files);
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

fn workflow_export_file_name(suggested_name: &str) -> String {
    let name = Path::new(suggested_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("coworkany-workflow.json");
    let sanitized = name.chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
        .collect::<String>();
    let stem = sanitized.trim_matches('.');
    if stem.is_empty() { return "coworkany-workflow.json".to_string(); }
    if stem.to_ascii_lowercase().ends_with(".json") { stem.to_string() } else { format!("{stem}.json") }
}

#[tauri::command]
fn save_workflow_export(content: String, suggested_name: String) -> Result<Option<String>, String> {
    const MAX_EXPORT_BYTES: usize = 10 * 1024 * 1024;
    if content.len() > MAX_EXPORT_BYTES { return Err("workflow_export_too_large".to_string()); }
    let file_name = workflow_export_file_name(&suggested_name);
    #[cfg(windows)]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Filter = 'JSON files|*.json|All files|*.*'
$dialog.DefaultExt = 'json'
$dialog.AddExtension = $true
$dialog.FileName = [Environment]::GetEnvironmentVariable('COWORKANY_WORKFLOW_EXPORT_NAME', 'Process')
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }
"#;
        let output = Command::new("powershell.exe")
            .env("COWORKANY_WORKFLOW_EXPORT_NAME", &file_name)
            .args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| format!("workflow_export_dialog_spawn_failed: {error}"))?;
        if !output.status.success() { return Err(format!("workflow_export_dialog_failed:{}", output.status.code().unwrap_or(-1))); }
        let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if target.is_empty() { return Ok(None); }
        fs::write(&target, content.as_bytes()).map_err(|error| format!("workflow_export_write_failed: {error}"))?;
        return Ok(Some(target));
    }
    #[cfg(not(windows))]
    {
        let _ = (content, file_name);
        Ok(None)
    }
}

fn workflow_output_file_name(suggested_name: &str, mime_type: &str) -> String {
    let raw = Path::new(suggested_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workflow-output");
    let sanitized = raw.chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '_' | '.' | ' '))
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if !sanitized.is_empty() && sanitized.contains('.') { return sanitized; }
    let extension = match mime_type {
        value if value.starts_with("image/") => "png",
        value if value.starts_with("video/") => "mp4",
        value if value.starts_with("audio/") => "mp3",
        "text/markdown" => "md",
        "text/html" => "html",
        "application/json" => "json",
        value if value.contains("presentation") => "pptx",
        _ => "txt",
    };
    format!("{}.{}", if sanitized.is_empty() { "workflow-output" } else { sanitized.as_str() }, extension)
}

#[tauri::command]
fn save_workflow_output(
    app: tauri::AppHandle,
    content: Option<String>,
    local_path: Option<String>,
    relative_path: Option<String>,
    mime_type: String,
    file_name: String,
) -> Result<Option<String>, String> {
    const MAX_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;
    let bytes = if let Some(value) = content {
        if value.len() as u64 > MAX_OUTPUT_BYTES { return Err("workflow_output_too_large".to_string()); }
        value.into_bytes()
    } else if let Some(value) = local_path {
        let source = PathBuf::from(value.trim());
        if !source.is_absolute() { return Err("workflow_output_path_invalid".to_string()); }
        let metadata = fs::metadata(&source).map_err(|error| format!("workflow_output_unavailable: {error}"))?;
        if !metadata.is_file() || metadata.len() > MAX_OUTPUT_BYTES { return Err("workflow_output_unavailable".to_string()); }
        fs::read(&source).map_err(|error| format!("workflow_output_read_failed: {error}"))?
    } else if let Some(value) = relative_path {
        let root = project_root(&app)?;
        let metadata = artifacts::inspect(&root, &value, &mime_type)?;
        if metadata.byte_length > MAX_OUTPUT_BYTES { return Err("workflow_output_too_large".to_string()); }
        let source = root.join(metadata.relative_path);
        fs::read(&source).map_err(|error| format!("workflow_output_read_failed: {error}"))?
    } else {
        return Err("workflow_output_missing_source".to_string());
    };
    let suggested_name = workflow_output_file_name(&file_name, &mime_type);
    #[cfg(windows)]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Filter = 'All files|*.*'
$dialog.FileName = [Environment]::GetEnvironmentVariable('COWORKANY_OUTPUT_NAME', 'Process')
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }
"#;
        let output = Command::new("powershell.exe")
            .env("COWORKANY_OUTPUT_NAME", &suggested_name)
            .args(["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script])
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| format!("workflow_output_dialog_spawn_failed: {error}"))?;
        if !output.status.success() { return Err(format!("workflow_output_dialog_failed:{}", output.status.code().unwrap_or(-1))); }
        let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if target.is_empty() { return Ok(None); }
        fs::write(&target, bytes).map_err(|error| format!("workflow_output_write_failed: {error}"))?;
        return Ok(Some(target));
    }
    #[cfg(not(windows))]
    {
        let _ = (bytes, suggested_name);
        Ok(None)
    }
}

#[tauri::command]
fn read_workflow_local_file(local_path: String, mime_type: String) -> Result<serde_json::Value, String> {
    const MAX_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;
    let path = PathBuf::from(local_path.trim());
    if !path.is_absolute() { return Err("workflow_local_file_path_invalid".to_string()); }
    let metadata = fs::metadata(&path).map_err(|error| format!("workflow_local_file_unavailable: {error}"))?;
    if !metadata.is_file() { return Err("workflow_local_file_unavailable".to_string()); }
    if metadata.len() > MAX_PREVIEW_BYTES { return Err("workflow_local_file_preview_too_large".to_string()); }
    let bytes = fs::read(&path).map_err(|error| format!("workflow_local_file_read_failed: {error}"))?;
    Ok(serde_json::json!({ "mimeType": mime_type, "data": bytes }))
}

#[tauri::command]
fn open_artifact(app: tauri::AppHandle, relative_path: String, mime_type: String) -> Result<(), String> {
    let root = project_root(&app)?;
    let metadata = artifacts::inspect(&root, &relative_path, &mime_type)?;
    let target = root.join(metadata.relative_path);
    platform::reveal_path_command(&target).spawn().map(|_| ()).map_err(|error| format!("artifact_reveal_failed: {error}"))
}

#[tauri::command]
fn open_artifact_folder(app: tauri::AppHandle, relative_path: String, mime_type: String) -> Result<(), String> {
    let root = project_root(&app)?;
    let metadata = artifacts::inspect(&root, &relative_path, &mime_type)?;
    let target = root.join(metadata.relative_path);
    let folder = target.parent().ok_or_else(|| "artifact_folder_missing".to_string())?;
    platform::open_path_command(folder).spawn().map(|_| ()).map_err(|error| format!("artifact_folder_open_failed: {error}"))
}

#[cfg(windows)]
fn open_with_installed_program(target: &Path) -> Result<(), String> {
    use std::iter;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation: Vec<u16> = std::ffi::OsStr::new("openas").encode_wide().chain(iter::once(0)).collect();
    let file: Vec<u16> = target.as_os_str().encode_wide().chain(iter::once(0)).collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    if (result as isize) <= 32 { return Err(format!("open_with_program_failed:{}", result as isize)); }
    Ok(())
}

#[cfg(not(windows))]
fn open_with_installed_program(target: &Path) -> Result<(), String> {
    platform::open_path_command(target).spawn().map(|_| ()).map_err(|error| format!("open_with_program_spawn_failed: {error}"))
}

#[tauri::command]
fn open_artifact_default(app: tauri::AppHandle, relative_path: String, mime_type: String) -> Result<(), String> {
    let root = project_root(&app)?;
    let metadata = artifacts::inspect(&root, &relative_path, &mime_type)?;
    let target = root.join(metadata.relative_path);
    open_with_default_program(&target)
}

#[tauri::command]
fn open_artifact_with(app: tauri::AppHandle, relative_path: String, mime_type: String) -> Result<(), String> {
    let root = project_root(&app)?;
    let metadata = artifacts::inspect(&root, &relative_path, &mime_type)?;
    let target = root.join(metadata.relative_path);
    open_with_installed_program(&target)
}

#[tauri::command]
fn read_artifact(app: tauri::AppHandle, relative_path: String, mime_type: String) -> Result<serde_json::Value, String> {
    const MAX_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;
    let root = project_root(&app)?;
    let metadata = artifacts::inspect(&root, &relative_path, &mime_type)?;
    if metadata.byte_length > MAX_PREVIEW_BYTES {
        return Err("artifact_preview_too_large".to_string());
    }
    let target = root.join(metadata.relative_path);
    let bytes = std::fs::read(&target).map_err(|error| format!("artifact_read_failed: {error}"))?;
    Ok(serde_json::json!({ "mimeType": metadata.mime_type, "data": bytes }))
}

#[tauri::command]
fn open_vault_file(app: tauri::AppHandle, relative_path: String) -> Result<(), String> {
    let data = data_dir(&app)?;
    let vault = config::read(&data.join("config.json"), &data)?
        .get("obsidianVaultPath")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "obsidian_vault_not_configured".to_string())?;
    let root = std::fs::canonicalize(&vault).map_err(|error| format!("obsidian_vault_unavailable: {error}"))?;
    let requested = root.join(relative_path);
    let target = std::fs::canonicalize(&requested).map_err(|error| format!("obsidian_file_unavailable: {error}"))?;
    if target != root && !target.starts_with(&root) { return Err("obsidian_path_escape".to_string()); }
    platform::reveal_path_command(&target).spawn().map(|_| ()).map_err(|error| format!("obsidian_file_reveal_failed: {error}"))
}

#[tauri::command]
fn read_config(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let data = data_dir(&app)?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable_dir = platform::distribution_root(&executable);
    let mut value = config::read(&data.join("config.json"), &data)?;
    repair_portable_workspace_config(&executable_dir, &data, &mut value)?;
    Ok(value)
}

#[tauri::command]
fn write_config(app: tauri::AppHandle, value: serde_json::Value) -> Result<(), String> {
    let data = data_dir(&app)?;
    config::write(&data.join("config.json"), &value)?;
    if let (Some(vault), Some(index)) = (value.get("obsidianVaultPath").and_then(serde_json::Value::as_str), value.get("obsidianIndexPath").and_then(serde_json::Value::as_str)) {
        storage::upsert_vault_mapping(&data.join("app.db"), vault, index, value.get("embeddingModel").and_then(serde_json::Value::as_str).unwrap_or("local-hash-384-v1"), value.get("embeddingDimension").and_then(serde_json::Value::as_i64).unwrap_or(384)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn runtime_paths(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let distribution_root = platform::distribution_root(&executable);
    let portable = distribution_root.join("portable.flag").exists();
    let data = storage::data_root(&distribution_root, configured_local_app_data(&app));
    Ok(serde_json::json!({
        "mode": if portable { "portable" } else { "normal" },
        "data": data,
    }))
}

#[tauri::command]
fn initialize_local_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let data = data_dir(&app)?;
    let database = data.join("app.db");
    storage::initialize(&database).map_err(|error| error.to_string())?;
    let interrupted = storage::recover_interrupted(&database).map_err(|error| error.to_string())?;
    let healthy = storage::integrity(&database).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "database": database, "integrity": healthy, "interruptedRuns": interrupted }))
}

#[derive(Debug, Deserialize)]
struct ConversationInput { id: String, title: String, project_id: Option<String>, agent_id: Option<String> }

#[tauri::command]
fn create_conversation(app: tauri::AppHandle, input: ConversationInput) -> Result<storage::ConversationRow, String> {
    let path = database_path(&app)?;
    storage::create_conversation(&path, &input.id, &input.title, input.project_id.as_deref(), input.agent_id.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_conversation_session(app: tauri::AppHandle, conversation_id: String, session_id: String) -> Result<(), String> {
    storage::set_session_id(&database_path(&app)?, &conversation_id, &session_id).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
struct MessageInput { id: String, conversation_id: String, role: String, content: String, parts_json: Option<String>, metadata_json: Option<String>, created_at: Option<String> }

#[tauri::command]
fn append_message(app: tauri::AppHandle, input: MessageInput) -> Result<(), String> {
    storage::append_message(&database_path(&app)?, &input.id, &input.conversation_id, &input.role, &input.content, input.parts_json.as_deref(), input.metadata_json.as_deref(), input.created_at.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_run(app: tauri::AppHandle, run_id: String, conversation_id: Option<String>, model: Option<String>) -> Result<(), String> {
    storage::create_run(&database_path(&app)?, &run_id, conversation_id.as_deref(), model.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn append_run_event(app: tauri::AppHandle, run_id: String, sequence: i64, event_type: String, payload_json: String) -> Result<(), String> {
    storage::append_run_event(&database_path(&app)?, &run_id, sequence, &event_type, &payload_json).map_err(|error| error.to_string())
}

#[tauri::command]
fn finish_run(app: tauri::AppHandle, run_id: String, status: String) -> Result<(), String> {
    storage::finish_run(&database_path(&app)?, &run_id, &status).map_err(|error| error.to_string())
}

#[tauri::command]
fn record_usage(app: tauri::AppHandle, run_id: String, provider: Option<String>, model: String, input_tokens: Option<i64>, output_tokens: Option<i64>, provider_cost: Option<f64>, estimated_cost: Option<f64>, idempotency_key: Option<String>) -> Result<(), String> {
    storage::record_usage(&database_path(&app)?, &run_id, provider.as_deref(), &model, input_tokens, output_tokens, provider_cost, estimated_cost, idempotency_key.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn record_run_node(app: tauri::AppHandle, run_id: String, node_key: String, status: String, output_json: Option<String>) -> Result<(), String> {
    storage::record_run_node(&database_path(&app)?, &run_id, &node_key, &status, output_json.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn record_run_checkpoint(app: tauri::AppHandle, run_id: String, checkpoint_key: String, sequence: i64, output_json: String) -> Result<(), String> {
    storage::record_run_checkpoint(&database_path(&app)?, &run_id, &checkpoint_key, sequence, &output_json).map_err(|error| error.to_string())
}

#[tauri::command]
fn record_run_attempt(app: tauri::AppHandle, idempotency_key: String, run_id: String, node_key: String, provider: Option<String>, provider_task_id: Option<String>, status: String, payload_json: Option<String>) -> Result<(), String> {
    storage::record_run_attempt(&database_path(&app)?, &idempotency_key, &run_id, &node_key, provider.as_deref(), provider_task_id.as_deref(), &status, payload_json.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_conversations(app: tauri::AppHandle) -> Result<Vec<storage::ConversationRow>, String> {
    storage::list_conversations(&database_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_messages(app: tauri::AppHandle, conversation_id: String, limit: Option<i64>, before_created_at: Option<String>, before_id: Option<String>) -> Result<Vec<storage::MessageRow>, String> {
    storage::list_messages_page(&database_path(&app)?, &conversation_id, limit, before_created_at.as_deref(), before_id.as_deref()).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_runs(app: tauri::AppHandle) -> Result<Vec<storage::RunRow>, String> {
    storage::list_runs(&database_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn inspect_run(app: tauri::AppHandle, run_id: String) -> Result<storage::RunDetail, String> {
    storage::inspect_run(&database_path(&app)?, &run_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_recoverable_attempts(app: tauri::AppHandle) -> Result<Vec<storage::RunAttemptRow>, String> {
    storage::list_recoverable_attempts(&database_path(&app)?).map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
struct WorkflowInput { id: String, name: String, project_id: Option<String>, definition_json: String }

#[tauri::command]
fn save_workflow(app: tauri::AppHandle, input: WorkflowInput) -> Result<storage::WorkflowRow, String> {
    if serde_json::from_str::<serde_json::Value>(&input.definition_json).is_err() { return Err("workflow_definition_invalid_json".to_string()); }
    storage::save_workflow(&database_path(&app)?, &input.id, &input.name, input.project_id.as_deref(), &input.definition_json).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_workflows(app: tauri::AppHandle) -> Result<Vec<storage::WorkflowRow>, String> {
    storage::list_workflows(&database_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_workflow(app: tauri::AppHandle, workflow_id: String) -> Result<(), String> {
    storage::remove_workflow(&database_path(&app)?, &workflow_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn usage_summary(app: tauri::AppHandle) -> Result<storage::UsageSummary, String> {
    storage::usage_summary(&database_path(&app)?).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let lock_path = match lock_path() {
        Ok(path) => path,
        Err(error) => { eprintln!("CoworkAny cannot resolve instance lock path: {error}"); bootstrap::show_startup_error(&error); return; }
    };
    let instance_lock = match instance_lock::InstanceLock::acquire(lock_path) {
        Ok(lock) => lock,
        Err(error) => { eprintln!("CoworkAny cannot acquire instance lock: {error}"); bootstrap::show_startup_error(&error); return; }
    };
    if let Ok(executable) = std::env::current_exe() {
        let executable_dir = platform::distribution_root(&executable);
        match migrate_portable_root_config(&executable_dir) {
            Ok(true) => eprintln!("CoworkAny imported portable config from the executable directory into data/config.json"),
            Ok(false) => {},
            Err(error) => eprintln!("CoworkAny could not import the portable config: {error}"),
        }
    }
    let startup_progress = bootstrap::StartupProgress::new(bootstrap::StartupStage::Starting);
    startup_progress.show_stage(bootstrap::StartupStage::WebView);
    if let Err(error) = bootstrap::ensure_webview2(&startup_progress) {
        eprintln!("CoworkAny cannot start without WebView2: {error}");
        startup_progress.update(&format!("WebView2 unavailable: {error}"));
        bootstrap::show_startup_error(&error);
        instance_lock.release();
        return;
    }
    // Runtime installation/probing is intentionally handled by the React
    // bootstrap screen after the Tauri window exists. WebView2 must be ready
    // before creating the window, but the green runtime can be repaired while
    // the user sees progress and diagnostics instead of a blank native shell.
    startup_progress.show_stage(bootstrap::StartupStage::Runtime);
    startup_progress.show_stage(bootstrap::StartupStage::Workbench);
    let builder = tauri::Builder::default()
        .manage(instance_lock)
        .manage(host::HostState::default())
        .invoke_handler(tauri::generate_handler![health, runtime_probe, list_local_skill_catalog, repair_runtime, runtime_paths, initialize_local_state, read_config, write_config, begin_local_attachment, append_local_attachment_chunk, finish_local_attachment, abort_local_attachment, allocate_media_temp, write_writer_draft, inspect_artifact, register_artifact, list_artifacts, remove_artifact, export_diagnostics, open_workspace, pick_directory, pick_workflow_files, save_workflow_export, save_workflow_output, open_artifact, open_artifact_folder, open_artifact_default, open_artifact_with, read_artifact, read_workflow_local_file, open_vault_file, create_conversation, set_conversation_session, append_message, create_run, append_run_event, finish_run, record_usage, record_run_node, record_run_checkpoint, record_run_attempt, list_conversations, list_messages, list_runs, inspect_run, list_recoverable_attempts, save_workflow, list_workflows, remove_workflow, usage_summary, host::host_start, host::host_send, host::host_stop]);
    let app = builder.build(tauri::generate_context!()).expect("error while building CoworkAny");
    drop(startup_progress);
    app.run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<host::HostState>() { let _ = host::stop_state(state.inner()); }
                if let Some(lock) = app.try_state::<instance_lock::InstanceLock>() { lock.release(); }
            }
        });
}

fn lock_path() -> Result<std::path::PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let distribution_root = platform::distribution_root(&executable);
    let normal_data = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(|value| std::path::PathBuf::from(value).join("CoworkAny"))
    } else {
        std::env::var_os("HOME").map(|value| std::path::PathBuf::from(value).join("Library").join("Application Support").join("CoworkAny"))
    };
    let data_root = storage::data_root(&distribution_root, normal_data);
    // Keep the lock adjacent to the data root rather than inside it. The
    // first-run runtime installer atomically swaps the whole data directory;
    // a lock file held by this process inside that directory would make the
    // Windows rename fail before the first WebView can be created.
    Ok(adjacent_instance_lock_path(&data_root))
}

fn adjacent_instance_lock_path(data_root: &Path) -> PathBuf {
    let name = data_root.file_name().and_then(|value| value.to_str()).unwrap_or("CoworkAny");
    data_root.parent().unwrap_or(data_root).join(format!("{name}.instance.lock"))
}

#[cfg(test)]
mod tests {
    use super::{adjacent_instance_lock_path, archive_diagnostics, attachment_relative_path, bootstrap, config, configured_runtime_executable, is_default_portable_text_config, is_usable_desktop_config, migrate_portable_root_config, ordered_runtime_candidates, persist_runtime_paths, platform, portable_default_workspace_path, powershell_quote, read_local_skill_catalog, read_runtime_probe_cache, redact_diagnostic_value, resolve_windows_command_shim, safe_attachment_name, safe_media_component, workflow_export_file_name, write_file_atomically, write_runtime_probe_cache, MAX_ATTACHMENT_NAME_CHARS};
    use std::fs;
    use std::path::{Path, PathBuf};

    #[test]
    fn media_temp_components_are_workspace_safe_and_bounded() {
        assert_eq!(safe_media_component("run:with\\separators", "run"), "run_with_separators");
        assert_eq!(safe_media_component("../", "node"), "node");
        assert!(safe_media_component(&"x".repeat(200), "node").len() <= 96);
    }

    #[test]
    fn runtime_install_lock_stays_outside_swapped_data_root() {
        let data_root = Path::new("C:/Users/test/AppData/Local/CoworkAny");
        let lock = adjacent_instance_lock_path(data_root);
        assert_eq!(lock, PathBuf::from("C:/Users/test/AppData/Local/CoworkAny.instance.lock"));
        assert_ne!(lock.parent(), Some(data_root));
    }

    #[test]
    fn portable_config_migrates_a_misplaced_root_config_only_over_the_first_run_default() {
        let root = std::env::temp_dir().join(format!("coworkany-portable-config-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let portable_data = platform::portable_data_directory();
        fs::create_dir_all(root.join(portable_data)).unwrap();
        fs::write(root.join("portable.flag"), b"").unwrap();
        let mut portable_default = config::default_config(&root.join(portable_data));
        portable_default["providers"] = serde_json::json!({
            "image-main": {
                "id": "image-main",
                "kind": "image",
                "source": "runninghub",
                "model": "seedream-5"
            }
        });
        config::write(&root.join(portable_data).join("config.json"), &portable_default).unwrap();
        let mut imported = config::default_config(&root);
        imported["provider"]["id"] = serde_json::json!("text-main");
        imported["provider"]["model"] = serde_json::json!("deepseek-v4-flash");
        imported["provider"]["models"] = serde_json::json!(["deepseek-v4-flash", "deepseek-chat"]);
        imported["provider"]["source"] = serde_json::json!("deepseek");
        imported["providers"] = serde_json::json!({
            "text-main": {
                "id": "text-main",
                "kind": "text",
                "source": "deepseek",
                "model": "deepseek-v4-flash"
            }
        });
        imported["defaults"] = serde_json::json!({ "text": "text-main" });
        config::write(&root.join("config.json"), &imported).unwrap();

        assert!(is_default_portable_text_config(&config::read(&root.join(portable_data).join("config.json"), &root.join(portable_data)).unwrap()));
        assert!(is_usable_desktop_config(&imported));
        assert!(migrate_portable_root_config(&root).unwrap());
        let migrated = config::read(&root.join(portable_data).join("config.json"), &root.join(portable_data)).unwrap();
        assert_eq!(migrated["provider"]["model"], "deepseek-v4-flash");
        assert_eq!(migrated["provider"]["models"][1], "deepseek-chat");
        assert!(migrated["providers"]["image-main"].is_object());
        assert!(migrated["providers"]["text-main"].is_object());
        assert_eq!(migrated["defaults"]["text"], "text-main");
        assert!(!is_default_portable_text_config(&migrated));

        let mut existing = migrated.clone();
        existing["provider"]["model"] = serde_json::json!("keep-this-model");
        config::write(&root.join(portable_data).join("config.json"), &existing).unwrap();
        assert!(!migrate_portable_root_config(&root).unwrap());
        assert_eq!(config::read(&root.join(portable_data).join("config.json"), &root.join(portable_data)).unwrap()["provider"]["model"], "keep-this-model");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn portable_default_workspace_moves_with_the_current_package() {
        let base = std::env::temp_dir().join(format!("coworkany-portable-workspace-{}", std::process::id()));
        let package_name = if cfg!(target_os = "windows") { "CoworkAny-Windows-x64-portable" } else { "CoworkAny-macOS-arm64-portable" };
        let data_name = platform::portable_data_directory();
        let root = base.join("desktop-release-gray-20260826").join(package_name);
        let stale = base.join("desktop-release-gray-20260824").join(package_name).join(package_name).join(data_name).join("projects");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("portable.flag"), b"").unwrap();
        assert_eq!(portable_default_workspace_path(&root, &stale), Some(root.join(data_name).join("projects")));
        assert_eq!(portable_default_workspace_path(&root, &root.join(data_name).join("projects")), None);
        assert_eq!(portable_default_workspace_path(&root, Path::new(r"D:\work\marketing")), None);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn attachment_names_are_bounded_and_duplicate_uploads_are_unique() {
        let long_name = format!("{}.png", "名".repeat(400));
        let first = attachment_relative_path(&long_name, 42);
        let second = attachment_relative_path(&long_name, 42);
        assert_ne!(first, second);
        assert!(first.starts_with("attachments/42-"));
        assert!(safe_attachment_name(&long_name).chars().count() <= MAX_ATTACHMENT_NAME_CHARS);
        assert!(!first.contains(".."));
    }

    #[test]
    fn runtime_probe_persists_canonical_paths_and_reuses_them() {
        let root = std::env::temp_dir().join(format!("coworkany-runtime-paths-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let config_path = root.join("config.json");
        config::write(&config_path, &config::default_config(&root)).unwrap();
        let node = root.join("runtime-node.exe");
        fs::write(&node, b"fixture").unwrap();
        let canonical = fs::canonicalize(&node).unwrap();

        persist_runtime_paths(&root, &[("nodePath", Some(&canonical))]).unwrap();

        let saved = config::read(&config_path, &root).unwrap();
        let normalized = bootstrap::powershell_compatible_path(canonical.clone());
        let canonical_text = normalized.to_string_lossy().into_owned();
        assert_eq!(saved["runtime"]["nodePath"].as_str(), Some(canonical_text.as_str()));
        assert!(configured_runtime_executable(&root, "nodePath").is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_managed_runtime_paths_precede_stale_configured_and_system_paths() {
        let candidates = ordered_runtime_candidates(
            [PathBuf::from("data/runtime")],
            [PathBuf::from("resource/dist-runtime")],
            [PathBuf::from("stale/configured-runtime")],
            [PathBuf::from("system/runtime")],
        );

        assert_eq!(
            candidates,
            vec![
                PathBuf::from("data/runtime"),
                PathBuf::from("resource/dist-runtime"),
                PathBuf::from("stale/configured-runtime"),
                PathBuf::from("system/runtime"),
            ]
        );
    }

    #[test]
    fn runtime_probe_cache_accepts_only_matching_ready_results() {
        let root = std::env::temp_dir().join(format!("coworkany-runtime-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let result = serde_json::json!({ "ready": true, "paths": { "node": "C:/runtime/node.exe" } });
        write_runtime_probe_cache(&root, "fingerprint-a", &result);
        assert_eq!(read_runtime_probe_cache(&root, "fingerprint-a"), Some(result.clone()));
        assert_eq!(read_runtime_probe_cache(&root, "fingerprint-b"), None);
        let not_ready = serde_json::json!({ "ready": false });
        write_runtime_probe_cache(&root, "fingerprint-a", &not_ready);
        assert_eq!(read_runtime_probe_cache(&root, "fingerprint-a"), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn local_skill_catalog_uses_the_valid_bundled_manifest() {
        let root = std::env::temp_dir().join(format!("coworkany-skill-catalog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let invalid = root.join("invalid.json");
        let valid = root.join("skill-catalog.json");
        fs::write(&invalid, r#"{"schemaVersion":1}"#).unwrap();
        fs::write(&valid, r#"{"schemaVersion":1,"skills":[{"id":"writer","relativePath":"writer/SKILL.md","digest":"fixture"}]}"#).unwrap();
        let catalog = read_local_skill_catalog([invalid, valid]).unwrap();
        assert_eq!(catalog["skills"][0]["id"], "writer");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn windows_command_shims_resolve_to_real_opencode_executable() {
        let root = std::env::temp_dir().join(format!("coworkany-command-shim-{}", std::process::id()));
        let bin = root.join("node_modules").join("opencode-ai").join("bin");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&bin).unwrap();
        let executable = bin.join("opencode.exe");
        fs::write(&executable, b"fixture").unwrap();
        let candidates = resolve_windows_command_shim(root.join("opencode.cmd"));
        if cfg!(windows) {
            assert!(candidates.iter().any(|candidate| candidate == &executable));
            assert_eq!(candidates.iter().find(|candidate| candidate.is_file()), Some(&executable));
        } else {
            assert_eq!(candidates, vec![root.join("opencode.cmd")]);
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn startup_gates_run_before_tauri_builder() {
        let source = include_str!("lib.rs");
        let webview_gate = source.find("bootstrap::ensure_webview2(&startup_progress)").expect("webview gate missing");
        let builder = source.find("let builder = tauri::Builder::default()").expect("tauri builder missing");
        assert!(webview_gate < builder, "WebView2 must be ready before Tauri creates the window");
        assert!(source[webview_gate..builder].contains("instance_lock.release()"));
        assert!(!source[webview_gate..builder].contains("ensure_runtime_before_window"), "runtime repair must not block the first Tauri window");
        assert!(source.contains("bootstrap::StartupProgress::new"));
        assert!(source.contains("startup_progress.show_stage(bootstrap::StartupStage::WebView)"));
        assert!(source.contains("startup_progress.show_stage(bootstrap::StartupStage::Runtime)"));
        assert!(source.contains("startup_progress.show_stage(bootstrap::StartupStage::Workbench)"));
    }

    #[test]
    fn release_binary_uses_the_windows_gui_subsystem() {
        let source = include_str!("main.rs");
        assert!(source.contains("windows_subsystem = \"windows\""));
    }

    #[test]
    fn diagnostic_redaction_recurses_without_touching_non_secret_config() {
        let mut value = serde_json::json!({
            "provider": { "apiKey": "provider-secret", "model": "gpt-5.4" },
            "nested": { "access_token": "token-secret", "privateKey": "key-secret", "authorization": "Bearer secret", "label": "中文" },
            "items": [{ "password": "password-secret", "value": 7 }]
        });

        redact_diagnostic_value(&mut value);

        assert_eq!(value["provider"]["apiKey"], "[REDACTED]");
        assert_eq!(value["nested"]["access_token"], "[REDACTED]");
        assert_eq!(value["nested"]["privateKey"], "[REDACTED]");
        assert_eq!(value["nested"]["authorization"], "[REDACTED]");
        assert_eq!(value["nested"]["label"], "中文");
        assert_eq!(value["items"][0]["password"], "[REDACTED]");
        assert_eq!(value["items"][0]["value"], 7);
    }

    #[test]
    fn writer_artifacts_use_atomic_utf8_file_activation() {
        let root = std::env::temp_dir().join(format!("coworkany-atomic-writer-{}", std::process::id()));
        let target = root.join("articles").join("draft.md");
        let _ = fs::remove_dir_all(&root);
        write_file_atomically(&target, "中文 draft".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "中文 draft");
        assert_eq!(write_file_atomically(&target, b"second"), Err("atomic_target_exists".to_string()));
        let files = fs::read_dir(root.join("articles")).unwrap().map(|entry| entry.unwrap().file_name()).collect::<Vec<_>>();
        assert_eq!(files, vec![std::ffi::OsString::from("draft.md")]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workflow_export_names_are_safe_json_files() {
        assert_eq!(workflow_export_file_name("campaign.json"), "campaign.json");
        assert_eq!(workflow_export_file_name("../../campaign"), "campaign.json");
        assert_eq!(workflow_export_file_name("<invalid>"), "invalid.json");
        assert_eq!(workflow_export_file_name("..."), "coworkany-workflow.json");
    }

    #[cfg(windows)]
    #[test]
    fn diagnostic_archive_contains_only_redacted_config() {
        let root = std::env::temp_dir().join(format!("coworkany-diagnostics-{}", std::process::id()));
        let staging = root.join("staging");
        let archive = root.join("diagnostics.zip");
        let extracted = root.join("extracted");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&staging).unwrap();
        let mut value = serde_json::json!({ "provider": { "apiKey": "archive-secret" }, "label": "中文" });
        redact_diagnostic_value(&mut value);
        fs::write(staging.join("config.redacted.json"), serde_json::to_vec(&value).unwrap()).unwrap();

        archive_diagnostics(&staging, &archive).unwrap();
        let command = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            powershell_quote(&archive.to_string_lossy()),
            powershell_quote(&extracted.to_string_lossy())
        );
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &command])
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let archived = fs::read_to_string(extracted.join("config.redacted.json")).unwrap();
        assert!(!archived.contains("archive-secret"));
        assert!(archived.contains("[REDACTED]"));
        assert!(archived.contains("中文"));
        let _ = fs::remove_dir_all(root);
    }
}
