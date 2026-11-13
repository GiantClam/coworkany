import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { platform } from "node:os";
import { resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultPort = Number(process.argv[2] ?? "1420");

export function parseWindowsListeningPids(output, port = defaultPort) {
  const pids = new Set();
  for (const line of String(output).split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 5 || fields[0] !== "TCP") continue;
    const localAddress = fields[1] ?? "";
    const state = fields.at(-2);
    const pid = Number(fields.at(-1));
    if (state === "LISTENING" && localAddress.endsWith(`:${port}`) && Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function terminateWindowsTree(pid) {
  run("taskkill", ["/PID", String(pid), "/T", "/F"]);
}

function clearWindowsDesktopProcess() {
  const expected = normalize(resolve(repoRoot, "apps/desktop/src-tauri/target/debug/coworkany.exe")).toLowerCase();
  const rows = run("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name = 'coworkany.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.ExecutablePath)\" }"]);
  for (const row of rows.split(/\r?\n/u)) {
    const [pidText, executablePath] = row.split("\t");
    if (executablePath && normalize(executablePath).toLowerCase() === expected) terminateWindowsTree(Number(pidText));
  }
}

function clearWindowsPort(port) {
  const pids = parseWindowsListeningPids(run("netstat", ["-ano", "-p", "tcp"]), port);
  for (const pid of pids) terminateWindowsTree(pid);
  return pids;
}

function clearUnixPort(port) {
  const output = run("lsof", ["-ti", `:${port}`]);
  const pids = output.split(/\r?\n/u).map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* process exited between lookup and termination */ }
  }
  return pids;
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    const finish = (available) => {
      server.removeAllListeners();
      resolve(available);
    };
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });
}

export function shouldRefusePortKill(environment = process.env) {
  return environment.COWORKANY_DESKTOP_POC_NO_PORT_KILL === "1";
}

export async function clearDesktopDevProcesses(port = defaultPort) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid_dev_port:${port}`);
  const available = await portIsAvailable(port);
  if (!available && shouldRefusePortKill()) throw new Error(`dev_port_occupied:${port}`);
  if (platform() === "win32") {
    if (available) {
      // A packaged/stale Tauri instance can keep an old frontend alive without
      // listening on the Vite dev port. Clear it before starting a new dev run.
      clearWindowsDesktopProcess();
      return [];
    }
    const pids = clearWindowsPort(port);
    // Keep the cleanup unconditional so `tauri dev` cannot reuse an older
    // window or fail on its instance lock.
    clearWindowsDesktopProcess();
    return pids;
  }
  if (available) return [];
  return clearUnixPort(port);
}

if (process.argv[1] && normalize(resolve(process.argv[1])) === normalize(fileURLToPath(import.meta.url))) {
  const pids = await clearDesktopDevProcesses(defaultPort);
  if (pids.length) console.log(`Cleared desktop dev port ${defaultPort}: ${pids.join(", ")}`);
}
