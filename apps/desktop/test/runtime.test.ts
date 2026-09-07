import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createPaths, detectDesktopPaths } from "../runtime/paths";
import { defaultDesktopConfig, readDesktopConfig, redactSecrets, writeDesktopConfig } from "../runtime/config";
import { acquireInstanceLock } from "../runtime/lock";
import { desktopPlatform } from "../runtime/platform";

test("normal and portable paths are deterministic", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany desktop "));
  try {
    const normal = detectDesktopPaths({ executableDir: root, localAppData: join(root, "local") });
    assert.equal(normal.mode, "normal");
    await writeFile(join(root, "portable.flag"), "", "utf8");
    assert.equal(detectDesktopPaths({ executableDir: root }).mode, "portable");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("macOS arm64 uses Application Support, Unix runtime filenames, and an external portable data folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-macos-home-"));
  const platform = desktopPlatform({ platform: "darwin", architecture: "arm64", homeDirectory: root });
  try {
    const paths = detectDesktopPaths({ executableDir: root, platform: "darwin", architecture: "arm64", homeDirectory: root });
    assert.equal(platform.target, "macos-arm64");
    assert.equal(platform.nodeExecutable, "node");
    assert.equal(platform.openCodeExecutable, "opencode");
    assert.equal(platform.pythonExecutable, "python3");
    assert.equal(platform.fontAsset, "NotoSansCJKsc-Regular.otf");
    assert.equal(platform.portableDataDirectory, "CoworkAny Data");
    assert.equal(paths.root, join(root, "Library", "Application Support", "CoworkAny"));
    await writeFile(join(root, "portable.flag"), "", "utf8");
    assert.equal(detectDesktopPaths({ executableDir: root, platform: "darwin", architecture: "arm64", homeDirectory: root }).root, join(root, "CoworkAny Data"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("first-run desktop config has no default text model", () => {
  const root = join(tmpdir(), "coworkany-default-config");
  const config = defaultDesktopConfig(createPaths(root, "normal"));
  assert.equal(config.provider.model, "");
  assert.equal(config.provider.models, undefined);
});

test("config writes atomically and recovers from backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-config-"));
  const paths = createPaths(root, "normal");
  try {
    const initial = defaultDesktopConfig(paths);
    assert.equal(initial.locale, "auto");
    await writeDesktopConfig(paths, initial);
    await writeDesktopConfig(paths, { ...initial, workspacePath: join(root, "项目"), obsidianIndexPath: join(root, "索引"), menuAgentIds: ["business-content-growth", "agency-marketing-seo-specialist", "business-content-growth", ""], provider: { ...initial.provider, source: "openai-compatible", model: "retired/model", models: ["provider/fast", "provider/reasoning", "provider/fast", ""], reasoningEffort: "high", skillId: "ppt-master", endpoint: "/videos/generations", queryEndpoint: "/api/v1/tasks" } });
    const updated = await readDesktopConfig(paths);
    assert.equal(updated.obsidianIndexPath, join(root, "索引"));
    assert.equal(updated.provider.source, "openai-compatible");
    assert.deepEqual(updated.provider.models, ["provider/fast", "provider/reasoning"]);
    assert.equal(updated.provider.model, "provider/fast");
    assert.equal(updated.provider.reasoningEffort, "high");
    assert.equal(updated.provider.skillId, "ppt-master");
    assert.equal(updated.provider.endpoint, "/videos/generations");
    assert.equal(updated.provider.queryEndpoint, "/api/v1/tasks");
    assert.deepEqual(updated.menuAgentIds, ["business-content-growth", "agency-marketing-seo-specialist"]);
    const selectedRuntime = {
      source: "system" as const,
      nodePath: join(root, "runtime", "node.exe"),
      opencodePath: join(root, "runtime", "opencode.exe"),
      pythonPath: join(root, "runtime", "python.exe"),
      hostPath: join(root, "runtime", "host.mjs"),
      skillsPath: join(root, "runtime", "skills"),
      fontsPath: join(root, "runtime", "fonts"),
      lancedbPath: join(root, "runtime", "lancedb"),
      embeddingPath: join(root, "runtime", "embedding.json"),
    };
    await writeDesktopConfig(paths, { ...updated, runtime: selectedRuntime });
    const persistedRuntime = await readDesktopConfig(paths);
    assert.deepEqual(persistedRuntime.runtime, selectedRuntime);
    await writeDesktopConfig(paths, { ...updated, offlineRuntimeZipPath: join(root, "runtime.zip") });
    const offlineConfigured = await readDesktopConfig(paths);
    assert.equal(offlineConfigured.offlineRuntimeZipPath, join(root, "runtime.zip"));
    await writeFile(paths.configFile, "{broken", "utf8");
    const recovered = await readDesktopConfig(paths);
    assert.equal(recovered.workspacePath, updated.workspacePath);
    assert.equal(recovered.provider.source, updated.provider.source);
    const redacted = JSON.stringify(redactSecrets({ apiKey: "secret", nested: { token: "token-value" } }));
    assert.equal(redacted.includes("secret"), false);
    assert.equal((await readFile(join(root, "config.backup.json"), "utf8")).includes("workspacePath"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("config preserves provider profiles and capability defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-provider-profiles-"));
  const paths = createPaths(root, "normal");
  try {
    const initial = defaultDesktopConfig(paths);
    const fixtureCredentials = { text: "fixture-text-key", image: "fixture-image-key", video: "fixture-video-key" };
    const profiles = {
      text: { id: "text", model: "text/model", baseUrl: "https://text.test/v1", apiKey: fixtureCredentials.text, capabilities: ["text"] as const },
      image: { id: "image", model: "image/model", baseUrl: "https://image.test/v1", apiKey: fixtureCredentials.image, capabilities: ["image"] as const },
      video: { id: "video", model: "video/model", baseUrl: "https://video.test/v1", apiKey: fixtureCredentials.video, endpoint: "/videos", capabilities: ["video"] as const, workflows: [{ id: "video-wf", remoteWorkflowId: "user-wf-1", name: "User video", capability: "video" as const, version: 1, definitionHash: "hash", source: { kind: "manual" as const, importedAt: "2026-08-19T00:00:00.000Z" }, inputSchema: [], nodeBindings: [], outputSchema: [{ id: "output", type: "video" as const }] }] },
    };
    const configured = { ...initial, provider: profiles.text, providers: profiles, defaults: { text: "text", image: "image", video: "video" } };
    await writeDesktopConfig(paths, configured);
    const loaded = await readDesktopConfig(paths);
    assert.deepEqual(loaded.providers, profiles);
    assert.deepEqual(loaded.defaults, configured.defaults);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("config removes developer-owned RunningHub workflow IDs while preserving user IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-runninghub-config-"));
  const paths = createPaths(root, "normal");
  try {
    const initial = defaultDesktopConfig(paths);
    const configured = {
      ...initial,
      provider: { ...initial.provider, workflowId: "2019410250268418050" },
      providers: {
        video: { id: "video", source: "runninghub", model: "workflow", baseUrl: "https://runninghub.test", digitalHumanWorkflowId: "user-workflow-42", videoEnhanceWorkflowId: "user-enhance-42" },
      },
    };
    await writeDesktopConfig(paths, configured);
    const loaded = await readDesktopConfig(paths);
    assert.equal("workflowId" in loaded.provider, false);
    assert.equal("digitalHumanWorkflowId" in (loaded.providers?.video ?? {}), false);
    assert.equal(loaded.providers?.video?.workflows?.some((workflow) => workflow.capability === "digital_human" && workflow.remoteWorkflowId === "user-workflow-42"), true);
    assert.equal("videoEnhanceWorkflowId" in (loaded.providers?.video ?? {}), false);
    assert.equal(loaded.providers?.video?.workflows?.some((workflow) => workflow.capability === "video_enhance" && workflow.remoteWorkflowId === "user-enhance-42"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("config preserves the selected Obsidian embedding mode and endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-embedding-config-"));
  const paths = createPaths(root, "normal");
  try {
    const initial = defaultDesktopConfig(paths);
    const fixtureEmbeddingKey = ["fixture", "embedding", "key"].join("-");
    const configured = {
      ...initial,
      embedding: { mode: "remote" as const, baseUrl: "https://embedding.test/v1", model: "embedding-v2", apiKey: fixtureEmbeddingKey },
    };
    await writeDesktopConfig(paths, configured);
    const loaded = await readDesktopConfig(paths);
    assert.deepEqual(loaded.embedding, configured.embedding);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("same root allows one writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-lock-"));
  const paths = createPaths(root, "normal");
  try {
    const release = await acquireInstanceLock(paths);
    await assert.rejects(() => acquireInstanceLock(paths), /desktop_instance_already_running/);
    await release();
    const second = await acquireInstanceLock(paths);
    await second();
  } finally { await rm(root, { recursive: true, force: true }); }
});
