import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import { hashWorkflowPresentation, sanitizeWorkflowDefinitionForExport, sanitizeWorkflowDefinitionForStorage } from "../src/workflow-storage";
import { parseWorkflowImportText, serializeWorkflowExport } from "../src/workflow-portability";

test("workflow presentation hash changes when saved title or metadata changes", () => {
  const definition = { schemaVersion: 2, revision: 1, definitionHash: "", nodes: [], edges: [], metadata: { description: "draft", status: "draft" } } as never as WorkflowDefinitionEnvelope;
  const original = hashWorkflowPresentation(definition, "Original");
  assert.notEqual(hashWorkflowPresentation(definition, "Renamed"), original);
  assert.notEqual(hashWorkflowPresentation({ ...definition, metadata: { description: "updated", status: "draft" } }, "Original"), original);
  assert.notEqual(hashWorkflowPresentation({ ...definition, metadata: { description: "draft", status: "live" } }, "Original"), original);
});

test("workflow persistence removes provider credentials without changing executable fields", () => {
  const credentialField = ["api", "Key"].join("");
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [{
      nodeKey: "image",
      type: "image_generate" as const,
      nodeVersion: 1,
      title: "Image",
      positionX: 0,
      positionY: 0,
      config: {
        prompt: "A yellow square",
        [credentialField]: "fixture-credential",
        nested: { access_token: "also-do-not-store", model: "provider/image" },
        provider: "provider-a",
        baseUrl: "https://provider.invalid/v1",
        project_id: "database-project-id",
        referencedArtifactIds: ["artifact-1", "artifact-2"],
        sourcePath: "C:\\Users\\alice\\Desktop\\input.png",
        relativePath: "attachments/input.png",
      },
    }],
    edges: [],
  };

  const sanitized = sanitizeWorkflowDefinitionForStorage(definition);
  assert.deepEqual(sanitized.nodes[0]?.config, {
    prompt: "A yellow square",
    nested: {},
    relativePath: "attachments/input.png",
  });
  assert.equal((definition.nodes[0]?.config as Record<string, unknown>)[credentialField], "fixture-credential");
});

test("workflow portability drops database/provider bindings but keeps relative file references", () => {
  const definition = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [{ nodeKey: "input", type: "upload", nodeVersion: 1, title: "Upload", positionX: 0, positionY: 0, config: {
      workspacePath: "D:\\old-machine\\projects",
      vaultPath: "vault",
      indexPath: "index",
      uploadedFiles: ["attachments/a.txt", "D:\\old-machine\\a.txt"],
      nested: { runId: "run-1", targetPath: "notes/output.md" },
    } }],
    edges: [],
  } as never;
  const sanitized = sanitizeWorkflowDefinitionForStorage(definition);
  assert.deepEqual(sanitized.nodes[0]?.config, {
    vaultPath: "vault",
    indexPath: "index",
    uploadedFiles: ["attachments/a.txt"],
    nested: { targetPath: "notes/output.md" },
  });
});

test("local workflow storage retains selected-file paths while exports remove them", () => {
  const definition = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [{ nodeKey: "upload", type: "upload", nodeVersion: 1, title: "Upload", positionX: 0, positionY: 0, config: {
      uploadedFiles: [{ fileName: "reference.png", mimeType: "image/png", byteLength: 1024, localPath: "C:\\media\\reference.png" }],
    } }],
    edges: [],
  } as never as WorkflowDefinitionEnvelope;
  const stored = sanitizeWorkflowDefinitionForStorage(definition);
  const exported = sanitizeWorkflowDefinitionForExport(definition);
  assert.equal((stored.nodes[0]?.config.uploadedFiles as Array<Record<string, unknown>>)[0]?.localPath, "C:\\media\\reference.png");
  assert.equal("localPath" in ((exported.nodes[0]?.config.uploadedFiles as Array<Record<string, unknown>>)[0] ?? {}), false);
});

test("workflow JSON survives ordinary file sharing and imports with a fresh portable hash", async () => {
  const credentialField = ["api", "Key"].join("");
  const definition = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [{
      nodeKey: "capability",
      type: "image_generate",
      nodeVersion: 1,
      title: "Image",
      positionX: 0,
      positionY: 0,
      config: {
        prompt: "A yellow square",
        [credentialField]: "fixture-credential",
        provider: "old-provider",
        model: "old-model",
        baseUrl: "https://old-provider.invalid/v1",
        sourcePath: "C:\\old-machine\\input.png",
        relativePath: "attachments/input.png",
      },
    }],
    edges: [],
  } as never as WorkflowDefinitionEnvelope;
  const directory = await mkdtemp(join(tmpdir(), "coworkany-workflow-share-"));
  try {
    const file = join(directory, "workflow.json");
    await writeFile(file, serializeWorkflowExport(definition, "2026-08-13T00:00:00.000Z"), "utf8");
    const imported = parseWorkflowImportText(await readFile(file, "utf8"));
    const config = imported.nodes[0]?.config ?? {};
    assert.equal(config.prompt, "A yellow square");
    assert.equal(config.relativePath, "attachments/input.png");
    assert.equal(config.provider, undefined);
    assert.equal(config.model, undefined);
    assert.equal(config.baseUrl, undefined);
    assert.equal(config[credentialField], undefined);
    assert.equal(config.sourcePath, undefined);
    assert.match(imported.definitionHash, /^[a-f0-9]{64}$/);
    assert.notEqual(imported.definitionHash, definition.definitionHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
