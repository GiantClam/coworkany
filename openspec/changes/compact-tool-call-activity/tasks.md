## 1. Approved specification

- [x] 1.1 Record the approved research, presentation decisions and explicit exceptions to prior tool parity requirements.
- [x] 1.2 Define scenarios for call density, chronology, lifecycle, manual disclosure, attention, useful results and accessibility.
- [x] 1.3 Validate the change and affected predecessor specifications with OpenSpec strict validation (all three passed on 2026-09-30).

## 2. Group ordinary calls in the shared surface

- [x] 2.1 Add focused grouping regressions for 1/10/50 calls, visible boundaries, stable identities and unchanged input Parts.
- [x] 2.2 Implement ordered adjacent-call grouping and a shared borderless summary using existing Collapsible components.
- [x] 2.3 Default group and call details to closed; preserve manual state through streaming append and lifecycle updates.
- [x] 2.4 Compute localized summaries from distinct calls and real states; cover active, successful, failed and denied mixtures without fabricated totals or timing.
- [x] 2.5 Render compact call lists and on-demand existing input/output details with bounded overflow and complete inspection/copy.

## 3. Attention, results and activity

- [x] 3.1 Keep approvals/questions visible outside groups and preserve action callbacks through approval transitions.
- [x] 3.2 Show failures in collapsed summaries and provide direct failed-call inspection.
- [x] 3.3 Preserve typed results, previews, downloads and Workflow AI business summaries in their original position.
- [x] 3.4 Remove duplicate tool-running feedback while retaining tool-only activity, other phases and one bounded polite live region.
- [x] 3.5 Verify keyboard toggles, focus, reduced motion, streaming scroll behavior and restored-message defaults.

## 4. Verification and delivery

- [x] 4.1 Add mounted interaction coverage for groups and individual details, including manual open/close, parallel updates and transitions introducing boundaries.
- [x] 4.2 Preserve upstream source/primitive parity tests and add separate grouped-surface visual expectations.
- [x] 4.3 Capture production light/dark and narrow-width fixtures for 1/10/50 calls, interleaving, failures, approvals and useful results.
- [x] 4.4 Verify the shared behavior in Chat, Agent, Writer and Workflow AI; check a rebuilt desktop WebView and replay/reload.
- [x] 4.5 Run affected UI/client/desktop tests and typechecks, lint, source/provenance/shared-boundary checks, production build and strict OpenSpec validation.
- [x] 4.6 Record implementation evidence, changed files and any remaining limitations; mark implementation tasks complete only after verification.

## Completion evidence

See `acceptance.md` for commands, mounted/native observations, captures and limits. UI 159/159, client 44/44 and desktop 502/502 passed; typechecks, lint, shared-boundary/provenance checks and final production/native builds passed. Reusable in-app Browser checks cover density, approval split/merge continuity, failure inspection and full-copy integrity. No new dependencies or transport/persistence changes.
