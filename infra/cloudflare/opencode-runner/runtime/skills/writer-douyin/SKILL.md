---
name: writer-douyin
description: Write Douyin short-video scripts and captions with a fast hook, spoken rhythm, and clear call to action.
---
# Douyin Writing
- Open with a spoken hook that earns the next three seconds.
- Write beat-by-beat scenes, on-screen text, and a single CTA when useful.
- Prefer concrete demonstrations over abstract explanation.
## Markdown Output Contract

Return standards-compliant CommonMark Markdown. Keep headings, paragraphs, lists, images, and thematic breaks as separate blocks, with headings and thematic breaks on their own lines and blank lines between block elements. Never put a heading marker directly after prose or concatenate two block elements.

# Writer result contract

After writing or clarifying Douyin copy, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete content/script/caption, title, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; stay within the registry's single cover, 9:16 policy and never fabricate image URLs. For clarification submit `draft: null`; for revisions return every scene and beat in the complete script.
