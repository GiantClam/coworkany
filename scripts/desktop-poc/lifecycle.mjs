import { closeSync, lstatSync, openSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, rename, writeFile, lstat, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORT = 1420;
export const OWNER_KIND = "coworkany-desktop-poc";
const SCRIPT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_REPO_ROOT = resolve(process.env.COWORKANY_DESKTOP_POC_REPO ?? process.cwd());
const DEFAULT_RUN_BASE = resolve(process.env.COWORKANY_DESKTOP_POC_BASE ?? join(tmpdir(), "coworkany-desktop-poc"));
const OWNER_FILE = ".coworkany-desktop-poc-owner.json";

function nowId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14).toLowerCase();
  return `run-${stamp}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

function runIdFromRoot(root) {
  const value = basename(root);
  if (!/^run-[a-z0-9-]+$/iu.test(value)) throw new Error("poc_run_root_name_invalid");
  return value;
}

function rejectSymlinkSync(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("poc_symlink_path_forbidden");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function resolveRunRoot(environment = process.env) {
  const explicit = environment.COWORKANY_DESKTOP_POC_RUN_DIR;
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error("poc_run_root_must_be_absolute");
    return resolve(explicit);
  }
  const runId = environment.COWORKANY_DESKTOP_POC_RUN_ID ?? nowId();
  if (!/^run-[a-z0-9-]+$/iu.test(runId)) throw new Error("poc_run_id_invalid");
  return join(resolve(environment.COWORKANY_DESKTOP_POC_BASE ?? DEFAULT_RUN_BASE), runId);
}

export function assertSafeRunRoot(root, environment = process.env) {
  const resolvedRoot = resolve(root);
  if (resolvedRoot === "/" || resolvedRoot === SCRIPT_ROOT) throw new Error("poc_run_root_too_broad");
  rejectSymlinkSync(resolvedRoot);
  const explicit = environment.COWORKANY_DESKTOP_POC_RUN_DIR;
  if (!explicit) {
    const base = resolve(environment.COWORKANY_DESKTOP_POC_BASE ?? DEFAULT_RUN_BASE);
    rejectSymlinkSync(base);
    const rest = relative(base, resolvedRoot);
    if (!rest || rest.startsWith("..") || isAbsolute(rest)) throw new Error("poc_run_root_outside_base");
  }
  if (basename(resolvedRoot) !== runIdFromRoot(resolvedRoot)) throw new Error("poc_run_root_name_invalid");
  return resolvedRoot;
}

export function layoutForRun(root, environment = process.env) {
  const resolvedRoot = assertSafeRunRoot(root, environment);
  return {
    root: resolvedRoot,
    owner: join(resolvedRoot, OWNER_FILE),
    state: join(resolvedRoot, "run.json"),
    pid: join(resolvedRoot, "app.pid"),
    log: join(resolvedRoot, "dev.log"),
    dataRoot: join(resolvedRoot, "data"),
    evidenceRoot: join(resolvedRoot, "evidence"),
  };
}

async function readJson(path, missingCode) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") throw new Error(missingCode); throw error; }
}

export async function atomicWriteJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("poc_owned_directory_invalid");
}

async function ensureOwnedLayout(root, runId) {
  const layout = layoutForRun(root);
  rejectSymlinkSync(layout.root);
  await ensureDirectory(layout.root);
  let owner;
  try {
    owner = JSON.parse(await readFile(layout.owner, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    owner = { kind: OWNER_KIND, runId, nonce: randomUUID(), createdAt: new Date().toISOString() };
    await writeFile(layout.owner, `${JSON.stringify(owner, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  assertOwner(owner, runId);
  await ensureDirectory(layout.dataRoot);
  await ensureDirectory(layout.evidenceRoot);
  return { layout, owner };
}

export function assertOwner(owner, expectedRunId) {
  if (!owner || owner.kind !== OWNER_KIND || owner.runId !== expectedRunId || typeof owner.nonce !== "string" || !owner.nonce) throw new Error("poc_run_owner_mismatch");
  return owner;
}

async function readOwnedRun(root) {
  const layout = layoutForRun(root);
  const runId = runIdFromRoot(layout.root);
  const owner = assertOwner(await readJson(layout.owner, "poc_run_not_found"), runId);
  const state = await readJson(layout.state, "poc_run_not_found");
  if (state.kind !== OWNER_KIND || state.runId !== runId || state.ownerNonce !== owner.nonce) throw new Error("poc_run_owner_mismatch");
  if (resolve(state.dataRoot) !== layout.dataRoot || resolve(state.evidenceRoot) !== layout.evidenceRoot) throw new Error("poc_run_path_mismatch");
  return { layout, owner, state };
}

export function processGroupRows(pid) {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,pgid=,command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output.split(/\r?\n/u).flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/u);
      if (!match || Number(match[2]) !== pid) return [];
      return [{ pid: Number(match[1]), pgid: Number(match[2]), command: match[3] }];
    });
  } catch { return []; }
}

export function processStartToken(pid) {
  try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

export function processGroupBelongsToRunRows(rows, state) {
  if (!Array.isArray(rows) || !rows.length || !state || !Number.isInteger(Number(state.pid))) return false;
  const leader = rows.find((row) => Number(row.pid) === Number(state.pid));
  if (!leader) return false;
  if (state.pidStartToken && leader.startToken && state.pidStartToken !== leader.startToken) return false;
  const repo = normalize(resolve(String(state.repoRoot ?? "")));
  if (!repo || repo === ".") return false;
  const hasExactRepo = rows.some((row) => normalize(String(row.command ?? "")).includes(repo));
  const hasExpectedCommand = rows.some((row) => /(?:pnpm|tauri|cargo)[^\n]*(?:tauri:dev|tauri\s+dev|dev\s+--host)/iu.test(String(row.command ?? "")));
  return hasExactRepo && hasExpectedCommand;
}

export function processGroupBelongsToRun(pid, state) {
  const rows = processGroupRows(pid).map((row) => ({ ...row, startToken: processStartToken(row.pid) }));
  return processGroupBelongsToRunRows(rows, state);
}

function processGroupExists(pid) { return processGroupRows(pid).length > 0; }

function portIsAvailable(port) {
  return new Promise((resolveAvailable) => {
    const server = createServer();
    const finish = (available) => { server.removeAllListeners(); resolveAvailable(available); };
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => finish(true)));
  });
}

export { portIsAvailable };

async function waitForDevServer(port, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (response.status >= 200 && response.status < 500) return true;
    } catch { /* still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return false;
}

async function terminateOwnedRun(state, layout) {
  const pid = Number(state.pid);
  if (!Number.isInteger(pid) || pid < 1 || !processGroupExists(pid)) return false;
  if (!processGroupBelongsToRun(pid, state)) throw new Error("poc_process_ownership_unverified");
  try { process.kill(-pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && processGroupExists(pid)) await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  if (processGroupExists(pid)) {
    if (!processGroupBelongsToRun(pid, state)) throw new Error("poc_process_ownership_unverified");
    try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  return true;
}

export async function startRun({ root = resolveRunRoot(), repoRoot = DEFAULT_REPO_ROOT, port = DEFAULT_PORT, waitMs = 45_000, reuse = false } = {}) {
  if (process.platform !== "darwin") throw new Error("poc_requires_macos");
  const resolvedRoot = assertSafeRunRoot(root);
  const runId = runIdFromRoot(resolvedRoot);
  const { layout, owner } = await ensureOwnedLayout(resolvedRoot, runId);
  const resolvedRepo = await realpath(resolve(repoRoot));
  const previous = await readFile(layout.state, "utf8").then((text) => JSON.parse(text)).catch((error) => { if (error?.code === "ENOENT") return null; throw error; });
  if (previous?.status === "running" && processGroupExists(Number(previous.pid))) throw new Error("poc_run_already_running");
  if (reuse && previous && resolve(previous.dataRoot) !== layout.dataRoot) throw new Error("poc_restart_data_root_mismatch");
  if (!(await portIsAvailable(port))) throw new Error(`dev_port_occupied:${port}`);
  const logFd = openSync(layout.log, reuse ? "a" : "w");
  let child;
  try {
    child = spawn("pnpm", ["--dir", resolvedRepo, "tauri:dev"], {
      cwd: resolvedRepo,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, COWORKANY_DESKTOP_POC_DATA_DIR: layout.dataRoot, COWORKANY_DESKTOP_POC_NO_PORT_KILL: "1", COWORKANY_DESKTOP_POC_EVIDENCE_DIR: layout.evidenceRoot },
    });
  } finally { closeSync(logFd); }
  if (!child.pid) throw new Error("poc_process_pid_missing");
  const state = { kind: OWNER_KIND, runId, ownerNonce: owner.nonce, status: "running", pid: child.pid, pidStartToken: processStartToken(child.pid), port, repoRoot: resolvedRepo, dataRoot: layout.dataRoot, evidenceRoot: layout.evidenceRoot, log: layout.log, startedAt: new Date().toISOString(), command: `pnpm --dir ${resolvedRepo} tauri:dev` };
  await atomicWriteJson(layout.state, state);
  await writeFile(layout.pid, `${child.pid}\n`, "utf8");
  child.unref();
  const ready = await waitForDevServer(port, waitMs);
  if (!ready) {
    await terminateOwnedRun(state, layout).catch(() => undefined);
    const failed = { ...state, status: "failed", failedAt: new Date().toISOString(), failure: "poc_dev_server_timeout" };
    await atomicWriteJson(layout.state, failed);
    throw new Error("poc_dev_server_timeout");
  }
  const readyState = { ...state, readyAt: new Date().toISOString() };
  await atomicWriteJson(layout.state, readyState);
  return { layout, state: readyState };
}

export async function stopRun(root = resolveRunRoot()) {
  const { layout, state } = await readOwnedRun(root);
  if (state.status !== "running") return { layout, state };
  await terminateOwnedRun(state, layout);
  const next = { ...state, status: "stopped", stoppedAt: new Date().toISOString() };
  await atomicWriteJson(layout.state, next);
  return { layout, state: next };
}

export async function restartRun(root = resolveRunRoot(), options = {}) {
  const { state } = await readOwnedRun(root);
  await stopRun(root);
  return startRun({ ...options, root, repoRoot: state.repoRoot, port: state.port, reuse: true });
}

export async function statusRun(root = resolveRunRoot()) {
  const { layout, state } = await readOwnedRun(root);
  const pid = Number(state.pid);
  return { layout, state, processGroup: pid > 0 ? processGroupRows(pid) : [], ownedProcess: pid > 0 ? processGroupBelongsToRun(pid, state) : false, portAvailable: await portIsAvailable(Number(state.port ?? DEFAULT_PORT)) };
}

async function assertOwnedDirectory(path, root) {
  const info = await lstat(path).catch((error) => { if (error?.code === "ENOENT") return null; throw error; });
  if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error("poc_owned_directory_invalid");
  if (info) {
    // Compare canonical paths with one another. On macOS, /tmp commonly
    // resolves to /private/tmp, so comparing realpath(path) with the textual
    // path would reject an otherwise owned run directory.
    const canonicalRoot = await realpath(root);
    const canonical = await realpath(path);
    const rest = relative(canonicalRoot, canonical);
    if (!rest || rest.startsWith("..") || isAbsolute(rest)) throw new Error("poc_owned_directory_escape");
  }
}

export async function cleanupRun(root = resolveRunRoot(), { keepEvidence = true } = {}) {
  const { layout, state } = await readOwnedRun(root);
  if (state.status === "running" && processGroupExists(Number(state.pid))) throw new Error("poc_cleanup_requires_stopped_run");
  await assertOwnedDirectory(layout.dataRoot, layout.root);
  await assertOwnedDirectory(layout.evidenceRoot, layout.root);
  await rm(layout.dataRoot, { recursive: true, force: true });
  if (!keepEvidence) await rm(layout.evidenceRoot, { recursive: true, force: true });
  const next = { ...state, status: "cleaned", cleanedAt: new Date().toISOString(), dataRemoved: true, evidenceKept: keepEvidence };
  await atomicWriteJson(layout.state, next);
  return { layout, state: next };
}

async function latestRunRoot() {
  const base = resolve(process.env.COWORKANY_DESKTOP_POC_BASE ?? DEFAULT_RUN_BASE);
  try {
    const entries = await readdir(base, { withFileTypes: true });
    const runs = entries.filter((entry) => entry.isDirectory() && /^run-[a-z0-9-]+$/iu.test(entry.name)).map((entry) => join(base, entry.name)).sort();
    if (runs.at(-1)) return runs.at(-1);
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  throw new Error("poc_run_not_found");
}

export function print(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function main() {
  const command = process.argv[2] ?? "status";
  const root = process.env.COWORKANY_DESKTOP_POC_RUN_DIR ?? (process.env.COWORKANY_DESKTOP_POC_RUN_ID ? resolveRunRoot() : await latestRunRoot().catch(() => resolveRunRoot()));
  try {
    if (command === "start") print(await startRun({ root }));
    else if (command === "stop") print(await stopRun(root));
    else if (command === "restart") print(await restartRun(root));
    else if (command === "status") print(await statusRun(root));
    else if (command === "cleanup") print(await cleanupRun(root, { keepEvidence: !process.argv.includes("--purge-evidence") }));
    else throw new Error(`poc_unknown_lifecycle_command:${command}`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && normalize(resolve(process.argv[1])) === normalize(fileURLToPath(import.meta.url))) void main();
