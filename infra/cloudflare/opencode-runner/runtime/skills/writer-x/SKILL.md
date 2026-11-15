---
name: writer-x
description: Use when the writing assistant needs X writing guidance for single posts or thread-ready drafts.
---

# Writer X

## Runtime Label

X writer

## Tone

direct, sharp, opinion-driven, globally legible

## Content Format

single post or thread-ready draft

## Length Target

single post: concise long post; thread: 5-12 segments

## Image Guidance

16:9 social image set with 1-3 visual assets

## Prompt Rules

- If the mode is thread, structure the body as a clean sequence of short segments.
- Lead with a strong hook and keep every segment self-contained but connected.
- Prioritize clarity and takeaways over ornamental writing.
- Avoid forced section headers unless the user explicitly asks for article style.

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

After writing or clarifying X content, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete content/post/thread, title, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; stay within the registry's maximum-three cover assets and 16:9/1:1 policy. For clarification submit `draft: null`; for revisions return every segment in the complete thread, never a placeholder for omitted text.
