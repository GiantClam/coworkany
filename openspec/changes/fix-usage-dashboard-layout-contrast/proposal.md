# Fix usage dashboard layout and text contrast

Status: Approved for implementation by the user on 2026-09-30, following the inspected solution and acceptance criteria.

## Why

With the desktop sidebar expanded, the run ledger's minimum width enlarges the dashboard grid and the shell clips the right side. Horizontal scrolling cannot reach the missing data. Secondary text incorrectly uses the muted background token, making descriptions, labels, table headers and run IDs almost invisible.

## What changes

- Constrain the dashboard grid and panels to the main content width, keeping horizontal overflow inside the run ledger.
- Adapt cards and filters to their container width when the sidebar changes.
- Provide a focusable ledger scroll region, overflow feedback and keyboard scrolling; retain all eight columns and existing navigation.
- Use theme foreground/surface tokens with readable secondary text and bounded long values.
- Verify the rendered page with production styles, deterministic data and the native desktop app.

## Scope

Only usage dashboard rendering, scoped CSS, focused regression checks and this change's evidence. Preserve metrics calculations, queries, pagination, routes, provider configuration and unrelated worktree changes. No dependencies or global theme redesign.

## Verification

At 1080, 1280 and 1440px, expanded and collapsed sidebar states must show all overview/filter/chart/distribution panels without page overflow. The ledger alone may scroll horizontally and must reach its final status column. Test Chinese/English, long labels and values, loading/empty/error/data states, keyboard interaction and secondary text contrast of at least 4.5:1. Run typecheck, relevant tests, lint, production build, OpenSpec validation and native WebView verification.
