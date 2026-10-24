## 1. Contract and regression baseline

- [x] 1.1 Add failing contract tests for the versioned workflow AI plan fields, unknown-field rejection and prompt-safe serialization.
- [x] 1.2 Add failing semantic tests proving an illustrated-article request requires real article-generation, image-generation and result-composition paths rather than title-only edits.
- [x] 1.3 Add regression tests that snapshot the seven current workflow directory templates, their stable keys and their existing `ready`/`needs-config` behavior.
- [x] 1.4 Add regression tests for one-request/one-history-entry behavior and the existing global workflow Undo/Redo controls.

## 2. Shared authoring contracts and validation

- [x] 2.1 Define stable workflow capability identifiers and derive actual capabilities from registered node types, valid configuration and reachable graph paths.
- [x] 2.2 Define and validate the versioned structured authoring plan with intent, required capabilities, selected template/version, assumptions, operations and validation result.
- [x] 2.3 Extend workflow validation to compare required capabilities with the resulting graph and reject title-only capability claims, invalid ports, raw cycles and unsupported node versions.
- [x] 2.4 Implement deterministic layout for new or changed subgraphs while preserving positions of unaffected nodes.
- [x] 2.5 Add fixtures for controlled `foreach`/`collect` structures, semantic failure details and deterministic repeated layout.

## 3. Golden template registry

- [x] 3.1 Define the golden template descriptor, instantiation context, capability tags, configuration requirements, provenance fields and validation result types.
- [x] 3.2 Move `content-pipeline`, `presentation`, `image-campaign`, `video-ffmpeg-transform`, `audio-ffmpeg-trim`, `product-promotion-video` and `character-swap-video` metadata/builders behind one public registry.
- [x] 3.3 Replace workflow directory template declarations and template-id dispatch branches with data derived from the shared registry without changing visible copy or generated graph behavior.
- [x] 3.4 Implement deterministic template matching by capability coverage, graph distance, pending configuration count and stable key order.
- [x] 3.5 Support one primary template plus explicitly registered validated subgraphs, and reject whole-template merging that duplicates entry or output boundaries.
- [x] 3.6 Persist and round-trip `templateKey` and `templateVersion` through creation, save, export and import without auto-upgrading existing workflows.
- [x] 3.7 Add registry release tests for graph validity, semantic capability truth, stable instantiation, credential/path scanning, unique keys and positive versions.

## 4. Built-in workflow authoring Skill

- [x] 4.1 Create the versioned `workflow-authoring` system Skill with intent decomposition, golden-template selection, minimal-diff, controlled-loop and one-repair instructions.
- [x] 4.2 Add the Skill to the canonical desktop Skill catalog, bundle manifest and integrity/synchronization tests.
- [x] 4.3 Route workflow create/modify/diagnose/repair/validate requests through the Skill while leaving conceptual questions non-mutating.
- [x] 4.4 Add compatibility tests that fail when the Skill protocol version or required structured plan fields drift from the typed controller contract.

## 5. AI planning, Provider and approval pipeline

- [x] 5.1 Supply the assistant with a sanitized node catalog, configured text-model catalog and prompt-safe golden-template catalog; exclude media models, credentials and local paths.
- [x] 5.2 Implement the pipeline from intent to primary-template selection, minimal graph diff, deterministic layout, validation and one bounded repair retry.
- [x] 5.3 Keep complete nodes and edges when an execution Provider is missing, mark affected nodes `needs-config`, and prevent invented Provider/model/credential/path values.
- [x] 5.4 Allow automatic selection and switching among configured available text Providers, including paid Providers, without approval.
- [x] 5.5 Require approval for workflow runs, two-or-more-node deletion, irreversible replacement and operation groups adding more than 20 nodes; keep ordinary edits and single-node deletion automatic.
- [x] 5.6 Fail closed without mutation after the repair retry and return missing capabilities plus concrete graph issues.
- [x] 5.7 Add controller tests for ambiguity handling, model filtering, Provider switching, pending configuration, node limit, approval boundaries, repair success and repair failure.

## 6. Atomic history and workflow AI surface

- [x] 6.1 Apply every successful AI request through one atomic workflow operation group and one existing global history commit; roll back all commands on any failure.
- [x] 6.2 Verify global Undo/Redo reverses and reapplies a multi-node AI change in one step and remains consistent after manual canvas edits.
- [x] 6.3 Keep the right AI sidebar expandable and hideable, preserve its conversation while collapsed, and reclaim canvas space when hidden.
- [x] 6.4 Render only request, plan/approval summary and operation result in the AI conversation; remove independent Undo/Redo controls and detailed Undo/Redo history from the sidebar.
- [x] 6.5 Add desktop UI tests for sidebar state, plan approval, concise operation feedback and global history placement.

## 7. Compatibility and release verification

- [x] 7.1 Verify older workflows load unchanged and are modified only after a new user request or an explicit check-and-repair request.
- [x] 7.2 Run workflow-core, workbench-client, desktop template/controller/UI and Skill bundle test suites.
- [x] 7.3 Run repository typechecks, lint/static analysis and desktop production build without changing unrelated worktree files.
- [x] 7.4 Perform desktop regression scenarios for template creation, illustrated-article correction, missing image Provider, configured text Provider switching, approval, Undo/Redo and sidebar collapse/restore.
- [x] 7.5 Run `openspec validate add-workflow-ai-authoring-skill --strict --no-interactive` and record remaining external Provider or packaging limitations without weakening fail-closed tests.

Verification note: current-source desktop tests passed 481/481; workbench-ui tests passed 118/118; all 10 package typechecks passed; root lint, focused validator ESLint, shared-boundary and provenance checks passed; isolated Vite and Tauri macOS app builds passed. The optional workflow-node validator's local fixture was corrected to use one file per upload node and to feed `product_store` a real artifact; its local-only run passed all nodes and produced two artifacts. Provider-backed scopes remain unverified because the ignored private config is absent and no live/paid Provider was used. Native Tauri acceptance covered old inconsistent revision 2 / archive maximum 10 and fresh workflows through AI approval → global Undo → Redo → second AI approval, cancellation followed by Retry, Provider switching, missing image Provider, sidebar hide/restore, and byte-identical no-write legacy open. Vite output is split with a largest chunk of 668.71 kB (205.07 kB gzip), below the configured 700 kB warning threshold; no chunk-size notice remains. All 68 Rust library tests passed; macOS release build emits no Rust compiler warnings. Windows compilation was unavailable because only the aarch64-apple-darwin Rust target is installed. See `.artifacts/workflow-ai-authoring-acceptance/qa-report.md` for exact evidence and limits.
