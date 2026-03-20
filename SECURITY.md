# Security Policy

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Instead, contact the maintainers privately with:

- a clear description of the issue
- affected components
- reproduction steps or a proof of concept
- impact assessment if known
- any suggested mitigation

If private contact details are not yet published in the repository profile, open a minimal issue asking for a secure reporting channel without disclosing the vulnerability details.

## What Counts as Security-Sensitive

In CoworkAny, security-sensitive issues commonly include:

- approval bypasses
- unintended filesystem write access
- shell execution escaping expected boundaries
- insecure browser automation behaviors
- secret leakage
- memory/vault data exposure
- packaging or update-chain weaknesses

## Disclosure Expectations

Please give maintainers reasonable time to investigate and prepare a fix before public disclosure.

## Hardening Areas of Interest

Security review is especially valuable around:

- `desktop/src-tauri/src/sidecar.rs`
- `desktop/src-tauri/src/process_manager.rs`
- `desktop/src-tauri/src/shadow_fs.rs`
- `sidecar/src/tools/`
- `sidecar/src/execution/`
- `sidecar/src/security/`

## Safe Reports

High-quality reports usually contain:

- exact version or commit
- platform information
- required configuration
- minimal reproduction steps
- expected boundary vs actual boundary
