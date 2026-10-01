import type { DesktopUIMessagePart } from "@coworkany/workbench-client";

export type ToolActivityPart = Extract<DesktopUIMessagePart, { type: "dynamic-tool" }>;
export type ReasoningActivityPart = Extract<DesktopUIMessagePart, { type: "reasoning" }>;
export type ProcessActivityPart = ToolActivityPart | ReasoningActivityPart;

export type ProcessActivityMember = {
  readonly id: string;
  readonly part: ProcessActivityPart;
  readonly index: number;
};

export type ToolActivityEntry =
  | { readonly type: "tool-group"; readonly id: string; readonly parts: readonly ToolActivityPart[]; readonly memberIds?: readonly string[] }
  | { readonly type: "part"; readonly part: DesktopUIMessagePart; readonly index: number };

export type ProcessActivityEntry = ToolActivityEntry | {
  readonly type: "process-group";
  readonly id: string;
  readonly members: readonly ProcessActivityMember[];
};

export type ProcessActivityContext = { readonly active: boolean; readonly workflowAi?: boolean };

export type ToolActivitySummary = {
  readonly label: string;
  readonly phase: "running" | "completed" | "failed" | "denied" | "waiting";
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly denied: number;
  readonly total: number;
  readonly failedCallIds: readonly string[];
};

export type ProcessActivitySummary = ToolActivitySummary & {
  readonly kind: "reasoning" | "tools" | "mixed";
  readonly reasoningActive: boolean;
};

const INVISIBLE_PARTS = new Set([
  "data-status",
  "data-usage",
  "data-runMetrics",
  "data-writerAsset",
]);

const INTERACTION_TOOLS = new Set(["question", "ask_user", "request_user_input"]);

function isInvisiblePart(part: DesktopUIMessagePart) {
  return INVISIBLE_PARTS.has(part.type);
}

function isInteractionTool(part: ToolActivityPart) {
  return INTERACTION_TOOLS.has(part.toolName.trim().toLowerCase());
}

function isOrdinaryTool(part: DesktopUIMessagePart): part is ToolActivityPart {
  return part.type === "dynamic-tool" && part.state !== "approval-requested" && !isInteractionTool(part);
}

function reasoningPartId(part: ReasoningActivityPart, index: number) {
  const metadata = part.providerMetadata as { readonly coworkany?: { readonly partId?: unknown } } | undefined;
  const partId = metadata?.coworkany?.partId;
  return typeof partId === "string" && partId.length > 0 ? `reasoning:${partId}` : `reasoning:${index}`;
}

function isEligibleReasoning(part: ReasoningActivityPart, context: ProcessActivityContext) {
  return part.text.trim().length > 0 || (context.active && part.state === "streaming");
}

function processMemberId(part: ProcessActivityPart, index: number) {
  return part.type === "dynamic-tool" ? `tool:${part.toolCallId}` : reasoningPartId(part, index);
}

/**
 * Projects eligible reasoning and ordinary tools into maximal chronological
 * process intervals. Stored Parts are never mutated or reordered.
 */
export function groupProcessActivityParts(parts: readonly DesktopUIMessagePart[], context: ProcessActivityContext): readonly ProcessActivityEntry[] {
  const entries: ProcessActivityEntry[] = [];
  let current: Array<{ part: ProcessActivityPart; index: number }> = [];
  let legacyTools: ToolActivityPart[] = [];
  const occurrenceCounts = new Map<string, number>();

  const occurrenceId = (baseId: string) => {
    const occurrence = occurrenceCounts.get(baseId) ?? 0;
    occurrenceCounts.set(baseId, occurrence + 1);
    return occurrence === 0 ? baseId : `${baseId}:${occurrence}`;
  };

  const flush = () => {
    if (!current.length) return;
    const unique = new Map<string, { part: ProcessActivityPart; index: number }>();
    const positions = new Map<string, number>();
    for (const item of current) {
      const id = processMemberId(item.part, item.index);
      if (!positions.has(id)) positions.set(id, positions.size);
      unique.set(id, item);
    }
    const members = [...unique.entries()]
      .sort((a, b) => positions.get(a[0])! - positions.get(b[0])!)
      .map(([id, item]) => ({ id: occurrenceId(id), part: item.part, index: item.index }));
    entries.push({ type: "process-group", id: members[0]!.id, members });
    current = [];
  };

  const flushLegacy = () => {
    if (!legacyTools.length) return;
    for (const entry of groupToolActivityParts(legacyTools)) {
      if (entry.type !== "tool-group") {
        entries.push(entry);
        continue;
      }
      const memberIds = entry.parts.map((part) => occurrenceId(`tool:${part.toolCallId}`));
      entries.push({ ...entry, id: memberIds[0]!, memberIds });
    }
    legacyTools = [];
  };

  parts.forEach((part, index) => {
    if (isInvisiblePart(part)) return;
    if (part.type === "reasoning" && !isEligibleReasoning(part, context)) return;
    const reasoning = part.type === "reasoning" && isEligibleReasoning(part, context);
    const tool = isOrdinaryTool(part);
    if (reasoning) {
      flushLegacy();
      current.push({ part, index });
      return;
    }
    if (tool && !context.workflowAi) {
      current.push({ part, index });
      return;
    }
    flush();
    if (!(tool && context.workflowAi)) flushLegacy();
    if (tool && context.workflowAi) {
      legacyTools.push(part);
    } else if (!(part.type === "reasoning" && !isEligibleReasoning(part, context))) {
      entries.push({ type: "part", part, index });
    }
  });
  flush();
  flushLegacy();
  return entries;
}

/**
 * Projects the original part array into visible parts and maximal adjacent tool runs.
 * Bookkeeping parts are omitted without creating a visible boundary; all other parts
 * retain their original index and object identity.
 */
export function groupToolActivityParts(parts: readonly DesktopUIMessagePart[]): readonly ToolActivityEntry[] {
  const entries: ToolActivityEntry[] = [];
  let current: ToolActivityPart[] | undefined;

  const flush = () => {
    if (!current?.length) return;
    // Lifecycle patches can appear as repeated Parts. Keep the first visible
    // position while replacing it with the latest lifecycle reference.
    const unique = new Map<string, ToolActivityPart>();
    const positions = new Map<string, number>();
    for (const part of current) {
      if (!positions.has(part.toolCallId)) positions.set(part.toolCallId, unique.size);
      unique.set(part.toolCallId, part);
    }
    const deduped = [...unique.entries()].sort((a, b) => positions.get(a[0])! - positions.get(b[0])!).map(([, part]) => part);
    entries.push({ type: "tool-group", id: deduped[0]!.toolCallId, parts: deduped });
    current = undefined;
  };

  parts.forEach((part, index) => {
    if (isInvisiblePart(part)) return;
    if (isOrdinaryTool(part)) {
      current ??= [];
      current.push(part);
      return;
    }
    flush();
    entries.push({ type: "part", part, index });
  });
  flush();
  return entries;
}

function operationLabel(toolName: string, locale: "zh" | "en") {
  const name = toolName.trim().toLowerCase();
  const tokens = name.split(/[^a-z0-9]+/u).filter(Boolean);
  const has = (words: readonly string[]) => tokens.some((token) => words.some((word) => token === word || token.startsWith(`${word}_`)));
  if (has(["search", "retrieve", "query", "find", "browse", "web"])) return locale === "zh" ? "正在检索资料" : "Searching";
  if (has(["test", "check", "verify", "lint", "typecheck", "build"])) return locale === "zh" ? "正在验证" : "Testing";
  if (has(["write", "create", "update", "edit", "save", "delete", "remove"])) return locale === "zh" ? "正在写入内容" : "Writing";
  if (has(["read", "get", "fetch", "open", "list", "inspect"])) return locale === "zh" ? "正在读取内容" : "Reading";
  if (has(["run", "exec", "execute"])) return locale === "zh" ? "正在运行操作" : "Running";
  return locale === "zh" ? "正在执行操作" : "Running tools";
}

function isApproved(part: ToolActivityPart) {
  return part.state === "approval-responded" && part.approval?.approved === true;
}

function latestToolParts(parts: readonly ToolActivityPart[]) {
  const latest = new Map<string, ToolActivityPart>();
  for (const part of parts) latest.set(part.toolCallId, part);
  return [...latest.values()];
}

export function summarizeToolActivity(parts: readonly ToolActivityPart[], locale: "zh" | "en"): ToolActivitySummary {
  const latest = latestToolParts(parts);
  let active = 0;
  let completed = 0;
  let failed = 0;
  let denied = 0;
  const failedCallIds: string[] = [];

  for (const part of latest) {
    if (part.state === "output-available") {
      completed += 1;
    } else if (part.state === "output-error") {
      failed += 1;
      failedCallIds.push(part.toolCallId);
    } else if (part.state === "output-denied" || (part.state === "approval-responded" && part.approval?.approved === false)) {
      denied += 1;
    } else if (part.state === "input-streaming" || part.state === "input-available" || part.state === "approval-requested" || isApproved(part)) {
      active += 1;
    }
  }

  const hasWaiting = latest.some((part) => part.state === "approval-requested");
  const phase = hasWaiting ? "waiting" : active > 0 ? "running" : failed > 0 ? "failed" : denied > 0 ? "denied" : "completed";
  const activePart = latest.find((part) => part.state === "input-streaming" || part.state === "input-available" || isApproved(part));
  const operation = operationLabel(activePart?.toolName ?? latest[0]?.toolName ?? "", locale);
  let label: string;
  const extras = [
    failed > 0 ? (locale === "zh" ? `${failed} 项失败` : `${failed} failed`) : undefined,
    denied > 0 ? (locale === "zh" ? `${denied} 项被拒绝` : `${denied} denied`) : undefined,
  ].filter((value): value is string => Boolean(value));
  const suffix = extras.length ? ` · ${extras.join(" · ")}` : "";
  if (phase === "waiting") {
    label = (locale === "zh" ? "等待批准" : "Awaiting approval") + suffix;
  } else if (phase === "failed") {
    label = (locale === "zh" ? `${failed} 项失败 · 查看失败详情` : `${failed} failed · View failure details`) + (denied > 0 ? ` · ${locale === "zh" ? `${denied} 项被拒绝` : `${denied} denied`}` : "");
  } else if (phase === "denied") {
    label = (locale === "zh" ? `${denied} 项被拒绝 · 查看详情` : `${denied} denied · View details`) + (failed > 0 ? ` · ${locale === "zh" ? `${failed} 项失败` : `${failed} failed`}` : "");
  } else if (phase === "completed") {
    label = locale === "zh" ? `已完成 ${completed} 次操作 · 查看过程` : `Completed ${completed} operation${completed === 1 ? "" : "s"} · View activity`;
  } else if (completed > 0) {
    label = (locale === "zh" ? `${operation} · 已完成 ${completed} 次操作` : `${operation} · ${completed} completed`) + suffix;
  } else {
    label = operation + suffix;
  }

  return { label, phase, active, completed, failed, denied, total: latest.length, failedCallIds };
}

export function summarizeProcessActivity(parts: readonly ProcessActivityPart[], locale: "zh" | "en", active: boolean): ProcessActivitySummary {
  const reasoning = parts.filter((part): part is ReasoningActivityPart => part.type === "reasoning");
  const tools = parts.filter((part): part is ToolActivityPart => part.type === "dynamic-tool");
  const toolSummary = summarizeToolActivity(tools, locale);
  const reasoningActive = active && reasoning.some((part) => part.state === "streaming");
  const kind: ProcessActivitySummary["kind"] = reasoning.length && tools.length ? "mixed" : reasoning.length ? "reasoning" : "tools";

  if (kind === "mixed" && reasoningActive) {
    const count = locale === "zh" ? `${toolSummary.total} 次工具操作` : `${toolSummary.total} tool operation${toolSummary.total === 1 ? "" : "s"}`;
    const extras = [
      toolSummary.failed > 0 ? (locale === "zh" ? `${toolSummary.failed} 项失败` : `${toolSummary.failed} failed`) : undefined,
      toolSummary.denied > 0 ? (locale === "zh" ? `${toolSummary.denied} 项被拒绝` : `${toolSummary.denied} denied`) : undefined,
    ].filter((value): value is string => Boolean(value));
    const suffix = extras.length ? ` · ${extras.join(" · ")}` : "";
    return {
      ...toolSummary,
      label: `${locale === "zh" ? "正在思考" : "Thinking"}${toolSummary.total > 0 ? ` · ${count}` : ""}${suffix}`,
      phase: "running",
      kind,
      reasoningActive,
    };
  }

  if (kind === "reasoning") {
    return {
      ...toolSummary,
      label: reasoningActive ? (locale === "zh" ? "正在思考" : "Thinking") : (locale === "zh" ? "思考过程" : "Thinking process"),
      phase: reasoningActive ? "running" : "completed",
      kind,
      reasoningActive,
    };
  }

  if (kind === "tools" || toolSummary.failed > 0 || toolSummary.denied > 0 || toolSummary.phase === "waiting" || toolSummary.phase === "running") {
    const count = locale === "zh" ? `${toolSummary.total} 次工具操作` : `${toolSummary.total} tool operation${toolSummary.total === 1 ? "" : "s"}`;
    const latest = latestToolParts(tools);
    const activePart = latest.find((part) => part.state === "input-streaming" || part.state === "input-available" || isApproved(part));
    const operation = operationLabel(activePart?.toolName ?? latest[0]?.toolName ?? "", locale);
    const outcomes = [
      toolSummary.failed > 0 ? (locale === "zh" ? `${toolSummary.failed} 项失败` : `${toolSummary.failed} failed`) : undefined,
      toolSummary.denied > 0 ? (locale === "zh" ? `${toolSummary.denied} 项被拒绝` : `${toolSummary.denied} denied`) : undefined,
    ].filter((value): value is string => Boolean(value));
    const outcomeSuffix = outcomes.length ? ` · ${outcomes.join(" · ")}` : "";
    const label = toolSummary.phase === "waiting"
      ? `${locale === "zh" ? "等待批准" : "Awaiting approval"} · ${count}${outcomeSuffix}`
      : toolSummary.active > 0
        ? `${operation} · ${count}${outcomeSuffix}`
        : toolSummary.failed > 0 || toolSummary.denied > 0
          ? `${count}${outcomeSuffix}`
          : count;
    return { ...toolSummary, label, kind, reasoningActive };
  }

  const count = locale === "zh" ? `${toolSummary.total} 次工具操作` : `${toolSummary.total} tool operation${toolSummary.total === 1 ? "" : "s"}`;
  return {
    ...toolSummary,
    label: locale === "zh" ? `处理过程 · ${count}` : `Process · ${count}`,
    phase: reasoningActive ? "running" : toolSummary.phase,
    kind,
    reasoningActive,
  };
}
