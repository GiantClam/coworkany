import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const ROLE_IDS = Object.freeze([
  "ai-chat",
  "agent-center",
  "ppt-expert",
  "workflow-operator",
  "writer",
  "image-creator",
  "video-producer",
]);

const CLIP_NAMES = Object.freeze(["idle", "walk", "work", "thinking", "waiting", "completed", "error"]);
const STATE_NAMES = Object.freeze(["available", "active", "offline"]);
const CHARACTER_BANDS = Object.freeze([
  [0, 315],
  [315, 315],
  [630, 315],
  [945, 315],
  [1260, 315],
  [1575, 315],
  [1890, 313],
]);
const SOURCE_SPECS = Object.freeze([
  ["complete-studio-background-v1.png", 2172, 724],
  ["characters-v1.png", 2203, 714],
  ["desk-state-variants-v1.png", 2172, 724],
  ["display-source-art-v1.png", 1536, 1024],
  ["character-ai-chat-turnaround-v1.png", 1536, 1024],
  ["character-agent-center-turnaround-v1.png", 1536, 1024],
  ["character-ppt-expert-turnaround-v1.png", 1536, 1024],
  ["character-workflow-operator-turnaround-v1.png", 1536, 1024],
  ["character-writer-turnaround-v1.png", 1536, 1024],
  ["character-image-creator-turnaround-v1.png", 1536, 1024],
  ["character-video-producer-turnaround-v1.png", 1536, 1024],
]);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const DEFAULT_SOURCE_DIR = resolve(REPO_ROOT, "docs/superpowers/assets/drafts/2026-10-10-virtual-studio");
const DEFAULT_OUTPUT_DIR = resolve(SCRIPT_DIR, "../public/virtual-office/v1");

function sourcePath(sourceDir, fileName) {
  return resolve(sourceDir, fileName);
}

function outputPath(outputDir, fileName) {
  return resolve(outputDir, fileName);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inputError(message) {
  return new Error(`virtual office asset input: ${message}`);
}

async function inspectApprovedImage(sourceDir, fileName, expectedWidth, expectedHeight) {
  const filePath = sourcePath(sourceDir, fileName);
  let metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch (cause) {
    throw inputError(`missing approved input ${fileName}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    throw inputError(`unexpected source dimension for ${fileName}: expected ${expectedWidth}x${expectedHeight}, got ${metadata.width ?? "?"}x${metadata.height ?? "?"}`);
  }
  if (metadata.channels !== 4 || metadata.hasAlpha !== true) {
    throw inputError(`approved input ${fileName} must be RGBA (channels=4 with alpha)`);
  }
  return { fileName, filePath, metadata };
}

async function readApprovedSourceSet(sourceDir) {
  const images = [];
  for (const [fileName, width, height] of SOURCE_SPECS) images.push(await inspectApprovedImage(sourceDir, fileName, width, height));

  const rigFileName = "rig-animation-data-v1.json";
  const rigPath = sourcePath(sourceDir, rigFileName);
  let rigBytes;
  try {
    rigBytes = await readFile(rigPath);
  } catch (cause) {
    throw inputError(`missing approved input ${rigFileName}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  let rig;
  try {
    rig = JSON.parse(rigBytes.toString("utf8"));
  } catch (cause) {
    throw inputError(`invalid JSON in ${rigFileName}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const boneNames = rig?.bones?.map((bone) => bone?.name);
  if (JSON.stringify(boneNames) !== JSON.stringify(["root", "torso", "head", "arm.l", "arm.r", "hand.l", "hand.r", "prop"])) {
    throw inputError(`${rigFileName} has unexpected bone names`);
  }
  const clipNames = Object.keys(rig?.clips ?? {});
  if (JSON.stringify(clipNames) !== JSON.stringify(CLIP_NAMES)) throw inputError(`${rigFileName} has unexpected clip names`);
  return { images, rigBytes, rig };
}

async function encodeLosslessWebp(input, destination) {
  await sharp(input).webp({ lossless: true, effort: 6 }).toFile(destination);
}

async function encodeLosslessWebpBuffer(buffer, destination) {
  await sharp(buffer).webp({ lossless: true, effort: 6 }).toFile(destination);
}

async function makeTransparentAtlas(width, height, composites, destination) {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ lossless: true, effort: 6 })
    .toFile(destination);
}

async function trimAndResize(buffer, width, height) {
  const result = await sharp(buffer)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .resize({ width, height, fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer({ resolveWithObject: true });
  return result;
}

async function buildCharacterAtlas(sourcePathname, destination) {
  const composites = [];
  for (const [roleIndex, [left, width]] of CHARACTER_BANDS.entries()) {
    const crop = await sharp(sourcePathname).extract({ left, top: 0, width, height: 714 }).png().toBuffer();
    const resized = await trimAndResize(crop, 112, 120);
    composites.push({
      input: resized.data,
      left: roleIndex * 128 + Math.floor((128 - resized.info.width) / 2),
      top: 128 - resized.info.height,
    });
  }
  await makeTransparentAtlas(896, 128, composites, destination);
}

async function extractDeskPart(sourcePathname, bandIndex, top, height) {
  const left = bandIndex * 724;
  return sharp(sourcePathname).extract({ left, top, width: 724, height }).png().toBuffer();
}

async function buildDeskAtlas(sourcePathname, destination, part) {
  const composites = [];
  const stateBuffers = [];
  for (let stateIndex = 0; stateIndex < STATE_NAMES.length; stateIndex += 1) {
    const source = await extractDeskPart(sourcePathname, stateIndex, part === "shell" ? 294 : 544, part === "shell" ? 430 : 180);
    stateBuffers.push(await trimAndResize(source, 124, 92));
  }
  for (let stateIndex = 0; stateIndex < STATE_NAMES.length; stateIndex += 1) {
    const resized = stateBuffers[stateIndex];
    for (let roleIndex = 0; roleIndex < ROLE_IDS.length; roleIndex += 1) {
      composites.push({
        input: resized.data,
        left: roleIndex * 128 + Math.floor((128 - resized.info.width) / 2),
        top: (stateIndex + 1) * 96 - resized.info.height,
      });
    }
  }
  await makeTransparentAtlas(896, 288, composites, destination);
}

function characterRegions() {
  return ROLE_IDS.map((roleId, index) => ({ roleId, x: index * 128, y: 0, width: 128, height: 128 }));
}

function workstationRegions() {
  return STATE_NAMES.flatMap((state, stateIndex) => ROLE_IDS.map((roleId, roleIndex) => ({
    roleId,
    state,
    x: roleIndex * 128,
    y: stateIndex * 96,
    width: 128,
    height: 96,
  })));
}

function displayRegions() {
  return [
    { id: "main-front", x: 0, y: 0, width: 768, height: 512 },
    { id: "side-angle", x: 768, y: 0, width: 768, height: 512 },
    { id: "stand-front", x: 0, y: 512, width: 384, height: 512 },
    { id: "stand-side", x: 384, y: 512, width: 384, height: 512 },
    { id: "status-available", x: 768, y: 512, width: 256, height: 512 },
    { id: "status-active", x: 1024, y: 512, width: 256, height: 512 },
    { id: "status-offline", x: 1280, y: 512, width: 256, height: 512 },
  ];
}

async function hashedEntry(outputDir, entry) {
  const bytes = await readFile(outputPath(outputDir, entry.path));
  return { ...entry, sha256: sha256(bytes) };
}

/**
 * Convert the immutable approved PNG/JSON drafts into runtime WebP atlases.
 * The operation is deterministic and can target a temporary directory in tests.
 */
export async function buildVirtualOfficeAssets({ sourceDir = DEFAULT_SOURCE_DIR, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
  const resolvedSourceDir = isAbsolute(sourceDir) ? sourceDir : resolve(process.cwd(), sourceDir);
  const resolvedOutputDir = isAbsolute(outputDir) ? outputDir : resolve(process.cwd(), outputDir);
  const approved = await readApprovedSourceSet(resolvedSourceDir);
  await mkdir(resolvedOutputDir, { recursive: true });

  const sourceByName = new Map(approved.images.map((item) => [item.fileName, item.filePath]));
  const officePath = outputPath(resolvedOutputDir, "office.webp");
  const charactersPath = outputPath(resolvedOutputDir, "characters.webp");
  const workstationsPath = outputPath(resolvedOutputDir, "workstations.webp");
  const workstationsFrontPath = outputPath(resolvedOutputDir, "workstations-front.webp");
  const displaysPath = outputPath(resolvedOutputDir, "displays.webp");
  const rigPath = outputPath(resolvedOutputDir, "rig-animation-data.json");

  await encodeLosslessWebp(sourceByName.get("complete-studio-background-v1.png"), officePath);
  await buildCharacterAtlas(sourceByName.get("characters-v1.png"), charactersPath);
  await buildDeskAtlas(sourceByName.get("desk-state-variants-v1.png"), workstationsPath, "shell");
  await buildDeskAtlas(sourceByName.get("desk-state-variants-v1.png"), workstationsFrontPath, "front");
  await encodeLosslessWebp(sourceByName.get("display-source-art-v1.png"), displaysPath);
  await writeFile(rigPath, approved.rigBytes);

  const sourceInputs = [];
  for (const image of approved.images) sourceInputs.push({ path: image.fileName, width: image.metadata.width, height: image.metadata.height, sha256: sha256(await readFile(image.filePath)) });
  sourceInputs.push({ path: "rig-animation-data-v1.json", sha256: sha256(approved.rigBytes) });

  const assets = [];
  assets.push(await hashedEntry(resolvedOutputDir, {
    id: "office",
    path: "office.webp",
    purpose: "background",
    format: "webp",
    width: 2172,
    height: 724,
    hasAlpha: true,
    frames: ["background"],
    regions: [{ id: "background", x: 0, y: 0, width: 2172, height: 724 }],
  }));
  assets.push(await hashedEntry(resolvedOutputDir, {
    id: "characters",
    path: "characters.webp",
    purpose: "back-facing character skin atlas",
    format: "webp",
    width: 896,
    height: 128,
    hasAlpha: true,
    frames: ["back"],
    roleIds: [...ROLE_IDS],
    cell: { width: 128, height: 128 },
    regions: characterRegions(),
  }));
  for (const [id, purpose, path] of [
    ["workstations", "workstation shell atlas", "workstations.webp"],
    ["workstations-front", "workstation front-edge atlas", "workstations-front.webp"],
  ]) {
    assets.push(await hashedEntry(resolvedOutputDir, {
      id,
      path,
      purpose,
      format: "webp",
      width: 896,
      height: 288,
      hasAlpha: true,
      frames: [...STATE_NAMES],
      states: [...STATE_NAMES],
      roleIds: [...ROLE_IDS],
      cell: { width: 128, height: 96 },
      regions: workstationRegions(),
    }));
  }
  assets.push(await hashedEntry(resolvedOutputDir, {
    id: "displays",
    path: "displays.webp",
    purpose: "independent display and status-light source atlas",
    format: "webp",
    width: 1536,
    height: 1024,
    hasAlpha: true,
    frames: displayRegions().map((region) => region.id),
    regions: displayRegions(),
  }));
  assets.push(await hashedEntry(resolvedOutputDir, {
    id: "rig",
    path: "rig-animation-data.json",
    purpose: "normalized character skeleton and animation clips",
    format: "json",
    hasAlpha: false,
    frames: [...CLIP_NAMES],
    clips: [...CLIP_NAMES],
    bones: approved.rig.bones.map((bone) => bone.name),
    slots: approved.rig.slots.map((slot) => slot.name),
  }));

  const manifest = {
    schemaVersion: 1,
    sourceVersion: "2026-10-10-virtual-studio",
    roles: [...ROLE_IDS],
    roleIds: [...ROLE_IDS],
    clips: [...CLIP_NAMES],
    states: [...STATE_NAMES],
    sourceInputs,
    assets,
  };
  await writeFile(outputPath(resolvedOutputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function parseCliArgs(argv) {
  const args = { sourceDir: DEFAULT_SOURCE_DIR, outputDir: DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source-dir" && argv[index + 1]) args.sourceDir = resolve(argv[++index]);
    else if (arg === "--output-dir" && argv[index + 1]) args.outputDir = resolve(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/build-virtual-office-assets.mjs [--source-dir DIR] [--output-dir DIR]");
      return null;
    } else if (arg?.startsWith("-")) throw new Error(`unknown option: ${arg}`);
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    if (args) {
      const manifest = await buildVirtualOfficeAssets(args);
      console.log(`virtual office assets built: ${manifest.assets.map((asset) => asset.path).join(", ")}`);
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
