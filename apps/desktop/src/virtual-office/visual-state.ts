import type { OfficeRoleState, OfficeVisualState } from "./types";

// Re-export the renderer-facing union from this focused state module so scene
// consumers can depend on one import without reaching into the broad domain
// types file.
export type { OfficeVisualState } from "./types";

/**
 * The work/thinking cadence is deliberately fixed.  A fixed cadence keeps the
 * decorative animation deterministic in screenshots and in reduced test runs;
 * callers can add a stable per-role phase offset when they want desynchronised
 * characters without reading any business state in the renderer.
 */
export const OFFICE_WORK_THINKING_CYCLE_MS = 2_400;
export const OFFICE_WORK_PHASE_MS = 1_600;
export const OFFICE_WALK_DURATION_MS = 900;

export type OfficeVisualStateInput = Pick<OfficeRoleState, "status" | "available" | "activeCount" | "waitingUserCount">;

const terminalStates = new Set<OfficeVisualState>(["completed", "error", "offline"]);

function asNonNegativeFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function isUnavailable(state: OfficeVisualStateInput): boolean {
  return state.available === false || state.status === "offline";
}

function hasActiveWork(state: OfficeVisualStateInput): boolean {
  return asNonNegativeFinite(state.activeCount) > 0 || state.status === "queued" || state.status === "running";
}

/**
 * Map persisted role facts to one renderer state.
 *
 * Priority is intentional: availability and terminal/user-attention states
 * should never be hidden by a stale active count.  `previous` is only used for
 * two visual transitions: preserving thinking while work continues, and
 * emitting a single walk pose when an offline role comes back.
 */
export function resolveOfficeVisualState(
  state: OfficeVisualStateInput,
  previous?: OfficeVisualState,
): OfficeVisualState {
  if (isUnavailable(state)) return "offline";

  if (state.status === "failed" || state.status === "cancelled") return "error";
  if (state.status === "waiting" || asNonNegativeFinite(state.waitingUserCount) > 0) return "waiting";
  if (state.status === "completed") return "completed";

  // A walk is a one-shot transition.  Once a caller has observed it, the next
  // snapshot resolves to its ordinary state and cannot retrigger the clip.
  if (previous === "offline") return "walk";

  const active = hasActiveWork(state);
  const base: OfficeVisualState = active ? "work" : "idle";
  if (base === "work" && previous === "thinking") return "thinking";
  return base;
}

/** Return the deterministic work/thinking half of a cycle. */
export function resolveOfficeWorkThinkingPhase(phaseMs: number, phaseOffsetMs = 0): "work" | "thinking" {
  const cycle = OFFICE_WORK_THINKING_CYCLE_MS;
  const phase = ((asNonNegativeFinite(phaseMs) + phaseOffsetMs) % cycle + cycle) % cycle;
  return phase < OFFICE_WORK_PHASE_MS ? "work" : "thinking";
}

/**
 * Resolve a visual state at a deterministic animation time.  One-shot and
 * terminal states are kept intact; only active work alternates between work and
 * thinking.  `phaseOffsetMs` may be a stable role hash supplied by a caller.
 */
export function resolveOfficeVisualPhase(
  state: OfficeVisualStateInput,
  phaseMs: number,
  previous?: OfficeVisualState,
  phaseOffsetMs = 0,
): OfficeVisualState {
  const base = resolveOfficeVisualState(state, previous);
  if (base === "walk" || terminalStates.has(base) || base === "idle" || base === "waiting") return base;
  return resolveOfficeWorkThinkingPhase(phaseMs, phaseOffsetMs);
}

/** Alias with a time-oriented name for scene/animation consumers. */
export function resolveOfficeVisualStateAt(
  state: OfficeVisualStateInput,
  phaseMs: number,
  previous?: OfficeVisualState,
  phaseOffsetMs = 0,
): OfficeVisualState {
  return resolveOfficeVisualPhase(state, phaseMs, previous, phaseOffsetMs);
}

/**
 * Reduced-motion callers can retain the semantic state while skipping the
 * looping work/thinking cadence.  This helper intentionally does not mutate
 * persisted state.
 */
export function resolveOfficeVisualStateForMotion(
  state: OfficeVisualStateInput,
  options: { readonly reducedMotion?: boolean; readonly phaseMs?: number; readonly previous?: OfficeVisualState; readonly phaseOffsetMs?: number } = {},
): OfficeVisualState {
  const base = resolveOfficeVisualState(state, options.previous);
  if (options.reducedMotion !== false) return base;
  return resolveOfficeVisualPhase(state, options.phaseMs ?? 0, options.previous, options.phaseOffsetMs ?? 0);
}
