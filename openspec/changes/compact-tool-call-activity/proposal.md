# Compact tool-call activity in assistant replies

Status: Design approved and implementation completed on 2026-09-30. Verification evidence and platform limitations are recorded in `acceptance.md`.

## Why

Running tools automatically expand their parameters. Completed tools collapse but retain one bordered card, name and status badge per invocation. Long runs therefore fill the transcript with tool UI, while the trailing activity indicator repeats the current tool state.

The approved research is recorded in `docs/research/2026-09-30-tool-call-ui-patterns.md`. assistant-ui and Open WebUI provide the relevant consecutive-call grouping pattern; Vercel Chatbot demonstrates separate rendering of useful results.

## What changes

- Render each maximal run of adjacent ordinary tool calls as one muted, borderless summary row, including groups with only one call.
- Default both the group and individual call details to closed during running and completed states. Expand the group to inspect calls, then expand a call to inspect its parameters/output.
- Update running/completion/failure summaries in place, using actual lifecycle state and measured timing rather than invented progress or model-generated summaries.
- Keep approval requests and user questions directly visible and actionable. Keep artifacts, media, previews and other useful typed results outside tool trace disclosures.
- Preserve visible Part order, stable identities, manual expansion choices, scrolling and bounded accessibility announcements. Avoid duplicate tool-running indicators.
- Add a documented Workbench presentation exception to earlier upstream parity requirements. Preserve pinned upstream source and primitive contracts.

## Scope

Shared `WorkbenchMessageSurface`, its tool/activity adapters, scoped presentation styles and acceptance fixtures. Existing Chat, Agent, Writer and Workflow AI consumers receive the shared behavior; domain-specific workflow summaries and host actions remain supported.

No transport or persistence schema changes, runtime behavior changes, new dependencies, unrelated message/composer redesign, whole-turn process aggregation, additional LLM summarization or new result protocol.

## Relationship to existing changes

This change follows `preserve-assistant-turn-stream-order` and `restore-ai-elements-message-visual-parity`. It supersedes their requirement for automatically expanded running tool cards and strict surface-level tool header/card geometry. Chronology, original Part identities, source provenance and other primitive parity requirements remain applicable. Their completed task lists describe earlier delivery, not completion of this enhancement.

## Success criteria

- 1, 10 and 50 adjacent ordinary calls each occupy one closed summary row by default.
- `tool -> text -> tool` remains two groups around the original text; no group moves across visible content or assistant messages.
- Streaming append/completion and parallel call updates preserve order and user-selected disclosure state.
- Approvals/questions can be acted on without opening a group; failures are visible and directly inspectable; existing result previews/downloads remain accessible.
- Tool-only intervals remain visibly active without duplicate running labels or fabricated assistant prose.
- Relevant tests, typechecks, source/provenance checks and mounted light/dark, narrow-width and desktop acceptance pass during implementation.
