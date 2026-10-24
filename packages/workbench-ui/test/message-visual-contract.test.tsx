import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Message, MessageContent, Reasoning, Tool } from "../src/ai-elements";

test("message retains upstream flex hierarchy and typography", () => {
  const markup = renderToStaticMarkup(<Message from="assistant"><MessageContent>Answer</MessageContent></Message>);
  assert.match(markup, /group flex w-full max-w-\[95%\] flex-col gap-2/);
  assert.match(markup, /flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm/);
});

test("reasoning uses the upstream brain/label/chevron row without an extra status badge", () => {
  const markup = renderToStaticMarkup(<Reasoning text="Analyze sources" isStreaming locale="en" />);
  assert.match(markup, /flex w-full items-center gap-2 text-muted-foreground text-sm/);
  assert.match(markup, /lucide-brain/);
  assert.doesNotMatch(markup, /wb-ai-process-status/);
});

test("tool retains upstream border/header/status layout and hides raw call identity", () => {
  const markup = renderToStaticMarkup(<Tool toolName="search" toolCallId="internal-tool-call-secret" status="completed" locale="en" />);
  assert.match(markup, /group not-prose mb-4 w-full rounded-md border/);
  assert.match(markup, /flex w-full items-center justify-between gap-4 p-3/);
  assert.match(markup, /data-tool-call-id="internal-tool-call-secret"/);
  assert.doesNotMatch(markup.replace(/<[^>]*>/g, ""), /internal-tool-call-secret/);
});

test("desktop semantic theme and acceptance fixture include real production styling", () => {
  const tailwind = readFileSync(new URL("../../../apps/desktop/src/tailwind.css", import.meta.url), "utf8");
  for (const token of ["foreground", "muted-foreground", "secondary", "border", "popover-foreground"]) {
    assert.match(tailwind, new RegExp(`--color-${token}:`));
  }
  const fixture = readFileSync(new URL("../../../apps/desktop/test/assistant-turn-acceptance.tsx", import.meta.url), "utf8");
  for (const name of ["styles.css", "native-questions.css", "styles-macos.css"]) {
    assert.ok(fixture.includes(`../src/${name}`), `missing desktop stylesheet ${name}`);
  }
});

test("process hierarchy overrides are scoped and preserve pinned primitives", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.wb-ai-message-surface\s+\.ai-elements-message-assistant\s+\.wb-ai-output-block\s*>\s*\.ai-elements-message-response\s*\{[^}]*font-size:\s*1rem;[^}]*line-height:\s*1\.65/s);
  assert.match(styles, /\.wb-ai-message-surface\s+\.ai-elements-message-assistant\s+\.wb-ai-message-output\s*\{[^}]*gap:\s*0/s);
  for (const [from, to, gutter] of [["process", "process", ".25rem"], ["primary", "process", ".5rem"], ["process", "primary", ".75rem"]]) {
    assert.ok(styles.includes(`[data-output-kind="${from}"] + [data-output-kind="${to}"] { margin-top: ${gutter}; }`));
  }
  assert.match(styles, /\.wb-ai-process-reasoning\s*\{[^}]*margin:\s*0/s);
  assert.match(styles, /\.wb-ai-process-reasoning\s+\.ai-elements-reasoning-content\s*\{[^}]*max-height:\s*200px/s);
  assert.match(styles, /\.wb-ai-tool-activity-list\s*\{[^}]*gap:\s*\.25rem/s);
  assert.match(styles, /\.wb-ai-tool-activity-trigger,\s*\.wb-ai-message-surface \.wb-ai-tool-activity-call-trigger\s*\{[^}]*min-height:\s*32px;[^}]*line-height:\s*1\.25rem/s);
  assert.match(styles, /\.wb-ai-tool-activity-trigger[^}]*font-size:\s*\.8125rem/s);
  const source = readFileSync(new URL("../src/ai-elements/official/reasoning.tsx", import.meta.url), "utf8");
  assert.match(source, /not-prose mb-4/);
  assert.match(source, /BrainIcon/);
});

test("scaled Workbench metadata can wrap without hiding role or timestamp", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.wb-ai-message-surface \.wb-ai-message-header\s*\{[^}]*flex-wrap:\s*wrap;[^}]*min-width:\s*0/s);
  assert.match(styles, /\.wb-ai-message-surface \.wb-ai-message-role\s*\{[^}]*flex-shrink:\s*0/s);
  assert.match(styles, /\.wb-ai-message-surface \.wb-ai-message-time\s*\{[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal/s);
});
