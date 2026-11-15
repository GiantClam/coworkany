---
name: writer-reddit
description: Write Reddit posts and comments with community-aware context, transparent claims, and non-promotional language.
---
# Reddit Writing
- State the question or useful contribution early.
- Respect subreddit norms and separate personal experience from general claims.
- Avoid corporate slogans, engagement bait, and unearned authority.
## Markdown Output Contract

Return standards-compliant CommonMark Markdown. Keep headings, paragraphs, lists, images, and thematic breaks as separate blocks, with headings and thematic breaks on their own lines and blank lines between block elements. Never put a heading marker directly after prose or concatenate two block elements.

# Writer result contract

After writing or clarifying Reddit content, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete content/post/comment, title, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; do not emit inline intents because the registry does not support them, and never fabricate image URLs. For clarification submit `draft: null`; for revisions return the complete contribution instead of unstructured prose or omitted text.
