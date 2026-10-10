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
| Complete studio background (no characters; seven island workstation slots) | `integrated` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/complete-studio-background-v1.png` | 2172 × 724, RGBA | `imagegen-complete-studio-background-v1` | Transparent warm 2.5D island platform with exactly seven empty workstation pads (three rear, four front), rounded architectural framing, soft placement shadows, and neutral cable ports; no characters, desks, displays, text, or extra furniture. Alpha corners verified and white-background inspection confirms clean isolated edges; explicitly approved by the user. | 2026-10-10 (Asia/Shanghai) | Runtime derivative integrated at `apps/desktop/public/virtual-office/v1/office.webp`; manifest hash and dimension checks passed. |
| Character source art + skin atlas (back-facing big-head/short-body; seven role accents and props) | `integrated` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/characters-v1.png` | 2203 × 714, RGBA | `imagegen-characters-v1` | Seven transparent back-facing workers are separated left-to-right with role props and accent colors; alpha corners verified and white-background inspection confirms clean isolated silhouettes and clear role separation; explicitly approved by the user. | 2026-10-10 (Asia/Shanghai) | Source consumed immutably; normalized runtime atlas integrated at `apps/desktop/public/virtual-office/v1/characters.webp` with seven stable role regions and manifest hash. |
| Character turnarounds (7 roles × 8 views for rig guidance) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-ai-chat-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-ai-chat-turnaround-v1` | AI Chat sample contains eight consistent angles in a 2 × 4 sheet with transparent alpha; the user approved this view grammar and style, and all six companion role sheets were generated and approved in the same grammar. | 2026-10-10 (Asia/Shanghai) | Seven approved 8-view source sheets remain outside the runtime bundle as immutable rig-guidance references; the normalized skin atlas is integrated in `characters.webp`. |
| Agent Center character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-agent-center-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-agent-center-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; blue coordinator outfit, headset, and clipboard/task-board prop on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved rig-guidance source retained outside runtime; the shared role skin atlas is integrated at `characters.webp`. |
| PPT Expert character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-ppt-expert-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-ppt-expert-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; butter-yellow presenter outfit, pointer, and slide-card prop on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved rig-guidance source retained outside runtime; the shared role skin atlas is integrated at `characters.webp`. |
| Workflow Operator character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-workflow-operator-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-workflow-operator-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; terracotta/coral outfit and gear tile prop on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved rig-guidance source retained outside runtime; the shared role skin atlas is integrated at `characters.webp`. |
| Writer character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-writer-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-writer-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; lavender outfit with notebook and pen props on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved rig-guidance source retained outside runtime; the shared role skin atlas is integrated at `characters.webp`. |
| Image Creator character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-image-creator-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-image-creator-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; olive-green outfit with beret, palette, and paintbrush props on a transparent canvas; dimensions and alpha verified. | 2026-10-10 (Asia/Shanghai) | Approved rig-guidance source retained outside runtime; the shared role skin atlas is integrated at `characters.webp`. |
| Video Producer character turnaround (8 views) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/character-video-producer-turnaround-v1.png` | 1536 × 1024, RGBA | `imagegen-video-producer-turnaround-v1` | Eight consistent angles in the approved 2 × 4 view grammar; slate gray-blue outfit with camera/microphone prop on a transparent canvas; dimensions and alpha verified; explicitly approved by the user. | 2026-10-10 (Asia/Shanghai) | Approved rig-guidance source retained outside runtime; the shared role skin atlas is integrated at `characters.webp`. |
| Desk source art + state variants (available, active, offline) | `integrated` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/desk-state-variants-v1.png` | 2172 × 724, RGBA | `imagegen-desk-state-variants-v2` | Horizontal triptych with three identical dual-monitor desks: available (left, neutral blue-gray screens + mint indicator), active (center, mint-cyan screens + mint indicator), offline (right, dim screens + amber indicator). Transparent corners and RGBA alpha verified; white-background inspection shows clean isolated silhouettes and clear slice gaps; explicitly approved by the user. | 2026-10-10 (Asia/Shanghai) | Runtime back/front layers integrated at `apps/desktop/public/virtual-office/v1/workstations.webp` and `workstations-front.webp`; three states × seven roles validated. |
| Display source art (main, side, stands, status effects) | `integrated` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/display-source-art-v1.png` | 1536 × 1024, RGBA | `imagegen-display-source-art-v1` | 2 × 2 transparent component sheet: front main monitor, angled side monitor, independent front/side stand pieces, and three isolated status indicators (available mint, active cyan pulse, offline amber). Blank screens contain no text; alpha corners verified and white-background inspection confirms separated, sliceable components; explicitly approved by the user. | 2026-10-10 (Asia/Shanghai) | Independent display atlas integrated at `apps/desktop/public/virtual-office/v1/displays.webp`; manifest regions keep main, side, stands, and status effects replaceable. |
| Rig preview + animation data (bones, slots, texture regions, clips) | `integrated` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/rig-preview-v1.png` + `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/rig-animation-data-v1.json` | 1536 × 1024, RGBA (preview); JSON companion | `imagegen-rig-preview-v1` + `rig-animation-data-v1` | Transparent rig handoff sheet with one large back-facing big-head/short-body character and seven consistent pose thumbnails (idle, walk, work, thinking, waiting, completed, error). Large figure visibly overlays the required bone chain and prop attachment; alpha corners verified and white-background inspection confirms readable separation; the JSON companion records the exact eight bones, four slots, parametric regions, seven clips, and reduced-motion fallback; explicitly approved by the user. | 2026-10-10 (Asia/Shanghai) | Normalized rig JSON integrated at `apps/desktop/public/virtual-office/v1/rig-animation-data.json`; preview remains in the approved draft folder for art review. |
| Composite preview (background + characters + desks + displays) | `approved` | `docs/superpowers/assets/drafts/2026-10-10-virtual-studio/complete-studio-ui-v1.png` | 2172 × 724, RGBA | `imagegen-composite-ui-v1` | Seven independent stations are visible on a transparent canvas; cartoon UI direction, short back-facing workers, desk + dual-screen silhouette, and light UI treatment approved by the user. | 2026-10-10 (Asia/Shanghai) | Keep as an approved visual reference outside the runtime bundle; production rendering uses the independently replaceable layers listed above. |

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

This ledger is intentionally separate from production integration. Runtime integration evidence recorded on 2026-10-11 (Asia/Shanghai): `pnpm --dir apps/desktop run verify:virtual-office-assets`, `pnpm --dir apps/desktop run verify:virtual-office-bundle`, `pnpm --dir apps/desktop run typecheck`, the complete `virtual-office-*.test.ts` suite (97/97), and `pnpm --dir apps/desktop exec vite build` all passed; the local `/dashboard/office` browser check rendered the layered scene and opened a role status card. The seven 8-view turnaround sheets and composite preview remain approved design references outside the runtime bundle by design.
