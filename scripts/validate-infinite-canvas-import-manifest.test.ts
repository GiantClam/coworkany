import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { MANIFEST_FIELDS, parseManifest, validateManifest } from "./validate-infinite-canvas-import-manifest"

const header = `| ${MANIFEST_FIELDS.join(" | ")} |\n| ${MANIFEST_FIELDS.map(() => "---").join(" | ")} |`
const commit = "29bff79066e614cb54ffa8e98b1992a14eb285a0"

function fixture(entry: string): string {
  return `${header}\n${entry}`
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "infinite-canvas-manifest-"))
  fs.mkdirSync(path.join(root, "docs/upstream"), { recursive: true })
  fs.writeFileSync(path.join(root, "docs/upstream/infinite-canvas-import-manifest.md"), fixture(""))
  fs.mkdirSync(path.join(root, "tests"), { recursive: true })
  fs.writeFileSync(path.join(root, "tests/fixture.test.ts"), "export {}\n")
  fs.mkdirSync(path.join(root, "vendor/infinite-canvas"), { recursive: true })
  return root
}

test("accepts an empty manifest when no upstream files or annotations exist", () => {
  const root = makeRoot()
  assert.deepEqual(validateManifest(root), [])
})

test("rejects missing required source metadata and paths", () => {
  const parsed = parseManifest(fixture("| canvas | hero8152/Infinite-Canvas | bad | source.js | missing.ts | 2026-07-16 | adapted |  |  |  |"))
  assert.equal(parsed.errors.length, 0)
  const root = makeRoot()
  fs.writeFileSync(path.join(root, "docs/upstream/infinite-canvas-import-manifest.md"), fixture("| canvas | hero8152/Infinite-Canvas | bad | source.js | missing.ts | 2026-07-16 | adapted |  |  |  |"))
  const errors = validateManifest(root)
  assert.ok(errors.some((error) => error.includes("upstreamCommit")))
  assert.ok(errors.some((error) => error.includes("localPath")))
  assert.ok(errors.some((error) => error.includes("license")))
  assert.ok(errors.some((error) => error.includes("tests")))
})

test("requires a manifest row for imported source capabilities", () => {
  const root = makeRoot()
  fs.writeFileSync(path.join(root, "vendor/infinite-canvas/selection.ts"), "// upstream:infinite-canvas/canvas-multiselect\n")
  fs.writeFileSync(path.join(root, "docs/upstream/infinite-canvas-import-manifest.md"), fixture(""))
  assert.ok(validateManifest(root).some((error) => error.includes("canvas-multiselect")))
})

test("accepts a complete imported entry and its source annotation", () => {
  const root = makeRoot()
  const localPath = "vendor/infinite-canvas/canvas-multiselect/source.ts"
  fs.mkdirSync(path.join(root, path.dirname(localPath)), { recursive: true })
  fs.writeFileSync(path.join(root, localPath), "// upstream:infinite-canvas/canvas-multiselect\n")
  const row = `| canvas-multiselect | hero8152/Infinite-Canvas | ${commit} | static/js/canvas.js | ${localPath} | 2026-07-16 | adapted | upstream LICENSE; local-test-only | tests/fixture.test.ts | adapted behavior |`
  fs.writeFileSync(path.join(root, "docs/upstream/infinite-canvas-import-manifest.md"), fixture(row))
  assert.deepEqual(validateManifest(root), [])
})

test("ignores generated target trees at any repository depth", () => {
  const root = makeRoot()
  const generated = path.join(root, "apps/desktop/src-tauri/target/release/runtime")
  fs.mkdirSync(generated, { recursive: true })
  fs.writeFileSync(path.join(generated, "generated.ts"), "// upstream:infinite-canvas/generated-build-output\n")
  assert.deepEqual(validateManifest(root), [])
})
