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
| Character source art + skin atlas (back-facing big-head/short-body; seven role accents and props) | `generated` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/characters-v1.png` | 2203 × 714, RGBA | `imagegen-characters-v1` | Seven transparent back-facing workers are separated left-to-right with role props and accent colors; awaiting individual user approval and rig-slice review. | — | Must remain outside `public/virtual-office/v1` until approved. |
| Character turnarounds (7 roles × 8 views for rig guidance) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-ai-chat-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-ai-chat-turnaround-v1` | AI Chat sample contains eight consistent angles in a 2 × 4 sheet with transparent alpha; the user approved this view grammar and style as the reference for the remaining six role sheets. | 2026-10-10 (Asia/Shanghai) | Approved as the turnaround template; full family remains outside `public/virtual-office/v1` until all seven sheets are approved. |
| Agent Center character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-agent-center-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-agent-center-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; blue coordinator outfit, headset, and clipboard/task-board prop on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved turnaround draft; remains outside `public/virtual-office/v1` until the complete role set and layer-source checks pass. |
| PPT Expert character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-ppt-expert-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-ppt-expert-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; butter-yellow presenter outfit, pointer, and slide-card prop on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved turnaround draft; remains outside `public/virtual-office/v1` until the complete role set and layer-source checks pass. |
| Workflow Operator character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-workflow-operator-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-workflow-operator-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; terracotta/coral outfit and gear tile prop on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved turnaround draft; remains outside `public/virtual-office/v1` until the complete role set and layer-source checks pass. |
| Desk source art + state variants (available, active, offline) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Display source art (main, side, stands, status effects) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Rig preview + animation data (bones, slots, texture regions, clips) | `not-started` | — | — | — | — | — | Must remain outside `public/virtual-office/v1` until approved. |
| Composite preview (background + characters + desks + displays) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/complete-studio-ui-v1.png` | 2172 × 724, RGBA | `imagegen-composite-ui-v1` | Seven independent stations are visible on a transparent canvas; cartoon UI direction, short back-facing workers, desk + dual-screen silhouette, and light UI treatment approved by the user. | 2026-10-10 (Asia/Shanghai) | Keep as an approved reference; do not mark integrated until asset integrity and layer-source checks pass. |

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

This ledger is intentionally separate from production integration. The first composite UI draft is recorded above for individual review; no file under `apps/desktop/public/virtual-office/v1/` has been added or replaced. Future asset-generation work must update this ledger in the same change that records the corresponding user decision.
