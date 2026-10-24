# Implementation plan

1. Preserve the current data model, query/filter/pagination and run navigation behavior. Establish a reproducible rendered fixture that loads the production desktop styles and shows long model names, task titles and run IDs.
2. Set an explicit zero-minimum single dashboard grid track and zero minimum widths on its children. Make the dashboard an inline-size query container. Replace the viewport-only breakpoint with container rules and bound filter/model widths.
3. Keep the eight-column grid and its minimum readable width inside a constrained ledger scroll region. Measure overflow with ResizeObserver, show a localized hint only on overflow, allow focus and ArrowLeft/ArrowRight/Home/End/Shift+wheel navigation without capturing row button keyboard actions.
4. Replace background-as-foreground and undefined surface/ink aliases with scoped semantic theme variables. Derive the secondary color from existing foreground tokens with sufficient contrast, retaining the dark theme's direction. Bound long labels and expose full text with accessible naming/native titles.
5. Run rendered layout/contrast/interaction checks and inspect screenshots before further visual edits. Record each verdict in `.omx/state/fix-usage-dashboard-layout-contrast/ralph-progress.json`.
6. Compile the desktop release, restart the built app when it is idle, and check the actual sidebar-expanded usage page and ledger scrolling. Record evidence and mark tasks complete only after verification.

The baseline audit is `.artifacts/usage-layout-audit-20260930/report.md`. Initial changes are confined to `apps/desktop/src/usage-dashboard.tsx` and its existing `.usage-*` CSS block. Tests and fixtures are confined to the usage dashboard lane. Do not change the shell's global overflow behavior or reduce the set of data columns.
