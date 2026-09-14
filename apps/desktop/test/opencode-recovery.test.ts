import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createOpenCodeServeEventState, type OpenCodeRuntimeEvent } from "@coworkany/runtime-contracts/opencode";
import { OpenCodeServeClient } from "../runtime/opencode-serve";

const SESSION = "session-recovery";
const RUN = "run-recovery";
const WORKSPACE = "D:/recovery-test-workspace";
const TURN_START = 10_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function memoryRun(events: OpenCodeRuntimeEvent[], timeline: string[]) {
  const completion = deferred<void>();
  return {
    runId: RUN, sessionId: SESSION, turnStartedAt: TURN_START,
    sink: (event: OpenCodeRuntimeEvent) => { events.push(event); timeline.push(event.event === "text_delta" ? event.delta : event.event); },
    serveEvents: createOpenCodeServeEventState(),
    messageIds: new Set<string>(), userMessageIds: new Set<string>(), ignoredMessageIds: new Set<string>(), questionIds: new Set<string>(), pendingQuestionIds: new Set<string>(),
    pendingFrames: new Map<string, string[]>(),
    completion: completion.promise,
    resolveCompletion: () => { timeline.push("complete"); completion.resolve(); },
    userMessageId: undefined as string | undefined,
    submittedMessageId: undefined as string | undefined,
    onAccepted: undefined as (() => void) | undefined,
    lastAssistantFinish: undefined as string | undefined,
    failed: undefined as string | undefined,
    promptSubmitted: true, assistantMessageSeen: false, assistantFinalMessageSeen: false,
    lastMessagePollAt: 0, busySeen: true, activitySeen: false, completed: false,
    idleSeen: false, streamInterrupted: false,
  };
}

type MemoryRun = ReturnType<typeof memoryRun>;
// Cast only the test seam. Event routing, normalization, reconciliation, polling,
// question restoration and prompt acceptance all execute production methods.
type ClientInternals = {
  active: Map<string, MemoryRun>;
  selectedSkills: Map<string, string>;
  baseUrl: string;
  child: { exitCode: number | null } | undefined;
  ensureStarted(workspace: string, environment: Record<string, string | undefined>): Promise<void>;
  handleEvent(frame: string, snapshot?: boolean): void;
  complete(active: MemoryRun): void;
  reconcileCompletedMessage(active: MemoryRun, workspace: string, signal: AbortSignal, idle: boolean): Promise<void>;
  pollSessionStatus(active: MemoryRun, workspace: string, signal: AbortSignal): Promise<void>;
};

function harness(t: TestContext, respond: (url: URL, init?: RequestInit) => unknown | Promise<unknown> = () => []) {
  const events: OpenCodeRuntimeEvent[] = [];
  const timeline: string[] = [];
  const requests: URL[] = [];
  const client = new OpenCodeServeClient("unused-opencode", "unused-runtime");
  const internal = client as unknown as ClientInternals;
  internal.baseUrl = "http://opencode-recovery.invalid";
  const active = memoryRun(events, timeline);
  internal.active.set(RUN, active);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, internal.baseUrl, "the memory test must never contact an external service");
    requests.push(url);
    const body = await respond(url, init);
    return body instanceof Response ? body : Response.json(body);
  });
  const emit = (type: string, properties: Record<string, unknown>) => internal.handleEvent(`data: ${JSON.stringify({ type, properties })}`);
  return { client, internal, active, events, timeline, requests, emit,
    user(id: string, created = TURN_START) { emit("message.updated", { info: userInfo(id, created) }); },
    assistant(id: string, parentID: string, extra: Record<string, unknown> = {}) { emit("message.updated", { info: assistantInfo(id, parentID, extra) }); },
    text(messageID: string, text: string, id = `part-${messageID}`) { emit("message.part.updated", { part: textPart(messageID, text, id) }); },
    delta(messageID: string, delta: string, partID = `part-${messageID}`) { emit("message.part.delta", { sessionID: SESSION, messageID, partID, field: "text", delta }); },
    textOutput() { return events.filter((event) => event.event === "text_delta").map((event) => event.delta).join(""); },
    reconcile(idle = true) { return internal.reconcileCompletedMessage(active, WORKSPACE, new AbortController().signal, idle); },
  };
}

function userInfo(id: string, created = TURN_START) {
  return { id, role: "user", sessionID: SESSION, time: { created } };
}
function assistantInfo(id: string, parentID: string, extra: Record<string, unknown> = {}) {
  return { id, role: "assistant", parentID, sessionID: SESSION, time: { created: TURN_START + 2 }, ...extra };
}
function finalInfo(id: string, parentID: string, extra: Record<string, unknown> = {}) {
  return assistantInfo(id, parentID, { finish: "stop", time: { created: TURN_START + 2, completed: TURN_START + 3 }, ...extra });
}
function textPart(messageID: string, text: string, id = `part-${messageID}`) {
  return { id, type: "text", sessionID: SESSION, messageID, text };
}

async function pollOneCycle(h: ReturnType<typeof harness>) {
  h.active.lastMessagePollAt = 0;
  const controller = new AbortController();
  // Terminate the test loop, not a production completion path. Immediate fake
  // fetches finish before this timer; the client's normal 500ms sleep remains.
  const stop = setTimeout(() => controller.abort(), 30);
  try { await h.internal.pollSessionStatus(h.active, WORKSPACE, controller.signal); }
  finally { clearTimeout(stop); controller.abort(); }
}

test("recovery accepts assistant parents created by native compaction/replay users in the current turn", (t) => {
  const h = harness(t);
  h.user("original-user");
  h.user("compaction-user", TURN_START + 1);
  h.user("replayed-user", TURN_START + 2);
  // Parts may arrive before their message header after reconnection.
  h.text("after-compaction", "压缩后继续。");
  h.assistant("after-compaction", "compaction-user");
  h.assistant("after-replay", "replayed-user");
  h.text("after-replay", "重放后继续。");
  assert.equal(h.textOutput(), "压缩后继续。重放后继续。");
  assert.deepEqual([...h.active.userMessageIds], ["original-user", "compaction-user", "replayed-user"]);
  assert.equal(h.active.completed, false);
});

test("recovery excludes late previous-turn users, their assistant replies and unowned parents", (t) => {
  const h = harness(t);
  h.user("old-user", TURN_START - 1);
  h.text("late-old-assistant", "旧轮内容不得出现");
  h.assistant("late-old-assistant", "old-user", { time: { created: TURN_START + 20 } });
  h.delta("late-old-assistant", "旧轮迟到增量");
  h.user("current-user", TURN_START);
  h.assistant("unowned-assistant", "unknown-user");
  h.text("unowned-assistant", "其他父消息");
  h.assistant("current-assistant", "current-user");
  h.text("current-assistant", "本轮回答");
  assert.equal(h.textOutput(), "本轮回答");
  assert.equal(h.active.userMessageIds.has("old-user"), false);
  assert.equal(h.active.pendingFrames.has("late-old-assistant"), false);
  assert.equal(h.active.messageIds.has("unowned-assistant"), false);
});

test("recovery uses the submitted native message ID across clock skew without admitting a previous user", async (t) => {
  const h = harness(t, (url) => url.pathname.endsWith("/message") ? [
    { info: userInfo("old-user", TURN_START - 1), parts: [] },
    { info: finalInfo("old-answer", "old-user"), parts: [textPart("old-answer", "WRONG TURN")] },
    { info: userInfo("submitted-user", TURN_START - 1), parts: [] },
    { info: finalInfo("answer", "submitted-user"), parts: [textPart("answer", "Current answer")] },
  ] : []);
  h.active.submittedMessageId = "submitted-user";
  // Both timestamps are one millisecond behind; only the submitted ID owns
  // this turn, even when the entire SSE stream was missed.
  await h.reconcile();
  assert.deepEqual([...h.active.userMessageIds], ["submitted-user"]);
  assert.equal(h.active.messageIds.has("old-answer"), false);
  assert.equal(h.textOutput(), "Current answer");
  assert.equal(h.active.completed, true);
});

test("compaction summary assistants never emit text or mark a turn final", (t) => {
  const h = harness(t);
  h.user("current-user");
  h.text("summary", "内部压缩摘要");
  h.assistant("summary", "current-user", { ...finalInfo("summary", "current-user"), summary: true });
  h.delta("summary", "后续摘要增量");
  assert.equal(h.textOutput(), "");
  assert.equal(h.active.assistantFinalMessageSeen, false);
  assert.equal(h.active.messageIds.has("summary"), false);
  assert.equal(h.active.pendingFrames.has("summary"), false);
});

for (const type of ["session.idle", "session.status"]) {
  test(`${type} leaves a final assistant open until the idle snapshot is reconciled`, (t) => {
    const h = harness(t);
    h.user("current-user");
    h.assistant("answer", "current-user", finalInfo("answer", "current-user"));
    h.text("answer", "已收到前半段");
    h.emit(type, { sessionID: SESSION, ...(type === "session.status" ? { status: { type: "idle" } } : {}) });
    assert.equal(h.active.assistantFinalMessageSeen, true);
    assert.equal(h.active.completed, false, "SSE idle must not bypass the final persisted snapshot");
    assert.equal(h.timeline.includes("complete"), false);
  });
}

test("idle polling fetches the missing final text tail before resolving completion", async (t) => {
  const h = harness(t, (url) => {
    if (url.pathname === "/session/status") return { [SESSION]: { type: "idle" } };
    if (url.pathname.endsWith("/message")) return [
      { info: userInfo("current-user"), parts: [] },
      { info: finalInfo("answer", "current-user"), parts: [textPart("answer", "前半段，断线期间持久化的尾部。")] },
    ];
    return [];
  });
  h.user("current-user");
  h.assistant("answer", "current-user", finalInfo("answer", "current-user"));
  h.delta("answer", "前半段");
  await pollOneCycle(h);
  assert.ok(h.requests.some((url) => url.pathname.endsWith("/message")));
  assert.equal(h.textOutput(), "前半段，断线期间持久化的尾部。");
  assert.equal(h.active.completed, true);
  assert.deepEqual(h.timeline.slice(-2), ["，断线期间持久化的尾部。", "complete"]);
});

test("busy polling cannot replay text snapshots ahead of queued SSE deltas", async (t) => {
  const h = harness(t, (url) => {
    if (url.pathname === "/session/status") return { [SESSION]: { type: "busy" } };
    if (url.pathname.endsWith("/message")) return [{ info: finalInfo("answer", "current-user"), parts: [textPart("answer", "AB")] }];
    return [];
  });
  h.user("current-user");
  h.assistant("answer", "current-user");
  h.delta("answer", "A");
  await pollOneCycle(h);
  assert.equal(h.textOutput(), "A");
  assert.equal(h.active.completed, false);
  h.delta("answer", "B");
  assert.equal(h.textOutput(), "AB", "a busy snapshot must not turn a later SSE delta into ABB");
});

test("idle reconciliation recovers a compaction parent and excludes historical summary text", async (t) => {
  const h = harness(t, () => ({ messages: [
    { info: userInfo("old-user", TURN_START - 1), parts: [] },
    { info: finalInfo("old-answer", "old-user"), parts: [textPart("old-answer", "历史回答")] },
    { info: userInfo("original-user"), parts: [] },
    { info: finalInfo("summary", "original-user", { summary: true }), parts: [textPart("summary", "压缩摘要")] },
    { info: userInfo("replay-user", TURN_START + 1), parts: [textPart("replay-user", "原生重放用户内容")] },
    { info: finalInfo("final-answer", "replay-user"), parts: [textPart("final-answer", "恢复后的最终回答")] },
  ] }));
  await h.reconcile();
  assert.equal(h.textOutput(), "恢复后的最终回答");
  assert.equal(h.active.completed, true);
});

test("idle reconciliation does not finish a turn with a pending question", async (t) => {
  const question = { id: "question-pending", sessionID: SESSION, questions: [{ header: "确认", question: "是否继续", options: [{ label: "继续", description: "继续执行" }] }] };
  const h = harness(t, (url) => {
    if (url.pathname.endsWith("/message")) return [{ info: userInfo("current-user"), parts: [] }, { info: finalInfo("answer", "current-user"), parts: [textPart("answer", "尚未确认")] }];
    if (url.pathname === "/question") return [question];
    return [];
  });
  h.user("current-user");
  h.assistant("answer", "current-user", finalInfo("answer", "current-user"));
  await h.reconcile();
  assert.equal(h.active.completed, false);
  assert.equal(h.events.filter(event => event.event === "question_request").length, 1);
});

test("pending question polling restores a missed request and deduplicates subsequent polls and SSE", async (t) => {
  const question = { id: "question-recovered", sessionID: SESSION, tool: { messageID: "missed-tool-header", callID: "tool-call" }, questions: [{ header: "渠道", question: "选择发布渠道", options: [{ label: "网站", description: "官方网站" }] }] };
  const h = harness(t, (url) => {
    if (url.pathname === "/session/status") return { [SESSION]: { type: "busy" } };
    if (url.pathname === "/question") return [question, { ...question, id: "other-session-question", sessionID: "other-session" }];
    return [];
  });
  await pollOneCycle(h);
  assert.ok(h.requests.some((url) => url.pathname === "/question"), "the status poll must actually query pending questions");
  assert.deepEqual(h.events.filter((event) => event.event === "question_request"), [{ event: "question_request", requestId: question.id, sessionId: SESSION, questions: question.questions, runId: RUN }]);
  await pollOneCycle(h);
  h.emit("question.asked", question);
  assert.equal(h.events.filter((event) => event.event === "question_request").length, 1);
  assert.equal(h.active.completed, false);
  assert.equal(h.textOutput(), "");
  assert.equal(h.active.pendingFrames.has("missed-tool-header"), false, "question control events do not wait for assistant headers");
});

test("selected skill is cached when the native user is observed, before a long command completes", { timeout: 3_000 }, async (t) => {
  const posted = deferred<void>();
  const response = deferred<Response>();
  const h = harness(t, (url, init) => {
    if (url.pathname === "/command") return [{ name: "writer-orchestrator", source: "skill" }];
    if (url.pathname.endsWith("/command") && init?.method === "POST") { posted.resolve(); return response.promise; }
    if (url.pathname === "/session/status") return { [SESSION]: { type: "busy" } };
    return [];
  });
  h.internal.active.clear();
  h.internal.ensureStarted = async () => undefined;
  h.internal.child = { exitCode: null };
  let promptFinished = false;
  const pending = h.client.prompt(SESSION, WORKSPACE, RUN, "写一段文案", {}, h.active.sink, undefined, undefined, undefined, "writer-orchestrator").finally(() => { promptFinished = true; });
  try {
    await Promise.race([posted.promise, pending.then(() => { throw new Error("prompt finished without submitting the native skill command"); })]);
    const active = h.internal.active.get(RUN)!;
    h.user("late-old-user", active.turnStartedAt - 1);
    assert.equal(h.internal.selectedSkills.has(SESSION), false);
    h.user("persisted-current-user", active.turnStartedAt);
    assert.equal(h.internal.selectedSkills.get(SESSION), "writer-orchestrator");
    assert.equal(promptFinished, false);
    assert.equal(active.completed, false);
    assert.equal(h.events.some((event) => event.event === "done"), false);
  } finally {
    const active = h.internal.active.get(RUN);
    if (active) h.internal.complete(active);
    response.resolve(new Response(null, { status: 204 }));
    await pending;
  }
});

test("idle polling discovers a submitted turn even when every busy and activity SSE event was missed", async (t) => {
  const h = harness(t, (url) => {
    if (url.pathname === "/session/status") return { [SESSION]: { type: "idle" } };
    if (url.pathname.endsWith("/message")) return [
      { info: userInfo("missed-user"), parts: [] },
      { info: finalInfo("missed-answer", "missed-user"), parts: [textPart("missed-answer", "全部通过最终快照恢复")] },
    ];
    return [];
  });
  h.active.busySeen = false;
  h.active.activitySeen = false;
  assert.equal(h.active.promptSubmitted, true);
  assert.equal(h.active.userMessageIds.size, 0);
  assert.equal(h.active.assistantMessageSeen, false);
  await pollOneCycle(h);
  assert.ok(h.requests.some((url) => url.pathname.endsWith("/message")), "prompt submission alone must permit an idle snapshot lookup");
  assert.equal(h.textOutput(), "全部通过最终快照恢复");
  assert.equal(h.active.completed, true);
  assert.deepEqual(h.timeline.slice(-2), ["全部通过最终快照恢复", "complete"]);
});

for (const kind of ["text", "reasoning"] as const) {
  test(`interrupted ${kind} freezes reconnect SSE and recovers the missing prefix from the final snapshot`, async (t) => {
    const partID = `interrupted-${kind}`;
    const h = harness(t, (url) => url.pathname.endsWith("/message") ? [
      { info: userInfo("current-user"), parts: [] },
      { info: finalInfo("answer", "current-user"), parts: [{ ...textPart("answer", "Hello world!", partID), type: kind }] },
    ] : []);
    const deltas = () => h.events.filter((event) => event.event === `${kind}_delta`).map((event) => "delta" in event ? event.delta : "");
    h.user("current-user");
    h.assistant("answer", "current-user");
    h.emit("message.part.delta", { sessionID: SESSION, messageID: "answer", partID, field: kind, delta: "Hello" });
    assert.deepEqual(deltas(), ["Hello"]);
    // " world" was lost during disconnection. Reconnected SSE is not an
    // authoritative replacement and must not turn the saved prefix into Hello!.
    h.active.streamInterrupted = true;
    h.emit("message.part.delta", { sessionID: SESSION, messageID: "answer", partID, field: kind, delta: "!" });
    h.emit("message.part.updated", { part: { ...textPart("answer", "Hello world!", partID), type: kind } });
    assert.deepEqual(deltas(), ["Hello"], "both reconnect deltas and SSE part snapshots must remain frozen");
    assert.equal(h.active.serveEvents.textByPartId.get(partID), "Hello", "frozen SSE must not corrupt the prefix used for reconciliation");
    assert.equal(h.active.completed, false);
    // Execute the real reconciliation path: only its handleEvent(frame, true)
    // calls may bypass streamInterrupted and append the authoritative suffix.
    await h.reconcile();
    assert.deepEqual(deltas(), ["Hello", " world!"]);
    assert.equal(deltas().join(""), "Hello world!");
    assert.equal(h.active.serveEvents.textByPartId.get(partID), "Hello world!");
    assert.equal(h.active.completed, true);
    assert.equal(h.timeline.at(-1), "complete");
  });
}

test("question controls remain answerable when their tool message is ignored and streaming is frozen", async (t) => {
  const question = { id: "question-ignored-tool", sessionID: SESSION, tool: { messageID: "ignored-tool-message", callID: "ignored-call" }, questions: [{ header: "确认", question: "是否继续？", options: [{ label: "继续", description: "执行下一步" }] }] };
  const replies: { path: string; body: unknown }[] = [];
  const h = harness(t, (url, init) => {
    if (url.pathname === "/question") return [question];
    if (init?.method === "POST") {
      replies.push({ path: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(null, { status: 204 });
    }
    return [];
  });
  h.active.ignoredMessageIds.add(question.tool.messageID);
  h.active.streamInterrupted = true;
  h.emit("question.asked", question);
  h.emit("question.asked", question);
  assert.deepEqual(h.events.filter((event) => event.event === "question_request"), [{ event: "question_request", requestId: question.id, sessionId: SESSION, runId: RUN, questions: question.questions }]);
  await h.client.replyQuestion(SESSION, question.id, [["继续"]], WORKSPACE);
  h.emit("question.replied", { sessionID: SESSION, requestID: question.id, tool: question.tool });
  assert.deepEqual(replies, [{ path: `/question/${question.id}/reply`, body: { answers: [["继续"]] } }]);
  assert.deepEqual(h.events.filter((event) => event.event === "question_response"), [{ event: "question_response", requestId: question.id, sessionId: SESSION, runId: RUN, rejected: false }]);
  assert.equal(h.active.pendingFrames.has(question.tool.messageID), false);
  assert.equal(h.active.ignoredMessageIds.has(question.tool.messageID), true);
  assert.equal(h.textOutput(), "");
  assert.equal(h.active.completed, false);
});

for (const failure of ["network error", "HTTP 503"] as const) {
  test(`remembered SSE idle still reconciles the final snapshot after status ${failure}`, async (t) => {
    const h = harness(t, (url) => {
      if (url.pathname === "/session/status") {
        if (failure === "network error") throw new Error("fixture status connection lost");
        return new Response("fixture status unavailable", { status: 503 });
      }
      if (url.pathname.endsWith("/message")) return [
        { info: userInfo("idle-user"), parts: [] },
        { info: finalInfo("idle-answer", "idle-user"), parts: [textPart("idle-answer", "状态端点失败仍补齐最终内容")] },
      ];
      return [];
    });
    h.active.busySeen = false;
    h.active.activitySeen = false;
    if (failure === "network error") h.emit("session.idle", { sessionID: SESSION });
    else h.emit("session.status", { sessionID: SESSION, status: { type: "idle" } });
    assert.equal(h.active.idleSeen, true, "retain the idle hint until the poller can reconcile");
    assert.equal(h.active.completed, false);
    await pollOneCycle(h);
    assert.ok(h.requests.some((url) => url.pathname === "/session/status"));
    assert.ok(h.requests.some((url) => url.pathname.endsWith("/message")), "status failure must not discard the remembered idle signal");
    assert.equal(h.textOutput(), "状态端点失败仍补齐最终内容");
    assert.equal(h.active.completed, true);
    assert.deepEqual(h.timeline.slice(-2), ["状态端点失败仍补齐最终内容", "complete"]);
  });
}
