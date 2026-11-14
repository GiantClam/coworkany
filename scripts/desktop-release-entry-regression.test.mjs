import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("desktop entry regression command covers shared UI, desktop runtime, build, and boundaries", async () => {
  const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
  const { stdout } = await execFileAsync(process.execPath, [join(scriptsDirectory, "desktop-release-entry-regression.mjs"), "--dry-run"]);
  const plan = JSON.parse(stdout);
  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.checks.map((check) => check.name), [
    "shared-client-typecheck",
    "shared-client-tests",
    "shared-ui-typecheck",
    "shared-ui-tests",
    "desktop-typecheck",
    "desktop-entry-and-runtime-tests",
    "desktop-build",
    "desktop-bundle-boundary",
    "desktop-network-boundary",
  ]);
  assert.deepEqual(plan.checks.find((check) => check.name === "desktop-build").args, process.platform === "darwin"
    ? ["desktop:macos:build"]
    : ["--filter", "@coworkany/desktop", "build"]);
});
