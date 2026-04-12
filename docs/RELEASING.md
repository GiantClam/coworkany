# Releasing CoworkAny

This document summarizes the repository's current release flow.

## Release Inputs

The repository already contains GitHub Actions workflows for:

- CI: `.github/workflows/ci.yml`
- release builds: `.github/workflows/release.yml`
- manual packaging: `.github/workflows/package-desktop.yml`

## Before You Cut a Release

Confirm the following:

- README and user-facing docs are up to date
- release notes are prepared or the changelog has been updated
- desktop and sidecar dependency installs succeed
- CI is green on the target branch
- any signing / notarization secrets required for macOS are available

Recommended validation:

```bash
npm run test:codex -- --mode pr --subset sidecar
npm run test:codex -- --mode pr --subset desktop
npm run test:codex -- --mode pr --subset desktop-e2e
```

```bash
npm run test:codex -- --mode release
```

## Release Paths

### 1. Tag-based release

Push a tag matching `v*`.

Example:

```bash
git tag v0.1.0
git push origin v0.1.0
```

This triggers `.github/workflows/release.yml`.

### 2. Manual workflow dispatch

Use the GitHub Actions UI to run the `Release` workflow with:

- `tag_name`
- `prerelease`
- `draft`

This is useful for dry runs, staged releases, and prereleases.

### 3. Manual packaging only

Use `Package Desktop` when you only need build artifacts without publishing a GitHub release.

## What the Release Workflow Does

At a high level, the workflow:

1. checks out the repository
2. installs Node.js and Bun
3. installs desktop and sidecar dependencies
4. runs the sidecar release readiness gate
5. builds desktop bundles for Linux, Windows, and macOS
6. optionally signs / notarizes macOS builds if secrets are configured
7. uploads artifacts
8. publishes the GitHub release assets

## Platform Notes

### macOS

If macOS signing secrets are configured, the workflow imports certificates and runs the notarization script from `desktop/scripts/macos-sign-and-notarize.sh`.

### Linux

Ubuntu packaging requires GTK / WebKit system dependencies, which are installed in CI.

### Windows

Windows packaging is handled through the Tauri build target configured in the workflow matrix.

## Post-Release Checklist

After a release:

- verify all artifacts were attached to the GitHub release
- verify the release notes are readable
- smoke test at least one packaged build
- confirm any version badges or docs references still make sense

## Related Files

- [README.md](../README.md)
- [TECHNICAL_DESIGN.md](./TECHNICAL_DESIGN.md)
- [macos-distribution.md](./macos-distribution.md)
