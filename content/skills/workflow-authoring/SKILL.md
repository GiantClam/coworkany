---
name: workflow-authoring
description: Plan and safely create, modify, diagnose, or repair CoworkAny workflows from registered nodes and built-in golden templates.
metadata:
  version: "1.0.0"
  protocol_version: "1"
---

# Workflow Authoring

Use this Skill for requests to create, modify, diagnose, repair, or validate a workflow. Conceptual questions about workflows are read-only: explain the design without proposing or applying mutations unless the user asks.

## Authoring procedure

1. Identify the primary deliverable before translating the request into capabilities. For `图文混排文章`, `图文文章`, `文章配图`, or an illustrated article, the deliverable is an article and images are supporting material. Do not classify it as an image campaign, image batch, poster, or cover workflow just because images are requested. For image campaigns, image batches, posters, or cover-only requests, images are the primary deliverable. Capabilities describe executable behavior, not labels.
2. Inspect the current graph and the supplied golden-template catalog. Choose at most one primary template by required-capability coverage, then prefer fewer new nodes, fewer unconfigured provider requirements, and stable template key order. When an article-led request matches an image template, use it only as a node-structure reference; the user's deliverable priority determines the graph's main path. Reuse compatible nodes and registered subgraphs; never merge complete templates in a way that duplicates entry/output boundaries.
3. Preserve all valid existing nodes and user settings. Produce the smallest structural change that satisfies the request. A title change never supplies a missing capability. If a requested capability is absent, use the corresponding registered node type and connect compatible ports on a valid input-to-output path.
4. For repeated work, use the registered `foreach` / `collect` control structure. Do not create a raw graph cycle.
5. For an article-led request, preserve or create the primary path `text_input → writer → product_store.text`. Derive supporting illustrations from `writer.text`, then connect `image_generate.image` to the same `product_store.images`; never replace or disconnect the article path, and never generate article illustrations directly from only the original brief. Add a separate cover node only when the user asks for a cover. For an image-led request, prioritize the image output while preserving any explicitly requested copy. Describe the resulting text and image artifacts accurately; do not claim that image files are embedded inside Markdown unless the workflow actually produces that composition.
6. Select only from configured Providers and models with the required capability. Workflow assistant models are text-only. Never invent Provider IDs, models, credentials, brands, assets, URLs, or local paths. If an execution Provider is not configured, keep the full intended node and edges, leave Provider/model unset, and report that node as needing configuration.
7. Return one versioned structured plan whose operations exactly match the proposed operation group. Validate registered node types, versions, node configuration, ports, graph acyclicity, and required capabilities on executable input-to-output paths. Layout changed nodes deterministically without moving unaffected nodes.
8. If semantic or graph validation fails, make at most one bounded repair attempt using the reported issues. If that attempt fails, do not mutate; explain missing capabilities and concrete issues.

## Approval boundaries

- Ordinary edits, configured Provider/model switches, and deleting one node may proceed automatically.
- Require explicit approval before running/testing a workflow, deleting two or more nodes, irreversible replacement of existing workflow content, or applying a group that adds more than 20 nodes.
- Do not infer a request to run from a request to create, edit, validate, or repair.

## Plan protocol

Protocol version 1 requires exactly these fields: `schemaVersion`, `intent`, `requiredCapabilities`, `selectedTemplate`, `templateVersion`, `assumptions`, `operations`, and `validationResult`. `selectedTemplate` and `templateVersion` are both null if no template is selected. `validationResult` contains `status`, `issues`, and `repairAttempt` (`0` or `1`). `status` must be exactly `valid`, `invalid`, or `needs_configuration`; `issues` must be an array of nonempty strings. Use `needs_configuration` only when the graph is valid but an execution Provider still needs setup. Report that setup in `issues` and the user-facing message. An unconfigured execution Provider does not make an otherwise valid graph invalid.

Do not expose hidden reasoning. Return only a concise user-facing summary, the structured plan, allowlisted workflow operations, optional focus node keys, and an explicit run request only when the user directly asked to run or test.
