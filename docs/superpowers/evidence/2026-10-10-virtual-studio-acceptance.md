# Virtual Studio Acceptance Evidence

**Date:** 2026-10-11 (Asia/Shanghai)
**Scope:** approved warm 2.5D virtual studio redesign, runtime layer split, normalized rig adapter, and approved asset pipeline.

## Runtime evidence

- The local `/dashboard/office` route rendered the approved 3+4 island composition with seven back-facing chibi roles, independent desks, dual displays, role labels, and the React status-card surface.
- A fresh browser tab loaded the scene without console errors after the optional rig manifest was mapped to the safe `idle` clip for offline roles.
- Clicking a role in the scene opened its status card; the full React cards remained visible as the accessible fallback.
- Reduced-motion and hidden-window behavior remain owned by the existing frame policy; the character layer exposes static poses and disables status effects when reduced motion is active.

## Automated checks

| Check | Result |
| --- | --- |
| `cd apps/desktop && pnpm exec tsx --test test/virtual-office-*.test.ts` | 97 passed, 0 failed |
| `pnpm --dir apps/desktop run typecheck` | passed |
| `pnpm --dir apps/desktop exec vite build` | passed; a versioned `office-scene-*.js` dynamic scene chunk was emitted |
| `pnpm --dir apps/desktop run verify:virtual-office-assets` | passed; gzip total 1,332,349 bytes (under 2,500,000-byte budget) |
| `pnpm --dir apps/desktop run verify:virtual-office-bundle` | passed; static closure clean, dynamic Pixi scene present |
| `git diff --check` on owned files | passed |

## Production asset paths

- `apps/desktop/public/virtual-office/v1/office.webp`
- `apps/desktop/public/virtual-office/v1/characters.webp`
- `apps/desktop/public/virtual-office/v1/workstations.webp`
- `apps/desktop/public/virtual-office/v1/workstations-front.webp`
- `apps/desktop/public/virtual-office/v1/displays.webp`
- `apps/desktop/public/virtual-office/v1/rig-animation-data.json`
- `apps/desktop/public/virtual-office/v1/manifest.json`

The seven approved 8-view turnaround sheets, rig preview, and composite preview remain immutable design references under `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/`; only normalized runtime derivatives enter the public bundle.

## Remaining limits

This evidence covers the local Vite/macOS-targeted renderer path. Native macOS packaging was not rerun in this checkpoint, and Windows release validation remains deferred. No persistence, navigation ownership, or Workbench/Tauri data boundary was changed.
