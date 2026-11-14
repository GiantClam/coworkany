import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const desktopBuildArgs = process.platform === "darwin"
  ? ["desktop:macos:build"]
  : ["--filter", "@coworkany/desktop", "build"];

const checks = [
  { name: "shared-client-typecheck", args: ["--filter", "@coworkany/workbench-client", "typecheck"] },
  { name: "shared-client-tests", args: ["--filter", "@coworkany/workbench-client", "test"] },
  { name: "shared-ui-typecheck", args: ["--filter", "@coworkany/workbench-ui", "typecheck"] },
  { name: "shared-ui-tests", args: ["--filter", "@coworkany/workbench-ui", "test"] },
  { name: "desktop-typecheck", args: ["--filter", "@coworkany/desktop", "typecheck"] },
  // The local host test fixtures share process-level runtime resources. Keep
  // the release gate serial so independent test files cannot compete for a
  // fixture's OpenCode process or filesystem state.
  { name: "desktop-entry-and-runtime-tests", args: ["--filter", "@coworkany/desktop", "test:release"] },
  { name: "desktop-build", args: desktopBuildArgs },
  { name: "desktop-bundle-boundary", args: ["desktop:verify-bundle"] },
  { name: "desktop-network-boundary", args: ["desktop:verify-network-boundary"] },
];

function runCheck(check) {
  return new Promise((resolveCheck, reject) => {
    // pnpm resolves to a .cmd shim on Windows. Launch cmd.exe explicitly so
    // Node can retain the child process handle without relying on shell mode.
    const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : pnpm;
    const args = process.platform === "win32" ? ["/d", "/s", "/c", pnpm, ...check.args] : check.args;
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: false });
    child.once("error", (error) => reject(new Error(`${check.name} could not start: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) return resolveCheck();
      reject(new Error(`${check.name} failed${signal ? ` (${signal})` : ` (exit ${code ?? "unknown"})`}`));
    });
  });
}

async function main() {
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ status: "planned", checks }, null, 2)}\n`);
    return;
  }

  const completed = [];
  for (const check of checks) {
    process.stdout.write(`\n[desktop release regression] ${check.name}\n`);
    await runCheck(check);
    completed.push(check.name);
  }
  process.stdout.write(`\n${JSON.stringify({ status: "pass", completed }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
