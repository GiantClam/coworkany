import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendTimeline, safeEvidencePath, writeJsonEvidence } from "./evidence";

test("evidence paths cannot escape or follow symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-poc-evidence-"));
  const outside = await mkdtemp(join(tmpdir(), "coworkany-poc-evidence-outside-"));
  try {
    assert.throws(() => safeEvidencePath(root, "../outside.json"), /evidence_path_escape/);
    await symlink(outside, join(root, "link"), "dir");
    await assert.rejects(writeJsonEvidence(root, "link/secret.json", { ok: true }), /evidence_symlink_forbidden/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("timeline evidence is append-only and redacted", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-poc-timeline-"));
  try {
    await appendTimeline(root, { runId: "run-test", stepId: "save", actor: "desktop-agent", action: "click", startedAt: "a", finishedAt: "b", result: "passed", observation: { apiKey: "sk-sensitive-value" } });
    const text = await readFile(join(root, "timeline.jsonl"), "utf8");
    assert.doesNotMatch(text, /sk-sensitive-value/u);
    assert.match(text, /\[REDACTED\]/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
