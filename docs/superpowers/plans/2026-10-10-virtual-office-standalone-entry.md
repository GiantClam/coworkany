# Virtual Office Standalone Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the virtual office to its own sidebar route, enlarge the scene, and let users inspect each real role's workload in an anchored status card before entering its workspace.

**Architecture:** Keep OfficeStore as the single source of truth. Add a desktop-only office page wrapper that owns the store lifecycle, while VirtualOfficeHome owns selected-role state and renders one DOM status-card overlay. Pixi emits role selection plus a scene-relative anchor; React owns the overlay, keyboard behavior, fallback interaction, and navigation.

**Tech Stack:** React 18, TypeScript, Vite, Pixi.js, existing Workbench route manifest, Node test runner with tsx, Tauri/macOS smoke validation.

## Global Constraints

- Keep CoworkAny brand colors, rounded cards, spacing, and non-coding visual language.
- Role motion and status must come from the existing OfficeStore; do not invent a second task state.
- Keep the React fallback fully usable when Pixi, assets, or the manifest fail.
- Add no dependencies.
- Reuse OfficeRoleDefinition, OfficeRoleState, OfficeWorkItemKey, and activateOfficeWorkItem.
- Use the existing home route mode for /dashboard/office; do not widen the shared route-mode union.
- Verify macOS only; do not claim Windows validation.

Implementation and verification steps were completed in the shared working tree on 2026-10-11. The historical commit-only steps remain unchecked because this continuation leaves commit ownership with the workspace owner.

---

### Task 1: Add the independent route and page lifecycle

**Files:**
- Modify: packages/workbench-ui/src/routes.ts
- Modify: apps/desktop/src/App.tsx (routeIconKeys and render branch)
- Modify: apps/desktop/src/home/DesktopHome.tsx
- Create: apps/desktop/src/home/DesktopVirtualOffice.tsx
- Modify: apps/desktop/test/routes.test.ts
- Modify: apps/desktop/test/release-entry-regression.test.ts

**Interfaces:**
- DesktopVirtualOffice({ composition, capabilities, navigation, locale }) starts and stops the existing OfficeComposition and renders VirtualOfficeHome.
- /dashboard/office is a manifest route with mode: "home", placement: "main", and a network icon key.

- [x] **Step 1: Extend route regression fixtures before implementation**

Add the manifest assertion and release contract:

~~~
assert.ok(paths.includes("/dashboard/office"));
assert.equal(WORKBENCH_ROUTE_MANIFEST.find((route) => route.path === "/dashboard/office")?.mode, "home");
~~~

~~~
const ENTRY_CONTRACTS = {
  "/dashboard/office": { surface: "office" },
} as const;
~~~

Extend `EntryContract["surface"]` with `"office"`, set the office contract to `{ surface: "office" }`, and add this marker group:

~~~
office: ["const isVirtualOfficeRoute = selected.path === \"/dashboard/office\"", "<DesktopVirtualOffice"],
~~~

Run:

~~~
pnpm exec tsx --test apps/desktop/test/routes.test.ts apps/desktop/test/release-entry-regression.test.ts
~~~

Expected: FAIL because the route and render marker do not exist yet.

- [x] **Step 2: Add the manifest entry and icon mapping**

In WORKBENCH_ROUTE_MANIFEST, add immediately after the dashboard home route:

~~~
{ path: "/dashboard/office", label: { zh: "虚拟办公室", en: "Virtual Office" }, description: { zh: "查看角色状态、任务繁忙程度和最近成果", en: "Inspect role status, workload, and recent work" }, mode: "home", section: { zh: "工作空间", en: "Workspace" }, glyph: "⌂" },
~~~

In routeIconKeys, add:

~~~
"/dashboard/office": "network",
~~~

- [x] **Step 3: Separate home content from office lifecycle**

Change DesktopHome's props to retain only `composition`, `capabilities`, `navigation`, `locale`, `children`, and optional `showVirtualOffice`; remove the currently unused `client` and `agentDirectoryReader` props. Default `showVirtualOffice` to false; only start/stop the composition and render VirtualOfficeHome when that flag is true. Create DesktopVirtualOffice.tsx as the focused wrapper:

~~~
export function DesktopVirtualOffice({ composition, capabilities, navigation, locale }: DesktopVirtualOfficeProps) {
  return <DesktopHome composition={composition} capabilities={capabilities} navigation={navigation} locale={locale} showVirtualOffice />;
}
~~~

Keep the existing desktop-home shell class so current layout tokens continue to apply.

- [x] **Step 4: Mount the route before generic library/chat surfaces**

Import DesktopVirtualOffice and derive:

~~~
const isVirtualOfficeRoute = selected.path === "/dashboard/office";
~~~

Render <DesktopVirtualOffice ... /> in the main workspace branch before the generic recent-card/library fallback, remove the now-unused client and agentDirectoryReader props from the dashboard DesktopHome call, and leave showVirtualOffice omitted there. The office route must not render <HomeEntryGroups> or the generic recent-session panel.

- [x] **Step 5: Run the route tests**

~~~
pnpm exec tsx --test apps/desktop/test/routes.test.ts apps/desktop/test/release-entry-regression.test.ts
~~~

Expected: PASS.

- [ ] **Step 6: Commit the route boundary**

~~~
git add packages/workbench-ui/src/routes.ts apps/desktop/src/App.tsx apps/desktop/src/home/DesktopHome.tsx apps/desktop/src/home/DesktopVirtualOffice.tsx apps/desktop/test/routes.test.ts apps/desktop/test/release-entry-regression.test.ts
git commit -m "Expose virtual office as a standalone workspace"
~~~

### Task 2: Build the reusable role status card

**Files:**
- Create: apps/desktop/src/virtual-office/OfficeRoleStatusCard.tsx
- Modify: apps/desktop/src/virtual-office/RoleCard.tsx
- Modify: apps/desktop/test/virtual-office-components.test.ts
- Create: apps/desktop/test/virtual-office-role-status-card.test.ts

**Interfaces:**
- OfficeRoleStatusCardProps = { role, state, locale, onEnter, onWorkItemOpen, onClose?, unavailableReason? }.
- The card exposes one primary onEnter button and stable OfficeWorkItemKey callbacks for devices and recent items.

- [x] **Step 1: Add failing component tests**

Use renderToStaticMarkup and direct function invocation, following virtual-office-components.test.ts:

~~~
test("status card exposes localized state, workload counts, work items, and one enter action", () => {
  const html = renderToStaticMarkup(React.createElement(OfficeRoleStatusCard, { role, state, locale: "zh", onEnter, onWorkItemOpen }));
  assert.match(html, /AI 对话/);
  assert.match(html, /等待你处理/);
  assert.match(html, /进行中/);
  assert.match(html, /排队/);
  assert.match(html, /待处理/);
  assert.match(html, /失败/);
  assert.match(html, /进入工作区/);
  assert.equal((html.match(/data-office-status-card/g) ?? []).length, 1);
});
~~~

Also assert an unavailable role disables the primary button and task/recent buttons pass composite keys. Run the focused test and expect FAIL because the component is missing.

- [x] **Step 2: Extract shared status-label logic**

Export the existing statusLabel(state, locale) helper from RoleCard.tsx (rename to officeStatusLabel if needed) and import it from the new component. Do not duplicate the waiting-user wording or status map.

- [x] **Step 3: Implement the card with accessible DOM**

Implement the card as an aside or article with role="dialog", aria-label, a close button when onClose exists, four metric cells, limited device buttons, recent-work buttons, and one primary enter button:

~~~
<aside className="virtual-office-role-popover" data-office-status-card role="dialog" aria-label={label}>
  <button type="button" className="virtual-office-role-popover__close" onClick={onClose} aria-label={closeLabel}>×</button>
  {/* status, metrics, devices, recent work */}
  <button type="button" className="virtual-office-role-popover__enter" disabled={!state.available} onClick={onEnter}>{enterLabel}</button>
</aside>
~~~

Reuse state.devices, state.overflowCount, state.recentItems.slice(0, 5), and onWorkItemOpen. Keep the existing RoleCard fallback list behavior intact while allowing its open action to be redirected by the parent.

- [x] **Step 4: Run component tests and typecheck**

~~~
pnpm exec tsx --test apps/desktop/test/virtual-office-components.test.ts apps/desktop/test/virtual-office-role-status-card.test.ts
pnpm --filter @coworkany/desktop typecheck
~~~

Expected: PASS.

- [ ] **Step 5: Commit the card boundary**

~~~
git add apps/desktop/src/virtual-office/OfficeRoleStatusCard.tsx apps/desktop/src/virtual-office/RoleCard.tsx apps/desktop/test/virtual-office-components.test.ts apps/desktop/test/virtual-office-role-status-card.test.ts
git commit -m "Add accessible virtual office role status card"
~~~

### Task 3: Wire role selection, anchors, and navigation

**Files:**
- Modify: apps/desktop/src/virtual-office/types.ts
- Modify: apps/desktop/src/virtual-office/office-scene.ts
- Modify: apps/desktop/src/virtual-office/OfficeCanvasEnhancement.tsx
- Modify: apps/desktop/src/virtual-office/VirtualOfficeHome.tsx
- Modify: apps/desktop/src/virtual-office/FallbackOfficeList.tsx
- Create: apps/desktop/src/virtual-office/office-popover-position.ts
- Create: apps/desktop/test/virtual-office-popover-position.test.ts
- Modify: apps/desktop/test/virtual-office-scene.test.ts

**Interfaces:**
- OfficeRoleAnchor = { readonly x: number; readonly y: number } relative to the scene host.
- OfficeSceneCallbacks.onSelectRole(roleId, anchor) replaces onOpenRole.
- VirtualOfficeHome keeps selectedRoleId: OfficeRoleId | null and selectedAnchor: OfficeRoleAnchor | null.
- clampOfficePopover(anchor, cardSize, hostSize) returns { left, top, placement } with values clamped to the host.

- [x] **Step 1: Add pure positioning tests**

Create cases for right-side placement, left-edge fallback, right-edge flip, and narrow-window bottom placement:

~~~
assert.deepEqual(clampOfficePopover({ x: 120, y: 180 }, { width: 280, height: 220 }, { width: 900, height: 520 }).placement, "right");
assert.equal(clampOfficePopover({ x: 880, y: 180 }, { width: 280, height: 220 }, { width: 900, height: 520 }).placement, "left");
assert.equal(clampOfficePopover({ x: 40, y: 180 }, { width: 280, height: 220 }, { width: 420, height: 320 }).placement, "bottom");
~~~

Run the test and expect FAIL until the pure helper exists.

- [x] **Step 2: Implement anchor calculation and callback types**

Add OfficeRoleAnchor to types.ts. Store the current anchor on each Pixi role node, update it beside the character during render, and invoke:

~~~
callbacks.onSelectRole(roleId, { x, y: y - station.height });
~~~

Rename the callback plumbing in OfficeCanvasEnhancement and keep onActivate unchanged. The Pixi canvas remains aria-hidden; all semantic controls remain in the React overlay.

- [x] **Step 3: Add selection state to VirtualOfficeHome**

Replace direct navigation on character click with selection. Resolve the selected role/state from roles and snapshot.roles; render OfficeRoleStatusCard inside a stage wrapper. Add a document-level pointer listener that closes only when the event target is outside the stage, and a keydown listener for Escape that returns focus to the role trigger when available.

When snapshot.roles no longer contains the selected role, clear both selection values. onEnter calls navigation.go(role.homeRoute); task and recent buttons call activateOfficeWorkItem.

- [x] **Step 4: Give the React fallback the same selection path**

Change FallbackOfficeList to accept onSelect(role) rather than only onOpen, and have its role button select the card. Keep the existing list visible below the scene so keyboard and screen-reader users never depend on Pixi.

- [x] **Step 5: Run focused tests and typecheck**

~~~
pnpm exec tsx --test apps/desktop/test/virtual-office-popover-position.test.ts apps/desktop/test/virtual-office-scene.test.ts apps/desktop/test/virtual-office-components.test.ts
pnpm --filter @coworkany/desktop typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit the interaction wiring**

~~~
git add apps/desktop/src/virtual-office/types.ts apps/desktop/src/virtual-office/office-scene.ts apps/desktop/src/virtual-office/OfficeCanvasEnhancement.tsx apps/desktop/src/virtual-office/VirtualOfficeHome.tsx apps/desktop/src/virtual-office/FallbackOfficeList.tsx apps/desktop/src/virtual-office/office-popover-position.ts apps/desktop/test/virtual-office-popover-position.test.ts apps/desktop/test/virtual-office-scene.test.ts
git commit -m "Open live role status cards from the office scene"
~~~

### Task 4: Enlarge the office and style the overlay

**Files:**
- Modify: apps/desktop/src/virtual-office/virtual-office.css
- Modify: apps/desktop/src/home/DesktopHome.tsx (only if the route shell needs a page class)
- Modify: apps/desktop/test/virtual-office-contrast.test.ts
- Modify: apps/desktop/test/fixtures/virtual-office-acceptance.tsx

**Interfaces:**
- .virtual-office--standalone marks the independent page.
- .virtual-office-stage is the relative overlay host.
- .virtual-office-role-popover is the DOM status card; it must remain usable in narrow windows.

- [x] **Step 1: Add CSS regression assertions**

Extend the contrast test to require the existing darker muted fallback and add source checks for the enlarged scene and overlay rules:

~~~
assert.match(css, /\.virtual-office--standalone/);
assert.match(css, /min-height:\s*clamp\(520px/);
assert.match(css, /\.virtual-office-role-popover/);
~~~

- [x] **Step 2: Implement responsive layout**

Use existing tokens and no new palette. The core rules should include:

~~~
.virtual-office--standalone { min-height: 100%; }
.virtual-office-stage { position: relative; min-height: clamp(520px, 68vh, 680px); }
.virtual-office-stage .virtual-office-scene { min-height: inherit; }
.virtual-office-scene__canvas { height: 100%; min-height: clamp(520px, 68vh, 680px); }
.virtual-office-role-popover { position: absolute; z-index: 4; width: min(300px, calc(100% - 24px)); ... }
@media (max-width: 720px) {
  .virtual-office-stage { min-height: 560px; }
  .virtual-office-role-popover { left: 12px !important; right: 12px; top: auto !important; bottom: 12px; width: auto; }
}
~~~

Use color-mix and existing --wb-* variables, preserve the current muted fallback #5f5f58, and add visible focus styles. Do not make the fallback list the main visual surface on the standalone route.

- [x] **Step 3: Update the acceptance fixture**

Give the fixture a standalone wrapper class and add a deterministic role-selection instruction in the banner text. Keep the existing 50-item, status-toggle, bilingual, invalid-manifest, and route assertions intact.

- [x] **Step 4: Run CSS and fixture-related tests**

~~~
pnpm exec tsx --test apps/desktop/test/virtual-office-contrast.test.ts apps/desktop/test/virtual-office-components.test.ts apps/desktop/test/virtual-office-bundle.test.ts
pnpm --filter @coworkany/desktop typecheck
~~~

Expected: PASS.

- [ ] **Step 5: Commit the visual surface**

~~~
git add apps/desktop/src/virtual-office/virtual-office.css apps/desktop/src/home/DesktopHome.tsx apps/desktop/test/virtual-office-contrast.test.ts apps/desktop/test/fixtures/virtual-office-acceptance.tsx
git commit -m "Expand virtual office canvas and role popover layout"
~~~

### Task 5: End-to-end verification on macOS

**Files:**
- Modify: apps/desktop/test/routes.test.ts only if a route assertion needs final wording.
- Modify: apps/desktop/test/fixtures/virtual-office-acceptance.tsx only if a deterministic smoke selector is missing.
- Create: openspec/changes/real-state-virtual-office/evidence/macos-standalone-office-2026-10-10.md

- [x] **Step 1: Run the focused office suite**

~~~
pnpm exec tsx --test apps/desktop/test/virtual-office-*.test.ts
~~~

Expected: all virtual-office tests pass, including route, status-card, positioning, contrast, asset, bundle, store, projector, and navigation coverage.

- [x] **Step 2: Run desktop regression and typecheck**

~~~
pnpm --filter @coworkany/desktop test
pnpm --filter @coworkany/desktop typecheck
pnpm --filter @coworkany/workbench-ui typecheck
~~~

Expected: no test or TypeScript failures.

- [x] **Step 3: Build and validate static assets**

~~~
pnpm --filter @coworkany/desktop build
pnpm --filter @coworkany/desktop verify:virtual-office-assets
pnpm --filter @coworkany/desktop verify:virtual-office-bundle
~~~

Expected: Vite build succeeds, manifest/asset validation succeeds, and the Pixi boundary remains intact.

- [x] **Step 4: Run the macOS native smoke**

Open the built macOS app and record evidence for:

1. Sidebar shows “虚拟办公室” and opens /dashboard/office.
2. Home no longer contains the full office scene.
3. Office scene is visibly larger than 250px.
4. Clicking a character opens the anchored card with live counts and tasks.
5. Enter, task, and recent-work actions navigate correctly.
6. Blank-click, Escape, language toggle, narrow window, and invalid-manifest fallback remain usable.

Save screenshots and observed routes in openspec/changes/real-state-virtual-office/evidence/macos-standalone-office-2026-10-10.md, explicitly marking Windows as unverified.

- [x] **Step 5: Final diff and status check**

~~~
git diff --check
git status --short
~~~

Confirm no unrelated files were staged and no known test, type, build, or macOS smoke errors remain.

