import test from "node:test";
import assert from "node:assert/strict";
import { DesktopPreviewSessionRegistry, resolveDesktopLoopbackPreviewUrl, resolveDesktopPreviewRuntimeUrl } from "../src/preview-session";

test("desktop preview URL validation accepts only explicit loopback ports", () => {
  assert.equal(resolveDesktopLoopbackPreviewUrl("http://127.0.0.1:5200/deck"), "http://127.0.0.1:5200/deck");
  assert.equal(resolveDesktopLoopbackPreviewUrl("https://localhost:6060/"), "https://localhost:6060/");
  assert.equal(resolveDesktopLoopbackPreviewUrl("http://[::1]:4173/"), "http://[::1]:4173/");
  for (const value of [
    "https://example.com:443/deck",
    "file:///tmp/deck/index.html",
    "http://127.0.0.1/deck",
    "http://127.0.0.1.evil.test:5200/",
    "http://user:pass@localhost:5200/",
    "javascript:alert(1)",
  ]) assert.equal(resolveDesktopLoopbackPreviewUrl(value), null, value);
});

test("Dashi preview maps untrusted local HTTPS to its HTTP loopback listener", () => {
  assert.equal(resolveDesktopPreviewRuntimeUrl({ engine: "dashi-ppt", url: "https://localhost:5321/deck/" }), "http://127.0.0.1:5321/deck/");
  assert.equal(resolveDesktopPreviewRuntimeUrl({ engine: "dashi-ppt", url: "https://127.0.0.1:5321/deck/" }), "http://127.0.0.1:5321/deck/");
  assert.equal(resolveDesktopPreviewRuntimeUrl({ engine: "dashi-ppt", url: "https://[::1]:5321/deck/" }), "http://[::1]:5321/deck/");
  assert.equal(resolveDesktopPreviewRuntimeUrl({ engine: "dashi-ppt", url: "http://localhost:5321/deck/" }), "http://localhost:5321/deck/");
  assert.equal(resolveDesktopPreviewRuntimeUrl({ engine: "ppt-master", url: "https://localhost:6060/" }), "https://localhost:6060/");
  assert.equal(resolveDesktopPreviewRuntimeUrl({ engine: "dashi-ppt", url: "https://example.com:5321/" }), null);
});

test("preview sessions reconnect, replace by conversation, and clean up without blocking", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const diagnostics: string[] = [];
  const registry = new DesktopPreviewSessionRegistry(async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return { ok: true };
  }, (message) => diagnostics.push(message));
  const context = { messageId: "assistant-run-1", conversationId: "conversation-1", runId: "run-1" };
  assert.equal(await registry.reconnect({ kind: "ppt", title: "First", url: "http://127.0.0.1:5200/", previewSessionId: "first", engine: "ppt-master" }, context), "http://127.0.0.1:5200/");
  assert.equal(await registry.reconnect({ kind: "ppt", title: "Second", url: "http://127.0.0.1:5201/", previewSessionId: "second", engine: "ppt-master" }, context), "http://127.0.0.1:5201/");
  assert.deepEqual(registry.sessions().map((session) => session.id), ["second"]);
  assert.equal(requests.some((request) => request.url === "http://127.0.0.1:5200/api/shutdown" && request.method === "POST"), true);
  assert.equal(await registry.reconnect({ kind: "ppt", title: "Moved", url: "http://127.0.0.1:5202/", previewSessionId: "second", engine: "ppt-master" }, context), "http://127.0.0.1:5202/");
  assert.deepEqual(registry.sessions().map((session) => session.url), ["http://127.0.0.1:5202/"]);
  assert.equal(requests.some((request) => request.url === "http://127.0.0.1:5201/api/shutdown" && request.method === "POST"), true);
  await registry.closeConversation("conversation-1");
  assert.deepEqual(registry.sessions(), []);
  assert.deepEqual(diagnostics, []);
});

test("preview reconnect failure returns unavailable and is not registered", async () => {
  const registry = new DesktopPreviewSessionRegistry(async () => { throw new Error("offline"); });
  const result = await registry.reconnect({ kind: "web", title: "Offline", url: "http://localhost:4100/", previewSessionId: "offline" }, { messageId: "message" }, 10);
  assert.equal(result, null);
  assert.deepEqual(registry.sessions(), []);
});

test("dashi cleanup remains bounded and diagnosable when its server has no shutdown contract", async () => {
  const diagnostics: string[] = [];
  const requests: string[] = [];
  const registry = new DesktopPreviewSessionRegistry(async (input) => { requests.push(String(input)); return { ok: false }; }, (message) => diagnostics.push(message));
  await registry.reconnect({ kind: "ppt", title: "Dashi", url: "https://localhost:5200/", previewSessionId: "dashi", engine: "dashi-ppt" }, { messageId: "message", conversationId: "conversation" });
  assert.equal(registry.sessions()[0]?.url, "http://127.0.0.1:5200/");
  await registry.close("dashi");
  assert.deepEqual(requests, ["http://127.0.0.1:5200/", "http://127.0.0.1:5200/api/shutdown"]);
  assert.deepEqual(diagnostics, ["preview_cleanup_unconfirmed:dashi"]);
});
