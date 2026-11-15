import fs from "node:fs"
import path from "node:path"

export const MANIFEST_FIELDS = [
  "capability",
  "upstreamRepo",
  "upstreamCommit",
  "upstreamPath",
  "localPath",
  "importedAt",
  "classification",
  "license",
  "tests",
  "notes",
] as const

const CLASSIFICATIONS = new Set(["upstream-derived", "adapted", "local-original"])
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const SOURCE_ROOTS = ["vendor/infinite-canvas", "public/upstream/infinite-canvas"]
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".next-build",
  ".cache",
  "coverage",
  "docs",
  ".artifacts",
  "dist",
  "dist-runtime",
  "target",
])

export type ManifestEntry = Record<(typeof MANIFEST_FIELDS)[number], string>

function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|")) return []
  const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined).split("|")
  return cells.map((cell) => cell.trim())
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length === MANIFEST_FIELDS.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function listFiles(root: string, relative = ""): string[] {
  const directory = path.join(root, relative)
  if (!fs.existsSync(directory)) return []
  const result: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue
      result.push(...listFiles(root, child))
    } else if (entry.isFile()) {
      result.push(child)
    }
  }
  return result
}

function pathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function validateRelativePath(root: string, value: string, field: string): string[] {
  const errors: string[] = []
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    errors.push(`${field} must be a repository-relative path without '..': ${value || "<empty>"}`)
    return errors
  }
  const resolved = path.resolve(root, value)
  if (!pathInsideRoot(root, resolved)) errors.push(`${field} must stay inside the repository: ${value}`)
  if (!fs.existsSync(resolved)) errors.push(`${field} does not exist: ${value}`)
  return errors
}

function sourceCapabilities(root: string): Set<string> {
  const capabilities = new Set<string>()
  for (const sourceRoot of SOURCE_ROOTS) {
    const absolute = path.join(root, sourceRoot)
    if (!fs.existsSync(absolute)) continue
    for (const file of listFiles(root, sourceRoot)) {
      const relative = path.relative(sourceRoot, file).split(path.sep)
      if (relative.length === 0 || !relative[0]) continue
      capabilities.add(relative[0])
    }
  }

  for (const file of listFiles(root)) {
    const relative = file.split(path.sep).join("/")
    if (relative === "scripts/validate-infinite-canvas-import-manifest.ts" || relative === "scripts/validate-infinite-canvas-import-manifest.test.ts") continue
    const contents = fs.readFileSync(path.join(root, file), "utf8")
    for (const match of contents.matchAll(/upstream:infinite-canvas\/([a-z0-9][a-z0-9._-]*)/gi)) {
      capabilities.add(match[1])
    }
  }
  return capabilities
}

export function parseManifest(markdown: string): { entries: ManifestEntry[]; errors: string[] } {
  const errors: string[] = []
  const rows = markdown.split(/\r?\n/).map(splitTableRow).filter((cells) => cells.length > 0)
  const headerIndex = rows.findIndex((cells) => cells.length === MANIFEST_FIELDS.length && cells.every((cell, index) => cell === MANIFEST_FIELDS[index]))
  if (headerIndex < 0) return { entries: [], errors: [`manifest must contain the exact ${MANIFEST_FIELDS.length}-column header`] }
  if (!rows[headerIndex + 1] || !isSeparatorRow(rows[headerIndex + 1])) errors.push("manifest must contain a separator row after the header")

  const entries: ManifestEntry[] = []
  for (const cells of rows.slice(headerIndex + 2)) {
    if (isSeparatorRow(cells)) continue
    if (cells.length !== MANIFEST_FIELDS.length) {
      errors.push(`manifest row must contain ${MANIFEST_FIELDS.length} columns: ${cells.join(" | ")}`)
      continue
    }
    entries.push(Object.fromEntries(MANIFEST_FIELDS.map((field, index) => [field, cells[index]])) as ManifestEntry)
  }
  return { entries, errors }
}

export function validateManifest(root = process.cwd(), manifestPath = path.join(root, "docs/upstream/infinite-canvas-import-manifest.md")): string[] {
  const errors: string[] = []
  if (!fs.existsSync(manifestPath)) return [`manifest file does not exist: ${path.relative(root, manifestPath)}`]
  const parsed = parseManifest(fs.readFileSync(manifestPath, "utf8"))
  errors.push(...parsed.errors)
  const capabilities = new Set<string>()
  for (const [index, entry] of parsed.entries.entries()) {
    const row = index + 1
    if (!entry.capability || !CAPABILITY_PATTERN.test(entry.capability)) errors.push(`row ${row}: invalid capability`)
    if (capabilities.has(entry.capability)) errors.push(`row ${row}: duplicate capability ${entry.capability}`)
    capabilities.add(entry.capability)
    if (!entry.upstreamRepo) errors.push(`row ${row}: upstreamRepo is required`)
    if (!COMMIT_PATTERN.test(entry.upstreamCommit)) errors.push(`row ${row}: upstreamCommit must be a 40-character commit`)
    if (!entry.upstreamPath) errors.push(`row ${row}: upstreamPath is required`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.importedAt) || Number.isNaN(Date.parse(`${entry.importedAt}T00:00:00Z`))) errors.push(`row ${row}: importedAt must be YYYY-MM-DD`)
    if (!CLASSIFICATIONS.has(entry.classification)) errors.push(`row ${row}: invalid classification ${entry.classification}`)
    if (!entry.license) errors.push(`row ${row}: license is required`)
    errors.push(...validateRelativePath(root, entry.localPath, `row ${row} localPath`))
    const testPaths = entry.tests.split(/[;,]/).map((value) => value.trim()).filter(Boolean)
    if (testPaths.length === 0) errors.push(`row ${row}: tests must contain at least one path`)
    for (const testPath of testPaths) errors.push(...validateRelativePath(root, testPath, `row ${row} tests`))
    if (!entry.notes) errors.push(`row ${row}: notes is required`)
  }

  for (const capability of sourceCapabilities(root)) {
    if (!capabilities.has(capability)) errors.push(`source capability ${capability} is missing from manifest`)
  }
  return errors
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = validateManifest()
  if (errors.length > 0) {
    console.error(`Infinite-Canvas import manifest invalid (${errors.length} error${errors.length === 1 ? "" : "s"}):`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  } else {
    console.log("Infinite-Canvas import manifest valid")
  }
}
