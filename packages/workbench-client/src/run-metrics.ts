export type InvocationCategory = "model_tool" | "capability";
export type InvocationPhase = "started" | "completed" | "failed" | "rejected";

export type InvocationMetricEvent = {
  readonly kind: "invocation";
  readonly runId: string;
  readonly invocationId: string;
  readonly category: InvocationCategory;
  readonly name: string;
  readonly phase: InvocationPhase;
  readonly attempt: number;
  readonly createdAt: string;
};

export type UsageMetricEvent = {
  readonly kind: "usage";
  readonly runId: string;
  readonly usageId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly providerCost?: number;
  readonly estimatedCost?: number;
  readonly aggregation: "delta" | "snapshot";
  readonly scope: "step" | "run";
  readonly createdAt: string;
};

export type MetricEvent = InvocationMetricEvent | UsageMetricEvent;

export type RunMetricCount = {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly rejected: number;
  readonly running: number;
  readonly byName: readonly {
    readonly name: string;
    readonly total: number;
    readonly completed: number;
    readonly failed: number;
    readonly rejected: number;
    readonly running: number;
  }[];
};

export type RunMetrics = {
  readonly runId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly modelTools: RunMetricCount;
  readonly capabilities: RunMetricCount;
  readonly tokens: { readonly input?: number; readonly output?: number; readonly cachedInput?: number; readonly reasoning?: number };
  readonly providerCost?: number;
  readonly estimatedCost?: number;
  readonly completeness: "complete" | "partial" | "unavailable";
};

export type MetricsRange = "7d" | "30d" | "all";
export type RunMetricSource = "conversation" | "agent" | "workflow" | "media" | "ppt";
export type MetricsQueryFilters = { readonly range: MetricsRange; readonly model?: string; readonly provider?: string; readonly source?: RunMetricSource; readonly query?: string; readonly runId?: string; readonly cursor?: string; readonly limit?: number };
export type MetricsSeriesBucket = { readonly date: string; readonly inputTokens: number; readonly outputTokens: number; readonly modelTools: number; readonly capabilities: number };
export type MetricsBreakdownRow = { readonly name: string; readonly runs: number; readonly invocations: number; readonly completed: number; readonly failed: number; readonly tokens?: number; readonly providerCost?: number };
export type MetricsRunRow = { readonly runId: string; readonly conversationId?: string; readonly messageId?: string; readonly title: string; readonly source: RunMetricSource; readonly provider?: string; readonly model?: string; readonly status: string; readonly startedAt: string; readonly metrics: RunMetrics };
export type MetricsQueryResult = {
  readonly overview: { readonly tokens: number; readonly modelTools: number; readonly capabilities: number; readonly providerCost?: number; readonly previous?: { readonly tokens: number; readonly modelTools: number; readonly capabilities: number; readonly providerCost?: number } };
  readonly series: readonly MetricsSeriesBucket[];
  readonly models: readonly MetricsBreakdownRow[];
  readonly tools: readonly MetricsBreakdownRow[];
  readonly capabilities: readonly MetricsBreakdownRow[];
  readonly runs: readonly MetricsRunRow[];
  readonly nextCursor?: string;
};

type StoredInvocation = InvocationMetricEvent;
type StoredUsage = UsageMetricEvent;

export type RunMetricsAccumulator = {
  readonly runId: string;
  readonly invocations: ReadonlyMap<string, StoredInvocation>;
  readonly usage: ReadonlyMap<string, StoredUsage>;
  readonly sawInvalidUsage: boolean;
};

const finiteNonNegative = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

function invocationKey(event: InvocationMetricEvent) {
  return `${event.category}\u0000${event.invocationId}\u0000${Math.max(1, Math.trunc(event.attempt))}`;
}
function terminal(phase: InvocationPhase) {
  return phase !== "started";
}

export function createRunMetricsAccumulator(runId: string): RunMetricsAccumulator {
  return { runId, invocations: new Map(), usage: new Map(), sawInvalidUsage: false };
}

function sanitizeUsage(event: UsageMetricEvent): { event: UsageMetricEvent; invalid: boolean } {
  const numericEntries = [event.inputTokens, event.outputTokens, event.cachedInputTokens, event.reasoningTokens, event.providerCost, event.estimatedCost];
  const invalid = numericEntries.some((value) => value !== undefined && finiteNonNegative(value) === undefined);
  return {
    invalid,
    event: {
      ...event,
      inputTokens: finiteNonNegative(event.inputTokens),
      outputTokens: finiteNonNegative(event.outputTokens),
      cachedInputTokens: finiteNonNegative(event.cachedInputTokens),
      reasoningTokens: finiteNonNegative(event.reasoningTokens),
      providerCost: finiteNonNegative(event.providerCost),
      estimatedCost: finiteNonNegative(event.estimatedCost),
    },
  };
}

export function applyRunMetricsEvent(state: RunMetricsAccumulator, event: MetricEvent): RunMetricsAccumulator {
  if (event.runId !== state.runId) return state;
  if (event.kind === "invocation") {
    const key = invocationKey(event);
    const current = state.invocations.get(key);
    if (current && terminal(current.phase) && event.phase === "started") return state;
    if (current && current.createdAt > event.createdAt) return state;
    const invocations = new Map(state.invocations);
    invocations.set(key, { ...event, attempt: Math.max(1, Math.trunc(event.attempt)) });
    return { ...state, invocations };
  }
  const { event: sanitized, invalid } = sanitizeUsage(event);
  if (state.usage.has(sanitized.usageId)) return invalid && !state.sawInvalidUsage ? { ...state, sawInvalidUsage: true } : state;
  const usage = new Map(state.usage);
  usage.set(sanitized.usageId, sanitized);
  return { ...state, usage, sawInvalidUsage: state.sawInvalidUsage || invalid };
}

function emptyCount(): RunMetricCount {
  return { total: 0, completed: 0, failed: 0, rejected: 0, running: 0, byName: [] };
}

function countInvocations(events: readonly StoredInvocation[], category: InvocationCategory): RunMetricCount {
  const matching = events.filter((event) => event.category === category);
  if (!matching.length) return emptyCount();
  const byName = new Map<string, StoredInvocation[]>();
  for (const event of matching) byName.set(event.name, [...(byName.get(event.name) ?? []), event]);
  const count = (items: readonly StoredInvocation[], phase: InvocationPhase) => items.filter((event) => event.phase === phase).length;
  return {
    total: matching.length,
    completed: count(matching, "completed"),
    failed: count(matching, "failed"),
    rejected: count(matching, "rejected"),
    running: count(matching, "started"),
    byName: [...byName.entries()].map(([name, items]) => ({ name, total: items.length, completed: count(items, "completed"), failed: count(items, "failed"), rejected: count(items, "rejected"), running: count(items, "started") })).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name)),
  };
}

function sumKnown(events: readonly StoredUsage[], key: "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens" | "providerCost" | "estimatedCost") {
  const values = events.map((event) => event[key]).filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
}

function latestUsage(events: readonly StoredUsage[]) {
  return [...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
}

export function toRunMetrics(state: RunMetricsAccumulator): RunMetrics {
  const invocations = [...state.invocations.values()];
  const usages = [...state.usage.values()];
  const runSnapshots = usages.filter((event) => event.aggregation === "snapshot" && event.scope === "run");
  const selected = runSnapshots.length ? [latestUsage(runSnapshots)!] : usages.filter((event) => event.aggregation === "delta");
  const identity = latestUsage(usages);
  const input = sumKnown(selected, "inputTokens");
  const output = sumKnown(selected, "outputTokens");
  const cachedInput = sumKnown(selected, "cachedInputTokens");
  const reasoning = sumKnown(selected, "reasoningTokens");
  const providerCost = sumKnown(selected, "providerCost");
  const estimatedCost = sumKnown(selected, "estimatedCost");
  const tokens = { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }), ...(cachedInput === undefined ? {} : { cachedInput }), ...(reasoning === undefined ? {} : { reasoning }) };
  const hasUsage = usages.length > 0;
  const hasInvocations = invocations.length > 0;
  const complete = hasUsage && input !== undefined && output !== undefined && !state.sawInvalidUsage;
  return {
    runId: state.runId,
    ...(identity?.provider ? { provider: identity.provider } : {}),
    ...(identity?.model ? { model: identity.model } : {}),
    modelTools: countInvocations(invocations, "model_tool"),
    capabilities: countInvocations(invocations, "capability"),
    tokens,
    ...(providerCost === undefined ? {} : { providerCost }),
    ...(estimatedCost === undefined ? {} : { estimatedCost }),
    completeness: complete ? "complete" : hasUsage || hasInvocations ? "partial" : "unavailable",
  };
}
