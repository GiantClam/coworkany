import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopUIMessage, type DesktopUIMessage, type WorkbenchClient, type WorkbenchRunEvent } from "@coworkany/workbench-client";
import { createDesktopWorkflowAiChatTransport } from "../src/workbench-client";

test("workflow AI transport uses the direct provider command and never creates an OpenCode session", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  let emit: ((event: WorkbenchRunEvent) => void) | undefined;
  const bridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args });
      return undefined as T;
    },
    async listen() { return () => undefined; },
  };
  const client = {
    runs: {
      subscribe(_runId: string, onEvent: (event: WorkbenchRunEvent) => void) { emit = onEvent; return () => undefined; },
      async cancel() { return undefined; },
    },
  } as unknown as WorkbenchClient;
  const transport = createDesktopWorkflowAiChatTransport(bridge, client, {
    resolveProvider: () => ({ id: "text", source: "openai-compatible", model: "model-a", baseUrl: "https://provider.test/v1", apiKey: "secret" }),
    resolvePrompt: (_message, text) => `restricted:${text}`,
  });
  const message: DesktopUIMessage = createDesktopUIMessage({
    id: "message-1",
    role: "user",
    conversationId: "workflow-ai:workflow-1",
    content: "Arrange the nodes",
    providerId: "text",
    modelId: "model-a",
  });

  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: "workflow-ai:workflow-1",
    messageId: message.id,
    messages: [message],
    abortSignal: undefined,
  });
  assert.ok(emit);
  emit!({ type: "text", delta: "{\"message\":\"Done\"}" });
  emit!({ type: "status", status: "succeeded" });
  const reader = stream.getReader();
  while (!(await reader.read()).done) { /* drain */ }

  const hostSend = calls.find((call) => call.command === "host_send");
  assert.equal((hostSend?.args?.message as { type?: string })?.type, "workflow.ai");
  assert.equal(((hostSend?.args?.message as { payload?: { prompt?: string } })?.payload?.prompt), "restricted:Arrange the nodes");
  assert.equal(calls.some((call) => (call.args?.message as { type?: string } | undefined)?.type === "session.prompt"), false);
  assert.equal(calls.some((call) => call.command === "create_conversation"), true);
  assert.equal(calls.filter((call) => call.command === "append_message").length, 2);
});
