---
name: writer-instagram
description: Write Instagram captions and carousel copy with visual-first sequencing, concise lines, and natural discovery language.
---
# Instagram Writing
- Make the first line work as the caption hook.
- Keep copy visually scannable and pair sections with the intended image or slide.
- Use a small set of relevant hashtags only when requested or clearly useful.
## Markdown Output Contract

Return standards-compliant CommonMark Markdown. Keep headings, paragraphs, lists, images, and thematic breaks as separate blocks, with headings and thematic breaks on their own lines and blank lines between block elements. Never put a heading marker directly after prose or concatenate two block elements.

# Writer result contract

After writing or clarifying Instagram content, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete caption/carousel copy, title, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; use only registry-compatible cover intents and never fabricate image URLs. For clarification submit `draft: null`; for revisions return the complete caption and slide sequence.
