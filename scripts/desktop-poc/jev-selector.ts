import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { digestValue, redactValue } from "./canonical";
import { validateSelectorResponse, type ScenarioStep, type SelectorResponse } from "./contracts";
import { writeJsonEvidence } from "./evidence";

export type JevCommandResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type JevCommandRunner = (command: string, args: readonly string[], input: string, timeoutMs: number, environment: NodeJS.ProcessEnv) => Promise<JevCommandResult>;

export type JevSelectorInput = {
  readonly snapshot: unknown;
  readonly step: ScenarioStep;
  readonly evidenceRoot?: string;
  readonly attempt?: number;
};

export type JevSelectorResult = {
  readonly response: SelectorResponse;
  readonly evidencePath?: string;
  readonly model?: string;
  readonly usage?: unknown;
};

export class JevSelectorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JevSelectorError";
    this.code = code;
  }
}
const MAX_SNAPSHOT_NODES = 320;
const MAX_SNAPSHOT_DEPTH = 20;
const MAX_SNAPSHOT_CHARS = 48_000;

// These IDs are the stable bridge between the scenario's logical PoC targets
// and the native IDs exposed by agent-desktop. Keep this mapping explicit in
// the Jev request so a model does not have to infer it from a React DOM id.
const POC_NATIVE_IDS: Readonly<Record<string, string>> = {
  "workflow-directory": "poc-workflow-directory",
  "create-workflow": "poc-workflow-create",
  "workflow-builder": "poc-workflow-builder",
  "back-to-workflows": "poc-workflow-back",
  "save-workflow": "poc-workflow-save",
  "workflow-title": "poc-workflow-title",
  "workflow-description": "poc-workflow-description",
  "workflow-status": "poc-workflow-status",
  "workflow-definition-hash": "poc-workflow-definition-hash",
  "workflow-panel-open": "poc-workflow-panel-open",
  "confirm-delete": "poc-workflow-confirm-delete",
};

const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  textbox: ["textbox", "textfield"],
  textfield: ["textfield", "textbox"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectedNativeId(target: ScenarioStep["target"]): string | undefined {
  if (!target) return undefined;
  return target.nativeId ?? (target.pocId ? POC_NATIVE_IDS[target.pocId] : undefined);
}

function roleMatches(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "string") return true;
  if (typeof actual !== "string") return false;
  return (ROLE_ALIASES[expected] ?? [expected]).includes(actual);
}

function candidateName(candidate: Record<string, unknown>): string {
  return typeof candidate.name === "string" ? candidate.name : typeof candidate.description === "string" ? candidate.description : "";
}

function targetNameMatchesCandidate(candidate: Record<string, unknown>, target: ScenarioStep["target"]): boolean {
  if (!target?.name) return true;
  const expected = target.name.trim().toLocaleLowerCase();
  const actual = candidateName(candidate).trim().toLocaleLowerCase();
  if (actual === expected) return true;
  // Directory cards expose action labels such as “打开工作流 <title>”, while
  // the scenario intentionally keeps the target name as the stable title.
  // Treat that bounded, role-checked composition as an exact semantic match;
  // ambiguity is still rejected by the match-count gate below.
  if ((target.pocId === "open-workflow" || target.pocId === "delete-workflow") && candidate.role === "button") {
    const prefix = target.pocId === "open-workflow" ? "打开工作流" : "删除工作流";
    return actual.startsWith(`${prefix.toLocaleLowerCase()} `) && actual.endsWith(expected);
  }
  return false;
}

function targetMatchesCandidate(candidate: Record<string, unknown>, target: ScenarioStep["target"]): boolean {
  if (!target) return false;
  const nativeId = expectedNativeId(target);
  if (nativeId && candidate.nativeId !== nativeId) return false;
  if (!roleMatches(candidate.role, target.role)) return false;
  if (!targetNameMatchesCandidate(candidate, target)) return false;
  return Boolean(nativeId || target.role || target.name);
}

function actionCapabilities(action: ScenarioStep["action"]): readonly string[] {
  if (action === "click") return ["Click"];
  if (action === "type") return ["SetValue", "TypeText"];
  // agent-desktop's native combobox exposes Expand/Collapse; the adapter then
  // performs the bounded value selection in code. There is no AX action named
  // Select, so do not advertise a capability the snapshot cannot provide.
  if (action === "select") return ["Expand", "Collapse"];
  return [];
}

function candidateHasCapability(candidate: Record<string, unknown>, capability: string): boolean {
  return Array.isArray(candidate.availableActions) && candidate.availableActions.includes(capability);
}

function compactSnapshot(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (budget.nodes >= MAX_SNAPSHOT_NODES) return "[SNAPSHOT_TRUNCATED]";
  if (depth > MAX_SNAPSHOT_DEPTH) return "[DEPTH_TRUNCATED]";
  if (Array.isArray(value)) {
    budget.nodes += 1;
    return value.slice(0, MAX_SNAPSHOT_NODES).map((item) => compactSnapshot(item, depth + 1, budget));
  }
  if (!isRecord(value)) return typeof value === "string" ? value.slice(0, 512) : value;
  budget.nodes += 1;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    // Values and text fields can contain user content. Jev only needs the
    // semantic identity of controls to decide whether a bounded action is
    // safe, so do not send editable values or arbitrary text blobs.
    if (["value", "text", "inner_text", "html", "url", "path"].includes(key.toLocaleLowerCase())) continue;
    if (!["role", "name", "description", "native_id", "available_actions", "states", "children", "tree", "windows", "id", "window_id", "title"].includes(key) && depth > 1) continue;
    result[key] = compactSnapshot(child, depth + 1, budget);
  }
  return redactValue(result);
}

function semanticCandidates(value: unknown, result: Array<Record<string, unknown>> = [], depth = 0): Array<Record<string, unknown>> {
  if (result.length >= 160 || depth > MAX_SNAPSHOT_DEPTH) return result;
  if (Array.isArray(value)) {
    for (const child of value) semanticCandidates(child, result, depth + 1);
    return result;
  }
  if (!isRecord(value)) return result;
  const nativeId = isRecord(value.native_id) && typeof value.native_id.value === "string" ? value.native_id.value : undefined;
  if (typeof value.role === "string" || typeof value.name === "string" || nativeId) {
    result.push(redactValue({
      ...(typeof value.role === "string" ? { role: value.role } : {}),
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      ...(nativeId ? { nativeId } : {}),
      ...(Array.isArray(value.available_actions) ? { availableActions: value.available_actions } : {}),
    }) as Record<string, unknown>);
  }
  for (const key of ["children", "tree", "windows"]) if (key in value) semanticCandidates(value[key], result, depth + 1);
  return result;
}

export function buildJevSelectorRequest({ snapshot, step }: Pick<JevSelectorInput, "snapshot" | "step">) {
  const requestedValue = typeof step.value === "string"
    ? { length: step.value.length, sha256: digestValue(step.value) }
    : null;
  const candidates = semanticCandidates(snapshot);
  const target = step.target ? redactValue({
    ...step.target,
    name: step.target.name,
    ...(expectedNativeId(step.target) ? { nativeId: expectedNativeId(step.target) } : {}),
    ...(step.target.role && ROLE_ALIASES[step.target.role] ? { roleAliases: ROLE_ALIASES[step.target.role] } : {}),
  }) : null;
  const matchingCandidates = step.target
    ? candidates.filter((candidate) => targetMatchesCandidate(candidate, step.target))
    : [];
  const capabilities = actionCapabilities(step.action);
  return {
    state: {
      product: "CoworkAny Tauri desktop",
      task: "Run one bounded accessibility-tree action in the workflow persistence PoC.",
      step: {
        id: step.stepId,
        action: step.action,
        description: step.description ?? "",
        target,
        requestedValue,
      },
      // This is a structural hint derived locally from the same accessibility
      // snapshot. It is not an authorization decision: Jev still must return
      // execute, and the runner resolves the exact live target afterwards.
      targetResolution: {
        status: matchingCandidates.length === 1 ? "exact" : matchingCandidates.length === 0 ? "missing" : "ambiguous",
        matchCount: matchingCandidates.length,
        matches: matchingCandidates.slice(0, 4),
        requestedAction: step.action,
        requiredCapabilities: capabilities,
        capabilityMatch: matchingCandidates.length === 1
          ? capabilities.every((capability) => candidateHasCapability(matchingCandidates[0]!, capability))
          : false,
      },
      semanticCandidates: candidates,
      accessibilitySnapshot: compactSnapshot(snapshot),
      policy: [
        "Choose execute only when the requested semantic target is present and unambiguous in the snapshot.",
        "Choose need_observation when the target is absent, ambiguous, stale, or the snapshot is insufficient.",
        "Use targetResolution as the direct structural check: an exact match with capabilityMatch=true is sufficient evidence for execute.",
        "The requested textbox role is intentionally compatible with the native AX textfield role; do not treat that alias as ambiguity.",
        "For open-workflow and delete-workflow, the requested title may appear as the suffix of the exact localized button label; treat only one matching button as exact.",
        "For type actions, the value is intentionally omitted from the snapshot; length and digest prove the request without exposing user content.",
        "For select actions, Expand and Collapse are the required native capabilities; the runner applies the requested option through its bounded select operation.",
        "The runner will independently resolve the exact requested target after this gate; do not reject a target merely because transient ref IDs are not included.",
        "Never invent coordinates, selectors, shell commands, or a different target.",
      ],
    },
    questions: {
      decision: {
        type: "choice",
        instructions: "Should the runner execute the exact requested bounded action now, or take another accessibility observation first?",
        criteria: {
          execute: "Return execute when targetResolution.status is exact and targetResolution.capabilityMatch is true; the runner will perform the already-specified bounded action.",
          need_observation: "The target is missing, ambiguous, stale, or the snapshot does not prove that the requested action is safe.",
        },
      },
    },
  };
}

function parseJsonEnvelope(stdout: string): Record<string, unknown> {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Jev promises one JSON line on stdout, but ignore stray diagnostics so
      // a wrapper can still be used without weakening the response contract.
    }
  }
  throw new JevSelectorError("jev_invalid_response", "jev returned no JSON response");
}

function choiceFromEnvelope(envelope: Record<string, unknown>): string {
  const answers = isRecord(envelope.answers) ? envelope.answers : undefined;
  const decision = answers && isRecord(answers.decision) ? answers.decision : undefined;
  const choice = decision?.choice;
  if (typeof choice !== "string") throw new JevSelectorError("jev_invalid_choice", "jev response did not contain answers.decision.choice");
  return choice;
}

function defaultRunCommand(command: string, args: readonly string[], input: string, timeoutMs: number, environment: NodeJS.ProcessEnv): Promise<JevCommandResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, [...args], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      settled = true;
      rejectResult(new JevSelectorError("jev_timeout", `jev did not respond within ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer | string) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk: Buffer | string) => { stderr += String(chunk); });
    child.once("error", (error) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      rejectResult(new JevSelectorError("jev_unavailable", `could not start jev: ${error.message}`));
    });
    child.once("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export function jevCredentialPath(home = homedir()): string {
  return join(home, "model-clis", "jev", "credentials.json");
}

export function jevCredentialsAvailable(environment: NodeJS.ProcessEnv = process.env, home = homedir(), exists = existsSync): boolean {
  return Boolean(environment.JEV_API_KEY?.trim()) || exists(jevCredentialPath(home));
}

export type JevSelectorOptions = {
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runCommand?: JevCommandRunner;
  readonly requireCredentials?: boolean;
};

export class JevSelector {
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly runCommand: JevCommandRunner;
  private readonly requireCredentials: boolean;

  constructor(options: JevSelectorOptions = {}) {
    this.command = options.command ?? "jev";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.environment = options.environment ?? process.env;
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.requireCredentials = options.requireCredentials ?? true;
  }

  assertConfigured() {
    if (this.requireCredentials && !jevCredentialsAvailable(this.environment)) {
      throw new JevSelectorError("jev_credentials_missing", "Jev API credentials are required; set JEV_API_KEY or run `jev login`.");
    }
  }

  async select(input: JevSelectorInput): Promise<JevSelectorResult> {
    this.assertConfigured();
    const request = buildJevSelectorRequest(input);
    let commandResult: JevCommandResult;
    try {
      commandResult = await this.runCommand(this.command, ["ask", "-"], `${JSON.stringify(request)}\n`, this.timeoutMs, this.environment);
    } catch (error) {
      if (error instanceof JevSelectorError) throw error;
      throw new JevSelectorError("jev_request_failed", error instanceof Error ? error.message : String(error));
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = parseJsonEnvelope(commandResult.stdout);
    } catch (error) {
      const detail = commandResult.stderr.trim().slice(0, 300);
      throw new JevSelectorError("jev_invalid_response", `${error instanceof Error ? error.message : String(error)}${detail ? `: ${detail}` : ""}`);
    }
    if (commandResult.code !== 0 || envelope.ok === false) {
      const detail = commandResult.stderr.trim().slice(0, 300);
      throw new JevSelectorError("jev_api_failed", `jev API request failed${detail ? `: ${detail}` : ` (exit ${commandResult.code})`}`);
    }
    const choice = choiceFromEnvelope(envelope);
    const actionForContract = Object.fromEntries(Object.entries(input.step).filter(([, value]) => value !== undefined)) as ScenarioStep;
    const response: SelectorResponse = choice === "execute"
      ? validateSelectorResponse({ decision: "action", action: actionForContract })
      : choice === "need_observation"
        ? validateSelectorResponse({ decision: "need_observation", reason: "Jev requested a fresh accessibility observation before acting." })
        : (() => { throw new JevSelectorError("jev_invalid_choice", `jev returned unsupported decision: ${choice}`); })();
    let evidencePath: string | undefined;
    if (input.evidenceRoot) {
      const evidenceDecision = response.decision === "action"
        ? { ...response, action: { ...response.action, ...(response.action.value !== undefined ? { value: "[REDACTED]" } : {}) } }
        : response;
      evidencePath = await writeJsonEvidence(input.evidenceRoot, `jev/${input.step.stepId}-${input.attempt ?? 1}.json`, {
        command: this.command,
        request,
        response: envelope,
        decision: evidenceDecision,
      });
    }
    return {
      response,
      ...(evidencePath ? { evidencePath } : {}),
      ...(typeof envelope.model === "string" ? { model: envelope.model } : {}),
      ...(envelope.usage !== undefined ? { usage: redactValue(envelope.usage) } : {}),
    };
  }
}
