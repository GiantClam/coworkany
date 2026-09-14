import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const shellPath = new URL("../apps/desktop/src-tauri/src/lib.rs", import.meta.url);
const pythonCommand = process.env.COWORKANY_TEST_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

test("desktop Python probe rejects isolated mode, without inventing PPT output", async () => {
  const source = await readFile(shellPath, "utf8");
  const probe = source.match(/const PPT_PYTHON_PROBE: &str = r#"([\s\S]*?)"#;/u)?.[1];
  assert.ok(probe);
  assert.doesNotMatch(probe, /Presentation\(|add_textbox|presentation\.save/u);
  assert.doesNotMatch(probe, /import pptx|import pathops/u, "runtime selection is independent of one Skill's dependencies");
  assert.match(probe, /getattr\(sys\.flags, ["']safe_path["'], False\)/u, "macOS and older system Python builds must share compatible flag probing");
  // Check path semantics before importing optional skill requirements. An
  // isolated interpreter must not pass readiness even with all packages present.
  const compatibility = probe;
  await assert.rejects(run(pythonCommand, ["-I", "-c", compatibility], { windowsHide: true }), /python_script_path_isolated/u);
  await run(pythonCommand, ["-c", compatibility], { windowsHide: true });
});

test("probe and launch share native runtime and packaged Skill resolution", async () => {
  const source = await readFile(shellPath, "utf8");
  const host = await readFile(new URL("../apps/desktop/src-tauri/src/host.rs", import.meta.url), "utf8");
  assert.match(source, /host::python_executable\(&app\)/u);
  assert.match(source, /host::skills_directory\(&app\)/u);
  assert.match(host, /let skills = skills_directory\(&app\)/u);
  assert.doesNotMatch(source, /fn system_python\(/u);
  assert.match(source, /"native-runtime-v3"/u, "invalidate previously successful isolated-runtime probe caches");
});

test("packaged Python wins over a previously discovered configured interpreter", async () => {
  const host = await readFile(new URL("../apps/desktop/src-tauri/src/host.rs", import.meta.url), "utf8");
  const start = host.indexOf("pub(crate) fn python_executable");
  const end = host.indexOf("pub(crate) fn skills_directory", start);
  const implementation = host.slice(start, end);
  assert.ok(implementation.indexOf('resource.join("dist-runtime")') < implementation.indexOf('configured_runtime_path(app, "pythonPath")'));
});

test("desktop pins OpenCode scratch state to its writable data directory", async () => {
  const host = await readFile(new URL("../apps/desktop/src-tauri/src/host.rs", import.meta.url), "utf8");
  assert.match(host, /let opencode_runtime = crate::data_dir\(&app\)\?/u);
  assert.match(host, /\.env\("OPENCODE_RUNTIME_DIR", opencode_runtime\)/u);
});

test("desktop host does not impose presentation-specific artifact discovery or success gates", async () => {
  const host = await readFile(new URL("../apps/desktop/runtime/host.ts", import.meta.url), "utf8");
  assert.doesNotMatch(host, /detectPresentationArtifacts|ppt_artifact_missing/u);
});
