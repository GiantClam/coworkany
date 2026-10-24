import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCredentialStore, type CredentialCommandRunner } from "../runtime/credential-store";

const reference = "cheapbuddy/account/test-installation";
const secret = JSON.stringify({ accessToken: "fixture-access", apiKey: "fixture-key" });

test("macOS sends credential JSON through security stdin, verifies it, and clears the OS record", async () => {
  const calls: Array<{ command: string; args: readonly string[]; input?: string }> = [];
  let stored: string | undefined;
  const runner: CredentialCommandRunner = async (command, args, input) => {
    calls.push({ command, args, input });
    if (args[0] === "-i") { stored = secret; return { code: 0, stdout: "security> ", stderr: "" }; }
    if (args[0] === "delete-generic-password") { stored = undefined; return { code: 0, stdout: "", stderr: "" }; }
    return { code: stored ? 0 : 44, stdout: stored ?? "", stderr: stored ? "" : "The specified item could not be found in the keychain." };
  };
  const store = createCredentialStore({ platform: "darwin", runner });
  assert.equal(await store.set(reference, secret), true);
  assert.equal(await store.get(reference), secret);
  assert.equal(calls[0].command, "/usr/bin/security");
  assert.deepEqual(calls[0].args, ["-i"]);
  assert.ok(calls[0].input?.includes("fixture-access"));
  assert.ok(calls.every((call) => !call.args.join(" ").includes("fixture-access")));
  await store.delete(reference);
  assert.equal(await store.get(reference), undefined);
});

test("interactive security success does not imply that a failed write persisted", async () => {
  const store = createCredentialStore({ platform: "darwin", runner: async (_command, args) => ({ code: 0, stdout: args[0] === "find-generic-password" ? "wrong-record" : "", stderr: "" }) });
  assert.equal(await store.set(reference, secret), false);
  assert.equal(await store.get(reference), secret);
});

test("unavailable native tools retain credentials in memory only", async () => {
  const store = createCredentialStore({ platform: "linux", runner: async () => { throw new Error("fixture secret must not leak"); } });
  assert.equal(await store.set(reference, secret), false);
  assert.equal(await store.get(reference), secret);
  await store.delete(reference);
  assert.equal(await store.get(reference), undefined);
});

test("Linux secret-tool receives the value on stdin", async () => {
  let input: string | undefined;
  let args: readonly string[] = [];
  const store = createCredentialStore({ platform: "linux", runner: async (_command, commandArgs, stdin) => { input = stdin; args = commandArgs; return { code: 0, stdout: "", stderr: "" }; } });
  assert.equal(await store.set(reference, secret), true);
  assert.equal(input, secret);
  assert.ok(!args.includes(secret));
});

test("Windows uses CurrentUser DPAPI and stdin without writing plaintext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coworkany-credential-test-"));
  try {
    const calls: Array<{ args: readonly string[]; input?: string }> = [];
    const store = createCredentialStore({ platform: "win32", dataDirectory: directory, runner: async (_command, args, input) => { calls.push({ args, input }); return { code: 0, stdout: "", stderr: "" }; } });
    assert.equal(await store.set(reference, secret), true);
    assert.ok(calls[0].args.join(" ").includes("ProtectedData]::Protect"));
    assert.ok(calls[0].args.join(" ").includes("CurrentUser"));
    assert.ok(!calls[0].args.join(" ").includes("fixture-access"));
    const payload = JSON.parse(calls[0].input ?? "{}");
    assert.equal(payload.value, secret);
    assert.ok(payload.path.endsWith(".dpapi"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("credential references cannot inject commands or access arbitrary store namespaces", async () => {
  let calls = 0;
  const store = createCredentialStore({ platform: "darwin", runner: async () => { calls++; return { code: 0, stdout: "", stderr: "" }; } });
  await assert.rejects(store.set("cheapbuddy/account/x\nfind-generic-password", secret), /credential_reference_invalid/u);
  await assert.rejects(store.get("other-provider/secret"), /credential_reference_invalid/u);
  assert.equal(calls, 0);
});

test("failure to delete a previously persisted credential is surfaced with a fixed error", async () => {
  const store = createCredentialStore({ platform: "darwin", runner: async (_command, args) => args[0] === "delete-generic-password" ? { code: 1, stdout: "", stderr: "fixture-access: permission denied" } : { code: 0, stdout: secret, stderr: "" } });
  assert.equal(await store.get(reference), secret);
  await assert.rejects(store.delete(reference), /^Error: credential_store_clear_failed$/u);
  assert.equal(await store.get(reference), undefined);
});
