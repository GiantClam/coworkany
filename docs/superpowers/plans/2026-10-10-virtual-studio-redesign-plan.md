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
- The approval ledger records `integrated` for the runtime background, character atlas derivative, desk back/front atlases, display atlas, and rig JSON; the seven 8-view turnarounds and composite preview remain `approved` design references by design.
- `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/rig-animation-data-v1.json` is the exact normalized keyframe source for the renderer adapter; it is not a Spine/DragonBones file.
- Runtime outputs are present under `apps/desktop/public/virtual-office/v1/` and are guarded by the generated manifest, SHA-256 checks, a 2.5 MB gzip budget, and the React fallback path.

### Completion checkpoint (2026-10-11, Asia/Shanghai)

The approved runtime scope is implemented. The scene now renders independent background, desk-back, character rig, display, desk-front, status, and interaction layers; the role state resolver covers idle, walk, work, thinking, waiting, completed, error, and offline; reduced-motion maps to static poses and disables status effects. The browser check at `/dashboard/office` rendered the 3+4 island layout and opened a role status card. macOS packaging and Windows release validation remain outside this checkpoint.

The approved split-head continuation is also implemented: each role now renders overlapping head/body textures from its full atlas cell, with body on `torso` and head on `head`; initial available roles remain idle instead of entering an unintended startup walk.

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

- [x] **Step 3: Implement the deterministic conversion script**

  In `build-virtual-office-assets.mjs`, use `sharp` to:

  1. keep the background at 2172 × 724 RGBA and encode it as lossless WebP;
  2. crop the seven full-body character columns from `characters-v1.png` using the fixed source bands `[0,315), [315,630), [630,945), [945,1260), [1260,1575), [1575,1890), [1890,2203)` and place each role in a 128 × 128 transparent cell;
  3. crop the three desk variants from `desk-state-variants-v1.png` using 724-pixel bands, derive a desk shell from the lower 430 pixels, derive a front-edge overlay from the lower 180 pixels, and duplicate each state across the seven role columns;
  4. preserve `display-source-art-v1.png` as a 1536 × 1024 transparent WebP whose quadrants are described by manifest regions;
  5. copy the approved rig JSON to `rig-animation-data.json` without changing its bone or clip names;
  6. write the manifest using stable role order `ai-chat`, `agent-center`, `ppt-expert`, `workflow-operator`, `writer`, `image-creator`, `video-producer`, and SHA-256 each output.

- [x] **Step 4: Add pipeline tests before running conversion**

  Add tests that run the script into a temporary directory and assert output names, dimensions, alpha-capable formats, role order, three desk states, seven rig clips, and stable hashes across two runs.

- [x] **Step 5: Run the conversion and inspect outputs**

  Run `pnpm --dir apps/desktop run build:virtual-office-assets` and inspect each generated WebP on a white background. Expected output dimensions are `office.webp 2172×724`, `characters.webp 896×128`, `workstations.webp 896×288`, `workstations-front.webp 896×288`, and `displays.webp 1536×1024`.

- [x] **Step 6: Expose and record the runtime paths**

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

- [x] **Step 13: Commit generated runtime assets and ledger**

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

- [x] **Step 1: Write failing visual-state tests**

  Cover these exact cases: unavailable → `offline`; failed → `error`; waiting with `waitingUserCount > 0` → `waiting`; running with a previous `thinking` state → `thinking`; running otherwise → `work`; completed → `completed`; idle with no active work → `idle`; a newly available role after `offline` → `walk` once.

- [x] **Step 2: Run the focused test and verify failure**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-visual-state.test.ts
  ```

  Expected: FAIL because `visual-state.ts` and `resolveOfficeVisualState` do not exist yet.

- [x] **Step 3: Implement the pure resolver**

  Implement the priority order in the interface above without importing Pixi, React, WorkbenchClient, or navigation. The resolver maps persisted facts to `offline`, `error`, `waiting`, `completed`, `work`, and `idle`; the renderer-only animator may alternate `work` and `thinking` on a deterministic phase while `activeCount > 0`, and may play one-shot `walk` only when an anchor is first created or the role becomes available. Repeated snapshots must not fabricate new work or retrigger one-shot clips.

- [x] **Step 4: Add rig and manifest validation tests**

  Assert the exact bone and slot names from `rig-animation-data-v1.json`, all seven required keys in `clips`, positive durations, loop flags (`idle`, `walk`, `work`, `thinking`, `waiting` loop; `completed`, `error` one-shot), and rejection of unknown clips or duplicate bones. The renderer clamps the looping walk clip to its entry transition when it needs a one-shot arrival. Validate the `reducedMotion.staticPoseByClip` map and `disableStatusFx: true` as well.

- [x] **Step 5: Extend manifest and registry validation**

  Add stable IDs for `office`, `characters`, `workstations`, `workstations-front`, `displays`, and `rig`. Validate role IDs, per-asset cell dimensions, transparent asset dimensions, rig JSON path, clip names, and SHA-256 values while preserving the existing `/virtual-office/v1/` URL root.

- [x] **Step 6: Run focused tests**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-visual-state.test.ts test/virtual-office-rig.test.ts test/virtual-office-asset-registry.test.ts test/virtual-office-asset-manifest.test.ts
  ```

  Expected: PASS with all old manifest rejection cases preserved.

- [x] **Step 7: Commit contracts**

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

- [x] **Step 1: Write layer-order and replacement tests**

  Assert that the scene creates the z-order `background < desk-back < display < character < desk-front < status/hit`, that replacing a character skin leaves desk and display object identity unchanged, and that replacing a display texture leaves character rig state unchanged.

- [x] **Step 2: Run the focused test and verify failure**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-layer-order.test.ts test/virtual-office-scene.test.ts
  ```

  Expected: FAIL because the layer modules and new scene contract do not exist.

- [x] **Step 3: Implement the background and anchor layer**

  Load the approved background texture through the validated manifest, size it to the container, and expose deterministic seven-station anchors. Keep layout calculations independent from business status.

- [x] **Step 4: Implement the desk layer**

  Create one desk-back and one desk-front sprite per role anchor, select available/active/offline texture variants, and expose no business callbacks. Desk hit regions remain in the scene interaction layer.

- [x] **Step 5: Implement the display layer**

  Create independent main and side display sprites, update screen copy from projected labels only, and render status glow from `OfficeVisualState`. Never import navigation or source adapters. The display layer must sit behind the character and desk-front layers so the person reads as seated at the workstation.

- [x] **Step 6: Implement the rig adapter and character layer**

  Parse the approved rig manifest, create one rig instance per role, apply the role skin and prop, and play clips from `resolveOfficeVisualState`. On parse or texture failure, call the existing scene error callback and leave React fallback available.

- [x] **Step 7: Recompose `office-scene.ts`**

  Keep `getOfficeDeviceSlots`, frame-policy wiring, visibility listeners, and callback guards. Replace direct atlas frame creation with the four layer handles and update all handles from the same snapshot.

- [x] **Step 8: Preserve click semantics**

  Keep role hit regions mapped to `onOpenRole`, device markers mapped to `onActivate`, and the existing composite `OfficeWorkItemKey` untouched.

- [x] **Step 9: Run focused renderer tests**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-layer-order.test.ts test/virtual-office-scene.test.ts test/virtual-office-frame-policy.test.ts test/virtual-office-surface-state.test.ts
  ```

  Expected: PASS with layer isolation, device-slot identity, frame policy, and fallback behavior covered.

- [x] **Step 10: Commit the renderer split**

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

- [x] **Step 1: Add failing component assertions**

  Assert the warm scene wrapper, seven role anchors, bilingual state text, fallback cards, and the unchanged open / work-item callbacks in the acceptance fixture.

- [x] **Step 2: Run the fixture tests and verify failure**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-components.test.ts test/virtual-office-contrast.test.ts
  ```

  Expected: FAIL only for the new scene markers and fixture expectations.

- [x] **Step 3: Update CSS and shell markup**

  Add responsive island sizing, warm surface tokens, focus-safe fallback spacing, and a non-Canvas scene notice. Keep all text and controls in React; do not place essential labels only in Pixi.

- [x] **Step 4: Update the acceptance fixture**

  Seed running, waiting, completed, failed, overflow, and unavailable roles so the new desk/display/character layers are exercised alongside the existing cards.

- [x] **Step 5: Run focused UI tests**

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

- [x] **Step 1: Add failing generated-asset checks**

  Test the approved manifest for every required asset family, exact role IDs, required clips, and transparent texture metadata. Add a fixture that fails when one approved file is missing or its SHA-256 changes.

- [x] **Step 2: Run the asset gate and verify failure on the bad fixture**

  ```bash
  pnpm --dir apps/desktop test -- --test-name-pattern="generated asset|asset manifest"
  ```

  Expected: the intentionally mutated fixture fails with a named validation error, while the checked-in approved set passes.

- [x] **Step 3: Implement verifier checks**

  Validate relative paths, file existence, alpha-capable image formats, dimensions, rig JSON schema, clip names, role IDs, hashes, and the existing gzip total budget. Keep path traversal and symlink protections unchanged.

- [x] **Step 4: Add bundle assertions**

  Verify the static entry does not contain Pixi or rig modules, and the dynamic scene chunk contains the renderer modules exactly once.

- [x] **Step 5: Verify frame policy**

  Assert hidden stops ticker activity, idle caps at 15 FPS after the existing timeout, reduced-motion disables looping clips, and user activity restores active rendering.

- [x] **Step 6: Run all virtual-office gates**

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

- [x] **Step 1: Run focused virtual-office tests**

  ```bash
  pnpm --dir apps/desktop test -- test/virtual-office-*.test.ts
  ```

  Expected: all virtual-office tests pass.

- [x] **Step 2: Run desktop typecheck and Vite build**

  ```bash
  pnpm --dir apps/desktop run typecheck
  pnpm --dir apps/desktop run build
  ```

  Expected: TypeScript exits 0 and Vite produces a static entry plus a dynamic renderer chunk.

- [x] **Step 3: Run the macOS build checks available in the environment**

  ```bash
  pnpm --dir apps/desktop run build:macos
  pnpm --dir apps/desktop run verify:virtual-office-assets
  pnpm --dir apps/desktop run verify:virtual-office-bundle
  ```

  Expected: each executable command exits 0; record unavailable host prerequisites instead of masking them.

- [x] **Step 4: Execute visual acceptance matrix**

  Record screenshots and observations for: seven-station composition, role colors, independent layer visibility, idle, walk, work, thinking, waiting, completed, error, reduced-motion, hidden-window pause, fallback after asset failure, keyboard / screen-reader React view, and click-through navigation.

- [x] **Step 5: Record evidence and remaining risks**

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

The shell, generated-asset, bundle, and macOS verification steps were completed in the shared working tree on 2026-10-11. The historical commit-only steps remain unchecked because this continuation deliberately leaves commit ownership with the workspace owner.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task and review between tasks.
2. **Inline Execution** — execute the tasks in this session with checkpoints.

---

## Approved Visual Correction Addendum (2026-10-11)

**Goal:** Align each character with the desk and monitor in the approved composite while making the monitor's work state readable in the live layered renderer.

**Architecture:** Keep the existing independent layers and shared station anchors. Render the display behind the character, lower the character baseline so the desk-front overlay masks the legs, and add a renderer-only screen-status overlay driven by the already projected visual state and animation phase. No business-state source or asset approval boundary changes.

**Files:**
- Modify: `apps/desktop/src/virtual-office/office-layer-types.ts` — update layer z-order constants and display-node overlay fields if needed.
- Modify: `apps/desktop/src/virtual-office/office-character-layer.ts` — lower the character root baseline relative to the station anchor.
- Modify: `apps/desktop/src/virtual-office/office-display-layer.ts` — draw compact state/progress UI inside each screen and animate it from `phaseMs`.
- Modify: `apps/desktop/test/virtual-office-layer-order.test.ts` — assert display < character < desk-front and the overlay contract.

- [x] **Step 1: Lock the visual contract in tests**

  Update the layer-order expectation to `background < deskBack < display < character < deskFront < status`. Add an assertion that every display node owns a state overlay and that `update` changes its visual state without adding a second business-state source.

- [x] **Step 2: Implement the minimal ordering and baseline correction**

  Set `OFFICE_LAYER_Z.display = 20`, `character = 30`, and keep `deskFront = 40`. In the character resize path use the seated factor `anchor.y + characterHeight * OFFICE_SEATED_ROOT_Y_FACTOR` (`OFFICE_SEATED_ROOT_Y_FACTOR = -0.04`) so the hips align with the chair cushion while the desk front still masks the lower body and the head/torso remain in front of the screen. Keep the existing shared anchor and texture scale.

- [x] **Step 3: Implement compact screen-state UI**

  The original compact-label proposal is superseded by the approved no-text addendum below: use only a `Graphics` status bar and geometric progress/line cues. Use the resolved visual state colors, derive a deterministic pulse/progress width from `phaseMs`, preserve reduced-motion behavior, and position the chrome in the upper-middle of the screen so the character layer cannot obscure it.

- [x] **Step 4: Run focused checks and browser acceptance**

  Run the layer-order, scene, visual-state, and projector tests; then run typecheck, Vite build, and both virtual-office verification scripts. Reload `/dashboard/office`, confirm seven visible idle stations, inspect the composite screenshot, and confirm no browser console warnings/errors.

- [x] **Step 5: Record the result**

  Leave the live browser tab open for review and report the exact commands and outcomes. If the standing source atlas still leaves a small pose mismatch, state that the desk occlusion is the intentional approximation and that a separately approved seated atlas would be a future art revision.

## Approved No-Text Canvas Addendum (2026-10-11)

**Goal:** Remove decorative Pixi text from the studio canvas because the visual workspace has too much copy, while retaining the React role cards and non-text visual state cues.

**Architecture:** The canvas remains a decorative, image-led composition. Role identity is communicated by the approved character/desk/display art and station position; state is communicated by status color, screen progress geometry, and the existing character animation. React cards remain the accessible textual source for role names and statuses, so this change does not remove keyboard or screen-reader information.

**Files:**
- Modify: `apps/desktop/src/virtual-office/office-display-layer.ts` — remove Pixi `Text` labels and state-copy helpers; retain the `Graphics` screen UI, status lights, and animated progress geometry.
- Modify: `apps/desktop/src/virtual-office/office-layer-types.ts` — remove the display-node `copy` contract.
- Modify: `apps/desktop/src/virtual-office/office-scene.ts` — remove role-name, device-status, and overflow-count `Text` objects from the decorative interaction overlay while keeping hit areas and colored markers.
- Modify: `apps/desktop/test/virtual-office-layer-order.test.ts` — assert that the rendered Pixi layer tree contains no `Text` nodes and that the screen graphics still update for active states.

**Interfaces:**
- The display layer continues to expose `screenUi: Graphics`, `status: Graphics`, `visualState`, and optional `tick(): void`; no business-state source is added.
- The React fallback cards and their existing `roleLabel`/`statusLabel` callbacks remain unchanged.

- [x] **Step 1: Add the failing no-text regression test**

  Extend `apps/desktop/test/virtual-office-layer-order.test.ts` with a recursive Pixi-container helper that detects `Text` descendants. Assert that a composed scene has no text descendants, and replace the old `copy.text` assertions with checks for `visualState` and a non-empty `screenUi` bounds rectangle. Run the focused layer-order test and confirm it fails because the current display node still creates `copy`.

- [x] **Step 2: Remove display-screen text**

  In `office-display-layer.ts`, remove the `Text` import, bilingual screen-label constants, `statusText`/`screenStatusText` helpers, `copy` construction/positioning, and `node.copy.text` updates. Keep `screenUi` and its color/progress/line drawing, including the existing `tick()` pulse. Remove `copy` from `OfficeDisplayLayerNode` in `office-layer-types.ts`.

- [x] **Step 3: Remove interaction-overlay text**

  In `office-scene.ts`, remove the `Text` import and the role-name, device-status, and `+N` overflow text nodes. Keep the role/device hit areas, colored device marker graphics, click handlers, and layout calculations. `renderOverlay` must no longer assign text, visibility, or text positions.

- [x] **Step 4: Run focused regression checks**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-layer-order.test.ts test/virtual-office-scene.test.ts test/virtual-office-visual-state.test.ts test/virtual-office-projector.test.ts
  pnpm --dir apps/desktop run typecheck
  ```

  Expected: all focused tests and TypeScript checks pass; the layer test explicitly proves that no Pixi `Text` remains while active screen graphics still render.

- [x] **Step 5: Run build, asset, bundle, and full-suite verification**

  ```bash
  pnpm --dir apps/desktop exec vite build
  pnpm --dir apps/desktop run verify:virtual-office-assets
  pnpm --dir apps/desktop run verify:virtual-office-bundle
  pnpm --dir apps/desktop run test
  git diff --check
  ```

  Expected: every command exits 0; the full desktop suite remains green and the virtual-office asset/bundle budgets are unchanged.

- [x] **Step 6: Verify the live browser composition**

  Reload `http://127.0.0.1:1420/dashboard/office`, confirm one canvas and seven role cards with seven idle statuses, and inspect the screenshot for a text-free canvas, visible character/desk/display art, colored screen progress, and no console errors or warnings. Leave the tab open for review; React cards must still expose role names and statuses below the canvas.

## Approved Character Motion Addendum (2026-10-11)

**Goal:** Make the approved text-free studio feel naturally occupied: characters read as seated by default, active task geometry is larger, walk transitions use distinct directions and phases, and heads gently look left/right.

**Architecture:** Keep the existing role-parametric atlas and renderer-neutral rig. The character layer adds deterministic per-role motion offsets at render time; the display layer scales its existing `Graphics` panel for active visual states. No business-state schema or new asset is introduced, and React cards remain the semantic text surface.

**Design reference:** `docs/superpowers/specs/2026-10-11-virtual-studio-character-motion-design.md`

**Files:**
- Modify: `apps/desktop/src/virtual-office/office-character-layer.ts` — add stable role phase/direction helpers, seated-state baseline constants, and a procedural head-bone sway layered over rig evaluations.
- Modify: `apps/desktop/src/virtual-office/office-display-layer.ts` — enlarge active-state screen geometry while preserving the text-free `Graphics` contract.
- Modify: `apps/desktop/test/virtual-office-visual-state.test.ts` or a focused character-layer test — cover stable walk direction/phase and reduced-motion head behavior.
- Modify: `apps/desktop/test/virtual-office-layer-order.test.ts` — keep the no-Text assertion and assert the active screen geometry is larger than idle geometry.

**Interfaces:**
- Character nodes continue to expose the same `bones`, `visualState`, and `update(snapshot)` API; motion offsets are internal to the renderer.
- Display nodes continue to expose `screenUi: Graphics` and no `copy: Text` field.

- [x] **Step 1: Add failing motion and task-scale tests**

  Add deterministic test seams for the character layer's renderer clock and assert that adjacent role indices receive opposite walk direction signs, distinct phase offsets, and changing head rotation between two timestamps. Assert that reduced motion produces a stable head rotation. In the display test, capture the idle and running `screenUi` bounds and assert the running panel is larger.

- [x] **Step 2: Implement seated, desynchronised character motion**

  Keep the existing desk-occlusion baseline for idle/work/waiting. Derive `walkDirection = index % 2 === 0 ? 1 : -1` and a stable role phase (for example `index * 173ms`); feed both into walk evaluation timing/root x offset. Add a small sine-based rotation to the `head` bone after rig evaluation (`idle/work` subtle, `thinking/waiting` slightly stronger), and force the offset to zero when reduced motion is enabled.

- [x] **Step 3: Enlarge active task geometry**

  In `drawScreenUi`, use the enlarged base panel factors (`0.56` of display width and `0.32` of display height), then use a state multiplier of `1` for idle/terminal states and `1.5` for work/thinking/walk. Scale the panel dimensions and progress/line geometry together so the active task is visibly larger without introducing text or changing the station anchor.

- [x] **Step 4: Run focused checks**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-layer-order.test.ts test/virtual-office-scene.test.ts test/virtual-office-visual-state.test.ts test/virtual-office-rig.test.ts test/virtual-office-projector.test.ts
  pnpm --dir apps/desktop run typecheck
  ```

  Expected: no-text, motion, reduced-motion, and screen-scale assertions pass; TypeScript reports no API regressions.

- [x] **Step 5: Run complete verification and browser acceptance**

  Run the Vite build, virtual-office asset/bundle gates, full desktop suite, `git diff --check`, and reload `/dashboard/office`. Confirm seven seated idle characters, no synchronized walk direction when a transition is exercised, visibly larger active task panels, subtle head sway, seven textual React cards, and no browser console errors or warnings.

### Addendum self-review

- Spec coverage: the no-text addendum removes all decorative Pixi copy while retaining React accessibility; the motion addendum covers seated baseline, role-offset walking, visible head/torso sway, active task scaling, and reduced-motion behavior.
- Placeholder scan: the two addenda contain no `TODO`, `TBD`, or unnamed implementation step; every new step has an exact file, behavior, or verification command.
- Interface consistency: `OfficeDisplayLayerNode` exposes `screenUi` and no `copy`; character motion remains internal to `OfficeCharacterLayerHandle`; no business-state or asset-manifest contract changes.

## Approved Split Head/Body Continuation (2026-10-11)

**Goal:** Finish the remaining motion gap by making the head sprite independently rotatable while preserving the approved atlas, seated baseline, renderer-only state ownership, and no-text canvas.

**Architecture:** Add a small atlas-part helper that derives overlapping `head` and `body` frames from each existing 128×128 role cell. The character layer creates two sprites per role: body under `torso`, head under `head`. Bone coordinates and seated placement use a full-cell scaled height; cropped sprite dimensions are never used as rig units. Replacement textures are split through the same helper so the public layer contract remains coherent.

**Files:**
- Modify: `apps/desktop/src/virtual-office/office-layer-assets.ts` — add deterministic full-cell and part-frame helpers.
- Modify: `apps/desktop/src/virtual-office/office-layer-types.ts` — expose body/head sprites and full scaled character height on character nodes.
- Modify: `apps/desktop/src/virtual-office/office-character-layer.ts` — create, position, resize, update, replace, and destroy the two part sprites; remove torso-coupled procedural sway once the head slot is visual.
- Modify: `apps/desktop/test/virtual-office-layer-order.test.ts` — assert distinct part textures, slot parenting, full-height seating math, independent head transform, and replacement behavior.
- Modify: `docs/superpowers/specs/2026-10-11-virtual-studio-character-motion-design.md` — record the approved continuation and acceptance criteria.

- [x] **Step 1: Add failing atlas-part and layer tests**

  Add tests that call `character.nodes.get("ai-chat")!` and assert `body`/`head` are distinct sprites, their texture frames have different `y`/`height`, `body.parent` is the torso bone, `head.parent` is the head bone, and `characterHeight` equals the full-cell scale rather than `body.height`. Add a timestamp test that changes only the head bone rotation and asserts the head sprite world transform changes while the body sprite world transform remains unchanged. Add a replacement-texture test using `setTexture` and assert both part textures are rebuilt from the replacement source.

- [x] **Step 2: Implement deterministic part frames**

  In `office-layer-assets.ts`, derive the full role cell first, then use an overlap seam: `headHeight = round(cell.height * 0.58)`, `bodyY = round(cell.height * 0.40)`, `bodyHeight = cell.height - bodyY`. Return `Rectangle(cell.x, cell.y, cell.width, headHeight)` for the head and `Rectangle(cell.x, cell.y + bodyY, cell.width, bodyHeight)` for the body. Preserve the existing manifest-region fallback and do not mutate the source texture.

- [x] **Step 3: Mount split sprites and preserve full-height rig math**

  Create the body sprite from the body frame and the head sprite from the head frame. Set both anchors to `(0.5, 1)`, attach body to `torso`, attach head to `head`, and position the head sprite at `y = -fullHeight * 0.14` relative to the head bone so its crop bottom aligns with the original full-cell silhouette. Store `characterHeight = fullCellHeight * scale` on the node. Use this value for bone coordinates, status radius, root placement, and seated-root tests. Apply full procedural sway only to the head bone; remove the temporary `0.5` torso coupling. Keep `character` as the body alias for compatibility and add `body`/`head` fields explicitly.

- [x] **Step 4: Split replacement textures and clean up**

  Update `setTexture` to retain the replacement source, rebuild both part textures with the role's cell, call `resize`, and destroy the old part textures when Pixi ownership permits. Keep the body alias synchronized. Ensure `destroy()` removes both sprites and no texture is leaked by the layer-owned derived frames.

- [x] **Step 5: Run focused tests and typecheck**

  ```bash
  pnpm --dir apps/desktop exec tsx --test test/virtual-office-layer-order.test.ts test/virtual-office-scene.test.ts test/virtual-office-visual-state.test.ts test/virtual-office-rig.test.ts test/virtual-office-projector.test.ts
  pnpm --dir apps/desktop run typecheck
  ```

  Expected: all focused tests pass, including distinct texture frames, parent slots, full-height seated math, independent head transform, replacement textures, and reduced-motion freeze.

- [x] **Step 6: Run complete verification and browser acceptance**

  ```bash
  pnpm --dir apps/desktop exec vite build
  pnpm --dir apps/desktop run verify:virtual-office-assets
  pnpm --dir apps/desktop run verify:virtual-office-bundle
  pnpm --dir apps/desktop run test
  git diff --check
  ```

  Reload `http://127.0.0.1:1420/dashboard/office`, confirm seven seated idle characters, inspect a head sway frame, confirm the canvas remains text-free, and check that browser logs contain no errors or warnings. Leave the tab open for review.

### Split head/body continuation self-review

- Spec coverage: atlas part derivation, independent bone parenting, full-cell rig units, replacement textures, reduced motion, and all required verification commands are covered by Tasks 1–6.
- Placeholder scan: no `TODO`, `TBD`, or unspecified implementation step remains in this continuation.
- Type consistency: `createRolePartTexture`, `roleCellRectangle`, `OfficeCharacterLayerNode.body`, `OfficeCharacterLayerNode.head`, and `characterHeight` are defined before their consumers and are used consistently across resize, replacement, tests, and cleanup.

## Approved chair/seated continuation (2026-10-11)

**Goal:** Make the seated relationship unambiguous after the split head/body pass. The approved transparent PNG chair is split into a rear seat/base and a foreground backrest so the rear-view character reads as seated: the chair back covers the torso, the head remains visible, and the text-free canvas is preserved.

**Files:**
- Add: `apps/desktop/src/virtual-office/office-chair-layer.ts` — renderer-owned chair silhouettes and thin cushion occlusion.
- Modify: `apps/desktop/src/virtual-office/office-layer-types.ts` — chair node/handle contracts and z-order constants.
- Modify: `apps/desktop/src/virtual-office/office-scene.ts` — mount, update, reduced-motion, and destroy the chair layer.
- Modify: `apps/desktop/src/virtual-office/office-character-layer.ts` — use the chair-aligned seated baseline and slightly larger chibi fit.
- Modify: `apps/desktop/test/virtual-office-layer-order.test.ts` — assert chair roots, z-order, and no-text behavior.
- Add: `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/office-chair-v1.png` — approved transparent chair source; runtime crop is generated at `apps/desktop/public/virtual-office/v1/office-chair.png`.

- [x] **Step 1: Add chair layer and cushion edge**

  Create stable per-role chair nodes from the approved PNG. Keep the complete seat/base in a compact chair layer above the desk/lower body and render a cropped backrest plus a thin cushion edge in a separate foreground root. The visible order is desk/display → character → chair base → chair back.

- [x] **Step 2: Mount the layer and adjust seated fit**

  Insert the chair base above the desk front and lower character body, keep the backrest in the foreground root, hide both with absent roles, align the character hips to the chair cushion, and fit the complete chair slightly below the chibi height so the seat, stem, and casters remain visible.

- [x] **Step 3: Verify browser and regression gates**

  Run focused layer tests, typecheck, Vite build, asset/bundle gates, the full desktop suite, `git diff --check`, and a browser smoke check. Confirm seven chairs/seated characters, text-free canvas, active screen geometry, and zero browser errors/warnings.

### Chair continuation self-review

- The chair is an independent renderer layer and loads the approved `chair` manifest asset; the source texture is split into stable rear and foreground frames without changing the scene contract.
- The cushion edge is intentionally thin and narrower than the 128px station cell; the foreground backrest supplies the body occlusion while the head remains visible from the rear view.
- No business state, role labels, or accessibility semantics moved into Pixi.
