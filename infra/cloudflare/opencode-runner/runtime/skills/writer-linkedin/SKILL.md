---
name: writer-linkedin
description: Write credible LinkedIn posts for professional audiences with a clear insight, evidence, and practical takeaway.
---
# LinkedIn Writing
- Lead with a specific observation or decision, not a generic motivational claim.
- Use professional first-person only when supported by supplied context.
- End with a useful takeaway or focused discussion prompt.
## Markdown Output Contract

Return standards-compliant CommonMark Markdown. Keep headings, paragraphs, lists, images, and thematic breaks as separate blocks, with headings and thematic breaks on their own lines and blank lines between block elements. Never put a heading marker directly after prose or concatenate two block elements.

# Writer result contract

After writing or clarifying LinkedIn content, call `writer_submit_result` exactly once. Use its flat `schemaVersion: 1` contract: `outcome` is `draft_ready` or `needs_clarification`, `operation` is the current operation, and `draft` contains the complete title, content, and numeric `baseRevision` when ready. Include `research: { requested, completed, sourceUrls }` and `assetIntents` with `{ id, kind, prompt, placement, aspectRatio }`; stay within the registry's maximum-two cover assets and compatible aspect ratios. For clarification submit `draft: null`; for revisions return the complete post rather than unsubmitted prose or an ellipsis.
