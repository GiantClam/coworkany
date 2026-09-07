import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateWorkflowCanvasSceneBounds, WorkflowCanvas, type WorkflowCanvasEdge, type WorkflowCanvasNode } from "../src/workflow-canvas";

const baseNodes: WorkflowCanvasNode[] = [
  { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Input", positionX: 0, positionY: 0, config: { text: "hello" } },
  { nodeKey: "writer", type: "writer", nodeVersion: 1, title: "Writer", positionX: 408, positionY: 0, config: { selectedProviderId: "local", selectedModelId: "writer/model" } },
  { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 816, positionY: 0, config: {} },
];

const baseEdges: WorkflowCanvasEdge[] = [
  { edgeKey: "input-writer", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer", targetPortId: "text" },
  { edgeKey: "writer-output", sourceNodeKey: "writer", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" },
];

function renderCanvas(nodes = baseNodes, edges = baseEdges) {
  return renderToStaticMarkup(
    <WorkflowCanvas
      locale="zh"
      nodes={nodes}
      edges={edges}
      onSelectNode={() => undefined}
      onMoveNode={() => undefined}
      onDeleteNode={() => undefined}
      onDuplicateNode={() => undefined}
      onStartConnection={() => undefined}
      onConnect={() => undefined}
    />,
  );
}

test("workflow canvas summarizes exact port ids while exposing one visual endpoint on each side", () => {
  const markup = renderCanvas([
    ...baseNodes,
    { nodeKey: "knowledge", type: "knowledge_write", nodeVersion: 1, title: "Knowledge", positionX: 1224, positionY: 0, config: { title: "Brief" } },
  ]);
  assert.match(markup, /提供商: local/);
  assert.match(markup, /模型: writer\/model/);
  assert.match(markup, /title="text"/);
  assert.match(markup, /data-agent-node="knowledge"/);
  assert.equal((markup.match(/shared-workflow-port input aggregate/g) ?? []).length, 3);
  assert.equal((markup.match(/shared-workflow-port output aggregate/g) ?? []).length, 4);
  assert.doesNotMatch(markup, /shared-workflow-port-panel/);
});

test("workflow canvas does not duplicate compact parameters beside editable node controls", () => {
  const markup = renderToStaticMarkup(
    <WorkflowCanvas
      locale="zh"
      nodes={baseNodes}
      edges={baseEdges}
      onSelectNode={() => undefined}
      onMoveNode={() => undefined}
      renderNodeEditor={() => <div data-node-editor="true" />}
    />,
  );

  const inputCard = markup.match(/data-agent-node="input"[\s\S]*?<\/article>/u)?.[0] ?? "";
  const writerCard = markup.match(/data-agent-node="writer"[\s\S]*?<\/article>/u)?.[0] ?? "";
  assert.doesNotMatch(inputCard, /data-node-parameters="true"/u);
  assert.doesNotMatch(inputCard, /文本: hello/u);
  assert.doesNotMatch(writerCard, /Provider: local/u);
  assert.doesNotMatch(writerCard, /Model: writer\/model/u);
  assert.match(writerCard, /data-node-editor="true"/u);
});

test("workflow canvas keeps compact parameters when no editor is supplied", () => {
  const markup = renderCanvas();
  const inputCard = markup.match(/data-agent-node="input"[\s\S]*?<\/article>/u)?.[0] ?? "";
  assert.match(inputCard, /data-node-parameters="true"/u);
  assert.match(inputCard, /文本: hello/u);
});

test("workflow canvas keeps only the default input fixed so multiple result previews are editable", () => {
  const markup = renderCanvas([
    ...baseNodes,
    { nodeKey: "output-second", type: "output", nodeVersion: 1, title: "Output 2", positionX: 816, positionY: 420, config: {} },
  ]);
  const inputCard = markup.match(/data-agent-node="input"[\s\S]*?<\/article>/u)?.[0] ?? "";
  const outputCard = markup.match(/data-agent-node="output"[\s\S]*?<\/article>/u)?.[0] ?? "";
  assert.doesNotMatch(inputCard, /删除节点|复制节点/u);
  assert.match(outputCard, /删除节点/u);
  assert.match(outputCard, /复制节点/u);
  assert.match(markup, /data-agent-node="output-second"[\s\S]*?删除节点/u);
  assert.match(markup, /data-agent-node="writer"[\s\S]*?删除节点/u);
});

test("workflow canvas keeps edge geometry tied to persisted coordinates relative to a dynamic scene origin", () => {
  const markup = renderCanvas();
  assert.match(markup, /shared-workflow-canvas-scene/u);
  assert.match(markup, /data-agent-node="input"/u);
  assert.match(markup, /data-agent-node="writer"/u);
  assert.match(markup, /data-agent-node="output"/u);
  assert.match(markup, /shared-workflow-edge-hit/u);
});

test("workflow canvas bounds include negative nodes and the current viewport", () => {
  const bounds = calculateWorkflowCanvasSceneBounds([
    { positionX: -960, positionY: -540 },
    { positionX: 1280, positionY: 720 },
  ], { x: 180, y: 120, scale: 0.75 }, { width: 1000, height: 700 });

  assert.ok(bounds.minX <= -1320);
  assert.ok(bounds.minY <= -900);
  assert.ok(bounds.width > 2_800);
  assert.ok(bounds.height > 1_800);
});

test("workflow canvas exposes disabled history controls until a workflow change is available", () => {
  const markup = renderToStaticMarkup(
    <WorkflowCanvas
      locale="zh"
      nodes={baseNodes}
      edges={baseEdges}
      onSelectNode={() => undefined}
      onMoveNode={() => undefined}
      canUndo={false}
      canRedo={false}
      onUndo={() => undefined}
      onRedo={() => undefined}
    />,
  );

  assert.match(markup, /disabled="" aria-label="撤销"/u);
  assert.match(markup, /disabled="" aria-label="重做"/u);
});

test("workflow canvas gives previewable upload nodes an explicit media interaction mode", () => {
  const markup = renderCanvas([
    ...baseNodes,
    {
      nodeKey: "upload",
      type: "upload",
      nodeVersion: 1,
      title: "Upload",
      positionX: 1224,
      positionY: 0,
      config: { uploadedFiles: [{ fileName: "clip.mp4", mimeType: "video/mp4" }] },
    },
  ]);

  assert.match(markup, /data-agent-node="upload"[\s\S]*?aria-label="操作媒体内容"/u);
  assert.match(markup, /data-agent-node="upload"[\s\S]*?aria-pressed="false"/u);
});

test("workflow canvas exposes selection, clipboard, and minimap controls for graph navigation", () => {
  const markup = renderToStaticMarkup(
    <WorkflowCanvas
      locale="zh"
      nodes={baseNodes}
      edges={baseEdges}
      onSelectNode={() => undefined}
      onMoveNode={() => undefined}
      onMoveNodes={() => undefined}
      onDuplicateNodes={() => ["writer-copy"]}
    />,
  );

  assert.match(markup, /aria-label="复制选中节点"/u);
  assert.match(markup, /aria-label="粘贴节点"/u);
  assert.match(markup, /shared-workflow-canvas-minimap/u);
  assert.match(markup, /shared-workflow-canvas-viewport/u);
});

test("workflow canvas treats SVG icon descendants as interactive targets", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/workflow-canvas.tsx", import.meta.url), "utf8"));
  assert.match(source, /target instanceof Element/u);
});

test("workflow canvas uses pointer capture and a desktop-safe palette drag bridge", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/workflow-canvas.tsx", import.meta.url), "utf8"));
  assert.match(source, /WORKFLOW_PALETTE_DRAG_EVENT/u);
  assert.match(source, /WORKFLOW_PALETTE_DROP_EVENT/u);
  assert.match(source, /window\.addEventListener\("pointerup", handlePaletteDragEnd\)/u);
  assert.match(source, /event\.currentTarget\.setPointerCapture\?\.\(event\.pointerId\)/u);
  assert.match(source, /startClientX/u);
  assert.match(source, /if \(!active\.moved\) return/u);
  assert.doesNotMatch(source, /dataTransfer\.getData\("application\/x-workflow-node-type"\)/u);
});
