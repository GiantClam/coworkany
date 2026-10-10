import type {
  OfficeRigBone,
  OfficeRigClip,
  OfficeRigKeyframe,
  OfficeRigManifest,
  OfficeRigSlot,
} from "./types";

export type {
  OfficeRigBone,
  OfficeRigClip,
  OfficeRigKeyframe,
  OfficeRigManifest,
  OfficeRigSlot,
} from "./types";

export const OFFICE_RIG_BONE_NAMES = [
  "root",
  "torso",
  "head",
  "arm.l",
  "arm.r",
  "hand.l",
  "hand.r",
  "prop",
] as const;

export const OFFICE_RIG_SLOT_NAMES = ["body", "head", "prop", "statusFx"] as const;

export const OFFICE_RIG_CLIP_NAMES = ["idle", "walk", "work", "thinking", "waiting", "completed", "error"] as const;

const expectedLoopByClip: Readonly<Record<(typeof OFFICE_RIG_CLIP_NAMES)[number], boolean>> = {
  idle: true,
  walk: true,
  work: true,
  thinking: true,
  waiting: true,
  completed: false,
  error: false,
};

const keyframeProperties = ["x", "y", "rotation", "opacity"] as const;
type KeyframeProperty = (typeof keyframeProperties)[number];

export interface OfficeRigPose {
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly opacity?: number;
}
export interface OfficeRigClipEvaluation {
  readonly clip: string;
  readonly t: number;
  readonly loop: boolean;
  readonly durationMs: number;
  readonly tracks: Readonly<Record<string, OfficeRigPose>>;
}

export interface OfficeRigPlayback {
  readonly clip: string;
  readonly loop: boolean;
  readonly durationMs: number;
  readonly tracks: Readonly<Record<string, readonly OfficeRigKeyframe[]>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`Virtual office rig manifest ${message}`);
}

function finiteNumber(value: unknown, label: string, options: { readonly min?: number; readonly max?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} is invalid`);
  if (options.min !== undefined && value < options.min) fail(`${label} is invalid`);
  if (options.max !== undefined && value > options.max) fail(`${label} is invalid`);
  return value;
}

function validateBone(value: unknown, index: number): OfficeRigBone {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim() === "") fail(`bone ${index} is invalid`);
  if (value.parent !== null && typeof value.parent !== "string") fail(`bone ${value.name} parent is invalid`);
  return {
    name: value.name,
    parent: value.parent as string | null,
    length: finiteNumber(value.length, `bone ${value.name} length`, { min: 0 }),
    x: finiteNumber(value.x, `bone ${value.name} x`),
    y: finiteNumber(value.y, `bone ${value.name} y`),
    rotation: finiteNumber(value.rotation, `bone ${value.name} rotation`),
  };
}

function validateSlot(value: unknown, index: number): OfficeRigSlot {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.trim() === "") fail(`slot ${index} is invalid`);
  if (typeof value.bone !== "string" || value.bone.trim() === "") fail(`slot ${value.name} bone is invalid`);
  if (typeof value.zIndex !== "number" || !Number.isInteger(value.zIndex)) fail(`slot ${value.name} zIndex is invalid`);
  if (value.blend !== "normal" && value.blend !== "additive") fail(`slot ${value.name} blend is invalid`);
  return { name: value.name, bone: value.bone, zIndex: value.zIndex, blend: value.blend };
}

function validateKeyframe(value: unknown, clipName: string, trackName: string, index: number): OfficeRigKeyframe {
  if (!isRecord(value)) fail(`clip ${clipName} track ${trackName} keyframe ${index} is invalid`);
  const keyframe: { t: number; x?: number; y?: number; rotation?: number; opacity?: number } = {
    t: finiteNumber(value.t, `clip ${clipName} track ${trackName} keyframe ${index} t`, { min: 0, max: 1 }),
  };
  for (const property of keyframeProperties) {
    if (value[property] === undefined) continue;
    keyframe[property] = finiteNumber(value[property], `clip ${clipName} track ${trackName} keyframe ${index} ${property}`, property === "opacity" ? { min: 0, max: 1 } : {});
  }
  if (Object.keys(keyframe).length === 1) fail(`clip ${clipName} track ${trackName} keyframe ${index} has no values`);
  return keyframe;
}

function validateClip(value: unknown, clipName: string, boneNames: ReadonlySet<string>, slotNames: ReadonlySet<string>): OfficeRigClip {
  if (!isRecord(value)) fail(`clip ${clipName} is invalid`);
  const durationMs = finiteNumber(value.durationMs, `clip ${clipName} duration`, { min: Number.MIN_VALUE });
  if (typeof value.loop !== "boolean") fail(`clip ${clipName} loop is invalid`);
  if (!isRecord(value.tracks)) fail(`clip ${clipName} tracks are invalid`);
  const tracks: Record<string, readonly OfficeRigKeyframe[]> = {};
  for (const [trackName, rawTrack] of Object.entries(value.tracks)) {
    if (!boneNames.has(trackName) && !slotNames.has(trackName)) fail(`clip ${clipName} references unknown track ${trackName}`);
    if (!Array.isArray(rawTrack) || rawTrack.length === 0) fail(`clip ${clipName} track ${trackName} is invalid`);
    const track = rawTrack.map((keyframe, index) => validateKeyframe(keyframe, clipName, trackName, index));
    for (let index = 1; index < track.length; index += 1) {
      if (track[index - 1].t > track[index].t) fail(`clip ${clipName} track ${trackName} keyframes are not sorted`);
    }
    tracks[trackName] = track;
  }
  if (Object.keys(tracks).length === 0) fail(`clip ${clipName} has no tracks`);
  return { durationMs, loop: value.loop, tracks };
}

function validateExactNames(actual: readonly string[], expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  const seen = new Set<string>();
  for (const name of actual) {
    if (seen.has(name)) fail(`duplicate ${label} ${name}`);
    seen.add(name);
    if (!expectedSet.has(name)) fail(`unknown ${label} ${name}`);
  }
  if (actual.length !== expected.length || expected.some((name) => !seen.has(name))) fail(`missing ${label}`);
}

/** Validate and normalize the approved, renderer-neutral rig JSON. */
export function validateOfficeRigManifest(value: unknown): OfficeRigManifest {
  if (!isRecord(value)) fail("is not an object");
  if (value.schemaVersion !== 1) fail("schemaVersion is invalid");
  if (!Array.isArray(value.bones)) fail("bones are invalid");
  if (!Array.isArray(value.slots)) fail("slots are invalid");
  if (!isRecord(value.textureRegions)) fail("textureRegions are invalid");
  if (!isRecord(value.clips)) fail("clips are invalid");
  if (!isRecord(value.reducedMotion)) fail("reducedMotion is invalid");

  const bones = value.bones.map(validateBone);
  validateExactNames(bones.map((bone) => bone.name), OFFICE_RIG_BONE_NAMES, "bone");
  const boneNames = new Set(bones.map((bone) => bone.name));
  if (bones.filter((bone) => bone.parent === null).length !== 1 || bones[0]?.parent !== null) fail("root bone is invalid");
  for (const bone of bones) if (bone.parent !== null && !boneNames.has(bone.parent)) fail(`bone ${bone.name} has unknown parent ${bone.parent}`);
  // Parent chains must terminate; this catches malformed cycles before a
  // renderer tries to construct transforms.
  for (const bone of bones) {
    const chain = new Set<string>();
    let current: OfficeRigBone | undefined = bone;
    while (current) {
      if (chain.has(current.name)) fail(`bone ${bone.name} has a parent cycle`);
      chain.add(current.name);
      current = current.parent === null ? undefined : bones.find((candidate) => candidate.name === current?.parent);
    }
  }

  const slots = value.slots.map(validateSlot);
  validateExactNames(slots.map((slot) => slot.name), OFFICE_RIG_SLOT_NAMES, "slot");
  const slotNames = new Set(slots.map((slot) => slot.name));
  for (const slot of slots) if (!boneNames.has(slot.bone)) fail(`slot ${slot.name} references unknown bone ${slot.bone}`);

  const textureRegions: Record<string, string> = {};
  for (const name of ["body", "head", "prop", "statusFx"]) {
    if (typeof value.textureRegions[name] !== "string" || value.textureRegions[name].trim() === "") fail(`texture region ${name} is invalid`);
    textureRegions[name] = value.textureRegions[name];
  }

  const clipNames = Object.keys(value.clips);
  validateExactNames(clipNames, OFFICE_RIG_CLIP_NAMES, "clip");
  const clips: Record<string, OfficeRigClip> = {};
  for (const name of OFFICE_RIG_CLIP_NAMES) {
    const clip = validateClip(value.clips[name], name, boneNames, slotNames);
    if (clip.loop !== expectedLoopByClip[name]) fail(`clip ${name} loop flag is invalid`);
    clips[name] = clip;
  }

  const reducedMotion = value.reducedMotion;
  if (typeof reducedMotion.disableStatusFx !== "boolean" || !isRecord(reducedMotion.staticPoseByClip)) fail("reducedMotion fields are invalid");
  const staticPoseByClip: Record<string, string> = {};
  for (const name of OFFICE_RIG_CLIP_NAMES) {
    const staticPose = reducedMotion.staticPoseByClip[name];
    if (typeof staticPose !== "string" || !Object.prototype.hasOwnProperty.call(clips, staticPose)) fail(`reducedMotion static pose ${name} is invalid`);
    staticPoseByClip[name] = staticPose;
  }
  if (Object.keys(reducedMotion.staticPoseByClip).some((name) => !Object.prototype.hasOwnProperty.call(clips, name))) fail("reducedMotion has an unknown static pose");

  return {
    schemaVersion: 1,
    ...(typeof value.assetId === "string" ? { assetId: value.assetId } : {}),
    ...(typeof value.sourcePreview === "string" ? { sourcePreview: value.sourcePreview } : {}),
    ...(isRecord(value.coordinateSystem) ? { coordinateSystem: Object.fromEntries(Object.entries(value.coordinateSystem).filter(([, item]) => typeof item === "string")) as Record<string, string> } : {}),
    bones,
    slots,
    textureRegions,
    clips,
    reducedMotion: {
      ...(typeof reducedMotion.enabledByDefaultWhen === "string" ? { enabledByDefaultWhen: reducedMotion.enabledByDefaultWhen } : {}),
      staticPoseByClip,
      disableStatusFx: reducedMotion.disableStatusFx,
    },
  };
}

function normalizedTime(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

function surroundingKeyframes(track: readonly OfficeRigKeyframe[], t: number, property: KeyframeProperty): { readonly before?: OfficeRigKeyframe; readonly after?: OfficeRigKeyframe } {
  let before: OfficeRigKeyframe | undefined;
  let after: OfficeRigKeyframe | undefined;
  for (const keyframe of track) {
    if (keyframe[property] === undefined) continue;
    if (keyframe.t <= t) before = keyframe;
    if (keyframe.t >= t) {
      after = keyframe;
      break;
    }
  }
  return { before, after };
}

/** Linearly interpolate a normalized keyframe track, preserving sparse values. */
export function interpolateOfficeRigTrack(track: readonly OfficeRigKeyframe[], t: number): OfficeRigPose {
  if (track.length === 0) return {};
  const at = normalizedTime(t);
  const pose: { x?: number; y?: number; rotation?: number; opacity?: number } = {};
  for (const property of keyframeProperties) {
    const { before, after } = surroundingKeyframes(track, at, property);
    const beforeValue = before?.[property];
    const afterValue = after?.[property];
    if (beforeValue === undefined && afterValue === undefined) continue;
    if (beforeValue === undefined) {
      pose[property] = afterValue;
      continue;
    }
    if (!before || afterValue === undefined || before === after || after === undefined || after.t <= before.t) {
      pose[property] = beforeValue;
      continue;
    }
    const ratio = (at - before.t) / (after.t - before.t);
    pose[property] = beforeValue + (afterValue - beforeValue) * Math.min(1, Math.max(0, ratio));
  }
  return pose;
}

function elapsedToNormalized(clip: OfficeRigClip, elapsedMs: number): number {
  const duration = clip.durationMs;
  if (!clip.loop) return normalizedTime(elapsedMs / duration);
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const wrapped = ((elapsed % duration) + duration) % duration;
  return wrapped / duration;
}

/** Evaluate every track at a deterministic elapsed time. */
export function evaluateOfficeRigClip(manifest: OfficeRigManifest, clipName: string, elapsedMs: number): OfficeRigClipEvaluation {
  const clip = manifest.clips[clipName];
  if (!clip) throw new Error(`Virtual office rig clip is unknown: ${clipName}`);
  const t = elapsedToNormalized(clip, elapsedMs);
  const tracks: Record<string, OfficeRigPose> = {};
  for (const [trackName, track] of Object.entries(clip.tracks)) tracks[trackName] = interpolateOfficeRigTrack(track, t);
  return { clip: clipName, t, loop: clip.loop, durationMs: clip.durationMs, tracks };
}

/** Resolve the clip actually played by a renderer, including reduced motion. */
export function resolveOfficeRigClip(manifest: OfficeRigManifest, clipName: string, reducedMotion = false): OfficeRigPlayback {
  const requested = manifest.clips[clipName];
  if (!requested) throw new Error(`Virtual office rig clip is unknown: ${clipName}`);
  const resolvedName = reducedMotion ? manifest.reducedMotion.staticPoseByClip[clipName] ?? "idle" : clipName;
  const clip = manifest.clips[resolvedName];
  if (!clip) throw new Error(`Virtual office rig reduced-motion clip is unknown: ${resolvedName}`);
  return { clip: resolvedName, loop: clip.loop, durationMs: clip.durationMs, tracks: clip.tracks };
}

export interface OfficeRigEvaluator {
  readonly manifest: OfficeRigManifest;
  evaluate(clipName: string, elapsedMs: number, reducedMotion?: boolean): OfficeRigClipEvaluation;
  playback(clipName: string, reducedMotion?: boolean): OfficeRigPlayback;
}

/** Small renderer-neutral evaluator factory; no Pixi or DOM dependencies. */
export function createOfficeRigEvaluator(manifest: OfficeRigManifest): OfficeRigEvaluator {
  return {
    manifest,
    evaluate(clipName, elapsedMs, reducedMotion = false) {
      const playback = resolveOfficeRigClip(manifest, clipName, reducedMotion);
      return evaluateOfficeRigClip(manifest, playback.clip, elapsedMs);
    },
    playback(clipName, reducedMotion = false) {
      return resolveOfficeRigClip(manifest, clipName, reducedMotion);
    },
  };
}
