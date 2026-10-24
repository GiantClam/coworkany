# Restore AI Elements message visual parity

Status: Approved for implementation by the user on 2026-09-30.

## Why

The earlier `preserve-assistant-turn-stream-order` change fixed event ordering, but its locally rewritten primitives and incomplete screenshot fixture did not reproduce AI Elements. Production CSS overrides disclosure layout, typography, user bubbles and Markdown. Updating `defaultOpen` also fails to update an already mounted tool disclosure.

## What changes

- Pin verified AI Elements source at `6a9d5b1822ffb10bba4bd97175f01edd7d8651cd`, retain original files and hashes, and port Message, Reasoning, Tool and Conversation with explicit import/dependency adaptations.
- Keep Workbench props, localization, host actions, pagination and scroll restoration in thin adapters. Keep the existing chronological UIMessage projection and persistence.
- Supply Tailwind semantic theme tokens and remove message-specific CSS that overrides upstream geometry, typography or disclosure behavior.
- Replace the single styled fixture with independent official and production views consuming the same deterministic event sequence. The production view loads every desktop stylesheet.
- Verify mounted transitions, keyboard operation, bottom following, manual scroll, light/dark computed styles and screenshots, then check the desktop WebView.

## Scope

Shared message primitives, message adapters, desktop styling compatibility and acceptance fixtures. Brand colors, desktop shell, avatars, timestamps and typed business actions remain allowed differences. No transport rewrite, provider changes, new dependency, unrelated composer redesign or generated release assets.

## Verification

Source hashes and deterministic port checks; existing event-order and host-action regression tests; independent browser comparisons with explicit dimensions/style assertions and lifecycle assertions; UI/client/desktop tests and typechecks, lint, bundle/provenance checks, production frontend build, desktop WebView evidence. Optional Streamdown syntax/math/diagram plugins and motion are not installed: existing Markdown support and CSS shimmer are explicit adaptations, not claims of plugin parity.
