import { createHash } from "node:crypto";
import console from "node:console";
import process from "node:process";
import { readFile, realpath } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export const ASSET_ERROR_CODES = Object.freeze({
  missing: "asset_missing",
  pathEscape: "asset_path_escape",
  hashMismatch: "asset_hash_mismatch",
  framesEmpty: "asset_frames_empty",
  idInvalid: "asset_id_invalid",
  duplicateId: "asset_id_duplicate",
  budgetExceeded: "asset_budget_exceeded",
});

export const OFFICE_ASSET_GZIP_BUDGET_BYTES = 2_500_000;

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
    try {
      const realAssetPath = await realpath(assetPath);
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
    const dimensions = webpDimensions(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== asset.sha256 || !dimensions || dimensions.width !== asset.width || dimensions.height !== asset.height) errors.push(error(ASSET_ERROR_CODES.hashMismatch, `asset integrity mismatch: ${asset.path}`));
    gzipBytes += gzipSync(bytes).byteLength;
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
