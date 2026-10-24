import { createHash } from "node:crypto";
import console from "node:console";
import process from "node:process";
import { readFile, realpath } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const ASSET_ERROR_CODES = Object.freeze({
  missing: "asset_missing",
  pathEscape: "asset_path_escape",
  hashMismatch: "asset_hash_mismatch",
  framesEmpty: "asset_frames_empty",
  formatInvalid: "asset_format_invalid",
  alphaInvalid: "asset_alpha_invalid",
  rigInvalid: "asset_rig_invalid",
  idInvalid: "asset_id_invalid",
  duplicateId: "asset_id_duplicate",
  budgetExceeded: "asset_budget_exceeded",
});

export const OFFICE_ASSET_GZIP_BUDGET_BYTES = 2_500_000;
export const OFFICE_RIG_CLIPS = Object.freeze(["idle", "walk", "work", "thinking", "waiting", "completed", "error"]);

function error(code, message) {
  return { code, message };
}

function webpDimensions(buffer) {
  if (buffer.length < 16 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (type === "VP8X" && payload + 10 <= buffer.length) {
      return { width: 1 + buffer[payload + 4] + (buffer[payload + 5] << 8) + (buffer[payload + 6] << 16), height: 1 + buffer[payload + 7] + (buffer[payload + 8] << 8) + (buffer[payload + 9] << 16) };
    }
    if (type === "VP8L" && payload + 5 <= buffer.length && buffer[payload] === 0x2f) {
      return { width: 1 + ((buffer[payload + 1] | (buffer[payload + 2] << 8)) & 0x3fff), height: 1 + (((buffer[payload + 2] >> 6) | (buffer[payload + 3] << 2) | (buffer[payload + 4] << 10)) & 0x3fff) };
    }
    offset = payload + size + (size & 1);
  }
  return null;
}

function isJsonAsset(asset) {
  return asset?.format === "json" || (typeof asset?.path === "string" && asset.path.toLowerCase().endsWith(".json"));
}

export async function validateManifest({ rootDir, manifestPath = resolve(rootDir, "manifest.json") }) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (cause) {
    return { ok: false, errors: [error(ASSET_ERROR_CODES.missing, `manifest: ${cause.message}`)], gzipBytes: 0 };
  }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    return { ok: false, errors: [error("asset_manifest_invalid", "manifest must contain schemaVersion: 1 and assets[]")], gzipBytes: 0 };
  }
  const root = resolve(rootDir);
  const realRoot = await realpath(root);
  const ids = new Set();
  const errors = [];
  const imageMetadata = new Map();
  const gzipMetadata = new Map();
  let gzipBytes = 0;
  for (const asset of manifest.assets) {
    const id = asset?.id;
    if (typeof id !== "string" || id.trim() === "") errors.push(error(ASSET_ERROR_CODES.idInvalid, "asset id must be a non-empty string"));
    else if (ids.has(id)) errors.push(error(ASSET_ERROR_CODES.duplicateId, `duplicate asset id: ${id}`));
    else ids.add(id);
    if (!Array.isArray(asset?.frames) || asset.frames.length === 0 || asset.frames.some((frame) => typeof frame !== "string") || new Set(asset.frames).size !== asset.frames.length) errors.push(error(ASSET_ERROR_CODES.framesEmpty, `asset frames are invalid: ${asset?.id ?? "<missing>"}`));
    if (typeof asset?.path !== "string") {
      errors.push(error(ASSET_ERROR_CODES.pathEscape, `asset path is invalid: ${asset?.id ?? "<missing>"}`));
      continue;
    }
    if (isAbsolute(asset.path) || win32.isAbsolute(asset.path)) {
      errors.push(error(ASSET_ERROR_CODES.pathEscape, `asset path escapes v1 directory: ${asset.path}`));
      continue;
    }
    const portablePath = asset.path.replaceAll("\\", "/");
    if (portablePath.split("/").includes("..")) {
      errors.push(error(ASSET_ERROR_CODES.pathEscape, `asset path escapes v1 directory: ${asset.path}`));
      continue;
    }
    const assetPath = resolve(root, portablePath);
    const escaped = relative(root, assetPath);
    if (isAbsolute(escaped) || escaped === ".." || escaped.split(/[\\/]/u).includes("..")) {
      errors.push(error(ASSET_ERROR_CODES.pathEscape, `asset path escapes v1 directory: ${asset.path}`));
      continue;
    }
    let bytes;
    let realAssetPath;
    try {
      realAssetPath = await realpath(assetPath);
      const realEscaped = relative(realRoot, realAssetPath);
      if (isAbsolute(realEscaped) || realEscaped === ".." || realEscaped.split(/[\\/]/u).includes("..")) {
        errors.push(error(ASSET_ERROR_CODES.pathEscape, `asset path escapes v1 directory: ${asset.path}`));
        continue;
      }
      bytes = await readFile(realAssetPath);
    } catch {
      errors.push(error(ASSET_ERROR_CODES.missing, `asset file missing: ${asset.path}`));
      continue;
    }
    // WebP dimensions can be read without decoding, while PNG (the approved
    // chair sprite) is decoded through sharp below.  Keep this nullable so a
    // malformed image still reports an integrity error instead of throwing.
    let dimensions = isJsonAsset(asset) || asset.format !== "webp" ? null : webpDimensions(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    let contentInvalid = false;
    let alphaInvalid = false;
    let rigInvalid = false;
    if (isJsonAsset(asset)) {
      if (asset.format !== "json") errors.push(error(ASSET_ERROR_CODES.formatInvalid, `JSON asset format is invalid: ${asset.path}`));
      try {
        const value = JSON.parse(bytes.toString("utf8"));
        if (asset.id === "rig") {
          const clips = value && typeof value === "object" && !Array.isArray(value) ? value.clips : undefined;
          const clipNames = clips && typeof clips === "object" && !Array.isArray(clips) ? Object.keys(clips) : [];
          const manifestClips = Array.isArray(asset.clips) ? asset.clips : asset.frames;
          const manifestClipsValid = manifestClips.length === OFFICE_RIG_CLIPS.length && OFFICE_RIG_CLIPS.every((clip, index) => manifestClips[index] === clip);
          rigInvalid = !manifestClipsValid || clipNames.length !== OFFICE_RIG_CLIPS.length || OFFICE_RIG_CLIPS.some((clip) => !clipNames.includes(clip));
        }
      } catch {
        contentInvalid = true;
      }
    } else {
      if (asset.format !== "webp" && asset.format !== "png") errors.push(error(ASSET_ERROR_CODES.formatInvalid, `image format is invalid: ${asset.path}`));
      if (asset.hasAlpha !== true) alphaInvalid = true;
      try {
        const cacheKey = realAssetPath;
        let metadata = imageMetadata.get(cacheKey);
        if (!metadata) {
          metadata = await sharp(bytes).metadata();
          imageMetadata.set(cacheKey, metadata);
        }
        if (!dimensions) dimensions = { width: metadata.width, height: metadata.height };
        contentInvalid = !dimensions || dimensions.width !== asset.width || dimensions.height !== asset.height;
        contentInvalid ||= metadata.format !== asset.format;
        alphaInvalid ||= metadata.hasAlpha !== true;
        contentInvalid ||= metadata.width !== asset.width || metadata.height !== asset.height;
      } catch {
        contentInvalid = true;
      }
    }
    if (hash !== asset.sha256 || contentInvalid) errors.push(error(ASSET_ERROR_CODES.hashMismatch, `asset integrity mismatch: ${asset.path}`));
    if (alphaInvalid) errors.push(error(ASSET_ERROR_CODES.alphaInvalid, `asset must be an RGBA/alpha-capable image: ${asset.path}`));
    if (rigInvalid) errors.push(error(ASSET_ERROR_CODES.rigInvalid, `rig clips are invalid: ${asset.path}`));
    let compressedBytes = gzipMetadata.get(hash);
    if (compressedBytes === undefined) {
      compressedBytes = gzipSync(bytes).byteLength;
      gzipMetadata.set(hash, compressedBytes);
    }
    gzipBytes += compressedBytes;
  }
  if (gzipBytes > OFFICE_ASSET_GZIP_BUDGET_BYTES) errors.push(error(ASSET_ERROR_CODES.budgetExceeded, `gzip budget exceeded: ${gzipBytes} > ${OFFICE_ASSET_GZIP_BUDGET_BYTES}`));
  return { ok: errors.length === 0, errors, gzipBytes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public/virtual-office/v1");
  const result = await validateManifest({ rootDir });
  if (process.argv.includes("--report-gzip-total")) console.log(`virtual-office assets gzip bytes: ${result.gzipBytes}`);
  if (!result.ok) {
    result.errors.forEach((item) => console.error(`${item.code}: ${item.message}`));
    process.exitCode = 1;
  } else console.log("virtual-office assets: ok");
}
