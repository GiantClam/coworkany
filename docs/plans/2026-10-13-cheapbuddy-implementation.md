# CheapBuddy desktop implementation plan

**Updated:** 2026-10-13. Code implementation is complete in Coworkany and the local CheapBuddy checkout. No deployment or new native release installer was produced. Functional checks passed; the final static bundle network gate remains blocked by six preexisting dependency findings. See the [Chinese delivery report](../../.artifacts/cheapbuddy-implementation-20261013/README.md) and [verification results](../../.artifacts/cheapbuddy-implementation-20261013/verification-results.json).

**Goal:** Implement the approved CheapBuddy default Provider, account login and automatic configuration, and live recharge/member display in Coworkany.

**Architecture:** Existing user APIs remain on cheapbuddy.cc; model requests use the Relay. The desktop Host owns sessions and resolves API keys from the operating-system credential store. React receives only account metadata, product data and credential references. Purchases open the fixed website URL.

**Tech stack:** Existing React/Tauri/Node Host, shared Provider/media runtimes, Node test runner and OS credential tools.

## Constraints and verified decisions

- Follow the two 2026-10-03 remediation documents; no manifest or new public endpoint.
- Preserve existing user defaults and unrelated workspace edits.
- Never persist new account secrets in config, diagnostics or OpenCode files; inject credentials only when executing requests.
- Do not hardcode prices or group IDs. If default creation yields an unusable key, a unique permitted OpenAI group may be used as a compatibility fallback; ambiguous groups require a clear error. Clean up failed temporary keys.
- A missing recharge catalog is distinct from an empty membership catalog. Show the website purchase entry and a synchronization message when the field is absent.
- Login adds one profile shared by text/image/video; each capability keeps its own model choice.
- Do not execute real payments. Live smoke requests use the already-authorized test credentials, held only in memory.

## Task 1: Provider and model behavior

Files: shared provider catalog/runtime, desktop provider-config/platform/model-discovery, runtime config, Rust config; focused tests in desktop/provider and shared runtime suites.

- [x] Add built-in CHEAPBUDDY constants and brand to text/image/video menus.
- [x] Add credentialRef and capabilityModels to normalization/import/config reads.
- [x] Set new-install defaults consistently; preserve explicit old defaults.
- [x] Classify the actual text_generation/text_to_image/text_to_video metadata; keep user selections on refresh.
- [x] Make runtime config accept CheapBuddy OpenAI text and Relay media protocols.

Interface: createCheapBuddyProvider() produces an unconfigured profile; capabilityModels is Partial<Record<ProviderCapability,{model?:string;models:readonly string[]}>>; secrets are resolved by the Host before shared adapters receive config.

Verification: provider discovery excludes media from text; image changes preserve text/video choices; normalization retains references; new defaults are CheapBuddy while existing configs are unchanged.

## Task 2: Account and secure credentials

Files: runtime/cheapbuddy-account.ts, runtime/credential-store.ts and dedicated tests. Shared response types are in src/cheapbuddy-contract.ts.

- [x] Implement login, refresh, logout, paginated managed-Key recovery, default creation and the permission-scoped fallback.
- [x] Read account/member/checkout-info and map recharge_options separately from plans; retain a valid cached view on network failure.
- [x] Store session/key record in OS credentials, with session-only fallback clearly reported.
- [x] Guard account switching and stale requests; never replay model/tool execution during refresh.

Implementation uses Host `runtime/credential-store.ts` with macOS security/Keychain, Windows PowerShell CurrentUser DPAPI, and Linux secret-tool; the earlier proposed Rust credential_store.rs was not added. Real macOS synthetic write/read/delete passed. Windows/Linux remain mocked, and the live account smoke deliberately used session-only storage; real-account restart restoration is not proven.

Interface: CheapBuddyAccountService.handle(action,payload) returns CheapBuddyAccountState; status performs local restore, refresh performs bounded user/model reads, login configures a managed Key, logout clears the current session. resolveApiKey(credentialRef) is Host-only. Dependency injection supports fake fetch and a test-only in-memory store.

Verification: missing catalogs, expired-session refresh, pagination, group-less-key failure/control, ambiguous groups, retry without duplicate keys, cleanup, credential write failures and secret-free response/config.

## Task 3: Account UI

Files: src/cheapbuddy-account.tsx, src/cheapbuddy-account.css and React rendering/interaction checks.

- [x] Show login, verification, connected/expired/failed status, account balance and refresh/logout controls.
- [x] Render recharge/member products with returned currencies/prices; separate missing data and empty results.
- [x] Open the built-in purchase URL and refresh only actual server state on return.

Interface: component receives locale, state, busy, error and onAction(action,payload), onPurchase callbacks. Passwords clear after submission; no token/Key is rendered.

Known warning codes use localized copy; unknown warning text is not rendered. Session-only storage copy is shown for the actual connected/verification state rather than initial signed-out state. Both browser checks cover these cases; final results are in browser-acceptance.log.

## Task 4: Host, native bridge and desktop wiring

Files: runtime/host.ts, src/App.tsx, src-tauri/src/lib.rs, network boundary checks and integration tests.

- [x] Add narrow account IPC methods, make profile persistence part of successful login, and sanitize diagnostics.
- [x] Resolve credential references at model discovery/text/media/workflow execution; do not pass references as keys.
- [x] Add zero-argument native `open_cheapbuddy_purchase`, fixed to https://cheapbuddy.cc/#pricing, and an account section in settings.
- [x] Preserve account isolation and old Provider choices during login/logout and asynchronous config writes.

Full-App acceptance confirms a failed native config write does not report connected, clears the password, shows an error, and allows a successful retry. It also verifies image-only model choices, disabled managed fields, reference-based discovery, a single purchase-return refresh, and retained other defaults on logout.

Verification: Host RPC round trip using fake service data; generated config contains no real secrets; text/media requests resolve the same key; native purchase command has a fixed destination and accepts no URL argument.

## Task 5: Verify and record delivery

- [x] Run desktop full suite (674 pass, 0 fail/skip), Rust native suite (81 pass), both browser checks (2 pass), desktop typecheck, related lint and Host/UI builds.
- [x] Run shared/built-bundle boundaries and built Host offline regression (1 pass, 0 skip).
- [x] Run final static network scan and record its actual failure: 6 findings, exit 1. This means the check was executed, not that the release gate passed.
- [x] Run safe live login/model smoke and verify temporary Key cleanup; record unresolved server/data limitations accurately.
- [x] Inspect rendered settings/login/products and update both remediation documents with implemented versus unverified scope.
- [ ] Resolve the static network release gate without broadening the external allowlist.
- [ ] Deploy the CheapBuddy website/Worker changes and validate live recharge_options.
- [ ] Accept real media/reference-video protocols, real payment, Windows/Linux credential storage, and real-account restart recovery.
- [ ] Produce and validate a native release installer after the remaining release gates pass.

Required commands: pnpm desktop:typecheck; pnpm desktop:test; pnpm desktop:tauri:check; cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml; pnpm check:shared-boundaries; pnpm test:desktop-network-boundary; pnpm test:desktop-bundle-boundaries; pnpm test:desktop:offline-egress.

No commit, deployment or real payment is part of this implementation request.

## CheapBuddy local implementation and live evidence

Local checkout: `/Users/beihuang/Documents/github/cheapbuddy-coworkany-integration`, based on `a771494542d0c9a1adc6a1e9d93f202971353775`. Existing Worker account routes add canonical CNY recharge_options from the same src/pricing.js used by the website; native membership plans and authentication/errors remain intact. Omitted key groups resolve only against caller-authorized active OpenAI groups; explicit groups are unchanged. Website no longer invents group 1 and handles #account. The suite passed 60 tests; website build, Worker bundle and mocked website browser checks passed. These changes are not deployed.

The 2026-10-13 live account chain now creates a usable key without group_id and reads 12 text / 1 image / 1 video models. glm-5.3 replies OK. Account-state refresh reused the managed key, the temporary key was deleted, and logout removed the local record/reference. This run did not call POST /auth/refresh for token rotation; that live endpoint evidence belongs to the 2026-10-04 report. Live recharge_options is still absent and products are empty. No real image/video generation, reference-video request or payment was performed.

The failed static network gate finds one existing Pixi console documentation URL and five existing @silurus/ooxml optional Google Fonts request-code occurrences. useGoogleFonts normalizes to false when omitted, but static scanning cannot prove runtime requests are absent; the release gate remains unresolved. No broader allowlist was introduced to hide it.
