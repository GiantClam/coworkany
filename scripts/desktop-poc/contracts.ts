export const OPERATOR_ACTIONS = ["launch", "stop", "restart", "cleanup"] as const;
export const DESKTOP_AGENT_ACTIONS = ["focus", "snapshot", "click", "type", "select", "wait", "assert", "capture"] as const;
export const ASSERTION_KINDS = ["exists", "text", "value", "attribute", "canonical-json"] as const;
export const SELECTOR_DECISIONS = ["action", "need_observation"] as const;

export type OperatorAction = (typeof OPERATOR_ACTIONS)[number];
export type DesktopAgentAction = (typeof DESKTOP_AGENT_ACTIONS)[number];
export type AssertionKind = (typeof ASSERTION_KINDS)[number];
export type ActionKind = OperatorAction | DesktopAgentAction;
export type SelectorDecision = (typeof SELECTOR_DECISIONS)[number];

export type DesktopTarget = {
  readonly pocId?: string;
  readonly nativeId?: string;
  readonly role?: string;
  readonly name?: string;
  readonly withinPocId?: string;
};

export type EvidencePolicy = {
  readonly snapshot?: boolean;
  readonly screenshot?: boolean;
  readonly trace?: boolean;
};

export type CaptureReference = { readonly $ref: string };

export type DesktopAssertion = {
  readonly kind: AssertionKind;
  readonly expected?: unknown | CaptureReference;
  readonly attribute?: string;
  readonly captureAs?: string;
};

export type ScenarioAction = {
  readonly actor: "operator" | "desktop-agent";
  readonly action: ActionKind;
  readonly stepId: string;
  readonly timeoutMs: number;
  readonly target?: DesktopTarget;
  readonly value?: string;
  readonly durationMs?: number;
  readonly assertion?: DesktopAssertion;
  readonly evidence?: EvidencePolicy;
  readonly captureAs?: string;
  readonly description?: string;
};

export type ScenarioStep = ScenarioAction;

export type ScenarioPlan = {
  readonly schemaVersion: 1;
  readonly scenarioId: string;
  readonly title: string;
  readonly preconditions: readonly string[];
  readonly steps: readonly ScenarioStep[];
  readonly assertions: readonly (DesktopAssertion & { readonly target?: DesktopTarget })[];
  readonly cleanup: readonly ScenarioStep[];
  readonly stopConditions: readonly string[];
};

export type SelectorResponse =
  | { readonly decision: "need_observation"; readonly reason: string }
  | { readonly decision: "action"; readonly action: ScenarioAction };

const ACTION_SET = new Set<string>([...OPERATOR_ACTIONS, ...DESKTOP_AGENT_ACTIONS]);
const OPERATOR_SET = new Set<string>(OPERATOR_ACTIONS);
const DESKTOP_SET = new Set<string>(DESKTOP_AGENT_ACTIONS);
const ASSERTION_SET = new Set<string>(ASSERTION_KINDS);
const TARGET_KEYS = new Set(["pocId", "nativeId", "role", "name", "withinPocId"]);
const EVIDENCE_KEYS = new Set(["snapshot", "screenshot", "trace"]);
const ASSERTION_KEYS = new Set(["kind", "expected", "attribute", "captureAs"]);
const ACTION_KEYS = new Set(["actor", "action", "stepId", "timeoutMs", "target", "value", "durationMs", "assertion", "evidence", "captureAs", "description"]);
const PLAN_KEYS = new Set(["schemaVersion", "scenarioId", "title", "preconditions", "steps", "assertions", "cleanup", "stopConditions"]);
const FORBIDDEN_KEYS = new Set(["shell", "command", "commands", "git", "sql", "javascript", "script", "selector", "css", "apiKey", "token", "secret", "password", "credential", "coordinate", "xy"]);
const MAX_TIMEOUT_MS = 180_000;
const MAX_VALUE_CHARS = 4096;
const SAFE_ID = /^[a-z0-9][a-z0-9:_-]*$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`scenario_invalid_record:${path}`);
}

function assertString(value: unknown, path: string, nonEmpty = true, max = 512): asserts value is string {
  if (typeof value !== "string" || (nonEmpty && !value.trim()) || value.length > max) throw new Error(`scenario_invalid_string:${path}`);
}

function assertNumber(value: unknown, path: string, minimum = 0, maximum = MAX_TIMEOUT_MS): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`scenario_invalid_number:${path}`);
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`scenario_invalid_boolean:${path}`);
}

function assertArray(value: unknown, path: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`scenario_invalid_array:${path}`);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || key.toLocaleLowerCase().includes("coordinate")) throw new Error(`scenario_forbidden_field:${path}.${key}`);
    if (!allowed.has(key)) throw new Error(`scenario_unknown_field:${path}.${key}`);
  }
}

function validateTarget(value: unknown, path: string): DesktopTarget {
  assertRecord(value, path);
  assertKnownKeys(value, TARGET_KEYS, path);
  const target: { pocId?: string; nativeId?: string; role?: string; name?: string; withinPocId?: string } = {};
  for (const key of ["pocId", "nativeId", "role", "name", "withinPocId"] as const) {
    if (key in value) {
      assertString(value[key], `${path}.${key}`, true, 256);
      if ((key === "pocId" || key === "nativeId" || key === "withinPocId") && !SAFE_ID.test(value[key])) throw new Error(`scenario_invalid_target_id:${path}.${key}`);
      target[key] = value[key];
    }
  }
  if (!target.pocId && !target.nativeId && !target.role && !target.name) throw new Error(`scenario_target_required:${path}`);
  return target;
}

function validateEvidence(value: unknown, path: string): EvidencePolicy {
  assertRecord(value, path);
  assertKnownKeys(value, EVIDENCE_KEYS, path);
  for (const key of EVIDENCE_KEYS) if (key in value) assertBoolean(value[key], `${path}.${key}`);
  return value as EvidencePolicy;
}

function validateExpected(value: unknown, path: string) {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "$ref") throw new Error(`scenario_expected_object_forbidden:${path}`);
    assertString(value.$ref, `${path}.$ref`, true, 256);
    return;
  }
  if (typeof value === "string" && value.length > MAX_VALUE_CHARS) throw new Error(`scenario_expected_too_large:${path}`);
  if (Array.isArray(value) && value.length > 100) throw new Error(`scenario_expected_array_too_large:${path}`);
}

function validateAssertion(value: unknown, path: string): DesktopAssertion {
  assertRecord(value, path);
  assertKnownKeys(value, ASSERTION_KEYS, path);
  assertString(value.kind, `${path}.kind`);
  if (!ASSERTION_SET.has(value.kind)) throw new Error(`scenario_invalid_assertion:${path}.kind`);
  if ("attribute" in value) assertString(value.attribute, `${path}.attribute`, true, 128);
  if ("captureAs" in value) {
    assertString(value.captureAs, `${path}.captureAs`, true, 256);
    if (!SAFE_ID.test(value.captureAs.replaceAll(".", "-"))) throw new Error(`scenario_invalid_capture_id:${path}.captureAs`);
  }
  if ("expected" in value) validateExpected(value.expected, `${path}.expected`);
  if ((value.kind === "text" || value.kind === "value" || value.kind === "attribute" || value.kind === "canonical-json") && !("expected" in value)) throw new Error(`scenario_assertion_expected:${path}`);
  return value as DesktopAssertion;
}

function validateAction(value: unknown, path: string): ScenarioStep {
  assertRecord(value, path);
  assertKnownKeys(value, ACTION_KEYS, path);
  assertString(value.actor, `${path}.actor`);
  if (value.actor !== "operator" && value.actor !== "desktop-agent") throw new Error(`scenario_invalid_actor:${path}.actor`);
  assertString(value.action, `${path}.action`);
  if (!ACTION_SET.has(value.action)) throw new Error(`scenario_invalid_action:${path}.action`);
  assertString(value.stepId, `${path}.stepId`, true, 128);
  assertNumber(value.timeoutMs, `${path}.timeoutMs`, 1);
  if ("description" in value) assertString(value.description, `${path}.description`, false, 512);
  if ("target" in value) validateTarget(value.target, `${path}.target`);
  if ("value" in value) assertString(value.value, `${path}.value`, false, MAX_VALUE_CHARS);
  if ("durationMs" in value) assertNumber(value.durationMs, `${path}.durationMs`, 1, MAX_TIMEOUT_MS);
  if ("assertion" in value) validateAssertion(value.assertion, `${path}.assertion`);
  if ("evidence" in value) validateEvidence(value.evidence, `${path}.evidence`);
  if ("captureAs" in value) {
    assertString(value.captureAs, `${path}.captureAs`, true, 256);
    if (!SAFE_ID.test(value.captureAs.replaceAll(".", "-"))) throw new Error(`scenario_invalid_capture_id:${path}.captureAs`);
  }
  if (value.actor === "operator" && !OPERATOR_SET.has(value.action)) throw new Error(`scenario_actor_action_mismatch:${path}`);
  if (value.actor === "desktop-agent" && !DESKTOP_SET.has(value.action)) throw new Error(`scenario_actor_action_mismatch:${path}`);
  if (value.actor === "desktop-agent" && !value.target) throw new Error(`scenario_target_required:${path}.target`);
  if (value.action === "click" || value.action === "type" || value.action === "select" || value.action === "assert" || value.action === "capture" || value.action === "focus") {
    if (!value.target) throw new Error(`scenario_target_required:${path}.target`);
  }
  if ((value.action === "type" || value.action === "select") && typeof value.value !== "string") throw new Error(`scenario_value_required:${path}.value`);
  if (value.action === "wait" && (typeof value.durationMs !== "number" || value.durationMs < 1)) throw new Error(`scenario_duration_required:${path}.durationMs`);
  if (value.action === "assert" && !value.assertion) throw new Error(`scenario_assertion_required:${path}.assertion`);
  if (value.action === "capture" && !value.captureAs) throw new Error(`scenario_capture_key_required:${path}.captureAs`);
  return value as ScenarioStep;
}

export function validateScenarioPlan(value: unknown): ScenarioPlan {
  assertRecord(value, "plan");
  assertKnownKeys(value, PLAN_KEYS, "plan");
  if (value.schemaVersion !== 1) throw new Error("scenario_schema_version_unsupported");
  assertString(value.scenarioId, "plan.scenarioId", true, 128);
  assertString(value.title, "plan.title", true, 512);
  for (const key of ["preconditions", "assertions", "steps", "cleanup", "stopConditions"] as const) assertArray(value[key], `plan.${key}`);
  for (const [index, item] of value.preconditions.entries()) assertString(item, `plan.preconditions[${index}]`, true, 512);
  for (const [index, item] of value.stopConditions.entries()) assertString(item, `plan.stopConditions[${index}]`, true, 512);
  const steps = value.steps.map((item, index) => validateAction(item, `plan.steps[${index}]`));
  const cleanup = value.cleanup.map((item, index) => validateAction(item, `plan.cleanup[${index}]`));
  const assertions = value.assertions.map((item, index) => {
    assertRecord(item, `plan.assertions[${index}]`);
    const target = "target" in item ? validateTarget(item.target, `plan.assertions[${index}].target`) : undefined;
    const assertion = validateAssertion(item, `plan.assertions[${index}]`);
    return target ? { ...assertion, target } : assertion;
  });
  const stepIds = [...steps, ...cleanup].map((step) => step.stepId);
  if (new Set(stepIds).size !== stepIds.length) throw new Error("scenario_duplicate_step_id");
  if (!cleanup.length || cleanup.at(-1)?.action !== "cleanup") throw new Error("scenario_cleanup_must_end_with_cleanup");
  if (steps.length > 200) throw new Error("scenario_too_many_steps");
  return { schemaVersion: 1, scenarioId: value.scenarioId, title: value.title, preconditions: value.preconditions as string[], steps, assertions, cleanup, stopConditions: value.stopConditions as string[] };
}

export function validateSelectorResponse(value: unknown): SelectorResponse {
  assertRecord(value, "selector");
  if (value.decision === "need_observation") {
    assertString(value.reason, "selector.reason", true, 512);
    if (Object.keys(value).some((key) => key !== "decision" && key !== "reason")) throw new Error("selector_unknown_field");
    return value as SelectorResponse;
  }
  if (value.decision === "action") {
    if (Object.keys(value).some((key) => key !== "decision" && key !== "action")) throw new Error("selector_unknown_field");
    return { decision: "action", action: validateAction(value.action, "selector.action") };
  }
  throw new Error("selector_decision_required");
}
