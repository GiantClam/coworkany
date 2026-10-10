import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { OfficeRoleId, OfficeRoleState, OfficeSnapshot, OfficeVisualState } from "./types";
import { OFFICE_ROLE_ORDER } from "./office-layout";
import {
  OFFICE_LAYER_Z,
  type OfficeCharacterLayerHandle,
  type OfficeCharacterLayerNode,
  type OfficeLayerContext,
  type OfficeRigEvaluationLike,
  type OfficeRigLike,
  type OfficeRigTrackValue,
  computeOfficeContainedBounds,
  computeOfficeLayerAnchors,
  destroyOfficeLayerContainer,
  findOfficeAssetEntry,
  getOfficeViewport,
  loadOfficeTexture,
  officeAssetUrl,
  reportOfficeLayerError,
} from "./office-layer-types";
import { createRoleTexture } from "./office-layer-assets";
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

function sourceOf(texture: Texture): import("pixi.js").TextureSource {
  return texture.source;
}
function officeBounds(context: OfficeLayerContext) {
  const viewport = getOfficeViewport(context);
  const office = findOfficeAssetEntry(context.manifest, "office");
  return computeOfficeContainedBounds(viewport, office?.width ?? viewport.width, office?.height ?? viewport.height);
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

/** The rig uses idle as the static skin for an unavailable/offline role. */
function rigClipForVisualState(state: OfficeVisualState): string {
  return state === "offline" ? "idle" : state;
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
    const character = new Sprite(createRoleTexture(sourceOf(sourceTexture), asset, roleId, roleIndex(roleId), undefined, 0));
    character.anchor.set(0.5, 1);
    const torso = boneMap.get("torso") ?? rigRoot;
    torso.addChild(character);
    layerRoot.addChild(roleRoot);
    boneMaps.set(roleId, boneMap);

    const roleStatusRoot = new Container();
    roleStatusRoot.label = `virtual-office-character-status:${roleId}`;
    roleStatusRoot.zIndex = index;
    const statusFx = new Graphics();
    roleStatusRoot.addChild(statusFx);
    statusRoot.addChild(roleStatusRoot);
    statusNodes.set(roleId, roleStatusRoot);
    nodes.set(roleId, { root: roleRoot, rigRoot, bones: boneMap, character, statusFx, roleId, visualState: "idle" });
  }

  let anchors = computeOfficeLayerAnchors(officeBounds(context));
  const now = context.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  let reducedMotionEnabled = context.reducedMotion === true;
  const reducedMotion = () => reducedMotionEnabled;
  const resize = () => {
    anchors = computeOfficeLayerAnchors(officeBounds(context));
    const viewport = getOfficeViewport(context);
    const maxWidth = Math.max(34, Math.min(86, (viewport.width / OFFICE_ROLE_ORDER.length) * 0.46));
    for (const roleId of OFFICE_ROLE_ORDER) {
      const node = nodes.get(roleId);
      const statusNode = statusNodes.get(roleId);
      if (!node || !statusNode) continue;
      const anchor = anchors.get(roleId) ?? { x: 0, y: 0 };
      const width = Math.max(1, node.character.texture.width || 128);
      const height = Math.max(1, node.character.texture.height || 128);
      const scale = Math.min(1, maxWidth / width);
      node.character.width = width * scale;
      node.character.height = height * scale;
      const characterHeight = node.character.height;
      node.root.position.set(anchor.x, anchor.y - characterHeight * 0.62);
      statusNode.position.set(anchor.x, anchor.y - characterHeight * 1.06);
    }
  };
  resize();

  const applyEvaluation = (roleId: OfficeRoleId, evaluation: OfficeRigEvaluationLike) => {
    const node = nodes.get(roleId);
    const bones = boneMaps.get(roleId);
    if (!node || !bones) return;
    const characterHeight = Math.max(1, node.character.height || 128);
    const tracks = evaluation.tracks ?? {};
    for (const boneDef of rigBones) {
      const bone = bones.get(boneDef.name);
      if (!bone) continue;
      const baseX = readNumber(boneDef.x);
      const baseY = readNumber(boneDef.y);
      const baseRotation = readNumber(boneDef.rotation);
      const track = tracks[boneDef.name];
      const x = baseX + readNumber(track?.x);
      const y = baseY + readNumber(track?.y);
      const rotation = baseRotation + readNumber(track?.rotation);
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
    const radius = Math.max(4, Math.min(9, node.character.width * 0.1));
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
      node.character.texture = texture;
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
        const walkElapsed = timestamp - (walkStartedAt.get(roleId) ?? timestamp);
        const transitionState = walkElapsed < OFFICE_WALK_DURATION_MS && base !== "offline" && !reducedMotion() ? "walk" : undefined;
        const nextState = transitionState ?? stateAtTime(state, previous, elapsed, reducedMotion(), index * 137);
        previousStates.set(roleId, nextState);
        node.visualState = nextState;
        const evaluator = context.rigEvaluator ?? loadedEvaluator;
        const evaluationElapsed = reducedMotion() ? 0 : elapsed;
        const clipName = rigClipForVisualState(nextState);
        const evaluation = evaluator?.evaluate ? evaluator.evaluate(clipName, evaluationElapsed, reducedMotion()) : evaluateRig(rig, clipName, evaluationElapsed, reducedMotion());
        applyEvaluation(roleId, evaluation);
        applyStatusFx(roleId, nextState);
      }
    },
    destroy() {
      destroyOfficeLayerContainer(layerRoot);
      destroyOfficeLayerContainer(statusRoot);
    },
  };
}
