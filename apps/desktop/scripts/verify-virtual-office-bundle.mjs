import { readdir, readFile } from "node:fs/promises";
import console from "node:console";
import process from "node:process";
import { resolve, dirname, join, normalize } from "node:path";
import { fileURLToPath, URL } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const staticImport = /(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+)["']([^"']+)["']/gu;

/** Stable root labels emitted by the renderer modules after Vite minification. */
export const OFFICE_RENDERER_MODULE_MARKERS = Object.freeze({
  background: "virtual-office-background",
  desk: "virtual-office-desk-back",
  chair: "virtual-office-chairs",
  display: "virtual-office-displays",
  character: "virtual-office-characters",
});

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function assetName(reference) {
  const path = reference.split("?", 1)[0].split("#", 1)[0];
  const normalized = path.startsWith("./") ? path.slice(2) : path;
  return normalized.startsWith("assets/") ? normalized.slice("assets/".length) : normalized;
}

export async function validateBundle({ distDir = dist, allowMissingManifest = false } = {}) {
  const assetsDir = resolve(distDir, "assets");
  const files = (await readdir(assetsDir)).filter((file) => file.endsWith(".js"));
  const contents = new Map(await Promise.all(files.map(async (file) => [file, await readFile(resolve(assetsDir, file), "utf8")])));
  const sceneFiles = [...contents].filter(([file]) => /^office-scene-[^/]+\.js$/u.test(file));
  const manifestPath = resolve(distDir, ".vite/manifest.json");
  let manifest;
  let manifestError;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) manifestError = "manifest_invalid";
  } catch (cause) {
    if (allowMissingManifest && cause?.code === "ENOENT") manifestError = undefined;
    else manifestError = cause?.code === "ENOENT" ? "manifest_missing" : "manifest_unreadable";
  }
  if (manifestError) return { ok: false, manifestError, staticHasPixi: false, dynamicHasPixi: false, entryMissing: true, missing: [], sceneFiles: sceneFiles.map(([file]) => file), staticFiles: [] };
  const entryFiles = new Set();
  const missing = [];
  const visit = (file) => {
    if (entryFiles.has(file)) return;
    entryFiles.add(file);
    const source = contents.get(file);
    if (!source) { missing.push(file); return; }
    for (const match of source.matchAll(staticImport)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const target = assetName(normalize(join(dirname(file), specifier)));
      if (target.endsWith(".js")) visit(target);
    }
  };
  if (manifest) {
    const entries = Object.values(manifest).filter((entry) => entry && entry.isEntry);
    for (const entry of entries) {
      visit(assetName(entry.file));
      for (const imported of entry.imports ?? []) visit(assetName(manifest[imported]?.file ?? imported));
    }
  } else {
    const html = await readFile(resolve(distDir, "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/gu)];
    for (const [, script] of scripts) visit(assetName(script));
  }
  const staticHasPixi = [...entryFiles].some((file) => /(?:from\s*["']pixi\.js|import\s*\(\s*["']pixi\.js|require\s*\(\s*["']pixi\.js|PixiJS|pixi\.js\/math)/u.test(contents.get(file) ?? ""));
  const dynamicHasPixi = sceneFiles.length > 0 && sceneFiles.some(([, source]) => /PixiJS|pixi\.js\/math|from\s*["']pixi\.js/u.test(source));
  const rendererModules = Object.fromEntries(Object.entries(OFFICE_RENDERER_MODULE_MARKERS).map(([name, marker]) => [name, sceneFiles.reduce((count, [, source]) => count + countOccurrences(source, marker), 0)]));
  const rendererModulesPresent = Object.values(rendererModules).every((count) => count === 1);
  const entryMissing = entryFiles.size === 0;
  return { ok: !staticHasPixi && dynamicHasPixi && rendererModulesPresent && missing.length === 0 && !entryMissing, staticHasPixi, dynamicHasPixi, rendererModulesPresent, rendererModules, entryMissing, missing, sceneFiles: sceneFiles.map(([file]) => file), staticFiles: [...entryFiles] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await validateBundle();
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`virtual-office bundle: static closure clean, dynamic Pixi scene present (${result.sceneFiles.join(", ")})`);
  }
}
