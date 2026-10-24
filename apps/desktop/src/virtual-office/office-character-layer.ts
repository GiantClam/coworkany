import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { OfficeRoleId, OfficeRoleState, OfficeSnapshot, OfficeVisualState } from "./types";
import { OFFICE_ROLE_COLUMNS, OFFICE_ROLE_ORDER } from "./office-layout";
import {
  OFFICE_LAYER_Z,
  type OfficeCharacterLayerHandle,
  type OfficeCharacterLayerNode,
  type OfficeLayerContext,
  type OfficeRigEvaluationLike,
  type OfficeRigLike,
  type OfficeRigTrackValue,
  computeOfficeStageBounds,
  computeOfficeLayerAnchors,
  destroyOfficeLayerContainer,
  findOfficeAssetEntry,
  getOfficeViewport,
  loadOfficeTexture,
  officeAssetUrl,
  reportOfficeLayerError,
} from "./office-layer-types";
import { createRolePartTexture, roleCellRectangle } from "./office-layer-assets";
import { OFFICE_WALK_DURATION_MS, resolveOfficeVisualState, resolveOfficeWorkThinkingPhase } from "./visual-state";
import { createOfficeRigEvaluator, validateOfficeRigManifest, type OfficeRigEvaluator } from "./character-rig";

export type { OfficeCharacterLayerHandle, OfficeCharacterLayerNode, OfficeLayerContext, OfficeLayerHandle } from "./office-layer-types";

const BONE_NAMES = ["root", "torso", "head", "arm.l", "arm.r", "hand.l", "hand.r", "prop"] as const;
const DEFAULT_BONES: Readonly<Record<string, { parent: string | null; x: number; y: number; rotation: number }>> = {
  root: { parent: null, x: 0, y: 0, rotation: 0 },
  torso: { parent: "root", x: 0, y: -0.02, rotation: 0 },
  head: { parent: "torso", x: 0, y: -0.30, rotation: 0 },
  "arm.l": { parent: "torso", x: -0.16, y: -0.04, rotation: 8 },
  "arm.r": { parent: "torso", x: 0.16, y: -0.04, rotation: -8 },
  "hand.l": { parent: "arm.l", x: -0.08, y: 0.18, rotation: 4 },
  "hand.r": { parent: "arm.r", x: 0.08, y: 0.18, rotation: -4 },
  prop: { parent: "hand.r", x: 0.02, y: 0.05, rotation: 0 },
};

const STATE_COLORS: Readonly<Record<OfficeVisualState, number>> = {
  idle: 0x72b89a,
  walk: 0x63b9e8,
  work: 0x42c7b3,
  thinking: 0xb795e8,
  waiting: 0xf2b35a,
  completed: 0x62c98b,
  error: 0xe47878,
  offline: 0x9b9b9b,
};

/**
 * The source atlas is a standing turnaround, so the desk front provides the
 * seated silhouette. Keep this offset small enough that the front edge masks
 * the lower body instead of leaving the character floating above the desk.
 */
// Sink the hips into the chair seat/backrest contact zone so the character
// does not look separated from the furniture. The overlap is deliberately
// modest: the head remains fully readable above the foreground backrest.
export const OFFICE_SEATED_ROOT_Y_FACTOR = 0.16;
const OFFICE_WALK_PHASE_STEP_MS = 173;
const OFFICE_HEAD_PHASE_STEP_MS = 97;
const OFFICE_HEAD_SPRITE_Y_FACTOR = -0.14;

export interface OfficeCharacterMotionProfile {
  readonly walkDirection: -1 | 1;
  readonly phaseOffsetMs: number;
  readonly headPhaseOffsetMs: number;
}

/** Stable, renderer-only motion metadata derived from the approved role order. */
export function getOfficeCharacterMotionProfile(roleId: OfficeRoleId): OfficeCharacterMotionProfile {
  const index = Math.max(0, OFFICE_ROLE_ORDER.indexOf(roleId));
  return {
    walkDirection: index % 2 === 0 ? 1 : -1,
    phaseOffsetMs: index * OFFICE_WALK_PHASE_STEP_MS,
    headPhaseOffsetMs: index * OFFICE_HEAD_PHASE_STEP_MS,
  };
}

function sourceOf(texture: Texture): import("pixi.js").TextureSource {
  return texture.source;
}
function officeBounds(context: OfficeLayerContext) {
  const viewport = getOfficeViewport(context);
  return computeOfficeStageBounds(viewport);
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolateTrack(track: readonly { readonly t: number; readonly x?: number; readonly y?: number; readonly rotation?: number; readonly opacity?: number }[], normalizedTime: number): OfficeRigTrackValue {
  if (track.length === 0) return {};
  const sorted = [...track].sort((left, right) => left.t - right.t);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (normalizedTime <= first.t) return { x: first.x, y: first.y, rotation: first.rotation, opacity: first.opacity };
  if (normalizedTime >= last.t) return { x: last.x, y: last.y, rotation: last.rotation, opacity: last.opacity };
  const rightIndex = sorted.findIndex((frame) => frame.t >= normalizedTime);
  const right = sorted[Math.max(1, rightIndex)] ?? last;
  const left = sorted[Math.max(0, rightIndex - 1)] ?? first;
  const span = Math.max(0.000001, right.t - left.t);
  const mix = clamp((normalizedTime - left.t) / span, 0, 1);
  const lerp = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a === undefined && b === undefined) return undefined;
    return readNumber(a, readNumber(b, 0)) + (readNumber(b, readNumber(a, 0)) - readNumber(a, readNumber(b, 0))) * mix;
  };
  return { x: lerp(left.x, right.x), y: lerp(left.y, right.y), rotation: lerp(left.rotation, right.rotation), opacity: lerp(left.opacity, right.opacity) };
}

function evaluateRig(rig: OfficeRigLike | undefined, clipName: string, elapsedMs: number, reducedMotion: boolean): OfficeRigEvaluationLike {
  const clips = rig?.clips;
  if (!clips) return { clip: clipName, durationMs: 0, loop: true, t: 0, tracks: {} };
  const fallbackClip = rig?.reducedMotion?.staticPoseByClip?.[clipName];
  const selectedName = reducedMotion && fallbackClip ? fallbackClip : clipName;
  const clip = clips[selectedName] ?? clips[clipName];
  if (!clip) return { clip: selectedName, durationMs: 0, loop: true, t: 0, tracks: {} };
  const durationMs = Math.max(1, clip.durationMs);
  const effectiveElapsed = reducedMotion ? 0 : elapsedMs;
  const wrapped = clip.loop ? ((effectiveElapsed % durationMs) + durationMs) % durationMs : clamp(effectiveElapsed, 0, durationMs);
  const t = wrapped / durationMs;
  const tracks = Object.fromEntries(Object.entries(clip.tracks ?? {}).map(([name, track]) => [name, interpolateTrack(track, t)]));
  return { clip: selectedName, durationMs, loop: clip.loop, t, tracks };
}

async function loadRig(context: OfficeLayerContext): Promise<OfficeRigLike | undefined> {
  if (context.rig) return context.rig;
  const asset = findOfficeAssetEntry(context.manifest, "rig");
  if (!asset) return undefined;
  if (context.loadRig) return validateOfficeRigManifest(await context.loadRig(asset.path)) as unknown as OfficeRigLike;
  // Browser/Tauri hosts resolve the versioned relative URL; Node unit tests
  // intentionally skip the implicit fetch and can inject loadRig instead.
  if (typeof globalThis.fetch !== "function" || typeof (globalThis as { location?: unknown }).location === "undefined") return undefined;
  const response = await globalThis.fetch(officeAssetUrl(asset.path));
  if (!response.ok) throw new Error(`Virtual office rig request failed: ${response.status}`);
  return validateOfficeRigManifest(await response.json()) as unknown as OfficeRigLike;
}

function stateAtTime(state: OfficeRoleState, previous: OfficeVisualState | undefined, elapsedMs: number, reducedMotion: boolean, phaseOffset: number): OfficeVisualState {
  // `previous` is only a hint for the offline -> walk transition. Work and
  // thinking are a single deterministic cadence, so changing halves must not
  // reset the clip clock.
  const base = resolveOfficeVisualState(state, previous === "offline" ? previous : undefined);
  if (reducedMotion || base !== "work") return base;
  return resolveOfficeWorkThinkingPhase(elapsedMs, phaseOffset);
}

function headSwayAmplitude(visualState: OfficeVisualState): number {
  if (visualState === "thinking" || visualState === "waiting") return 4.2;
  if (visualState === "idle" || visualState === "work") return 2.6;
  if (visualState === "walk") return 1.8;
  return 0;
}

function headSwayRotation(visualState: OfficeVisualState, phaseMs: number, profile: OfficeCharacterMotionProfile, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const amplitude = headSwayAmplitude(visualState);
  if (amplitude === 0) return 0;
  const periodMs = visualState === "thinking" || visualState === "waiting" ? 1_800 : 2_600;
  return Math.sin(((phaseMs + profile.headPhaseOffsetMs) / periodMs) * Math.PI * 2) * amplitude;
}

/** The rig uses idle as the static skin for an unavailable/offline role. */
function rigClipForVisualState(state: OfficeVisualState): string {
  return state === "offline" ? "idle" : state;
}

function destroyDerivedTexture(texture: Texture | undefined): void {
  try {
    texture?.destroy(false);
  } catch {
    // A route transition may already have torn down the Pixi texture system.
  }
}

/** Render back-facing chibi characters with a normalized keyframe rig. */
export async function createOfficeCharacterLayer(context: OfficeLayerContext): Promise<OfficeCharacterLayerHandle> {
  const layerRoot = new Container();
  layerRoot.label = "virtual-office-characters";
  layerRoot.zIndex = OFFICE_LAYER_Z.character;
  const statusRoot = new Container();
  statusRoot.label = "virtual-office-character-status";
  statusRoot.zIndex = OFFICE_LAYER_Z.status;
  context.root.sortableChildren = true;
  context.root.addChild(layerRoot, statusRoot);

  const asset = findOfficeAssetEntry(context.manifest, "characters");
  if (!asset) {
    const error = new Error("Virtual office character asset is missing from the manifest");
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(statusRoot);
    throw error;
  }

  let sourceTexture: Texture | undefined;
  let rig: OfficeRigLike | undefined;
  let loadedEvaluator: OfficeRigEvaluator | undefined;
  try {
    sourceTexture = await loadOfficeTexture(context, asset.path);
    rig = await loadRig(context);
    if (rig && !context.rigEvaluator) {
      loadedEvaluator = createOfficeRigEvaluator(rig as unknown as Parameters<typeof createOfficeRigEvaluator>[0]);
    }
  } catch (error) {
    // Keep a static visual layer alive when only the optional rig JSON failed;
    // texture failures are fatal so the scene can activate its React fallback.
    if (!sourceTexture) {
      reportOfficeLayerError(context, error);
      destroyOfficeLayerContainer(layerRoot);
      destroyOfficeLayerContainer(statusRoot);
      throw error;
    }
  }
  if (!sourceTexture) {
    const error = new Error("Virtual office character texture could not be loaded");
    reportOfficeLayerError(context, error);
    destroyOfficeLayerContainer(layerRoot);
    destroyOfficeLayerContainer(statusRoot);
    throw error;
  }

  const nodes = new Map<OfficeRoleId, OfficeCharacterLayerNode>();
  const boneMaps = new Map<OfficeRoleId, Map<string, Container>>();
  const statusNodes = new Map<OfficeRoleId, Container>();
  const previousStates = new Map<OfficeRoleId, OfficeVisualState>();
  const baseStates = new Map<OfficeRoleId, OfficeVisualState>();
  const stateStartedAt = new Map<OfficeRoleId, number>();
  const walkStartedAt = new Map<OfficeRoleId, number>();
  const roleIndex = (roleId: OfficeRoleId) => Math.max(0, OFFICE_ROLE_ORDER.indexOf(roleId));
  const rigBones = rig?.bones ?? BONE_NAMES.map((name) => ({ name, ...DEFAULT_BONES[name]! }));

  for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) {
    const roleRoot = new Container();
    roleRoot.label = `virtual-office-character:${roleId}`;
    roleRoot.zIndex = index;
    const rigRoot = new Container();
    rigRoot.label = `virtual-office-rig:${roleId}`;
    roleRoot.addChild(rigRoot);
    const boneMap = new Map<string, Container>();
    for (const bone of rigBones) {
      const boneRoot = new Container();
      boneRoot.label = `bone:${bone.name}`;
      const parent = bone.parent ? boneMap.get(bone.parent) ?? rigRoot : rigRoot;
      parent.addChild(boneRoot);
      boneMap.set(bone.name, boneRoot);
    }
    const body = new Sprite(createRolePartTexture(sourceOf(sourceTexture), asset, roleId, roleIndex(roleId), "body", undefined, 0));
    const head = new Sprite(createRolePartTexture(sourceOf(sourceTexture), asset, roleId, roleIndex(roleId), "head", undefined, 0));
    body.anchor.set(0.5, 1);
    head.anchor.set(0.5, 1);
    const torso = boneMap.get("torso") ?? rigRoot;
    const headBone = boneMap.get("head") ?? torso;
    torso.addChild(body);
    headBone.addChild(head);
    layerRoot.addChild(roleRoot);
    boneMaps.set(roleId, boneMap);

    const roleStatusRoot = new Container();
    roleStatusRoot.label = `virtual-office-character-status:${roleId}`;
    roleStatusRoot.zIndex = index;
    const statusFx = new Graphics();
    roleStatusRoot.addChild(statusFx);
    statusRoot.addChild(roleStatusRoot);
    statusNodes.set(roleId, roleStatusRoot);
    nodes.set(roleId, {
      root: roleRoot,
      rigRoot,
      bones: boneMap,
      body,
      head,
      character: body,
      characterHeight: 128,
      statusFx,
      roleId,
      visualState: "idle",
    });
  }

  let anchors = computeOfficeLayerAnchors(officeBounds(context));
  const now = context.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  let reducedMotionEnabled = context.reducedMotion === true;
  const reducedMotion = () => reducedMotionEnabled;
  const resize = () => {
    anchors = computeOfficeLayerAnchors(officeBounds(context));
    const viewport = getOfficeViewport(context);
    // Size chibi figures against their responsive station width.
    const maxWidth = Math.max(30, Math.min(100, (viewport.width / OFFICE_ROLE_COLUMNS) * 0.54));
    for (const roleId of OFFICE_ROLE_ORDER) {
      const node = nodes.get(roleId);
      const statusNode = statusNodes.get(roleId);
      if (!node || !statusNode) continue;
      const anchor = anchors.get(roleId) ?? { x: 0, y: 0 };
      const cell = roleCellRectangle(asset, roleId, roleIndex(roleId), undefined, 0);
      const width = Math.max(1, cell?.width ?? node.body.texture.width ?? 128);
      const height = Math.max(1, cell?.height ?? 128);
      const scale = Math.min(1, maxWidth / width);
      node.body.width = Math.max(1, node.body.texture.width) * scale;
      node.body.height = Math.max(1, node.body.texture.height) * scale;
      node.head.width = Math.max(1, node.head.texture.width) * scale;
      node.head.height = Math.max(1, node.head.texture.height) * scale;
      node.characterHeight = height * scale;
      const characterHeight = node.characterHeight;
      node.head.position.set(0, characterHeight * OFFICE_HEAD_SPRITE_Y_FACTOR);
      // The approved source atlas contains full-body standing sprites.  Put
      // Their feet overlap the desk-front edge so the visible torso reads as
      // seated at the workstation instead of floating above it.
      node.root.position.set(anchor.x, anchor.y + characterHeight * OFFICE_SEATED_ROOT_Y_FACTOR);
      statusNode.position.set(anchor.x, anchor.y - characterHeight * 1.06);
    }
  };
  resize();

  const applyEvaluation = (
    roleId: OfficeRoleId,
    evaluation: OfficeRigEvaluationLike,
    visualState: OfficeVisualState,
    phaseMs: number,
    profile: OfficeCharacterMotionProfile,
  ) => {
    const node = nodes.get(roleId);
    const bones = boneMaps.get(roleId);
    if (!node || !bones) return;
    const characterHeight = Math.max(1, node.characterHeight || 128);
    const tracks = evaluation.tracks ?? {};
    for (const boneDef of rigBones) {
      const bone = bones.get(boneDef.name);
      if (!bone) continue;
      const baseX = readNumber(boneDef.x);
      const baseY = readNumber(boneDef.y);
      const baseRotation = readNumber(boneDef.rotation);
      const track = tracks[boneDef.name];
      const walkDirection = visualState === "walk" ? profile.walkDirection : 1;
      const x = baseX + readNumber(track?.x) * walkDirection;
      const y = baseY + readNumber(track?.y);
      const headSway = headSwayRotation(visualState, phaseMs, profile, reducedMotion());
      // The head sprite is now a distinct child of the head bone, so the
      // procedural sway remains independent of the torso/body sprite.
      const visibleSway = boneDef.name === "head" ? headSway : 0;
      const rotation = baseRotation + readNumber(track?.rotation) * walkDirection + visibleSway;
      bone.position.set(x * characterHeight, y * characterHeight);
      bone.rotation = rotation * (Math.PI / 180);
      if (boneDef.name === "root" && track?.opacity !== undefined) node.root.alpha = clamp(readNumber(track.opacity, 1), 0, 1);
    }
    const statusTrack = tracks.statusFx;
    if (statusTrack?.opacity !== undefined) {
      const statusNode = statusNodes.get(roleId);
      if (statusNode) statusNode.alpha = clamp(readNumber(statusTrack.opacity), 0, 1);
    }
  };

  const applyStatusFx = (roleId: OfficeRoleId, visualState: OfficeVisualState) => {
    const node = nodes.get(roleId);
    const statusNode = statusNodes.get(roleId);
    if (!node || !statusNode) return;
    const color = STATE_COLORS[visualState];
    const radius = Math.max(4, Math.min(9, node.body.width * 0.1));
    node.statusFx.clear().circle(0, 0, radius).fill({ color, alpha: visualState === "offline" ? 0.35 : 0.9 });
    statusNode.visible = !reducedMotion() && visualState !== "idle" && visualState !== "offline";
  };

  return {
    root: layerRoot,
    statusRoot,
    nodes,
    setReducedMotion(reduced) {
      reducedMotionEnabled = reduced;
    },
    setTexture(roleId, texture) {
      const node = nodes.get(roleId);
      if (!node) return;
      const roleIndexValue = roleIndex(roleId);
      const source = sourceOf(texture);
      const previousBody = node.body.texture;
      const previousHead = node.head.texture;
      node.body.texture = createRolePartTexture(source, asset, roleId, roleIndexValue, "body", undefined, 0);
      node.head.texture = createRolePartTexture(source, asset, roleId, roleIndexValue, "head", undefined, 0);
      destroyDerivedTexture(previousBody);
      destroyDerivedTexture(previousHead);
      resize();
    },
    update(snapshot: OfficeSnapshot) {
      resize();
      const timestamp = now();
      const stateByRole = new Map(snapshot.roles.map((state) => [state.roleId, state]));
      for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) {
        const node = nodes.get(roleId);
        if (!node) continue;
        const state = stateByRole.get(roleId);
        node.root.visible = Boolean(state);
        const statusNode = statusNodes.get(roleId);
        if (statusNode) statusNode.visible = Boolean(state) && !reducedMotion();
        if (!state) {
          previousStates.delete(roleId);
          baseStates.delete(roleId);
          stateStartedAt.delete(roleId);
          walkStartedAt.delete(roleId);
          continue;
        }
        const previous = previousStates.get(roleId);
        const motionProfile = getOfficeCharacterMotionProfile(roleId);
        const base = resolveOfficeVisualState(state, undefined);
        const priorBase = baseStates.get(roleId);
        if (priorBase !== base || !stateStartedAt.has(roleId)) {
          baseStates.set(roleId, base);
          stateStartedAt.set(roleId, timestamp);
        }
        const elapsed = timestamp - (stateStartedAt.get(roleId) ?? timestamp);
        if (previous === "offline" && base !== "offline" && !reducedMotion()) {
          if (!walkStartedAt.has(roleId)) walkStartedAt.set(roleId, timestamp);
        } else if (base === "offline" || reducedMotion()) {
          walkStartedAt.delete(roleId);
        }
        const walkStarted = walkStartedAt.get(roleId);
        const walkElapsed = walkStarted === undefined ? Number.POSITIVE_INFINITY : timestamp - walkStarted;
        const transitionState = walkStarted !== undefined && walkElapsed < OFFICE_WALK_DURATION_MS && base !== "offline" && !reducedMotion() ? "walk" : undefined;
        const nextState = transitionState ?? stateAtTime(state, previous, elapsed, reducedMotion(), motionProfile.phaseOffsetMs);
        previousStates.set(roleId, nextState);
        node.visualState = nextState;
        const evaluator = context.rigEvaluator ?? loadedEvaluator;
        const evaluationElapsed = reducedMotion() ? 0 : elapsed + motionProfile.phaseOffsetMs;
        const clipName = rigClipForVisualState(nextState);
        const evaluation = evaluator?.evaluate ? evaluator.evaluate(clipName, evaluationElapsed, reducedMotion()) : evaluateRig(rig, clipName, evaluationElapsed, reducedMotion());
        applyEvaluation(roleId, evaluation, nextState, timestamp, motionProfile);
        applyStatusFx(roleId, nextState);
      }
    },
    destroy() {
      for (const node of nodes.values()) {
        destroyDerivedTexture(node.body.texture);
        destroyDerivedTexture(node.head.texture);
      }
      destroyOfficeLayerContainer(layerRoot);
      destroyOfficeLayerContainer(statusRoot);
    },
  };
}
