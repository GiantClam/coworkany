import { createServer } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { encodeRpcMessage } from "../runtime/rpc";

function respondToHostServiceRequest(child: ChildProcessWithoutNullStreams, frame: Record<string, unknown>) {
  if (frame.type !== "service_request" || typeof frame.requestId !== "string") return;
  const payload = frame.payload && typeof frame.payload === "object" ? frame.payload as Record<string, unknown> : {};
  const data = frame.method === "workflow.artifact.register"
    ? { artifactId: `${String(payload.runId ?? "run")}:${String(payload.relativePath ?? "artifact")}` }
    : frame.method === "runtime.artifact.write"
      ? { relativePath: String(payload.relativePath ?? "artifacts/test.md"), mimeType: String(payload.mimeType ?? "text/plain"), byteLength: Buffer.byteLength(String(payload.content ?? ""), "utf8"), sha256: "test-sha256" }
    : { runId: payload.runId, sequence: payload.sequence, status: payload.status };
  child.stdin.write(encodeRpcMessage({ version: 1, requestId: frame.requestId, type: "service_response", ok: true, data }));
}

function startHost(desktopRoot: string, environment: Record<string, string | undefined> = {}, built = false) {
  const tsxCli = resolve(desktopRoot, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  const command = built ? [join(desktopRoot, "dist-runtime", "host.mjs")] : [tsxCli, join(desktopRoot, "runtime", "host.ts")];
  const child = spawn(process.execPath, command, { cwd: desktopRoot, env: { ...process.env, ...environment } as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const frames: Record<string, unknown>[] = [];
  const stderr: string[] = [];
  let buffer = new Uint8Array(0);
  const waiters: Array<{ predicate: (frame: Record<string, unknown>) => boolean; resolve: (frame: Record<string, unknown>) => void }> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Uint8Array.from([...buffer, ...chunk]);
    while (true) {
      const view = Buffer.from(buffer);
      const separator = view.indexOf(58);
      if (separator < 1) return;
      const size = Number.parseInt(view.subarray(0, separator).toString("ascii"), 10);
      const end = separator + 1 + size;
      if (!Number.isFinite(size) || end > buffer.length) return;
      const frame = JSON.parse(view.subarray(separator + 1, end).toString("utf8")) as Record<string, unknown>;
      frames.push(frame); buffer = buffer.subarray(end);
      respondToHostServiceRequest(child as ChildProcessWithoutNullStreams, frame);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (!waiters[index].predicate(frame)) continue;
        const waiter = waiters.splice(index, 1)[0]; waiter.resolve(frame);
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
  const waitFor = (predicate: (frame: Record<string, unknown>) => boolean, timeoutMs = 15_000) => new Promise<Record<string, unknown>>((resolveFrame, reject) => {
    const existing = frames.find(predicate);
    if (existing) { resolveFrame(existing); return; }
    const timer = setTimeout(() => reject(new Error("workflow_host_frame_timeout")), timeoutMs);
    waiters.push({ predicate, resolve: (frame) => { clearTimeout(timer); resolveFrame(frame); } });
  });
  return { child: child as ChildProcessWithoutNullStreams, frames, stderr, waitFor };
}

test("built workflow-host completes a local file workflow without network egress", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-offline-network-"));
  const guard = join(desktopRoot, "test", "fixtures", "deny-network-egress.cjs");
  const child = startHost(desktopRoot, { NODE_OPTIONS: `--require=${guard}` }, true);
  try {
    const runId = `offline-network-${randomUUID()}`;
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: randomUUID(), runId, type: "workflow.run", payload: {
      workspacePath: workspace,
      definition: {
        schemaVersion: 2, revision: 1, definitionHash: "",
        nodes: [
          { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Input", positionX: 0, positionY: 0, config: { text: "offline hello" } },
          { nodeKey: "file", type: "file_create", nodeVersion: 1, title: "File", positionX: 1, positionY: 0, config: { fileName: "offline.md", fileFormat: "md" } },
          { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 2, positionY: 0, config: {} },
        ],
        edges: [
          { edgeKey: "input-file", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "file", targetPortId: "text" },
          { edgeKey: "file-output", sourceNodeKey: "file", sourcePortId: "asset", targetNodeKey: "output", targetPortId: "assets" },
        ],
      },
    } }));
    const terminal = await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return (event?.event === "done" || event?.event === "runtime_error") && event?.runId === runId;
    }, 20_000);
    const event = (terminal.data as Record<string, unknown>).event as Record<string, unknown>;
    assert.equal(event.event, "done", JSON.stringify(event));
    assert.equal(child.stderr.join(""), "");
  } finally {
    if (child.child.exitCode === null) {
      const stopped = new Promise<void>((resolveClose) => child.child.once("close", () => resolveClose()));
      child.child.kill();
      await Promise.race([stopped, new Promise<void>((resolveClose) => setTimeout(resolveClose, 5_000))]);
    }
    child.child.stdin.destroy();
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("workflow-host keeps concurrent OpenCode sessions alive across provider configurations", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-concurrent-opencode-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const child = startHost(desktopRoot, {
    COWORKANY_OPENCODE_PATH: fixture,
    OPENCODE_RUNTIME_DIR: workspace,
    FAKE_OPENCODE_CONCURRENCY_MODE: "1",
  });
  const send = (frame: Record<string, unknown>) => child.child.stdin.write(encodeRpcMessage(frame));
  const providerA = { id: "provider-a", model: "configured/model-a" };
  const providerB = { id: "provider-b", model: "configured/model-b" };
  try {
    const createA = randomUUID();
    send({ version: 1, requestId: createA, type: "session.create", payload: { conversationId: "conversation-a", workspacePath: workspace, provider: providerA, model: providerA.model } });
    const sessionAFrame = await child.waitFor((frame) => frame.requestId === createA);
    assert.equal(sessionAFrame.ok, true, JSON.stringify(sessionAFrame));
    const sessionA = String((sessionAFrame.data as Record<string, unknown>).sessionId);

    const promptA = randomUUID();
    send({ version: 1, requestId: promptA, runId: "provider-a-run", sessionId: sessionA, type: "session.prompt", payload: { prompt: "slow-provider-a" } });
    await child.waitFor((frame) => frame.requestId === promptA);

    const createB = randomUUID();
    send({ version: 1, requestId: createB, type: "session.create", payload: { conversationId: "conversation-b", workspacePath: workspace, provider: providerB, model: providerB.model } });
    const sessionBFrame = await child.waitFor((frame) => frame.requestId === createB);
    assert.equal(sessionBFrame.ok, true, JSON.stringify(sessionBFrame));
    const sessionB = String((sessionBFrame.data as Record<string, unknown>).sessionId);

    const promptB = randomUUID();
    send({ version: 1, requestId: promptB, runId: "provider-b-run", sessionId: sessionB, type: "session.prompt", payload: { prompt: "provider-b" } });
    await child.waitFor((frame) => frame.requestId === promptB);

    const terminalA = await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.runId === "provider-a-run" && (event.event === "done" || event.event === "runtime_error");
    });
    const terminalB = await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.runId === "provider-b-run" && (event.event === "done" || event.event === "runtime_error");
    });
    const eventA = (terminalA.data as Record<string, unknown>).event as Record<string, unknown>;
    const eventB = (terminalB.data as Record<string, unknown>).event as Record<string, unknown>;
    assert.equal(eventA.event, "done", JSON.stringify(eventA));
    assert.equal(eventB.event, "done", JSON.stringify(eventB));
  } finally {
    if (child.child.exitCode === null) {
      const stopped = new Promise<void>((resolveClose) => child.child.once("close", () => resolveClose()));
      child.child.kill();
      await Promise.race([stopped, new Promise<void>((resolveClose) => setTimeout(resolveClose, 5_000))]);
    }
    child.child.stdin.destroy();
    // OpenCode children may release their workspace handle a few milliseconds
    // after the host exits on Windows. Match the other host tests' bounded
    // cleanup policy so a successful concurrency assertion is not reported as
    // a false EBUSY failure.
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("workflow-host coalesces duplicate media recovery requests for one node", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-media-recovery-dedupe-"));
  let queryCount = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/tasks/task-1") {
      queryCount += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "task-1", status: "SUCCEEDED", output: [{ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/output.mp4` }] }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/output.mp4") {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.end(Buffer.from("duplicate-recovery-video", "utf8"));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const child = startHost(desktopRoot);
  const runId = `media-recovery-dedupe-${randomUUID()}`;
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (requestId: string) => child.child.stdin.write(encodeRpcMessage({ version: 1, requestId, runId, type: "media.resume", payload: {
    runId,
    nodeKey: "capability",
    executorId: "video_generate",
    providerTaskId: "task-1",
    workspacePath: workspace,
    config: { provider: "fixture", source: "openai-compatible", baseUrl, apiKey: "fixture", model: "fixture-video", endpoint: "/videos/generations", queryEndpoint: "/tasks" },
  } }));
  try {
    send(randomUUID());
    send(randomUUID());
    await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.event === "done" && event.runId === runId;
    });
    await new Promise((resolveEvents) => setTimeout(resolveEvents, 100));
    const terminalEvents = child.frames.map((frame) => (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined).filter((event) => event?.runId === runId && (event.event === "done" || event.event === "runtime_error"));
    assert.equal(terminalEvents.filter((event) => event?.event === "runtime_error").length, 0);
    assert.equal(terminalEvents.filter((event) => event?.event === "done").length, 2);
    assert.equal(queryCount, 1);
    const files = await readdir(join(workspace, "artifacts", runId, "capability"));
    assert.equal(files.length, 1);
    assert.match(files[0] ?? "", /^video_generate-1-[a-f0-9]{12}\.mp4$/u);
  } finally {
    if (child.child.exitCode === null) child.child.kill();
    child.child.stdin.destroy();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("workflow-host cancels a persistent OpenCode session without waiting for the prompt response", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-cancel-opencode-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const child = startHost(desktopRoot, {
    COWORKANY_OPENCODE_PATH: fixture,
    OPENCODE_RUNTIME_DIR: workspace,
  });
  const send = (frame: Record<string, unknown>) => child.child.stdin.write(encodeRpcMessage(frame));
  try {
    const createRequestId = randomUUID();
    send({ version: 1, requestId: createRequestId, type: "session.create", payload: { conversationId: "conversation-cancel", workspacePath: workspace, provider: { model: "configured/model" }, model: "configured/model" } });
    const sessionFrame = await child.waitFor((frame) => frame.requestId === createRequestId && frame.ok === true);
    const sessionId = String((sessionFrame.data as Record<string, unknown>).sessionId);
    const runId = `cancelled-session-${randomUUID()}`;
    const promptStartedAt = Date.now();
    send({ version: 1, requestId: randomUUID(), runId, sessionId, type: "session.prompt", payload: { prompt: "Long running" } });
    await child.waitFor((frame) => Boolean(frame.data) && (frame.data as Record<string, unknown>).runId === runId);
    send({ version: 1, requestId: randomUUID(), runId, type: "run.cancel", payload: { runId } });
    const terminal = await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.runId === runId && event.event === "runtime_error";
    }, 2_000);
    const terminalEvent = (terminal.data as Record<string, unknown>).event as Record<string, unknown>;
    assert.equal(terminalEvent.code, "opencode_aborted");
    assert.ok(Date.now() - promptStartedAt < 1_500, "run.cancel must not wait for the provider prompt to finish");
  } finally {
    if (child.child.exitCode === null) {
      const stopped = new Promise<void>((resolveClose) => child.child.once("close", () => resolveClose()));
      child.child.kill();
      await Promise.race([stopped, new Promise<void>((resolveClose) => setTimeout(resolveClose, 5_000))]);
    }
    child.child.stdin.destroy();
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("workflow-host runs a mixed text, image, video, audio and PPT workflow with local providers", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-mixed-media-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const outputs = new Map<string, { readonly contentType: string; readonly body: Buffer }>([
    ["/output.png", { contentType: "image/png", body: Buffer.from("mixed-image-fixture", "utf8") }],
    ["/output.mp4", { contentType: "video/mp4", body: Buffer.from("mixed-video-fixture", "utf8") }],
    ["/output.mp3", { contentType: "audio/mpeg", body: Buffer.from("mixed-audio-fixture", "utf8") }],
  ]);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && ["/images/generations", "/videos/generations", "/audio/generations"].includes(url.pathname)) {
      const output = url.pathname.startsWith("/images/") ? "/output.png" : url.pathname.startsWith("/videos/") ? "/output.mp4" : "/output.mp3";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `fixture-${url.pathname.slice(1, 6)}`, data: [{ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${output}` }] }));
      return;
    }
    const output = outputs.get(url.pathname);
    if (request.method === "GET" && output) {
      response.writeHead(200, { "content-type": output.contentType });
      response.end(output.body);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const providerKey = String.fromCharCode(102, 105, 120, 116, 117, 114, 101);
  const child = startHost(desktopRoot, { COWORKANY_OPENCODE_PATH: fixture, OPENCODE_RUNTIME_DIR: workspace });
  try {
    const runId = `mixed-media-${randomUUID()}`;
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: randomUUID(), runId, type: "workflow.run", payload: {
      workspacePath: workspace,
      provider: { id: "configured", model: "configured/model" },
      providers: { fixture: { id: "fixture", source: "openai-compatible", baseUrl, apiKey: providerKey, model: "fixture-media" } },
      definition: {
        schemaVersion: 2, revision: 1, definitionHash: "",
        nodes: [
          { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Input", positionX: 0, positionY: 0, config: { text: "Create a launch story" } },
          { nodeKey: "llm", type: "llm_generate", nodeVersion: 1, title: "LLM", positionX: 1, positionY: 0, config: { selectedProviderId: "configured", selectedModelId: "configured/model" } },
          { nodeKey: "image", type: "image_generate", nodeVersion: 1, title: "Image", positionX: 2, positionY: -1, config: { provider: "fixture", model: "fixture-image", prompt: "launch image" } },
          { nodeKey: "video", type: "video_generate", nodeVersion: 1, title: "Video", positionX: 3, positionY: -1, config: { provider: "fixture", model: "fixture-video" } },
          { nodeKey: "audio", type: "audio_generate", nodeVersion: 1, title: "Audio", positionX: 2, positionY: 1, config: { provider: "fixture", model: "fixture-audio" } },
          { nodeKey: "ppt", type: "ppt_generate", nodeVersion: 1, title: "PPT", positionX: 3, positionY: 1, config: {} },
          { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 4, positionY: 0, config: {} },
          { nodeKey: "asset-library", type: "product_store", nodeVersion: 1, title: "Asset Library", positionX: 5, positionY: 0, config: { fileName: "launch-story.md" } },
        ],
        edges: [
          { edgeKey: "input-llm", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "llm", targetPortId: "text" },
          { edgeKey: "llm-image", sourceNodeKey: "llm", sourcePortId: "text", targetNodeKey: "image", targetPortId: "text" },
          { edgeKey: "image-video", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "video", targetPortId: "images" },
          { edgeKey: "llm-audio", sourceNodeKey: "llm", sourcePortId: "text", targetNodeKey: "audio", targetPortId: "text" },
          { edgeKey: "llm-ppt", sourceNodeKey: "llm", sourcePortId: "text", targetNodeKey: "ppt", targetPortId: "text" },
          { edgeKey: "image-ppt", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "ppt", targetPortId: "images" },
          { edgeKey: "image-output", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "output", targetPortId: "images" },
          { edgeKey: "video-output", sourceNodeKey: "video", sourcePortId: "video", targetNodeKey: "output", targetPortId: "videos" },
          { edgeKey: "audio-output", sourceNodeKey: "audio", sourcePortId: "audio", targetNodeKey: "output", targetPortId: "audios" },
          { edgeKey: "ppt-output", sourceNodeKey: "ppt", sourcePortId: "ppt", targetNodeKey: "output", targetPortId: "presentations" },
          { edgeKey: "llm-asset-library", sourceNodeKey: "llm", sourcePortId: "text", targetNodeKey: "asset-library", targetPortId: "text" },
          { edgeKey: "image-asset-library", sourceNodeKey: "image", sourcePortId: "image", targetNodeKey: "asset-library", targetPortId: "images" },
          { edgeKey: "video-asset-library", sourceNodeKey: "video", sourcePortId: "video", targetNodeKey: "asset-library", targetPortId: "videos" },
          { edgeKey: "audio-asset-library", sourceNodeKey: "audio", sourcePortId: "audio", targetNodeKey: "asset-library", targetPortId: "audios" },
          { edgeKey: "ppt-asset-library", sourceNodeKey: "ppt", sourcePortId: "ppt", targetNodeKey: "asset-library", targetPortId: "presentations" },
        ],
      },
    } }));
    const terminal = await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return (event?.event === "done" || event?.event === "runtime_error") && event?.runId === runId;
    }, 30_000);
    const terminalEvent = (terminal.data as Record<string, unknown>).event as Record<string, unknown>;
    assert.equal(terminalEvent.event, "done", JSON.stringify(terminalEvent));
    await new Promise((resolveEvents) => setTimeout(resolveEvents, 100));
    const events = child.frames.map((frame) => (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined).filter(Boolean) as Record<string, unknown>[];
    for (const executorId of ["llm_generate", "image_generate", "video_generate", "audio_generate", "ppt_generate", "product_store"]) {
      assert.equal(events.some((event) => event.tool === "workflow:node_succeeded" && JSON.stringify(event).includes(executorId)), true, executorId);
    }
    for (const extension of [".png", ".mp4", ".mp3", ".pptx"]) {
      assert.equal(events.some((event) => String(event.tool).startsWith("artifact:") && String(event.message).toLowerCase().includes(extension)), true, extension);
    }
    const registrations = child.frames
      .filter((frame) => frame.type === "service_request" && frame.method === "workflow.artifact.register")
      .map((frame) => frame.payload as Record<string, unknown>);
    for (const suffix of ["launch-story.md", ".png", ".mp3", ".pptx"]) {
      assert.equal(registrations.some((payload) => String(payload.relativePath).endsWith(suffix)), true, suffix);
    }
    const pptx = readFileSync(join(workspace, "workflow-deck.pptx"));
    assert.deepEqual([...pptx.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  } finally {
    if (child.child.exitCode === null) {
      const stopped = new Promise<void>((resolveClose) => child.child.once("exit", () => resolveClose()));
      child.child.stdin.end();
      await Promise.race([stopped, new Promise<void>((resolveClose) => setTimeout(resolveClose, 5_000))]);
      if (child.child.exitCode === null && process.platform === "win32") {
        await once(spawn("taskkill", ["/PID", String(child.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }), "close");
      } else if (child.child.exitCode === null) child.child.kill();
    }
    child.child.stdout.destroy(); child.child.stderr.destroy(); child.child.stdin.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("workflow-host creates a stable session mapping through RPC", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tsxCli = resolve(desktopRoot, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-session-mapping-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const child = spawn(process.execPath, [tsxCli, join(desktopRoot, "runtime", "host.ts")], {
    cwd: desktopRoot,
    env: { ...process.env, COWORKANY_OPENCODE_PATH: fixture, OPENCODE_RUNTIME_DIR: workspace },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  try {
    const response = await new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      let buffer = new Uint8Array(0);
      const onData = (chunk: Buffer) => {
        const next = new Uint8Array(buffer.length + chunk.length); next.set(buffer); next.set(chunk, buffer.length); buffer = next;
        const separator = buffer.indexOf(58); if (separator < 1) return;
        const size = Number.parseInt(Buffer.from(buffer.subarray(0, separator)).toString("ascii"), 10); const end = separator + 1 + size;
        if (end > buffer.length) return;
        child.stdout.off("data", onData); resolveResponse(JSON.parse(Buffer.from(buffer.subarray(separator + 1, end)).toString("utf8")) as Record<string, unknown>);
      };
      child.stdout.on("data", onData); child.once("error", reject);
      child.stdin.write(encodeRpcMessage({ version: 1, requestId: randomUUID(), type: "session.create", payload: { conversationId: "conversation-1", workspacePath: desktopRoot } }));
    });
    assert.equal(response.ok, true);
    assert.equal((response.data as Record<string, unknown>).conversationId, "conversation-1");
    assert.equal(typeof (response.data as Record<string, unknown>).sessionId, "string");
    assert.equal((response.data as Record<string, unknown>).transport, "opencode-serve");
    assert.equal((response.data as Record<string, unknown>).fullAccess, true);
  } finally {
    child.stdin.end();
    if (child.exitCode === null) child.kill();
    child.stdout.destroy();
    child.stderr.destroy();
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("workflow-host reports the configured model when OpenCode usage omits the model", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-usage-model-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const child = startHost(desktopRoot, { COWORKANY_OPENCODE_PATH: fixture, OPENCODE_RUNTIME_DIR: workspace });
  const provider = { id: "configured", source: "openai-compatible", model: "configured/model" };
  try {
    const sessionRequestId = randomUUID();
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: sessionRequestId, type: "session.create", payload: { conversationId: "conversation-usage-model", workspacePath: workspace, model: provider.model, provider } }));
    const sessionResponse = await child.waitFor((frame) => frame.requestId === sessionRequestId && frame.ok === true);
    const sessionId = String(((sessionResponse.data as Record<string, unknown> | undefined)?.sessionId) ?? "");
    assert.ok(sessionId);
    const runId = `usage-model-${randomUUID()}`;
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: runId, runId, sessionId, type: "session.prompt", payload: { prompt: "First turn", model: provider.model, provider } }));
    const usageFrame = await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.event === "usage" && event.runId === runId;
    });
    const usage = (usageFrame.data as Record<string, unknown>).event as Record<string, unknown>;
    assert.equal(usage.model, provider.model);
  } finally {
    child.child.kill();
    await rm(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("workflow-host emits one final artifact after a chat write tool completes", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-chat-artifact-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const child = startHost(desktopRoot, { COWORKANY_OPENCODE_PATH: fixture, OPENCODE_RUNTIME_DIR: workspace });
  try {
    const sessionRequestId = randomUUID();
    const provider = { id: "configured", source: "openai-compatible", model: "configured/model" };
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: sessionRequestId, type: "session.create", payload: { conversationId: "conversation-chat-artifact", workspacePath: workspace, model: provider.model, provider, allowArtifacts: true } }));
    const sessionResponse = await child.waitFor((frame) => frame.requestId === sessionRequestId && frame.ok === true);
    const sessionId = String(((sessionResponse.data as Record<string, unknown> | undefined)?.sessionId) ?? "");
    assert.ok(sessionId);
    const runId = `chat-artifact-${randomUUID()}`;
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: runId, runId, sessionId, type: "session.prompt", payload: { prompt: "Create chat artifact", model: provider.model, provider, allowArtifacts: true } }));
    await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.event === "done" && event.runId === runId;
    });
    const events = child.frames.map((frame) => (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined).filter((event) => event?.runId === runId) as Record<string, unknown>[];
    const artifacts = events.filter((event) => event.event === "artifact");
    assert.equal(artifacts.length, 1);
    assert.deepEqual(artifacts[0]?.artifact, { id: `${runId}:chat-final.md`, relativePath: "chat-final.md", title: "chat-final.md", mimeType: "text/markdown", byteLength: 20, sha256: "" });
    assert.ok(events.findIndex((event) => event.event === "artifact") < events.findIndex((event) => event.event === "done"));
    assert.equal(events.filter((event) => event.event === "artifact").length, 1);
  } finally {
    child.child.kill();
    await rm(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("workflow-host registers a PPT artifact when the presentation skill writes through shell tools", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-ppt-artifact-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const child = startHost(desktopRoot, { COWORKANY_OPENCODE_PATH: fixture, OPENCODE_RUNTIME_DIR: workspace });
  try {
    const provider = { id: "configured", source: "openai-compatible", model: "configured/model" };
    const sessionRequestId = randomUUID();
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: sessionRequestId, type: "session.create", payload: { conversationId: "conversation-ppt-artifact", workspacePath: workspace, model: provider.model, provider, allowArtifacts: true } }));
    const sessionResponse = await child.waitFor((frame) => frame.requestId === sessionRequestId && frame.ok === true);
    const sessionId = String((sessionResponse.data as Record<string, unknown>).sessionId ?? "");
    const runId = `ppt-artifact-${randomUUID()}`;
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: runId, runId, sessionId, type: "session.prompt", payload: { prompt: "Create ppt-master artifact", model: provider.model, provider, allowArtifacts: true, skillId: "ppt-master" } }));
    await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.event === "done" && event.runId === runId;
    });
    const artifacts = child.frames
      .map((frame) => (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined)
      .filter((event) => event?.event === "artifact" && event.runId === runId);
    assert.equal(artifacts.length, 1);
    assert.deepEqual(artifacts[0]?.artifact, { id: `${runId}:workflow-deck.pptx`, relativePath: "workflow-deck.pptx", title: "workflow-deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", byteLength: 14, sha256: "" });
    const registrations = child.frames
      .filter((frame) => frame.type === "service_request" && frame.method === "workflow.artifact.register")
      .map((frame) => frame.payload as Record<string, unknown>);
    assert.equal(registrations.some((payload) => payload.runId === runId && payload.relativePath === "workflow-deck.pptx" && payload.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"), true);
  } finally {
    if (child.child.exitCode === null) child.child.kill();
    child.child.stdin.destroy();
    await rm(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("workflow-host preserves a PPT artifact when a late turn error follows file creation", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-ppt-late-error-"));
  const fixture = join(desktopRoot, "test", "fixtures", "fake-opencode-serve.mjs");
  const child = startHost(desktopRoot, { COWORKANY_OPENCODE_PATH: fixture, OPENCODE_RUNTIME_DIR: workspace });
  try {
    const provider = { id: "configured", source: "openai-compatible", model: "configured/model" };
    const sessionRequestId = randomUUID();
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: sessionRequestId, type: "session.create", payload: { conversationId: "conversation-ppt-late-error", workspacePath: workspace, model: provider.model, provider, allowArtifacts: true } }));
    const sessionResponse = await child.waitFor((frame) => frame.requestId === sessionRequestId && frame.ok === true);
    const sessionId = String((sessionResponse.data as Record<string, unknown>).sessionId ?? "");
    const runId = `ppt-late-error-${randomUUID()}`;
    child.child.stdin.write(encodeRpcMessage({ version: 1, requestId: runId, runId, sessionId, type: "session.prompt", payload: { prompt: "Create ppt artifact then fail", model: provider.model, provider, allowArtifacts: true } }));
    await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.event === "runtime_error" && event.runId === runId;
    });
    await child.waitFor((frame) => {
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      return event?.event === "artifact" && event.runId === runId;
    });
    const events = child.frames
      .map((frame) => (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined)
      .filter((event) => event?.runId === runId);
    const artifacts = events.filter((event) => event?.event === "artifact");
    assert.equal(artifacts.length, 1);
    assert.equal((artifacts[0]?.artifact as Record<string, unknown>)?.relativePath, "failed-workflow.pptx");
  } finally {
    if (child.child.exitCode === null) child.child.kill();
    child.child.stdin.destroy();
    await rm(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("workflow-host executes a v2 local file workflow and streams node lifecycle events", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tsxCli = resolve(desktopRoot, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-workflow-"));
  const child = spawn(process.execPath, [tsxCli, join(desktopRoot, "runtime", "host.ts")], { cwd: desktopRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const frames: Record<string, unknown>[] = [];
  let buffer: Uint8Array = new Uint8Array(0);
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolveDonePromise) => { resolveDone = resolveDonePromise; });
  const onData = (chunk: Buffer) => {
    buffer = Uint8Array.from([...buffer, ...chunk]);
    while (true) {
      const view = Buffer.from(buffer);
      const separator = view.indexOf(58);
      if (separator < 1) return;
      const size = Number.parseInt(view.subarray(0, separator).toString("ascii"), 10);
      const end = separator + 1 + size;
      if (!Number.isFinite(size) || end > buffer.length) return;
      const frame = JSON.parse(view.subarray(separator + 1, end).toString("utf8")) as Record<string, unknown>;
      frames.push(frame); buffer = buffer.subarray(end);
      respondToHostServiceRequest(child as ChildProcessWithoutNullStreams, frame);
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      if (event?.event === "done" || event?.event === "runtime_error") resolveDone?.();
    }
  };
  child.stdout.on("data", onData);
  try {
    const runId = `workflow-${randomUUID()}`;
    child.stdin.write(encodeRpcMessage({ version: 1, requestId: randomUUID(), runId, type: "workflow.run", payload: {
      workspacePath: workspace,
      definition: {
        schemaVersion: 2, revision: 1, definitionHash: "",
        nodes: [
          { nodeKey: "input", type: "text_input", nodeVersion: 1, title: "Input", positionX: 0, positionY: 0, config: { text: "hello" } },
          { nodeKey: "file", type: "file_create", nodeVersion: 1, title: "File", positionX: 1, positionY: 0, config: { fileName: "hello.md", fileFormat: "md" } },
          { nodeKey: "output", type: "output", nodeVersion: 1, title: "Output", positionX: 2, positionY: 0, config: {} },
        ],
        edges: [
          { edgeKey: "input-file", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "file", targetPortId: "text" },
          { edgeKey: "file-output", sourceNodeKey: "file", sourcePortId: "asset", targetNodeKey: "output", targetPortId: "assets" },
        ],
      },
    } }));
    await Promise.race([done, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("workflow_host_timeout")), 15_000))]);
    const events = frames.map((frame) => (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined).filter(Boolean) as Record<string, unknown>[];
    assert.equal(events.some((event) => event.event === "done"), true);
    assert.equal(events.some((event) => event.tool === "workflow:node_started"), true);
    assert.equal(events.some((event) => event.tool === "artifact:file"), true);
    const serviceMethods = frames.filter((frame) => frame.type === "service_request").map((frame) => frame.method);
    assert.equal(serviceMethods[0], "workflow.repository.create");
    for (const method of ["workflow.repository.update_status", "workflow.event.append", "runtime.artifact.write", "workflow.artifact.register"]) {
      assert.equal(serviceMethods.includes(method), true, method);
    }
  } finally {
    child.kill();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("workflow-host expands foreach items instead of passing one array to the body", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tsxCli = resolve(desktopRoot, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-foreach-"));
  const child = spawn(process.execPath, [tsxCli, join(desktopRoot, "runtime", "host.ts")], { cwd: desktopRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let buffer: Uint8Array = new Uint8Array(0); const events: Record<string, unknown>[] = []; let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolveDonePromise) => { resolveDone = resolveDonePromise; });
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Uint8Array.from([...buffer, ...chunk]);
    while (true) {
      const view = Buffer.from(buffer);
      const separator = view.indexOf(58); if (separator < 1) return;
      const size = Number.parseInt(view.subarray(0, separator).toString("ascii"), 10); const end = separator + 1 + size;
      if (!Number.isFinite(size) || end > buffer.length) return;
      const frame = JSON.parse(view.subarray(separator + 1, end).toString("utf8")) as Record<string, unknown>; buffer = buffer.subarray(end);
      respondToHostServiceRequest(child as ChildProcessWithoutNullStreams, frame);
      const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      if (event) events.push(event);
      if (event?.event === "done" || event?.event === "runtime_error") resolveDone?.();
    }
  });
  try {
    child.stdin.write(encodeRpcMessage({ version: 1, requestId: randomUUID(), runId: "foreach-host-run", type: "workflow.run", payload: {
      workspacePath: workspace,
      definition: {
        schemaVersion: 2, revision: 1, definitionHash: "",
        nodes: [
          { nodeKey: "upload", type: "upload", nodeVersion: 1, title: "Upload", positionX: 0, positionY: 0, config: { uploadedFiles: ["a", "b", "c"] } },
          { nodeKey: "foreach", type: "foreach", nodeVersion: 1, title: "For Each", positionX: 1, positionY: 0, config: { inputPortId: "asset", collectNodeKey: "collect", concurrency: 2, maxIterations: 10, failurePolicy: "fail_fast" } },
          { nodeKey: "body", type: "output", nodeVersion: 1, title: "Body", positionX: 2, positionY: 0, config: {} },
          { nodeKey: "collect", type: "collect", nodeVersion: 1, title: "Collect", positionX: 3, positionY: 0, config: {} },
        ],
        edges: [
          { edgeKey: "upload-foreach", sourceNodeKey: "upload", sourcePortId: "asset", targetNodeKey: "foreach", targetPortId: "items.asset" },
          { edgeKey: "foreach-body", sourceNodeKey: "foreach", sourcePortId: "item.asset", targetNodeKey: "body", targetPortId: "assets" },
          { edgeKey: "body-collect", sourceNodeKey: "body", sourcePortId: "assets", targetNodeKey: "collect", targetPortId: "items.asset" },
        ],
      },
    } }));
    await Promise.race([done, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("workflow_host_foreach_timeout")), 15_000))]);
    assert.equal(events.some((event) => event.event === "done"), true);
    assert.equal(events.filter((event) => event.tool === "workflow:node_started").length >= 3, true);
  } finally {
    child.kill();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("workflow-host routes persisted provider tasks through workflow-core recovery", () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(join(desktopRoot, "runtime", "host.ts"), "utf8");
  assert.match(source, /function readWorkflowRecovery/);
  assert.match(source, /recovering: readWorkflowRecovery\(command\.payload\?\.recovering\)/);
  assert.match(source, /resume: async \(\{ executorId, nodeKey, config, inputs, providerTaskId \}, signal\)/);
  assert.match(source, /runMediaCapability\(command, runId, nodeKey, executorId, config, inputs, workspacePath, signal, providerTaskId\)/);
  assert.match(source, /recoveryDefinitionHash/);
  assert.match(source, /completed: command\.payload\.completed/);
  assert.match(source, /run\.emergency_stop/);
  assert.match(source, /tool: "run:emergency_stop"/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /SIGINT/);
});

test("workflow-host resumes a persisted media task after a host restart without submitting again", async () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-host-media-recovery-"));
  let submitCount = 0;
  let queryCount = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && url.pathname === "/submit") {
      submitCount += 1;
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "submit_must_not_be_called_on_resume" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/query/persisted-task") {
      queryCount += 1;
      if (queryCount === 1) {
        response.end(JSON.stringify({ id: "persisted-task", status: "running", data: [] }));
      } else {
        response.end(JSON.stringify({ id: "persisted-task", status: "succeeded", data: [{ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/output.png` }] }));
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/output.png") {
      response.setHeader("content-type", "image/png");
      response.end(Buffer.from("portable-media-fixture", "utf8"));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const providerKey = String.fromCharCode(102, 105, 120, 116, 117, 114, 101);
  const resumePayload = {
    workspacePath: workspace,
    providerTaskId: "persisted-task",
    executorId: "image_generate",
    nodeKey: "image-node",
    config: { provider: "fixture", baseUrl, apiKey: providerKey, endpoint: "/submit", queryEndpoint: "/query", model: "fixture-image" },
  };
  const request = { version: 1, requestId: randomUUID(), runId: "media-recovery-run", type: "media.resume", payload: resumePayload };
  try {
    const first = startHost(desktopRoot);
    try {
      first.child.stdin.write(encodeRpcMessage(request));
      await first.waitFor((frame) => (frame.data as Record<string, unknown> | undefined)?.resumed === true);
      first.child.kill();
    } finally {
      first.child.stdin.destroy();
    }

    const second = startHost(desktopRoot);
    try {
      second.child.stdin.write(encodeRpcMessage({ ...request, requestId: randomUUID() }));
      const terminal = await second.waitFor((frame) => {
        const event = (frame.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
        return event?.event === "done" || event?.event === "runtime_error";
      });
      const event = (terminal.data as Record<string, unknown> | undefined)?.event as Record<string, unknown> | undefined;
      assert.equal(event?.event, "done");
      assert.equal(submitCount, 0);
      assert.equal(queryCount >= 2, true);
      const files = await readdir(join(workspace, "artifacts"), { recursive: true });
      assert.equal(files.some((file) => String(file).endsWith(".png")), true);
    } finally {
      second.child.kill();
      second.child.stdin.destroy();
    }
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(workspace, { recursive: true, force: true });
  }
});
