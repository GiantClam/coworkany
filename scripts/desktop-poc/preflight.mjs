import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { homedir, platform as hostPlatform } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export function commandOutput(command, args = [], runner = execFileSync) {
  try { return runner(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { return ""; }
}

export function commandAvailable(command, output = commandOutput("which", [command])) {
  if (command.startsWith("/")) return existsSync(command);
  return Boolean(output);
}

export function checkPortAvailability(port) {
  return new Promise((resolveAvailable) => {
    const server = createServer();
    const finish = (available) => { server.removeAllListeners(); resolveAvailable(available); };
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => finish(true)));
  });
}

function check(name, status, details = {}) { return { name, status, ...details }; }

function parseEnvelope(output) {
  try {
    const value = JSON.parse(output);
    return value?.ok === true ? value.data ?? value : null;
  } catch { return null; }
}

export function agentDesktopCheck({ available = commandAvailable("agent-desktop"), output = commandOutput } = {}) {
  if (!available) return check("agent-desktop", "external_agent_required", { detail: "agent-desktop command not found" });
  const versionRaw = output("agent-desktop", ["version"]);
  const permissionsRaw = output("agent-desktop", ["permissions"]);
  const versionData = parseEnvelope(versionRaw);
  const permissions = parseEnvelope(permissionsRaw) ?? {};
  const accessibility = permissions.accessibility?.state === "granted";
  const screenRecording = permissions.screen_recording?.state === "granted";
  const automation = permissions.automation?.state === "granted";
  const missing = [!accessibility && "accessibility", !screenRecording && "screen_recording", !automation && "automation"].filter(Boolean);
  return check("agent-desktop", missing.length ? "manual_required" : "pass", {
    version: versionData?.version ?? "unknown",
    accessibility: permissions.accessibility?.state ?? "unknown",
    screenRecording: permissions.screen_recording?.state ?? "unknown",
    automation: permissions.automation?.state ?? "unknown",
    missingPermissions: missing,
  });
}

export function jevCredentialsAvailable({ environment = process.env, home = homedir(), exists = existsSync } = {}) {
  return Boolean(environment.JEV_API_KEY?.trim()) || exists(join(home, "model-clis", "jev", "credentials.json"));
}

export function jevCheck({ available = commandAvailable("jev"), credentialsAvailable = jevCredentialsAvailable(), output = commandOutput } = {}) {
  if (!available) return check("jev", "blocked", { detail: "jev is required for native and publication runs" });
  if (!credentialsAvailable) return check("jev", "blocked", { detail: "Jev API credentials are required; set JEV_API_KEY or run `jev login`" });
  const version = output("jev", ["--version"]) || output("jev", ["version"]);
  return check("jev", version ? "pass" : "blocked", { version: version || "unknown", detail: version ? undefined : "jev CLI did not return a version" });
}

export function accessibilityProbe({ available, output = commandOutput, appName = "CoworkAny" } = {}) {
  if (!available) return check("accessibility-probe", "manual_required", { detail: "osascript not available" });
  const script = `tell application "System Events" to exists process "${appName.replaceAll('"', "")}"`;
  const result = output("osascript", ["-e", script]);
  return check("accessibility-probe", result === "true" ? "pass" : "manual_required", { app: appName, observed: result || "false" });
}

export async function runPreflight({ repoRoot = resolve(process.env.COWORKANY_DESKTOP_POC_REPO ?? process.cwd()), port = 1420, environment = process.env, platform = hostPlatform(), commandAvailableFn = commandAvailable, commandOutputFn = commandOutput, jevCredentialsAvailableFn = jevCredentialsAvailable } = {}) {
  const checks = [];
  checks.push(check("platform", platform === "darwin" ? "pass" : "blocked", { observed: platform }));
  checks.push(check("repository", existsSync(join(repoRoot, "apps/desktop/src-tauri/tauri.conf.json")) ? "pass" : "blocked", { repoRoot }));
  for (const command of ["node", "pnpm", "cargo", "osascript"]) checks.push(check(`command:${command}`, commandAvailableFn(command) ? "pass" : "blocked"));
  checks.push(check("screencapture", commandAvailableFn("/usr/sbin/screencapture") ? "pass" : "manual_required"));
  checks.push(accessibilityProbe({ available: commandAvailableFn("osascript"), output: commandOutputFn }));
  checks.push(agentDesktopCheck({ available: commandAvailableFn("agent-desktop"), output: commandOutputFn }));
  checks.push(jevCheck({ available: commandAvailableFn("jev"), credentialsAvailable: jevCredentialsAvailableFn({ environment }), output: commandOutputFn }));
  const portFree = await checkPortAvailability(port);
  checks.push(check("dev-port", portFree ? "pass" : "port_conflict", { port }));
  const gitStatus = commandOutputFn("git", ["-C", repoRoot, "status", "--short"]);
  checks.push(check("working-tree", gitStatus ? "manual_required" : "pass", { dirty: Boolean(gitStatus), entries: gitStatus ? gitStatus.split(/\r?\n/u).filter(Boolean).length : 0 }));
  const defaultDataRoot = join(homedir(), "Library", "Application Support", "CoworkAny");
  const runRoot = resolve(environment.COWORKANY_DESKTOP_POC_RUN_DIR ?? join(environment.COWORKANY_DESKTOP_POC_BASE ?? "/tmp/coworkany-desktop-poc", environment.COWORKANY_DESKTOP_POC_RUN_ID ?? "preflight"));
  const isolated = runRoot !== defaultDataRoot && !runRoot.startsWith(`${defaultDataRoot}/`);
  checks.push(check("isolated-data-root", isolated ? "pass" : "blocked", { runRoot, defaultDataRoot }));
  const blocking = checks.filter((item) => ["blocked", "port_conflict"].includes(item.status));
  const manual = checks.filter((item) => ["manual_required", "external_agent_required", "optional_external_agent_missing"].includes(item.status));
  const selector = checks.find((item) => item.name === "jev")?.status === "pass" ? "jev" : "jev-required";
  return { ok: blocking.length === 0 && manual.length === 0, readiness: blocking.length ? "blocked" : manual.length ? "manual_required" : "ready", generatedAt: new Date().toISOString(), repoRoot, port, actionSelector: selector, checks, blocking, manual };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const allowManual = process.argv.includes("--allow-manual");
  const result = await runPreflight();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok && (!allowManual || result.readiness === "blocked")) process.exitCode = 1;
}
