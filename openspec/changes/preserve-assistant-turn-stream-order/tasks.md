# Tasks: Preserve Assistant Turn Order and Restore AI Elements Message Parity

## Phase 1: Lock the failing behavior and parity target

- [x] 1.1 Record the exact AI Elements registry payload digest/source commit, AI SDK version, official reference URLs and target light/dark screenshots in the source manifest or acceptance notes.
- [x] 1.2 Add a captured fixture for `reasoning -> text-before -> tool-start -> tool-complete -> text-after -> artifact -> finish`.
- [x] 1.3 Add RED reducer/transport tests proving that text after a tool requires a new segment id and that tool completion remains in its first position.
- [x] 1.4 Add RED component tests proving the required DOM order and showing that the current global execution/text grouping is invalid.
- [x] 1.5 Add RED tests for a tool-only interval, same-message scroll revision and activity accessibility.

Phase 1 quality gate: the new tests fail for the expected ordering/parity reasons and existing unrelated tests retain their baseline result.

## Phase 2: Build the assistant-turn projection

- [x] 2.1 Add `beginAssistantTurn` and `advanceAssistantTurn` as a pure module in `packages/workbench-client`.
- [x] 2.2 Assign occurrence ids to contiguous text/reasoning segments and stable entity ids to tools, tasks, previews, media and artifacts.
- [x] 2.3 Preserve first sequence/creation time, update entities in place, reject duplicate/late regressions and finalize open segments on terminal status.
- [x] 2.4 Update UI Message Stream conversion to emit `text-end`/`reasoning-end` at barriers and open new segment ids when streaming resumes.
- [x] 2.5 Route persisted event replay through the same projection and retain best-effort loading for legacy Parts.
- [x] 2.6 Verify storage round-trips all segments in order and that `desktopUIMessageText` concatenates text segments for copy/search/export.

Phase 2 quality gate: workbench-client tests and typecheck pass; live projection and persisted replay produce equivalent Parts for the captured fixture.

## Phase 3: Replace grouped rendering with one ordered reply

- [x] 3.1 Refactor `WorkbenchMessageSurface` to traverse `message.parts` once in array order.
- [x] 3.2 Reuse verified official Message, MessageResponse, Reasoning and Tool at each Part's chronological position; retain existing Task, Sources and typed output extensions.
- [x] 3.3 Group only adjacent compatible Parts; remove whole-turn reasoning aggregation and global process/text/result buckets.
- [x] 3.4 Render only the active text segment in streaming mode; keep completed Markdown segments static.
- [x] 3.5 Add a trailing waiting/reasoning/tool/approval/writing activity indicator without fabricated assistant prose.
- [x] 3.6 Apply the same ordered renderer to any retained shared/legacy message timeline entry point.
- [x] 3.7 Narrow custom message/process CSS to the documented Workbench exceptions and remove hierarchy-changing execution-card styling.
- [x] 3.8 Verify the upstream source snapshot and restore Message/Reasoning/Tool structure, styling and lifecycle behavior through thin host adapters.

Phase 3 quality gate: workbench-ui tests/typecheck pass; DOM order matches the captured fixture; official primitive contract tests remain green.

## Phase 4: Establish one live message owner

- [x] 4.1 Make `useChat<DesktopUIMessage>.messages` the rendered source of truth for desktop conversation routes.
- [x] 4.2 Remove `assistantText`, `assistantPartsRef`, `toolEvents` and whole-array Parts arbitration from live message composition.
- [x] 4.3 Ensure every accepted reasoning/tool/text/output event creates one immutable visible message update without relying on incidental page state.
- [x] 4.4 Persist the exact final message snapshot on completion, failure and cancellation.
- [x] 4.5 Consolidate overlapping visible-message runtime projection while retaining independent metrics/task-center consumers.
- [x] 4.6 Verify Chat, Agent, Writer and Workflow AI use the same ordered shared surface and typed host callbacks.

Phase 4 quality gate: desktop tests/typecheck pass; a tool-only event updates the visible message immediately; reload preserves the streamed order.

## Phase 5: Restore Conversation behavior and accessibility parity

- [x] 5.1 Drive bottom-follow revision from message id, last sequence and active state.
- [x] 5.2 Follow updates only while the user is near the bottom; preserve manual scroll position and show a new-activity/scroll-to-latest control otherwise.
- [x] 5.3 Keep active reasoning/tool/approval states expanded and completed states collapsed according to the pinned AI Elements behavior.
- [x] 5.4 Apply `aria-busy`, a single polite activity announcement, keyboard disclosure semantics and approval focus behavior.
- [x] 5.5 Verify elapsed tool activity remains visibly alive when no text delta or tool progress payload arrives.

Phase 5 quality gate: browser interaction/accessibility tests pass for streaming, tool execution, approval, manual scroll and reduced motion.

## Phase 6: Pinned visual and real Tauri acceptance

- [x] 6.1 Capture light/dark screenshots at the agreed desktop viewports and compare message hierarchy, spacing, disclosures and streaming states against the pinned reference.
- [x] 6.2 Verify core supported states against the reference composition and document brand/shell/business extensions and dependency fallbacks in the repair acceptance report.
- [x] 6.3 Run a real Tauri tool-bearing conversation and capture reasoning, pre-tool text, running/completed tool, post-tool text and artifact states.
- [x] 6.4 Reload that conversation and confirm equivalent Part order, content, terminal states and scroll behavior.
- [x] 6.5 Run workbench-client/UI/runtime-contracts tests and typechecks, desktop tests/typecheck/build, lint, shared boundary/provenance checks and OpenSpec validation.
- [x] 6.6 Render the same event fixture in an independent official reference view and the desktop view with the complete production stylesheet stack.
- [x] 6.7 Verify mounted reasoning/tool/approval state transitions, keyboard interactions and scroll behavior; capture visual evidence for each state rather than relying only on static DOM assertions.

Phase 6 quality gate: no open P0/P1 ordering, frozen-feedback, parity, accessibility or restore issue remains; all required checks and Tauri evidence are recorded.

## Completion checklist

- [x] All phases and quality gates complete.
- [x] Ordered live/replay behavior matches the delta specs.
- [x] AI Elements/chatbot parity matches the pinned target within the documented exceptions.
- [x] No duplicate page-owned message projection remains.
- [x] OpenSpec validation passes and the change is ready for archival review.
