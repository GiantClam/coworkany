export type OfficeFrameMode = "active" | "idle" | "hidden" | "reduced-motion";

export interface OfficeFramePolicyOptions {
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly idleAfterMs?: number;
  readonly onModeChange?: (mode: OfficeFrameMode) => void;
}

export interface OfficeFramePolicy {
  readonly start: () => void;
  readonly stop: () => void;
  readonly markActivity: () => void;
  readonly setVisible: (visible: boolean) => void;
  readonly setReducedMotion: (reduced: boolean) => void;
  readonly getMode: () => OfficeFrameMode;
}

export function createOfficeFramePolicy(options: OfficeFramePolicyOptions = {}): OfficeFramePolicy {
  const now = options.now ?? (() => Date.now());
  const schedule = options.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const cancel = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
  const idleAfterMs = options.idleAfterMs ?? 30_000;
  let visible = true;
  let reducedMotion = false;
  let started = false;
  let lastActivity = now();
  let timer: unknown;
  let mode: OfficeFrameMode = "active";

  const nextMode = (): OfficeFrameMode => {
    if (!visible) return "hidden";
    if (reducedMotion) return "reduced-motion";
    return now() - lastActivity >= idleAfterMs ? "idle" : "active";
  };
  const update = () => {
    const next = nextMode();
    if (next !== mode) {
      mode = next;
      options.onModeChange?.(mode);
    }
  };
  const arm = () => {
    if (!started) return;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    if (!visible || reducedMotion) return;
    timer = schedule(() => {
      timer = undefined;
      update();
      arm();
    }, Math.max(250, idleAfterMs - Math.max(0, now() - lastActivity)));
  };

  return {
    start() {
      if (started) return;
      started = true;
      update();
      arm();
    },
    stop() {
      started = false;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
    markActivity() {
      lastActivity = now();
      update();
      arm();
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      update();
      arm();
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      update();
      arm();
    },
    getMode() {
      return mode;
    },
  };
}
