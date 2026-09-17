import assert from "node:assert/strict"
import test from "node:test"

import {
  areWorkflowPortsCompatible,
  getWorkflowPortLabel,
  isWorkflowPortCreatable,
  resolveClickConnectInputName,
  resolveClickConnectPorts,
  resolveWorkflowPortConnection,
  workflowInputNameToValueKind,
  workflowValueKindToInputName,
} from "./connect"
import {
  areWorkflowPortsCompatible as sharedAreWorkflowPortsCompatible,
  resolveWorkflowPortConnection as sharedResolveWorkflowPortConnection,
  workflowInputNameToValueKind as sharedWorkflowInputNameToValueKind,
} from "@coworkany/workflow-core"
import { workflowNodeRegistry } from "./node-definitions/registry"

test("workflowValueKindToInputName maps every value kind to its edge input name", () => {
  assert.equal(workflowValueKindToInputName("text"), "text")
  assert.equal(workflowValueKindToInputName("asset"), "assets")
  assert.equal(workflowValueKindToInputName("image"), "images")
  assert.equal(workflowValueKindToInputName("video"), "videos")
  assert.equal(workflowValueKindToInputName("audio"), "audios")
  assert.equal(workflowValueKindToInputName("ppt"), "presentations")
  assert.equal(workflowInputNameToValueKind("coverImage"), "image")
})

test("legacy connection helpers are shared workflow-core exports", () => {
  assert.equal(areWorkflowPortsCompatible, sharedAreWorkflowPortsCompatible)
  assert.equal(resolveWorkflowPortConnection, sharedResolveWorkflowPortConnection)
  assert.equal(workflowInputNameToValueKind, sharedWorkflowInputNameToValueKind)
})

test("resolveClickConnectInputName resolves compatible source->target pairs", () => {
  // Default guided pipeline: text -> script -> TTS -> digital human.
  assert.equal(resolveClickConnectInputName("text_input", "llm_generate"), "text")
  assert.equal(resolveClickConnectInputName("llm_generate", "voice_synthesis"), "text")
  assert.equal(resolveClickConnectInputName("voice_synthesis", "digital_human"), "audios")
  // Text feeds image generation.
  assert.equal(resolveClickConnectInputName("llm_generate", "image_generate"), "text")
  // Upload (asset) feeds the asset library.
  assert.equal(resolveClickConnectInputName("upload", "product_store"), "assets")
  // Text should be materialized as a file before entering the asset library.
  assert.equal(resolveClickConnectInputName("llm_generate", "file_create"), "text")
  assert.equal(resolveClickConnectInputName("file_create", "product_store"), "assets")
  // Image feeds digital human (avatar).
  assert.equal(resolveClickConnectInputName("image_generate", "digital_human"), "images")
})

test("resolveClickConnectInputName returns null for incompatible pairs", () => {
  // product_store emits nothing.
  assert.equal(resolveClickConnectInputName("product_store", "llm_generate"), null)
  // upload accepts no inputs.
  assert.equal(resolveClickConnectInputName("text_input", "upload"), null)
})

test("new connections resolve stable semantic port ids without legacy inputName", () => {
  assert.deepEqual(resolveClickConnectPorts("text_input", "image_generate"), {
    sourcePortId: "text",
    targetPortId: "text",
  })
  assert.deepEqual(resolveClickConnectPorts("image_generate", "video_generate"), {
    sourcePortId: "image",
    targetPortId: "images",
  })
  assert.deepEqual(
    resolveWorkflowPortConnection("text_input", "image_generate", undefined, undefined, "text"),
    { sourcePortId: "text", targetPortId: "text" },
  )
})

test("semantic roles have explicit labels and invalid roles do not validate", () => {
  const video = workflowNodeRegistry.require("video_generate")
  const firstFrame = video.inputs.find((port) => port.role === "image.first_frame")!
  const lastFrame = video.inputs.find((port) => port.role === "image.last_frame")!
  const coverImage = workflowNodeRegistry.require("video_compose").inputs.find((port) => port.role === "image.cover")!
  assert.equal(getWorkflowPortLabel("zh", firstFrame), "首帧图片")
  assert.equal(getWorkflowPortLabel("en", lastFrame), "Last frame")
  assert.equal(getWorkflowPortLabel("zh", coverImage), "封面图片")
  assert.equal(getWorkflowPortLabel("en", coverImage), "Cover image")
  assert.equal(isWorkflowPortCreatable(firstFrame, { definitionV2Write: false }), false)
  assert.equal(isWorkflowPortCreatable(firstFrame, { definitionV2Write: true }), true)
  assert.equal(resolveWorkflowPortConnection("text_input", "video_generate", "text", "image.last_frame"), null)
})
