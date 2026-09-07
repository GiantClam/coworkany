import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkbenchWorkflowParameterFields } from "../src/workflow-parameter-fields";

test("renders schema-defined workflow fields with the desktop model picker", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="en"
      node={{
        nodeKey: "writer-1",
        type: "writer",
        nodeVersion: 1,
        title: "Writer",
        positionX: 0,
        positionY: 0,
        config: { selectedProviderId: "openai", selectedModelId: "gpt-5", platform: "generic", mode: "article", language: "auto" },
      }}
      modelOptions={[{ value: "gpt-5", label: "OpenAI / gpt-5" }]}
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, /Model/);
  assert.match(markup, /OpenAI \/ gpt-5/);
  assert.match(markup, /Platform/);
  assert.match(markup, /Format/);
  assert.match(markup, /Output language/);
  assert.doesNotMatch(markup, />Provider</);
});

test("renders select, number, and toggle controls from the shared node schema", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="en"
      node={{
        nodeKey: "collect-1",
        type: "collect",
        nodeVersion: 1,
        title: "Collect",
        positionX: 0,
        positionY: 0,
        config: { order: "input", includeFailures: false },
      }}
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, /Order/);
  assert.match(markup, /Include failures/);
  assert.match(markup, /type="checkbox"/);
});

test("keeps workflow parameter labels in the selected locale", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="zh"
      node={{
        nodeKey: "agent-1",
        type: "agent_execute",
        nodeVersion: 1,
        title: "智能体",
        positionX: 0,
        positionY: 0,
        config: { prompt: "hello", selectedProviderId: "local", selectedModelId: "agent/model" },
      }}
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, />提示词</u);
  assert.match(markup, />提供商</u);
  assert.match(markup, />模型</u);
  assert.doesNotMatch(markup, />Prompt</u);
  assert.doesNotMatch(markup, />Provider</u);
  assert.doesNotMatch(markup, />Model</u);
});

test("localizes workflow select options without changing their persisted values", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="zh"
      node={{
        nodeKey: "foreach-1",
        type: "foreach",
        nodeVersion: 1,
        title: "逐项处理",
        positionX: 0,
        positionY: 0,
        config: { inputPortId: "image.reference", failurePolicy: "continue" },
      }}
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, />图片引用</u);
  assert.match(markup, />继续</u);
  assert.match(markup, /value="image\.reference"/u);
  assert.match(markup, /value="continue"/u);
});

test("uses the configured model picker for media nodes with a standalone model field", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="en"
      node={{ nodeKey: "ppt-1", type: "ppt_generate", nodeVersion: 1, title: "PPT", positionX: 0, positionY: 0, config: { model: "ppt-model" } }}
      modelOptions={[{ value: "ppt-model", label: "PPT provider / ppt-model" }]}
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, /PPT provider \/ ppt-model/);
  assert.match(markup, /<select/);
});

test("uses all configured video models in the workflow video node picker", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="en"
      node={{ nodeKey: "video-1", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 0, positionY: 0, config: { model: "video/standard", mode: "text-to-video" } }}
      modelOptions={[
        { value: "video/standard", label: "Video / standard" },
        { value: "video/cinema", label: "Video / cinema" },
      ]}
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, /Video \/ standard/);
  assert.match(markup, /Video \/ cinema/);
  assert.match(markup, /<select/);
});

test("renders provider-specific image controls from the selected workflow model", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="zh"
      node={{ nodeKey: "image-1", type: "image_generate", nodeVersion: 1, title: "图片", positionX: 0, positionY: 0, config: { selectedProviderId: "bailian", selectedModelId: "qwen-image-3.0-pro" } }}
      modelOptions={[{ value: "qwen-image-3.0-pro", label: "Qwen Image 3.0 Pro" }]}
      providerOptions={[{ value: "bailian", label: "bailian" }]}
      onUpdate={() => undefined}
    />,
  );
  assert.match(markup, /反向提示词/);
  assert.match(markup, /提示词扩写/);
  assert.match(markup, /随机种子/);
  assert.match(markup, /1024\*1024/);
});

test("renders the configured provider picker alongside the video model picker", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="en"
      node={{ nodeKey: "video-1", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 0, positionY: 0, config: { selectedProviderId: "video-cinema", model: "cinema-v2" } }}
      providerOptions={[{ value: "video-standard", label: "video-standard" }, { value: "video-cinema", label: "video-cinema" }]}
      modelOptions={[{ value: "cinema-v1", label: "cinema-v1" }, { value: "cinema-v2", label: "cinema-v2" }]}
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, /video-standard/);
  assert.match(markup, /video-cinema/);
  assert.match(markup, /cinema-v2/);
});

test("replaces legacy video defaults with the selected Bailian model contract", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="en"
      node={{ nodeKey: "video-1", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 0, positionY: 0, config: { selectedProviderId: "bailian", model: "happyhorse-1.1-t2v", mode: "text-to-video" } }}
      providerOptions={[{ value: "bailian", label: "bailian" }]}
      modelOptions={[{ value: "happyhorse-1.1-t2v", label: "HappyHorse 1.1" }]}
      onUpdate={() => undefined}
    />,
  );
  assert.match(markup, /9:21/);
  assert.match(markup, /1080P/);
  assert.match(markup, /max="15"/);
  assert.doesNotMatch(markup, /data-field-id="sound"/);
});

test("uses a registered RunningHub workflow as the video model choice without exposing its internal reference", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchWorkflowParameterFields
      locale="en"
      node={{ nodeKey: "video-1", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 0, positionY: 0, config: { selectedProviderId: "runninghub", model: "workflow-42", workflowRef: "workflow-42" } }}
      modelOptions={[{ value: "workflow-42", label: "Campaign video · workflow-42" }]}
      modelLabel="Workflow"
      hideWorkflowReference
      onUpdate={() => undefined}
    />,
  );

  assert.match(markup, />Workflow</);
  assert.match(markup, /Campaign video · workflow-42/);
  assert.doesNotMatch(markup, /Workflow reference/);
});
