# CoworkAny

An enterprise AI workspace for AI chat, agent conversations, writing, image generation, presentations, workflows, and local execution.

[中文 README](README.md) · [0.1.1 Release Notes](RELEASE_NOTES_0.1.1.md)

## Capabilities

- AI and agent conversations with entry-scoped sessions, streaming replies, tool calls, and collapsible execution details.
- Writing and cross-platform collaboration with Markdown rendering, article previews, copy actions, and artifact display.
- Presentation and media tasks executed through configured providers, with generated artifacts attached to messages.
- Persistent workflows with node configuration, run status, error details, and task results.
- A Tauri-based Windows desktop application with a local runtime and portable mode.

## Quick start

### Web development

```bash
pnpm install
pnpm dev
```

The default development URL is `http://localhost:3000`.

### Desktop development

```bash
pnpm install
pnpm tauri:dev
```

The desktop development shell uses the local Tauri host and shares the workbench UI, provider runtime, and skill runtime.

## Build the Windows portable release

The project version is `0.1.1`. Build the desktop application and create the portable ZIP with:

```bash
pnpm tauri:build
pnpm --filter @coworkany/desktop package:portable-zip
```

The output is written to:

```text
.artifacts/desktop-release/CoworkAny-Windows-x64-portable.zip
```

The green build does not require an installation wizard. The portable package stores Runtime data in the `data` directory next to the executable, so the package can be copied to another Windows device.

### Install and run CoworkAny on Windows

The Windows green release does not use an installation wizard. For the first run:

1. Download one desktop ZIP from the [CoworkAny v0.1.1 Release](https://github.com/GiantClam/coworkany/releases/tag/v0.1.1), and download `CoworkAny-Runtime-x64.zip` from the [CoworkAny v0.1.0 Release](https://github.com/GiantClam/coworkany/releases/tag/v0.1.0).
2. Extract the desktop ZIP into a writable directory. Keep the `_up_`, `runtime`, and `data` layout unchanged.
3. Place `CoworkAny-Runtime-x64.zip` unchanged beside `CoworkAny.exe`; do not extract or rename it.
4. Double-click `CoworkAny.exe`. The app validates the Runtime manifest, installs the Runtime, and then opens the workbench.

The normal package installs Runtime data under `%LOCALAPPDATA%\CoworkAny`. The portable package (identified by `portable.flag`) installs it under the `data\` directory beside the executable. The complete portable directory can be copied to another Windows x64 device.

If the Runtime ZIP is not beside the executable, open `Settings → Runtime & diagnostics`, enter its absolute path, and select `Import offline runtime`. Runtime is an independent asset and is not republished with every desktop release; download a new Runtime package only when its contents or manifest changes.

WebView2 may be required on first launch. The app does not replace itself automatically; close CoworkAny and back up the portable `data\` directory before upgrading.

## Release verification

```bash
pnpm desktop:release:regression
pnpm desktop:verify-bundle
pnpm desktop:verify-network-boundary
pnpm desktop:verify-packages
pnpm desktop:verify-portable-copy
pnpm desktop:verify-path-matrix
pnpm desktop:release-audit
```

For workbench UI-only verification:

```bash
pnpm --filter @coworkany/workbench-ui exec tsx --test test/workbench-message-surface.test.tsx
pnpm --filter @coworkany/workbench-ui typecheck
```

## Provider configuration

Configure providers, models, and API keys through application configuration or environment variables. Never commit real API keys to the repository, README files, tests, or release archives.

## Repository layout

| Path | Description |
| --- | --- |
| `app/`, `components/`, `lib/` | Web application and server logic |
| `apps/desktop/` | Tauri desktop application and local runtime |
| `packages/workbench-ui/` | UI shared by the web and desktop workbenches |
| `content/skills/` | Skills used by agents and feature entries |
| `scripts/` | Build, packaging, and release verification scripts |

## License

This repository does not currently declare a public license. Confirm the project owner's authorization before using, distributing, or modifying it.
