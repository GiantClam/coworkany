import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchMessageSurface } from "@coworkany/workbench-ui/desktop";
import { createDesktopUIMessage, type DesktopUIMessage, type DesktopUIMessagePart } from "@coworkany/workbench-client";
import { WORKBENCH_THEME } from "../../../packages/workbench-ui/src/design-tokens";
import "../src/tailwind.css";
import "@coworkany/workbench-ui/styles.css";
import "../src/styles.css";
import "../src/native-questions.css";
import "../src/styles-macos.css";
import "./tool-activity-acceptance.css";

type ToolMode = "running" | "completed" | "mixed" | "approval" | "approval-first";
type RouteMode = "Chat" | "Agent" | "Writer";
type CoarseRuleRecord = { rule: CSSMediaRule; mediaText: string };
type FixtureApi = {
  setCount: (count: number) => void;
  appendCall: () => void;
  completeCalls: () => void;
  setMode: (mode: ToolMode) => void;
  setInterleaved: (value: boolean) => void;
  remount: () => void;
  restore: () => void;
};

type SpacingFixtureMode = "single" | "multi";

const params = new URLSearchParams(window.location.search);
const initialTheme: "light" | "dark" = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", initialTheme === "dark");
document.documentElement.dataset.desktopPlatform = params.get("platform") ?? "macos";
document.documentElement.dataset.fixturePresentation = params.get("presentation") ?? "false";

const countOptions = [1, 10, 50] as const;
const conversationId = "tool-activity-acceptance";
const baseTime = "2026-09-30T02:00:00.000Z";

function themeStyle(theme: "light" | "dark") {
  const tokens = Object.fromEntries(Object.entries(WORKBENCH_THEME[theme]).flatMap(([key, value]) => {
    const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return [[`--${name}`, value], [`--wb-${name}`, value]];
  })) as CSSProperties;
  Object.assign(tokens, {
    "--secondary": WORKBENCH_THEME[theme].muted,
    "--secondary-foreground": WORKBENCH_THEME[theme].foreground,
    "--accent": WORKBENCH_THEME[theme].muted,
    "--accent-foreground": WORKBENCH_THEME[theme].foreground,
  });
  return tokens;
}

function toolPart(index: number, mode: ToolMode, approvalDecision?: "approve" | "reject", question = false, longOutput = false): DesktopUIMessagePart {
  const toolCallId = `fixture-tool-${index + 1}`;
  const approvalIndex = mode === "approval-first" ? 0 : 2;
  const common = { type: "dynamic-tool" as const, toolName: question && index === 0 ? "question" : index % 3 === 0 ? "read_file" : index % 3 === 1 ? "search_files" : "inspect_symbol", toolCallId, input: question && index === 0 ? { questions: [{ prompt: "Which files should I inspect next?", options: ["Source", "Tests"] }] } : { path: `src/fixture-${index + 1}.ts`, ...(index % 3 === 1 ? { query: "tool activity" } : {}) } };
  const output = longOutput && index === 0 ? `${"Full tool output line. ".repeat(1200)}LONG_OUTPUT_SENTINEL_tool_activity_fixture` : { path: `src/fixture-${index + 1}.ts`, lines: 24 };
  if ((mode === "approval" || mode === "approval-first") && index === approvalIndex && !approvalDecision) return { ...common, state: "approval-requested", approval: { id: `approval-${toolCallId}` } };
  if (approvalDecision === "reject" && index === approvalIndex) return { ...common, state: "output-denied", approval: { id: `approval-${toolCallId}`, approved: false } };
  if (approvalDecision === "approve" && index === approvalIndex) return { ...common, state: "output-available", output };
  if (mode === "completed") return { ...common, state: "output-available", output };
  if (mode === "mixed") {
    if (index % 7 === 2) return { ...common, state: "approval-requested", approval: { id: `approval-${toolCallId}` } };
    if (index % 5 === 1) return { ...common, state: "output-error", errorText: "Fixture tool failed" };
    if (index % 3 === 0) return { ...common, state: "output-denied", approval: { id: `approval-${toolCallId}`, approved: false } };
    if (index % 2 === 0) return { ...common, state: "output-available", output };
  }
  return { ...common, state: "input-available" };
}

function buildAssistant(count: number, mode: ToolMode, interleaved: boolean, revision: number, approvalDecision?: "approve" | "reject", question = false, longOutput = false, toolOnly = false, route: RouteMode = "Chat", mixedReasoning = false, reasoningOnly = false, reasoningStreaming = false, emptyReasoning = false, longReasoning = false, screenshotChinese = false, reasoningAppend = 0, phaseWriting = false): DesktopUIMessage {
  const fixtureCount = screenshotChinese ? 5 : count;
  const tools = Array.from({ length: fixtureCount }, (_, index) => toolPart(index, mode, approvalDecision, question, longOutput));
  const reasoningText = longReasoning ? "Long reasoning detail. ".repeat(80) : "Checking the requested files and preserving the visible message order.";
  const reasoningPart = (id: string): DesktopUIMessagePart => ({ type: "reasoning", text: emptyReasoning ? "   " : reasoningText, state: reasoningStreaming ? "streaming" : "done", providerMetadata: { coworkany: { partId: id } } });
  const parts: DesktopUIMessagePart[] = phaseWriting
    ? [{ type: "text", text: "Writing the final response for the phase sequence.", state: "streaming", providerMetadata: { coworkany: { partId: "fixture-phase-writing" } } }]
    : reasoningOnly ? [reasoningPart("fixture-reasoning-only")] : toolOnly ? [] : [reasoningPart("fixture-reasoning")];
  if (phaseWriting) {
    // The phase sequence intentionally exposes one mounted writing part.
  } else if (reasoningOnly) {
    if (emptyReasoning) parts.push({ type: "reasoning", text: "   ", state: reasoningStreaming ? "streaming" : "done", providerMetadata: { coworkany: { partId: "fixture-empty-reasoning" } } });
  } else if (screenshotChinese) {
    parts.push({ type: "text", text: "先确认有没有现成的公司资料，避免重复问你已经有的事实。", state: "done", providerMetadata: { coworkany: { partId: "fixture-confirmation" } } });
    parts.push(...tools.slice(0, 2));
    parts.push({ type: "reasoning", text: "正在比较客户需求、价格和成交条件。", state: reasoningStreaming ? "streaming" : "done", providerMetadata: { coworkany: { partId: "fixture-screenshot-reasoning" } } });
    parts.push(...tools.slice(2));
    parts.push({ type: "text", text: "从0突破，先别铺渠道和招人。现在缺的是一条能成交的窄路径，不是增长系统。\n\n先做三件事，按这个顺序：\n\n1. **锁一个能付费的窄客户**\n\n   只选一个行业、一个角色、一个明确痛点。谁现在就在为这个问题花钱，就先卖给谁。\n\n2. **做一个能直接买的小单**\n\n   不要卖‘能力’或‘平台’。卖一个30天内能交付、价格清楚、结果可描述的起步包。价格要覆盖交付成本，并留下复购空间。\n\n3. **用创始人亲自成交验证**\n\n   先手动接触20个目标客户，目标不是曝光，是拿到3个付费或明确拒绝原因。成交路径跑通之前，不要投广告、不要建销售团队。\n\n这三步跑通之前，销售增长的瓶颈是‘没人愿意为这个具体东西付钱’，不是获客量。\n\n你现在卖的是什么，给谁，有没有已经付过钱的客户？", state: "done", providerMetadata: { coworkany: { partId: "fixture-screenshot-suggestions" } } });
  } else if (interleaved) {
    parts.push(...tools.slice(0, Math.ceil(count / 2)));
    parts.push({ type: "text", text: "The first batch is complete. I am continuing with the remaining calls.", state: "done", providerMetadata: { coworkany: { partId: "fixture-boundary" } } });
    parts.push(...tools.slice(Math.ceil(count / 2)));
  } else if (mixedReasoning) {
    parts.push(...tools.slice(0, Math.ceil(count / 2)));
    parts.push(reasoningPart("fixture-mixed-reasoning"));
    parts.push(...tools.slice(Math.ceil(count / 2)));
  } else {
    parts.push(...tools);
  }
  if (reasoningAppend > 0 && !reasoningOnly && tools.length > 0) {
    const lastToolIndex = parts.reduce((last, part, index) => part.type === "dynamic-tool" ? index : last, -1);
    if (lastToolIndex >= 0) parts.splice(lastToolIndex, 0, ...Array.from({ length: reasoningAppend }, (_, index) => reasoningPart(`fixture-appended-reasoning-${index + 1}`)));
  }
  if (!phaseWriting && !toolOnly && !reasoningOnly && !screenshotChinese) {
    parts.push({ type: "text", text: screenshotChinese ? `用户截图内容：请保留原始消息顺序。Fixture result revision ${revision}: typed output remains in its original position after tool activity.` : `Fixture result revision ${revision}: typed output remains in its original position after tool activity.`, state: "done", providerMetadata: { coworkany: { partId: "fixture-result" } } });
    parts.push({ type: "data-report", id: "fixture-report", data: { title: `${route} typed result`, body: "This report remains outside tool details and can be inspected independently." } });
  }
  if (params.get("repeatBoundary") === "true") {
    parts.splice(0, parts.length,
      { type: "dynamic-tool", toolCallId: "repeated-call", toolName: "read_file", state: "output-available", input: { path: "first.txt" }, output: "FIRST_INTERVAL_OUTPUT" },
      { type: "text", text: "Visible boundary between two lifecycle occurrences.", state: "done" },
      { type: "dynamic-tool", toolCallId: "repeated-call", toolName: "read_file", state: "output-available", input: { path: "second.txt" }, output: "SECOND_INTERVAL_OUTPUT" },
    );
  }
  const active = parts.some((part) => (part.type === "dynamic-tool" && (part.state === "input-available" || part.state === "approval-requested")) || (part.type === "reasoning" && part.state === "streaming") || (part.type === "text" && part.state === "streaming"));
  const message = createDesktopUIMessage({ id: "assistant-tool-activity", role: "assistant", conversationId, runId: "run-tool-activity", createdAt: baseTime });
  return { ...message, parts, metadata: { ...message.metadata!, route: route.toLowerCase(), runStatus: active ? "running" : "completed", lastSequence: revision } };
}

function buildHistory(includeReasoning = false, emptyReasoning = false) {
  return Array.from({ length: 16 }, (_, index) => {
    const answer = `Earlier answer ${index + 1}. This history is intentionally long enough to exercise manual scroll and the latest activity control.`;
    const assistant = createDesktopUIMessage({ id: `history-assistant-${index}`, role: "assistant", conversationId, content: answer, createdAt: `2026-09-30T01:${String(index).padStart(2, "0")}:01.000Z` });
    const historyAssistant: DesktopUIMessage = includeReasoning
      ? { ...assistant, parts: [
        { type: "reasoning", text: emptyReasoning ? "   " : "Restored historical reasoning.", state: "done", providerMetadata: { coworkany: { partId: `history-reasoning-${index}` } } },
        { type: "text", text: answer, state: "done", providerMetadata: { coworkany: { partId: `history-text-${index}` } } },
      ] }
      : assistant;
    return [
      createDesktopUIMessage({ id: `history-user-${index}`, role: "user", conversationId, content: `Earlier question ${index + 1}: inspect this conversation while tool activity runs.`, createdAt: `2026-09-30T01:${String(index).padStart(2, "0")}:00.000Z` }),
      historyAssistant,
    ];
  }).flat();
}

function buildSpacingAssistant(id: string, revision: number, sequence: number): DesktopUIMessage {
  const textPart = (text: string, partId: string): DesktopUIMessagePart => ({ type: "text", text, state: "done", providerMetadata: { coworkany: { partId } } });
  const reasoningPart = (text: string, partId: string): DesktopUIMessagePart => ({ type: "reasoning", text, state: "done", providerMetadata: { coworkany: { partId } } });
  const tool = (index: number): DesktopUIMessagePart => ({
    type: "dynamic-tool",
    toolCallId: `${id}-tool-${index}`,
    toolName: index % 2 ? "search_files" : "read_file",
    input: { path: `src/spacing-${index}.ts` },
    output: { path: `src/spacing-${index}.ts`, lines: 12 },
    state: "output-available",
  });
  const parts: DesktopUIMessagePart[] = [
    textPart(sequence === 1 ? "先从公司诊断切入，再判断运营该怎么做。" : sequence === 2 ? "先看产品和诊断框架，再判断流量少到底卡在哪。" : "站点能看清产品，接着补增长和品牌判断，并核对公开渠道。", `${id}-primary-1`),
    tool(1),
    reasoningPart("比较当前资料和可验证的成交路径。", `${id}-reasoning-1`),
    tool(2),
    textPart("先看产品和诊断框架，再判断流量少到底卡在哪。", `${id}-primary-2`),
    reasoningPart("检查结果之间是否存在冲突。", `${id}-reasoning-2`),
    tool(3),
    textPart("站点能看清产品，接着补增长和品牌判断，并核对公开渠道。", `${id}-primary-3`),
    { type: "reasoning", text: "   ", state: "done", providerMetadata: { coworkany: { partId: `${id}-empty-bookkeeping` } } },
    { type: "data-report", id: `${id}-report`, data: { title: `Bookkeeping result ${revision}`, body: "This bookkeeping result remains a visible boundary." } },
  ];
  const message = createDesktopUIMessage({ id, role: "assistant", conversationId, createdAt: `2026-09-30T02:0${sequence}:00.000Z` });
  return { ...message, parts, metadata: { ...message.metadata!, route: "chat", runStatus: "completed", lastSequence: revision } };
}

function findCoarsePointerRules(): CoarseRuleRecord[] {
  const found: CoarseRuleRecord[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSMediaRule && rule.media.mediaText.includes("pointer: coarse")) found.push({ rule, mediaText: rule.media.mediaText });
      }
    } catch {
      // Cross-origin sheets are outside the fixture's control.
    }
  }
  return found;
}

function restoreCoarsePointerRules(records: readonly CoarseRuleRecord[]) {
  for (const record of records) {
    try { record.rule.media.mediaText = record.mediaText; } catch { /* stylesheet may have been replaced by HMR */ }
  }
}

function AcceptanceFixture() {
  const [count, setCount] = useState<number>(() => params.get("screenshotChinese") === "true" ? 5 : Number(params.get("count")) || 10);
  const [mode, setMode] = useState<ToolMode>((params.get("mode") as ToolMode) || "running");
  const [interleaved, setInterleaved] = useState(params.get("interleaved") === "true");
  const [locale, setLocale] = useState<"zh" | "en">(params.get("locale") === "zh" ? "zh" : "en");
  const [workflowAi, setWorkflowAi] = useState(params.get("workflowAi") === "true");
  const [revision, setRevision] = useState(0);
  const [mount, setMount] = useState(0);
  const [restored, setRestored] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState<"approve" | "reject">();
  const [longOutput, setLongOutput] = useState(false);
  const [toolOnly, setToolOnly] = useState(false);
  const [question, setQuestion] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [route, setRoute] = useState<RouteMode>("Chat");
  const [mixedReasoning, setMixedReasoning] = useState(params.get("mixedReasoning") === "true");
  const [reasoningOnly, setReasoningOnly] = useState(params.get("reasoningOnly") === "true");
  const [reasoningStreaming, setReasoningStreaming] = useState(params.get("reasoningStreaming") === "true");
  const [emptyReasoning, setEmptyReasoning] = useState(params.get("emptyReasoning") === "true");
  const [historyReasoning, setHistoryReasoning] = useState(params.get("historyReasoning") === "true");
  const [longReasoning, setLongReasoning] = useState(params.get("longReasoning") === "true");
  const [screenshotChinese, setScreenshotChinese] = useState(params.get("screenshotChinese") === "true");
  const [narrowStage, setNarrowStage] = useState(params.get("narrow") === "true");
  const [reasoningAppend, setReasoningAppend] = useState(0);
  const [phaseSequenceActive, setPhaseSequenceActive] = useState(false);
  const [phaseStep, setPhaseStep] = useState(0);
  const [phaseWriting, setPhaseWriting] = useState(false);
  const [coarsePointerActive, setCoarsePointerActive] = useState(false);
  const [coarsePointerError, setCoarsePointerError] = useState("");
  const [coarsePointerRules, setCoarsePointerRules] = useState<CoarseRuleRecord[]>([]);
  const [spacingMode, setSpacingMode] = useState<SpacingFixtureMode | null>(() => {
    const value = params.get("spacing");
    return value === "single" || value === "multi" ? value : null;
  });
  const [textScale, setTextScale] = useState(params.get("textScale") === "200");
  const [metrics, setMetrics] = useState("Press Refresh metrics after mounting the process surface.");
  const phaseEvidence = useRef<{ node: Element | null; replacements: number; labels: string[] }>({ node: null, replacements: 0, labels: [] });
  useEffect(() => {
    const record = () => {
      const node = document.querySelector("[data-slot='phase-announcement']");
      const evidence = phaseEvidence.current;
      if (node && evidence.node && evidence.node !== node) evidence.replacements += 1;
      evidence.node = node;
      const label = node?.textContent?.trim() ?? "";
      if (evidence.labels.at(-1) !== label) evidence.labels.push(label);
    };
    const observer = new MutationObserver(record);
    observer.observe(document.getElementById("root")!, { subtree: true, childList: true, characterData: true });
    record();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!phaseSequenceActive) return undefined;
    const timer = globalThis.setTimeout(() => {
      if (phaseStep === 0) setPhaseStep(1);
      else if (phaseStep === 1) setPhaseStep(2);
      else {
        setPhaseStep(3);
        setPhaseWriting(false);
        setMode("completed");
        setReasoningStreaming(false);
        setPhaseSequenceActive(false);
      }
    }, 12000);
    return () => globalThis.clearTimeout(timer);
  }, [phaseSequenceActive, phaseStep]);
  useEffect(() => {
    if (!phaseSequenceActive) return;
    if (phaseStep === 0) {
      setReasoningOnly(true); setReasoningStreaming(true); setMixedReasoning(false); setPhaseWriting(false); setMode("running");
    } else if (phaseStep === 1) {
      setReasoningOnly(false); setReasoningStreaming(false); setMixedReasoning(true); setPhaseWriting(false); setMode("running"); setCount(10);
    } else if (phaseStep === 2) {
      setReasoningOnly(false); setMixedReasoning(false); setPhaseWriting(true); setReasoningStreaming(false);
    }
  }, [phaseSequenceActive, phaseStep]);
  useEffect(() => () => restoreCoarsePointerRules(coarsePointerRules), [coarsePointerRules]);
  useEffect(() => {
    document.documentElement.style.fontSize = textScale ? "200%" : "";
    return () => { document.documentElement.style.fontSize = ""; };
  }, [textScale]);
  const message = useMemo(() => buildAssistant(count, mode, interleaved, revision, approvalDecision, question, longOutput, toolOnly, route, mixedReasoning, reasoningOnly, reasoningStreaming, emptyReasoning, longReasoning, screenshotChinese, reasoningAppend, phaseWriting), [count, mode, interleaved, revision, approvalDecision, question, longOutput, toolOnly, route, mixedReasoning, reasoningOnly, reasoningStreaming, emptyReasoning, longReasoning, screenshotChinese, reasoningAppend, phaseWriting]);
  const spacingMessages: DesktopUIMessage[] | null = spacingMode === "single"
    ? [createDesktopUIMessage({ id: "spacing-user-1", role: "user", conversationId, content: "请检查这组间距和过程顺序。", createdAt: "2026-09-30T01:59:00.000Z" }), buildSpacingAssistant("spacing-assistant-1", revision, 1)]
    : spacingMode === "multi"
      ? [
        createDesktopUIMessage({ id: "spacing-user-1", role: "user", conversationId, content: "请检查第一轮诊断。", createdAt: "2026-09-30T01:59:00.000Z" }),
        buildSpacingAssistant("spacing-assistant-1", revision, 1),
        buildSpacingAssistant("spacing-assistant-2", revision, 2),
        createDesktopUIMessage({ id: "spacing-user-2", role: "user", conversationId, content: "继续检查第二轮结果。", createdAt: "2026-09-30T02:05:00.000Z" }),
        buildSpacingAssistant("spacing-assistant-3", revision, 3),
      ]
      : null;
  const messages: DesktopUIMessage[] = spacingMessages ?? [...buildHistory(historyReasoning, emptyReasoning), createDesktopUIMessage({ id: "user-tool-activity", role: "user", conversationId, content: screenshotChinese ? "用户截图：请检查这段中文内容并保持顺序。" : "Inspect the tool activity and keep the useful result visible.", createdAt: "2026-09-30T01:59:00.000Z" }), message];
  const runPhaseSequence = () => { phaseEvidence.current.labels = []; phaseEvidence.current.replacements = 0; setPhaseStep(0); setPhaseWriting(false); setPhaseSequenceActive(true); };
  const toggleCoarsePointer = () => {
    if (coarsePointerActive) {
      restoreCoarsePointerRules(coarsePointerRules);
      setCoarsePointerRules([]);
      setCoarsePointerActive(false);
      setCoarsePointerError("");
      return;
    }
    const rules = findCoarsePointerRules();
    if (!rules.length) { setCoarsePointerError("No local (pointer: coarse) CSSMediaRule was found."); return; }
    try {
      for (const record of rules) record.rule.media.mediaText = "all";
      setCoarsePointerRules(rules);
      setCoarsePointerActive(true);
      setCoarsePointerError("");
    } catch { restoreCoarsePointerRules(rules); setCoarsePointerError("Could not activate local coarse-pointer CSSMediaRule."); }
  };
  const refreshMetrics = () => {
    const trigger = document.querySelector<HTMLElement>("[data-slot='tool-activity-trigger']");
    const spinner = document.querySelector<HTMLElement>(".wb-ai-tool-activity-icon.is-running, .wb-ai-process-spinner");
    const viewport = Array.from(document.querySelectorAll<HTMLElement>(".ai-elements-conversation-viewport, .ai-elements-conversation-viewport *")).find((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === "auto");
    const statuses = Array.from(document.querySelectorAll<HTMLElement>("[role='status']")).map((node) => node.textContent?.trim()).filter(Boolean);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const announcer = document.querySelector("[data-slot='phase-announcement']");
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().height > 0;
    };
    const assistantOutputs = [...document.querySelectorAll<HTMLElement>(".ai-elements-message-assistant .wb-ai-message-output")];
    const outputGutters = assistantOutputs.flatMap((output) => {
      const blocks = [...output.children].filter((element): element is HTMLElement => element instanceof HTMLElement && visible(element));
      return blocks.slice(1).map((block, index) => {
        const previous = blocks[index];
        return { from: previous?.dataset.outputKind ?? "unknown", to: block.dataset.outputKind ?? "unknown", value: previous ? block.getBoundingClientRect().top - previous.getBoundingClientRect().bottom : 0 };
      });
    });
    const rows = [...document.querySelectorAll<HTMLElement>(".wb-ai-message-row")].filter(visible);
    const rowGutters = rows.slice(1).map((row, index) => ({ from: rows[index].classList.contains("wb-ai-message-row-user") ? "user" : "assistant", to: row.classList.contains("wb-ai-message-row-user") ? "user" : "assistant", value: row.getBoundingClientRect().top - rows[index].getBoundingClientRect().bottom, sameTurn: rows[index].closest("[data-message-turn-id]")?.getAttribute("data-message-turn-id") === row.closest("[data-message-turn-id]")?.getAttribute("data-message-turn-id") }));
    const closedFootprints = [...document.querySelectorAll("[data-slot='tool-activity-list'], [data-slot='reasoning-content']")].filter((element) => element.closest("[data-state='closed'], [aria-expanded='false']")).map((element) => ({ ...box(element), margin: getComputedStyle(element).margin, padding: getComputedStyle(element).padding }));
    const openHeaderDetails = [...document.querySelectorAll(".wb-ai-tool-activity-header")].flatMap((header) => {
      const detail = header.nextElementSibling;
      return detail && visible(detail) ? [{ gutter: detail.getBoundingClientRect().top - header.getBoundingClientRect().bottom, stepGap: getComputedStyle(detail).gap }] : [];
    });
    const coordinates = (rect: DOMRect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    const inside = (part: ReturnType<typeof coordinates>, bounds: ReturnType<typeof coordinates>) => part.left >= bounds.left - 1 && part.right <= bounds.right + 1 && part.top >= bounds.top - 1 && part.bottom <= bounds.bottom + 1;
    const metadata = [...document.querySelectorAll(".wb-ai-message-header")].map((header) => {
      const bounds = coordinates(header.getBoundingClientRect());
      const content = header.closest(".ai-elements-message-content")!;
      const parts = [...header.children].map((part) => {
        const range = document.createRange();
        range.selectNodeContents(part);
        const fragments = [...range.getClientRects()].map(coordinates);
        const rect = part.getBoundingClientRect();
        const style = getComputedStyle(part);
        const partVisible = style.display !== "none" && style.visibility === "visible" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 && fragments.length > 0;
        return { text: part.textContent, dateTime: part.getAttribute("datetime"), ariaLabel: part.getAttribute("aria-label"), title: part.getAttribute("title"), visible: partVisible, fragments, inside: inside(coordinates(rect), bounds) && fragments.every((fragment) => inside(fragment, bounds)) };
      });
      const overlap = parts[0].fragments.some((role) => parts[1].fragments.some((time) => role.left < time.right - 1 && time.left < role.right - 1 && role.top < time.bottom - 1 && time.top < role.bottom - 1));
      return { role: header.closest(".wb-ai-message-row")?.classList.contains("wb-ai-message-row-user") ? "user" : "assistant", createdAt: header.getAttribute("data-message-created-at"), visible: visible(header) && Number(getComputedStyle(header).opacity) > 0, parts, inside: inside(bounds, coordinates(content.getBoundingClientRect())) && parts.every((part) => part.inside), overlap };
    });
    setMetrics(JSON.stringify({ reducedMotion: reduced, coarsePointer: coarse, coarsePointerRuleSimulation: coarsePointerActive, rootFont: getComputedStyle(document.documentElement).fontSize, triggerFont: trigger ? getComputedStyle(trigger).fontSize : "missing", triggerLine: trigger ? getComputedStyle(trigger).lineHeight : "missing", triggerHeight: trigger ? `${trigger.getBoundingClientRect().height}px` : "missing", spinnerAnimation: spinner ? getComputedStyle(spinner).animationName : "missing", ariaStatusCount: document.querySelectorAll("[role='status']").length, ariaStatusText: statuses, announcerInsideBusy: Boolean(announcer?.closest("[aria-busy='true']")), phaseNodeReplacements: phaseEvidence.current.replacements, phaseLabels: phaseEvidence.current.labels, scrollTop: viewport?.scrollTop ?? null, focused: document.activeElement instanceof HTMLElement ? document.activeElement.outerHTML.slice(0, 160) : document.activeElement?.nodeName ?? null, spacing: { outputGutters, rowGutters, closedFootprints, openHeaderDetails }, metadata }, null, 2));
  };
  const api: FixtureApi = {
    setCount,
    appendCall: () => setCount((value) => value + 1),
    completeCalls: () => { setMode("completed"); setReasoningStreaming(false); },
    setMode,
    setInterleaved,
    remount: () => setMount((value) => value + 1),
    restore: () => { setRestored(true); setMount((value) => value + 1); },
  };
  (window as Window & { __toolActivityFixture?: FixtureApi }).__toolActivityFixture = api;
  document.documentElement.classList.toggle("dark", theme === "dark");
  return <div className={`tool-activity-shell${reducedMotion ? " reduced-motion" : ""}`} style={themeStyle(theme)} data-fixture-locale={locale} data-fixture-workflow-ai={workflowAi ? "true" : "false"} data-fixture-reduced-motion={reducedMotion ? "true" : "false"} data-fixture-route={route} onKeyDown={(event) => {
    if (!event.altKey) return;
    if (event.key.toLowerCase() === "a") { setMode("approval-first"); setApprovalDecision(undefined); }
    if (event.key.toLowerCase() === "m") { setMode("approval"); setApprovalDecision(undefined); }
    if (event.key.toLowerCase() === "r") { setMode("running"); setApprovalDecision(undefined); }
    if (event.key.toLowerCase() === "n") setReasoningAppend((value) => value + 1);
  }}>
    <nav className="tool-activity-controls" aria-label="Tool activity fixture controls">
      <span>tool activity · <span data-testid="call-count">{count}</span> calls · <span data-testid="tool-mode">{mode}</span></span>
      {countOptions.map((value) => <button key={value} type="button" data-testid={`count-${value}`} aria-pressed={count === value} onClick={() => setCount(value)}>{value} calls</button>)}
      <button type="button" data-testid="append-call" onClick={api.appendCall}>Append call</button>
      <button type="button" data-testid="complete-calls" onClick={api.completeCalls}>Complete calls</button>
      <button type="button" data-testid="mixed-outcomes" onClick={() => setMode("mixed")}>Mixed outcomes</button>
      <button type="button" data-testid="approval-transition" onClick={() => { setMode("approval"); setApprovalDecision(undefined); }}>Approval transition</button>
      <button type="button" data-testid="approval-first" onClick={() => { setMode("approval-first"); setApprovalDecision(undefined); }}>Approve first call</button>
      <button type="button" data-testid="long-output" onClick={() => setLongOutput((value) => !value)} aria-pressed={longOutput}>Long output</button>
      <button type="button" data-testid="tool-only" onClick={() => setToolOnly((value) => !value)} aria-pressed={toolOnly}>Tool only</button>
      <button type="button" data-testid="mixed-reasoning" onClick={() => setMixedReasoning((value) => !value)} aria-pressed={mixedReasoning}>Mixed reasoning</button>
      <button type="button" data-testid="reasoning-only" onClick={() => setReasoningOnly((value) => !value)} aria-pressed={reasoningOnly}>Reasoning only</button>
      <button type="button" data-testid="reasoning-streaming" onClick={() => setReasoningStreaming((value) => !value)} aria-pressed={reasoningStreaming}>Reasoning active</button>
      <button type="button" data-testid="empty-reasoning" onClick={() => setEmptyReasoning((value) => !value)} aria-pressed={emptyReasoning}>Empty reasoning</button>
      <button type="button" data-testid="history-reasoning" onClick={() => setHistoryReasoning((value) => !value)} aria-pressed={historyReasoning}>History reasoning</button>
      <button type="button" data-testid="long-reasoning" onClick={() => setLongReasoning((value) => !value)} aria-pressed={longReasoning}>Long reasoning</button>
      <button type="button" data-testid="screenshot-chinese" onClick={() => setScreenshotChinese((value) => { const next = !value; if (next) setCount(5); return next; })} aria-pressed={screenshotChinese}>Chinese screenshot</button>
      <button type="button" data-testid="spacing-single" onClick={() => setSpacingMode("single")} aria-pressed={spacingMode === "single"}>Spacing single</button>
      <button type="button" data-testid="spacing-multi" onClick={() => setSpacingMode("multi")} aria-pressed={spacingMode === "multi"}>Spacing multi</button>
      <button type="button" data-testid="spacing-default" onClick={() => setSpacingMode(null)} aria-pressed={spacingMode === null}>Spacing default</button>
      <button type="button" data-testid="text-scale-200" onClick={() => setTextScale((value) => !value)} aria-pressed={textScale}>Text size 200%</button>
      <button type="button" data-testid="narrow-stage" onClick={() => setNarrowStage((value) => !value)} aria-pressed={narrowStage}>Narrow stage</button>
      <button type="button" data-testid="question" onClick={() => setQuestion((value) => !value)} aria-pressed={question}>Question</button>
      <button type="button" data-testid="interleave" onClick={() => setInterleaved((value) => !value)} aria-pressed={interleaved}>Interleave text</button>
      <button type="button" data-testid="locale" onClick={() => setLocale((value) => value === "en" ? "zh" : "en")}>Locale: {locale}</button>
      <button type="button" data-testid="workflow-ai" onClick={() => setWorkflowAi((value) => !value)} aria-pressed={workflowAi}>Workflow AI</button>
      <button type="button" data-testid="theme" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}>Theme: {theme}</button>
      <button type="button" data-testid="reduced-motion" onClick={() => setReducedMotion((value) => !value)} aria-pressed={reducedMotion}>Reduced motion</button>
      <label>Route <select data-testid="route" value={route} onChange={(event) => setRoute(event.target.value as RouteMode)}><option>Chat</option><option>Agent</option><option>Writer</option></select></label>
      {(["Chat", "Agent", "Writer"] as const).map((value) => <button key={value} type="button" data-testid={`route-${value.toLowerCase()}`} aria-pressed={route === value} onClick={() => setRoute(value)}>{value} route</button>)}
      <button type="button" data-testid="remount" onClick={api.remount}>Remount</button>
      <button type="button" data-testid="restore" onClick={api.restore}>Restore conversation</button>
      <button type="button" data-testid="scroll-up" onClick={(event) => {
        const shell = event.currentTarget.closest(".tool-activity-shell");
        const viewport = Array.from(shell?.querySelectorAll<HTMLElement>(".ai-elements-conversation-viewport, .ai-elements-conversation-viewport *") ?? []).find((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === "auto");
        if (viewport) viewport.scrollTop = Math.max(0, viewport.scrollTop - 600);
      }}>Scroll up</button>
      <button type="button" data-testid="append-activity" onClick={() => setRevision((value) => value + 1)}>Append activity</button>
      <button type="button" data-testid="append-reasoning" onClick={() => setReasoningAppend((value) => value + 1)}>Append reasoning</button>
      <button type="button" data-testid="phase-sequence" onClick={runPhaseSequence}>Run phase sequence</button>
      <button type="button" data-testid="coarse-pointer" onClick={toggleCoarsePointer}>Coarse pointer rules</button>
      <button type="button" data-testid="refresh-metrics" onClick={refreshMetrics}>Refresh metrics</button>
      <span data-testid="phase-indicator" aria-label={`Current fixture phase: ${phaseStep === 0 && phaseSequenceActive ? "reasoning" : phaseStep === 1 ? "tools" : phaseStep === 2 ? "writing" : phaseStep === 3 ? "completed" : mode}`}>Phase: {phaseStep === 0 && phaseSequenceActive ? "reasoning" : phaseStep === 1 ? "tools" : phaseStep === 2 ? "writing" : phaseStep === 3 ? "completed" : mode}</span>
      {coarsePointerError ? <span data-testid="coarse-pointer-error">{coarsePointerError}</span> : null}
      <textarea data-testid="native-verification-metrics" aria-label="Native verification metrics" readOnly rows={4} value={metrics} />
      {restored ? <span data-testid="restored-state">restored</span> : null}
      <small data-testid="keyboard-hint">Fixture shortcuts: Alt+A first approval · Alt+M middle approval · Alt+R running</small>
      <textarea aria-label="Clipboard verification" placeholder="Paste a copied tool result to verify completeness" rows={1} />
    </nav>
      <main className={`tool-activity-stage${narrowStage ? " narrow-stage" : ""}`} key={mount}>
      <WorkbenchMessageSurface messages={params.get("presentation") === "true" && !spacingMode ? [message] : messages} pendingMessageId={message.metadata?.runStatus === "running" ? message.id : undefined} locale={locale} workflowAi={workflowAi} restoreScrollTop={restored ? 420 : undefined} scrollStateKey="tool-activity-fixture" onCopy={() => undefined} onRetry={() => undefined} onToolApproval={(_, part, decision) => { if (part.toolCallId === "fixture-tool-1" || part.toolCallId === "fixture-tool-3") setApprovalDecision(decision); }} />
    </main>
  </div>;
}

const root = createRoot(document.getElementById("root")!);
root.render(<AcceptanceFixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
