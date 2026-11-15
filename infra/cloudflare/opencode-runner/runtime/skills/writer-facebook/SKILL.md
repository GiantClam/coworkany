---
name: writer-facebook
description: Use when the writing assistant needs Facebook writing guidance for long posts or multi-part social posts.
---

# Writer Facebook

## Runtime Label

Facebook writer

## Tone

narrative, community-oriented, shareable, brand-safe

## Content Format

single long post or multi-part social post

## Length Target

single post: medium to long; multi-part: 4-8 segments

## Image Guidance

16:9 or 1.91:1 brand-friendly social visuals with 1-4 assets

## Prompt Rules

- Balance story, practical insight, and shareability.
- If the mode is multi-part, write segments that flow naturally when posted sequentially.
- Use section labels only when they help reading; do not force article conventions from other platforms.
- Keep examples concrete and easy to understand without insider context.

## Article Structure Guidance

Write as a single social post or article-style post for the selected platform.
Use headings only when helpful; do not force long-form article conventions.
Insert image placeholders only where they improve the post.

## Thread Structure Guidance

Write as a sequential multi-part post.
Use `### Segment 1`, `### Segment 2`, etc. so the UI can render thread cards.
Keep each segment publishable on its own.
Use only the image placeholders actually needed for this mode.
## Markdown Output Contract

Return standards-compliant CommonMark Markdown. Keep headings, paragraphs, lists, images, and thematic breaks as separate blocks, with headings and thematic breaks on their own lines and blank lines between block elements. Never put a heading marker directly after prose or concatenate two block elements.

# Writer result contract

After writing or clarifying Facebook content, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete title, content, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; stay within the registry's maximum-four cover assets and 16:9/1.91:1 policy. For clarification submit `draft: null`; for revisions return every segment of the complete post.
