# Virtual Studio Asset Approval Ledger

**Design:** warm 2.5D cartoon office, seven-station island layout

**Approval model:** each family is generated and approved independently

**Production gate:** `approved` is required before any file enters `apps/desktop/public/virtual-office/v1/`

**Ledger owner:** virtual-studio redesign implementation team
**Initial date:** 2026-10-10 (Asia/Shanghai)

## State vocabulary

Use these exact state values in the `State` column:

- `not-started` — no inspectable draft exists.
- `generated` — a draft is available at the recorded path and awaits visual review.
- `revision-requested` — the user requested a concrete revision; the current draft is not approved.
- `approved` — the user explicitly approved this family and the approval date is recorded.
- `integrated` — the approved artifact passed integrity checks and was copied into `apps/desktop/public/virtual-office/v1/`.

The normal path is `not-started` → `generated` → `approved` → `integrated`. A revision may move a reviewed draft to `revision-requested`; the replacement must receive its own `generated` entry before approval. `integrated` is never valid without a prior explicit `approved` decision. Approval of one row never approves another row.

## Ledger

All rows begin at `not-started`. Replace the placeholders only when an inspectable artifact or explicit user decision exists. Keep old draft paths and review notes when a revision is requested.

| Asset family | State | Generated file path | Dimensions | Prompt / version | Visual review result | Explicit user approval date | Integrated production path / notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Complete studio background (no characters; seven island workstation slots) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Character source art + skin atlas (back-facing big-head/short-body; seven role accents and props) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Desk source art + state variants (available, active, offline) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Display source art (main, side, stands, status effects) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Rig preview + animation data (bones, slots, texture regions, clips) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Composite preview (background + characters + desks + displays) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |

## Review checklist

For every family, record the result of each check in the `Visual review result` cell (or link to a dated review note):

- composition and seven-station placement;
- transparent edges and absence of unintended matte/halo pixels;
- character and furniture proportions;
- identity colors versus runtime status colors;
- layer order and occlusion (character behind desk front edge, displays independently replaceable);
- sliceability / atlas regions and stable dimensions;
- compatibility with the other already-approved families;
- required reduced-motion or static-safe fallback where applicable.

For the rig row, additionally verify the exact bones `root`, `torso`, `head`, `arm.l`, `arm.r`, `hand.l`, `hand.r`, `prop` and clips `idle`, `walk`, `work`, `thinking`, `waiting`, `completed`, `error`.

## Approval procedure

1. Generate a new, immutable draft and record its path, dimensions, and prompt/version; set the row to `generated`.
2. Show that family to the user and capture either an explicit approval date or a concrete revision request. Do not continue on implied approval.
3. On revision, set the reviewed draft to `revision-requested`, preserve its path, create a new filename, and restart at `generated`.
4. On explicit approval, record the date and review result, then set the row to `approved`.
5. Run transparency, dimensions, manifest, and SHA-256 checks. Copy only the approved artifact into the versioned production directory and record the exact destination; then set the row to `integrated`.
6. If any check fails, leave the row at `approved` (or `revision-requested` if the visual asset itself must change) and do not copy it.

## Audit notes

This ledger is intentionally documentation-only. No image is generated, and no file under `apps/desktop/public/virtual-office/v1/` may be added or replaced by this gate setup. Future asset-generation work must update this ledger in the same change that records the corresponding user decision.
