import { createHash } from "node:crypto";

const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|authorization|secret|password|credential|cookie|private[_-]?key)/iu;
const PATH_KEY = /(?:path|file|directory|workspace|home|root|log|data)/iu;
const HOME_PATH = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)/gu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

export function redactValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (PATH_KEY.test(key) || value.startsWith("/Users/") || value.startsWith("/home/") || /^[A-Z]:\\Users\\/u.test(value)) return value.replace(HOME_PATH, "<USER_PATH>");
    return value.replace(/(Bearer\s+|sk-[A-Za-z0-9_-]{8,}|api[_-]?key[=:]\s*)[^\s,;]+/giu, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactValue(child, childKey)]));
  return value;
}

export function stableValue(value: unknown): unknown {
  return sortValue(redactValue(value));
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function digestValue(value: unknown): string {
  return sha256(stableJson(value));
}

export function expandRunId<T>(value: T, runId: string): T {
  const replace = (text: string) => text.replaceAll("${runId}", runId);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return replace(current);
    if (Array.isArray(current)) return current.map(visit);
    if (isRecord(current)) return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, visit(child)]));
    return current;
  };
  return visit(value) as T;
}

export function summarizeTarget(target: unknown): unknown {
  if (!isRecord(target)) return target;
  return Object.fromEntries(Object.entries(target).filter(([key]) => !["name", "value"].includes(key)).map(([key, value]) => [key, redactValue(value, key)]));
}

export function redactedPath(path: string, root?: string): string {
  if (root && path.startsWith(root)) return `<RUN_ROOT>${path.slice(root.length)}`;
  return path.replace(HOME_PATH, "<USER_PATH>");
}
