import assert from "node:assert/strict";
import test from "node:test";
import { createAgentDirectoryReader } from "../src/virtual-office/agent-directory-reader";

test("reader shares concurrent paired reads and caches the result", async () => {
  let calls = 0; let mutations = 0;
  const invoke = async <T>(command: string): Promise<T> => { calls += 1; if (command === "write_config") mutations += 1; return (command === "runtime_status" ? { ready: true, skills: true } : [{ id: "writer", label: "Writer", installed: true }]) as T; };
  const reader = createAgentDirectoryReader(invoke);
  const [one, two] = await Promise.all([reader.read({ refresh: true }), reader.read()]);
  assert.equal(one.status, "ready"); assert.equal(two.status, "ready"); assert.equal(calls, 2); assert.equal(mutations, 0);
  await reader.read(); assert.equal(calls, 2);
  assert.equal(reader.getSnapshot?.()?.status, "ready");
  reader.clear(); await reader.read(); assert.equal(calls, 4);
});

test("clear prevents an old in-flight result from becoming the directory snapshot", async () => {
  let resolveCatalog!: (value: unknown) => void;
  const pendingCatalog = new Promise<unknown>((resolve) => { resolveCatalog = resolve; });
  const reader = createAgentDirectoryReader(async <T>(command: string) => {
    if (command === "runtime_status") return { ready: true, skills: true } as T;
    return pendingCatalog as Promise<T>;
  });
  const oldRead = reader.read();
  reader.clear();
  resolveCatalog([{ id: "stale-agent", installed: true }]);
  await oldRead;
  assert.equal(reader.getSnapshot?.(), undefined);
});

test("ordinary rejects are unknown, explicit unavailable is offline, and recovery is ready", async () => {
  let mode: "reject" | "offline" | "ready" = "reject";
  const invoke = async <T>(command: string): Promise<T> => { if (mode === "reject") throw new Error(`${command}_failed`); return (command === "runtime_status" ? { ready: mode === "ready", skills: mode === "ready" } : [{ id: "agent", title: "Agent" }]) as T; };
  const reader = createAgentDirectoryReader(invoke);
  assert.equal((await reader.read({ refresh: true })).status, "unknown");
  mode = "offline"; assert.equal((await reader.read({ refresh: true })).status, "offline");
  mode = "ready"; assert.equal((await reader.read({ refresh: true })).status, "ready");
});
