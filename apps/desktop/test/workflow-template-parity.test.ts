import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hashWorkflowDefinition, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import { buildWorkflowDefinition, buildLocalMediaWorkflowDefinition, buildProductPromotionWorkflowDefinition } from "../src/App";
import { buildCampaignImageWorkflowDefinition, buildCharacterSwapVideoWorkflowDefinition } from "../src/workflow-templates";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/workflow-golden-v1.json", import.meta.url), "utf8")) as {
  sourceCommit: string;
  provider: { id: string; model: string; baseUrl: string };
  definitions: Record<"zh" | "en", Record<string, WorkflowDefinitionEnvelope>>;
};
function graph(definition: WorkflowDefinitionEnvelope) {
  const metadata = { ...definition.metadata };
  delete metadata.templateKey;
  delete metadata.templateVersion;
  return { ...definition, definitionHash: "", metadata };
}
for (const locale of ["zh", "en"] as const) {
  test(`six unchanged golden graphs preserve frozen v1 semantics (${locale})`, () => {
    const p = baseline.provider;
    const current = {
      "content-pipeline": buildWorkflowDefinition("fixture brief", "writer", p, {}, locale),
      presentation: buildWorkflowDefinition("fixture brief", "ppt_generate", p, {}, locale),
      "video-ffmpeg-transform": buildLocalMediaWorkflowDefinition("video", locale),
      "audio-ffmpeg-trim": buildLocalMediaWorkflowDefinition("audio", locale),
      "product-promotion-video": buildProductPromotionWorkflowDefinition(p, p, p, locale),
      "character-swap-video": buildCharacterSwapVideoWorkflowDefinition({ image: p, audio: p, video: p }, locale),
    };
    for (const [key, definition] of Object.entries(current)) {
      assert.deepEqual(graph(definition), graph(baseline.definitions[locale]![key]!), key);
      assert.equal(definition.definitionHash, hashWorkflowDefinition(definition), key);
    }
  });
  test(`image campaign intentionally adds a real article path to its frozen v1 graph (${locale})`, () => {
    const old = baseline.definitions[locale]["image-campaign"]!;
    const current = buildCampaignImageWorkflowDefinition("fixture brief", baseline.provider, locale);
    assert.deepEqual(old.nodes.map(node => node.type), ["text_input", "image_generate", "product_store"]);
    assert.deepEqual(current.nodes.map(node => node.type), ["text_input", "writer", "image_generate", "product_store"]);
    assert.equal(current.edges.length, 4);
    assert.equal(current.nodes.find(node => node.type === "writer")?.config.prompt, "fixture brief");
  });
}
