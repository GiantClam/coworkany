# Compact AI Chat Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI Entry composer with a one-to-three-line AI Elements input that combines model and reasoning selection and puts file upload plus knowledge selection behind one add menu.

**Architecture:** Extend the shared AI Elements textarea with opt-in compact sizing and Enter-to-send behavior so existing consumers keep their current behavior. Add a focused shared model/reasoning selector, then compose those primitives in AI Entry while leaving attachment parsing, knowledge state, persistence, and request construction in the workspace component.

**Tech Stack:** React 18, TypeScript, Next.js, Radix UI, cmdk, AI Elements primitives, Node test runner, Playwright Python smoke tests, CSS.

## Global Constraints

- Empty composer height must be no more than 56px when no context chips are present.
- The textarea starts at one line, grows to three lines, and scrolls internally from the fourth line.
- The primary row contains only add, textarea, combined model/reasoning, and submit/stop controls.
- File upload and knowledge selection must both be reachable from the add menu.
- Model and reasoning depth must both be reachable from one trigger.
- Preserve request payloads, model/reasoning persistence, attachment limits, knowledge retrieval, drag/drop, stop generation, and IME safety.
- Reuse repository AI Elements primitives and add no dependency.
- Keep knowledge-domain state in AI Entry rather than generic PromptInput components.
- Preserve unrelated dirty-worktree changes; stage and commit only task-owned files.
- Every implementation commit must use the repository Lore commit format.

## File Structure

- Modify `packages/workbench-ui/src/ai-elements/prompt-input-shortcut.ts`: opt-in Enter-to-send decision helper.
- Modify `packages/workbench-ui/src/ai-elements/source.tsx`: textarea row sizing, ref composition, and submit-mode props.
- Modify `packages/workbench-ui/test/prompt-input-shortcut.test.tsx`: keyboard regression coverage.
- Modify `packages/workbench-ui/test/official-ai-elements.test.tsx`: shared textarea markup contract.
- Create `packages/workbench-ui/src/model-reasoning-selector.tsx`: combined selector and public presentation types.
- Create `packages/workbench-ui/test/model-reasoning-selector.test.tsx`: summary and server-rendered trigger coverage.
- Modify `packages/workbench-ui/src/index.ts`: export the combined selector.
- Modify `packages/workbench-ui/src/styles.css`: shared combined-selector and compact-row styles.
- Modify `components/ai-entry/ai-entry-workspace.tsx`: replace duplicate selectors, manual file input, and permanent knowledge controls.
- Modify `components/ai-entry/ai-entry-workspace.test.ts`: integration-boundary regression checks.
- Modify `app/globals.css`: remove AI Entry height overrides and apply compact responsive layout.
- Modify `scripts/ai_entry_consulting_model_lock_ui_e2e.py`: verify the combined selector, add menu, one-to-three-line sizing, and unchanged request payload.

---

### Task 1: Add opt-in compact textarea behavior to AI Elements

**Files:**
- Modify: `packages/workbench-ui/src/ai-elements/prompt-input-shortcut.ts`
- Modify: `packages/workbench-ui/src/ai-elements/source.tsx:1-20,217-225`
- Modify: `packages/workbench-ui/test/prompt-input-shortcut.test.tsx`
- Modify: `packages/workbench-ui/test/official-ai-elements.test.tsx`

**Interfaces:**
- Consumes: existing `PromptInput` context value and controlled/uncontrolled text value.
- Produces: `PromptInputSubmitMode = "modifier-enter" | "enter"`; optional `submitMode`, `minRows`, and `maxRows` props on `PromptInputTextarea`.
- Compatibility: defaults stay `submitMode="modifier-enter"` with no autosizing unless `maxRows` is provided.

- [ ] **Step 1: Write keyboard tests before changing behavior**

Replace the shortcut test with explicit coverage for both modes:

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { shouldSubmitPromptInput } from "../src/ai-elements/prompt-input-shortcut";

const enter = { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false };

test("keeps modifier-enter as the shared default", () => {
  assert.equal(shouldSubmitPromptInput(enter, false), false);
  assert.equal(shouldSubmitPromptInput({ ...enter, ctrlKey: true }, false), true);
  assert.equal(shouldSubmitPromptInput({ ...enter, metaKey: true }, false), true);
  assert.equal(shouldSubmitPromptInput({ ...enter, ctrlKey: true, shiftKey: true }, false), false);
});

test("supports ChatGPT-style Enter send as an opt-in mode", () => {
  assert.equal(shouldSubmitPromptInput(enter, false, "enter"), true);
  assert.equal(shouldSubmitPromptInput({ ...enter, shiftKey: true }, false, "enter"), false);
  assert.equal(shouldSubmitPromptInput({ ...enter, isComposing: true }, false, "enter"), false);
  assert.equal(shouldSubmitPromptInput(enter, true, "enter"), false);
  assert.equal(shouldSubmitPromptInput({ ...enter, key: "x" }, false, "enter"), false);
});
```

- [ ] **Step 2: Run the focused test and verify the new API fails**

Run:

```bash
pnpm --filter @coworkany/workbench-ui exec tsx --test test/prompt-input-shortcut.test.tsx
```

Expected: FAIL because `metaKey` and the third `submitMode` argument are not accepted and plain Enter cannot yet submit.

- [ ] **Step 3: Implement the submit-mode helper**

Replace the helper with:

```ts
export type PromptInputSubmitMode = "modifier-enter" | "enter";

export function shouldSubmitPromptInput(
  event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    isComposing: boolean;
  },
  compositionActive: boolean,
  mode: PromptInputSubmitMode = "modifier-enter",
) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || compositionActive) return false;
  return mode === "enter" || event.ctrlKey || event.metaKey;
}
```

- [ ] **Step 4: Extend `PromptInputTextarea` without changing defaults**

Add `useLayoutEffect` to the React import, import `PromptInputSubmitMode`, and replace the textarea declaration with an implementation shaped as follows:

```tsx
type PromptInputTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  submitMode?: PromptInputSubmitMode;
  minRows?: number;
  maxRows?: number;
};

function assignTextareaRef(
  ref: React.ForwardedRef<HTMLTextAreaElement>,
  node: HTMLTextAreaElement | null,
) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const PromptInputTextarea = forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea({
    className,
    onChange,
    onKeyDown,
    style,
    value: inputValue,
    submitMode = "modifier-enter",
    minRows = 1,
    maxRows,
    ...props
  }, forwardedRef) {
    const { value, onValueChange, status, disabled, maxHeight, locale } = usePromptInputContext();
    const composingRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const resolvedValue = inputValue ?? value;

    useLayoutEffect(() => {
      const node = textareaRef.current;
      if (!node || maxRows === undefined) return;
      const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight) || 24;
      const minHeight = lineHeight * Math.max(1, minRows);
      const rowMaxHeight = lineHeight * Math.max(minRows, maxRows);
      node.style.height = "auto";
      const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), rowMaxHeight);
      node.style.height = `${nextHeight}px`;
      node.style.overflowY = node.scrollHeight > rowMaxHeight ? "auto" : "hidden";
    }, [maxRows, minRows, resolvedValue]);

    return <textarea
      {...props}
      ref={(node) => {
        textareaRef.current = node;
        assignTextareaRef(forwardedRef, node);
      }}
      rows={props.rows ?? minRows}
      value={resolvedValue}
      onChange={(event) => {
        onChange?.(event);
        if (!event.defaultPrevented) onValueChange(event.target.value);
      }}
      className={cx("ai-elements-prompt-input-textarea", "wb-ai-prompt-textarea", className)}
      style={{
        ...style,
        ...(maxHeight !== undefined
          ? { maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight }
          : {}),
      }}
      disabled={disabled || status === "streaming"}
      aria-label={props["aria-label"] ?? (locale === "zh" ? "消息输入" : "Message input")}
      aria-busy={status === "streaming"}
      onCompositionStart={(event) => {
        composingRef.current = true;
        props.onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        props.onCompositionEnd?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const nativeComposing = Boolean((event.nativeEvent as unknown as { isComposing?: boolean }).isComposing);
        if (shouldSubmitPromptInput({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          isComposing: nativeComposing,
        }, composingRef.current, submitMode)) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
    />;
  },
);
```

- [ ] **Step 5: Add the shared markup contract**

Add this test to `official-ai-elements.test.tsx`:

```tsx
test("official PromptInput textarea exposes opt-in compact rows", () => {
  const markup = renderToStaticMarkup(
    <PromptInput value="hello" onValueChange={() => undefined} onSubmit={() => undefined}>
      <PromptInputBody>
        <PromptInputTextarea minRows={1} maxRows={3} submitMode="enter" />
      </PromptInputBody>
    </PromptInput>,
  );
  assert.match(markup, /rows="1"/);
  assert.match(markup, /data-slot="prompt-input-body"/);
});
```

- [ ] **Step 6: Run unit tests and typecheck**

Run:

```bash
pnpm --filter @coworkany/workbench-ui test
pnpm --filter @coworkany/workbench-ui typecheck
```

Expected: all workbench UI tests pass and TypeScript exits with code 0.

- [ ] **Step 7: Commit the shared textarea behavior**

```bash
git add packages/workbench-ui/src/ai-elements/prompt-input-shortcut.ts packages/workbench-ui/src/ai-elements/source.tsx packages/workbench-ui/test/prompt-input-shortcut.test.tsx packages/workbench-ui/test/official-ai-elements.test.tsx
git commit -m "Let compact composers use familiar send behavior" \
  -m "Add opt-in Enter submission and bounded textarea autosizing while preserving modifier-Enter defaults for existing AI Elements consumers." \
  -m "Constraint: Existing PromptInput consumers must retain current keyboard behavior unless they opt in" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: Workbench UI tests and typecheck"
```

### Task 2: Build the combined model and reasoning selector

**Files:**
- Create: `packages/workbench-ui/src/model-reasoning-selector.tsx`
- Create: `packages/workbench-ui/test/model-reasoning-selector.test.tsx`
- Modify: `packages/workbench-ui/src/index.ts`
- Modify: `packages/workbench-ui/src/styles.css:830-870`

**Interfaces:**
- Consumes: shared AI Elements `ModelSelector` compound and presentation-only model/reasoning options.
- Produces: `WorkbenchModelReasoningSelector`, `WorkbenchModelReasoningOption`, and `WorkbenchReasoningOption`.
- Callbacks: `onModelChange(modelId: string)` and `onReasoningChange(reasoningId: string)`; persistence remains the caller's responsibility.

- [ ] **Step 1: Write selector tests first**

Create `model-reasoning-selector.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatModelReasoningSummary,
  WorkbenchModelReasoningSelector,
} from "../src/model-reasoning-selector";

const models = [
  { id: "gpt", label: "GPT 5.6", provider: "OpenAI" },
  { id: "claude", label: "Claude Sonnet", provider: "Anthropic" },
];
const reasoning = [
  { id: "auto", label: "自动", shortLabel: "自" },
  { id: "high", label: "高", shortLabel: "高" },
];

test("formats one compact model and reasoning summary", () => {
  assert.equal(formatModelReasoningSummary(models[0], reasoning[1], "zh"), "GPT 5.6 · 高");
  assert.equal(formatModelReasoningSummary(undefined, reasoning[0], "zh"), "选择模型 · 自动");
});

test("renders one trigger for both model and reasoning", () => {
  const markup = renderToStaticMarkup(
    <WorkbenchModelReasoningSelector
      models={models}
      modelId="gpt"
      reasoningOptions={reasoning}
      reasoningId="auto"
      onModelChange={() => undefined}
      onReasoningChange={() => undefined}
      locale="zh"
    />,
  );
  assert.match(markup, /aria-label="模型与推理：GPT 5\.6 · 自动"/);
  assert.equal((markup.match(/data-slot="model-reasoning-trigger"/g) ?? []).length, 1);
});
```

- [ ] **Step 2: Run the selector test and verify it fails**

Run:

```bash
pnpm --filter @coworkany/workbench-ui exec tsx --test test/model-reasoning-selector.test.tsx
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the selector with one trigger and two internal views**

Create `model-reasoning-selector.tsx` with these public types and component structure:

```tsx
"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorSeparator,
  ModelSelectorTrigger,
  type ModelOption,
} from "./ai-elements";

export type WorkbenchModelReasoningOption = ModelOption;
export type WorkbenchReasoningOption = {
  readonly id: string;
  readonly label: string;
  readonly shortLabel?: string;
};

export function formatModelReasoningSummary(
  model: WorkbenchModelReasoningOption | undefined,
  reasoning: WorkbenchReasoningOption | undefined,
  locale: "zh" | "en",
) {
  const modelLabel = model?.label ?? (locale === "zh" ? "选择模型" : "Select model");
  const reasoningLabel = reasoning?.label ?? (locale === "zh" ? "自动" : "Auto");
  return `${modelLabel} · ${reasoningLabel}`;
}

export function WorkbenchModelReasoningSelector({
  models,
  modelId,
  reasoningOptions,
  reasoningId,
  onModelChange,
  onReasoningChange,
  modelLocked = false,
  disabled = false,
  locale = "zh",
}: {
  models: readonly WorkbenchModelReasoningOption[];
  modelId?: string;
  reasoningOptions: readonly WorkbenchReasoningOption[];
  reasoningId: string;
  onModelChange: (modelId: string) => void;
  onReasoningChange: (reasoningId: string) => void;
  modelLocked?: boolean;
  disabled?: boolean;
  locale?: "zh" | "en";
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"settings" | "models">("settings");
  const model = models.find((item) => item.id === modelId);
  const reasoning = reasoningOptions.find((item) => item.id === reasoningId);
  const summary = formatModelReasoningSummary(model, reasoning, locale);
  const groups = useMemo(() => Object.entries(models.reduce<Record<string, WorkbenchModelReasoningOption[]>>((result, item) => {
    (result[item.provider ?? (locale === "zh" ? "模型" : "Models")] ??= []).push(item);
    return result;
  }, {})), [locale, models]);

  return <ModelSelector open={open} onOpenChange={(next) => {
    setOpen(next);
    if (!next) setView("settings");
  }}>
    <ModelSelectorTrigger
      disabled={disabled}
      aria-label={`${locale === "zh" ? "模型与推理" : "Model and reasoning"}：${summary}`}
      data-slot="model-reasoning-trigger"
      className="wb-ai-model-reasoning-trigger"
    >
      <span className="wb-ai-model-reasoning-summary wb-ai-model-reasoning-summary-full">{summary}</span>
      <span className="wb-ai-model-reasoning-summary wb-ai-model-reasoning-summary-compact" aria-hidden="true">
        {model?.label ?? (locale === "zh" ? "模型" : "Model")} · {reasoning?.shortLabel ?? reasoning?.label}
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </ModelSelectorTrigger>
    <ModelSelectorContent title={locale === "zh" ? "模型与推理" : "Model and reasoning"} className="wb-ai-model-reasoning-content">
      {view === "models" ? <>
        <button type="button" className="wb-ai-model-reasoning-back" onClick={() => setView("settings")}>
          <ChevronLeft size={14} aria-hidden="true" />{locale === "zh" ? "模型" : "Models"}
        </button>
        <ModelSelectorInput placeholder={locale === "zh" ? "搜索模型" : "Search models"} />
        <ModelSelectorList>
          <ModelSelectorEmpty>{locale === "zh" ? "没有匹配的模型" : "No matching models"}</ModelSelectorEmpty>
          {groups.map(([provider, items]) => <ModelSelectorGroup key={provider} heading={provider}>
            {items.map((item) => <ModelSelectorItem
              key={item.id}
              model={item}
              selected={item.id === modelId}
              onSelect={() => {
                onModelChange(item.id);
                setView("settings");
              }}
            />)}
          </ModelSelectorGroup>)}
        </ModelSelectorList>
      </> : <>
        <ModelSelectorList>
          <ModelSelectorGroup heading={locale === "zh" ? "模型" : "Model"}>
            <ModelSelectorItem
              value="change-model"
              disabled={modelLocked || models.length === 0}
              onSelect={() => setView("models")}
            >
              <span><strong>{model?.label ?? (locale === "zh" ? "无可用模型" : "No models")}</strong></span>
              {!modelLocked ? <ChevronRight size={14} aria-hidden="true" /> : null}
            </ModelSelectorItem>
          </ModelSelectorGroup>
          <ModelSelectorSeparator />
          <ModelSelectorGroup heading={locale === "zh" ? "推理深度" : "Reasoning"}>
            {reasoningOptions.map((item) => <ModelSelectorItem
              key={item.id}
              value={`reasoning-${item.id}`}
              selected={item.id === reasoningId}
              disabled={reasoningOptions.length <= 1}
              onSelect={() => {
                onReasoningChange(item.id);
                setOpen(false);
              }}
            >
              <span>{item.label}</span>
              {item.id === reasoningId ? <Check size={14} aria-hidden="true" /> : null}
            </ModelSelectorItem>)}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </>}
    </ModelSelectorContent>
  </ModelSelector>;
}
```

- [ ] **Step 4: Export and style the selector**

Add to `packages/workbench-ui/src/index.ts`:

```ts
export * from "./model-reasoning-selector";
```

Add focused styles to `packages/workbench-ui/src/styles.css`:

```css
.wb-ai-model-reasoning-trigger { width: auto; min-width: 0; max-width: 15rem; }
.wb-ai-model-reasoning-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-ai-model-reasoning-summary-compact { display: none; }
.wb-ai-model-reasoning-content { width: min(22rem, calc(100vw - 1rem)); }
.wb-ai-model-reasoning-back { display: flex; align-items: center; gap: .4rem; border: 0; background: transparent; color: var(--wb-foreground, #111); cursor: pointer; padding: .35rem .4rem; font: inherit; font-weight: 700; }
@media (max-width: 640px) {
  .wb-ai-model-reasoning-trigger { max-width: 8.5rem; }
  .wb-ai-model-reasoning-summary-full { display: none; }
  .wb-ai-model-reasoning-summary-compact { display: inline; }
}
```

- [ ] **Step 5: Run focused and package verification**

Run:

```bash
pnpm --filter @coworkany/workbench-ui test
pnpm --filter @coworkany/workbench-ui typecheck
```

Expected: all tests pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit the combined selector**

```bash
git add packages/workbench-ui/src/model-reasoning-selector.tsx packages/workbench-ui/test/model-reasoning-selector.test.tsx packages/workbench-ui/src/index.ts packages/workbench-ui/src/styles.css
git commit -m "Make model quality a single composer decision" \
  -m "Combine model search and supported reasoning depth behind one AI Elements trigger while leaving persistence and capability normalization to callers." \
  -m "Constraint: The selector must stay presentation-only and support locked-model routes" \
  -m "Rejected: Flatten every model and effort pair into separate rows | it multiplies options and duplicates capability rules" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: Selector unit tests, Workbench UI suite, and typecheck"
```

### Task 3: Integrate the compact composer into AI Entry

**Files:**
- Modify: `components/ai-entry/ai-entry-workspace.tsx:1-60,1530-1570,2925-3000,3910-4238,4473-4555`
- Modify: `components/ai-entry/ai-entry-workspace.test.ts`
- Modify: `app/globals.css:830-875,1498-1558,3055-3140`

**Interfaces:**
- Consumes: Task 1 `PromptInputTextarea` props and Task 2 `WorkbenchModelReasoningSelector`.
- Produces: one shared compact composer rendering path for landing and conversation modes.
- Preserves: `handleSend`, `handleAttachmentFiles`, `removeAttachment`, `selectedKnowledgeDatasetIds`, `normalizeReasoningEffort`, and persistence functions.

- [ ] **Step 1: Add source-boundary regression assertions before the refactor**

Append to `components/ai-entry/ai-entry-workspace.test.ts`:

```ts
test("AI Entry composes one compact AI Elements control surface", () => {
  const source = readFileSync(resolve(process.cwd(), "components/ai-entry/ai-entry-workspace.tsx"), "utf8");

  assert.match(source, /WorkbenchModelReasoningSelector/);
  assert.match(source, /PromptInputActionMenu/);
  assert.match(source, /PromptInputActionAddAttachments/);
  assert.match(source, /submitMode="enter"/);
  assert.match(source, /maxRows=\{3\}/);
  assert.doesNotMatch(source, /<Select\s/);
  assert.doesNotMatch(source, /ref=\{fileInputRef\}/);
  assert.doesNotMatch(source, /renderKnowledgeControl/);
});
```

- [ ] **Step 2: Run the source-boundary test and verify it fails**

Run:

```bash
pnpm exec tsx --test components/ai-entry/ai-entry-workspace.test.ts
```

Expected: FAIL because the workspace still contains separate Select controls, a manual file input, and a permanent knowledge control.

- [ ] **Step 3: Replace imports and obsolete UI state**

Import these shared components from `@coworkany/workbench-ui`:

```tsx
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  WorkbenchModelReasoningSelector,
} from "@coworkany/workbench-ui";
```

Remove `Select`, its related imports, `modelSelectOpen`, `reasoningSelectOpen`, `fileInputRef`, `renderModelSelectContent`, and `renderReasoningSelectContent`. Keep `knowledgePickerOpen` for the searchable knowledge panel.

- [ ] **Step 4: Map domain models and reasoning capabilities into presentation options**

Add memoized options beside `selectedModel` and `reasoningCapabilities`:

```tsx
const composerModels = useMemo(() => models.map((item) => ({
  id: item.id,
  label: item.name,
  provider: item.providerLabel || item.providerId,
})), [models]);

const composerReasoningOptions = useMemo(() => reasoningCapabilities.map((item) => ({
  id: item.effort,
  label: isZh ? item.zh : item.en,
  shortLabel: item.effort === "auto" ? (isZh ? "自" : "A") : (isZh ? item.zh.slice(0, 1) : item.en.slice(0, 1)),
})), [isZh, reasoningCapabilities]);
```

- [ ] **Step 5: Replace the selector renderer with one combined control**

Use one callback path for both landing and conversation composers:

```tsx
const renderModelReasoningSelector = () => (
  <WorkbenchModelReasoningSelector
    models={composerModels}
    modelId={selectedModelId ?? undefined}
    reasoningOptions={composerReasoningOptions}
    reasoningId={resolvedReasoningEffort}
    modelLocked={shouldLockModel}
    disabled={isResponseLoading || modelsLoading || models.length === 0}
    locale={isZh ? "zh" : "en"}
    onModelChange={(nextModelId) => {
      setSelectedModelId(nextModelId);
      persistSelectedModelId(nextModelId);
    }}
    onReasoningChange={(nextValue) => {
      const nextReasoningEffort = normalizeReasoningEffort(nextValue, {
        providerId: selectedModel?.providerId || modelProviderId,
        modelId: selectedModel?.modelId || selectedModel?.runtimeId || selectedModelId,
      });
      setSelectedReasoningEffort(nextReasoningEffort);
      persistReasoningEffort(nextReasoningEffort);
    }}
  />
);
```

- [ ] **Step 6: Replace the add popover with the AI Elements action menu**

Pass file handling directly to `PromptInput`:

```tsx
<PromptInput
  value={input}
  onValueChange={setInput}
  onSubmit={handleSend}
  onAddAttachments={handleAttachmentFiles}
  attachments={attachments}
  onRemoveAttachment={removeAttachment}
  accept="image/*,.txt,.md,.docx,.pdf,.csv,.json,text/*,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  isLoading={isResponseLoading}
  className="ai-entry-compact-composer"
>
```

Render the add menu in the compact row. Import `PopoverAnchor` from the existing popover component so the knowledge panel stays anchored to the add button after the dropdown closes:

```tsx
<Popover open={knowledgePickerOpen} onOpenChange={setKnowledgePickerOpen}>
  <PopoverAnchor asChild>
    <span className="ai-entry-add-control">
      <PromptInputActionMenu>
        <PromptInputActionMenuTrigger aria-label={copy.addMenu} />
        <PromptInputActionMenuContent>
          <PromptInputActionAddAttachments label={copy.uploadFile} disabled={attachments.length >= AI_ENTRY_MAX_ATTACHMENTS} />
          <PromptInputActionMenuItem onSelect={() => {
            setKnowledgeEnabled(true);
            window.requestAnimationFrame(() => setKnowledgePickerOpen(true));
          }}>
            <Database className="h-4 w-4" />
            {copy.knowledgeAdd}
          </PromptInputActionMenuItem>
        </PromptInputActionMenuContent>
      </PromptInputActionMenu>
      {attachments.length + (knowledgeEnabled ? Math.max(1, selectedKnowledgeDatasets.length) : 0) > 0 ? (
        <span className="ai-entry-add-count" aria-hidden="true">
          {attachments.length + (knowledgeEnabled ? Math.max(1, selectedKnowledgeDatasets.length) : 0)}
        </span>
      ) : null}
    </span>
  </PopoverAnchor>
  <PopoverContent className="w-80 p-0" align="start">
    {renderKnowledgePickerContent()}
  </PopoverContent>
</Popover>
```

Keep the existing searchable knowledge `PopoverContent`, but anchor it to the add-control wrapper and remove the permanent `renderKnowledgeControl()` output.

Extract the existing `Command`, `CommandInput`, `CommandList`, dataset items, “use all,” and disable buttons into `renderKnowledgePickerContent()`. That function returns only the panel body; it must not create another `Popover`, `PopoverTrigger`, or primary-row button. Remove `addMenuOpen`, because Radix owns the action-menu disclosure state.

- [ ] **Step 7: Render one-line context state only when needed**

Place this inside `PromptInputHeader`:

```tsx
{attachments.length > 0 || knowledgeEnabled || isPreparingAttachments ? (
  <div className="ai-entry-composer-context" aria-label={isZh ? "已添加上下文" : "Added context"}>
    {isPreparingAttachments ? <span className="ai-entry-context-chip"><Loader2 className="h-3.5 w-3.5 animate-spin" />{isZh ? "解析附件" : "Parsing"}</span> : null}
    <Attachments variant="inline" items={attachments}>
      {attachments.map((attachment) => <Attachment key={attachment.id} item={attachment} onRemove={() => removeAttachment(attachment.id)}>
        <AttachmentPreview />
        <AttachmentInfo />
        <AttachmentRemove label={isZh ? "移除附件" : "Remove attachment"} />
      </Attachment>)}
    </Attachments>
    {knowledgeEnabled && selectedKnowledgeDatasets.length === 0 ? <span className="ai-entry-context-chip">
      <Database className="h-3.5 w-3.5" />
      <span>{copy.knowledgeAllEnabled}</span>
      <button type="button" aria-label={copy.disableKnowledge} onClick={disableKnowledge}><X className="h-3 w-3" /></button>
    </span> : null}
    {selectedKnowledgeDatasets.map((dataset) => <span key={dataset.id} className="ai-entry-context-chip">
      <Database className="h-3.5 w-3.5" />
      <span>{dataset.name}</span>
      <button type="button" aria-label={`${isZh ? "移除知识库" : "Remove knowledge base"}: ${dataset.name}`} onClick={() => toggleKnowledgeDataset(dataset.id)}><X className="h-3 w-3" /></button>
    </span>)}
  </div>
) : null}
```

Use `PromptInputTextarea minRows={1} maxRows={3} submitMode="enter"` and `PromptInputSubmit`; remove the text-labeled custom send button.

- [ ] **Step 8: Add compact and responsive styles**

Add scoped rules in `app/globals.css` after the existing composer block so they win without altering other products:

```css
.ai-entry-compact-composer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 8px;
  min-height: 52px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  background: var(--background);
  box-shadow: 0 12px 32px rgb(17 17 17 / 7%);
}
.ai-entry-composer-shell,
.ai-entry-composer-shell.dashboard-panel,
.ai-entry-composer-shell.chat-composer {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.ai-entry-composer-shell.chat-composer::before { display: none; }
.ai-entry-add-control { position: relative; display: inline-flex; }
.ai-entry-add-count { position: absolute; top: -4px; right: -4px; display: grid; min-width: 16px; height: 16px; place-items: center; border: 2px solid var(--background); border-radius: 999px; padding: 0 3px; background: var(--primary); color: var(--primary-foreground); font-size: 9px; font-weight: 800; }
.ai-entry-compact-composer .wb-ai-prompt-header { grid-column: 1 / -1; }
.ai-entry-compact-composer .wb-ai-prompt-body { min-width: 0; padding: 5px 2px; }
.ai-entry-compact-composer .wb-ai-prompt-textarea {
  min-height: 24px;
  max-height: 72px;
  line-height: 24px;
  overflow-y: hidden;
}
.ai-entry-composer-context {
  display: flex;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  padding: 0 2px 4px;
  scrollbar-width: none;
}
.ai-entry-composer-context::-webkit-scrollbar { display: none; }
.ai-entry-composer-context .wb-ai-attachments { flex-wrap: nowrap; }
.ai-entry-context-chip { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; height: 28px; border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; font-size: 11px; }
.ai-entry-context-chip button { display: inline-grid; place-items: center; border: 0; padding: 0; background: transparent; color: inherit; }
@media (max-width: 640px) {
  .ai-entry-compact-composer { gap: 6px; padding-inline: 8px; }
  .ai-entry-compact-composer .wb-ai-model-reasoning-trigger { max-width: 8rem; padding-inline: 8px; }
}
```

Remove or override the AI Entry-specific `.composer-input` minimum heights and the two-control `.model-select` widths that force the current tall layout. Leave unrelated writer, media, and desktop selectors unchanged.

Add `ai-entry-composer-shell` to both the landing wrapper currently using `dashboard-panel ... p-4` and the conversation wrapper currently using `chat-composer`. The compact `PromptInput` becomes the only visual card, so the 56px target includes every visible composer layer.

- [ ] **Step 9: Run focused tests, lint, and typechecks**

Run:

```bash
pnpm exec tsx --test components/ai-entry/ai-entry-workspace.test.ts
pnpm --filter @coworkany/workbench-ui test
pnpm --filter @coworkany/workbench-ui typecheck
pnpm lint
```

Expected: all tests pass, typecheck exits with code 0, and ESLint reports zero warnings.

- [ ] **Step 10: Commit the AI Entry integration**

```bash
git add components/ai-entry/ai-entry-workspace.tsx components/ai-entry/ai-entry-workspace.test.ts app/globals.css
git commit -m "Return conversation space to AI Entry users" \
  -m "Adopt the compact AI Elements composer, move files and knowledge behind one add menu, show selected context only when present, and replace separate model controls with the combined selector." \
  -m "Constraint: Request construction, knowledge state, attachment processing, and persistence remain owned by AI Entry" \
  -m "Rejected: Move knowledge selection into generic PromptInput | it would couple shared UI to one product domain" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: AI Entry source contract, Workbench UI suite, typecheck, and lint"
```

### Task 4: Verify real browser behavior and request compatibility

**Files:**
- Modify: `scripts/ai_entry_consulting_model_lock_ui_e2e.py`
- Modify: `package.json`

**Interfaces:**
- Consumes: the AI Entry page, mocked model/agent/knowledge endpoints, and intercepted `/api/ai/chat` requests.
- Produces: a repeatable UI regression command covering density, menus, sizing, model/reasoning selection, and request payload.

- [ ] **Step 1: Extend mocked knowledge data**

Add a route handler in the existing Playwright script:

```python
def route_knowledge(route):
    route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({
            "data": {
                "items": [
                    {"id": 101, "name": "品牌规范", "category": "enterprise"},
                    {"id": 202, "name": "产品资料", "category": "personal"},
                ]
            }
        }),
    )

page.route("**/api/knowledge/datasets", route_knowledge)
```

- [ ] **Step 2: Replace the old combobox assertions with combined-trigger checks**

Use the stable accessible name:

```python
combined_trigger = page.get_by_role("button", name=re.compile(r"模型与推理|model and reasoning", re.IGNORECASE))
expect(combined_trigger.count() == 1, "AI Entry should expose exactly one model/reasoning trigger")
expect(page.locator("button[role='combobox']").count() == 0, "separate model/reasoning comboboxes must be removed")
combined_trigger.click()
page.get_by_role("option", name=re.compile(r"grok\s*4\.?5", re.IGNORECASE)).click()
page.get_by_role("option", name=re.compile(r"gpt\s*5\.5", re.IGNORECASE)).click()
page.get_by_role("option", name=re.compile(r"^(高|high)$", re.IGNORECASE)).click()
expect(
    re.search(r"gpt\s*5\.5", combined_trigger.get_attribute("aria-label") or "", re.IGNORECASE) is not None,
    "combined trigger should summarize the selected model",
)
expect(
    re.search(r"高|high", combined_trigger.get_attribute("aria-label") or "", re.IGNORECASE) is not None,
    "combined trigger should summarize the selected reasoning depth",
)
```

- [ ] **Step 3: Add compact height and three-line cap assertions**

Add these checks before sending:

```python
composer = page.locator(".ai-entry-compact-composer").first
empty_height = composer.bounding_box()["height"]
expect(empty_height <= 56, f"empty composer exceeds 56px: {empty_height}")

textarea = wait_for_chat_interactive(page)
textarea.fill("第一行\n第二行\n第三行\n第四行")
metrics = textarea.evaluate("""node => ({
  clientHeight: node.clientHeight,
  scrollHeight: node.scrollHeight,
  lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight),
  overflowY: getComputedStyle(node).overflowY,
})""")
expect(metrics["clientHeight"] <= metrics["lineHeight"] * 3 + 2, f"textarea exceeds three rows: {metrics}")
expect(metrics["scrollHeight"] > metrics["clientHeight"], f"fourth line should scroll: {metrics}")
expect(metrics["overflowY"] in ("auto", "scroll"), f"textarea should enable internal scrolling: {metrics}")
textarea.fill("compact composer request")
```

- [ ] **Step 4: Verify the add menu and selected knowledge context**

Add:

```python
page.get_by_role("button", name=re.compile(r"添加内容|add content", re.IGNORECASE)).click()
expect(page.get_by_text(re.compile(r"上传文件|upload file", re.IGNORECASE)).count() == 1, "add menu missing upload")
page.get_by_text(re.compile(r"添加知识库|add knowledge", re.IGNORECASE)).click()
page.get_by_text("品牌规范", exact=True).click()
page.keyboard.press("Escape")
expect(page.get_by_label(re.compile(r"已添加上下文|added context", re.IGNORECASE)).get_by_text("品牌规范").count() == 1, "selected knowledge is not summarized")
expect(page.get_by_role("button", name=re.compile(r"关闭知识库|disable knowledge", re.IGNORECASE)).count() == 0, "knowledge controls should not stay in the primary row")
```

- [ ] **Step 5: Assert the intercepted request remains compatible**

After sending, retain all current model assertions and add:

```python
model_config = chat_requests[-1].get("modelConfig", {})
expect(model_config.get("modelId") == SWITCHABLE_MODEL_ID, f"model selection missing: {model_config}")
expect(model_config.get("reasoningEffort") == "high", f"reasoning selection missing: {model_config}")
knowledge_config = chat_requests[-1].get("enterpriseKnowledge", {})
expect(knowledge_config.get("enabled") is True, f"knowledge should be enabled: {knowledge_config}")
expect(101 in knowledge_config.get("datasetIds", []), f"knowledge selection missing: {knowledge_config}")
```

- [ ] **Step 6: Register the browser regression command**

Add to `package.json`:

```json
"test:e2e:ai-entry:compact-composer:ui": "python scripts/ai_entry_consulting_model_lock_ui_e2e.py"
```

- [ ] **Step 7: Run the browser regression with the existing local server harness**

Start the app in terminal A:

```bash
pnpm dev
```

After `http://127.0.0.1:3000/api/health` returns HTTP 200, run in terminal B:

```bash
pnpm test:e2e:ai-entry:compact-composer:ui
```

Expected: script exits 0, writes screenshots under `artifacts/ai-entry/`, and reports no critical console errors.

- [ ] **Step 8: Run final verification**

Run:

```bash
pnpm --filter @coworkany/workbench-ui test
pnpm --filter @coworkany/workbench-ui typecheck
pnpm exec tsx --test components/ai-entry/ai-entry-workspace.test.ts lib/ai-entry/reasoning.test.ts
pnpm lint
pnpm build
git diff --check
```

Expected: all tests pass, lint has zero warnings, production build completes, and `git diff --check` prints no output.

- [ ] **Step 9: Commit the browser regression**

```bash
git add scripts/ai_entry_consulting_model_lock_ui_e2e.py package.json
git commit -m "Keep the compact composer behavior reviewable" \
  -m "Cover one-line density, three-line overflow, the unified add menu, the combined model/reasoning selector, and unchanged request fields in the existing mocked AI Entry browser flow." \
  -m "Constraint: Browser verification must not require a live model provider" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: AI Entry compact composer Playwright regression and full project verification"
```

## Completion Evidence

Before reporting completion, capture:

- Workbench UI test count and passing result.
- AI Entry integration test passing result.
- Workbench UI typecheck result.
- Root lint and production build result.
- Browser screenshot paths for empty, three-line, add-menu, combined-selector, and selected-context states.
- Intercepted request summary proving model, reasoning, attachment/knowledge, and agent fields remain compatible.
- Final `git status --short` showing only pre-existing unrelated changes, if any.
