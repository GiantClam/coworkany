# Contributing to CoworkAny

Thanks for contributing to CoworkAny.

This repository is not a single-package monorepo. It is a desktop product composed of several sibling projects:

- `desktop/`: Tauri + React desktop app
- `sidecar/`: Bun + TypeScript agent runtime
- `rag-service/`: Python FastAPI RAG service
- `browser-use-service/`: Python FastAPI browser automation service

Please read this file before opening a pull request.

## Development Setup

### Prerequisites

- `Node.js >= 22.22.1 < 23`
- `Bun >= 1.2.0`
- `Rust` with Tauri prerequisites
- `Python 3.x`

### Install dependencies

```bash
cd desktop
npm install

cd ../sidecar
bun install
```

### Configure model access

Create `sidecar/llm-config.json` before running the app:

```json
{
  "provider": "anthropic",
  "anthropic": {
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-5"
  }
}
```

### Run locally

```bash
cd desktop
npm run tauri dev
```

Optional standalone service runs:

```bash
cd sidecar
bun run src/main.ts
```

```bash
cd rag-service
python main.py
```

```bash
cd browser-use-service
python main.py
```

## Repository Conventions

### Workspace awareness

CoworkAny is built around the idea of explicit workspace context. When making changes:

- keep changes scoped to the relevant subproject
- avoid broad refactors across `desktop` and `sidecar` unless the change truly spans both
- document any cross-layer dependency in the pull request

### Safety and approvals

CoworkAny is designed around governed execution. Changes that affect:

- tool execution
- approvals
- filesystem writes
- shell execution
- browser automation
- memory persistence

should explain the behavioral impact clearly in the PR.

### Documentation expectations

If you change user-facing behavior, also update the relevant docs:

- `README.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/USER_GUIDE_CN.md`

## Before Opening a Pull Request

Run the smallest relevant validation for your change.

### Desktop

```bash
cd desktop
npm run build
npm run test:ci
```

### Sidecar

```bash
cd sidecar
npm run typecheck
npm run test:ci
```

If your change affects browser automation, runtime recovery, packaging, or desktop integration, run additional targeted tests when possible.

## Pull Request Guidelines

Please keep pull requests focused and easy to review.

Good PRs usually include:

- a short problem statement
- what changed
- why the approach was chosen
- how it was verified
- screenshots if UI changed
- risk notes if execution, approvals, or persistence changed

### Suggested PR title style

- `desktop: fix interrupted task hydration`
- `sidecar: tighten host-folder execution guard`
- `docs: refresh technical design and user guide`

## Issue Reports

When reporting a bug, include as much of the following as possible:

- operating system
- whether you ran the desktop app or standalone services
- exact steps to reproduce
- expected behavior
- actual behavior
- relevant logs or screenshots

## Communication

By participating in this project, you agree to follow the guidelines in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

For security-sensitive issues, do not open a public issue. Follow [SECURITY.md](SECURITY.md) instead.
