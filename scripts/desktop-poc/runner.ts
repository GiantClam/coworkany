import { execFile, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { validateScenarioPlan, type ScenarioPlan, type ScenarioStep } from "./contracts";
import { digestValue, expandRunId, redactValue, stableJson, summarizeTarget } from "./canonical";
import { appendTimeline, captureScreenshot, copySnapshot, writeFailureCard, writeManifest, type ErrorCategory } from "./evidence";
import { JevSelector, JevSelectorError, type JevSelectorResult } from "./jev-selector";
// @ts-expect-error lifecycle is intentionally a Node ESM boundary.
import { cleanupRun, processGroupRows, restartRun, resolveRunRoot, startRun, statusRun, stopRun } from "./lifecycle.mjs";

const execFileAsync = promisify(execFile);

export class PocError extends Error {
  readonly category: ErrorCategory;
  readonly code: string;
  readonly actual?: unknown;
  readonly expected?: unknown;
  constructor(code: string, message: string, category: ErrorCategory = "action", details: { actual?: unknown; expected?: unknown } = {}) {
    super(message);
    this.name = "PocError";
    this.code = code;
    this.category = category;
    this.actual = details.actual;
    this.expected = details.expected;
  }
}

export type AdapterResult = {
  readonly observation?: unknown;
  readonly snapshot?: unknown;
  readonly evidence?: readonly string[];
  readonly actual?: unknown;
};

export type ScenarioAdapterContext = {
  readonly runId: string;
  readonly evidenceRoot: string;
  readonly variables: ReadonlyMap<string, unknown>;
};

export interface ScenarioAdapter {
  execute(step: ScenarioStep, context: ScenarioAdapterContext): Promise<AdapterResult>;
  screenshot?(path: string): Promise<void>;
  close?(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function valueAtPath(root: unknown, path: string): unknown {
  if (!path) return root;
  let current = root;
  for (const part of path.split(".")) {
    if (isRecord(current) && part in current) current = current[part];
    else throw new PocError("capture_not_found", `capture reference not found: ${path}`, "assertion");
  }
  return current;
}

function setCapture(variables: Map<string, unknown>, key: string, value: unknown) {
  variables.set(key, value);
  const parts = key.split(".").filter(Boolean);
  if (parts.length < 2) return;
  const rootKey = parts[0]!;
  const root = isRecord(variables.get(rootKey)) ? variables.get(rootKey) as Record<string, unknown> : {};
  let current = root;
  for (const part of parts.slice(1, -1)) {
    const child = isRecord(current[part]) ? current[part] as Record<string, unknown> : {};
    current[part] = child;
    current = child;
  }
  current[parts.at(-1)!] = value;
  variables.set(rootKey, root);
}

function resolveExpected(value: unknown, variables: ReadonlyMap<string, unknown>): unknown {
  if (isRecord(value) && Object.keys(value).length === 1 && typeof value.$ref === "string") {
    const parts = value.$ref.split(".");
    const root = variables.get(parts[0]) ?? variables.get(value.$ref);
    if (root === undefined) throw new PocError("capture_not_found", `capture reference not found: ${value.$ref}`, "assertion");
    return valueAtPath(root, parts.slice(1).join("."));
  }
  return value;
}

function materializeStep(step: ScenarioStep, variables: ReadonlyMap<string, unknown>): ScenarioStep {
  const expected = step.assertion?.expected === undefined ? undefined : resolveExpected(step.assertion.expected, variables);
  const assertion = step.assertion && expected !== undefined ? { ...step.assertion, expected } : step.assertion;
  return { ...step, assertion, value: step.value?.replaceAll("${runId}", String(variables.get("runId") ?? "")) };
}

function classifyError(error: unknown): ErrorCategory {
  if (error instanceof PocError) return error.category;
  const message = error instanceof Error ? error.message : String(error);
  if (/jev|credential|api/iu.test(message)) return "environment";
  if (/assert|expected|capture|target|value/iu.test(message)) return "assertion";
  if (/persist|sqlite|database|workflow/iu.test(message)) return "persistence";
  if (/crash|exit|signal/iu.test(message)) return "crash";
  if (/permission|agent|port|timeout|window|server|environment|poc_[a-z0-9_]+|not found/iu.test(message)) return "environment";
  return "action";
}

function gitOutput(repoRoot: string, args: string[]): string {
  try { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function toolVersion(command: string, args: string[] = ["--version"]): string {
  try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().slice(0, 200); }
  catch { return "unavailable"; }
}

function errorDetails(error: unknown) {
  if (error instanceof PocError) return { code: error.code, message: error.message, category: error.category, expected: redactValue(error.expected), actual: redactValue(error.actual) };
  return { code: "unclassified_error", message: error instanceof Error ? error.message : String(error), category: classifyError(error) };
}

export type RunScenarioOptions = {
  readonly plan: unknown;
  readonly runId?: string;
  readonly evidenceRoot: string;
  readonly adapter: ScenarioAdapter;
  readonly repoRoot?: string;
  readonly repairRound?: number;
  readonly strictEvidence?: boolean;
};

export type RunScenarioResult = {
  readonly ok: boolean;
  readonly runId: string;
  readonly evidenceRoot: string;
  readonly manifestPath: string;
  readonly failureCardPath?: string;
  readonly manifest: Record<string, unknown>;
};

function generatedRunId() {
  return `run-${new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export async function runScenario(options: RunScenarioOptions): Promise<RunScenarioResult> {
  const runId = options.runId ?? generatedRunId();
  const expanded = expandRunId(options.plan, runId);
  const plan = validateScenarioPlan(expanded);
  const evidenceRoot = resolve(options.evidenceRoot);
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  await mkdir(evidenceRoot, { recursive: true });
  const variables = new Map<string, unknown>([["runId", runId]]);
  const startedAt = new Date().toISOString();
  const timeline: Array<Record<string, unknown>> = [];
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    runId,
    scenarioId: plan.scenarioId,
    scenarioTitle: plan.title,
    scenarioHash: digestValue(plan),
    codeCommit: gitOutput(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
    worktree: { dirty: Boolean(gitOutput(repoRoot, ["status", "--short"])), summary: redactValue(gitOutput(repoRoot, ["status", "--short"])) },
    platform: process.platform,
    versions: { node: process.version, pnpm: toolVersion("pnpm", ["--version"]), rust: toolVersion("rustc") },
    evidenceRoot: "<RUN_ROOT>",
    startedAt,
    status: "running",
    actionCount: plan.steps.length + plan.cleanup.length,
    mainSteps: plan.steps.length,
    cleanupSteps: plan.cleanup.length,
    repairRound: options.repairRound ?? 0,
  };
  await writeManifest(evidenceRoot, manifest);
  let failureCardPath: string | undefined;
  let mainFailure: Record<string, unknown> | undefined;
  let cleanupFailure: Record<string, unknown> | undefined;

  const executeStep = async (rawStep: ScenarioStep, cleanup: boolean) => {
    const step = materializeStep(rawStep, variables);
    const started = new Date().toISOString();
    const evidence: string[] = [];
    try {
      const result = await options.adapter.execute(step, { runId, evidenceRoot, variables });
      if (step.evidence?.snapshot && result.snapshot !== undefined) evidence.push(await copySnapshot(evidenceRoot, step.stepId, result.snapshot));
      if (step.evidence?.screenshot) {
        if (!options.adapter.screenshot) throw new PocError("evidence_unavailable", "screenshot adapter is unavailable", "environment");
        evidence.push(await captureScreenshot(evidenceRoot, step.stepId, (path) => options.adapter.screenshot!(path)));
      }
      if (result.evidence?.length) evidence.push(...result.evidence);
      if (step.captureAs) setCapture(variables, step.captureAs, result.observation ?? result.actual ?? result.snapshot ?? null);
      if (step.assertion?.captureAs) setCapture(variables, step.assertion.captureAs, result.actual ?? result.observation ?? null);
      const event = { runId, stepId: step.stepId, actor: step.actor, action: step.action, startedAt: started, finishedAt: new Date().toISOString(), result: "passed", target: summarizeTarget(step.target), evidence, observation: result.observation };
      timeline.push(event);
      await appendTimeline(evidenceRoot, event);
      return result;
    } catch (error) {
      const details = errorDetails(error);
      const event = { runId, stepId: step.stepId, actor: step.actor, action: step.action, startedAt: started, finishedAt: new Date().toISOString(), result: "failed", errorCategory: details.category, target: summarizeTarget(step.target), evidence, error: details.message };
      timeline.push(event);
      await appendTimeline(evidenceRoot, event);
      if (!cleanup) {
        const card = { schemaVersion: 1, runId, scenarioId: plan.scenarioId, category: details.category, title: `PoC step failed: ${step.stepId}`, stepId: step.stepId, expected: details.expected, actual: details.actual, error: details, reproducible: true, eligibleForRepair: !["environment"].includes(details.category), reproduction: `pnpm desktop:poc:run -- --run-id ${runId}`, evidence: { timeline: "timeline.jsonl", step: evidence }, suspectedRootCause: "See the step snapshot and lifecycle log before changing code." };
        failureCardPath = await writeFailureCard(evidenceRoot, card);
        throw error;
      }
      throw error;
    }
  };

  try {
    for (const step of plan.steps) await executeStep(step, false);
  } catch (error) {
    mainFailure = errorDetails(error);
  } finally {
    for (const step of plan.cleanup) {
      try { await executeStep(step, true); }
      catch (error) {
        cleanupFailure = errorDetails(error);
        if (!failureCardPath) failureCardPath = await writeFailureCard(evidenceRoot, { schemaVersion: 1, runId, scenarioId: plan.scenarioId, category: cleanupFailure.category, title: `PoC cleanup failed: ${step.stepId}`, stepId: step.stepId, error: cleanupFailure, eligibleForRepair: false, reproduction: `pnpm desktop:poc:run -- --run-id ${runId}` });
      }
    }
    try { await options.adapter.close?.(); }
    catch (error) { cleanupFailure ??= errorDetails(error); }
  }

  const ok = !mainFailure && !cleanupFailure;
  const finishedAt = new Date().toISOString();
  const finalManifest: Record<string, unknown> = { ...manifest, status: ok ? "passed" : "failed", finishedAt, passedSteps: timeline.filter((item) => item.result === "passed").length, failedSteps: timeline.filter((item) => item.result === "failed").length, timelineEvents: timeline.length, cleanup: { attempted: plan.cleanup.length, completed: !cleanupFailure }, failure: mainFailure ?? cleanupFailure ?? null, failureCard: failureCardPath ? "failure-card.json" : null };
  const manifestPath = await writeManifest(evidenceRoot, finalManifest);
  return { ok, runId, evidenceRoot, manifestPath, ...(failureCardPath ? { failureCardPath } : {}), manifest: finalManifest };
}

type NativeAdapterOptions = { readonly repoRoot: string; readonly runRoot: string; readonly appName?: string; readonly cliPath?: string; readonly sessionId?: string; readonly startSession?: boolean; readonly headed?: boolean; readonly selector?: JevSelector; readonly requireSelector?: boolean };
const DEFAULT_APP_NAME = "coworkany";

const POC_NATIVE_IDS: Record<string, string> = {
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

const POC_ACCESSIBLE_NAMES: Readonly<Record<string, string>> = {
  "workflow-definition-hash": "Workflow definition hash",
};

const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  textbox: ["textbox", "textfield"],
  textfield: ["textfield", "textbox"],
};

function roleMatchesTarget(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "string") return true;
  if (typeof actual !== "string") return false;
  return (ROLE_ALIASES[expected] ?? [expected]).includes(actual);
}

function targetNameMatchesNode(node: Record<string, unknown>, target: ScenarioStep["target"]): boolean {
  if (!target?.name) return true;
  const expected = target.name.trim().toLocaleLowerCase();
  const names = [node.name, node.description].filter((value): value is string => typeof value === "string").map((value) => value.trim().toLocaleLowerCase());
  if (names.includes(expected)) return true;
  if ((target.pocId === "open-workflow" || target.pocId === "delete-workflow") && node.role === "button") {
    const prefix = target.pocId === "open-workflow" ? "打开工作流" : "删除工作流";
    return names.some((name) => name.startsWith(`${prefix.toLocaleLowerCase()} `) && name.endsWith(expected));
  }
  return false;
}

function nodeMatchesTarget(node: unknown, target: ScenarioStep["target"]): boolean {
  if (!isRecord(node) || !target) return false;
  const expectedNativeId = target.nativeId ?? (target.pocId ? POC_NATIVE_IDS[target.pocId] : undefined);
  const actualNativeId = isRecord(node.native_id) && typeof node.native_id.value === "string" ? node.native_id.value : undefined;
  const expectedName = target.name ?? (target.pocId ? POC_ACCESSIBLE_NAMES[target.pocId] : undefined);
  if (expectedNativeId && actualNativeId !== expectedNativeId) {
    // Static output nodes can expose their aria-label but not an AX DOM id.
    // Permit that explicit accessible-name fallback while keeping native IDs
    // the primary identity for actionable controls.
    if (!expectedName || !targetNameMatchesNode(node, { ...target, name: expectedName })) return false;
  }
  if (target.role && !roleMatchesTarget(node.role, target.role)) return false;
  const requireNameMatch = Boolean(expectedName && (Boolean(target.name) || !expectedNativeId || actualNativeId !== expectedNativeId));
  if (requireNameMatch && !targetNameMatchesNode(node, { ...target, name: expectedName })) return false;
  return Boolean(expectedNativeId || target.role || expectedName);
}

function findTargetNode(value: unknown, target: ScenarioStep["target"]): Record<string, unknown> | undefined {
  if (nodeMatchesTarget(value, target)) return value as Record<string, unknown>;
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findTargetNode(child, target);
      if (match) return match;
    }
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) {
      const match = findTargetNode(child, target);
      if (match) return match;
    }
  }
  return undefined;
}

export function snapshotContainsTarget(snapshot: unknown, target: ScenarioStep["target"]): boolean {
  return Boolean(findTargetNode(snapshot, target));
}

function nodeRef(node: Record<string, unknown>): string | undefined {
  if (typeof node.ref_id === "string") return node.ref_id;
  if (typeof node.refId === "string") return node.refId;
  return undefined;
}

function collectTargetRefs(value: unknown, target: ScenarioStep["target"], result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const child of value) collectTargetRefs(child, target, result);
    return result;
  }
  if (!isRecord(value)) return result;
  if (nodeMatchesTarget(value, target)) {
    const ref = nodeRef(value);
    if (ref) result.push(ref);
  }
  for (const child of Object.values(value)) collectTargetRefs(child, target, result);
  return result;
}

/** Resolve an action ref from the exact snapshot already shown to Jev. */
export function snapshotTargetRefs(snapshot: unknown, target: ScenarioStep["target"]): readonly string[] {
  return [...new Set(collectTargetRefs(snapshot, target))];
}

function scalarNodeValue(node: Record<string, unknown>, key: string): string | number | boolean | undefined {
  const value = node[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function descendantNodeValue(node: Record<string, unknown>, key: string): string | number | boolean | undefined {
  const children = node.children;
  if (!Array.isArray(children)) return undefined;
  for (const child of children) {
    if (!isRecord(child)) continue;
    const own = scalarNodeValue(child, key);
    if (own !== undefined) return own;
    const nested = descendantNodeValue(child, key);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function snapshotObservation(snapshot: unknown, target: ScenarioStep["target"]): Record<string, unknown> | undefined {
  const node = findTargetNode(snapshot, target);
  // A surface capture may intentionally target an inert root with no AX name
  // or ref. The complete snapshot itself is the observation in that case.
  if (!node && target?.pocId === "workflow-builder") return { surface: "workflow-builder" };
  if (!node) return undefined;
  if (target?.pocId === "workflow-builder") return {};
  const value = scalarNodeValue(node, "value") ?? descendantNodeValue(node, "value") ?? descendantNodeValue(node, "text");
  const text = scalarNodeValue(node, "text") ?? value ?? descendantNodeValue(node, "text") ?? descendantNodeValue(node, "name") ?? scalarNodeValue(node, "name") ?? scalarNodeValue(node, "description");
  const title = scalarNodeValue(node, "title") ?? scalarNodeValue(node, "name");
  const ref = scalarNodeValue(node, "ref_id") ?? descendantNodeValue(node, "ref_id");
  return {
    ...(typeof ref === "string" ? { ref } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(title !== undefined ? { title } : {}),
  };
}

export function snapshotPropertyValue(snapshot: unknown, target: ScenarioStep["target"], property: string): string | number | boolean | undefined {
  const observation = snapshotObservation(snapshot, target);
  if (!observation) return undefined;
  if (property === "value") return typeof observation.value === "string" || typeof observation.value === "number" || typeof observation.value === "boolean" ? observation.value : undefined;
  if (property === "title") return typeof observation.title === "string" || typeof observation.title === "number" || typeof observation.title === "boolean" ? observation.title : undefined;
  if (property === "text") return typeof observation.text === "string" || typeof observation.text === "number" || typeof observation.text === "boolean" ? observation.text : undefined;
  return undefined;
}

export function snapshotContainsText(snapshot: unknown, expected: string): boolean {
  const needle = expected.trim().toLocaleLowerCase();
  if (!needle) return false;
  if (Array.isArray(snapshot)) return snapshot.some((child) => snapshotContainsText(child, expected));
  if (!isRecord(snapshot)) return false;
  for (const key of ["name", "description", "text", "value"]) {
    const value = snapshot[key];
    if (typeof value === "string" && value.toLocaleLowerCase().includes(needle)) return true;
  }
  return Object.values(snapshot).some((child) => snapshotContainsText(child, expected));
}

function extractRef(value: unknown): string | undefined {
  if (typeof value === "string" && /^@[^\s:]+:e\d+$/u.test(value)) return value;
  if (Array.isArray(value)) for (const child of value) { const ref = extractRef(child); if (ref) return ref; }
  if (isRecord(value)) for (const child of Object.values(value)) { const ref = extractRef(child); if (ref) return ref; }
  return undefined;
}

function windowRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && "windows" in value) return windowRecords(value.windows);
  return isRecord(value) ? [value] : [];
}

export function selectRunWindow(value: unknown, processIds: ReadonlySet<number>): Record<string, unknown> | undefined {
  const windows = windowRecords(value);
  const owned = windows.filter((window) => typeof window.pid === "number" && processIds.has(window.pid));
  // Once the lifecycle exposes a process group, never bind to an unrelated
  // same-named window just because it is the only one visible at that moment.
  // A singleton fallback is only safe before process identity is available.
  const candidates = processIds.size > 0 ? owned : windows.length === 1 ? windows : [];
  return candidates.find((window) => window.accessible === true && window.minimized !== true) ?? candidates.find((window) => window.minimized !== true) ?? candidates[0];
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function extractEnvelope(output: string): { data?: unknown; error?: Record<string, unknown> } {
  try {
    const value = JSON.parse(output);
    if (value?.ok === false) throw new PocError(String(value.error?.code ?? "agent_desktop_error"), String(value.error?.message ?? "agent-desktop command failed"), "action");
    return value;
  } catch (error) {
    if (error instanceof PocError) throw error;
    throw new PocError("agent_desktop_invalid_output", `agent-desktop returned invalid JSON: ${String(error)}`, "environment");
  }
}

export function unwrapAgentDesktopProperty(value: unknown): unknown {
  return isRecord(value) && "value" in value ? value.value : value;
}

export class AgentDesktopAdapter implements ScenarioAdapter {
  private readonly options: NativeAdapterOptions;
  private readonly selector?: JevSelector;
  private sessionId?: string;
  private ownsSession = false;
  private windowId?: string;
  constructor(options: NativeAdapterOptions) { this.options = options; this.selector = options.selector; this.sessionId = options.sessionId; }

  private appName() { return this.options.appName ?? DEFAULT_APP_NAME; }

  private windowScopeArgs() { return this.windowId ? ["--window-id", this.windowId] : ["--app", this.appName()]; }

  private async refreshWindowScope(timeoutMs: number): Promise<boolean> {
    try {
      const result = await execFileAsync(this.options.cliPath ?? "agent-desktop", ["list-windows", "--app", this.appName(), "--timeout-ms", String(Math.min(5_000, Math.max(1_000, timeoutMs)))], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      const data = extractEnvelope(result.stdout).data;
      const status = await statusRun(this.options.runRoot).catch(() => undefined);
      const processIds = new Set<number>((status?.processGroup ?? processGroupRows(Number(status?.state?.pid ?? 0))).map((row: { pid?: unknown }) => Number(row.pid)).filter((pid: number) => Number.isInteger(pid) && pid > 0));
      const selected = selectRunWindow(data, processIds);
      if (!selected || typeof selected.id !== "string") return false;
      this.windowId = selected.id;
      return true;
    } catch {
      return false;
    }
  }

  private canRetryWindowScope(command: string, error: unknown): boolean {
    if (!this.windowId || !["snapshot", "find", "get", "focus-window", "screenshot"].includes(command)) return false;
    if (!(error instanceof PocError)) return false;
    return error.code === "ACTION_NOT_SUPPORTED" || /not exposed through accessibility|window .*not found|stale window/iu.test(error.message);
  }

  private async cli(command: string, args: string[] = [], timeoutMs = 30_000, headedOverride = false) {
    if (!this.sessionId && this.options.startSession !== false) {
      const started = await execFileAsync(this.options.cliPath ?? "agent-desktop", ["session", "start", "--name", "coworkany-poc", "--screenshots"], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      const envelope = extractEnvelope(started.stdout);
      const data = envelope.data as Record<string, unknown> | undefined;
      this.sessionId = typeof data?.session_id === "string" ? data.session_id : undefined;
      this.ownsSession = Boolean(this.sessionId);
    }
    const global = this.sessionId ? ["--session", this.sessionId] : [];
    // Headed delivery is only needed for React-controlled text inputs. Passing
    // --headed to click/focus commands changes agent-desktop's focus contract
    // and can make an otherwise visible Tauri window fail accessibility
    // verification. Keep discovery/actions headless and opt in per input.
    if (headedOverride || (this.options.headed && command === "set-value")) global.push("--headed");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await execFileAsync(this.options.cliPath ?? "agent-desktop", [...global, command, ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
        return extractEnvelope(result.stdout).data;
      } catch (error) {
        const stdout = error?.stdout;
        let parsed: unknown = new PocError("agent_desktop_command_failed", error instanceof Error ? error.message : String(error), "environment");
        if (typeof stdout === "string" && stdout.trim()) {
          try { parsed = extractEnvelope(stdout); }
          catch (nested) { parsed = nested; }
        }
        if (attempt === 0 && this.canRetryWindowScope(command, parsed) && await this.refreshWindowScope(timeoutMs)) continue;
        throw parsed;
      }
    }
    throw new PocError("agent_desktop_command_failed", `agent-desktop ${command} retry budget exhausted`, "environment");
  }

  private async findTarget(target: ScenarioStep["target"]): Promise<string | undefined> {
    if (!target) throw new PocError("target_missing", "desktop action target is required", "action");
    const pocId = target.pocId;
    const nativeId = target.nativeId ?? (pocId ? POC_NATIVE_IDS[pocId] : undefined);
    const args = [...this.windowScopeArgs(), "--first"];
    if (pocId === "workflow-directory") {
      // AX exposes this container id, but agent-desktop only resolves
      // actionable native ids. The semantic role/name remains stable and
      // identifies the same page without coordinates.
      args.push("--role", target.role ?? "group", "--name", target.name ?? "工作流");
    } else if (nativeId) args.push("--native-id", nativeId);
    else if (pocId === "open-workflow" || pocId === "delete-workflow") {
      args.push("--role", target.role ?? "button", "--text", target.name ?? "");
    } else if (pocId === "workflow-card") args.push("--text", target.name ?? "");
    else {
      if (target.role) args.push("--role", target.role);
      if (target.name) args.push("--name", target.name);
      if (!target.role && !target.name) throw new PocError("target_mapping_missing", `no native mapping for ${pocId ?? "target"}`, "action");
    }
    try {
      const data = await this.cli("find", args, 10_000);
      const ref = extractRef(data);
      if (!ref) throw new PocError("target_unresolved", `target could not be resolved: ${pocId ?? target.name ?? "unknown"}`, "action");
      return ref;
    } catch (error) {
      if (target && (pocId === "workflow-card" || pocId === "open-workflow" || pocId === "delete-workflow") && error instanceof PocError && /not found|no match|unresolved/iu.test(error.message)) return undefined;
      throw error;
    }
  }

  private async waitForAppWindow(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() <= deadline) {
      try {
        const data = await this.cli("list-windows", ["--app", this.appName()], Math.min(5_000, Math.max(1_000, timeoutMs)));
        const status = await statusRun(this.options.runRoot).catch(() => undefined);
        const processIds = new Set<number>((status?.processGroup ?? processGroupRows(Number(status?.state?.pid ?? 0))).map((row: { pid?: unknown }) => Number(row.pid)).filter((pid: number) => Number.isInteger(pid) && pid > 0));
        const selected = selectRunWindow(data, processIds);
        if (selected && typeof selected.id === "string") {
          this.windowId = selected.id;
          return selected;
        }
      } catch (error) {
        // Tauri can finish the frontend server before macOS has registered its
        // application window. Keep polling within the scenario timeout.
        lastError = error;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(500, remaining));
    }
    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
    throw new PocError("app_window_timeout", `timed out waiting for ${this.appName()} window.${detail}`, "environment");
  }

  private async get(ref: string, property: string) {
    return unwrapAgentDesktopProperty(await this.cli("get", ["--property", property, ref], 10_000));
  }

  private async authorizeAction(step: ScenarioStep, context: ScenarioAdapterContext): Promise<{ selector: JevSelectorResult; ref: string } | undefined> {
    if (!["click", "type", "select"].includes(step.action)) return undefined;
    if (!this.selector) {
      if (this.options.requireSelector !== false) throw new PocError("jev_required", "Jev selector is required for native desktop actions", "environment");
      return undefined;
    }
    let snapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--interactive-only", "--compact"], step.timeoutMs);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let result: JevSelectorResult;
      try {
        result = await this.selector.select({ snapshot, step, evidenceRoot: context.evidenceRoot, attempt });
      } catch (error) {
        if (error instanceof JevSelectorError) throw new PocError(error.code, error.message, "environment");
        throw error;
      }
      if (result.response.decision === "action") {
        const selected = result.response.action;
        if (selected.action !== step.action || selected.stepId !== step.stepId) throw new PocError("jev_action_mismatch", "Jev returned an action different from the bounded scenario step", "action");
        const refs = snapshotTargetRefs(snapshot, step.target);
        if (refs.length === 1) return { selector: result, ref: refs[0]! };
        if (attempt === 2) {
          throw new PocError(refs.length > 1 ? "target_ambiguous" : "target_unresolved", refs.length > 1 ? `target matched ${refs.length} accessibility elements` : `target ref was not present in the authorized snapshot`, "action");
        }
        snapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--interactive-only", "--compact"], step.timeoutMs);
        continue;
      }
      if (attempt === 2) throw new PocError("jev_observation_limit", "Jev requested more observations than the bounded selector budget allows", "action");
      snapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--interactive-only", "--compact"], step.timeoutMs);
    }
    return undefined;
  }

  async execute(step: ScenarioStep, context: ScenarioAdapterContext): Promise<AdapterResult> {
    if (step.actor === "operator") {
      if (step.action === "launch") {
        try { this.selector?.assertConfigured(); }
        catch (error) { if (error instanceof JevSelectorError) throw new PocError(error.code, error.message, "environment"); throw error; }
        this.windowId = undefined;
        const result = await startRun({ root: this.options.runRoot, repoRoot: this.options.repoRoot, waitMs: step.timeoutMs }); await this.waitForAppWindow(step.timeoutMs); return { observation: result };
      }
      if (step.action === "restart") { this.windowId = undefined; const result = await restartRun(this.options.runRoot, { waitMs: step.timeoutMs }); await this.waitForAppWindow(step.timeoutMs); return { observation: result }; }
      if (step.action === "stop") return { observation: await stopRun(this.options.runRoot) };
      if (step.action === "cleanup") return { observation: await cleanupRun(this.options.runRoot) };
    }
    if (step.action === "focus") {
      await this.cli("focus-window", this.windowScopeArgs(), step.timeoutMs);
      const snapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--interactive-only", "--compact"], step.timeoutMs);
      if (step.target && !snapshotContainsTarget(snapshot, step.target)) throw new PocError("target_unresolved", `target could not be resolved: ${step.target.pocId ?? step.target.name ?? "unknown"}`, "action");
      return { snapshot };
    }
    if (step.action === "snapshot") {
      const snapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--interactive-only", "--compact"], step.timeoutMs);
      if (step.target && !snapshotContainsTarget(snapshot, step.target)) throw new PocError("target_unresolved", `target could not be resolved: ${step.target.pocId ?? step.target.name ?? "unknown"}`, "action");
      return { snapshot, observation: snapshot };
    }
    if (step.action === "wait") { await this.cli("wait", [String(step.durationMs)], step.timeoutMs); return {}; }
    const authorization = await this.authorizeAction(step, context);
    if (step.action === "capture") {
      // A capture is an observation, not a mutation. Stable PoC containers
      // and output nodes can be present in AX without an actionable ref, so
      // do not force them through `find`; read the complete semantic tree and
      // extract the node by its stable identity instead.
      const snapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--compact"], step.timeoutMs);
      const observed = step.target ? snapshotObservation(snapshot, step.target) : undefined;
      if (step.target && !observed) throw new PocError("target_unresolved", `target could not be resolved: ${step.target.pocId ?? step.target.name ?? "unknown"}`, "action");
      const ref = typeof observed?.ref === "string" ? observed.ref : undefined;
      const observation = ref
        ? {
            ...observed,
            text: await this.get(ref, "text").catch(() => observed?.text),
            value: await this.get(ref, "value").catch(() => observed?.value),
            title: await this.get(ref, "title").catch(() => observed?.title),
          }
        : observed ?? { snapshot };
      return { snapshot, observation, actual: observation };
    }
    if (step.action === "assert" && step.assertion?.kind === "exists" && step.target?.pocId === "workflow-card") {
      const snapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--compact"], step.timeoutMs);
      const actual = snapshotContainsText(snapshot, step.target.name ?? "");
      if (actual !== step.assertion.expected) throw new PocError("assertion_failed", `expected ${JSON.stringify(step.assertion.expected)}, got ${JSON.stringify(actual)}`, "assertion", { expected: step.assertion.expected, actual });
      return { snapshot, actual, observation: { text: step.target.name, present: actual } };
    }
    let assertionSnapshot: unknown;
    let ref: string | undefined;
    if (step.action === "assert") {
      // Assertions are observations too. Resolve their ref from the same
      // window-scoped snapshot instead of issuing a second global `find`,
      // which can race macOS window inventory while a Tauri WebView settles.
      assertionSnapshot = await this.cli("snapshot", [...this.windowScopeArgs(), "--compact"], step.timeoutMs);
      const refs = snapshotTargetRefs(assertionSnapshot, step.target);
      if (refs.length > 1) throw new PocError("target_ambiguous", `target matched ${refs.length} accessibility elements`, "assertion");
      ref = refs[0];
    } else {
      ref = authorization?.ref ?? await this.findTarget(step.target);
    }
    const semanticObservation = step.action === "assert" && step.target ? snapshotObservation(assertionSnapshot, step.target) : undefined;
    if (!ref) {
      if (step.action === "assert" && step.assertion?.kind === "exists" && step.assertion.expected === false && !semanticObservation) return { actual: false, observation: false };
      if (step.action !== "assert" || !semanticObservation) throw new PocError("target_unresolved", `target could not be resolved: ${step.target?.pocId ?? step.target?.name ?? "unknown"}`, "assertion");
    }
    const selectorEvidence = authorization?.selector.evidencePath ? [authorization.selector.evidencePath] : undefined;
    if (step.action === "click") { await this.cli("click", [ref], step.timeoutMs); return selectorEvidence ? { evidence: selectorEvidence } : {}; }
    if (step.action === "type") {
      // Physical delivery through a WebView needs the field to own native
      // focus first; the preceding Jev snapshot/find cycle may have left the
      // action button focused even though the text field is visible.
      if (this.options.headed) await this.cli("focus", [ref], step.timeoutMs);
      await this.cli("set-value", [ref, step.value ?? ""], step.timeoutMs, this.options.headed);
      return selectorEvidence ? { evidence: selectorEvidence } : {};
    }
    if (step.action === "select") {
      // Native WebView comboboxes can report an idempotent selection as a
      // timeout even though the requested value is already active. Read the
      // semantic value first and treat that exact state as success.
      const currentValue = await this.get(ref, "value").catch(() => undefined);
      if (String(currentValue ?? "") !== String(step.value ?? "")) await this.cli("select", [ref, step.value ?? ""], step.timeoutMs);
      return selectorEvidence ? { evidence: selectorEvidence, actual: currentValue } : { actual: currentValue };
    }
    if (step.action === "assert") {
      const assertion = step.assertion!;
      if (assertion.kind === "exists") return { actual: true, observation: semanticObservation ?? true };
      const property = assertion.kind === "value" ? "value" : assertion.kind === "attribute" && assertion.attribute === "title" ? "title" : "text";
      let raw = ref ? await this.get(ref, property) : undefined;
      // agent-desktop's `get` intentionally exposes a narrow property set and
      // may return null for a WebView button's rendered text. The complete AX
      // snapshot remains the authoritative semantic observation, so use it as
      // a bounded fallback instead of treating a null property as a failure.
      if (raw === null || raw === undefined) {
        raw = snapshotPropertyValue(assertionSnapshot, step.target, property);
      }
      let actual: unknown = raw;
      if (assertion.kind === "canonical-json") { try { actual = JSON.parse(String(raw)); } catch { actual = raw; } }
      if (!deepEqual(actual, assertion.expected)) throw new PocError("assertion_failed", `expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actual)}`, assertion.kind === "value" ? "persistence" : "assertion", { expected: assertion.expected, actual });
      return { actual, observation: { ...(ref ? { ref } : {}), property, actual } };
    }
    throw new PocError("unsupported_action", `unsupported desktop action: ${step.action}`, "action");
  }

  async screenshot(path: string) { await mkdir(dirname(path), { recursive: true }); await this.cli("screenshot", [path, ...this.windowScopeArgs()], 20_000); }

  async close() {
    if (!this.sessionId || !this.ownsSession) return;
    try { await this.cli("trace", ["export", "--out", resolve(this.options.runRoot, "evidence", "agent-desktop-trace.html")], 20_000); } finally {
      await execFileAsync(this.options.cliPath ?? "agent-desktop", ["session", "end", this.sessionId], { timeout: 10_000 }).catch(() => undefined);
      this.ownsSession = false;
    }
  }
}

export class MockScenarioAdapter implements ScenarioAdapter {
  readonly values = { title: "", description: "", status: "draft", hash: "hash-before", saveState: "idle", card: false, running: false, cleaned: false };
  readonly executed: string[] = [];
  constructor(readonly failStepId?: string) {}
  async execute(step: ScenarioStep): Promise<AdapterResult> {
    this.executed.push(step.stepId);
    if (step.stepId === this.failStepId) throw new PocError("mock_failure", "injected mock failure", "action");
    const pocId = step.target?.pocId;
    if (step.action === "launch" || step.action === "restart") this.values.running = true;
    if (step.action === "stop") this.values.running = false;
    if (step.action === "cleanup") { this.values.cleaned = true; this.values.running = false; }
    if (step.action === "type" && pocId === "workflow-title") this.values.title = step.value ?? "";
    if (step.action === "type" && pocId === "workflow-description") this.values.description = step.value ?? "";
    if (step.action === "select") this.values.status = step.value ?? "draft";
    if (step.action === "click" && pocId === "save-workflow") { this.values.saveState = "success"; this.values.card = true; }
    if (step.action === "click" && pocId === "confirm-delete") this.values.card = false;
    const observation = { title: pocId === "save-workflow" ? `poc-save-${this.values.saveState}` : this.values.title, description: this.values.description, status: this.values.status, hash: this.values.hash, saveState: this.values.saveState, card: this.values.card, text: pocId === "workflow-definition-hash" ? this.values.hash : undefined, value: pocId === "workflow-title" ? this.values.title : pocId === "workflow-description" ? this.values.description : pocId === "workflow-status" ? this.values.status : undefined };
    if (step.action === "assert") {
      const assertion = step.assertion!;
      const actual = assertion.kind === "exists" ? (pocId === "workflow-card" ? this.values.card : true) : assertion.kind === "attribute" && assertion.attribute === "title" && pocId === "save-workflow" ? `poc-save-${this.values.saveState}` : assertion.kind === "text" && pocId === "save-workflow" ? (this.values.saveState === "success" ? "已保存" : this.values.saveState === "error" ? "保存失败" : this.values.saveState === "running" ? "保存中…" : "保存流程") : pocId === "workflow-title" ? this.values.title : pocId === "workflow-description" ? this.values.description : pocId === "workflow-status" ? this.values.status : pocId === "workflow-definition-hash" ? this.values.hash : pocId === "save-workflow" ? this.values.saveState : undefined;
      const expected = assertion.expected;
      if (assertion.kind === "exists" ? actual !== expected : !deepEqual(actual, expected)) throw new PocError("assertion_failed", "mock assertion failed", "assertion", { actual, expected });
      return { actual, observation };
    }
    if (step.action === "capture") return { observation, actual: observation };
    return { observation, snapshot: observation };
  }
  async screenshot(path: string) { await writeFile(path, "mock screenshot\n", "utf8"); }
}

async function loadJson(path: string) { return JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")); }

async function main() {
  const scenarioPath = process.argv.find((arg) => arg.endsWith(".json")) ?? resolve("scripts/desktop-poc/scenarios/workflow-persistence.json");
  const runIdArg = process.argv.find((arg) => arg.startsWith("--run-id="))?.slice("--run-id=".length);
  // Keep the lifecycle root, evidence directory, and scenario placeholder on
  // one stable run identity. In particular, do not hard-code /tmp here:
  // macOS commonly exposes it as a symlink while lifecycle safety resolves the
  // real temp directory before checking containment.
  const runRoot = process.env.COWORKANY_DESKTOP_POC_RUN_DIR
    ? resolve(process.env.COWORKANY_DESKTOP_POC_RUN_DIR)
    : resolveRunRoot({ ...process.env, ...(runIdArg ? { COWORKANY_DESKTOP_POC_RUN_ID: runIdArg } : {}) });
  const rootRunId = basename(runRoot);
  if (runIdArg && runIdArg !== rootRunId) throw new Error(`poc_run_id_root_mismatch:${runIdArg}:${rootRunId}`);
  const runId = runIdArg ?? rootRunId;
  const evidenceArg = process.argv.find((arg) => arg.startsWith("--evidence-dir="))?.slice("--evidence-dir=".length) ?? resolve(runRoot, "evidence");
  const repoRoot = process.env.COWORKANY_DESKTOP_POC_REPO ?? process.cwd();
  const appArg = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length);
  const headed = process.env.COWORKANY_DESKTOP_POC_HEADED === "1" || process.argv.includes("--headed");
  const selector = new JevSelector({ timeoutMs: Number(process.env.COWORKANY_DESKTOP_POC_JEV_TIMEOUT_MS ?? 30_000) });
  const adapter = new AgentDesktopAdapter({ repoRoot, runRoot, appName: appArg ?? process.env.COWORKANY_DESKTOP_POC_APP, headed, selector, requireSelector: true });
  const result = await runScenario({ plan: await loadJson(scenarioPath), runId, evidenceRoot: evidenceArg, repoRoot, adapter });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
