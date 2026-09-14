import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_PROCESS_OPERATIONS,
  VIDEO_PROCESS_OPERATIONS,
  getWorkflowProcessOperation,
  getWorkflowProcessPortPolicy,
  validateWorkflowProcessInputs,
} from "../src";

test("exposes the approved unified video and audio operation catalogs", () => {
  assert.deepEqual(VIDEO_PROCESS_OPERATIONS, ["stitch", "transform", "overlay", "subtitle", "mux"]);
  assert.deepEqual(AUDIO_PROCESS_OPERATIONS, ["trim", "mix", "normalize"]);
  assert.equal(getWorkflowProcessOperation("video_process", { operation: "stitch" }), "stitch");
  assert.equal(getWorkflowProcessOperation("audio_process", { operation: "mix" }), "mix");
  assert.equal(getWorkflowProcessOperation("video_process", { operation: "not-supported" }), "stitch");
});

test("keeps fixed ports while exposing operation-specific input policy", () => {
  assert.deepEqual(getWorkflowProcessPortPolicy("video_process", "stitch"), { allowed: ["videos"], min: { videos: 2 } });
  assert.deepEqual(getWorkflowProcessPortPolicy("video_process", "overlay"), { allowed: ["videos", "images"], min: { videos: 1, images: 1 }, max: { videos: 1 } });
  assert.deepEqual(getWorkflowProcessPortPolicy("audio_process", "mix"), { allowed: ["audios"], min: { audios: 1 } });
});

test("blocks an operation when preserved edges no longer match its policy", () => {
  assert.deepEqual(validateWorkflowProcessInputs("video_process", { operation: "subtitle" }, { videos: 1, images: 0, text: 1 }), []);
  assert.deepEqual(validateWorkflowProcessInputs("video_process", { operation: "stitch" }, { videos: 1, images: 0, text: 0 }), ["video_process.stitch requires at least 2 video inputs"]);
  assert.deepEqual(validateWorkflowProcessInputs("video_process", { operation: "subtitle" }, { videos: 1, images: 1, text: 0 }), ["video_process.subtitle does not accept images inputs", "video_process.subtitle requires a subtitle text input"]);
  assert.deepEqual(validateWorkflowProcessInputs("audio_process", { operation: "trim" }, { audios: 2 }), ["audio_process.trim accepts at most 1 audio input"]);
});
