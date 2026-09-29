import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const configPath = resolve(process.env.COWORKANY_REAL_PROVIDER_CONFIG ?? join(desktopRoot, "real-providers.test.local.json"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const requested = String(process.env.COWORKANY_WORKFLOW_NODE_SCOPES ?? "local,text,image,audio,music,video,ppt,knowledge,digital_human").split(",").map((value) => value.trim()).filter(Boolean);
const artifactRoot = resolve(process.env.COWORKANY_WORKFLOW_NODE_ARTIFACT_DIR ?? join(repoRoot, ".artifacts", `desktop-workflow-node-validation-${Date.now()}`));
await mkdir(artifactRoot, { recursive: true });

function frame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return Buffer.concat([Buffer.from(`${body.byteLength}:`, "ascii"), body, Buffer.from("\n", "ascii")]);
}

function providerFor(capability) {
  const id = config.defaults?.[capability];
  return id && config.providers?.[id] ? { id, ...config.providers[id] } : undefined;
}

function node(key, type, configValue = {}, x = 0) {
  return { nodeKey: key, type, nodeVersion: 1, title: type, positionX: x, positionY: 0, config: configValue };
}

function definition(nodes, edges) {
  return { schemaVersion: 2, revision: 1, definitionHash: "", nodes, edges };
}

function mediaDefinition(type, provider, configValue = {}) {
  const firstInput = type === "digital_human" ? "text" : "text";
  const output = type === "image_generate" ? "image" : type === "video_generate" || type === "digital_human" ? "video" : "audio";
  const target = output === "image" ? "images" : output === "video" ? "videos" : "audios";
  return definition([
    node("input", "text_input", { text: "Create a short desktop provider validation result." }, 0),
    node(type, type, { provider: provider.id, model: provider.model, baseUrl: provider.baseUrl, endpoint: provider.endpoint, queryEndpoint: provider.queryEndpoint, ...configValue }, 1),
    node("output", "output", {}, 2),
  ], [
    { edgeKey: `input-${type}`, sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: type, targetPortId: firstInput },
    { edgeKey: `${type}-output`, sourceNodeKey: type, sourcePortId: output, targetNodeKey: "output", targetPortId: target },
  ]);
}

function digitalHumanDefinition(imageProvider, audioProvider, videoProvider, localAudioPath, localAvatarPath) {
  const avatarNode = localAvatarPath
    ? node("avatar", "upload", { uploadedFiles: [{ localPath: localAvatarPath, fileName: localAvatarPath.split(/[\\/]/u).at(-1), mimeType: "image/png" }] }, 1)
    : node("avatar", "image_generate", { provider: imageProvider.id, model: imageProvider.model, baseUrl: imageProvider.baseUrl, prompt: "A professional presenter portrait, front facing, clean studio background, no text", imageSize: "256x256", imageQuality: "low", imageBackground: "opaque", imageOutputFormat: "png" }, 1);
  const audioNode = localAudioPath
    ? node("speech", "upload", { uploadedFiles: [{ localPath: localAudioPath, fileName: localAudioPath.split(/[\\/]/u).at(-1), mimeType: "audio/mpeg" }] }, 1)
    : node("speech", "voice_synthesis", { provider: audioProvider.id, model: audioProvider.model, baseUrl: audioProvider.baseUrl, text: "This is a real desktop digital human validation.", voiceId: "English_Trustworth_Man", languageBoost: "auto", speed: "1", volume: "1", pitch: "0" }, 1);
  return definition([
    node("input", "text_input", { text: "This is a real desktop digital human validation." }, 0),
    avatarNode,
    audioNode,
    node("digital_human", "digital_human", { provider: videoProvider.id, model: videoProvider.model, baseUrl: videoProvider.baseUrl, endpoint: videoProvider.endpoint, queryEndpoint: videoProvider.queryEndpoint, scenePrompt: "Clean studio background" }, 2),
    node("output", "output", {}, 3),
  ], [
    { edgeKey: "input-avatar", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "avatar", targetPortId: "text" },
    { edgeKey: "input-speech", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "speech", targetPortId: "text" },
    { edgeKey: "input-digital", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "digital_human", targetPortId: "text" },
    { edgeKey: "avatar-digital", sourceNodeKey: "avatar", sourcePortId: "image", targetNodeKey: "digital_human", targetPortId: "images" },
    { edgeKey: "speech-digital", sourceNodeKey: "speech", sourcePortId: "audio", targetNodeKey: "digital_human", targetPortId: "audios" },
    { edgeKey: "digital-output", sourceNodeKey: "digital_human", sourcePortId: "video", targetNodeKey: "output", targetPortId: "videos" },
  ]);
}

function textDefinition(type, provider) {
  return definition([
    node("input", "text_input", { text: "Write one concise sentence confirming this real workflow node is available." }, 0),
    node(type, type, { selectedProviderId: provider.id, selectedModelId: provider.model, prompt: "Answer concisely." }, 1),
    node("output", "output", {}, 2),
  ], [
    { edgeKey: `input-${type}`, sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: type, targetPortId: "text" },
    { edgeKey: `${type}-output`, sourceNodeKey: type, sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" },
  ]);
}

function textWorkflowDefinition(provider) {
  return definition([
    node("input", "text_input", { text: "Write one concise sentence confirming these real workflow nodes are available." }, 0),
    node("writer", "writer", { selectedProviderId: provider.id, selectedModelId: provider.model }, 1),
    node("llm", "llm_generate", { selectedProviderId: provider.id, selectedModelId: provider.model }, 2),
    node("agent", "agent_execute", { selectedProviderId: provider.id, selectedModelId: provider.model, prompt: "Return the final confirmation." }, 3),
    node("output", "output", {}, 4),
  ], [
    { edgeKey: "input-writer", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "writer", targetPortId: "text" },
    { edgeKey: "writer-llm", sourceNodeKey: "writer", sourcePortId: "text", targetNodeKey: "llm", targetPortId: "text" },
    { edgeKey: "llm-agent", sourceNodeKey: "llm", sourcePortId: "text", targetNodeKey: "agent", targetPortId: "text" },
    { edgeKey: "agent-output", sourceNodeKey: "agent", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" },
  ]);
}

function pptDefinition(provider) {
  return definition([
    node("input", "text_input", { text: "Create a two-slide editable presentation that confirms desktop workflow validation." }, 0),
    node("ppt", "ppt_generate", { selectedProviderId: provider.id, selectedModelId: provider.model, prompt: "Create an editable PPTX with two slides." }, 1),
    node("output", "output", {}, 2),
  ], [
    { edgeKey: "input-ppt", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "ppt", targetPortId: "text" },
    { edgeKey: "ppt-output", sourceNodeKey: "ppt", sourcePortId: "ppt", targetNodeKey: "output", targetPortId: "presentations" },
  ]);
}

function localDefinition() {
  return definition([
    node("input", "text_input", { text: "local workflow node validation" }, 0),
    // A single upload node accepts one local file; foreach still validates the
    // collection path with the supported one-item input shape.
    node("upload", "upload", { uploadedFiles: ["fixture-a"] }, 1),
    node("file", "file_create", { fileName: "node-validation.md", fileFormat: "md" }, 1),
    node("foreach", "foreach", { inputPortId: "asset", collectNodeKey: "collect", concurrency: 2, maxIterations: 2, failurePolicy: "fail_fast" }, 2),
    node("body", "output", {}, 3),
    node("collect", "collect", { order: "input", includeFailures: false }, 4),
    node("store", "product_store", { title: "validation asset" }, 5),
    node("output", "output", {}, 6),
  ], [
    { edgeKey: "input-file", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "file", targetPortId: "text" },
    { edgeKey: "upload-foreach", sourceNodeKey: "upload", sourcePortId: "asset", targetNodeKey: "foreach", targetPortId: "items.asset" },
    { edgeKey: "foreach-body", sourceNodeKey: "foreach", sourcePortId: "item.asset", targetNodeKey: "body", targetPortId: "assets" },
    { edgeKey: "body-collect", sourceNodeKey: "body", sourcePortId: "assets", targetNodeKey: "collect", targetPortId: "items.asset" },
    { edgeKey: "file-store", sourceNodeKey: "file", sourcePortId: "asset", targetNodeKey: "store", targetPortId: "assets" },
    { edgeKey: "collect-output", sourceNodeKey: "collect", sourcePortId: "assets", targetNodeKey: "output", targetPortId: "assets" },
    { edgeKey: "file-output", sourceNodeKey: "file", sourcePortId: "asset", targetNodeKey: "output", targetPortId: "assets" },
  ]);
}

function knowledgeDefinition() {
  return definition([
    node("input", "text_input", { text: "desktop knowledge validation" }, 0),
    node("retrieve", "knowledge_retrieve", { query: "desktop knowledge validation", indexPath: "validation-index" }, 1),
    node("write", "knowledge_write", { vaultPath: join(artifactRoot, "vault"), targetPath: "validation.md" }, 2),
    node("output", "output", {}, 3),
  ], [
    { edgeKey: "input-retrieve", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "retrieve", targetPortId: "text" },
    { edgeKey: "retrieve-write", sourceNodeKey: "retrieve", sourcePortId: "text", targetNodeKey: "write", targetPortId: "text" },
    { edgeKey: "write-output", sourceNodeKey: "write", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" },
  ]);
}

function startHost(workspace) {
  const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxCli, join(desktopRoot, "runtime", "host.ts")], {
    cwd: desktopRoot,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCODE_RUNTIME_DIR: workspace,
      COWORKANY_OPENCODE_PATH: process.env.COWORKANY_OPENCODE_PATH ?? "C:\\Program Files\\nodejs\\node_modules\\opencode-ai\\bin\\opencode.exe",
    },
  });
  const frames = [];
  let startupFailure = "";
  let stderr = "";
  let buffer = Buffer.alloc(0);
  let onFrame;
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_096); });
  child.once("error", (error) => { startupFailure = `workflow_host_spawn_failed:${error.message}`; onFrame?.({ __hostFailure: startupFailure }); });
  child.once("close", (code) => {
    if (startupFailure) return;
    startupFailure = `workflow_host_exit:${code ?? "unknown"}${stderr ? `:${stderr.replace(/\s+/g, " ").slice(-512)}` : ""}`;
    onFrame?.({ __hostFailure: startupFailure });
  });
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const separator = buffer.indexOf(58);
      if (separator < 1) return;
      const length = Number.parseInt(buffer.subarray(0, separator).toString("ascii"), 10);
      const end = separator + 1 + length;
      if (!Number.isFinite(length) || end > buffer.length) return;
      const current = JSON.parse(buffer.subarray(separator + 1, end).toString("utf8"));
      buffer = buffer.subarray(end);
      frames.push(current);
      if (current.type === "service_request") {
        const payload = current.payload && typeof current.payload === "object" ? current.payload : {};
        let data = { runId: payload.runId, sequence: payload.sequence, status: payload.status };
        if (current.method === "workflow.artifact.register") data = { artifactId: `${payload.runId ?? "run"}:${payload.relativePath ?? "artifact"}` };
        if (current.method === "runtime.artifact.write") data = { relativePath: payload.relativePath, mimeType: payload.mimeType, byteLength: Buffer.byteLength(String(payload.content ?? ""), "utf8"), sha256: "validation-sha256" };
        if (current.method === "knowledge.search") data = { results: [{ documentPath: "validation.md", heading: "Validation", excerpt: "desktop knowledge validation" }] };
        if (current.method === "knowledge.write") data = { documentPath: String(payload.targetPath ?? "validation.md"), written: true };
        child.stdin.write(frame({ version: 1, requestId: current.requestId, type: "service_response", ok: true, data }));
      }
      onFrame?.(current);
    }
  });
  return { child, frames, waitFor: (predicate, timeoutMs) => new Promise((resolveFrame, reject) => {
    if (startupFailure) return reject(new Error(startupFailure));
    const existing = frames.find(predicate);
    if (existing) return resolveFrame(existing);
    const timer = setTimeout(() => { onFrame = undefined; reject(new Error("workflow_node_validation_timeout")); }, timeoutMs);
    onFrame = (current) => {
      if (current?.__hostFailure) { clearTimeout(timer); onFrame = undefined; reject(new Error(String(current.__hostFailure))); return; }
      if (!predicate(current)) return;
      clearTimeout(timer);
      onFrame = undefined;
      resolveFrame(current);
    };
  }) };
}

async function runScope(scope) {
  const workspace = join(artifactRoot, scope);
  await mkdir(workspace, { recursive: true });
  const textProvider = providerFor("text");
  const imageProvider = providerFor("image");
  const audioProvider = providerFor("audio");
  const videoProvider = providerFor("video");
  const registeredWorkflows = Array.isArray(videoProvider?.workflows) ? videoProvider.workflows : [];
  if (scope === "digital_human" && (!videoProvider || !registeredWorkflows.some((workflow) => workflow.capability === "digital_human"))) return { scope, status: "BLOCKED", reason: "digital_human_workflow_registration_missing" };
  if (scope === "video_enhance" && (!videoProvider || !registeredWorkflows.some((workflow) => workflow.capability === "video_enhance"))) return { scope, status: "BLOCKED", reason: "video_enhance_workflow_registration_missing" };
  const provider = scope === "image" ? imageProvider : ["audio", "audio_generate", "music", "voice_clone"].includes(scope) ? audioProvider : ["video", "video_enhance", "digital_human"].includes(scope) ? videoProvider : textProvider;
  if (["image", "audio", "audio_generate", "music", "voice_clone", "video", "video_enhance", "digital_human"].includes(scope) && !provider) return { scope, status: "BLOCKED", reason: "provider_profile_missing" };
  const host = startHost(workspace);
  const runId = `real-node-${scope}-${randomUUID()}`;
  let workflow;
  if (scope === "local") workflow = localDefinition();
  else if (scope === "knowledge") workflow = knowledgeDefinition();
  else if (scope === "text") workflow = textWorkflowDefinition(textProvider);
  else if (["writer", "llm_generate", "agent_execute"].includes(scope)) workflow = textDefinition(scope, textProvider);
  else if (scope === "ppt") workflow = pptDefinition(textProvider);
  else if (scope === "image") workflow = mediaDefinition("image_generate", provider, { prompt: "A simple yellow square on a white background, no text", imageSize: process.env.COWORKANY_WORKFLOW_IMAGE_SIZE ?? "256x256", imageQuality: "low", imageBackground: "opaque", imageOutputFormat: "png", imageModeration: "auto" });
  else if (scope === "audio" || scope === "audio_generate") workflow = mediaDefinition(scope === "audio" ? "voice_synthesis" : "audio_generate", provider, { text: "This is a real desktop audio validation.", voiceId: "English_Trustworth_Man", languageBoost: "auto", speed: "1", volume: "1", pitch: "0" });
  else if (scope === "voice_clone") {
    const reference = String(process.env.COWORKANY_WORKFLOW_VOICE_CLONE_REFERENCE ?? "reference.bin").trim();
    workflow = mediaDefinition("voice_clone", provider, { localAttachments: [reference], voiceId: `desktop-validation-${Date.now()}`, previewText: "This is a desktop voice clone validation." });
  }
  else if (scope === "music") workflow = mediaDefinition("music_generate", provider, { prompt: "A short upbeat instrumental desktop validation track", genre: "electronic-pop", mood: "uplifting", vocals: "instrumental" });
  else if (scope === "video") workflow = mediaDefinition("video_generate", provider, { prompt: "A short abstract animation of soft blue and white geometric gradients", duration: "5", ratio: "16:9", sound: "off" });
  else if (scope === "video_enhance") workflow = definition([
    node("input", "upload", { uploadedFiles: [{ localPath: String(process.env.COWORKANY_WORKFLOW_VIDEO_ENHANCE_SOURCE ?? ""), fileName: "source.mp4", mimeType: "video/mp4" }] }, 0),
    node("video_enhance", "video_generate", { provider: provider.id, model: provider.model, baseUrl: provider.baseUrl, endpoint: provider.endpoint, queryEndpoint: provider.queryEndpoint, featureId: "video-enhance", prompt: "提升细节、修复压缩模糊、强化人物边缘", durationLimit: 10, seed: -1 }, 1),
    node("output", "output", {}, 2),
  ], [
    { edgeKey: "input-video-enhance", sourceNodeKey: "input", sourcePortId: "asset", targetNodeKey: "video_enhance", targetPortId: "videos" },
    { edgeKey: "video-enhance-output", sourceNodeKey: "video_enhance", sourcePortId: "video", targetNodeKey: "output", targetPortId: "videos" },
  ]);
  else workflow = digitalHumanDefinition(
    imageProvider,
    audioProvider,
    videoProvider,
    String(process.env.COWORKANY_WORKFLOW_DIGITAL_HUMAN_AUDIO ?? "").trim() || undefined,
    String(process.env.COWORKANY_WORKFLOW_DIGITAL_HUMAN_AVATAR ?? "").trim() || undefined,
  );
  host.child.stdin.write(frame({ version: 1, requestId: randomUUID(), runId, type: "workflow.run", payload: { workspacePath: workspace, provider: textProvider, media: provider, providers: config.providers, definition: workflow } }));
  try {
    const defaultTimeoutMs = scope === "video" || scope === "video_enhance" || scope === "digital_human" ? 12 * 60_000 : scope === "music" || scope === "ppt" ? 6 * 60_000 : 4 * 60_000;
    const timeoutMs = Math.max(30_000, Number(process.env.COWORKANY_WORKFLOW_NODE_TIMEOUT_MS ?? defaultTimeoutMs));
    const terminal = await host.waitFor((current) => {
      const event = current.data?.event;
      return event?.runId === runId && ["done", "runtime_error"].includes(event?.event);
    }, timeoutMs);
    const terminalEvent = terminal.data?.event ?? {};
    const succeeded = terminalEvent.event === "done";
    const nodeEvents = host.frames.map((current) => current.data?.event).filter((event) => event?.event === "tool_event" && /^workflow:node_(?:succeeded|failed)$/.test(String(event.tool))).map((event) => {
      let payload = {};
      try { payload = JSON.parse(event.message); } catch { /* malformed provider event is not test evidence */ }
      return { event: String(event.tool).replace("workflow:", ""), nodeKey: payload.nodeKey, executorId: payload.executorId };
    });
    const artifacts = host.frames.map((current) => current.data?.event).filter((event) => String(event?.tool ?? "").startsWith("artifact:"));
    const providerEvents = host.frames.map((current) => current.data?.event).filter((event) => String(event?.tool ?? "").startsWith("media:")).map((event) => {
      let payload = {};
      try { payload = JSON.parse(event.message); } catch { /* malformed provider event is not test evidence */ }
      return { phase: event.phase, status: payload.status, providerStatus: payload.providerStatus, providerTaskId: payload.providerTaskId, stage: payload.stage, error: payload.error };
    });
    return { scope, status: succeeded ? "PASS" : "FAIL", runId, nodeEvents, providerEvents, artifactCount: artifacts.length, error: succeeded ? undefined : String(terminalEvent.message ?? "workflow_failed") };
  } catch (error) {
    const providerEvents = host.frames.map((current) => current.data?.event).filter((event) => String(event?.tool ?? "").startsWith("media:")).slice(-20).map((event) => {
      let payload = {};
      try { payload = JSON.parse(event.message); } catch { /* malformed provider event is not test evidence */ }
      return { phase: event.phase, status: payload.status, providerStatus: payload.providerStatus, providerTaskId: payload.providerTaskId, stage: payload.stage, error: payload.error };
    });
    return { scope, status: "FAIL", runId, providerEvents, error: error instanceof Error ? error.message : String(error), observedEvents: host.frames.length };
  } finally {
    host.child.kill();
  }
}

const results = [];
for (const scope of requested) results.push(await runScope(scope));
const report = { generatedAt: new Date().toISOString(), configFile: configPath, excluded: ["seedance"], artifactRoot, results };
await writeFile(join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
