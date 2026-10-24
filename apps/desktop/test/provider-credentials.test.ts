import assert from "node:assert/strict";
import test from "node:test";
import { createCheapBuddyProvider } from "../src/cheapbuddy";
import { ManagedProviderRuntime, createRedactedLogWriter, managedProviderFailure, qualifiedOpenCodeModel, resolveProviderCredentials } from "../runtime/provider-credentials";
import { buildOpenCodeCommand } from "@coworkany/runtime-contracts/opencode";

const reference = "cheapbuddy/account/0123456789abcdef01234567";
const profile = { ...createCheapBuddyProvider(), credentialRef: reference };

test("Host resolves only the selected profile without mutating persisted config", async () => {
  const resolved = await resolveProviderCredentials(profile, async ref => ref === reference ? "fixture-private-key" : undefined);
  assert.equal(resolved?.apiKey, "fixture-private-key");
  assert.equal(JSON.stringify(profile).includes("fixture-private-key"), false);
});

test("OpenCode CLI qualification preserves slash-containing CheapBuddy model IDs", () => {
  const configured = { ...profile, model: "deepseek/deepseek-v4.1-flash" };
  assert.equal(qualifiedOpenCodeModel(configured), "cheapbuddy/deepseek/deepseek-v4.1-flash");
  assert.deepEqual(buildOpenCodeCommand({ modelHint: qualifiedOpenCodeModel(configured) }).args, ["run", "--format", "json", "--model", "cheapbuddy/deepseek/deepseek-v4.1-flash"]);
  assert.equal(qualifiedOpenCodeModel({ ...configured, model: "cheapbuddy/deepseek/deepseek-v4.1-flash" }), "cheapbuddy/deepseek/deepseek-v4.1-flash");
});

test("account changes retire tracked clients before session registration and drop stale launches", async () => {
  const runtime = new ManagedProviderRuntime();
  const generation = runtime.capture(profile);
  let retireCalls = 0;
  let releaseRetire!: () => void;
  const retired = new Promise<void>((resolve) => { releaseRetire = resolve; });
  runtime.trackClient({ retire: async () => { retireCalls++; await retired; } }, generation);
  const changing = runtime.invalidate();
  assert.equal(retireCalls, 1);
  assert.throws(() => runtime.assertCurrent(generation), /cheapbuddy_request_superseded/u);
  // A fresh request during cleanup must not resolve and relaunch the old account either.
  assert.throws(() => runtime.assertCurrent(runtime.capture(profile)), /cheapbuddy_request_superseded/u);
  releaseRetire();
  const changedGeneration = await changing;
  assert.throws(() => runtime.trackClient({ retire: async () => {} }, generation), /cheapbuddy_request_superseded/u);
  runtime.finishAccountChange(changedGeneration);
  runtime.assertCurrent(runtime.capture(profile));
});

test("a completed older account change cannot unlock a newer login/logout", async () => {
  const runtime = new ManagedProviderRuntime();
  const first = await runtime.invalidate();
  const second = await runtime.invalidate();
  runtime.finishAccountChange(first);
  assert.throws(() => runtime.assertCurrent(runtime.capture(profile)), /cheapbuddy_request_superseded/u);
  assert.throws(() => runtime.assertAccountChange(first), /cheapbuddy_request_superseded/u);
  runtime.finishAccountChange(second);
  runtime.assertCurrent(runtime.capture(profile));
});

test("logout cancels managed work while unused CheapBuddy profiles do not block local work", async () => {
  const runtime = new ManagedProviderRuntime();
  let managedCancelled = 0;
  let localCancelled = 0;
  runtime.trackCancellation(() => managedCancelled++, runtime.capture(profile));
  runtime.trackCancellation(() => localCancelled++, runtime.capture({ id: "local", model: "fixture-local" }));
  const change = await runtime.invalidate();
  assert.equal(managedCancelled, 1);
  assert.equal(localCancelled, 0);
  runtime.assertCurrent(undefined);
  runtime.finishAccountChange(change);
});

test("known keys are redacted from nested errors, recent daemon errors and JSON tool messages", async () => {
  const runtime = new ManagedProviderRuntime();
  runtime.remember({ ...profile, apiKey: "fixture-key-one" });
  const change = await runtime.invalidate();
  runtime.finishAccountChange(change);
  runtime.remember({ ...profile, apiKey: "fixture-key-two" });
  const payload = { error: { message: "invalid fixture-key-one" }, event: { message: JSON.stringify({ error: "invalid fixture-key-two" }) } };
  const safe = runtime.redact(payload);
  assert.ok(!JSON.stringify(safe).includes("fixture-key-one"));
  assert.ok(!JSON.stringify(safe).includes("fixture-key-two"));
  assert.equal(payload.error.message, "invalid fixture-key-one");
  assert.ok(JSON.stringify(safe).includes("[redacted]"));
});

test("managed media failures discard upstream text even when a library already truncated a secret", () => {
  const truncated = new Error("media_provider_http_401: rejected fixture-private-key-prefix-only");
  assert.equal(managedProviderFailure(truncated, "media").message, "cheapbuddy_media_http_401");
  assert.equal(managedProviderFailure(new Error("arbitrary fixture-key echoed response"), "download").message, "cheapbuddy_download_request_failed");
  assert.equal(managedProviderFailure(new Error("media_provider_request_timeout"), "media").message, "cheapbuddy_media_timeout");
  assert.equal(managedProviderFailure(new Error("cheapbuddy_request_superseded"), "media").message, "cheapbuddy_request_superseded");
});

test("stderr keys split across pipe chunks are redacted before any output is written", () => {
  const runtime = new ManagedProviderRuntime();
  runtime.remember({ ...profile, apiKey: "fixture-private-key" });
  const output: string[] = [];
  const writer = createRedactedLogWriter(value => runtime.redactText(value), value => output.push(value));
  writer.write("HTTP error: fixture-pri");
  assert.equal(output.length, 0);
  writer.write("vate-key rejected\nnext line");
  writer.flush();
  assert.deepEqual(output, ["HTTP error: [redacted] rejected\n", "next line"]);
});

test("credential references cannot transmit the account key to altered addresses or other Providers", async () => {
  let reads = 0;
  const resolver = async () => { reads++; return "fixture-private-key"; };
  for (const altered of [{ ...profile, baseUrl: "https://example.com/v1" }, { ...profile, id: "other" }, { ...profile, credentialRef: "untrusted/reference" }]) {
    await assert.rejects(resolveProviderCredentials(altered, resolver), /invalid/u);
  }
  assert.equal(reads, 0);
});

test("signed-out credentials fail before model execution while legacy Providers keep their existing behavior", async () => {
  await assert.rejects(resolveProviderCredentials(profile, async () => undefined), /cheapbuddy_sign_in_required/u);
  const legacy = { id: "local", model: "local-model" };
  assert.equal(await resolveProviderCredentials(legacy, async () => { throw new Error("must not read store"); }), legacy);
});
