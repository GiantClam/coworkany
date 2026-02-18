# UI Upgrade Regression Checklist

Use this checklist before enabling `newShellEnabled` for all users.

## 1) Command Bus

- [ ] `Ctrl/Cmd+K` opens command palette
- [ ] Running `new-task` command switches to launcher
- [ ] Running `task-list` command opens dashboard
- [ ] Running `quick-chat` command opens quick chat window
- [ ] Running `settings` command opens settings modal
- [ ] Running `shortcuts` command opens shortcuts overlay
- [ ] Running `toggle-shell` command persists and reflects current shell mode

## 2) Tray Interactions

- [ ] Tray `Open Main Window` opens/focuses main window
- [ ] Tray `Quick Chat` opens/focuses quickchat window
- [ ] Tray `New Task` triggers `new-task` command flow
- [ ] Tray `Task List` triggers `task-list` command flow
- [ ] Tray `Settings` triggers `settings` command flow
- [ ] Tray `Shortcut Help` triggers `shortcuts` command flow

## 3) Keyboard and Overlay UX

- [ ] Shortcuts overlay traps focus while open
- [ ] `Esc` closes shortcuts overlay
- [ ] Focus returns to previous element after closing overlay
- [ ] Sidebar expands with mouse hover and keyboard focus-within
- [ ] Command palette supports arrow navigation + enter execution

## 4) Feature Flag Compatibility

- [ ] `newShellEnabled=true` shows unified shell modals and overlay behavior
- [ ] `newShellEnabled=false` falls back without runtime errors
- [ ] Toggling shell in Settings persists across app restart
- [ ] Legacy stored preference shape auto-migrates to `{ version, featureFlags }`

## 5) Build/Runtime Sanity

- [ ] `npm run build` succeeds
- [ ] `cargo check` succeeds
- [ ] No new console errors in main window during command/tray flows
- [ ] No modal duplication when opening Skills/MCP/Settings from Chat and Command Palette
