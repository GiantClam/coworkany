import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertOwner, atomicWriteJson, cleanupRun, layoutForRun, processGroupBelongsToRunRows } from "./lifecycle.mjs";

test("process ownership requires the exact repo path and expected dev command", () => {
  const state = { pid: 41, repoRoot: "/repo/coworkany", pidStartToken: "start-1" };
  assert.equal(processGroupBelongsToRunRows([{ pid: 41, command: "pnpm --dir /repo/coworkany tauri:dev", startToken: "start-1" }], state), true);
  assert.equal(processGroupBelongsToRunRows([{ pid: 41, command: "pnpm --dir /repo/other tauri:dev", startToken: "start-1" }], state), false);
  assert.equal(processGroupBelongsToRunRows([{ pid: 41, command: "vite --host 127.0.0.1", startToken: "start-1" }], state), false);
  assert.equal(processGroupBelongsToRunRows([{ pid: 41, command: "pnpm --dir /repo/coworkany tauri:dev", startToken: "start-2" }], state), false);
});

test("owner nonce rejects a stale or foreign run state", () => {
  assert.throws(() => assertOwner({ kind: "coworkany-desktop-poc", runId: "run-a", nonce: "n" }, "run-b"), /poc_run_owner_mismatch/);
  assert.throws(() => assertOwner({ kind: "other", runId: "run-a", nonce: "n" }, "run-a"), /poc_run_owner_mismatch/);
});

test("atomic state replacement never leaves a partial JSON document", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-poc-lifecycle-"));
  try {
    const path = join(root, "run.json");
    await atomicWriteJson(path, { state: "first" });
    await atomicWriteJson(path, { state: "second", nested: { ok: true } });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { state: "second", nested: { ok: true } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("layout rejects a symlinked run root before cleanup can touch it", async () => {
  const base = await mkdtemp(join(tmpdir(), "coworkany-poc-base-"));
  const outside = await mkdtemp(join(tmpdir(), "coworkany-poc-outside-"));
  const runId = "run-symlink-test";
  const link = join(base, runId);
  try {
    await symlink(outside, link, "dir");
    assert.throws(() => layoutForRun(link, { COWORKANY_DESKTOP_POC_BASE: base }), /poc_symlink_path_forbidden/);
  } finally {
    await rm(base, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("layout uses an owned run directory under the configured base", async () => {
  const base = await mkdtemp(join(tmpdir(), "coworkany-poc-base-"));
  try {
    const root = join(base, "run-owned");
    const layout = layoutForRun(root, { COWORKANY_DESKTOP_POC_BASE: base });
    assert.equal(layout.dataRoot, join(root, "data"));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "marker"), "ok");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("cleanup accepts an owned run below a symlinked parent such as macOS /tmp", async () => {
  const base = await mkdtemp(join(tmpdir(), "coworkany-poc-canonical-base-"));
  const target = await mkdtemp(join(tmpdir(), "coworkany-poc-canonical-target-"));
  const alias = join(base, "alias");
  const runId = "run-canonical-test";
  const root = join(alias, runId);
  const previousBase = process.env.COWORKANY_DESKTOP_POC_BASE;
  try {
    await symlink(target, alias, "dir");
    process.env.COWORKANY_DESKTOP_POC_BASE = base;
    const layout = layoutForRun(root);
    await mkdir(layout.root, { recursive: true });
    await mkdir(layout.dataRoot, { recursive: true });
    await mkdir(layout.evidenceRoot, { recursive: true });
    const owner = { kind: "coworkany-desktop-poc", runId, nonce: "canonical-nonce" };
    await writeFile(layout.owner, `${JSON.stringify(owner)}\n`, "utf8");
    await writeFile(layout.state, `${JSON.stringify({ kind: "coworkany-desktop-poc", runId, ownerNonce: owner.nonce, status: "stopped", dataRoot: layout.dataRoot, evidenceRoot: layout.evidenceRoot })}\n`, "utf8");
    const result = await cleanupRun(root);
    assert.equal(result.state.dataRemoved, true);
    await assert.rejects(readFile(layout.dataRoot), /ENOENT/);
  } finally {
    if (previousBase === undefined) delete process.env.COWORKANY_DESKTOP_POC_BASE;
    else process.env.COWORKANY_DESKTOP_POC_BASE = previousBase;
    await rm(base, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
