import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  OFFICE_RIG_BONE_NAMES,
  OFFICE_RIG_CLIP_NAMES,
  OFFICE_RIG_SLOT_NAMES,
  evaluateOfficeRigClip,
  interpolateOfficeRigTrack,
  resolveOfficeRigClip,
  validateOfficeRigManifest,
  type OfficeRigManifest,
} from "../src/virtual-office/character-rig";

async function readApprovedRig(): Promise<OfficeRigManifest> {
  const file = resolve("../../docs/superpowers/assets/drafts/2026-10-10-virtual-studio/rig-animation-data-v1.json");
  return validateOfficeRigManifest(JSON.parse(await readFile(file, "utf8")));
}

test("approved rig contains the eight bones and four slots in stable order", async () => {
  const rig = await readApprovedRig();
  assert.deepEqual(rig.bones.map((bone) => bone.name), [...OFFICE_RIG_BONE_NAMES]);
  assert.deepEqual(rig.slots.map((slot) => slot.name), [...OFFICE_RIG_SLOT_NAMES]);
  assert.deepEqual(rig.slots.map((slot) => slot.zIndex), [10, 20, 30, 40]);
  assert.equal(rig.slots.find((slot) => slot.name === "statusFx")?.blend, "additive");
});

test("approved rig exposes all seven animation clips with expected loop flags", async () => {
  const rig = await readApprovedRig();
  assert.deepEqual(Object.keys(rig.clips), [...OFFICE_RIG_CLIP_NAMES]);
  for (const name of ["idle", "work", "thinking", "waiting"]) {
    assert.equal(rig.clips[name].loop, true, `${name} should loop`);
    assert.ok(rig.clips[name].durationMs > 0);
  }
  for (const name of ["completed", "error"]) {
    assert.equal(rig.clips[name].loop, false, `${name} should be one-shot`);
  }
  assert.equal(rig.clips.walk.loop, true, "walk should loop in the approved source and be time-clamped by the renderer transition");
  assert.equal(rig.reducedMotion.disableStatusFx, true);
  assert.deepEqual(rig.reducedMotion.staticPoseByClip, {
    idle: "idle",
    walk: "idle",
    work: "work",
    thinking: "thinking",
    waiting: "waiting",
    completed: "completed",
    error: "error",
  });
});

test("rig validator rejects duplicate bones, unknown parents, and malformed clips", async () => {
  const rig = await readApprovedRig();
  assert.throws(() => validateOfficeRigManifest({ ...rig, bones: [...rig.bones, rig.bones[0]] }), /duplicate bone/u);
  assert.throws(() => validateOfficeRigManifest({ ...rig, bones: rig.bones.map((bone, index) => index === 1 ? { ...bone, parent: "missing" } : bone) }), /unknown parent/u);
  assert.throws(() => validateOfficeRigManifest({ ...rig, clips: { ...rig.clips, unknown: rig.clips.idle } }), /unknown clip/u);
  assert.throws(() => validateOfficeRigManifest({ ...rig, clips: { ...rig.clips, idle: { ...rig.clips.idle, durationMs: 0 } } }), /duration/u);
});

test("keyframe interpolation clamps and linearly blends sparse properties", () => {
  const track = [
    { t: 0, x: 0, rotation: 10, opacity: 0 },
    { t: 0.5, x: 10, rotation: 30 },
    { t: 1, x: 20, rotation: 50, opacity: 1 },
  ] as const;
  assert.deepEqual(interpolateOfficeRigTrack(track, -1), { x: 0, rotation: 10, opacity: 0 });
  assert.deepEqual(interpolateOfficeRigTrack(track, 0.25), { x: 5, rotation: 20, opacity: 0.25 });
  assert.deepEqual(interpolateOfficeRigTrack(track, 0.75), { x: 15, rotation: 40, opacity: 0.75 });
  assert.deepEqual(interpolateOfficeRigTrack(track, 2), { x: 20, rotation: 50, opacity: 1 });
});

test("clip evaluator returns normalized pose and reduced-motion fallback", async () => {
  const rig = await readApprovedRig();
  const atHalf = evaluateOfficeRigClip(rig, "work", 600);
  assert.ok(atHalf.t >= 0 && atHalf.t <= 1);
  assert.equal(atHalf.clip, "work");
  assert.equal(typeof atHalf.tracks.root?.y, "number");
  const reduced = resolveOfficeRigClip(rig, "walk", true);
  assert.equal(reduced.clip, "idle");
  assert.equal(reduced.loop, true);
  assert.equal(resolveOfficeRigClip(rig, "walk", false).clip, "walk");
});

test("clip evaluator is deterministic at cycle boundaries", async () => {
  const rig = await readApprovedRig();
  const clip = rig.clips.thinking;
  const first = evaluateOfficeRigClip(rig, "thinking", clip.durationMs + 123);
  const wrapped = evaluateOfficeRigClip(rig, "thinking", 123);
  assert.deepEqual(first, wrapped);
});
