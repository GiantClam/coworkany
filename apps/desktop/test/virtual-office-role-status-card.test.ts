import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfficeRoleStatusCard } from "../src/virtual-office/OfficeRoleStatusCard";
import type { OfficeRoleDefinition, OfficeRoleState } from "../src/virtual-office/types";

const role: OfficeRoleDefinition = {
  roleId: "ai-chat",
  label: { zh: "AI 对话", en: "AI Chat" },
  homeRoute: "/dashboard/ai",
  sourceAdapterId: "conversation-runs",
  healthSourceIds: ["runs"],
  enabledWhen: () => true,
  workItemRoute: (item) => item.routeTarget ?? "/dashboard/ai",
  artifactKinds: ["document"],
  workstationAssetId: "workstations",
  characterAssetId: "characters",
  deviceLimit: 3,
};

const state: OfficeRoleState = {
  roleId: "ai-chat",
  status: "waiting",
  activeCount: 2,
  queuedCount: 1,
  waitingUserCount: 1,
  failedCount: 3,
  recentItems: [{ sourceAdapterId: "conversation-runs", workItemId: "recent-1", roleId: "ai-chat", status: "completed", statusVersion: "1", title: "最近成果", updatedAt: "2026-10-10T00:00:00.000Z", artifactIds: [] }],
  devices: [{ deviceId: "device-1", workItemKey: { sourceAdapterId: "conversation-runs", workItemId: "active-1" }, visualStatus: "running" }],
  overflowCount: 2,
  available: true,
};

test("status card exposes localized state, workload counts, work items, and one enter action", () => {
  const html = renderToStaticMarkup(React.createElement(OfficeRoleStatusCard, { role, state, locale: "zh", onEnter: () => undefined, onWorkItemOpen: () => undefined, onClose: () => undefined }));
  assert.match(html, /AI 对话/);
  assert.match(html, /等待你处理/);
  assert.match(html, /进行中/);
  assert.match(html, /排队/);
  assert.match(html, /待处理/);
  assert.match(html, /失败/);
  assert.match(html, /进入工作区/);
  assert.equal((html.match(/data-office-status-card/g) ?? []).length, 1);
  assert.match(html, /data-office-status-close/);
});

test("unavailable role disables entering the workspace", () => {
  const html = renderToStaticMarkup(React.createElement(OfficeRoleStatusCard, { role, state: { ...state, status: "offline", available: false }, locale: "en", onEnter: () => undefined }));
  assert.match(html, /disabled=""/);
  assert.match(html, /Currently unavailable/);
});

test("task and recent buttons retain stable work-item keys", () => {
  const received: Array<{ sourceAdapterId: string; workItemId: string }> = [];
  const element = OfficeRoleStatusCard({ role, state, locale: "en", onEnter: () => undefined, onWorkItemOpen: (key) => received.push(key) });
  const collect = (node: React.ReactNode): React.ReactElement[] => {
    if (Array.isArray(node)) return node.flatMap(collect);
    if (!React.isValidElement(node)) return [];
    const children = (node.props as { children?: React.ReactNode }).children;
    return [node, ...collect(children)];
  };
  const buttons = collect(element).filter((candidate) => candidate.type === "button");
  (buttons[0].props as { onClick: () => void }).onClick();
  (buttons.at(-2)?.props as { onClick: () => void }).onClick();
  assert.deepEqual(received, [
    { sourceAdapterId: "conversation-runs", workItemId: "active-1" },
    { sourceAdapterId: "conversation-runs", workItemId: "recent-1" },
  ]);
});
