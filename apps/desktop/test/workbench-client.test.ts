import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { createDesktopChatTransport, createDesktopWorkbenchClient } from "../src/workbench-client";
import { createDesktopUIMessage, desktopUIMessageText } from "@coworkany/workbench-client";
import { resolveWorkflowAiTextProvider } from "../src/workflow-ai-controller";

test("desktop WorkbenchClient maps persisted metrics into the shared contract", async () => {
  const bridge = {
    async invoke<T>(command: string) {
      const count = { total: 1, completed: 1, failed: 0, rejected: 0 };
      if (command === "get_run_metrics") return { runId: "r1", provider: "openai", model: "gpt", modelTools: count, capabilities: { ...count, total: 0, completed: 0 }, modelToolBreakdown: [{ name: "read", ...count }], capabilityBreakdown: [], inputTokens: 4, outputTokens: 2, cachedInputTokens: 1, reasoningTokens: null, providerCost: 0.01, estimatedCost: null, completeness: "complete" } as T;
      if (command === "query_metrics") return { overview: { tokens: 6, modelTools: 1, capabilities: 0, providerCost: 0.01 }, series: [], models: [], tools: [], capabilities: [], runs: [], nextCursor: null } as T;
      return undefined as T;
    },
    async listen() { return () => undefined; },
  };
  const client = createDesktopWorkbenchClient(bridge, { go: () => undefined, replace: () => undefined, current: () => "/dashboard/usage" });
  const metrics = await client.metrics?.getRun("r1");
  assert.equal(metrics?.modelTools.byName[0]?.name, "read");
  assert.deepEqual(metrics?.tokens, { input: 4, output: 2, cachedInput: 1 });
  assert.equal((await client.metrics?.query({ range: "30d" }))?.overview.tokens, 6);
});

test("desktop WorkbenchClient adapts conversations, workflows and file actions through Tauri", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) {
      calls.push({ command, args });
      if (command === "list_conversations") return [{ id: "c1", title: "本地会话", updated_at: "2026-08-12T00:00:00Z", message_count: 2, opencode_session_id: "session-c1", agent_id: "executive-brand" }] as T;
      if (command === "list_messages") return [{
        id: "m1",
        conversation_id: "c1",
        role: "assistant",
        content: "已完成",
        parts_json: JSON.stringify([
          { type: "text", text: "已完成", state: "done" },
          { type: "data-status", id: "part-tool", data: { status: "completed", message: "writer" } },
          { type: "data-artifact", id: "part-artifact", data: { id: "a1", relativePath: "artifacts/report.md", title: "报告", mimeType: "text/markdown", byteLength: 12, sha256: "hash-a" } },
        ]),
        metadata_json: JSON.stringify({ conversationId: "c1", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" }),
        created_at: "2026-08-12T00:00:00Z",
      }] as T;
      if (command === "list_workflows") return [{ id: "w1", name: "内容工作流", definition_json: JSON.stringify({ schemaVersion: 2, revision: 3, definitionHash: "hash-1", nodes: [{ nodeKey: "input" }], edges: [] }), updated_at: "2026-08-12T00:00:00Z" }] as T;
      if (command === "save_workflow") return { id: String((args?.input as { id: string }).id), name: String((args?.input as { name: string }).name), definition_json: String((args?.input as { definition_json: string }).definition_json), updated_at: "2026-08-12T00:00:00Z" } as T;
      if (command === "list_artifacts") return [{ id: "a1", relative_path: "artifacts/report.md", mime_type: "text/markdown", byte_length: 12, sha256: "hash-a", created_at: "2026-08-12T00:00:00Z", available: true }] as T;
      if (command === "list_runs") return [{ id: "r1", conversation_id: "c1", status: "succeeded", model: "fixture/model", started_at: "2026-08-12T00:00:00Z", finished_at: "2026-08-12T00:01:00Z" }] as T;
      if (command === "inspect_run") return { run: { id: "r1", conversation_id: "c1", status: "succeeded", model: "fixture/model", started_at: "2026-08-12T00:00:00Z", finished_at: "2026-08-12T00:01:00Z" }, nodes: [{ node_key: "writer", status: "succeeded", output_json: "{}", updated_at: "2026-08-12T00:01:00Z" }], events: [{ sequence: 1, event_type: "done", payload_json: "{}", created_at: "2026-08-12T00:01:00Z" }], usage: [{ provider: "fixture", model: "fixture/model", input_tokens: 2, output_tokens: 3, provider_cost: 0.01, estimated_cost: null, created_at: "2026-08-12T00:01:00Z" }] } as T;
      return undefined as T;
    },
    async listen() { return () => undefined; },
  };
  const client = createDesktopWorkbenchClient(bridge, { go: () => undefined, replace: () => undefined, current: () => "/dashboard/ai" });
  assert.equal((await client.conversations.list())[0]?.title, "本地会话");
  assert.equal((await client.conversations.list())[0]?.opencodeSessionId, "session-c1");
  assert.equal((await client.conversations.list())[0]?.agentId, "executive-brand");
  const message = (await client.conversations.messages("c1"))[0];
  assert.equal(desktopUIMessageText(message!), "已完成");
  assert.equal(message?.metadata?.createdAt, "2026-08-12T00:00:00Z");
  assert.equal(message?.parts?.[1]?.type, "data-status");
  assert.equal(message?.parts?.[2]?.type, "data-artifact");
  await client.conversations.messages("c1", { limit: 10, before: { createdAt: "2026-08-12T00:00:00Z", id: "m1" } });
  assert.deepEqual(calls.at(-1)?.args, { conversationId: "c1", limit: 10, beforeCreatedAt: "2026-08-12T00:00:00Z", beforeId: "m1" });
  const listedWorkflow = (await client.workflows.list())[0];
  assert.equal(listedWorkflow?.title, "内容工作流");
  assert.equal(listedWorkflow?.definition.definitionHash, "hash-1");
  assert.equal(listedWorkflow?.definition.revision, 3);
  const savedWorkflow = await client.workflows.save({ id: "w2", title: "本地流程", definition: { nodes: [], edges: [] } });
  assert.equal(savedWorkflow.id, "w2");
  assert.equal(calls.at(-1)?.command, "save_workflow");
  await client.workflows.remove("w1");
  assert.equal(calls.at(-1)?.command, "remove_workflow");
  assert.equal(calls.at(-1)?.args?.workflowId, "w1");
  assert.equal((await client.artifacts.list())[0]?.relativePath, "artifacts/report.md");
  await client.artifacts.remove("a1");
  assert.equal(calls.at(-1)?.command, "remove_artifact");
  assert.equal((await client.runs.list())[0]?.model, "fixture/model");
  const detail = await client.runs.inspect("r1");
  assert.equal(detail.nodes[0]?.nodeKey, "writer");
  assert.equal(detail.usage[0]?.providerCost, 0.01);
  await client.knowledge.open("notes/cited.md");
  assert.equal(calls.at(-1)?.command, "open_vault_file");
  await client.files.open("output/report.md", "text/markdown");
  assert.equal(calls.at(-1)?.command, "open_artifact_default");
  assert.equal(calls.at(-1)?.args?.mimeType, "text/markdown");
  await client.files.reveal("output/report.md", "text/markdown");
  assert.equal(calls.at(-1)?.command, "open_artifact");
  assert.equal(calls.at(-1)?.args?.mimeType, "text/markdown");
  await client.files.openFolder?.("output/report.md", "text/markdown");
  assert.equal(calls.at(-1)?.command, "open_artifact_folder");
  await client.files.openWith?.("output/report.md", "text/markdown");
  assert.equal(calls.at(-1)?.command, "open_artifact_with");
  const started = await client.runs.start({ id: "run-1", conversationId: "c1", prompt: "生成内容", model: "provider/model" });
  assert.equal(started.id, "run-1");
  assert.equal(calls.at(-1)?.command, "create_run");
  await client.runs.start({ id: "media-run-1", conversationId: null, prompt: "生成音频", model: "audio/model" });
  assert.equal(calls.at(-1)?.command, "create_run");
  assert.equal(calls.at(-1)?.args?.conversationId, null);
  await client.runs.cancel("run-1");
  assert.equal((calls.at(-1)?.args?.message as { type?: string } | undefined)?.type, "run.cancel");
  await client.runs.emergencyStop("run-1");
  assert.equal((calls.at(-1)?.args?.message as { type?: string } | undefined)?.type, "run.emergency_stop");
});

test("desktop WorkbenchClient restores UIMessage parts without projecting away metadata or media", async () => {
  const bridge = {
    async invoke<T>(command: string) {
      if (command !== "list_messages") return undefined as T;
      return [{
        id: "ui-m1",
        conversation_id: "c-ui",
        role: "assistant",
        content: "",
        parts_json: JSON.stringify([
          { type: "text", text: "流式内容", state: "done", providerMetadata: { coworkany: { partId: "text:1", sequence: 1 } } },
          { type: "data-media", id: "media:1", data: { kind: "image", title: "封面", mimeType: "image/png", relativePath: "artifacts/cover.png" } },
        ]),
        metadata_json: JSON.stringify({ conversationId: "c-ui", runId: "run-ui", providerId: "deepseek", modelId: "deepseek-v4-flash", modelLocked: true }),
        created_at: "2026-08-26T00:00:00Z",
      }] as T;
    },
    async listen() { return () => undefined; },
  };
  const client = createDesktopWorkbenchClient(bridge, { go: () => undefined, replace: () => undefined, current: () => "/dashboard/ai" });
  const uiMessage = (await client.conversations.messages("c-ui"))[0];
  assert.equal(uiMessage?.metadata?.modelId, "deepseek-v4-flash");
  assert.equal(uiMessage?.parts[1]?.type, "data-media");
  assert.equal(desktopUIMessageText(uiMessage!), "流式内容");
  assert.equal(uiMessage?.parts?.[0]?.type, "text");
});

test("desktop history preserves persisted text and keeps reasoning as a separate part", async () => {
  const bridge = {
    async invoke<T>(command: string) {
      if (command !== "list_messages") return undefined as T;
      return [{
        id: "sales-history-legacy",
        conversation_id: "c-sales",
        role: "assistant",
         content: "用户想检索销售策略相关的资料。我应该先看看本地有没有相关领域资料可以读取。检索结果显示暂无可靠记录，请补充app链接。",
        parts_json: JSON.stringify([
          { type: "reasoning", text: "用户想检索资料，我需要先核实信息来源。", state: "done" },
          { type: "text", text: "用户想检索销售策略相关的资料。我应该先看看本地有没有相关领域资料可以读取。检索结果显示暂无可靠记录，请补充app链接。", state: "streaming" },
        ]),
        metadata_json: JSON.stringify({ conversationId: "c-sales" }),
        created_at: "2026-09-02T07:19:20.809Z",
      }] as T;
    },
    async listen() { return () => undefined; },
  };
  const client = createDesktopWorkbenchClient(bridge, { go: () => undefined, replace: () => undefined, current: () => "/dashboard/ai" });
  const message = (await client.conversations.messages("c-sales"))[0];
  assert.equal(desktopUIMessageText(message!), "用户想检索销售策略相关的资料。我应该先看看本地有没有相关领域资料可以读取。检索结果显示暂无可靠记录，请补充app链接。");
  assert.equal(message?.parts.find((part) => part.type === "reasoning")?.type, "reasoning");
});

test("desktop ChatTransport forwards the locked config model and persists the UIMessage user turn", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const started: string[] = [];
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) { calls.push({ command, args }); return undefined as T; },
    async listen() { return () => undefined; },
  };
  const workbenchClient = { runs: { subscribe: () => () => undefined } } as never;
  const transport = createDesktopChatTransport(bridge, workbenchClient, {
    resolveSessionId: async () => "session-c1",
    resolveProvider: () => ({ id: "deepseek", model: "deepseek-v4-flash" }),
    onRunStarted: (runId) => started.push(runId),
  });
  const content = "  你好\n\n**原样保留**  ";
  const message = createDesktopUIMessage({ id: "ui-user-1", role: "user", conversationId: "c1", content, providerId: "deepseek", modelId: "deepseek-v4-flash" });
  await transport.sendMessages({ trigger: "submit-message", chatId: "c1", messageId: undefined, messages: [message], abortSignal: undefined });
  assert.deepEqual(calls.map((call) => call.command), ["create_run", "append_message", "host_start", "host_send"]);
  assert.equal((calls[0]?.args as { model?: string }).model, "deepseek-v4-flash");
  const persisted = calls[1]?.args?.input as { content?: string; metadata_json?: string };
  assert.equal(persisted.content, content);
  assert.match(String(persisted.metadata_json), /deepseek-v4-flash/);
  const sentPrompt = ((calls[3]?.args?.message as { payload?: { prompt?: unknown } } | undefined)?.payload?.prompt);
  assert.equal(sentPrompt, content);
  assert.equal(started.length, 1);
});

test("desktop ChatTransport forwards the PPT artifact policy on both session and prompt", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) { calls.push({ command, args }); return undefined as T; },
    async listen() { return () => undefined; },
  };
  const workbenchClient = { runs: { subscribe: () => () => undefined } } as never;
  const transport = createDesktopChatTransport(bridge, workbenchClient, {
    resolveSessionId: async () => "session-ppt",
    resolveProvider: () => ({ id: "configured", model: "configured/ppt" }),
    resolveAllowArtifacts: (message) => message.metadata?.route === "/dashboard/ai?agent=executive-ppt",
  });
  const message = createDesktopUIMessage({ id: "ppt-user-1", role: "user", conversationId: "ppt-c1", content: "生成一页 PPT", route: "/dashboard/ai?agent=executive-ppt" });
  await transport.sendMessages({ trigger: "submit-message", chatId: "ppt-c1", messageId: undefined, messages: [message], abortSignal: undefined });
  const hostSend = calls.find((call) => call.command === "host_send")?.args?.message as { payload?: { allowArtifacts?: boolean } } | undefined;
  assert.equal(hostSend?.payload?.allowArtifacts, true);
});

test("desktop ChatTransport lets the config/session adapter materialize a draft conversation before prompting", async () => {
  const calls: string[] = [];
  const bridge = {
    async invoke<T>(command: string) { calls.push(command); return undefined as T; },
    async listen() { return () => undefined; },
  };
  let ensured: { chatId: string; sessionId: string; model?: string } | undefined;
  const workbenchClient = { runs: { subscribe: () => () => undefined } } as never;
  const transport = createDesktopChatTransport(bridge, workbenchClient, {
    resolveSessionId: async (chatId) => chatId,
    resolveProvider: () => ({ id: "deepseek", model: "deepseek-v4-flash" }),
    ensureSession: async ({ chatId, sessionId, message }) => {
      ensured = { chatId, sessionId, model: message.metadata?.modelId };
      return "session-materialized";
    },
  });
  const message = createDesktopUIMessage({ id: "draft-user-1", role: "user", conversationId: "draft-chat-1", content: "首轮消息", providerId: "deepseek", modelId: "deepseek-v4-flash" });
  await transport.sendMessages({ trigger: "submit-message", chatId: "draft-chat-1", messageId: undefined, messages: [message], abortSignal: undefined });
  assert.deepEqual(ensured, { chatId: "draft-chat-1", sessionId: "draft-chat-1", model: "deepseek-v4-flash" });
  assert.deepEqual(calls, ["create_run", "append_message", "host_start", "host_send"]);
});

test("desktop ChatTransport restores bounded history before prompting a recreated OpenCode session", async () => {
  let sentPrompt = "";
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) {
      if (command === "host_send") sentPrompt = String(((args?.message as { payload?: { prompt?: unknown } }).payload?.prompt) ?? "");
      return undefined as T;
    },
    async listen() { return () => undefined; },
  };
  const workbenchClient = { runs: { subscribe: () => () => undefined } } as never;
  const transport = createDesktopChatTransport(bridge, workbenchClient, {
    resolveSessionId: async () => "lost-session",
    resolveProvider: () => ({ id: "deepseek", model: "deepseek-v4-flash" }),
    ensureSession: async () => ({ sessionId: "replacement-session", recoveryContext: "Previous conversation:\nUser: 旧问题\nAssistant: 旧回答" }),
    resolvePrompt: (_message, prompt) => `skill:${prompt}`,
  });
  const message = createDesktopUIMessage({ id: "recovered-user-1", role: "user", conversationId: "recovered-chat-1", content: "继续" });
  await transport.sendMessages({ trigger: "submit-message", chatId: "recovered-chat-1", messageId: undefined, messages: [message], abortSignal: undefined });
  assert.equal(sentPrompt, "Previous conversation:\nUser: 旧问题\nAssistant: 旧回答\n\nCurrent request: skill:继续");
});

test("desktop ChatTransport keeps the user prompt intact without sending legacy Skill system context", async () => {
  let sentPrompt = "";
  let sentSystemPrompt: unknown;
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) {
      if (command === "host_send") {
        const payload = (args?.message as { payload?: { prompt?: unknown; systemPrompt?: unknown } }).payload;
        sentPrompt = String(payload?.prompt ?? "");
        sentSystemPrompt = payload?.systemPrompt;
      }
      return undefined as T;
    },
    async listen() { return () => undefined; },
  };
  const workbenchClient = { runs: { subscribe: () => () => undefined } } as never;
  const transport = createDesktopChatTransport(bridge, workbenchClient, {
    resolveSessionId: async () => "session-skill",
    resolveProvider: () => ({ id: "deepseek", model: "deepseek-v4-flash" }),
    resolvePrompt: (_message, prompt) => prompt,
    resolveSystemPrompt: () => "Use the native skill tool to load writer-orchestrator.",
  });
  const message = createDesktopUIMessage({ id: "skill-user-1", role: "user", conversationId: "skill-c1", content: "写一段文案" });
  await transport.sendMessages({ trigger: "submit-message", chatId: "skill-c1", messageId: undefined, messages: [message], abortSignal: undefined });
  assert.equal(sentPrompt, "写一段文案");
  assert.equal(sentSystemPrompt, undefined);
});

test("workflow AI transport sends the selected configured text Provider and model", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) { calls.push({ command, args }); return undefined as T; },
    async listen() { return () => undefined; },
  };
  const fallback = { id: "text-basic", source: "openai-compatible", baseUrl: "https://basic.test/v1", apiKey: "secret-basic", model: "basic", models: ["basic"], capabilities: ["text"] as const };
  const providers = [fallback, { id: "text-paid", source: "openai-compatible", baseUrl: "https://paid.test/v1", apiKey: "secret-paid", model: "premium", models: ["premium"], capabilities: ["text"] as const }];
  const workbenchClient = { runs: { subscribe: () => () => undefined } } as never;
  const transport = createDesktopChatTransport(bridge, workbenchClient, {
    resolveSessionId: async (chatId) => chatId,
    resolveProvider: (message) => resolveWorkflowAiTextProvider(providers, message.metadata?.providerId, message.metadata?.modelId, fallback),
    resolveSkillId: () => "workflow-authoring",
    resolveAgentId: () => "workflow-ai",
    resolveConversationAgentId: () => "workflow-ai",
    resolveAllowArtifacts: () => false,
  });
  const message = createDesktopUIMessage({ id: "workflow-ai-user-1", role: "user", conversationId: "workflow-ai:w1", content: "Plan this workflow", providerId: "text-paid", modelId: "premium" });
  await transport.sendMessages({ trigger: "submit-message", chatId: "workflow-ai:w1", messageId: undefined, messages: [message], abortSignal: undefined });
  const sent = calls.find((call) => call.command === "host_send")?.args?.message as { type?: string; payload?: { provider?: { id?: string; apiKey?: string }; model?: string; skillId?: string; agentId?: string } } | undefined;
  assert.equal(sent?.type, "session.prompt");
  assert.equal(sent?.payload?.provider?.id, "text-paid");
  assert.equal(sent?.payload?.provider?.apiKey, "secret-paid");
  assert.equal(sent?.payload?.model, "premium");
  assert.equal(sent?.payload?.skillId, "workflow-authoring");
  assert.equal(sent?.payload?.agentId, "workflow-ai");
});

test("desktop WorkbenchClient streams text, tool, usage, cancellation and terminal events", async () => {
  let listener: ((payload: { raw: string }) => void) | undefined;
  const bridge = {
    async invoke<T>() { return undefined as T; },
    async listen<T>(_event: string, callback: (payload: T) => void) {
      listener = callback as unknown as (payload: { raw: string }) => void;
      return () => { listener = undefined; };
    },
  };
  const client = createDesktopWorkbenchClient(bridge, { go: () => undefined, replace: () => undefined, current: () => "/dashboard/ai" });
  const events: Array<Record<string, unknown>> = [];
  const dispose = client.runs.subscribe("run-stream", (event) => events.push(event as unknown as Record<string, unknown>));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(listener);
  const emit = (event: Record<string, unknown>) => {
    const body = JSON.stringify({ version: 1, requestId: "request-1", ok: true, data: { event: { runId: "run-stream", ...event } } });
    listener?.({ raw: `${Buffer.byteLength(body, "utf8")}:${body}` });
  };
  listener?.({ raw: "not-a-frame" });
  emit({ event: "text_delta", delta: "hello", sequence: 1, createdAt: "2026-08-12T00:00:01Z" });
  emit({ event: "reasoning_delta", delta: "planning", sequence: 2, createdAt: "2026-08-12T00:00:02Z" });
  emit({ event: "tool_event", tool: "writer", phase: "completed", message: "finished", sequence: 3, createdAt: "2026-08-12T00:00:03Z" });
  emit({ event: "artifact", artifact: { id: "a1", relativePath: "artifacts/report.md", title: "报告", mimeType: "text/markdown", byteLength: 12, sha256: "hash-a" }, sequence: 4, createdAt: "2026-08-12T00:00:04Z" });
  emit({ event: "preview", preview: { kind: "ppt", title: "Deck preview", url: "http://127.0.0.1:5200/", previewSessionId: "dashi-ppt:1", engine: "dashi-ppt", status: "ready" }, sequence: 5, createdAt: "2026-08-12T00:00:05Z" });
  emit({ event: "usage", provider: "fixture", model: "fixture/model", inputTokens: 3, outputTokens: 5, costUsd: 0.02, sequence: 6, createdAt: "2026-08-12T00:00:06Z" });
  emit({ event: "runtime_error", code: "workflow_cancelled", sequence: 7, createdAt: "2026-08-12T00:00:07Z" });
  emit({ event: "done", sequence: 8, createdAt: "2026-08-12T00:00:08Z" });
  assert.deepEqual(events, [
    { type: "text", delta: "hello", sequence: 1, createdAt: "2026-08-12T00:00:01Z" },
    { type: "reasoning", delta: "planning", sequence: 2, createdAt: "2026-08-12T00:00:02Z" },
    { type: "tool_call", toolName: "writer", toolCallId: "writer:3", phase: "completed", input: undefined, output: undefined, error: undefined, sequence: 3, createdAt: "2026-08-12T00:00:03Z" },
    { type: "artifact", artifact: { id: "a1", relativePath: "artifacts/report.md", title: "报告", mimeType: "text/markdown", byteLength: 12, sha256: "hash-a" }, sequence: 4, createdAt: "2026-08-12T00:00:04Z" },
    { type: "preview", preview: { kind: "ppt", title: "Deck preview", url: "http://127.0.0.1:5200/", previewSessionId: "dashi-ppt:1", engine: "dashi-ppt", status: "ready" }, sequence: 5, createdAt: "2026-08-12T00:00:05Z" },
    { type: "usage", usage: { runId: "run-stream", usageId: undefined, provider: "fixture", model: "fixture/model", inputTokens: 3, outputTokens: 5, cachedInputTokens: undefined, reasoningTokens: undefined, providerCost: 0.02, aggregation: "delta", scope: "step" }, sequence: 6, createdAt: "2026-08-12T00:00:06Z" },
    { type: "status", status: "cancelled", sequence: 7, createdAt: "2026-08-12T00:00:07Z" },
    { type: "status", status: "succeeded", sequence: 8, createdAt: "2026-08-12T00:00:08Z" },
  ]);
  dispose();
  assert.equal(listener, undefined);
});

test("desktop WorkbenchClient routes Obsidian index and search through host RPC", async () => {
  let listener: ((payload: { raw: string }) => void) | undefined;
  const calls: string[] = [];
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) {
      calls.push(command);
      if (command === "host_send") {
        const message = args?.message as { requestId: string; type: string };
        const data = message.type === "knowledge.index"
          ? { generation: 2, documents: 3, chunks: 8, indexPath: "vault/.index", semantic: true, embeddingModel: "local-hash-384-v1", embeddingDimension: 384, watcher: "active" }
          : { indexPath: "vault/.index", query: "增长", results: [{ chunkId: "chunk-1", documentPath: "CoworkAny/增长.md", heading: "指标", excerpt: "转化率", score: 0.9, lineStart: 4, lineEnd: 5 }] };
        const body = JSON.stringify({ version: 1, requestId: message.requestId, ok: true, data });
        queueMicrotask(() => listener?.({ raw: `${Buffer.byteLength(body, "utf8")}:${body}` }));
      }
      return undefined as T;
    },
    async listen<T>(_event: string, callback: (payload: T) => void) {
      listener = callback as unknown as (payload: { raw: string }) => void;
      return () => { listener = undefined; };
    },
  };
  const client = createDesktopWorkbenchClient(bridge, { go: () => undefined, replace: () => undefined, current: () => "/dashboard/knowledge-base" });
  const index = await client.knowledge.index({ vaultPath: "vault", indexPath: "vault/.index", embedding: { mode: "local", model: "local-hash-384-v1" } });
  assert.equal(index.documents, 3);
  const results = await client.knowledge.search({ indexPath: "vault/.index", query: "增长", limit: 8, embedding: { mode: "local", model: "local-hash-384-v1" } });
  assert.equal(results[0]?.documentPath, "CoworkAny/增长.md");
  assert.deepEqual(calls, ["host_start", "host_send", "host_start", "host_send"]);
  assert.equal(listener, undefined);
});

test("desktop long-running host RPCs do not impose a fixed response timeout", () => {
  const source = readFileSync(resolve(process.cwd(), "src/workbench-client.ts"), "utf8");
  assert.doesNotMatch(source, /workflow_host_response_timeout/u);
  assert.doesNotMatch(source, /setTimeout\([\s\S]{0,180}60_000/u);
});
