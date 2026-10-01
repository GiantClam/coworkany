import React, { useState, type CSSProperties, type ReactNode } from "react";
import { advanceAssistantTurn, beginAssistantTurn, createDesktopUIMessage, type DesktopUIMessage, type DesktopUIMessagePart, type WorkbenchRunEvent } from "@coworkany/workbench-client";
import { WORKBENCH_THEME } from "../../../packages/workbench-ui/src/design-tokens";
import interleavedEvents from "../../../packages/workbench-client/test/fixtures/assistant-turn-interleaved.json";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
const scenario = params.get("scenario") ?? "default";
document.documentElement.dataset.desktopPlatform = params.get("platform") ?? "macos";
document.documentElement.classList.toggle("dark", theme === "dark");

const themeStyle = Object.fromEntries(Object.entries(WORKBENCH_THEME[theme]).flatMap(([key, value]) => {
  const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return [[`--${name}`, value], [`--wb-${name}`, value]];
})) as CSSProperties;
// The shell secondary token is for brand controls; chat uses neutral surfaces.
Object.assign(themeStyle, { "--secondary": WORKBENCH_THEME[theme].muted, "--secondary-foreground": WORKBENCH_THEME[theme].foreground, "--accent": WORKBENCH_THEME[theme].muted, "--accent-foreground": WORKBENCH_THEME[theme].foreground });

export function AcceptanceHarness({ view, children }: { view: string; children: (messages: DesktopUIMessage[], pendingMessageId?: string) => ReactNode }) {
  const storageKey = `message-visual-acceptance:${view}:${theme}:${scenario}`;
  const [step, setStep] = useState(() => Number(params.get("step") ?? sessionStorage.getItem(storageKey) ?? 3));
  const [revision, setRevision] = useState(0);
  const [mount, setMount] = useState(0);
  const events = (interleavedEvents as WorkbenchRunEvent[]).slice(0, step);
  let active = events.reduce(advanceAssistantTurn, beginAssistantTurn({ kind: "new", id: "assistant-acceptance", conversationId: "conversation-acceptance", runId: "run-acceptance", createdAt: "2026-09-29T01:00:00.000Z" }));
  active = { ...active, metadata: { ...active.metadata!, lastSequence: (active.metadata?.lastSequence ?? 0) + revision } };
  if (scenario === "markdown" && step >= 5) {
    active = { ...active, parts: active.parts.map((part, index) => part.type === "text" && index > 1 ? { ...part, text: `## Result\n\n**Ordered** output with \`inline code\`.\n\n- First item\n- Second item\n\n> A quoted result.\n\n| Name | Value |\n| --- | --- |\n| order | preserved |\n\n\`\`\`ts\nconst answer = ${step === 5 ? "" : "42;\n```"}` } : part) };
  }
  if (["approval", "error", "denied"].includes(scenario) && step >= 4) {
    active = { ...active, parts: active.parts.map<DesktopUIMessagePart>((part) => {
      if (part.type !== "dynamic-tool") return part;
      const base = { type: "dynamic-tool" as const, toolName: part.toolName, toolCallId: part.toolCallId, input: part.input };
      if (scenario === "approval") return { ...base, state: "approval-requested", approval: { id: "approval-fixture" } };
      if (scenario === "error") return { ...base, state: "output-error", errorText: "Fixture tool failed" };
      return { ...base, state: "output-denied", approval: { id: "approval-fixture", approved: false } };
    }) };
  }
  if (scenario === "usage") {
    active = { ...active, parts: [...active.parts, ...[[1200, 250], [3200, 500], [4000, 642], [300, 100]].map(([inputTokens, outputTokens], index): DesktopUIMessagePart => ({
      type: "data-usage",
      id: `usage:step-${index}`,
      data: { runId: "run-acceptance", model: "fixture-model", inputTokens, outputTokens },
    }))] };
  }
  const history = scenario === "scroll" || scenario === "restore" ? Array.from({ length: 12 }, (_, index) => [
    createDesktopUIMessage({ id: `user-${index}`, role: "user", conversationId: "conversation-acceptance", content: `Question ${index + 1}: preserve my manual scroll position.`, createdAt: `2026-09-29T00:${String(index).padStart(2, "0")}:00.000Z` }),
    createDesktopUIMessage({ id: `assistant-${index}`, role: "assistant", conversationId: "conversation-acceptance", content: `Answer ${index + 1}. The same message can grow while I read earlier content. This history uses the production scroll container.`, createdAt: `2026-09-29T00:${String(index).padStart(2, "0")}:01.000Z` }),
  ]).flat() : [];
  const question = createDesktopUIMessage({ id: "user-acceptance", role: "user", conversationId: "conversation-acceptance", content: "Check the implementation and explain the result.", createdAt: "2026-09-29T00:59:00.000Z" });
  const advance = (next: number) => { sessionStorage.setItem(storageKey, String(next)); setStep(next); };
  return <div className="shell" style={themeStyle} data-acceptance-view={view}>
    <nav className="acceptance-controls" aria-label="Fixture state controls">
      <span>{view} · {theme} · step <output data-testid="step">{step}</output></span>
      <button data-testid="reset" onClick={() => { advance(1); setMount((value) => value + 1); }}>Reasoning</button>
      <button data-testid="advance" onClick={() => advance(Math.min(7, step + 1))}>Next event</button>
      <button data-testid="complete" onClick={() => advance(7)}>Complete</button>
      <button data-testid="remount" onClick={() => setMount((value) => value + 1)}>Remount</button>
      <button data-testid="append-activity" onClick={() => setRevision((value) => value + 1)}>Same-message activity</button>
    </nav>
    <main className="acceptance-stage" key={mount}>
      {children([...history, question, active], step < 7 ? active.id : undefined)}
    </main>
  </div>;
}
