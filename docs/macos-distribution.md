# macOS Distribution Checklist

This repository now supports a fresh-macOS delivery path for the desktop app with these expectations:

- `sidecar` is bundled into the app resources.
- `rag-service` source files are bundled into the app resources.
- `browser-use-service` source files are bundled into the app resources as an optional component.
- Python environments for bundled services are prepared inside the app data directory on demand.
- If the machine has no usable Python interpreter, the desktop app downloads a managed standalone Python runtime for macOS before creating the service venvs.
- Skillhub CLI can be installed from inside the app through the official `--cli-only` installer.

## Required GitHub Secrets for signed/notarized macOS builds

Set these secrets in GitHub Actions before running the `package-desktop` or `release` workflow for macOS targets:

- `APPLE_SIGNING_IDENTITY`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

Notes:

- `APPLE_CERTIFICATE` should be the base64-encoded signing certificate payload accepted by Tauri bundler.
- The workflows now forward these values directly to `npm run tauri -- build`.
- If the secrets are absent, macOS builds still run, but they will not be suitable for first-run distribution on a new Mac.

## Fresh Mac runtime flow

1. Launch the app.
2. Open Settings -> Runtime Setup.
3. Prepare `RAG Service` once to create its managed Python environment.
4. Optionally prepare `Browser Smart Mode` if `browser_ai_action` is needed.
5. Install `Skillhub CLI` from the same page before using Skillhub marketplace search/install.

Managed runtime locations:

- Standalone Python runtime: `$APP_DATA_DIR/managed-python`
- Service venvs: `$APP_DATA_DIR/managed-services/<service-name>/.venv`
- Pip cache: `$APP_CACHE_DIR/pip/<service-name>`

## Limitations

- Browser smart mode requires an active OpenAI-compatible profile because `browser-use-service` is launched with `OPENAI_API_KEY` and optional `LITELLM_BASE_URL`.
