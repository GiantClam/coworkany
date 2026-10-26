# Railway Services

## Phase 1

- `ragflow`
- `ragflow-mysql`
- `ragflow-redis`
- `ragflow-minio`
- `ppt-master-worker`
- `opencode-runtime`

## Shared Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## `ppt-master-worker`

- Build context: repo root, reusing `/lib/lead-tools/*` runtime code.
- Image build clones latest `hugohe3/ppt-master` sparse subtree into `/opt/ppt-master`.
- `PPT_WORKER_INTERNAL_TOKEN`
- `PPT_WORKER_RUNTIME_PROFILE=railway-linux`
- `PPT_MASTER_REPO_DIR=/opt/ppt-master`
- `PPT_MASTER_PYTHON_BIN=/usr/bin/python3`
- `PPT_MASTER_SLIDE_TIMEOUT_MS=180000`
- `PPT_MASTER_ALLOW_EMERGENCY_FALLBACK=false`
- `PPT_MASTER_SESSION_STORE=postgres`
- `LEAD_TOOLS_PPT_PREVIEW_PROVIDER=deepseek`
- `LEAD_TOOLS_PPT_PREVIEW_MODEL=deepseek-v4-pro`
- `LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER=pptoken`
- `LEAD_TOOLS_PPT_RUNTIME_SLIDE_MODEL=gpt-6.1-sol`
- `LEAD_TOOLS_PPT_RUNTIME_FALLBACK_ENABLED=true`
- `LEAD_TOOLS_PPT_RUNTIME_FALLBACK_PROVIDER=minimax`
- `LEAD_TOOLS_PPT_RUNTIME_FALLBACK_MODEL=MiniMax-M2.7-highspeed`
- `PPT_WORKER_PREVIEW_JOB_STORE=postgres`
- `AI_MARKETING_DB_POSTGRES_URL=<shared app database url>`
- `PPT_WORKER_JOB_LEASE_MS=120000`
- `PPT_WORKER_JOB_HEARTBEAT_INTERVAL_MS=15000`
- `PPT_WORKER_JOB_RECOVERY_INTERVAL_MS=20000`
- `PPT_WORKER_JOB_RECOVERY_BATCH_SIZE=8`
- `PPT_WORKER_JOB_SHUTDOWN_GRACE_MS=10000`

Preview requests persist their full request payload in Postgres. The worker claims queued or expired jobs with a lease, renews the lease during execution, and scans for recoverable jobs on startup and on a timer. On `SIGTERM`/`SIGINT`, it stops scheduling new work, waits for the configured grace period, and releases active leases so another replica can resume them.

If Railway logs show `ppt_master_runtime_provider_headers_timeout:*` for the slide-SVG stage, keep the model constant first and switch only the provider override for this worker hop, for example:

- `LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER=stepfun`
- `LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER=minimax`

If the preview planning stage itself is unstable, set `LEAD_TOOLS_PPT_PREVIEW_PROVIDER=minimax` for the same worker deployment.

## App Runtime

- `PPT_WORKER_BASE_URL=https://<gateway-or-worker-domain>`
- `PPT_WORKER_INTERNAL_TOKEN=<same-token>`
- Optional explicit overrides:
  - `LEAD_TOOLS_PPT_EXECUTION_TRANSPORT=remote-worker`
  - `LEAD_TOOLS_PPT_PREVIEW_RUNTIME=ppt-master-agent`
  - `PPT_WORKER_PREVIEW_TIMEOUT_MS=3600000`

## `opencode-runtime`

- Runs one resident `opencode serve` process on Railway using the repository-root `Dockerfile`; this service handles Business Agents and editable PPT/`ppt-master` contexts.
- `OPENCODE_WORKER_INTERNAL_TOKEN`
- `OPENCODE_RUN_TIMEOUT_MS=3600000`
- `RAILWAY_OPENCODE_RUNTIME_URL=https://<service-domain>`
- `RAILWAY_OPENCODE_RUNTIME_TOKEN=<same-token>`
- `OPENCODE_RUNTIME_STATE_URL=https://<canonical-app-domain>/api/internal/opencode-runtime/state`
- `RUNTIME_STATE_TOKEN=<internal-state-token>`
- The application sends the selected provider's `providerId`, `modelId`,
  `baseUrl`, and `apiKey` with every authenticated runtime request. The
  Railway service uses that request-scoped configuration directly and does
  not resolve provider credentials from environment variables.
- The service exposes `GET /health`, `POST /runs`, and `POST /runs/:runId/cancel` with a bearer token.
- `POST /sessions/prepare` verifies the resident service and bundle, then returns `sessionReady=true`; it does not allocate a native session or persist conversation state.
- Each run uses the session-scoped native OpenCode session under `/data/sessions` and sends the synchronous `/message` request while consuming the resident `/global/event` SSE stream for progress. The synchronous response is the completion barrier, so a dropped idle event cannot leave a persistent Writer session locked. Transient session/workspace cleanup still happens in `finally`; for editable `ppt-master`, continuity comes from the final PPTX plus a validated lightweight `project-state.json` snapshot (maximum 128 KB) persisted in the platform conversation metadata; SVG, images, logs, caches, and other process files are never used as cross-turn state.
- Supabase remains the canonical conversation context. The app attaches the last bounded context window, immutable Skill bundle, and request-scoped provider configuration on every turn.
- Attachments are intentionally implemented with the OpenCode HTTP session API; the interactive `opencode attach <url>` terminal command is not suitable for the backend SSE path.
- Session workspaces are temporary under `/data/sessions`; a Railway volume is optional for runtime scratch space and is not the source of truth for editable PPT continuity. The next PPT turn rebuilds `./workspace/ppt-master` from the conversation snapshot.
- The app selects this service for `executive-ppt`/`ppt-master` when `AI_ENTRY_PPT_RAILWAY_ENABLED=true`, and for every `business-*` Agent when `AI_ENTRY_BUSINESS_AGENT_RAILWAY_ENABLED=true`. The speaker-style `executive-presentation-ppt` path uses the pinned `dashi-ppt-skill` in the Cloudflare Sandbox session runner. Plain AI Chat stays on the direct AI SDK/Provider path.

### Business Agent runtime

- Set `AI_ENTRY_BUSINESS_AGENT_RAILWAY_ENABLED=true` and provide `RAILWAY_OPENCODE_RUNTIME_URL` plus `RAILWAY_OPENCODE_RUNTIME_TOKEN` in the app deployment.
- Set `AI_ENTRY_SHARED_AGENT_RUNTIME_ENABLED=true` and `AI_ENTRY_SHARED_AGENT_SCOPE=business-prefix` to include every `business-*` Agent in the shared-session policy.
- Set `AI_ENTRY_OPENCODE_SESSION_ENABLED=true` and keep `AI_ENTRY_OPENCODE_ASYNC_ENABLED=false` for the interactive SSE path.
- Business Agent requests use the single signed `deepseek/deepseek-v4-pro` provider configuration; runtime failures surface to the user and never fail over to another Provider or execution stack.

## Rollout Order

1. Deploy `ragflow` stack into Railway.
2. Deploy `ppt-master-worker` with font baseline and health checks.
3. Verify `/health` and `/fonts/check`.
4. Enable `remote-worker` mode only in non-production first.
5. Run PPT canary validation before production promotion.
