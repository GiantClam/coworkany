import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../..", import.meta.url);
const source = async (relativePath: string) => readFile(new URL(relativePath, root), "utf8");

test("desktop PoC surface exposes stable semantic controls and success evidence", async () => {
  const app = await source("apps/desktop/src/App.tsx");
  const directory = await source("packages/workbench-ui/src/workflow-directory.tsx");
  const vite = await source("apps/desktop/vite.config.ts");
  assert.match(app, /id="poc-workflow-builder"/u);
  assert.match(app, /id="poc-workflow-save"/u);
  assert.match(app, /title=\{operationState\?\.kind === "save"/u);
  assert.match(app, /id="poc-workflow-title"/u);
  assert.match(app, /id="poc-workflow-description"/u);
  assert.match(app, /id="poc-workflow-status"/u);
  assert.match(app, /id="poc-workflow-definition-hash"/u);
  assert.match(app, /id="poc-workflow-panel-open"/u);
  assert.match(directory, /id="poc-workflow-directory" role="group" aria-label=\{copy\.title\}/u);
  assert.match(directory, /data-poc-dialog="delete-workflow"/u);
  assert.match(directory, /aria-label=\{locale === "zh" \? `打开工作流/iu);
  assert.match(directory, /aria-label=\{locale === "zh" \? `删除工作流/iu);
  assert.match(vite, /entries: \["index\.html"\]/u);
});

test("desktop PoC isolation and evidence code keep production data outside the run root", async () => {
  const rust = await source("apps/desktop/src-tauri/src/lib.rs");
  const lifecycle = await source("scripts/desktop-poc/lifecycle.mjs");
  const evidence = await source("scripts/desktop-poc/evidence.ts");
  const cleanup = await source("scripts/clear-desktop-dev-processes.mjs");
  assert.match(rust, /COWORKANY_DESKTOP_POC_DATA_DIR/u);
  assert.match(rust, /cfg\(debug_assertions\)/u);
  assert.match(lifecycle, /poc_process_ownership_unverified/u);
  assert.match(lifecycle, /COWORKANY_DESKTOP_POC_NO_PORT_KILL/u);
  assert.match(evidence, /redactValue/u);
  assert.match(cleanup, /shouldRefusePortKill/u);
});
