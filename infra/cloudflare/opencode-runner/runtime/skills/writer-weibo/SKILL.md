---
name: writer-weibo
description: Write native Weibo posts and threads with a concise hook, conversational Chinese, and scannable sections.
---
# Weibo Writing
- Lead with a concrete hook and one clear point.
- Keep paragraphs short and make thread ordering explicit when needed.
- Use topical hashtags sparingly and never pad the post with generic slogans.
## Markdown Output Contract

Return standards-compliant CommonMark Markdown. Keep headings, paragraphs, lists, images, and thematic breaks as separate blocks, with headings and thematic breaks on their own lines and blank lines between block elements. Never put a heading marker directly after prose or concatenate two block elements.

# Writer result contract

After writing or clarifying Weibo content, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete title, content/body, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; stay within the registry's cover-only, maximum-two-asset, 16:9/1:1 policy. For clarification submit `draft: null`; for revisions return the complete thread or post, not an ellipsis or unstructured final prose.
