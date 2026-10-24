import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKFLOW_AUTHORING_PLAN_VERSION } from "@coworkany/workflow-core";

test("bundled authoring Skill protocol matches the typed workflow plan contract", async () => {
  const skill = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../../content/skills/workflow-authoring/SKILL.md"), "utf8");
  assert.match(skill, new RegExp(`protocol_version:\\s*"${WORKFLOW_AUTHORING_PLAN_VERSION}"`, "u"));
  for (const field of ["schemaVersion", "intent", "requiredCapabilities", "selectedTemplate", "templateVersion", "assumptions", "operations", "validationResult"]) {
    assert.match(skill, new RegExp(`\\b${field}\\b`, "u"));
  }
  assert.match(skill, /status` must be exactly `valid`, `invalid`, or `needs_configuration`/);
  assert.match(skill, /unconfigured.*Provider.*does not make an otherwise valid graph invalid/i);
  assert.match(skill, /the deliverable is an article and images are supporting material/);
  assert.match(skill, /Do not classify it as an image campaign, image batch, poster, or cover workflow/);
  assert.match(skill, /text_input → writer → product_store\.text/);
  assert.match(skill, /derive supporting illustrations from `writer\.text`/iu);
  assert.match(skill, /do not claim that image files are embedded inside Markdown/);
});
