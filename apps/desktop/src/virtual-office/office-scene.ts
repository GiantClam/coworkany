import { Application, Container, Graphics, Text } from "pixi.js";
import type { OfficeFrameMode, OfficeFramePolicy } from "./frame-policy";
import { createOfficeFramePolicy } from "./frame-policy";
import type {
  OfficeDeviceState,
  OfficeRoleAnchor,
  OfficeRoleId,
  OfficeRoleState,
  OfficeSnapshot,
  OfficeStatus,
  OfficeWorkItemKey,
} from "./types";
import { loadOfficeAssetManifest } from "./asset-registry";
import { OFFICE_ROLE_ORDER } from "./office-layout";
import {
  createOfficeBackgroundLayer,
  type OfficeBackgroundLayerHandle,
} from "./office-background-layer";
import {
  createOfficeDeskLayer,
  type OfficeDeskLayerHandle,
} from "./office-desk-layer";
import {
  createOfficeDisplayLayer,
  type OfficeDisplayLayerHandle,
} from "./office-display-layer";
import {
  createOfficeCharacterLayer,
  type OfficeCharacterLayerHandle,
} from "./office-character-layer";
import type { OfficeLayerHandle } from "./office-layer-types";

export interface OfficeSceneCallbacks {
  readonly onActivate: (key: OfficeWorkItemKey) => void;
  readonly onSelectRole: (roleId: OfficeRoleId, anchor: OfficeRoleAnchor) => void;
  readonly roleLabel: (roleId: OfficeRoleId) => string;
  readonly statusLabel: (status: OfficeStatus) => string;
  readonly onModeChange?: (mode: OfficeFrameMode) => void;
  readonly onError?: (error: unknown) => void;
}

export interface OfficeSceneHandle {
  readonly update: (snapshot: OfficeSnapshot) => void;
  readonly destroy: () => void;
}

const colors = {
  ink: 0x26362f,
  paper: 0xf8faf5,
  gold: 0xf0b64b,
  muted: 0x87938c,
  green: 0x41ae83,
  red: 0xd86b72,
  blue: 0x5aa9c9,
} as const;
const DEVICE_SLOT_LIMIT = 3;

export function getOfficeDeviceSlots(state: Pick<OfficeRoleState, "devices" | "overflowCount">): { readonly devices: readonly OfficeDeviceState[]; readonly overflowCount: number } {
  return { devices: state.devices.slice(0, DEVICE_SLOT_LIMIT), overflowCount: state.overflowCount };
}

function statusColor(status: OfficeStatus): number {
  if (status === "running" || status === "waiting" || status === "queued") return colors.gold;
  if (status === "failed" || status === "cancelled" || status === "unknown") return colors.red;
  if (status === "completed") return colors.green;
  return colors.muted;
}

interface OfficeDeviceNode {
  readonly root: Container;
  readonly marker: Graphics;
  readonly label: Text;
  device?: OfficeDeviceState;
}

interface OfficeRoleNode {
  readonly root: Container;
  readonly hit: Graphics;
  readonly label: Text;
  readonly devices: readonly OfficeDeviceNode[];
  readonly overflow: Text;
  anchor: OfficeRoleAnchor;
}

function viewportSize(container: HTMLElement, app: Application): { readonly width: number; readonly height: number } {
  const screen = app.screen;
  return {
    width: Math.max(1, container.clientWidth || screen.width || 1),
    height: Math.max(1, container.clientHeight || screen.height || 1),
  };
}

/**
 * Mount the Pixi enhancement around the approved independent layers.  The
 * React surface remains the source of truth and is still able to take over if
 * any required texture layer fails to load.
 */
export async function mountOfficeScene(container: HTMLElement, snapshot: OfficeSnapshot, callbacks: OfficeSceneCallbacks): Promise<OfficeSceneHandle> {
  const manifest = await loadOfficeAssetManifest();
  const app = new Application();
  await app.init({
    resizeTo: container,
    antialias: true,
    backgroundAlpha: 0,
    autoDensity: true,
    resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
  });
  app.canvas.setAttribute("aria-hidden", "true");
  app.canvas.className = "virtual-office-scene__canvas";
  // The layer factories load independent textures sequentially. Keep the
  // decorative canvas hidden until every approved layer has been created and
  // the first complete snapshot has been rendered; otherwise a slow display
  // decode briefly exposes a misleading half-built studio.
  app.canvas.style.visibility = "hidden";
  container.appendChild(app.canvas);

  const root = new Container();
  root.label = "virtual-office-root";
  root.sortableChildren = true;
  app.stage.addChild(root);
  const backdrop = new Graphics();
  backdrop.label = "virtual-office-backdrop";
  backdrop.zIndex = -100;
  root.addChild(backdrop);

  // Keep the object mutable for the frame policy while exposing the narrower
  // readonly structural contract to each independent layer.
  const layerContext = {
    app,
    root,
    manifest,
    callbacks,
    reducedMotion: false,
  };

  let background: OfficeBackgroundLayerHandle;
  let desk: OfficeDeskLayerHandle;
  let character: OfficeCharacterLayerHandle;
  let display: OfficeDisplayLayerHandle;
  const layers: OfficeLayerHandle[] = [];
  try {
    background = await createOfficeBackgroundLayer(layerContext);
    layers.push(background);
    desk = await createOfficeDeskLayer(layerContext);
    layers.push(desk);
    character = await createOfficeCharacterLayer(layerContext);
    layers.push(character);
    display = await createOfficeDisplayLayer(layerContext);
    layers.push(display);
  } catch (error) {
    for (const layer of layers.reverse()) layer.destroy();
    app.destroy(true, { children: true, texture: false, textureSource: false });
    throw error;
  }

  const interactionRoot = new Container();
  interactionRoot.label = "virtual-office-interactions";
  interactionRoot.zIndex = 60;
  root.addChild(interactionRoot);

  let destroyed = false;
  let reportedError = false;
  let policy: OfficeFramePolicy | undefined;
  const reportError = (error: unknown) => {
    if (destroyed || reportedError) return;
    reportedError = true;
    callbacks.onError?.(error);
  };
  const guarded = (operation: () => void) => {
    try {
      operation();
    } catch (error) {
      reportError(error);
    }
  };

  const roleNodes = new Map<OfficeRoleId, OfficeRoleNode>();
  const createRoleNode = (roleId: OfficeRoleId, index: number): OfficeRoleNode => {
    const roleRoot = new Container();
    roleRoot.label = `virtual-office-interaction:${roleId}`;
    roleRoot.zIndex = index;

    const hit = new Graphics();
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointertap", () => guarded(() => {
      policy?.markActivity();
      const node = roleNodes.get(roleId);
      callbacks.onSelectRole(roleId, node?.anchor ?? { x: 0, y: 0 });
    }));
    roleRoot.addChild(hit);

    const label = new Text({
      text: callbacks.roleLabel(roleId),
      style: { fill: colors.ink, fontSize: 10, fontFamily: "IBM Plex Sans, sans-serif", align: "center" },
    });
    label.anchor.set(0.5, 0);
    roleRoot.addChild(label);

    const devices = Array.from({ length: DEVICE_SLOT_LIMIT }, (_, deviceIndex) => {
      const deviceRoot = new Container();
      const marker = new Graphics();
      deviceRoot.addChild(marker);
      const deviceLabel = new Text({ text: "", style: { fill: colors.ink, fontSize: 8, fontFamily: "IBM Plex Sans, sans-serif", align: "center" } });
      deviceLabel.anchor.set(0.5, 0);
      deviceLabel.position.set(0, 8);
      deviceRoot.addChild(deviceLabel);
      deviceRoot.eventMode = "static";
      deviceRoot.cursor = "pointer";
      deviceRoot.on("pointertap", (event) => guarded(() => {
        event.stopPropagation();
        policy?.markActivity();
        const device = roleNodes.get(roleId)?.devices[deviceIndex]?.device;
        if (device) callbacks.onActivate(device.workItemKey);
      }));
      roleRoot.addChild(deviceRoot);
      return { root: deviceRoot, marker, label: deviceLabel };
    });

    const overflow = new Text({ text: "", style: { fill: colors.muted, fontSize: 9, fontFamily: "IBM Plex Sans, sans-serif", align: "center" } });
    overflow.anchor.set(0.5, 0);
    roleRoot.addChild(overflow);
    const node: OfficeRoleNode = { root: roleRoot, hit, label, devices, overflow, anchor: { x: 0, y: 0 } };
    roleNodes.set(roleId, node);
    interactionRoot.addChild(roleRoot);
    return node;
  };
  for (const [index, roleId] of OFFICE_ROLE_ORDER.entries()) createRoleNode(roleId, index);

  let latestSnapshot = snapshot;
  let canvasRevealed = false;
  const revealWhenReady = (next: OfficeSnapshot) => {
    // The projected office always has the stable seven-role list once the
    // store has hydrated. If the first async snapshot is empty, keep the
    // decorative canvas hidden and let the semantic React fallback lead until
    // a complete role snapshot arrives.
    if (!canvasRevealed && next.roles.length > 0) {
      canvasRevealed = true;
      app.canvas.style.visibility = "visible";
    }
  };
  const renderOverlay = (next: OfficeSnapshot) => {
    const rolesById = new Map(next.roles.map((role) => [role.roleId, role]));
    const anchors = background.anchors;
    for (const roleId of OFFICE_ROLE_ORDER) {
      const state = rolesById.get(roleId);
      const node = roleNodes.get(roleId);
      if (!node) continue;
      node.root.visible = Boolean(state);
      if (!state) continue;
      const anchor = anchors.get(roleId) ?? { x: 0, y: 0 };
      node.anchor = anchor;
      node.root.position.set(anchor.x, anchor.y);
      const hitRadius = Math.max(22, Math.min(58, (viewportSize(container, app).width / OFFICE_ROLE_ORDER.length) * 0.42));
      node.hit.clear().roundRect(-hitRadius, -hitRadius * 1.25, hitRadius * 2, hitRadius * 1.25, 12).fill({ color: colors.gold, alpha: 0.001 });
      node.label.position.set(0, 8);
      node.label.text = callbacks.roleLabel(roleId);
      const slots = getOfficeDeviceSlots(state);
      slots.devices.forEach((device, deviceIndex) => {
        const deviceNode = node.devices[deviceIndex];
        if (!deviceNode) return;
        deviceNode.device = device;
        deviceNode.root.visible = true;
        deviceNode.root.position.set((deviceIndex - (slots.devices.length - 1) / 2) * 34, 25);
        deviceNode.marker.clear().circle(0, 0, 7).fill({ color: statusColor(device.visualStatus), alpha: 0.92 });
        deviceNode.label.text = callbacks.statusLabel(device.visualStatus);
      });
      for (let deviceIndex = slots.devices.length; deviceIndex < node.devices.length; deviceIndex += 1) {
        const deviceNode = node.devices[deviceIndex];
        if (deviceNode) {
          deviceNode.device = undefined;
          deviceNode.root.visible = false;
        }
      }
      node.overflow.text = slots.overflowCount > 0 ? `+${slots.overflowCount}` : "";
      node.overflow.visible = slots.overflowCount > 0;
      node.overflow.position.set(0, 45);
    }
  };

  const render = (next: OfficeSnapshot) => {
    background.update(next);
    desk.update(next);
    character.update(next);
    display.update(next);
    renderOverlay(next);
    revealWhenReady(next);
  };

  const renderOnceIfStopped = () => {
    const mode = policy?.getMode();
    if (mode === "hidden" || mode === "reduced-motion") app.renderer.render(app.stage);
  };

  const resize = () => guarded(() => {
    const { width, height } = viewportSize(container, app);
    backdrop.clear().roundRect(0, 0, width, height, 18).fill({ color: colors.paper, alpha: 0.96 });
    render(latestSnapshot);
    renderOnceIfStopped();
  });

  const applyFrameMode = (mode: OfficeFrameMode) => guarded(() => {
    const reduced = mode === "reduced-motion";
    layerContext.reducedMotion = reduced;
    background.setReducedMotion?.(reduced);
    desk.setReducedMotion?.(reduced);
    character.setReducedMotion?.(reduced);
    display.setReducedMotion?.(reduced);
    callbacks.onModeChange?.(mode);
    if (mode === "hidden" || mode === "reduced-motion") {
      app.ticker.stop();
      render(latestSnapshot);
      app.renderer.render(app.stage);
    } else {
      app.ticker.maxFPS = mode === "idle" ? 15 : 30;
      app.ticker.start();
    }
  });

  policy = createOfficeFramePolicy({ onModeChange: applyFrameMode });
  app.ticker.stop();
  app.ticker.maxFPS = 30;
  app.ticker.add(() => guarded(() => {
    const mode = policy?.getMode();
    if (mode === "hidden" || mode === "reduced-motion") return;
    // Only the character layer needs a per-frame tick; desks/displays are
    // updated on snapshots and remain deterministic under idle throttling.
    character.update(latestSnapshot);
  }));

  const userActivity = () => guarded(() => policy?.markActivity());
  document.addEventListener("pointerdown", userActivity, { passive: true });
  document.addEventListener("keydown", userActivity);
  const visibilityListener = () => guarded(() => policy?.setVisible(document.visibilityState !== "hidden"));
  document.addEventListener("visibilitychange", visibilityListener);
  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const motionListener = (event: MediaQueryListEvent) => guarded(() => policy?.setReducedMotion(event.matches));
  motionQuery?.addEventListener("change", motionListener);

  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
  resizeObserver?.observe(container);
  if (!resizeObserver) globalThis.addEventListener?.("resize", resize);
  visibilityListener();
  policy.setReducedMotion(Boolean(motionQuery?.matches));
  resize();
  render(latestSnapshot);
  // Submit one complete frame before the ticker takes over. This avoids a
  // browser-specific first-paint gap where the independently loaded display
  // textures exist but do not become visible until the next user repaint.
  app.renderer.render(app.stage);
  policy.start();

  return {
    update(next) {
      guarded(() => {
        latestSnapshot = next;
        render(next);
        renderOnceIfStopped();
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      policy?.stop();
      resizeObserver?.disconnect();
      if (!resizeObserver) globalThis.removeEventListener?.("resize", resize);
      document.removeEventListener("visibilitychange", visibilityListener);
      document.removeEventListener("pointerdown", userActivity);
      document.removeEventListener("keydown", userActivity);
      motionQuery?.removeEventListener("change", motionListener);
      interactionRoot.destroy({ children: true });
      for (const layer of layers.reverse()) layer.destroy();
      app.destroy(true, { children: true, texture: false, textureSource: false });
    },
  };
}
