# macOS manual acceptance matrix

Date: 2026-10-10

## Environment

- macOS 26.6.2 (`25G83`)
- Apple Silicon `arm64`
- Working source: `f17ec3ed0ac145250b95fee740598ef01d6577b2`
- Native target: Tauri dev `target/debug/coworkany`
- Browser fixture: `http://127.0.0.1:1420/test/fixtures/virtual-office-acceptance.html`

## Results

| ID | Result | Evidence |
| --- | --- | --- |
| M1 empty office | PASS | Native home no longer embeds the office. The independent `/dashboard/office` entry renders all 7 route-backed roles with zero counts; unavailable media roles remain visible and disabled. Standalone evidence: `macos-standalone-office-2026-10-10.md`. |
| M2 concurrent work | PASS (fixture) | Fixture seeded 50 items, 7 roles, 21 device slots; running state rendered 21 devices and `+N` overflow. |
| M3 workflow navigation | PASS | Native `进入 工作流` reached `tauri://localhost/dashboard/workflows`. Screenshot: `.artifacts/native-m3-workflow-route.png` |
| M4 waiting for user | PARTIAL | Fixture contains waiting devices, but no real permission request was issued. |
| M5 completion | PASS (fixture) | Running → completed retained 21 terminal devices; after 8.1s terminal devices were 0 and recent items were 50. |
| M6 restart recovery | NOT RUN | No restart was performed during this acceptance run. |
| M7 failure | PASS (fixture) | Running → failed rendered 21 failed devices; after 8.1s recent items were 50. |
| M8 source partial failure/recovery | NOT RUN | No live source failure was injected into the native app. |
| M9 asset failure | PASS (fixture) | Invalid manifest removed canvas, preserved 7 React role cards and enabled entry buttons; restoring manifest mounted one canvas with no browser errors. Screenshot: `.artifacts/virtual-office-acceptance-mac-browser.png` |
| M10 background/restore | NOT RUN | Native window background ticker was not sampled with a frame trace. |
| M11 reduced motion | NOT RUN | OS reduced-motion preference was not changed during this run. Deterministic frame-policy tests pass. |
| M12 bilingual | PASS | Native toggle switched office roles, statuses, sidebar, and workspace copy from Chinese to English and back. |
| M13 Agent directory health | NOT RUN | Covered by read-only source/unit tests; no runtime directory fault was injected in native UI. |
| M14 media Provider health | NOT RUN | Covered by capability/unit tests and explicit unknown/offline mapping; no native Provider fault was injected. |

## Renderer note

The production renderer gate defaults to React. Native M1 therefore validates the complete React office surface, independent sidebar entry, status-card focus, and Escape close behavior. The browser fixture mounted the Pixi canvas with `VITE` development behavior and exercised manifest failure/recovery. A native foreground 60-second frame trace remains open; this run does not claim that evidence.

## Artifacts

- Native M1 screenshot: `.artifacts/native-m1-empty-office.png`
- Native M3 screenshot: `.artifacts/native-m3-workflow-route.png`
- Browser fixture screenshot: `.artifacts/virtual-office-acceptance-mac-browser.png`
