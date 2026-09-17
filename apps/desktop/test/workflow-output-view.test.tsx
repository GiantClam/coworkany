import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatWorkflowNodeError, WorkflowOutputPreview } from "../src/workflow-output-view";

test("workflow node errors turn missing packaged material into an actionable message", () => {
  assert.equal(
    formatWorkflowNodeError("workflow_local_file_missing:attachments/reference.jpeg", "zh"),
    "素材缺失：attachments/reference.jpeg。请在此节点重新选择素材，或重新打包时将素材放入工作流包内。",
  );
  const markup = renderToStaticMarkup(<WorkflowOutputPreview
    node={{ nodeKey: "reference-image", type: "upload", nodeVersion: 1, title: "参考图", positionX: 0, positionY: 0, config: {} }}
    snapshot={{ nodeKey: "reference-image", status: "failed", errorMessage: "workflow_local_file_missing:attachments/reference.jpeg" }}
    locale="zh"
  />);
  assert.match(markup, /素材缺失：attachments\/reference\.jpeg/u);
  assert.doesNotMatch(markup, /workflow_local_file_missing/u);
});

test("workflow node errors explain imported multi-file local nodes", () => {
  assert.equal(
    formatWorkflowNodeError("workflow_upload_multiple_files_not_supported", "zh"),
    "本地文件节点仅支持一个文件。请保留一个文件后重新运行。",
  );
});

test("workflow output preview renders every output node by type, not by one reserved key", () => {
  const markup = renderToStaticMarkup(<WorkflowOutputPreview
    node={{ nodeKey: "output-second", type: "output", nodeVersion: 1, title: "Second preview", positionX: 0, positionY: 0, config: {} }}
    snapshot={{ nodeKey: "output-second", status: "succeeded", outputPayload: { text: "Second result" } }}
    locale="en"
  />);

  assert.match(markup, /data-node-output="true"/u);
  assert.match(markup, /Second result/u);
});

test("workflow output preview keeps audio and video controls interactive inside the canvas", () => {
  const markup = renderToStaticMarkup(<WorkflowOutputPreview
    node={{ nodeKey: "output-media", type: "output", nodeVersion: 1, title: "Media preview", positionX: 0, positionY: 0, config: {} }}
    snapshot={{
      nodeKey: "output-media",
      status: "succeeded",
      outputPayload: {
        video: [{ url: "https://files.example/result.mp4", mimeType: "video/mp4" }],
        audio: [{ url: "https://files.example/result.mp3", mimeType: "audio/mpeg" }],
      },
    }}
    locale="en"
  />);

  assert.match(markup, /<video[^>]+controls[^>]+data-node-no-drag="true"/u);
  assert.match(markup, /<audio[^>]+controls[^>]+data-node-no-drag="true"/u);
});
