import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowDefinition } from "@coworkany/workflow-core";
import { buildCharacterSwapVideoWorkflowDefinition } from "../src/workflow-templates";

test("character swap video template wires two images, ASR, subtitle file, audio, and video", () => {
  const definition = buildCharacterSwapVideoWorkflowDefinition({
    image: { id: "image-runninghub", model: "image-workflow", baseUrl: "https://www.runninghub.cn" },
    audio: { id: "audio-runninghub", model: "1999879555714347010", baseUrl: "https://www.runninghub.cn" },
    video: { id: "video-runninghub", model: "video-workflow", baseUrl: "https://www.runninghub.cn" },
  });
  assert.equal(validateWorkflowDefinition(definition).length, 0);
  assert.deepEqual(definition.nodes.map((node) => node.type), ["text_input", "upload", "upload", "upload", "image_generate", "agent_execute", "file_create", "video_compose", "output", "product_store"]);
  assert.equal(definition.nodes.find((node) => node.nodeKey === "asr")?.config.operation, "audio_transcription");
  assert.equal(definition.nodes.find((node) => node.nodeKey === "replace")?.config.requiresCharacterImageBindings, true);
  assert.equal(definition.nodes.find((node) => node.nodeKey === "video")?.config.subtitleMode, "burn_in");
  assert.equal(definition.nodes.find((node) => node.nodeKey === "subtitle")?.config.fileName, "subtitles.srt");
  assert.deepEqual(definition.edges.filter((edge) => edge.targetNodeKey === "replace").map((edge) => edge.sourceNodeKey), ["prompt", "reference-image", "character-image"]);
  assert.equal(definition.edges.find((edge) => edge.edgeKey === "reference-replace")?.targetPortId, "referenceImage");
  assert.equal(definition.edges.find((edge) => edge.edgeKey === "character-replace")?.targetPortId, "characterImage");
  assert.equal(definition.edges.some((edge) => edge.sourceNodeKey === "asr" && edge.targetNodeKey === "subtitle"), true);
  assert.equal(definition.edges.some((edge) => edge.sourceNodeKey === "audio" && edge.targetNodeKey === "video" && edge.targetPortId === "audio"), true);
  assert.equal(definition.edges.some((edge) => edge.sourceNodeKey === "replace" && edge.targetNodeKey === "video" && edge.targetPortId === "coverImage"), true);
  assert.equal(definition.edges.some((edge) => edge.sourceNodeKey === "subtitle" && edge.targetNodeKey === "video" && edge.targetPortId === "subtitle"), true);
  assert.match(definition.definitionHash, /^[a-f0-9]{64}$/u);
});
