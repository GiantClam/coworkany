import assert from "node:assert/strict";
import test from "node:test";
import { collectWorkflowArtifactValues, externalWorkflowArtifactKey, externalWorkflowArtifactReference } from "../runtime/workflow-artifact-reference";

test("normalizes platform PPT artifact references without a local path", () => {
  const reference = externalWorkflowArtifactReference({
    artifactId: 42,
    title: "workflow-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    url: "/api/platform/artifacts/42/download",
    downloadUrl: "/api/platform/artifacts/42/download?download=1",
  });

  assert.deepEqual(reference, {
    artifactId: 42,
    title: "workflow-deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    url: "/api/platform/artifacts/42/download",
    downloadUrl: "/api/platform/artifacts/42/download?download=1",
  });
  assert.equal(externalWorkflowArtifactKey(reference!), "artifact:42");
});

test("rejects references with neither an artifact id nor a retrievable URL", () => {
  assert.equal(externalWorkflowArtifactReference({ title: "deck.pptx", mimeType: "application/vnd.ms-powerpoint" }), undefined);
  assert.equal(externalWorkflowArtifactReference(null), undefined);
});

test("accepts URL-only provider output and preserves content type", () => {
  const reference = externalWorkflowArtifactReference({
    fileName: "deck.pptx",
    contentType: "application/vnd.ms-powerpoint",
    downloadUrl: "https://files.example/deck.pptx",
  });
  assert.deepEqual(reference, {
    title: "deck.pptx",
    mimeType: "application/vnd.ms-powerpoint",
    downloadUrl: "https://files.example/deck.pptx",
  });
});

test("collects canonical and plural workflow artifact bundle aliases", () => {
  const ppt = { artifactId: 7, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
  const image = { relativePath: "artifacts/cover.png", mimeType: "image/png" };
  const values = collectWorkflowArtifactValues({
    ppt: [ppt],
    images: [image],
    presentations: [{ artifactId: 8, url: "/api/platform/artifacts/8/download" }],
  });

  assert.deepEqual(values, [image, ppt, { artifactId: 8, url: "/api/platform/artifacts/8/download" }]);
});
