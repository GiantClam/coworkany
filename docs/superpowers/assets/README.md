# Virtual Studio Asset Gate

This directory is the review boundary for the virtual-studio artwork. Image generation and application integration are separate activities: a generated draft remains here until the user has reviewed that asset family explicitly.

## Non-negotiable gate

An asset must be in the `approved` state before it may be copied into `apps/desktop/public/virtual-office/v1/` (the versioned production asset directory). Approval is per asset family; approval of the background does not approve characters, desks, displays, rig data, or the composite. Do not infer approval from a prior design decision or from approval of another family.

The ledger in [2026-10-10-virtual-studio-asset-approval.md](./2026-10-10-virtual-studio-asset-approval.md) is the source of truth. Keep prior drafts when a revision is requested; use a new filename and retain the old row history rather than overwriting evidence.

## Approval states

Every row moves through these exact states:

| State | Meaning | Allowed production-directory action |
| --- | --- | --- |
| `not-started` | No inspectable draft exists yet. | No copy or manifest entry. |
| `generated` | A draft exists at the recorded path and is ready for visual review. | Keep in the drafts/review area only. |
| `revision-requested` | The user requested a concrete change; the current draft is not approved. | Keep the rejected draft; generate a new version. |
| `approved` | The user explicitly approved this family on the recorded date after visual review. | Eligible for integrity checks and integration; do not mark integrated yet. |
| `integrated` | The approved file passed checks and was copied into the versioned production directory. | Production use is allowed. |

Only this progression is valid: `not-started` → `generated` → `approved` → `integrated`. A review can instead move `generated` (or a replacement draft) to `revision-requested`; after a new draft is inspectable, record it as `generated` before seeking approval again. Never skip `approved`, and never use `integrated` as a proxy for user approval.

## Asset families covered

The ledger has one independently reviewable row for each family:

1. Complete studio background (seven island workstation slots, no characters).
2. Character source art and skin atlas (shared back-facing big-head/short-body silhouette and role props).
3. Desk source art and state variants (available, active, offline).
4. Display source art (main display, side display, stands, and status effects).
5. Rig preview and animation data (bones, slots, texture regions, and the seven clips).
6. Composite preview (all approved layers assembled into the seven-station scene).

Review each family for composition, transparent edges, proportions, color, layer order, sliceability, and compatibility with the other approved layers. Record the generated path, dimensions, prompt/version, visual review result, and explicit user approval date in the ledger.

## Directory policy

- Drafts and review previews belong under `docs/superpowers/assets/drafts/` (or another path explicitly recorded in the ledger).
- The production directory `apps/desktop/public/virtual-office/v1/` is immutable from the perspective of unapproved drafts. Do not modify it while a row is `not-started`, `generated`, or `revision-requested`.
- A row may be marked `integrated` only after the user approval date is recorded, dimensions/transparency/manifest/hash checks pass, and the exact copied path is recorded.
- If an integrated asset is revised, create a new versioned draft and repeat the gate; do not silently replace the integrated file.

## Current status

The approval ledger starts with all six families at `not-started`. Image generation and individual user approval are intentionally outside this documentation task.
