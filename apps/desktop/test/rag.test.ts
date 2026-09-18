import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { mergeHybridCitations, searchVaultIndex } from "../runtime/rag";
import { buildLanceIndex } from "../runtime/lancedb";
import type { VaultManifest } from "../runtime/obsidian";

const semanticRagSupported = !(process.platform === "darwin" && process.arch === "x64");

test("desktop RAG searches a Vault manifest without SQLite or remote calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-rag-")); const index = join(root, "index");
  try {
    await mkdir(index);
    await writeFile(join(index, "manifest.json"), JSON.stringify({ chunks: [{ id: "a", documentPath: "知识/营销.md", heading: "活动", text: "营销策略", hash: "a", tags: ["#增长"], links: ["campaign-brief"] }] }), "utf8");
    const textResults = await searchVaultIndex(index, "营销");
    const metadataResults = await searchVaultIndex(index, "增长 campaign-brief");
    assert.equal(textResults[0]?.documentPath, "知识/营销.md");
    assert.equal(metadataResults[0]?.excerpt, "营销策略");
  }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("desktop RAG merges exact lexical hits with LanceDB nearest neighbours", { skip: !semanticRagSupported }, () => {
  const results = mergeHybridCitations(
    [{ chunkId: "exact", documentPath: "营销/精确.md", excerpt: "exact", score: 2 }],
    [{ id: "semantic", documentPath: "品牌/语义.md", excerpt: "semantic", distance: 0.05 }],
    2,
  );
  assert.deepEqual(results.map((item) => item.chunkId), ["semantic", "exact"]);
  assert.ok(results.every((item) => item.score > 0));
});

test("desktop RAG uses hybrid retrieval only after the active index is semantic-ready", { skip: !semanticRagSupported }, async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-rag-state-")); const index = join(root, "index");
  try {
    await mkdir(index);
    const manifest: VaultManifest = { schemaVersion: 1, vaultPath: join(root, "Vault"), generation: 1, documents: [{ documentPath: "note.md", hash: "hash" }], chunks: [{ id: "exact", documentPath: "note.md", text: "exact lexical match", hash: "exact" }, { id: "semantic", documentPath: "other.md", text: "vector-only result", hash: "semantic" }], updatedAt: new Date().toISOString() };
    await writeFile(join(index, "manifest.json"), JSON.stringify(manifest), "utf8");
    const fetchImpl: typeof fetch = async (_input, init) => {
      const inputs = JSON.parse(String(init?.body)).input as unknown[];
      return new Response(JSON.stringify({ data: inputs.length === 1 ? [{ embedding: [1, 0] }] : [{ embedding: [0, 1] }, { embedding: [1, 0] }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const state = await buildLanceIndex(index, manifest, { mode: "remote", baseUrl: "https://embeddings.example.test/v1", model: "embedding-test", apiKey: "test-secret", fetchImpl });
    assert.deepEqual((await searchVaultIndex(index, "exact", 1, { mode: "remote", baseUrl: "https://embeddings.example.test/v1", model: "embedding-test", apiKey: "test-secret", fetchImpl })).map((item) => item.chunkId), ["semantic"]);
    await writeFile(join(index, "index-state.json"), JSON.stringify({ ...state, status: "lexical_ready" }), "utf8");
    assert.deepEqual((await searchVaultIndex(index, "exact", 1, { mode: "remote", baseUrl: "https://embeddings.example.test/v1", model: "embedding-test", apiKey: "test-secret", fetchImpl })).map((item) => item.chunkId), ["exact"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
