# Production Replay Import Sources

Drop saved `TaskEvent` JSONL logs under rollout-labeled folders here:

- `canary/`
- `beta/`
- `ga/`

Then run:

```bash
bun run eval:control-plane:sync-replays
```

That command will:

- import all discovered replay logs into `production-replay.jsonl`
- infer `productionReplaySource` from the folder names above when not explicitly overridden
- write an aggregate summary report to `import-reports/latest.json`
