# Coworkany public website

This is the independently built marketing site for **https://coworkany.com**. Both the apex domain and **https://www.coworkany.com** are Cloudflare Custom Domains for the same Worker. The apex domain remains canonical. The site reuses the approved homepage components and brand assets, without building or deploying the main application's login, registration, dashboard, database code, API routes, or desktop runtime.

## Architecture

Next.js statically exports `/en` and `/zh`. Cloudflare Workers Static Assets serves the HTML, JavaScript, CSS, images, sitemap, and robots file. The small Worker only selects a language for `/` and `/index.html`. There are no database, AI, storage, or application service bindings.

The build also produces a deterministic 1200×630 social card at `/og-image.png` from the approved Coworkany logo and icon. Localized pages expose it through Open Graph and `summary_large_image` X metadata; the artwork is not AI-redrawn.

Language precedence at the root:

1. Exact `coworkany_site_locale=en|zh` cookie set by the manual language link (one year, host-only).
2. Supported browser languages in `Accept-Language`, ranked by `q` and then browser order. Chinese variants select Chinese; English variants select English.
3. English for absent, malformed, or unsupported preferences.

Explicit `/en` and `/zh` links always retain their language. Root redirects preserve query parameters and use `Cache-Control: private, no-store` so preferences are not cached across visitors. Localized pages remain publicly cacheable. Manual links still navigate when JavaScript is unavailable; persisting the choice requires JavaScript and cookies.

## Commands

Use the repository's existing dependencies (`pnpm install --frozen-lockfile` at the root), Node.js 22+, and an authenticated Wrangler v4 CLI. No extra runtime dependencies are introduced by this app.

```sh
pnpm website:build
pnpm website:test
pnpm --filter @coworkany/website lint
pnpm --filter @coworkany/website typecheck
pnpm website:preview
# In another terminal, against local Cloudflare emulation:
pnpm --filter @coworkany/website test:smoke

# Deploy this site only, including its coworkany.com custom domain:
pnpm website:deploy
# Verify the published site:
WEBSITE_TEST_URL=https://coworkany.com pnpm --filter @coworkany/website test:smoke
```

The build verifies an allowlist of public output files and the language metadata/CTA destinations before upload. Wrangler's only assets directory is `apps/website/out`; never point it at the repository root or the root application's build output.

## Configuration

- `WEBSITE_ORIGIN`: canonical URL, default `https://coworkany.com`.
- `WEBSITE_START_URL`: external “Get started” destination, default `https://www.aimarketingsite.com/register` (existing online application).
- `wrangler.jsonc`: isolated `coworkany-website` Worker and custom domain.

Set build variables before `pnpm website:build` or `pnpm website:deploy`; they are baked into static HTML. An optional CI deployment should use a narrowly scoped Cloudflare token through environment variables, never in tracked files.

Homepage copy and styling remain shared under `components/seo/coworkany-home*`. The root application retains its own locale provider and CTA analytics through `public-home-page.tsx`; the standalone site imports neither provider nor application analytics.
