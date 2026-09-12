import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const packageScript = await readFile(join(scriptsDirectory, "package-desktop-zip.ps1"), "utf8");

test("desktop ZIP packaging keeps the full runtime in the standalone runtime archive", () => {
  assert.match(packageScript, /\$packageRuntime\s*=\s*Join-Path\s+\$packageRoot\s+"_up_/u);
  assert.match(packageScript, /runtime-manifest\.json/u);
  assert.match(packageScript, /foreach\s+\(\$directory\s+in\s+@\("skills",\s+"agents"\)\)/u);
  assert.match(packageScript, /if\s+\(\$Portable\)\s*\{[\s\S]*?Copy-Item\s+-LiteralPath\s+\$bundledRuntime\s+-Destination\s+\(Join-Path\s+\$packageRuntime\s+"runtime"\)\s+-Recurse\s+-Force/u);
  assert.match(packageScript, /Copy-Item\s+-LiteralPath\s+\$manifest\s+-Destination\s+\(Join-Path\s+\$packageRuntime\s+"runtime\\runtime-manifest\.json"\)\s+-Force/u);
});
