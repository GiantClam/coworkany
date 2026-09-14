import assert from "node:assert/strict";
import test from "node:test";
import { createRunningHubAudioTranscriptionRegistration, createRunningHubWorkflowRegistration, migrateLegacyRunningHubWorkflows, normalizeRunningHubCharacterImageBindings, parseRunningHubWorkflowJson, resolveRunningHubWorkflowInput, runningHubWorkflowIdFromUrl } from "../src/runninghub-workflow";

test("RunningHub workflow IDs can be read from URLs or direct IDs", () => {
  assert.equal(runningHubWorkflowIdFromUrl("https://www.runninghub.ai/lite/workflow/abc_123"), "abc_123");
  assert.equal(runningHubWorkflowIdFromUrl("https://www.runninghub.cn/call-api/api-detail/1999879555714347010?apiType=4"), "1999879555714347010");
  assert.equal(runningHubWorkflowIdFromUrl("workflow-42"), "workflow-42");
  assert.equal(runningHubWorkflowIdFromUrl("not valid"), undefined);
});

test("ComfyUI API JSON becomes role-aware input bindings", () => {
  const parsed = parseRunningHubWorkflowJson({
    "1": { class_type: "LoadImage", inputs: { image: "input.png" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "a product shot" } },
    "3": { class_type: "VideoCombine", inputs: { filename_prefix: "output" } },
  }, { remoteWorkflowId: "wf-1" });
  assert.equal(parsed.remoteWorkflowId, "wf-1");
  assert.ok(parsed.inputSchema.some((field) => field.id === "prompt"));
  assert.ok(parsed.inputSchema.some((field) => field.type === "image"));
  assert.ok(parsed.nodeBindings.some((binding) => binding.nodeId === "1" && binding.valueType === "file"));
  assert.ok(parsed.definitionHash.length > 10);
});

test("ComfyUI subtitle nodes become a file binding for the video template", () => {
  const parsed = parseRunningHubWorkflowJson({
    "1": { class_type: "LoadImage", inputs: { image: "background.png" } },
    "2": { class_type: "LoadSRT", inputs: { subtitle_file: "subtitles.srt" } },
    "3": { class_type: "VideoCombine", inputs: { audio: "audio.mp3" } },
  }, { remoteWorkflowId: "video-wf" });
  assert.ok(parsed.nodeBindings.some((binding) => binding.inputId === "subtitle" && binding.valueType === "file" && binding.nodeId === "2"));
  assert.equal(parsed.inputSchema.find((field) => field.id === "subtitle")?.type, "file");
});

test("ComfyUI character replacement fields keep reference and person bindings distinct", () => {
  const parsed = parseRunningHubWorkflowJson({
    "1": { class_type: "LoadImage", inputs: { background_image: "background.png" } },
    "2": { class_type: "LoadImage", inputs: { character_image: "person.png" } },
  }, { remoteWorkflowId: "image-wf" });
  assert.ok(parsed.nodeBindings.some((binding) => binding.inputId === "referenceImage" && binding.nodeId === "1"));
  assert.ok(parsed.nodeBindings.some((binding) => binding.inputId === "characterImage" && binding.nodeId === "2"));
});

test("generic LoadImage fields infer the two character replacement roles", () => {
  const parsed = parseRunningHubWorkflowJson({
    "1": { class_type: "LoadImage", inputs: { image: "reference.png" } },
    "2": { class_type: "LoadImage", inputs: { image: "character.png" } },
  }, { remoteWorkflowId: "image-generic-wf" });
  assert.deepEqual(parsed.nodeBindings.filter((binding) => binding.valueType === "file").map((binding) => [binding.inputId, binding.nodeId]), [
    ["referenceImage", "1"],
    ["characterImage", "2"],
  ]);
  assert.deepEqual(parsed.inputSchema.filter((field) => ["referenceImage", "characterImage"].includes(field.id)).map((field) => field.id), ["referenceImage", "characterImage"]);
});

test("legacy generic image registrations are repaired when config is loaded", () => {
  const registration = createRunningHubWorkflowRegistration({
    id: "legacy-image-wf",
    remoteWorkflowId: "remote-image-wf",
    name: "Legacy image",
    capability: "image",
    sourceKind: "manual",
    inputSchema: [
      { id: "1_image", label: "1_image", type: "image" },
      { id: "2_image", label: "2_image", type: "image" },
    ],
    nodeBindings: [
      { inputId: "1_image", nodeId: "1", fieldName: "image", valueType: "file" },
      { inputId: "2_image", nodeId: "2", fieldName: "image", valueType: "file" },
    ],
    outputSchema: [{ id: "output", type: "image" }],
    definitionHash: "legacy-hash",
    warnings: [],
  });
  const repaired = normalizeRunningHubCharacterImageBindings(registration);
  assert.deepEqual(repaired.nodeBindings.map((binding) => binding.inputId), ["referenceImage", "characterImage"]);
  assert.deepEqual(repaired.inputSchema.map((field) => field.id), ["referenceImage", "characterImage"]);
});

test("registered workflow preserves ordered file list values", () => {
  const registration = createRunningHubWorkflowRegistration({
    id: "video-wf",
    remoteWorkflowId: "wf-1",
    name: "Video",
    sourceKind: "manual",
    inputSchema: [{ id: "referenceImages", label: "Reference images", type: "image_list", multiple: true }],
    nodeBindings: [{ inputId: "referenceImages", nodeId: "10", fieldName: "images", valueType: "file_list" }],
    outputSchema: [{ id: "output", type: "video" }],
    definitionHash: "hash",
    warnings: [],
  });
  assert.deepEqual(resolveRunningHubWorkflowInput(registration, { referenceImages: [{ fileName: "one.png" }, { url: "https://files.invalid/two.png" }] }), [
    { nodeId: "10", fieldName: "images", fieldValue: "one.png" },
    { nodeId: "10", fieldName: "images", fieldValue: "https://files.invalid/two.png" },
  ]);
});

test("legacy digital human and video enhancement IDs migrate to editable registrations", () => {
  const workflows = migrateLegacyRunningHubWorkflows(undefined, { digitalHumanWorkflowId: "human-1", videoEnhanceWorkflowId: "enhance-1" });
  assert.equal(workflows?.length, 2);
  assert.equal(workflows?.find((workflow) => workflow.capability === "digital_human")?.nodeBindings.some((binding) => binding.nodeId === "343"), true);
  assert.equal(workflows?.find((workflow) => workflow.capability === "video_enhance")?.nodeBindings.some((binding) => binding.nodeId === "33"), true);
});

test("RunningHub AI App registration describes audio transcription", () => {
  const registration = createRunningHubAudioTranscriptionRegistration({ id: "audio-runninghub", appId: "1999879555714347010", name: "ASR", inputNodeId: "2", inputFieldName: "audio" });
  assert.equal(registration.capability, "audio_transcription");
  assert.equal(registration.request?.kind, "ai-app");
  assert.equal(registration.request?.submitPath, "/openapi/v2/run/ai-app/1999879555714347010");
  assert.deepEqual(registration.nodeBindings, [{ inputId: "audio", nodeId: "2", fieldName: "audio", valueType: "file", required: true }]);
  assert.deepEqual(registration.outputSchema, [{ id: "transcript", type: "text", required: true }]);
});
