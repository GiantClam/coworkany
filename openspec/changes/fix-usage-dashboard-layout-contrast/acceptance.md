# Usage dashboard acceptance — 2026-09-30

## Delivered behavior

The usage dashboard stays inside the main content area with either sidebar state. Cards and distribution panels adapt to the dashboard's available width. The complete eight-column ledger scrolls independently, announces overflow in the selected language, and supports horizontal wheel, Shift+wheel, ArrowLeft/ArrowRight, Home and End. Secondary text uses readable foreground colors in both themes. Long labels truncate inside their cells and retain their full DOM text and native title.

## Changed files and simplifications

- `apps/desktop/src/usage-dashboard.tsx`: a local ledger viewport, overflow hint, focus/keyboard handling, and full-value titles. Metrics queries, calculations, pagination and row destinations retain their existing implementation.
- `apps/desktop/src/styles.css`: the existing usage-only block now uses zero-minimum grid tracks, container breakpoints and scoped semantic theme tokens. Removed redundant row minimum widths and the ineffective viewport-only breakpoint. Bound the nested distribution grid as well as its outer card.
- `apps/desktop/test/usage-dashboard-acceptance.tsx` and `test/fixtures/usage-dashboard-acceptance.html`: deterministic data rendered by the actual dashboard and shell with production styles, theme tokens, language/sidebar controls and loading/empty/error/data fixtures.
- `apps/desktop/test/routes.test.ts`: two stale source-contract assertions follow the existing AI Elements adapter composition instead of assuming the components still live directly in `source.tsx`.
- This OpenSpec change and `.omx/state/fix-usage-dashboard-layout-contrast/ralph-progress.json`: approved requirements, task completion and visual evidence.

No dependency was added. No global shell overflow or theme redesign was needed. Existing worktree changes were preserved.

## Rendering evidence

Evidence lives in `.artifacts/usage-layout-acceptance-20260930/`.

- `layout-matrix-final.json`: all 24 combinations of 1080/1280/1440px, expanded/collapsed sidebar, Chinese/English and light/dark themes passed. Dashboard panels, filter controls and nested distribution cards fit their available width. The hint disappears when the ledger fits.
- At 1080px with the expanded sidebar, the ledger viewport is 695px and its content is 1140px. End reaches the exact maximum of 445px; every final status cell is fully visible (`final-ledger.json`).
- `contrast-final.json`: every sampled description, label, header, run ID, chart summary and placeholder reaches at least 4.5:1 against its actual rendered background. Minimum light contrast: **5.5806:1**. Minimum dark contrast: **9.4889:1**.
- The long model label now has a 302px visible span rather than expanding its row to 570px. Ellipsis is visible and the full name remains in `title`.
- `keyboard.json`, `shift-wheel.json` and `horizontal-wheel.json`: Home/left return to zero, right advances 120px, End reaches 445px, and both wheel modes move the ledger.
- `states.json`: Chinese and English loading, empty and error/retry panels fit the narrow expanded-sidebar layout. The data state is covered by the matrix.

![Before: clipped ledger and unreadable descriptions](../../../.artifacts/usage-layout-acceptance-20260930/baseline-1080.png)

![After: narrow layout and readable text](../../../.artifacts/usage-layout-acceptance-20260930/final-light-1080-expanded.png)

![After: final status column and large values](../../../.artifacts/usage-layout-acceptance-20260930/final-light-1080-ledger-right.png)

![After: wide dark theme](../../../.artifacts/usage-layout-acceptance-20260930/final-dark-1440-collapsed.png)

## Behavior verification

The fixture confirmed date range, source, model, provider and search filters reach `metrics.query` unchanged. Pagination appends a fourth run with `cursor: "page-2"` and removes the load-more button when there is no next cursor. Clicking a conversation run retains its message anchor; pressing Enter on a task run retains its run-ID route. Unknown provider cost remains “未提供” / “Not provided”. Retry remains available after a query error and changing back to the data fixture restores the normal page.

A clean page load and final interaction check produced no browser warnings or errors. Earlier development hot reloads emitted duplicate `createRoot` warnings from the fixture entry point; the clean-load check excludes those development-only events.

## Native delivery

The final macOS arm64 release was built with the existing staged runtime, desktop typecheck and a fresh Vite production build, then bundled as `CoworkAny.app`. The normal application was restarted from:

`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/CoworkAny.app`

The actual `tauri://localhost/dashboard/usage` page displays the local 50-run ledger with the sidebar expanded. Focusing its header and pressing End displays the complete Provider cost and Status columns; Home restores the left side. The rebuilt normal app remains running after verification.

![Native sidebar-expanded usage page](../../../.artifacts/usage-layout-acceptance-20260930/native-usage-expanded.jpeg)

![Native final status column reached with End](../../../.artifacts/usage-layout-acceptance-20260930/native-ledger-right.jpeg)

## Quality gates

Desktop typecheck, production build, macOS release bundling, repository lint, focused dashboard/fixture ESLint, shared-package boundaries and desktop bundle boundaries passed. `git diff --check` passed for the tracked styles and route-test changes.

`pnpm --filter @coworkany/desktop test:release`: **502 passed, 0 failed, 0 cancelled** in 128.52 seconds. A preceding parallel rerun hit the existing 30-second timeout in the 10,000-document indexing test; the serial run passed that test in 7.28 seconds without changing its timeout or implementation. The complete final log is `.artifacts/usage-layout-acceptance-20260930/coworkany-usage-tests-serial.log`.

`openspec validate fix-usage-dashboard-layout-contrast --strict`: **valid**. All implementation and acceptance tasks are complete. The visual verdict is **pass**, with no unresolved issue in the approved UI scope.

## Remaining limits

- Native verification covers macOS arm64. Windows/Linux and physical touchpad hardware were not exercised. Wheel interaction was exercised in the browser fixture; keyboard scrolling was exercised in the native WebView.
- A pre-existing pagination race remains: changing filters while an older load-more query is pending can merge the stale page into the new result. This UI-only change deliberately preserves that existing query behavior; it needs a separate data-flow fix.
- Vite retains its existing large-chunk warning. The build succeeds and bundle-boundary validation reports zero violations.
