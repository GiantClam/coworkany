import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { OpenCodeServeClient } from "../runtime/opencode-serve";

test("desktop OpenCode uses the asynchronous serve-session contract", () => {
  const source = readFileSync(resolve(process.cwd(), "runtime/opencode-serve.ts"), "utf8");
  const hostSource = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  assert.match(source, /createOpenCodeServeSessionPayload/);
  assert.match(source, /createOpenCodeServePromptPayload/);
  assert.match(source, /useCommand \? "command" : "prompt_async"/);
  assert.match(source, /normalizeOpenCodeServeEvent\("pending", payload/);
  assert.match(source, /DEFAULT_STALLED_RUN_TIMEOUT_MS = 300_000/);
  assert.match(source, /promptStallTimeoutMs\?: number/);
  assert.match(source, /promptTimeoutMs\?: number/);
  assert.match(source, /typeof timeoutMs === "number"/);
  assert.match(source, /this\.promptTimeoutMs \?\? false/u);
  assert.match(source, /opencode_prompt_stalled/u);
  assert.match(source, /runtimeEnvironmentSignature/);
  assert.match(source, /sessionCreateQueue/);
  assert.match(source, /opencode_prompt_timeout/);
  assert.match(source, /taskkill/);
  assert.match(source, /windowsHide: true/);
  assert.equal(hostSource.includes("process.pid}.${randomUUID()}.tmp"), true);
  assert.doesNotMatch(source, /failActiveRuns|requestContinuation/u);
  assert.match(source, /"serve", "--pure", "--hostname", "127\.0\.0\.1"/u);
  assert.doesNotMatch(source, /"serve", "--pure", "--auto"/u);
  assert.match(source, /OPENCODE_DISABLE_PROJECT_CONFIG: "1"/u);
  assert.match(source, /OPENCODE_DISABLE_EXTERNAL_SKILLS: "1"/u);
  assert.match(source, /OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1"/u);
  assert.match(source, /OPENCODE_DISABLE_DEFAULT_PLUGINS: "1"/u);
  assert.match(hostSource, /OPENCODE_CONFIG_CONTENT: configContent/u);
  assert.match(hostSource, /node_modules.*opencode-ai.*bin.*opencode\.exe/u);
  assert.match(hostSource, /ProgramFiles/u);
  assert.match(hostSource, /USERPROFILE: isolatedHome/u);
  assert.match(hostSource, /XDG_CONFIG_HOME: isolatedConfigHome/u);
  assert.match(hostSource, /COWORKANY_DESKTOP_LOCAL: "1"/u);
  assert.match(hostSource, /"\*": "allow", question: "allow"/u);
  assert.match(hostSource, /provider\?\.timeout/u);
  assert.match(hostSource, /provider\?\.chunkTimeout/u);
  assert.match(hostSource, /record\.timeout === false/u);
  assert.doesNotMatch(hostSource, /runDirectSessionPrompt/u);
  assert.doesNotMatch(hostSource, /if \(isDeepSeekV4Flash\([\s\S]{0,220}runDirectSessionPrompt/u);
  assert.match(hostSource, /skills: \{ paths: \[join\(configDirectory, "skills"\)\] \}/u);
  assert.match(hostSource, /await deploy\(source, "skills"\)/u);
  assert.match(hostSource, /\.catalog-deployment/u);
  assert.doesNotMatch(hostSource, /preparedAgentWorkspaces/u);
  assert.doesNotMatch(hostSource, /service_request_timeout/u);
  assert.match(hostSource, /OpenCode caches the Agent catalog/u);
  assert.match(hostSource, /await deploy\(agentsSource, "agents"\)/u);
  assert.match(hostSource, /\(\?:tools\|services\)/u);
  assert.match(hostSource, /#6b7280/u);
  assert.match(hostSource, /preparedAgentName/u);
  assert.doesNotMatch(hostSource, /name:\s*\$\{agentId\}/u);
  assert.doesNotMatch(source, /"--mdns"/u);
  assert.doesNotMatch(source, /"--cors"/u);
  assert.match(source, /sessionStatus === "busy"/u);
  assert.match(source, /if \(idle\) await this\.reconcileCompletedMessage/u);
  assert.doesNotMatch(hostSource, /Desktop workspace boundary/u);
});

test("OpenCode Serve turns a hanging provider request into a retryable runtime error", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-timeout-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture], 80);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_PROMPT_HANG: "1" });
    await client.prompt(session.sessionId, runtimeDirectory, "timeout-run", "This request will hang", { model: "configured/model" }, (event) => events.push(event));
    const timeout = events.find((event) => event.event === "runtime_error");
    assert.equal(timeout?.code, "opencode_prompt_timeout");
    assert.match(String(timeout?.message), /timed out/iu);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve completes a turn when prompt submission disconnects after streamed activity", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-disconnect-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_PROMPT_DISCONNECT: "1" });
    await client.prompt(session.sessionId, runtimeDirectory, "disconnect-run", "Prompt request disconnects", { model: "configured/model" }, event => events.push(event));
    assert.equal(events.some(event => event.event === "runtime_error"), false);
    assert.equal(events.some(event => event.event === "text_delta" && event.delta === "Recovered after prompt disconnect"), true);
    assert.equal(events.some(event => event.event === "done"), true);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve turns a tool that never returns into a retryable stalled-run error", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-stall-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture], undefined, 80);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_STALLED_TOOL: "1" });
    await client.prompt(session.sessionId, runtimeDirectory, "stalled-run", "This tool will never return", { model: "configured/model" }, (event) => events.push(event));
    const stalled = events.find((event) => event.event === "runtime_error");
    assert.equal(stalled?.code, "opencode_prompt_stalled");
    assert.match(String(stalled?.message), /no progress/iu);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve keeps a run alive while the preview server tool is long-lived", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-preview-stall-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture], undefined, 50);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_PREVIEW_TOOL: "1" });
    await client.prompt(session.sessionId, runtimeDirectory, "preview-run", "Start the preview server", { model: "configured/model" }, event => events.push(event));
    assert.equal(events.some(event => event.event === "runtime_error" && event.code === "opencode_prompt_stalled"), false);
    assert.equal(events.some(event => event.event === "text_delta" && event.delta === "Preview server started"), true);
    assert.equal(events.some(event => event.event === "done"), true);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve serializes concurrent session creation behind startup health", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-startup-race-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  try {
    const environment = { FAKE_OPENCODE_HEALTH_DELAY_MS: "200" };
    const sessions = await Promise.all([
      client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, environment),
      client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, environment),
    ]);
    assert.deepEqual(sessions.map(session => session.sessionId), ["recovered-session", "recovered-session"]);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve recreates a lost persisted session and preserves streamed evidence", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-serve-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  const abortLog = resolve(runtimeDirectory, "abort.log");
  try {
    assert.deepEqual(await client.createOrResumeSession(runtimeDirectory, "retained-session", { model: "configured/model" }, { FAKE_OPENCODE_ABORT_LOG: abortLog }), { sessionId: "retained-session", recovered: false });
    const session = await client.createOrResumeSession(runtimeDirectory, "lost-session", { model: "configured/model" }, { FAKE_OPENCODE_ABORT_LOG: abortLog });
    assert.deepEqual(session, { sessionId: "recovered-session", recovered: true });
    const sessionId = session.sessionId;
    await client.prompt(sessionId, runtimeDirectory, "recovered-run", "Continue safely", { model: "configured/model" }, (event) => events.push(event));
    await new Promise<void>((resolveWait, reject) => {
      const deadline = Date.now() + 2_000;
      const timer = setInterval(() => {
        if (events.some((event) => event.event === "usage")) { clearInterval(timer); resolveWait(); }
        else if (Date.now() >= deadline) { clearInterval(timer); reject(new Error("fake_opencode_stream_timeout")); }
      }, 10);
    });
    assert.deepEqual(events.filter((event) => event.event === "text_delta").map((event) => event.delta), ["Recovered answer"]);
    assert.equal(events.some((event) => event.event === "tool_event" && event.tool === "write"), true);
    assert.equal(events.some((event) => event.event === "usage" && event.inputTokens === 11 && event.outputTokens === 7), true);
    assert.equal(events.some((event) => event.event === "done"), true);
    await client.abort(sessionId);
    assert.equal(await readFile(abortLog, "utf8"), "aborted");
    const failureEvents: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(sessionId, runtimeDirectory, "failed-run", "Trigger error", { model: "configured/model" }, (event) => failureEvents.push(event));
    assert.deepEqual(failureEvents.filter((event) => event.event === "runtime_error").map((event) => event.code), ["opencode_error"]);
    assert.equal(failureEvents.some((event) => event.event === "done"), false);
    const crashEvents: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(sessionId, runtimeDirectory, "crashed-run", "Trigger crash", { model: "configured/model" }, (event) => crashEvents.push(event));
    assert.deepEqual(crashEvents.filter((event) => event.event === "runtime_error").map((event) => event.code), ["opencode_serve_exited"]);
    assert.deepEqual(await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_ABORT_LOG: abortLog }), { sessionId: "recovered-session", recovered: false });
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve attaches only to an existing persisted session", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-attach-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  try {
    const provider = { model: "configured/model" };
    assert.deepEqual(await client.attachSession(runtimeDirectory, "retained-session", provider, {}), { sessionId: "retained-session" });
    assert.equal(await client.attachSession(runtimeDirectory, "lost-session", provider, {}), undefined);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve never replaces a persisted session after a transient lookup failure", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-lookup-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  try {
    await assert.rejects(
      client.createOrResumeSession(runtimeDirectory, "lookup-error-session", { model: "configured/model" }, {}),
      /opencode_session_lookup_failed:503/u,
    );
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve parses CRLF-delimited SSE frames", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-serve-crlf-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_CRLF: "1" });
    await client.prompt(session.sessionId, runtimeDirectory, "crlf-run", "First turn", { model: "configured/model" }, (event) => events.push(event));
    assert.equal(events.some((event) => event.event === "text_delta" && event.delta === "First answer"), true);
    assert.equal(events.some((event) => event.event === "usage"), true);
    assert.equal(events.some((event) => event.event === "done"), true);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode alone continues tool calls while busy; desktop submits exactly once", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-continuation-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  try {
    const log = resolve(runtimeDirectory, "requests.jsonl");
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_MULTI_CONTINUATION: "1", FAKE_OPENCODE_REQUEST_LOG: log });
    await client.prompt(session.sessionId, runtimeDirectory, "multi-continuation-run", "Multi-turn tool task", { model: "configured/model" }, (event) => events.push(event));
    assert.deepEqual(events.filter((event) => event.event === "text_delta").map((event) => event.delta), ["Tool turn 1 completed", "\n\n", "Tool turn 2 completed", "\n\n", "Multi-turn task completed"]);
    assert.equal(events.some((event) => event.event === "text_delta" && event.delta === "Multi-turn task completed"), true);
    assert.equal(events.some((event) => event.event === "done"), true);
    assert.equal(events.filter((event) => event.event === "usage").length, 3);
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("late assistant from another user cannot enter or finish the active turn", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "coworkany-native-parent-"));
  const client = new OpenCodeServeClient(process.execPath, directory, [resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs")]);
  const events: Array<{ event: string; [key: string]: unknown }> = [];
  try {
    const session = await client.createOrResumeSession(directory, undefined, { model: "configured/model" }, {});
    await client.prompt(session.sessionId, directory, "parent-run", "Ignore previous turn", { model: "configured/model" }, (event) => events.push(event));
    assert.equal(events.filter(e => e.event === "text_delta").map(e => e.delta).join(""), "Recovered answer");
    assert.equal(events.filter(e => e.event === "done").length, 1);
  } finally { await client.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("native questions pause and resume the same turn, including rejection and ownership checks", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "coworkany-native-question-"));
  const log = resolve(directory, "requests.jsonl");
  const client = new OpenCodeServeClient(process.execPath, directory, [resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs")]);
  try {
    const session = await client.createOrResumeSession(directory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_REQUEST_LOG: log });
    for (const rejected of [false, true]) {
      const events: Array<{ event: string; [key: string]: unknown }> = [];
      let onQuestion!: () => void;
      const asked = new Promise<void>(resolve => { onQuestion = resolve; });
      const running = client.prompt(session.sessionId, directory, `question-${rejected}`, "Ask a question", { model: "configured/model" }, event => { events.push(event); if (event.event === "question_request") onQuestion(); });
      await asked;
      assert.equal(events.some(event => event.event === "done"), false);
      assert.equal((await client.listQuestions(session.sessionId, directory))[0]?.id, "question-1");
      await assert.rejects(client.replyQuestion("another-session", "question-1", [["A"]], directory), /question_not_found/);
      await client.replyQuestion(session.sessionId, "question-1", rejected ? undefined : [["A"]], directory);
      await running;
      assert.equal(events.some(event => event.event === "question_response" && event.rejected === rejected), true);
      assert.equal(events.filter(event => event.event === "text_delta").map(event => event.delta).join(""), "Answer received");
      assert.equal(events.filter(event => event.event === "done").length, 1);
    }
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 2);
  } finally { await client.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("native question confirmation is not treated as a stalled run", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "coworkany-native-question-stall-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, directory, [fixture], undefined, 80);
  try {
    const session = await client.createOrResumeSession(directory, undefined, { model: "configured/model" }, {});
    const events: Array<{ event: string; [key: string]: unknown }> = [];
    let onQuestion!: () => void;
    const asked = new Promise<void>(resolveAsked => { onQuestion = resolveAsked; });
    const running = client.prompt(session.sessionId, directory, "question-stall", "Ask a question", { model: "configured/model" }, event => {
      events.push(event);
      if (event.event === "question_request") onQuestion();
    });
    await asked;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 160));
    assert.equal(events.some(event => event.code === "opencode_prompt_stalled"), false);
    assert.equal(events.some(event => event.event === "done"), false);
    await client.replyQuestion(session.sessionId, "question-1", [["A"]], directory);
    await running;
    assert.equal(events.filter(event => event.event === "done").length, 1);
  } finally {
    await client.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("OpenCode Serve forwards the selected packaged Agency Agent", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-agent-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const agentLog = resolve(runtimeDirectory, "agent.log");
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_AGENT_LOG: agentLog, COWORKANY_OPENCODE_AGENT_ID: "agency-engineering-code-reviewer" });
    await client.prompt(session.sessionId, runtimeDirectory, "agent-run", "Review this change", { model: "configured/model" }, () => undefined, undefined, "agency-engineering-code-reviewer");
    assert.equal(await readFile(agentLog, "utf8"), "agency-engineering-code-reviewer");
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("selected Skill uses the native command once; follow-up preserves user text without system overrides", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-system-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const systemLog = resolve(runtimeDirectory, "requests.jsonl");
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, { model: "configured/model" }, { FAKE_OPENCODE_REQUEST_LOG: systemLog });
    await client.prompt(session.sessionId, runtimeDirectory, "system-run", "用户原始消息\n第二行", { model: "configured/model" }, () => undefined, undefined, undefined, undefined, "ppt-master");
    await client.prompt(session.sessionId, runtimeDirectory, "follow-up", "继续\n保留格式", { model: "configured/model" }, () => undefined, undefined, undefined, undefined, "ppt-master");
    const requests = (await readFile(systemLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].path, "/session/recovered-session/command");
    assert.equal(requests[0].payload.command, "ppt-master");
    assert.equal(requests[0].payload.arguments, "用户原始消息\n第二行");
    assert.equal(requests[1].path, "/session/recovered-session/prompt_async");
    assert.equal(requests[1].payload.parts[0].text, "继续\n保留格式");
    assert.equal(requests.every(request => request.payload.system === undefined), true);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

for (const skillId of [undefined, "ppt-master"]) {
  test(`native ${skillId ? "command" : "prompt_async"} owns its user message when the server clock is behind`, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-clock-"));
    const log = resolve(directory, "requests.jsonl");
    const client = new OpenCodeServeClient(process.execPath, directory, [resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs")]);
    const events: Array<{ event: string; [key: string]: unknown }> = [];
    try {
      const session = await client.createOrResumeSession(directory, undefined, { model: "configured/model" }, {
        FAKE_OPENCODE_USER_CLOCK_OFFSET_MS: "-1000", FAKE_OPENCODE_REQUEST_LOG: log,
      });
      await client.prompt(session.sessionId, directory, "clock-run", "Ignore previous turn", { model: "configured/model" }, event => events.push(event), AbortSignal.timeout(5_000), "agency-engineering-code-reviewer", undefined, skillId);
      assert.deepEqual(events.filter(event => event.event === "runtime_error"), []);
      assert.equal(events.filter(event => event.event === "text_delta").map(event => event.delta).join(""), "Recovered answer");
      assert.equal(events.filter(event => event.event === "done").length, 1);
      const requests = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].path, `/session/recovered-session/${skillId ? "command" : "prompt_async"}`);
      assert.match(requests[0].payload.messageID, /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/u);
      assert.equal(requests[0].payload.agent, "agency-engineering-code-reviewer");
      assert.equal(requests[0].payload.system, undefined);
    } finally {
      await client.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("fake OpenCode E2E covers first chat, multi-turn, tool/artifact, cancel, crash and usage", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-e2e-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const abortLog = resolve(runtimeDirectory, "e2e-abort.log");
  const provider = { model: "configured/model" };
  try {
    const session = await client.createOrResumeSession(runtimeDirectory, undefined, provider, { FAKE_OPENCODE_ABORT_LOG: abortLog });
    assert.equal(session.recovered, false);

    const firstEvents: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(session.sessionId, runtimeDirectory, "first-run", "First turn", provider, (event) => firstEvents.push(event));
    assert.equal(firstEvents.some((event) => event.event === "text_delta" && event.delta === "First answer"), true);
    assert.equal(firstEvents.some((event) => event.event === "usage" && event.inputTokens === 11 && event.outputTokens === 7), true);
    assert.equal(firstEvents.some((event) => event.event === "done"), true);

    const secondEvents: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(session.sessionId, runtimeDirectory, "second-run", "Second turn", provider, (event) => secondEvents.push(event));
    assert.equal(secondEvents.some((event) => event.event === "text_delta" && event.delta === "Second answer"), true);

    const camelCaseEvents: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(session.sessionId, runtimeDirectory, "camel-case-run", "Camel case stream", provider, (event) => camelCaseEvents.push(event));
    assert.equal(camelCaseEvents.some((event) => event.event === "text_delta" && event.delta === "Recovered answer"), true);

    const artifactEvents: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(session.sessionId, runtimeDirectory, "artifact-run", "Create artifact", provider, (event) => artifactEvents.push(event));
    assert.equal(artifactEvents.some((event) => event.event === "tool_event" && event.tool === "artifact:result"), true);

    const controller = new AbortController();
    const cancelEvents: Array<{ event: string; [key: string]: unknown }> = [];
    const cancelStartedAt = Date.now();
    const cancelPromise = client.prompt(session.sessionId, runtimeDirectory, "cancel-run", "Long running", provider, (event) => cancelEvents.push(event), controller.signal);
    setTimeout(() => controller.abort(), 100);
    await cancelPromise;
    assert.ok(Date.now() - cancelStartedAt < 1_000, "cancellation must not wait for the provider prompt to finish");
    assert.equal(cancelEvents.some((event) => event.event === "runtime_error" && event.code === "opencode_aborted"), true);
    assert.equal(await readFile(abortLog, "utf8"), "aborted");

    const crashEvents: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(session.sessionId, runtimeDirectory, "crash-run", "Trigger crash", provider, (event) => crashEvents.push(event));
    assert.deepEqual(crashEvents.filter((event) => event.event === "runtime_error").map((event) => event.code), ["opencode_serve_exited"]);
    assert.equal((await client.createOrResumeSession(runtimeDirectory, undefined, provider, { FAKE_OPENCODE_ABORT_LOG: abortLog })).sessionId, "recovered-session");
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve reloads the selected model when a persistent conversation switches models", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-model-switch-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const modelLog = resolve(runtimeDirectory, "model-switch.log");
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const firstProvider = { model: "configured/model-a" };
  const secondProvider = { model: "configured/model-b" };
  try {
    const first = await client.createOrResumeSession(runtimeDirectory, undefined, firstProvider, { OPENCODE_CONFIG_CONTENT: "model-a", FAKE_OPENCODE_CONFIG_MODEL: "model-a", FAKE_OPENCODE_CONFIG_MODEL_LOG: modelLog });
    await client.prompt(first.sessionId, runtimeDirectory, "model-a-run", "First turn", firstProvider, () => undefined);
    const second = await client.createOrResumeSession(runtimeDirectory, first.sessionId, secondProvider, { OPENCODE_CONFIG_CONTENT: "model-b", FAKE_OPENCODE_CONFIG_MODEL: "model-b", FAKE_OPENCODE_CONFIG_MODEL_LOG: modelLog });
    await client.prompt(second.sessionId, runtimeDirectory, "model-b-run", "Second turn", secondProvider, () => undefined);
    assert.deepEqual((await readFile(modelLog, "utf8")).trim().split(/\r?\n/u), ["model-a:model-a", "model-b:model-b"]);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("OpenCode Serve reuses one process across Agent sessions and routes same-session concurrent prompts", async () => {
  const runtimeDirectory = await mkdtemp(resolve(tmpdir(), "coworkany-opencode-concurrency-"));
  const fixture = resolve(process.cwd(), "test/fixtures/fake-opencode-serve.mjs");
  const activityLog = resolve(runtimeDirectory, "activity.log");
  const environment = { FAKE_OPENCODE_CONCURRENCY_MODE: "1", FAKE_OPENCODE_ACTIVITY_LOG: activityLog };
  const client = new OpenCodeServeClient(process.execPath, runtimeDirectory, [fixture]);
  const provider = { model: "configured/model" };
  const waitForActivity = async (value: string) => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if ((await readFile(activityLog, "utf8").catch(() => "")).includes(value)) return;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`fake_opencode_activity_timeout:${value}`);
  };
  const run = async (sessionId: string, runId: string, prompt: string, agent?: string) => {
    const events: Array<{ event: string; [key: string]: unknown }> = [];
    await client.prompt(sessionId, runtimeDirectory, runId, prompt, provider, (event) => events.push(event), undefined, agent);
    return events;
  };
  try {
    const chatSession = await client.createOrResumeSession(runtimeDirectory, undefined, provider, environment);
    const sameSessionResults = await Promise.all([
      run(chatSession.sessionId, "same-session-a", "same-session-a"),
      run(chatSession.sessionId, "same-session-b", "same-session-b"),
    ]);
    assert.equal(sameSessionResults[0].some(event => event.event === "text_delta" && String(event.delta).includes("same-session-a")), true);
    assert.equal(sameSessionResults[1].some(event => event.event === "runtime_error" && event.code === "opencode_session_busy"), true);
    assert.equal(sameSessionResults[1].some(event => event.event === "text_delta"), false);

    const slowChat = run(chatSession.sessionId, "slow-chat", "slow-chat");
    await waitForActivity(":slow-chat");
    const agentEnvironment = { ...environment, COWORKANY_OPENCODE_AGENT_ID: "agency-engineering-code-reviewer" };
    const agentSession = await client.createOrResumeSession(runtimeDirectory, undefined, provider, agentEnvironment);
    const agentRun = run(agentSession.sessionId, "agent-chat", "agent-chat", "agency-engineering-code-reviewer");
    const [chatEvents, agentEvents] = await Promise.all([slowChat, agentRun]);
    assert.equal(chatEvents.some((event) => event.event === "text_delta" && String(event.delta).includes("slow-chat")), true);
    assert.equal(agentEvents.some((event) => event.event === "text_delta" && String(event.delta).includes("agent-chat")), true);
    assert.equal([...chatEvents, ...agentEvents].some((event) => event.event === "runtime_error"), false);
    const activity = await readFile(activityLog, "utf8");
    assert.equal(new Set(activity.split(/\r?\n/u).filter(Boolean).map((line) => line.split(":", 1)[0])).size, 1, activity);
  } finally {
    await client.stop();
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});
