# OpenCode + DashiAI PPT Cloudflare smoke container

This disposable canary packages OpenCode, DashiAI PPT Skill v0.4.5
(`ff3a7330e4967147a40310669703b911fb1f708a`), Chromium,
and its npm dependencies in a Cloudflare `standard-4` container. It has no
arbitrary command endpoint: the authenticated smoke route renders a fixed
five-slide deck and exports a real editable `.pptx`.

The authenticated `benchmark-10` route runs the complete Dashi pipeline for a
ten-slide research deck and then asks OpenCode to perform the Dashi QA checks.
The caller must provide a complete `pptoken` model configuration (`modelId`,
`baseUrl`, and `apiKey`). The key is used only for that sandbox command.
OpenCode receives it through an `options.apiKey` environment reference; shell
and Worker cleanup both remove it before the request finishes.

## Deploy and verify

```bash
npm install
npx wrangler secret put SMOKE_TOKEN
npx wrangler deploy

curl -X POST -H "Authorization: Bearer $SMOKE_TOKEN" \
  https://aimarketing-dashi-ppt-smoke.<account>.workers.dev/smoke
curl -H "Authorization: Bearer $SMOKE_TOKEN" \
  -o dashi-cloudflare-smoke.pptx \
  https://aimarketing-dashi-ppt-smoke.<account>.workers.dev/smoke.pptx

curl -X POST -H "Authorization: Bearer $SMOKE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"opencode":{"modelId":"gpt-6.1-sol","baseUrl":"https://cn.pptoken.cc/v1","apiKey":"<server-issued-key>"}}' \
  https://aimarketing-dashi-ppt-smoke.<account>.workers.dev/benchmark-10
curl -H "Authorization: Bearer $SMOKE_TOKEN" \
  -o enterprise-ai-customer-service-evidence-10-pages.pptx \
  https://aimarketing-dashi-ppt-smoke.<account>.workers.dev/benchmark-10.pptx
```

The image pins the Dashi upstream commit and runs `npm ci` during image build,
so the smoke route does not install packages from the network.

## Licensing

DashiAI PPT Skill is AGPL-3.0. Its bundled editable-PPTX exporter is licensed
only as a component of that skill. Keep the full skill source available when
operating this network service and do not extract or redistribute that exporter
on its own.
