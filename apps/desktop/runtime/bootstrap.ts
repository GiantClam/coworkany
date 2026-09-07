import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DesktopConfig } from "./config";
import type { DesktopPaths } from "./paths";
import { desktopPlatform } from "./platform";

const execFileAsync = promisify(execFile);
export type RuntimeSource = "system" | "private";
export type RuntimeComponent = "node" | "opencode" | "python" | "host" | "knowledge" | "fonts" | "skills" | "lancedb" | "embedding" | "migrations";

export interface RuntimeProbe {
  readonly component: RuntimeComponent;
  readonly ok: boolean;
  readonly source?: RuntimeSource;
  readonly executable?: string;
  readonly version?: string;
  readonly detail?: string;
}

export interface BootstrapManifest {
  readonly schemaVersion: 1;
  readonly source: RuntimeSource;
  readonly probes: readonly RuntimeProbe[];
  readonly checkedAt: string;
}

export const MANDATORY_RUNTIME_COMPONENTS: readonly RuntimeComponent[] = [
  "node",
  "opencode",
  "python",
  "host",
  "knowledge",
  "fonts",
  "skills",
  "lancedb",
  "embedding",
  "migrations",
];

export async function probeRuntime(paths: DesktopPaths, config: DesktopConfig): Promise<BootstrapManifest> {
  const probes: RuntimeProbe[] = [];
  const platform = desktopPlatform();
  probes.push(await probeExecutable("node", config.runtime.nodePath ?? (config.runtime.source === "private" ? join(paths.runtime, "node", platform.nodeExecutable) : "node")));
  probes.push(await probeExecutable("opencode", config.runtime.opencodePath ?? (config.runtime.source === "private" ? join(paths.runtime, "opencode", platform.openCodeExecutable) : "opencode")));
  probes.push(await probePython(config.runtime.pythonPath ?? (config.runtime.source === "private" ? join(paths.runtime, "python", platform.pythonExecutable) : platform.pythonExecutable)));
  probes.push(await probePath("host", config.runtime.hostPath ?? join(paths.runtime, "host.mjs")));
  probes.push(await probePath("knowledge", config.runtime.knowledgePath ?? join(paths.runtime, "knowledge.mjs")));
  probes.push(await probeFonts(config.runtime.fontsPath ?? join(paths.runtime, "fonts")));
  probes.push(await probeSkills(config.runtime.skillsPath ?? join(paths.runtime, "skills")));
  probes.push(await probeLanceDb(config.runtime.lancedbPath ?? join(paths.runtime, "lancedb")));
  probes.push(await probeEmbedding(config.runtime.embeddingPath ?? join(paths.runtime, "embedding")));
  probes.push(await probePath("migrations", paths.databaseFile));
  return { schemaVersion: 1, source: config.runtime.source, probes, checkedAt: new Date().toISOString() };
}

export function isRuntimeReady(manifest: BootstrapManifest) {
  return MANDATORY_RUNTIME_COMPONENTS.every((component) => manifest.probes.some((probe) => probe.component === component && probe.ok));
}

async function probePath(component: RuntimeComponent, path: string): Promise<RuntimeProbe> {
  try { await access(path, constants.F_OK); return { component, ok: true, source: "private", detail: basename(path) }; }
  catch { return { component, ok: false, source: "private", detail: `Missing ${resolve(path)}` }; }
}

async function probeFonts(path: string): Promise<RuntimeProbe> {
  return probePath("fonts", fontsAssetPath(path));
}

async function probeEmbedding(path: string): Promise<RuntimeProbe> {
  return probePath("embedding", embeddingDescriptorPath(path));
}

export function fontsAssetPath(path: string): string {
  return path.toLowerCase().endsWith(".ttc") || path.toLowerCase().endsWith(".ttf") || path.toLowerCase().endsWith(".otf") ? path : join(path, desktopPlatform().fontAsset);
}

export function embeddingDescriptorPath(path: string): string {
  return path.toLowerCase().endsWith(".json") ? path : join(path, "local-hash-384-v1.json");
}

async function probeSkills(path: string): Promise<RuntimeProbe> {
  try {
    await access(join(path, "ppt-master", "SKILL.md"), constants.F_OK);
    await access(join(path, "ppt-master.manifest.json"), constants.F_OK);
    return { component: "skills", ok: true, source: "private", detail: "canonical skills and ppt-master ready" };
  } catch (error) {
    return { component: "skills", ok: false, source: "private", detail: `Missing canonical Skill manifest: ${error instanceof Error ? error.message.slice(0, 120) : "probe failed"}` };
  }
}

async function probeLanceDb(path: string): Promise<RuntimeProbe> {
  const candidate = path.endsWith("index.js") ? path : join(path, "node_modules", "@lancedb", "lancedb", "dist", "index.js");
  return probePath("lancedb", candidate);
}

async function probeExecutable(component: RuntimeComponent, candidate: string): Promise<RuntimeProbe> {
  try {
    const result = await execFileAsync(candidate, ["--version"], { windowsHide: true, timeout: 5000, maxBuffer: 32 * 1024 });
    return { component, ok: true, source: candidate.includes("\\") || candidate.includes("/") ? "private" : "system", executable: candidate, version: `${result.stdout}${result.stderr}`.trim().slice(0, 160) };
  } catch (error) {
    return { component, ok: false, source: candidate.includes("\\") || candidate.includes("/") ? "private" : "system", executable: candidate, detail: error instanceof Error ? error.message.slice(0, 160) : "probe failed" };
  }
}

async function probePython(candidate: string): Promise<RuntimeProbe> {
  const version = await probeExecutable("python", candidate);
  if (!version.ok) return version;
  try {
    await execFileAsync(candidate, ["-c", "import pptx, xlsxwriter, pathops, uharfbuzz, fitz, mammoth, markdownify, ebooklib, nbconvert, openpyxl, PIL, numpy, requests, bs4, curl_cffi, edge_tts, flask, google.genai"], { windowsHide: true, timeout: 5000, maxBuffer: 32 * 1024 });
    return { ...version, detail: "ppt-master Python requirements ready" };
  } catch (error) {
    return { ...version, ok: false, detail: `python-pptx unavailable: ${error instanceof Error ? error.message.slice(0, 120) : "probe failed"}` };
  }
}

export async function readBootstrapManifest(paths: DesktopPaths): Promise<BootstrapManifest | null> {
  try { return JSON.parse(await readFile(join(paths.runtime, "bootstrap-manifest.json"), "utf8")) as BootstrapManifest; }
  catch { return null; }
}
