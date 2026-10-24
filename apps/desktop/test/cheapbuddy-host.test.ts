import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { encodeRpcMessage } from "../runtime/rpc";
import { createCheapBuddyProvider } from "../src/cheapbuddy";
import { SIGNED_OUT_CHEAPBUDDY_STATE } from "../src/cheapbuddy-contract";

type Frame = Record<string, unknown>;
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storeMarker = "[cheapbuddy-host-test] credential-command-blocked";

/** Real source Host/RPC, with both network egress and native credential reads denied. */
async function startIsolatedHost() {
  const root = await mkdtemp(join(tmpdir(), "coworkany-cheapbuddy-host-"));
  const nativeGuard = join(root, "deny-credential-access.cjs");
  await writeFile(nativeGuard, `
const childProcess = require("node:child_process");
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (command, ...args) {
  if (/(?:^|[\\\\/])(?:security|secret-tool|powershell(?:\\.exe)?)$/i.test(String(command))) {
    process.stderr.write(${JSON.stringify(`${storeMarker}\n`)});
    throw new Error("fixture_credential_access_denied");
  }
  return originalSpawn.call(this, command, ...args);
};
require("node:module").syncBuiltinESMExports();
`, "utf8");
  const networkGuard = join(desktopRoot, "test", "fixtures", "deny-network-egress.cjs");
  // Load the actual source directly; no staged Host bundle or account mock.
  const child = spawn(process.execPath, ["--import", "tsx", join(desktopRoot, "runtime", "host.ts")], {
    cwd: desktopRoot,
    env: { ...process.env, OPENCODE_RUNTIME_DIR: root, NODE_OPTIONS: `--require=${JSON.stringify(networkGuard)} --require=${JSON.stringify(nativeGuard)}` },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const frames: Frame[] = [];
  const stderr: string[] = [];
  let buffer = new Uint8Array(0);
  let failure: Error | undefined;
  type Waiter = { predicate: (frame: Frame) => boolean; resolve: (frame: Frame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  const waiters = new Set<Waiter>();
  const rejectAll = (error: Error) => {
    failure = error;
    for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    waiters.clear();
  };
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
  child.on("error", rejectAll);
  child.on("close", (code) => rejectAll(new Error(`cheapbuddy_source_host_closed:${code}:${stderr.join("").slice(-1000)}`)));
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Uint8Array.from([...buffer, ...chunk]);
    try {
      while (buffer.length) {
        while (buffer[0] === 10 || buffer[0] === 13) buffer = buffer.subarray(1);
        const view = Buffer.from(buffer);
        const separator = view.indexOf(58);
        if (separator < 1) return;
        const size = Number(view.subarray(0, separator).toString("ascii"));
        if (!Number.isSafeInteger(size) || size < 2 || size > 8 * 1024 * 1024) throw new Error("cheapbuddy_source_host_frame_invalid");
        const end = separator + 1 + size;
        if (end > buffer.length) return;
        const frame = JSON.parse(view.subarray(separator + 1, end).toString("utf8")) as Frame;
        buffer = buffer.subarray(end);
        frames.push(frame);
        if (frame.type === "service_request" && typeof frame.requestId === "string") {
          const payload = frame.payload && typeof frame.payload === "object" ? frame.payload as Frame : {};
          const data = frame.method === "workflow.artifact.register"
            ? { artifactId: `${payload.runId}:${payload.relativePath}` }
            : { runId: payload.runId, sequence: payload.sequence, status: payload.status };
          child.stdin.write(encodeRpcMessage({ version: 1, requestId: frame.requestId, type: "service_response", ok: true, data }));
        }
        for (const waiter of waiters) {
          if (!waiter.predicate(frame)) continue;
          waiters.delete(waiter); clearTimeout(waiter.timer); waiter.resolve(frame);
        }
      }
    } catch (error) { rejectAll(error instanceof Error ? error : new Error(String(error))); }
  });
  const waitFor = (predicate: (frame: Frame) => boolean, timeoutMs = 15_000) => new Promise<Frame>((resolveFrame, reject) => {
    if (failure) { reject(failure); return; }
    const existing = frames.find(predicate);
    if (existing) { resolveFrame(existing); return; }
    const waiter: Waiter = { predicate, resolve: resolveFrame, reject, timer: setTimeout(() => { waiters.delete(waiter); reject(new Error(`cheapbuddy_source_host_timeout:${stderr.join("").slice(-1000)}`)); }, timeoutMs) };
    waiters.add(waiter);
  });
  const request = async (type: string, payload: Frame = {}) => {
    const requestId = randomUUID();
    child.stdin.write(encodeRpcMessage({ version: 1, requestId, type, payload }));
    return waitFor((frame) => frame.requestId === requestId);
  };
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((done) => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); }, 5_000);
        child.once("close", () => { clearTimeout(timer); done(); });
        child.kill();
      });
    }
    child.stdin.destroy();
    for (const waiter of waiters) clearTimeout(waiter.timer);
    waiters.clear();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    assert.equal((await request("health")).ok, true);
    return { root, child, frames, stderr, request, waitFor, close };
  } catch (error) { await close(); throw error; }
}

function assertNoNetwork(stderr: readonly string[]) {
  // tsx probes its parent's local Unix IPC socket even with --import. The
  // existing guard denies that probe; it is loader IPC rather than network
  // egress. Every fetch, DNS, HTTP and other socket attempt remains a failure.
  const identity = typeof process.geteuid === "function" ? process.geteuid() : userInfo().username;
  const localPipe = join(tmpdir(), `tsx-${identity}`, `${process.pid}.pipe`);
  const loaderIpc = `[desktop-network-guard] blocked net.createConnection ${process.platform === "win32" ? `\\\\?\\pipe\\${localPipe}` : localPipe}`;
  const blocked = stderr.join("").split(/\r?\n/u).filter((line) => line.includes("desktop-network-guard") && line !== loaderIpc);
  assert.deepEqual(blocked, [], stderr.join(""));
}

test("CheapBuddy account status returns the signed-out safe DTO without network access", async () => {
  const host = await startIsolatedHost();
  try {
    const frame = await host.request("cheapbuddy.account", { action: "status" });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.deepEqual(frame.data, { state: SIGNED_OUT_CHEAPBUDDY_STATE });
    assert.equal(/"(?:apiKey|accessToken|refreshToken|password|credentialRef)"/u.test(JSON.stringify(frame.data)), false);
    assertNoNetwork(host.stderr);
  } finally { await host.close(); }
});

test("unknown account actions fail before credential access or remote requests", async () => {
  const host = await startIsolatedHost();
  try {
    const frame = await host.request("cheapbuddy.account", { action: "delete_everything" });
    assert.equal(frame.ok, false);
    assert.deepEqual(frame.error, { code: "cheapbuddy_action_invalid", message: "Unknown CheapBuddy account action", retryable: false });
    assert.equal(host.stderr.join("").includes(storeMarker), false);
    assertNoNetwork(host.stderr);
  } finally { await host.close(); }
});

test("model discovery rejects invalid references and foreign URLs before credentials or egress", async () => {
  const host = await startIsolatedHost();
  try {
    for (const [provider, message] of [
      [{ ...createCheapBuddyProvider(), credentialRef: "fake-reference" }, "provider_credential_reference_invalid"],
      [{ ...createCheapBuddyProvider(), credentialRef: `cheapbuddy/account/${"a".repeat(24)}`, baseUrl: "https://foreign.invalid/v1" }, "cheapbuddy_provider_address_invalid"],
    ] as const) {
      const frame = await host.request("provider.models", { provider, capability: "text" });
      assert.equal(frame.ok, false, JSON.stringify(frame));
      assert.deepEqual(frame.error, { code: "provider_model_list_failed", message, retryable: false });
    }
    assert.equal(host.stderr.join("").includes(storeMarker), false);
    assertNoNetwork(host.stderr);
  } finally { await host.close(); }
});

test("local file workflows execute offline without resolving an unused signed-out CheapBuddy profile", async () => {
  const host = await startIsolatedHost();
  try {
    const runId = `cheapbuddy-offline-${randomUUID()}`;
    // Use the installation's real reference shape: eager resolution would try
    // native restore, fail sign-in, and prevent this entirely local workflow.
    const credentialRef = `cheapbuddy/account/${createHash("sha256").update(host.root).digest("hex").slice(0, 24)}`;
    host.child.stdin.write(encodeRpcMessage({ version: 1, requestId: randomUUID(), runId, type: "workflow.run", payload: {
      workspacePath: host.root,
      provider: { id: "local", source: "local", model: "" },
      providers: { cheapbuddy: { ...createCheapBuddyProvider(), credentialRef } },
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
    const terminal = await host.waitFor((frame) => {
      const event = (frame.data as Frame | undefined)?.event as Frame | undefined;
      return event?.runId === runId && (event.event === "done" || event.event === "runtime_error");
    });
    const event = (terminal.data as Frame).event as Frame;
    assert.equal(event.event, "done", JSON.stringify(event));
    assert.equal(await readFile(join(host.root, "artifacts", runId, "offline.md"), "utf8"), "offline hello");
    assert.ok(host.frames.some((frame) => frame.type === "service_request" && frame.method === "workflow.artifact.register"));
    assert.equal(host.stderr.join("").includes(storeMarker), false);
    assertNoNetwork(host.stderr);
  } finally { await host.close(); }
});
