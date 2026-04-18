# Claw Agent Server (Coworkany)

This adapter exposes Coworkany as a Claw Agent Protocol HTTP service:

- `POST /v1/task`
- `GET /v1/health`

It is required when running Claw-Bench via `--agent-url`.

## Start

```bash
cd /Users/beihuang/Documents/github/coworkany/sidecar
npm run serve:claw-agent
```

Default address:

- `http://127.0.0.1:3000`

## Configure for Composite External Profile

```bash
export COWORKANY_AGENT_URL="http://127.0.0.1:3000"
export COWORKANY_AGENT_NAME="coworkany-sidecar"
export CLAW_BENCH_REPO_DIR="/Users/beihuang/Documents/github/coworkany/tmp/claw-bench"
```

Then run:

```bash
cd /Users/beihuang/Documents/github/coworkany/sidecar
node scripts/run-composite-benchmarks.mjs --profile external --include-external
```

## Optional Runtime Flags

- `COWORKANY_AGENT_PORT` (default `3000`)
- `COWORKANY_AGENT_HOST` (default `127.0.0.1`)
- `COWORKANY_AGENT_NAME` (default `coworkany-sidecar`)
- `COWORKANY_AGENT_MAX_CONCURRENCY` (default `1`)
- `COWORKANY_CLAW_MAX_STEPS` (default `16`)
- `COWORKANY_AGENT_DEFAULT_TIMEOUT_SECONDS` (default `300`)
- `COWORKANY_AGENT_REQUEST_BODY_LIMIT` (default `1mb`)

CLI args override envs:

```bash
bun scripts/external/claw-agent-server.ts --host 127.0.0.1 --port 3000 --max-steps 24
```
