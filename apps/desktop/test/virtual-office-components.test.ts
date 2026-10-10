import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleCard } from "../src/virtual-office/RoleCard";
import type { OfficeRoleDefinition, OfficeRoleState } from "../src/virtual-office/types";

const role: OfficeRoleDefinition = { roleId: "ai-chat", label: { zh: "AI 对话", en: "AI Chat" }, homeRoute: "/dashboard/ai", sourceAdapterId: "conversation-runs", healthSourceIds: ["runs"], enabledWhen: () => true, workItemRoute: (item) => item.routeTarget ?? "/dashboard/ai", artifactKinds: ["document"], workstationAssetId: "workstations", characterAssetId: "characters", deviceLimit: 3 };
const state: OfficeRoleState = { roleId: "ai-chat", status: "waiting", activeCount: 1, queuedCount: 0, waitingUserCount: 1, failedCount: 0, recentItems: Array.from({ length: 20 }, (_, index) => ({ sourceAdapterId: "conversation-runs", workItemId: String(index), roleId: "ai-chat", status: "completed", statusVersion: String(index), title: `Result ${index}`, updatedAt: new Date(2026, 0, index + 1).toISOString(), artifactIds: [] })), devices: [{ deviceId: "one", workItemKey: { sourceAdapterId: "conversation-runs", workItemId: "running-1" }, visualStatus: "running" }, { deviceId: "two", workItemKey: { sourceAdapterId: "conversation-runs", workItemId: "running-2" }, visualStatus: "waiting" }, { deviceId: "three", workItemKey: { sourceAdapterId: "conversation-runs", workItemId: "running-3" }, visualStatus: "queued" }], overflowCount: 2, available: true };

function findElements(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!React.isValidElement(node)) return [];
  const props = node.props as { children?: React.ReactNode; onClick?: () => void };
  const children = props.children;
  return [...(predicate(node) ? [node] : []), ...(Array.isArray(children) ? children.flatMap((child) => findElements(child, predicate)) : findElements(children, predicate))];
}

test("SSR exposes localized status, waiting reason, devices, overflow, recent20 and accessible buttons", () => {
  const zh = renderToStaticMarkup(React.createElement(RoleCard, { role, state, locale: "zh", onOpen: () => undefined, onWorkItemOpen: () => undefined }));
  const en = renderToStaticMarkup(React.createElement(RoleCard, { role, state, locale: "en", onOpen: () => undefined, onWorkItemOpen: () => undefined }));
  assert.match(zh, /AI 对话/);
  assert.match(en, /AI Chat/);
  assert.match(zh, /等待你处理/);
  assert.match(en, /Waiting for you/);
  assert.match(zh, /待处理/);
  assert.match(zh, /\+2/);
  assert.equal((zh.match(/virtual-office-device/g) ?? []).length >= 3, true);
  assert.match(zh, /Result 19/);
  assert.match(zh, /type="button"/);
});

test("SSR exposes bilingual offline status while retaining role navigation", () => {
  const offlineState = { ...state, status: "offline" as const, available: false, devices: [], overflowCount: 0 };
  const zh = renderToStaticMarkup(React.createElement(RoleCard, { role, state: offlineState, locale: "zh", onOpen: () => undefined }));
  const en = renderToStaticMarkup(React.createElement(RoleCard, { role, state: offlineState, locale: "en", onOpen: () => undefined }));
  assert.match(zh, /不可用/);
  assert.match(zh, /当前不可用/);
  assert.match(en, /Offline/);
  assert.match(en, /currently unavailable/);
  assert.match(en, /View status for AI Chat/);
});

test("device and recent handlers receive stable composite keys", () => {
  const received: Array<{ sourceAdapterId: string; workItemId: string }> = [];
  const element = RoleCard({ role, state, locale: "en", onOpen: () => undefined, onWorkItemOpen: (key) => received.push(key) });
  const buttons = findElements(element, (candidate) => candidate.type === "button");
  assert.equal(buttons.length, 24);
  (buttons[1].props as { onClick: () => void }).onClick();
  (buttons.at(-1)?.props as { onClick: () => void }).onClick();
  assert.deepEqual(received, [
    { sourceAdapterId: "conversation-runs", workItemId: "running-1" },
    { sourceAdapterId: "conversation-runs", workItemId: "19" },
  ]);
});
