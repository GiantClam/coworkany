import type { AgentRuntimeEvent, AgentRuntimeInput, OpenCodeProviderConfig } from "../../../../lib/ai-runtime/contracts"
import type { OpenCodeRuntimeEvent } from "../../../../packages/runtime-contracts/src/opencode"
import { providerRuntimeKey } from "./opencode-provider"
import { buildOpenCodeModelConfig, DEEPSEEK_V4_FLASH_MAX_VARIANT, isDeepSeekV4Flash } from "./deepseek-model-config"

type SandboxExecApi = {
  writeFile(path: string, content: string): Promise<unknown>
  exec(command: string, options?: Record<string, unknown>): Promise<{ success?: boolean; exitCode?: number | null; stdout?: string; stderr?: string }>
}

export const DEFAULT_OPENCODE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

class AsyncEventQueue<T> {
  private values: T[] = []
  private waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T) {
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  close() {
    this.closed = true
    while (this.waiters.length) this.waiters.shift()!({ value: undefined as never, done: true })
  }

  next(): Promise<IteratorResult<T>> {
    if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false })
    if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  [Symbol.asyncIterator]() {
    return this
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error && error.message.includes("timeout") ? "OpenCode command timed out." : "OpenCode command failed."
}

function stripControlChars(value: string) {
  return [...value].map((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? " " : character
  }).join("")
}

function diagnosticErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return stripControlChars(message).slice(0, 1024)
}

/**
 * The CLI parser shares its event union with the richer `serve` transport.
 * This runner has a narrower public contract: artifacts are collected from
 * the sandbox after the process exits, and it has no interactive approval or
 * question channel. Keep that boundary explicit instead of using a cast that
 * could accidentally expose an event the coordinator cannot handle.
 */
export function normalizeOpenCodeRuntimeEvent(event: OpenCodeRuntimeEvent): AgentRuntimeEvent {
  switch (event.event) {
    case "text_delta":
      return { event: "text_delta", delta: event.delta, runId: event.runId }
    case "reasoning_delta":
      return { event: "reasoning_delta", delta: event.delta, runId: event.runId }
    case "tool_event":
      return {
        event: "tool_event",
        tool: event.tool,
        ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
        phase: event.phase,
        ...(event.message ? { message: event.message } : {}),
        ...(event.paths?.length ? { paths: event.paths } : {}),
        runId: event.runId,
      }
    case "usage":
      return {
        event: "usage",
        ...(event.usageId ? { usageId: event.usageId } : {}),
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.model ? { model: event.model } : {}),
        ...(event.inputTokens === undefined ? {} : { inputTokens: event.inputTokens }),
        ...(event.outputTokens === undefined ? {} : { outputTokens: event.outputTokens }),
        ...(event.cachedInputTokens === undefined ? {} : { cachedInputTokens: event.cachedInputTokens }),
        ...(event.reasoningTokens === undefined ? {} : { reasoningTokens: event.reasoningTokens }),
        ...(event.costUsd === undefined ? {} : { costUsd: event.costUsd }),
        ...(event.aggregation ? { aggregation: event.aggregation } : {}),
        ...(event.scope ? { scope: event.scope } : {}),
        runId: event.runId,
      }
    case "runtime_warning":
      return { event: "runtime_warning", code: event.code, message: event.message, runId: event.runId }
    case "runtime_error":
      return { event: "runtime_error", code: event.code, message: event.message, retryable: event.retryable, runId: event.runId }
    case "done":
      return { event: "done", runId: event.runId }
    case "artifact":
      return {
        event: "runtime_warning",
        code: "artifact_event_deferred_to_collector",
        message: "OpenCode reported an artifact; the runner will use its sandbox artifact collector.",
        runId: event.runId,
      }
    case "preview":
      return {
        event: "runtime_warning",
        code: "preview_event_not_supported_by_runner",
        message: "OpenCode reported a preview, but this runner exposes previews through the artifact workflow.",
        runId: event.runId,
      }
    case "permission_request":
    case "permission_response":
    case "question_request":
    case "question_response":
      return {
        event: "runtime_error",
        code: "interactive_event_not_supported",
        message: "OpenCode requested an interactive response, but this runner has no interactive channel.",
        retryable: false,
        runId: event.runId,
      }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export type OpenCodeExecutionOptions = {
  workingDir?: string
  promptPath?: string
  homeDir?: string
  sessionId?: string | null
  continueSession?: boolean
  agent?: string
  skipPermissions?: boolean
  maxOutputBytes?: number
}

export async function* runOpenCode(
  sandbox: SandboxExecApi,
  runDir: string,
  input: AgentRuntimeInput,
  signal?: AbortSignal,
  timeoutMs = 180_000,
  provider?: OpenCodeProviderConfig,
  execution: OpenCodeExecutionOptions = {},
): AsyncGenerator<AgentRuntimeEvent> {
  if (!provider) throw new Error("opencode_provider_required")
  const protocolModule = await import("../../../../lib/ai-runtime/opencode-protocol")
  const protocolRuntime = (protocolModule as unknown as { default?: typeof protocolModule }).default || protocolModule
  const parser = protocolRuntime.createOpenCodeEventParser(input.runId)
  const queue = new AsyncEventQueue<AgentRuntimeEvent>()
  let stdoutBytes = 0
  let fatalOutput = false
  let stderrText = ""
  const maxOutputBytes = execution.maxOutputBytes || DEFAULT_OPENCODE_MAX_OUTPUT_BYTES
  const command = protocolRuntime.buildOpenCodeCommand({ modelHint: input.modelHint || `${provider.providerId}/${provider.modelId}` })
  const workingDir = execution.workingDir || runDir
  const promptPath = execution.promptPath || `${runDir}/prompt.md`
  const commandArgs = [
    ...command.args,
    ...(execution.sessionId ? ["--session", execution.sessionId] : []),
    ...(execution.continueSession ? ["--continue"] : []),
    ...(isDeepSeekV4Flash(provider)
      ? ["--variant", input.reasoningEffort === "none" ? "none" : input.reasoningEffort === "low" || input.reasoningEffort === "high" || input.reasoningEffort === "max" ? input.reasoningEffort : DEEPSEEK_V4_FLASH_MAX_VARIANT]
      : []),
    "--dir",
    workingDir,
    ...(execution.agent ? ["--agent", execution.agent] : []),
    ...(execution.skipPermissions ? ["--dangerously-skip-permissions"] : []),
  ]
  const scriptPath = `${runDir}/run-opencode.sh`
  const commandLine = `sh ${shellQuote(scriptPath)}`
  // `opencode run` only enters a non-interactive turn when the message is a
  // positional argument. Feeding prompt.md through stdin leaves the CLI
  // waiting for an interactive message indefinitely.
  const isDashiPresentation = input.agentId === "executive-presentation-ppt"
  const dashiMarker = isDashiPresentation ? `${runDir}/.dashi-artifact-start` : null
  const script = `#!/bin/sh\n${dashiMarker ? `touch ${shellQuote(dashiMarker)}\n` : ""}exec ${[command.command, ...commandArgs.map(shellQuote)].join(" ")} "$(cat -- ${shellQuote(promptPath)})"\n`
  const dashiPermissions = isDashiPresentation
    ? {
        read: "allow",
        edit: "allow",
        bash: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        websearch: input.policy.allowNetwork ? "allow" : "deny",
        webfetch: input.policy.allowNetwork ? "allow" : "deny",
        task: "allow",
        skill: "allow",
        question: "deny",
        todowrite: "allow",
        lsp: "allow",
        doom_loop: "allow",
        external_directory: "allow",
        delete: "deny",
      }
    : {
        read: "allow",
        edit: "allow",
        bash: "allow",
        websearch: "deny",
        webfetch: "deny",
        task: "deny",
        skill: "deny",
        external_directory: "deny",
      }
  const commandEnv = {
    HOME: execution.homeDir || `${runDir}/tmp/home`,
    TMPDIR: execution.homeDir ? `${execution.homeDir}/tmp` : `${runDir}/tmp`,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_ENABLE_EXA: input.agentId === "executive-presentation-ppt" && input.policy.allowNetwork ? "true" : "false",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      compaction: {
        auto: true,
        keep: { tokens: 8_000 },
        buffer: 20_000,
      },
      ...(isDashiPresentation
        ? {
            default_agent: "build",
            agent: {
              build: {
                mode: "primary",
                prompt: `{file:./turns/${input.runId}/system.md}`,
              },
            },
            tools: { bash: true, read: true, write: true, edit: true, glob: true, grep: true, list: true, skill: true, question: false, todowrite: true, lsp: true, doom_loop: true, websearch: input.policy.allowNetwork, webfetch: input.policy.allowNetwork },
          }
        : {}),
      permission: dashiPermissions,
      provider: (() => {
        const runtime = providerRuntimeKey(provider.providerId)
        return {
          [runtime.configKey]: {
            npm: "@ai-sdk/openai-compatible",
            name: runtime.configKey,
            options: { baseURL: provider.baseUrl, apiKey: `{env:${runtime.envKey}}` },
            models: { [provider.modelId]: buildOpenCodeModelConfig(provider) },
          },
        }
      })(),
    }),
    [providerRuntimeKey(provider.providerId).envKey]: provider.apiKey,
  }

  const abortListener = signal
    ? () => {
        void sandbox.exec(`pkill -TERM -f ${shellQuote(scriptPath)}`, { cwd: workingDir }).catch(() => undefined)
      }
    : null
  signal?.addEventListener("abort", abortListener!, { once: true })

  void (async () => {
    try {
      await sandbox.writeFile(scriptPath, script)
      console.log(JSON.stringify({ event: "opencode_start", runId: input.runId, model: input.modelHint || null }))
      const result = await sandbox.exec(commandLine, {
        cwd: workingDir,
        timeout: timeoutMs,
        stream: true,
        env: commandEnv,
        onOutput(stream: "stdout" | "stderr", data: string) {
          if (stream !== "stdout") {
            stderrText = stripControlChars(`${stderrText}${data}`).slice(0, 1024)
            return
          }
          if (fatalOutput) return
          stdoutBytes += new TextEncoder().encode(data).byteLength
          if (stdoutBytes > maxOutputBytes) {
            fatalOutput = true
            queue.push({ event: "runtime_error", code: "stdout_limit_exceeded", message: "OpenCode output limit exceeded.", retryable: true, runId: input.runId })
            return
          }
          for (const event of parser.push(data)) {
            const normalized = normalizeOpenCodeRuntimeEvent(event)
            if (normalized.event === "runtime_error" && normalized.code === "fatal_parse_error") fatalOutput = true
            queue.push(normalized)
          }
        },
      })
      console.log(JSON.stringify({ event: "opencode_complete", runId: input.runId, success: result.success, exitCode: result.exitCode, stdoutBytes, stderrBytes: new TextEncoder().encode(stderrText).byteLength }))
      if (!fatalOutput) {
        for (const event of parser.finish()) queue.push(normalizeOpenCodeRuntimeEvent(event))
        if (result.success === false || (typeof result.exitCode === "number" && result.exitCode !== 0)) {
          console.log(JSON.stringify({ event: "opencode_exit", runId: input.runId, success: result.success, exitCode: result.exitCode }))
          const detail = stderrText.trim().slice(-768)
          queue.push({ event: "runtime_error", code: "opencode_exit_nonzero", message: detail ? `OpenCode command failed: ${detail}` : "OpenCode command failed.", retryable: true, runId: input.runId })
        }
      }
    } catch (error) {
      const detail = stderrText.trim().slice(-768)
      const exceptionDetail = diagnosticErrorMessage(error)
      console.log(JSON.stringify({ event: "opencode_exception", runId: input.runId, message: exceptionDetail, stderr: detail, safeMessage: safeErrorMessage(error) }))
      if (!fatalOutput) {
        const messageDetail = detail || exceptionDetail
        queue.push({ event: "runtime_error", code: "opencode_command_failed", message: messageDetail ? `${safeErrorMessage(error)}: ${messageDetail}` : safeErrorMessage(error), retryable: true, runId: input.runId })
      }
    } finally {
      if (abortListener) signal?.removeEventListener("abort", abortListener)
      queue.close()
    }
  })()

  for await (const event of queue) yield event
}
