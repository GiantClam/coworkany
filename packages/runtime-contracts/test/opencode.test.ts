import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenCodeCommand,
  createOpenCodeEventParser,
  createOpenCodeServeEventState,
  createOpenCodeServePromptPayload,
  createOpenCodeServeSessionPayload,
  extractOpenCodePreviewDescriptor,
  normalizeOpenCodeServeEvent,
  openCodeServePermissionPath,
  openCodeServeSessionPath,
  openCodeServeSessionStatusPath,
  readOpenCodeServeSessionId,
} from "../src/opencode";

test("builds an explicit OpenCode model command", () => {
  assert.deepEqual(buildOpenCodeCommand({ modelHint: "gpt-5.4" }), {
    command: "opencode",
    args: ["run", "--format", "json", "--model", "pptoken/gpt-5.4"],
  });
});

test("parses fragmented text, tool, and usage events", () => {
  const parser = createOpenCodeEventParser("run-1");
  const chunks = [
    '{"type":"text","part":{"text":"你好"}}\n{"type":"tool_use","part":{"tool":"bash"',
    ',"state":{"status":"completed","title":"完成"}}}\n{"type":"step_finish","part":{"tokens":{"input":3,"output":5},"cost":0.01}}\n',
  ];
  const events = chunks.flatMap((chunk) => parser.push(chunk)).concat(parser.finish());
  assert.deepEqual(events.map((event) => event.event), ["text_delta", "tool_event", "usage", "done"]);
  assert.equal(events[0]?.event === "text_delta" ? events[0].delta : "", "你好");
});

test("keeps explicit reasoning separate from line-oriented text", () => {
  const parser = createOpenCodeEventParser("run-reasoning-line");
  const events = parser.push('{"type":"reasoning","part":{"text":"planning"}}\n{"type":"text","part":{"text":"# 你好"}}\n').concat(parser.finish());
  assert.deepEqual(events.map((event) => event.event), ["reasoning_delta", "text_delta", "done"]);
  assert.equal(events[0]?.event === "reasoning_delta" ? events[0].delta : "", "planning");
  assert.equal(events[1]?.event === "text_delta" ? events[1].delta : "", "# 你好");
});

test("preserves every text byte, including content that resembles internal planning", () => {
  const text = "TheuserTheuser\n\n---##标题\n\n**正文**";
  const parser = createOpenCodeEventParser("run-exact-text");
  const events = parser.push(JSON.stringify({ type: "text", part: { text } }) + "\n").concat(parser.finish());
  assert.equal(events[0]?.event === "text_delta" ? events[0].delta : "", text);
  assert.deepEqual(events.map((event) => event.event), ["text_delta", "done"]);
});

test("normalizes legacy thinking fields as reasoning events", () => {
  const parser = createOpenCodeEventParser("run-thinking");
  const parsed = parser.push('{"type":"message","thinking":"先规划"}\n').concat(parser.finish());
  assert.deepEqual(parsed[0], { event: "reasoning_delta", delta: "先规划", runId: "run-thinking" });

  const state = createOpenCodeServeEventState();
  const result = normalizeOpenCodeServeEvent("run-thinking", {
    payload: { type: "message.part.delta", properties: { sessionID: "session-thinking", messageID: "assistant-thinking", partID: "part-thinking", part: { type: "thinking", delta: "再检查" } } },
  }, state);
  assert.deepEqual(result.events, [{ event: "reasoning_delta", delta: "再检查", runId: "run-thinking" }]);
});

test("normalizes serve text snapshots without guessing their language or intent", () => {
  const state = createOpenCodeServeEventState();
  const session = "session-text";
  const message = "assistant-text";
  normalizeOpenCodeServeEvent("run-text", {
    payload: { type: "message.updated", properties: { sessionID: session, info: { id: message, role: "assistant" } } },
  }, state);
  const first = normalizeOpenCodeServeEvent("run-text", {
    payload: { type: "message.part.delta", properties: { sessionID: session, messageID: message, partID: "part-text", field: "text", delta: "The user asks me to answer. " } },
  }, state);
  const second = normalizeOpenCodeServeEvent("run-text", {
    payload: { type: "message.part.delta", properties: { sessionID: session, messageID: message, partID: "part-text", field: "text", delta: "# 标题\n\n**正文**" } },
  }, state);
  assert.deepEqual(first.events, [{ event: "text_delta", delta: "The user asks me to answer. ", runId: "run-text" }]);
  assert.deepEqual(second.events, [{ event: "text_delta", delta: "# 标题\n\n**正文**", runId: "run-text" }]);

  const snapshot = normalizeOpenCodeServeEvent("run-text", {
    payload: { type: "message.part.updated", properties: { sessionID: session, part: { id: "part-text", messageID: message, type: "text", text: "The user asks me to answer. # 标题\n\n**正文**" } } },
  }, state);
  assert.deepEqual(snapshot.events, []);
});

for (const channel of [
  { type: "text", field: "text", snapshotField: "text", event: "text_delta" },
  { type: "reasoning", field: "text", snapshotField: "text", event: "reasoning_delta" },
  { type: "thinking", field: "text", snapshotField: "text", event: "reasoning_delta" },
  { type: "text", field: "reasoning_content", snapshotField: "reasoning_content", event: "reasoning_delta" },
] as const) {
  for (const initialSource of ["snapshot", "delta"] as const) {
    test(`${channel.type}/${channel.field} snapshots keep a monotonic cache after ${initialSource}`, () => {
      const state = createOpenCodeServeEventState();
      const runId = "snapshot-order";
      const identity = { sessionID: "session", messageID: "assistant" };
      const snapshot = (text: string) => normalizeOpenCodeServeEvent(runId, {
        type: "message.part.updated",
        properties: { part: { ...identity, id: "part", type: channel.type, [channel.snapshotField]: text } },
      }, state).events;
      const delta = (text: string) => normalizeOpenCodeServeEvent(runId, {
        type: "message.part.delta",
        properties: { ...identity, partID: "part", field: channel.field, delta: text },
      }, state).events;
      assert.deepEqual(snapshot(""), []); // Establish the type for generic text deltas.
      const emitted = [...(initialSource === "snapshot" ? snapshot("Hello world") : delta("Hello world"))];
      assert.deepEqual(emitted, [{ event: channel.event, delta: "Hello world", runId }]);

      for (const stale of ["Hello", "", "Hello world", "Hello w"]) {
        assert.deepEqual(snapshot(stale), [], `stale/equal snapshot: ${JSON.stringify(stale)}`);
        assert.equal(state.textByPartId.get("part"), "Hello world");
      }
      // A delta-only consumer cannot replace emitted text with a conflicting snapshot.
      for (const conflicting of ["Other", "HELLO WORLD", "A different longer snapshot"]) {
        assert.deepEqual(snapshot(conflicting), []);
        assert.equal(state.textByPartId.get("part"), "Hello world");
      }

      emitted.push(...delta("!"));
      assert.equal(state.textByPartId.get("part"), "Hello world!");
      assert.deepEqual(snapshot("Hello world"), []);
      assert.equal(state.textByPartId.get("part"), "Hello world!");
      // The host reconciles an extending snapshot at idle, after streaming stops.
      const finalText = "Hello world!\n最终结果";
      const final = snapshot(finalText);
      assert.deepEqual(final, [{ event: channel.event, delta: "\n最终结果", runId }]);
      emitted.push(...final);
      assert.deepEqual(snapshot(finalText), []);
      assert.equal(state.textByPartId.get("part"), finalText);
      assert.equal(emitted.map(event => "delta" in event ? event.delta : "").join(""), finalText);
      assert.equal(emitted.every(event => event.event === channel.event), true);
    });
  }
}

test("normalizes session-level busy and idle status without treating message completion as turn completion", () => {
  const state = createOpenCodeServeEventState();
  const busy = normalizeOpenCodeServeEvent("run-status", { payload: { type: "session.status", properties: { sessionID: "session-status", status: { type: "busy" } } } }, state);
  const completedMessage = normalizeOpenCodeServeEvent("run-status", { payload: { type: "message.updated", properties: { sessionID: "session-status", info: { id: "assistant-status", role: "assistant", time: { completed: Date.now() } } } } }, state);
  const idle = normalizeOpenCodeServeEvent("run-status", { payload: { type: "session.status", properties: { sessionID: "session-status", status: { type: "idle" } } } }, state);
  assert.equal(busy.sessionStatus, "busy");
  assert.equal(completedMessage.messageCompleted, true);
  const toolTurn = normalizeOpenCodeServeEvent("run-status", { payload: { type: "message.updated", properties: { sessionID: "session-status", info: { id: "assistant-tool", role: "assistant", finish: "tool-calls", time: { completed: Date.now() } } } } }, state);
  assert.equal(toolTurn.messageFinish, "tool-calls");
  assert.equal(completedMessage.sessionIdle, undefined);
  assert.equal(idle.sessionStatus, "idle");
  assert.equal(idle.sessionIdle, true);
  assert.equal(openCodeServeSessionStatusPath("C:\\work\\project"), "/session/status?directory=C%3A%5Cwork%5Cproject");
});

test("keeps explicit serve reasoning out of assistant text", () => {
  const state = createOpenCodeServeEventState();
  const session = "session-reasoning";
  const message = "assistant-reasoning";
  normalizeOpenCodeServeEvent("run-reasoning", {
    payload: { type: "message.updated", properties: { sessionID: session, info: { id: message, role: "assistant" } } },
  }, state);
  const reasoning = normalizeOpenCodeServeEvent("run-reasoning", {
    payload: { type: "message.part.delta", properties: { sessionID: session, messageID: message, partID: "part-reasoning", field: "reasoning", delta: "private thinking" } },
  }, state);
  const text = normalizeOpenCodeServeEvent("run-reasoning", {
    payload: { type: "message.part.delta", properties: { sessionID: session, messageID: message, partID: "part-text", field: "text", delta: "public answer" } },
  }, state);
  assert.deepEqual(reasoning.events, [{ event: "reasoning_delta", delta: "private thinking", runId: "run-reasoning" }]);
  assert.deepEqual(text.events, [{ event: "text_delta", delta: "public answer", runId: "run-reasoning" }]);
});

test("maps provider reasoning_content snapshots and deltas to reasoning only", () => {
  const state = createOpenCodeServeEventState();
  const session = "session-reasoning-content";
  const message = "assistant-reasoning-content";
  normalizeOpenCodeServeEvent("run-reasoning-content", {
    payload: { type: "message.updated", properties: { sessionID: session, info: { id: message, role: "assistant" } } },
  }, state);
  const delta = normalizeOpenCodeServeEvent("run-reasoning-content", {
    payload: { type: "message.part.delta", properties: { sessionID: session, messageID: message, partID: "part-reasoning", field: "reasoning_content", delta: "private reasoning" } },
  }, state);
  const snapshot = normalizeOpenCodeServeEvent("run-reasoning-content", {
    payload: { type: "message.part.updated", properties: { sessionID: session, part: { id: "part-reasoning", messageID: message, type: "text", reasoning_content: "private reasoning plus more" } } },
  }, state);
  assert.deepEqual(delta.events, [{ event: "reasoning_delta", delta: "private reasoning", runId: "run-reasoning-content" }]);
  assert.deepEqual(snapshot.events, [{ event: "reasoning_delta", delta: " plus more", runId: "run-reasoning-content" }]);
});

test("uses the stable OpenCode part type when a delta field is generic", () => {
  const state = createOpenCodeServeEventState();
  const session = "session-typed-delta";
  const message = "assistant-typed-delta";
  normalizeOpenCodeServeEvent("run-typed-delta", {
    payload: { type: "message.updated", properties: { sessionID: session, info: { id: message, role: "assistant" } } },
  }, state);
  normalizeOpenCodeServeEvent("run-typed-delta", {
    payload: { type: "message.part.updated", properties: { sessionID: session, part: { id: "part-reasoning", messageID: message, type: "reasoning", text: "" } } },
  }, state);
  const reasoning = normalizeOpenCodeServeEvent("run-typed-delta", {
    payload: { type: "message.part.delta", properties: { sessionID: session, messageID: message, partID: "part-reasoning", field: "text", delta: "private reasoning" } },
  }, state);
  assert.deepEqual(reasoning.events, [{ event: "reasoning_delta", delta: "private reasoning", runId: "run-typed-delta" }]);
});

test("suppresses user message parts while retaining assistant snapshots", () => {
  const state = createOpenCodeServeEventState();
  normalizeOpenCodeServeEvent("run-session", {
    payload: { type: "message.updated", properties: { sessionID: "session-1", info: { id: "user-1", role: "user" } } },
  }, state);
  const user = normalizeOpenCodeServeEvent("run-session", {
    payload: { type: "message.part.updated", properties: { sessionID: "session-1", part: { id: "user-part", messageID: "user-1", type: "text", text: "do not echo" } } },
  }, state);
  assert.deepEqual(user.events, []);
});

test("normalizes tools, usage, and session errors from serve", () => {
  const state = createOpenCodeServeEventState();
  const tool = normalizeOpenCodeServeEvent("run-serve", {
    payload: { type: "message.part.updated", properties: { sessionID: "session-serve", part: { id: "tool-1", type: "tool", tool: "shell", state: { status: "completed", title: "done" } } } },
  }, state);
  const usage = normalizeOpenCodeServeEvent("run-serve", {
    payload: { type: "message.part.updated", properties: { sessionID: "session-serve", part: { type: "step_finish", tokens: { input: 3, output: 5 }, cost: 0.01 } } },
  }, state);
  const failure = normalizeOpenCodeServeEvent("run-serve", {
    payload: { type: "session.error", properties: { sessionID: "session-serve", error: { message: "broken" } } },
  }, state);
  assert.deepEqual(tool.events, [{ event: "tool_event", tool: "shell", toolCallId: "tool-1", phase: "completed", message: "done", runId: "run-serve" }]);
  assert.deepEqual(usage.events, [{ event: "usage", inputTokens: 3, outputTokens: 5, costUsd: 0.01, runId: "run-serve" }]);
  assert.deepEqual(failure.terminalError, { code: "opencode_error", message: "broken", retryable: true });
});

test("extracts completed PPT preview servers from loopback tool output", () => {
  assert.deepEqual(extractOpenCodePreviewDescriptor({
    id: "dashi-preview-1",
    type: "tool",
    tool: "shell",
    state: {
      status: "completed",
      input: { command: "npm run preview:start -- output 5200" },
      output: "HTTP export URL: http://127.0.0.1:5200/\nPID: 1234",
    },
  }), {
    kind: "ppt",
    title: "Dashi PPT preview",
    url: "http://127.0.0.1:5200/",
    previewSessionId: "dashi-ppt:dashi-preview-1",
    engine: "dashi-ppt",
    interactive: true,
    status: "ready",
  });

  const normalized = normalizeOpenCodeServeEvent("run-ppt", {
    payload: {
      type: "message.part.updated",
      properties: {
        sessionID: "session-ppt",
        part: {
          id: "ppt-preview-1",
          type: "tool",
          tool: "shell",
          state: {
            status: "completed",
            input: { command: "python3 skills/ppt-master/svg_editor/server.py projects/deck --live --daemon --no-browser" },
            output: "Preview ready at http://localhost:6060/",
          },
        },
      },
    },
  }, createOpenCodeServeEventState());
  assert.deepEqual(normalized.events.map((event) => event.event), ["tool_event", "preview"]);
  assert.deepEqual(normalized.events[1], {
    event: "preview",
    preview: {
      kind: "ppt",
      title: "PPT Master preview",
      url: "http://localhost:6060/",
      previewSessionId: "ppt-master:ppt-preview-1",
      engine: "ppt-master",
      interactive: true,
      status: "ready",
    },
    runId: "run-ppt",
  });
});

test("rejects incomplete, remote, and file PPT preview sources", () => {
  const part = (status: string, output: string) => ({
    id: "preview-unsafe",
    type: "tool",
    tool: "shell",
    state: { status, input: { command: "npm run preview:start" }, output },
  });
  assert.equal(extractOpenCodePreviewDescriptor(part("running", "http://127.0.0.1:5200/")), undefined);
  assert.equal(extractOpenCodePreviewDescriptor(part("completed", "https://example.com/deck")), undefined);
  assert.equal(extractOpenCodePreviewDescriptor(part("completed", "file:///tmp/deck/index.html")), undefined);
  assert.equal(extractOpenCodePreviewDescriptor(part("completed", "http://127.0.0.1/deck")), undefined);
});

test("extracts a generic local website preview for AI and Agent conversations", () => {
  assert.deepEqual(extractOpenCodePreviewDescriptor({
    id: "web-preview-1",
    type: "tool",
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "pnpm run dev -- --port 4173" },
      output: "Local: http://localhost:4173/",
    },
  }), {
    kind: "web",
    title: "Website preview",
    url: "http://localhost:4173/",
    previewSessionId: "generic-web:web-preview-1",
    engine: "generic-web",
    interactive: true,
    status: "ready",
  });
});

test("builds serve paths and strict payloads", () => {
  assert.equal(openCodeServeSessionPath("session/1", "D:\\workspace"), "/session/session%2F1?directory=D%3A%5Cworkspace");
  assert.equal(openCodeServePermissionPath("session/1", "permission/1"), "/session/session%2F1/permissions/permission%2F1");
  assert.deepEqual(createOpenCodeServeSessionPayload({ title: "Chat", providerId: "provider", modelId: "model", agent: "build" }), { title: "Chat" });
  assert.deepEqual(createOpenCodeServePromptPayload({ prompt: "hello", providerId: "provider", modelId: "model", variant: "high", systemPrompt: "system", agent: "build" }), {
    agent: "build",
    model: { providerID: "provider", modelID: "model" },
    variant: "high",
    system: "system",
    parts: [{ type: "text", text: "hello" }],
  });
  assert.equal(readOpenCodeServeSessionId({ data: { id: "session-1" } }), "session-1");
});

test("keeps unknown events bounded and does not throw", () => {
  const parser = createOpenCodeEventParser("run-2");
  const events = parser.push('{"type":"future_event","payload":"x"}\n').concat(parser.finish());
  assert.equal(events[0]?.event, "runtime_warning");
  assert.equal(events.at(-1)?.event, "done");
});
