import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowOutputPreview } from "../src/workflow-output-view";

test("workflow output preview renders every output node by type, not by one reserved key", () => {
  const markup = renderToStaticMarkup(<WorkflowOutputPreview
    node={{ nodeKey: "output-second", type: "output", nodeVersion: 1, title: "Second preview", positionX: 0, positionY: 0, config: {} }}
    snapshot={{ nodeKey: "output-second", status: "succeeded", outputPayload: { text: "Second result" } }}
    locale="en"
  />);

  assert.match(markup, /data-node-output="true"/u);
  assert.match(markup, /Second result/u);
});
