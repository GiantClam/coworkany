# Jev/action-selector contract

The selector receives the latest accessibility snapshot, the current scenario step, and the stable PoC target IDs. It may return exactly one of:

```json
{ "decision": "need_observation", "reason": "..." }
```

or a validated semantic action. `need_observation` is a planning response, not a desktop command; the runner must take another snapshot before any action is attempted.

Selector rules:

- Resolve by native accessibility identity, role, accessible name/value, and the PoC IDs exposed by the app.
- Never return coordinates, `xy`, CSS/XPath selectors, shell/JavaScript/SQL, secrets, or a direct OS process command.
- Never broaden a target when the snapshot contains multiple matches. Request observation or use the explicit scoped target.
- Use `select` for the workflow status control; do not approximate it with clicks or key sequences.
- After save/restart/delete, require a new observation before resolving a stale reference.
- Respect the scenario timeout and stop conditions. A missing or ambiguous target is a failure with evidence, not permission to guess.

Jev is a required external gate for a native/release run. If the API is unavailable, credentials are missing, or the response is invalid, the run must fail with evidence; a deterministic selector may be used only by unit tests and must never produce a publishable native result.
