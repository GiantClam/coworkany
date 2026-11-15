# CoworkAny desktop PoC closed loop

This directory contains the executable local Tauri PoC loop:

1. validate a semantic scenario;
2. run it through `agent-desktop` with Jev making the bounded action/observation decision (or a deterministic mock in tests);
3. capture snapshots, screenshots, trace references, a timeline, and a failure card;
4. always stop the owned dev process and remove only the run-owned data directory;
5. permit no more than two reproducible code-repair rounds;
6. require a fresh passing test result, a passed manifest, and completed cleanup before publication.

The native runner is macOS-only. It uses a unique run directory and sets the debug-only `COWORKANY_DESKTOP_POC_DATA_DIR` override, so the normal `~/Library/Application Support/CoworkAny` data root is not used. The port guard refuses to kill an occupied process unless it belongs to the current run; an unrelated listener is a hard stop.

## Commands

From the repository root:

```sh
pnpm desktop:poc:validate-scenario
pnpm desktop:poc:contract-test
pnpm desktop:poc:preflight
COWORKANY_DESKTOP_POC_HEADED=1 pnpm desktop:poc:run -- --run-id=run-example
pnpm desktop:poc:repair-gate -- --failure-card /path/to/failure-card.json --round 1
pnpm desktop:poc:repair-gate -- --failure-card /path/to/failure-card.json --manifest /path/to/manifest.json --test-result /path/to/test-result.json --round 1 --verify
```

`desktop:poc:preflight` is strict. Accessibility, Screen Recording, Automation, target-window visibility, an unused dev port, a clean review worktree, Jev CLI plus credentials, and an isolated run root are separate gates. `--allow-manual` only lets the command continue for a manually acknowledged permission gate; it never changes the report to `ready`, and it never bypasses the required Jev gate.

For native macOS input controls, run with `COWORKANY_DESKTOP_POC_HEADED=1` (or pass `--headed`). The adapter still resolves every target from the Accessibility tree; headed mode only lets agent-desktop deliver verified text input through the WebView when a semantic AX value write is not applied by React-controlled fields.

Jev is required for native and publication runs. Install the official CLI with `brew tap model-clis/packages && brew trust --formula model-clis/packages/jev && brew install jev`, then run `jev login` or provide `JEV_API_KEY` in the process environment. The runner calls `jev ask -` with a redacted Accessibility Tree and a bounded `execute`/`need_observation` choice; it never sends the typed value itself. A missing credential, API error, invalid choice, or observation budget exhaustion fails the run.

Evidence is local to the run root. Timeline observations and failure cards are redacted before writing. Do not upload evidence containing real credentials or private user data.
