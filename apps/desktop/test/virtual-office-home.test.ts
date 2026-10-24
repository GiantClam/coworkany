import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VirtualOfficeHome } from "../src/virtual-office/VirtualOfficeHome";
import type { OfficeCapabilities, OfficeSnapshot, OfficeStore } from "../src/virtual-office/types";

const roles = ["ai-chat", "agent-center", "ppt-expert", "workflow-operator", "writer", "image-creator", "video-producer"] as const;
const routes = new Set([
  "/dashboard/ai",
  "/dashboard/agent-platform",
  "/dashboard/ai?agent=executive-ppt",
  "/dashboard/workflows",
  "/dashboard/writer",
  "/dashboard/image-assistant",
  "/dashboard/video",
]);
const capabilities: OfficeCapabilities = {
  routes,
  featureFlags: new Set(["ppt_generate"]),
  runtime: { text: true, agents: true, workflows: true },
  providers: { image: "configured", video: "configured" },
  agentDirectoryReady: true,
};
const snapshot: OfficeSnapshot = { roles: [], workItems: [], revision: 1 };
const store: OfficeStore = {
  start: async () => undefined,
  stop: () => undefined,
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
};

test("standalone office removes the title and role articles but keeps accessible role controls", () => {
  const markup = renderToStaticMarkup(React.createElement(VirtualOfficeHome, {
    store,
    capabilities,
    navigation: { go: () => undefined },
    locale: "zh",
    sceneEnabled: false,
    standalone: true,
  }));

  assert.doesNotMatch(markup, /class="virtual-office__header"/u);
  assert.doesNotMatch(markup, /<article\b/u);
  assert.match(markup, /class="virtual-office-role-controls"/u);
  for (const roleId of roles) assert.match(markup, new RegExp(`data-role-id="${roleId}"`, "u"));
});
