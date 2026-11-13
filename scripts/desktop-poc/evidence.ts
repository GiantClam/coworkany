import { appendFile, lstat, mkdir, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { redactValue, summarizeTarget } from "./canonical";

export type TimelineResult = "passed" | "failed" | "skipped";
export type ErrorCategory = "action" | "assertion" | "crash" | "persistence" | "environment";

export type TimelineEvent = {
  readonly runId: string;
  readonly stepId: string;
  readonly actor: string;
  readonly action: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly result: TimelineResult;
  readonly errorCategory?: ErrorCategory;
  readonly target?: unknown;
  readonly evidence?: readonly string[];
  readonly error?: string;
  readonly observation?: unknown;
};

export function safeEvidencePath(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error("evidence_absolute_path_forbidden");
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relativePath);
  const rest = relative(resolvedRoot, resolvedPath);
  if (!rest || rest.startsWith("..") || isAbsolute(rest)) throw new Error("evidence_path_escape");
  return resolvedPath;
}

async function assertNoSymlink(path: string, stopAt: string) {
  let current = resolve(path);
  const root = resolve(stopAt);
  while (current === root || current.startsWith(`${root}/`)) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error("evidence_symlink_forbidden");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (current === root) break;
    current = dirname(current);
  }
}

export async function ensureEvidenceRoot(root: string): Promise<string> {
  const resolved = resolve(root);
  await mkdir(resolved, { recursive: true });
  await assertNoSymlink(resolved, resolved);
  return resolved;
}

export function redactEvidenceText(value: string): string {
  return JSON.stringify(redactValue(value)).slice(1, -1);
}

export async function appendTimeline(root: string, event: TimelineEvent): Promise<string> {
  const resolvedRoot = await ensureEvidenceRoot(root);
  const path = safeEvidencePath(resolvedRoot, "timeline.jsonl");
  await appendFile(path, `${JSON.stringify(redactValue({ ...event, target: summarizeTarget(event.target) }))}\n`, "utf8");
  return path;
}

export async function writeJsonEvidence(root: string, relativePath: string, value: unknown): Promise<string> {
  const resolvedRoot = await ensureEvidenceRoot(root);
  const path = safeEvidencePath(resolvedRoot, relativePath);
  await assertNoSymlink(dirname(path), resolvedRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(redactValue(value), null, 2)}\n`, "utf8");
  return path;
}

export async function readTail(path: string, maxBytes = 12000): Promise<string> {
  try {
    const value = await readFile(path, "utf8");
    return value.length > maxBytes ? value.slice(-maxBytes) : value;
  } catch {
    return "";
  }
}

export async function copySnapshot(root: string, stepId: string, snapshot: unknown): Promise<string> {
  return writeJsonEvidence(root, `${stepId}.snapshot.json`, snapshot);
}

export async function captureScreenshot(root: string, name: string, capture: (path: string) => Promise<void>): Promise<string> {
  const path = safeEvidencePath(await ensureEvidenceRoot(root), `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await capture(path);
  return path;
}

export async function writeFailureCard(root: string, card: Record<string, unknown>): Promise<string> {
  return writeJsonEvidence(root, "failure-card.json", card);
}

export async function writeManifest(root: string, manifest: Record<string, unknown>): Promise<string> {
  return writeJsonEvidence(root, "manifest.json", manifest);
}

export async function pathExists(path: string): Promise<boolean> {
  try { await realpath(path); return true; } catch { return false; }
}

export async function symlinkTarget(path: string): Promise<string | null> {
  try { return await readlink(path); } catch { return null; }
}
