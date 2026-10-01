import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyAIElementsPorts } from "../../../scripts/ai-elements-port.mjs";

const root = new URL("../src/ai-elements/", import.meta.url);
const files = ["message", "reasoning", "tool", "conversation"];

test("official AI Elements ports retain the pinned upstream snapshots without business adapter imports", () => {
  verifyAIElementsPorts(root);
  const manifest = JSON.parse(readFileSync(new URL("official/provenance.json", root), "utf8")) as { upstreamSha256: Record<string, string> };
  for (const name of files) {
    const upstream = readFileSync(new URL(`upstream/${name}.tsx.txt`, root));
    const digest = createHash("sha256").update(upstream).digest("hex");
    assert.equal(digest, manifest.upstreamSha256[`${name}.tsx`], `${name} upstream snapshot changed`);
    const port = readFileSync(new URL(`official/${name}.tsx`, root), "utf8");
    assert.doesNotMatch(port, /message-adapters/);
  }
});
