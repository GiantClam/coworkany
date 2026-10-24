# Virtual Studio Acceptance Evidence

**Date:** 2026-10-11 (Asia/Shanghai)
**Scope:** approved warm 2.5D virtual studio redesign, runtime layer split, normalized rig adapter, and approved asset pipeline.

## Runtime evidence

- The local `/dashboard/office` route rendered the approved 3+4 island composition with seven back-facing chibi roles, independent desks, dual displays, independent chair silhouettes, and the React status-card surface. Character names and statuses remain in the accessible React cards; the Pixi canvas itself is text-free.
- The character renderer now uses distinct head/body atlas parts (body on `torso`, head on `head`) with deterministic per-role walk direction/phase and procedural head sway. The approved PNG chair is fitted at roughly two thirds of the previous chibi-height scale and split into a complete seat/base sprite plus a foreground backrest: the complete chair is lifted as one unit until the backrest meets the lower hairline, while the character uses a deeper seated baseline. The backrest covers the torso but leaves the head visible for the requested rear-view seated read. The layer order is desk/display → character → chair base → chair back.
- A fresh browser tab loaded the scene without console errors after the optional rig manifest was mapped to the safe `idle` clip for offline roles. The browser smoke check reported one canvas, seven role cards, and zero error/warning logs.
- Clicking a role in the scene opened its status card; the full React cards remained visible as the accessible fallback.
- Reduced-motion and hidden-window behavior remain owned by the existing frame policy; the character layer exposes static poses and disables status effects when reduced motion is active.
- Compact WebView widths use a shorter panoramic stage so the seven-station island remains visible without a tall empty canvas; the live compact check still reported one canvas, seven role cards, and zero logs.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm --dir apps/desktop exec tsx --test test/virtual-office-*.test.ts` | 104 passed, 0 failed |
| `pnpm --dir apps/desktop run test` | 614 passed, 0 failed |
| `pnpm --dir apps/desktop run typecheck` | passed |
| `pnpm --dir apps/desktop exec vite build` | passed; a versioned `office-scene-*.js` dynamic scene chunk was emitted |
| `pnpm --dir apps/desktop run verify:virtual-office-assets` | passed; gzip total 1,894,252 bytes (under 2,500,000-byte budget) |
| `pnpm --dir apps/desktop run verify:virtual-office-bundle` | passed; static closure clean, dynamic Pixi scene present |
| `pnpm --dir apps/desktop run build:macos` | passed; macOS arm64 runtime staged, Vite bundle emitted, icon generated |
| `git diff --check` on owned files | passed |

The focused layer test covers split head/body parenting, no-text display geometry, alternating walk direction/phase, chair z-order, visible chair nodes, and the thin cushion occlusion height guard. The full suite result above is the fresh post-chair and asset-gate run.

## Production asset paths

- `apps/desktop/public/virtual-office/v1/office.webp`
- `apps/desktop/public/virtual-office/v1/characters.webp`
- `apps/desktop/public/virtual-office/v1/workstations.webp`
- `apps/desktop/public/virtual-office/v1/workstations-front.webp`
- `apps/desktop/public/virtual-office/v1/office-chair.png`
- `apps/desktop/public/virtual-office/v1/displays.webp`
- `apps/desktop/public/virtual-office/v1/rig-animation-data.json`
- `apps/desktop/public/virtual-office/v1/manifest.json`

The seven approved 8-view turnaround sheets, rig preview, and composite preview remain immutable design references under `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/`; normalized runtime derivatives plus the approved cropped chair PNG enter the public bundle.

## Remaining limits

This evidence covers the local Vite/macOS-targeted renderer path and the available `build:macos` check. Native Tauri packaging/signing was not requested in this checkpoint, and Windows release validation remains deferred. No persistence, navigation ownership, or Workbench/Tauri data boundary was changed. The chair PNG is now explicitly approved and integrated as the seventh manifest asset; its source draft remains immutable for future art review.
