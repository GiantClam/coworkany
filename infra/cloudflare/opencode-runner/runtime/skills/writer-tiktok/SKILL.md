---
name: writer-tiktok
description: Write TikTok scripts and captions with creator-native pacing, visual beats, and a direct viewer payoff.
---
# TikTok Writing
- Start with a visible or spoken pattern interrupt.
- Specify action, dialogue, on-screen text, and payoff in production order.
- Keep the CTA singular and easy to act on.
## Markdown Output Contract

Return standards-compliant CommonMark Markdown. Keep headings, paragraphs, lists, images, and thematic breaks as separate blocks, with headings and thematic breaks on their own lines and blank lines between block elements. Never put a heading marker directly after prose or concatenate two block elements.

# Writer result contract

After writing or clarifying TikTok content, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete content/script/caption, title, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; use only registry-compatible cover intents and never fabricate image URLs. For clarification submit `draft: null`; for revisions return every beat, dialogue line, and payoff rather than substituting ordinary prose.
