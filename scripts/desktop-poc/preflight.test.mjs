import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { agentDesktopCheck, accessibilityProbe, jevCheck, runPreflight } from "./preflight.mjs";

test("agent-desktop permission uncertainty is manual, not a pass", () => {
  const output = (_command, args) => args[0] === "version"
    ? JSON.stringify({ ok: true, data: { version: "1.2.0" } })
    : JSON.stringify({ ok: true, data: { accessibility: { state: "granted" }, screen_recording: { state: "granted" }, automation: { state: "unknown" } } });
  const result = agentDesktopCheck({ available: true, output });
  assert.equal(result.status, "manual_required");
  assert.deepEqual(result.missingPermissions, ["automation"]);
});

test("accessibility probe only passes when System Events confirms the target app", () => {
  assert.equal(accessibilityProbe({ available: true, output: () => "true" }).status, "pass");
  assert.equal(accessibilityProbe({ available: true, output: () => "false" }).status, "manual_required");
});

test("jev is a blocking gate when the CLI or API credentials are missing", () => {
  assert.equal(jevCheck({ available: false, credentialsAvailable: false }).status, "blocked");
  assert.equal(jevCheck({ available: true, credentialsAvailable: false }).status, "blocked");
  assert.equal(jevCheck({ available: true, credentialsAvailable: true, output: () => "jev 2026.919.0" }).status, "pass");
});

test("preflight does not report ready while a manual gate remains", async () => {
  const repoRoot = "/tmp/coworkany-poc-preflight-fixture";
  await mkdir(join(repoRoot, "apps/desktop/src-tauri"), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(join(repoRoot, "apps/desktop/src-tauri/tauri.conf.json"), "{}\n"));
  try {
    const result = await runPreflight({
    repoRoot,
    platform: "darwin",
    environment: { COWORKANY_DESKTOP_POC_BASE: "/tmp/poc", COWORKANY_DESKTOP_POC_RUN_ID: "run-test" },
    commandAvailableFn: (command) => ["node", "pnpm", "cargo", "osascript", "jev", "/usr/sbin/screencapture"].includes(command),
    commandOutputFn: (_command, args) => {
      if (args?.[0] === "-e") return "true";
      if (args?.[0] === "permissions") return JSON.stringify({ ok: true, data: { accessibility: { state: "granted" }, screen_recording: { state: "granted" }, automation: { state: "unknown" } } });
      if (args?.[0] === "version") return JSON.stringify({ ok: true, data: { version: "1.2.0" } });
      if (args?.[0] === "short") return "";
      return "";
    },
    jevCredentialsAvailableFn: () => true,
    });
    assert.equal(result.readiness, "manual_required");
    assert.equal(result.ok, false);
    assert.ok(result.manual.some((item) => item.name === "agent-desktop"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
