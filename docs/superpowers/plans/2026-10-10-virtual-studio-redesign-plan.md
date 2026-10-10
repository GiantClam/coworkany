# Virtual Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current placeholder virtual-office scene with a warm 2.5D island office whose approved back-facing chibi characters, desks, displays, and bone animations are independently validated and rendered without changing business-state ownership.

**Architecture:** Keep `OfficeStore` and the existing React fallback as the complete business and accessibility surface. Add a renderer-only visual-state resolver and a layered Pixi scene: background, desk, display, rigged character, and status interaction layers. Versioned assets are described by a manifest and are loaded lazily; every generated image is approved independently before it is copied into the production asset directory.

**Tech Stack:** React 19, TypeScript, PixiJS 8.22.0, Vite, Node `tsx` tests, WebP/PNG transparent textures, JSON asset manifests, existing macOS desktop build and virtual-office verification scripts.

## Global Constraints

- All image families in the approval ledger have now received separate user confirmation; integration still requires runtime integrity checks before files enter `apps/desktop/public/virtual-office/v1/`.
- The final art direction is a warm 2.5D cartoon office with a seven-station island layout.
- Characters are big-headed, short-bodied, and shown from behind while working.
- Character motion uses the gentle-loop direction: `idle`, `walk`, `work`, `thinking`, `waiting`, `completed`, and `error`.
- The animation delivery format is 2D skeleton + texture atlas; frame-only animation is a fallback preview, not the primary runtime path.
- `OfficeStore` remains the only state source; do not add an office database or task table.
- The renderer must not import WorkbenchClient, Tauri commands, storage, or navigation modules.
- React remains a complete accessible fallback; Canvas is decorative and must not be the only interaction surface.
- Pixi remains lazy-loaded and excluded from the static entry chunk.
- Existing navigation, bilingual labels, recent-work limits, reduced-motion, hidden-window, and idle-frame policies must not regress.
- Current release verification is macOS-focused; do not claim Windows release readiness.

## Current execution checkpoint

- Approved source drafts are immutable inputs under `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/`.
- The approval ledger records `approved` for the complete background, character source atlas, all seven 8-view turnarounds, desk variants, display source art, rig preview + animation JSON, and composite preview.
- `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/rig-animation-data-v1.json` is the exact normalized keyframe source for the renderer adapter; it is not a Spine/DragonBones file.
- Implementation starts with runtime asset conversion and manifest work. No approved draft is copied into the public directory until the conversion and verifier tests pass.

---

## File Map and Responsibilities

### Existing files to modify

- `apps/desktop/src/virtual-office/asset-registry.ts` — extend manifest types and asset IDs for background, desks, displays, character skins, rig metadata, and animation clips.
- `apps/desktop/src/virtual-office/types.ts` — add renderer-neutral visual-state and rig metadata types without importing renderer or asset implementation details.
- `apps/desktop/src/virtual-office/office-scene.ts` — retain scene lifecycle and device-slot projection; delegate drawing to focused layer modules.
- `apps/desktop/src/virtual-office/OfficeCanvasEnhancement.tsx` — pass the projected snapshot and visual-state callbacks into the new scene contract.
- `apps/desktop/src/virtual-office/virtual-office.css` — update scene sizing, responsive island rail, and fallback spacing while preserving existing semantic card styles.
- `apps/desktop/public/virtual-office/v1/manifest.json` — replace the placeholder asset entries only after individual image approvals and integrity checks.
- `apps/desktop/package.json` — expose the deterministic `build:virtual-office-assets` conversion command.
- `apps/desktop/scripts/verify-virtual-office-assets.mjs` — validate rig metadata, transparent assets, animation names, dimensions, and hash values.
- `apps/desktop/scripts/verify-virtual-office-bundle.mjs` — retain static/dynamic Pixi bundle assertions and add the new renderer module names.

### New renderer-only files

- `apps/desktop/src/virtual-office/visual-state.ts` — pure mapping from `OfficeRoleState` / device state to `idle | walk | work | thinking | waiting | completed | error | offline`.
- `apps/desktop/src/virtual-office/character-rig.ts` — renderer-neutral rig schema validation and a Pixi-facing adapter for bones, slots, skins, and clip playback.
- `apps/desktop/src/virtual-office/office-background-layer.ts` — background texture and island anchor layout.
- `apps/desktop/src/virtual-office/office-desk-layer.ts` — independent desk sprites and availability/status variants.
- `apps/desktop/src/virtual-office/office-display-layer.ts` — independent main/side display sprites, screen copy, and status glow.
- `apps/desktop/src/virtual-office/office-character-layer.ts` — rig instances, skin selection, and gentle-loop animation playback.

### New or extended tests

- `apps/desktop/test/virtual-office-visual-state.test.ts` — deterministic business-to-visual state mapping.
- `apps/desktop/test/virtual-office-rig.test.ts` — rig schema, slot names, clips, and fallback pose validation.
- `apps/desktop/test/virtual-office-layer-order.test.ts` — background/character/display/desk/status ordering and independent replacement.
- `apps/desktop/test/virtual-office-assets-generated.test.ts` — approved asset set, transparency, dimensions, and manifest alignment.
- Existing `virtual-office-scene`, `asset-manifest`, `asset-registry`, `frame-policy`, `surface-state`, `navigation`, and acceptance fixture tests remain required.

---

## Task 0: Reconcile the completed image approval gate

**Files:**
- Modify: `docs/superpowers/assets/2026-10-10-virtual-studio-asset-approval.md`
- Read: `docs/superpowers/specs/2026-10-10-virtual-studio-redesign-design.md`
- Do not modify: `apps/desktop/public/virtual-office/v1/` until the runtime conversion checks pass.

**Interfaces:**
- Consumes the already approved ledger and preserves one row per generated asset family: background, characters, desks, displays, rig preview/data, and composite preview.
- Produces no new art and does not infer approval from a continuation message; all rows must retain their explicit approval date.

- [x] **Step 1: Record the explicit approvals**

  Confirm that the ledger contains the exact states `not-started`, `generated`, `revision-requested`, `approved`, and `integrated`, and that each approved row has a dated user decision. The current ledger is the source of truth; do not duplicate it in another tracker.

- [x] **Step 2: Verify the gate is explicit**

  Run:

  ```bash
  rg -n "not-started|revision-requested|approved|integrated|public/virtual-office/v1" docs/superpowers/assets/README.md docs/superpowers/assets/2026-10-10-virtual-studio-asset-approval.md
  ```

  Expected: all five states and the production asset path appear in the output, with no approved row missing a date.

- [x] **Step 3: Commit the design/approval records**

  ```bash
  git add -f docs/superpowers/specs/2026-10-10-virtual-studio-redesign-design.md
  git commit -m "docs: lock virtual studio redesign plan"
  ```

## Task 1: Convert the approved visual asset families into runtime inputs

**Files:**
- Read approved drafts under: `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/`
- Create: `apps/desktop/scripts/build-virtual-office-assets.mjs`
- Create: `apps/desktop/test/virtual-office-asset-pipeline.test.ts`
- Integrate only after checks under: `apps/desktop/public/virtual-office/v1/`
- Modify: `docs/superpowers/assets/2026-10-10-virtual-studio-asset-approval.md`

**Interfaces:**
- Consumes exactly these approved inputs: `complete-studio-background-v1.png`, `characters-v1.png`, seven `character-*-turnaround-v1.png` sheets, `desk-state-variants-v1.png`, `display-source-art-v1.png`, and `rig-animation-data-v1.json`.
- Produces deterministic WebP/JSON runtime files: `office.webp`, `characters.webp`, `workstations.webp`, `workstations-front.webp`, `displays.webp`, `rig-animation-data.json`, and a manifest with hashes.
- Uses the repository's existing `sharp@0.35.3` dependency; the script must fail on a missing input, a non-RGBA source, or an unexpected source dimension rather than silently substituting art.

- [x] **Step 1: Verify the approved source set**

  Read the ledger and assert that all seven source families are `approved`. Check the source dimensions and alpha corners before conversion; do not regenerate or overwrite any draft.

- [x] **Step 2: Preserve the approval boundary**

  Keep generated drafts outside the public directory until the pipeline and manifest tests pass. A future revision must use a new filename and a new ledger row; this task does not regenerate approved art.

- [ ] **Step 3: Implement the deterministic conversion script**

  In `build-virtual-office-assets.mjs`, use `sharp` to:

  1. keep the background at 2172 × 724 RGBA and encode it as lossless WebP;
  2. crop the seven full-body character columns from `characters-v1.png` using the fixed source bands `[0,315), [315,630), [630,945), [945,1260), [1260,1575), [1575,1890), [1890,2203)` and place each role in a 128 × 128 transparent cell;
  3. crop the three desk variants from `desk-state-variants-v1.png` using 724-pixel bands, derive a desk shell from the lower 430 pixels, derive a front-edge overlay from the lower 180 pixels, and duplicate each state across the seven role columns;
  4. preserve `display-source-art-v1.png` as a 1536 × 1024 transparent WebP whose quadrants are described by manifest regions;
  5. copy the approved rig JSON to `rig-animation-data.json` without changing its bone or clip names;
  6. write the manifest using stable role order `ai-chat`, `agent-center`, `ppt-expert`, `workflow-operator`, `writer`, `image-creator`, `video-producer`, and SHA-256 each output.

- [ ] **Step 4: Add pipeline tests before running conversion**

  Add tests that run the script into a temporary directory and assert output names, dimensions, alpha-capable formats, role order, three desk states, seven rig clips, and stable hashes across two runs.

- [ ] **Step 5: Run the conversion and inspect outputs**

  Run `pnpm --dir apps/desktop run build:virtual-office-assets` and inspect each generated WebP on a white background. Expected output dimensions are `office.webp 2172×724`, `characters.webp 896×128`, `workstations.webp 896×288`, `workstations-front.webp 896×288`, and `displays.webp 1536×1024`.

- [ ] **Step 6: Expose and record the runtime paths**

  Add the exact command `"build:virtual-office-assets": "node scripts/build-virtual-office-assets.mjs"` to `apps/desktop/package.json`. Update the ledger's approved rows with the exact generated production path only after the pipeline tests pass; leave rows at `approved` if any check fails.

- [x] **Step 7: Preserve the separately approved display source**

  The display source is already approved and remains independently addressable through manifest regions; do not flatten it into the character atlas.

- [x] **Step 8: Preserve the separately approved display decision**

  The ledger records the explicit approval date; implementation may consume it only through the generated `displays.webp` output.

- [x] **Step 9: Preserve the approved rig data**

  Keep the approved visual preview and JSON companion immutable. The runtime adapter will consume the JSON in a later task.

- [x] **Step 10: Preserve the rig approval**

  The ledger records the explicit approval date independently from the character source approval.

- [x] **Step 11: Preserve the approved composite reference**

  Keep `complete-studio-ui-v1.png` as a visual reference only; runtime layers remain independently replaceable.

- [x] **Step 12: Preserve the composite approval**

  The composite has explicit approval; do not mark rows `integrated` until the new runtime outputs pass all verifier checks.

- [ ] **Step 13: Commit generated runtime assets and ledger**

  ```bash
  git add apps/desktop/public/virtual-office/v1 docs/superpowers/assets/2026-10-10-virtual-studio-asset-approval.md apps/desktop/scripts/build-virtual-office-assets.mjs apps/desktop/test/virtual-office-asset-pipeline.test.ts
  git commit -m "Add approved virtual studio runtime assets"
  ```

## Task 2: Lock the manifest and renderer-neutral visual contracts with tests first

**Files:**
- Modify: `apps/desktop/src/virtual-office/asset-registry.ts`
- Modify: `apps/desktop/src/virtual-office/types.ts`
- Create: `apps/desktop/src/virtual-office/visual-state.ts`
- Create: `apps/desktop/test/virtual-office-visual-state.test.ts`
- Create: `apps/desktop/test/virtual-office-rig.test.ts`
- Modify: `apps/desktop/test/virtual-office-asset-registry.test.ts`

**Interfaces:**

```ts
export type OfficeVisualState =
  | "idle" | "walk" | "work" | "thinking"
  | "waiting" | "completed" | "error" | "offline";

export interface OfficeRigBone { readonly name: string; readonly parent: string | null; readonly length: number; readonly x: number; readonly y: number; readonly rotation: number }
export interface OfficeRigSlot { readonly name: string; readonly bone: string; readonly zIndex: number; readonly blend: "normal" | "additive" }
export interface OfficeRigKeyframe { readonly t: number; readonly x?: number; readonly y?: number; readonly rotation?: number; readonly opacity?: number }
export interface OfficeRigClip { readonly durationMs: number; readonly loop: boolean; readonly tracks: Readonly<Record<string, readonly OfficeRigKeyframe[]>> }
export interface OfficeRigManifest { readonly schemaVersion: number; readonly bones: readonly OfficeRigBone[]; readonly slots: readonly OfficeRigSlot[]; readonly textureRegions: Readonly<Record<string, string>>; readonly clips: Readonly<Record<string, OfficeRigClip>>; readonly reducedMotion: { readonly staticPoseByClip: Readonly<Record<string, string>>; readonly disableStatusFx: boolean } }

export function resolveOfficeVisualState(
  state: Pick<OfficeRoleState, "status" | "available" | "activeCount" | "waitingUserCount">,
  previous?: OfficeVisualState,
): OfficeVisualState;
```

- [ ] **Step 1: Write failing visual-state tests**

  Cover these exact cases: unavailable → `offline`; failed → `error`; waiting with `waitingUserCount > 0` → `waiting`; running with a previous `thinking` state → `thinking`; running otherwise → `work`; completed → `completed`; idle with no active work → `idle`; a newly available role after `offline` → `walk` once.

- [ ] **Step 2: Run the focused test and verify failure**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-visual-state.test.ts
  ```

  Expected: FAIL because `visual-state.ts` and `resolveOfficeVisualState` do not exist yet.

- [ ] **Step 3: Implement the pure resolver**

  Implement the priority order in the interface above without importing Pixi, React, WorkbenchClient, or navigation. The resolver maps persisted facts to `offline`, `error`, `waiting`, `completed`, `work`, and `idle`; the renderer-only animator may alternate `work` and `thinking` on a deterministic phase while `activeCount > 0`, and may play one-shot `walk` only when an anchor is first created or the role becomes available. Repeated snapshots must not fabricate new work or retrigger one-shot clips.

- [ ] **Step 4: Add rig and manifest validation tests**

  Assert the exact bone and slot names from `rig-animation-data-v1.json`, all seven required keys in `clips`, positive durations, loop flags (`idle`, `work`, `thinking`, `waiting` loop; `walk`, `completed`, `error` one-shot), and rejection of unknown clips or duplicate bones. Validate the `reducedMotion.staticPoseByClip` map and `disableStatusFx: true` as well.

- [ ] **Step 5: Extend manifest and registry validation**

  Add stable IDs for `office`, `characters`, `workstations`, `workstations-front`, `displays`, and `rig`. Validate role IDs, per-asset cell dimensions, transparent asset dimensions, rig JSON path, clip names, and SHA-256 values while preserving the existing `/virtual-office/v1/` URL root.

- [ ] **Step 6: Run focused tests**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-visual-state.test.ts test/virtual-office-rig.test.ts test/virtual-office-asset-registry.test.ts test/virtual-office-asset-manifest.test.ts
  ```

  Expected: PASS with all old manifest rejection cases preserved.

- [ ] **Step 7: Commit contracts**

  ```bash
  git add apps/desktop/src/virtual-office/asset-registry.ts apps/desktop/src/virtual-office/types.ts apps/desktop/src/virtual-office/visual-state.ts apps/desktop/test/virtual-office-visual-state.test.ts apps/desktop/test/virtual-office-rig.test.ts apps/desktop/test/virtual-office-asset-registry.test.ts
  git commit -m "Add virtual studio visual-state and rig contracts"
  ```

## Task 3: Implement the layered Pixi renderer with isolated tests

**Files:**
- Create: `apps/desktop/src/virtual-office/character-rig.ts`
- Create: `apps/desktop/src/virtual-office/office-background-layer.ts`
- Create: `apps/desktop/src/virtual-office/office-desk-layer.ts`
- Create: `apps/desktop/src/virtual-office/office-display-layer.ts`
- Create: `apps/desktop/src/virtual-office/office-character-layer.ts`
- Modify: `apps/desktop/src/virtual-office/office-scene.ts`
- Modify: `apps/desktop/src/virtual-office/OfficeCanvasEnhancement.tsx`
- Create: `apps/desktop/test/virtual-office-layer-order.test.ts`
- Modify: `apps/desktop/test/virtual-office-scene.test.ts`

**Interfaces:**

```ts
export interface OfficeLayerContext {
  readonly app: Application;
  readonly root: Container;
  readonly manifest: OfficeAssetManifest;
  readonly callbacks: OfficeSceneCallbacks;
}

export interface OfficeLayerHandle {
  update(snapshot: OfficeSnapshot): void;
  destroy(): void;
}

export function createOfficeCharacterLayer(context: OfficeLayerContext): Promise<OfficeLayerHandle>;
export function createOfficeDeskLayer(context: OfficeLayerContext): Promise<OfficeLayerHandle>;
export function createOfficeDisplayLayer(context: OfficeLayerContext): Promise<OfficeLayerHandle>;
```

- [ ] **Step 1: Write layer-order and replacement tests**

  Assert that the scene creates the z-order `background < desk-back < character < display < desk-front < status/hit`, that replacing a character skin leaves desk and display object identity unchanged, and that replacing a display texture leaves character rig state unchanged.

- [ ] **Step 2: Run the focused test and verify failure**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-layer-order.test.ts test/virtual-office-scene.test.ts
  ```

  Expected: FAIL because the layer modules and new scene contract do not exist.

- [ ] **Step 3: Implement the background and anchor layer**

  Load the approved background texture through the validated manifest, size it to the container, and expose deterministic seven-station anchors. Keep layout calculations independent from business status.

- [ ] **Step 4: Implement the desk layer**

  Create one desk-back and one desk-front sprite per role anchor, select available/active/offline texture variants, and expose no business callbacks. Desk hit regions remain in the scene interaction layer.

- [ ] **Step 5: Implement the display layer**

  Create independent main and side display sprites, update screen copy from projected labels only, and render status glow from `OfficeVisualState`. Never import navigation or source adapters. The display layer must sit between the character and desk-front layers.

- [ ] **Step 6: Implement the rig adapter and character layer**

  Parse the approved rig manifest, create one rig instance per role, apply the role skin and prop, and play clips from `resolveOfficeVisualState`. On parse or texture failure, call the existing scene error callback and leave React fallback available.

- [ ] **Step 7: Recompose `office-scene.ts`**

  Keep `getOfficeDeviceSlots`, frame-policy wiring, visibility listeners, and callback guards. Replace direct atlas frame creation with the four layer handles and update all handles from the same snapshot.

- [ ] **Step 8: Preserve click semantics**

  Keep role hit regions mapped to `onOpenRole`, device markers mapped to `onActivate`, and the existing composite `OfficeWorkItemKey` untouched.

- [ ] **Step 9: Run focused renderer tests**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-layer-order.test.ts test/virtual-office-scene.test.ts test/virtual-office-frame-policy.test.ts test/virtual-office-surface-state.test.ts
  ```

  Expected: PASS with layer isolation, device-slot identity, frame policy, and fallback behavior covered.

- [ ] **Step 10: Commit the renderer split**

  ```bash
  git add apps/desktop/src/virtual-office apps/desktop/test/virtual-office-layer-order.test.ts apps/desktop/test/virtual-office-scene.test.ts
  git commit -m "Render virtual studio as independent layered modules"
  ```

## Task 4: Update the React shell and responsive visual treatment

**Files:**
- Modify: `apps/desktop/src/virtual-office/VirtualOfficeHome.tsx`
- Modify: `apps/desktop/src/virtual-office/OfficeCanvasEnhancement.tsx`
- Modify: `apps/desktop/src/virtual-office/virtual-office.css`
- Modify: `apps/desktop/test/virtual-office-components.test.ts`
- Modify: `apps/desktop/test/virtual-office-contrast.test.ts`
- Modify: `apps/desktop/test/fixtures/virtual-office-acceptance.tsx`
- Modify: `apps/desktop/test/fixtures/virtual-office-acceptance.html`

**Interfaces:**
- The public React props remain `snapshot`, `onActivate`, `onOpenRole`, `roleLabel`, `statusLabel`, and `onStateChange`.
- The scene remains optional; the fallback list is always rendered when roles are available.

- [ ] **Step 1: Add failing component assertions**

  Assert the warm scene wrapper, seven role anchors, bilingual state text, fallback cards, and the unchanged open / work-item callbacks in the acceptance fixture.

- [ ] **Step 2: Run the fixture tests and verify failure**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-components.test.ts test/virtual-office-contrast.test.ts
  ```

  Expected: FAIL only for the new scene markers and fixture expectations.

- [ ] **Step 3: Update CSS and shell markup**

  Add responsive island sizing, warm surface tokens, focus-safe fallback spacing, and a non-Canvas scene notice. Keep all text and controls in React; do not place essential labels only in Pixi.

- [ ] **Step 4: Update the acceptance fixture**

  Seed running, waiting, completed, failed, overflow, and unavailable roles so the new desk/display/character layers are exercised alongside the existing cards.

- [ ] **Step 5: Run focused UI tests**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-components.test.ts test/virtual-office-contrast.test.ts test/virtual-office-navigation.test.ts test/virtual-office-status.test.ts
  ```

  Expected: PASS with no loss of bilingual labels, keyboard names, status pairing, or navigation.

- [ ] **Step 6: Commit the shell update**

  ```bash
  git add apps/desktop/src/virtual-office/VirtualOfficeHome.tsx apps/desktop/src/virtual-office/OfficeCanvasEnhancement.tsx apps/desktop/src/virtual-office/virtual-office.css apps/desktop/test/virtual-office-components.test.ts apps/desktop/test/virtual-office-contrast.test.ts apps/desktop/test/fixtures/virtual-office-acceptance.tsx apps/desktop/test/fixtures/virtual-office-acceptance.html
  git commit -m "Polish the virtual studio shell and responsive fallback"
  ```

## Task 5: Harden asset, bundle, performance, and reduced-motion gates

**Files:**
- Modify: `apps/desktop/scripts/verify-virtual-office-assets.mjs`
- Modify: `apps/desktop/scripts/verify-virtual-office-bundle.mjs`
- Modify: `apps/desktop/src/virtual-office/frame-policy.ts`
- Modify: `apps/desktop/test/virtual-office-performance.test.ts`
- Modify: `apps/desktop/test/virtual-office-frame-policy.test.ts`
- Create: `apps/desktop/test/virtual-office-assets-generated.test.ts`

**Interfaces:**
- Asset verifier exits non-zero for missing approved files, bad hashes, invalid alpha / dimensions, unknown rig clips, duplicate IDs, or gzip budget violations.
- Frame policy continues to expose active, idle, hidden, and reduced-motion modes with deterministic transitions.

- [ ] **Step 1: Add failing generated-asset checks**

  Test the approved manifest for every required asset family, exact role IDs, required clips, and transparent texture metadata. Add a fixture that fails when one approved file is missing or its SHA-256 changes.

- [ ] **Step 2: Run the asset gate and verify failure on the bad fixture**

  ```bash
  pnpm --dir apps/desktop test -- --test-name-pattern="generated asset|asset manifest"
  ```

  Expected: the intentionally mutated fixture fails with a named validation error, while the checked-in approved set passes.

- [ ] **Step 3: Implement verifier checks**

  Validate relative paths, file existence, alpha-capable image formats, dimensions, rig JSON schema, clip names, role IDs, hashes, and the existing gzip total budget. Keep path traversal and symlink protections unchanged.

- [ ] **Step 4: Add bundle assertions**

  Verify the static entry does not contain Pixi or rig modules, and the dynamic scene chunk contains the renderer modules exactly once.

- [ ] **Step 5: Verify frame policy**

  Assert hidden stops ticker activity, idle caps at 15 FPS after the existing timeout, reduced-motion disables looping clips, and user activity restores active rendering.

- [ ] **Step 6: Run all virtual-office gates**

  ```bash
  pnpm --dir apps/desktop run verify:virtual-office-assets
  pnpm --dir apps/desktop run verify:virtual-office-bundle
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-performance.test.ts test/virtual-office-frame-policy.test.ts test/virtual-office-assets-generated.test.ts
  ```

  Expected: all commands exit 0 and print measured asset / bundle totals.

- [ ] **Step 7: Commit the gates**

  ```bash
  git add apps/desktop/scripts/verify-virtual-office-assets.mjs apps/desktop/scripts/verify-virtual-office-bundle.mjs apps/desktop/src/virtual-office/frame-policy.ts apps/desktop/test/virtual-office-performance.test.ts apps/desktop/test/virtual-office-frame-policy.test.ts apps/desktop/test/virtual-office-assets-generated.test.ts
  git commit -m "Enforce virtual studio asset and motion performance gates"
  ```

## Task 6: Full verification and macOS visual acceptance

**Files:**
- Modify: `docs/superpowers/assets/2026-10-10-virtual-studio-asset-approval.md`
- Create: `docs/superpowers/evidence/2026-10-10-virtual-studio-acceptance.md`
- No source changes unless a verification failure identifies a concrete regression.

- [ ] **Step 1: Run focused virtual-office tests**

  ```bash
  pnpm --dir apps/desktop test -- test/virtual-office-*.test.ts
  ```

  Expected: all virtual-office tests pass.

- [ ] **Step 2: Run desktop typecheck and build**

  ```bash
  pnpm --dir apps/desktop run typecheck
  pnpm --dir apps/desktop run build
  ```

  Expected: TypeScript exits 0 and Vite produces a static entry plus a dynamic renderer chunk.

- [ ] **Step 3: Run the macOS build checks available in the environment**

  ```bash
  pnpm --dir apps/desktop run build:macos
  pnpm --dir apps/desktop run verify:virtual-office-assets
  pnpm --dir apps/desktop run verify:virtual-office-bundle
  ```

  Expected: each executable command exits 0; record unavailable host prerequisites instead of masking them.

- [ ] **Step 4: Execute visual acceptance matrix**

  Record screenshots and observations for: seven-station composition, role colors, independent layer visibility, idle, walk, work, thinking, waiting, completed, error, reduced-motion, hidden-window pause, fallback after asset failure, keyboard / screen-reader React view, and click-through navigation.

- [ ] **Step 5: Record evidence and remaining risks**

  Include commit SHA, macOS version, commands, screenshot paths, measured bundle / asset totals, and any untested host-specific behavior. Explicitly state that Windows validation remains deferred.

- [ ] **Step 6: Commit evidence**

  ```bash
  git add docs/superpowers/assets/2026-10-10-virtual-studio-asset-approval.md docs/superpowers/evidence/2026-10-10-virtual-studio-acceptance.md
  git commit -m "Record virtual studio macOS acceptance evidence"
  ```

---

## Plan Self-Review

- Spec coverage: visual decisions are covered by Tasks 1–4; independent image approval is covered by Tasks 0–1; data isolation and fallback are covered by Tasks 2–4; resource integrity and performance are covered by Task 5; macOS evidence is covered by Task 6.
- Placeholder scan: no unresolved placeholder marker or unnamed implementation step is used in the plan.
- Type consistency: `OfficeVisualState`, `OfficeRigClip`, `OfficeRigManifest`, `OfficeLayerContext`, and `OfficeLayerHandle` are defined before consumers; the existing `OfficeSceneCallbacks` and `OfficeSnapshot` remain the integration boundary.
- Scope: image generation is explicitly gated and separate from code integration; no unrelated workbench or persistence changes are included.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-10-virtual-studio-redesign-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task and review between tasks.
2. **Inline Execution** — execute the tasks in this session with checkpoints.

