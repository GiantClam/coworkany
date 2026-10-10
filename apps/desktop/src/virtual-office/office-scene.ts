import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { OfficeFrameMode } from "./frame-policy";
import { createOfficeFramePolicy } from "./frame-policy";
import type { OfficeDeviceState, OfficeRoleAnchor, OfficeRoleId, OfficeRoleState, OfficeSnapshot, OfficeStatus, OfficeWorkItemKey } from "./types";
import { OFFICE_ATLAS_CELL, loadOfficeAssetManifest, officeAssetPath } from "./asset-registry";
import { OFFICE_ROLE_ORDER, officeRoleAnchorForLayout } from "./office-layout";

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

const colors = { ink: 0x171713, paper: 0xf8f8f2, gold: 0xffd000, muted: 0x85857a, green: 0x31a36a, red: 0xd4183d } as const;
const DEVICE_SLOT_LIMIT = 3;

export function getOfficeDeviceSlots(state: Pick<OfficeRoleState, "devices" | "overflowCount">): { readonly devices: readonly OfficeDeviceState[]; readonly overflowCount: number } {
  return { devices: state.devices.slice(0, DEVICE_SLOT_LIMIT), overflowCount: state.overflowCount };
}

function statusColor(status: OfficeSnapshot["roles"][number]["status"]): number {
  if (status === "running" || status === "waiting") return colors.gold;
  if (status === "failed" || status === "offline") return colors.red;
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
  readonly station: Sprite;
  readonly character: Sprite;
  readonly label: Text;
  readonly hit: Graphics;
  readonly devices: readonly OfficeDeviceNode[];
  readonly overflow: Text;
  anchor: OfficeRoleAnchor;
}

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
  container.appendChild(app.canvas);

  const root = new Container();
  app.stage.addChild(root);
  const backdrop = new Graphics();
  root.addChild(backdrop);
  let officeTexture: Texture | undefined;
  let characterTexture: Texture | undefined;
  let workstationTexture: Texture | undefined;
  try {
    [officeTexture, characterTexture, workstationTexture] = await Promise.all([
      Assets.load<Texture>(officeAssetPath(manifest.assets.find((asset) => asset.id === "office")!.path)),
      Assets.load<Texture>(officeAssetPath(manifest.assets.find((asset) => asset.id === "characters")!.path)),
      Assets.load<Texture>(officeAssetPath(manifest.assets.find((asset) => asset.id === "workstations")!.path)),
    ]);
  } catch (error) {
    app.destroy(true, { children: true, texture: false, textureSource: false });
    throw error;
  }

  const office = new Sprite(officeTexture);
  office.alpha = 0.28;
  root.addChild(office);
  const sceneLayer = new Container();
  root.addChild(sceneLayer);
  const characterFrames = Array.from({ length: 4 }, (_, row) => Array.from({ length: OFFICE_ROLE_ORDER.length }, (_, column) => new Texture({ source: characterTexture!.source, frame: new Rectangle(column * OFFICE_ATLAS_CELL.width, row * OFFICE_ATLAS_CELL.height, OFFICE_ATLAS_CELL.width, OFFICE_ATLAS_CELL.height) })));
  const workstationFrames = Array.from({ length: 3 }, (_, row) => Array.from({ length: OFFICE_ROLE_ORDER.length }, (_, column) => new Texture({ source: workstationTexture!.source, frame: new Rectangle(column * OFFICE_ATLAS_CELL.width, row * OFFICE_ATLAS_CELL.height, OFFICE_ATLAS_CELL.width, OFFICE_ATLAS_CELL.height) })));
  const roleNodes = new Map<OfficeRoleId, OfficeRoleNode>();
  const createRoleNode = (roleId: OfficeRoleId, index: number): OfficeRoleNode => {
    const roleRoot = new Container();
    const station = new Sprite(workstationFrames[0][index]);
    station.anchor.set(0.5, 1);
    roleRoot.addChild(station);
    const character = new Sprite(characterFrames[0][index]);
    character.anchor.set(0.5, 1);
    roleRoot.addChild(character);
    const label = new Text({ text: callbacks.roleLabel(roleId), style: { fill: colors.ink, fontSize: 11, fontFamily: "IBM Plex Sans, sans-serif" } });
    label.anchor.set(0.5, 0);
    roleRoot.addChild(label);
    const hit = new Graphics();
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointertap", () => guarded(() => {
      policy.markActivity();
      const node = roleNodes.get(roleId);
      callbacks.onSelectRole(roleId, node?.anchor ?? { x: 0, y: 0 });
    }));
    roleRoot.addChild(hit);
    const devices = Array.from({ length: DEVICE_SLOT_LIMIT }, (_, deviceIndex) => {
      const deviceRoot = new Container();
      const marker = new Graphics();
      deviceRoot.addChild(marker);
      const deviceLabel = new Text({ text: "", style: { fill: colors.ink, fontSize: 9, fontFamily: "IBM Plex Sans, sans-serif" } });
      deviceLabel.anchor.set(0.5, 0);
      deviceLabel.position.set(0, 11);
      deviceRoot.addChild(deviceLabel);
      deviceRoot.eventMode = "static";
      deviceRoot.cursor = "pointer";
      deviceRoot.on("pointertap", () => guarded(() => {
        const device = roleNodes.get(roleId)?.devices[deviceIndex]?.device;
        if (device) { policy.markActivity(); callbacks.onActivate(device.workItemKey); }
      }));
      roleRoot.addChild(deviceRoot);
      return { root: deviceRoot, marker, label: deviceLabel };
    });
    const overflow = new Text({ text: "", style: { fill: colors.muted, fontSize: 10, fontFamily: "IBM Plex Sans, sans-serif" } });
    overflow.anchor.set(0.5, 0);
    roleRoot.addChild(overflow);
    const node = { root: roleRoot, station, character, label, hit, devices, overflow, anchor: { x: 0, y: 0 } };
    roleNodes.set(roleId, node);
    sceneLayer.addChild(roleRoot);
    return node;
  };
  let destroyed = false;
  let reportedError = false;
  const reportError = (error: unknown) => {
    if (destroyed || reportedError) return;
    reportedError = true;
    callbacks.onError?.(error);
  };
  const guarded = (operation: () => void) => {
    try { operation(); } catch (error) { reportError(error); }
  };
  const applyFrameMode = (mode: OfficeFrameMode) => guarded(() => {
    callbacks.onModeChange?.(mode);
    if (mode === "hidden" || mode === "reduced-motion") {
      app.ticker.stop();
      app.renderer.render(app.stage);
    }
    else {
      app.ticker.maxFPS = mode === "idle" ? 15 : 30;
      app.ticker.start();
    }
  });
  const policy = createOfficeFramePolicy({ onModeChange: applyFrameMode });
  let latestSnapshot = snapshot;
  const renderOnceIfStopped = () => {
    const mode = policy.getMode();
    if (mode === "hidden" || mode === "reduced-motion") app.renderer.render(app.stage);
  };
  const userActivity = () => guarded(() => policy.markActivity());
  document.addEventListener("pointerdown", userActivity, { passive: true });
  document.addEventListener("keydown", userActivity);
  const resize = () => guarded(() => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    backdrop.clear().roundRect(0, 0, width, height, 18).fill({ color: colors.paper, alpha: 0.72 });
    office.width = width;
    office.height = height;
    render(latestSnapshot);
    renderOnceIfStopped();
  });
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const visibilityListener = () => guarded(() => policy.setVisible(document.visibilityState !== "hidden"));
  const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  const motionListener = (event: MediaQueryListEvent) => guarded(() => policy.setReducedMotion(event.matches));
  document.addEventListener("visibilitychange", visibilityListener);
  motionQuery?.addEventListener("change", motionListener);
  visibilityListener();
  guarded(() => policy.setReducedMotion(Boolean(motionQuery?.matches)));
  app.ticker.maxFPS = 30;
  app.ticker.add(() => guarded(() => {
    const mode = policy.getMode();
    if (mode === "hidden" || mode === "reduced-motion") return;
    app.ticker.maxFPS = mode === "idle" ? 15 : 30;
  }));

  const render = (next: OfficeSnapshot) => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const rolesById = new Map(next.roles.map((role) => [role.roleId, role]));
    const columnWidth = width / OFFICE_ROLE_ORDER.length;
    OFFICE_ROLE_ORDER.forEach((roleId, index) => {
      const state = rolesById.get(roleId);
      const node = roleNodes.get(roleId) ?? createRoleNode(roleId, index);
      node.root.visible = Boolean(state);
      if (!state) return;
      const anchor = officeRoleAnchorForLayout(roleId, width, height);
      const x = anchor.x;
      const y = height * 0.55;
      const stationRow = !state.available ? 2 : state.activeCount > 0 || state.waitingUserCount > 0 ? 1 : 0;
      const station = node.station;
      station.texture = workstationFrames[stationRow][index];
      station.width = Math.min(116, columnWidth * 0.78);
      station.height = station.width * 0.5;
      station.position.set(x, y);
      station.alpha = state.available ? 0.88 : 0.35;
      const characterRow = state.status === "running" ? 1 : state.status === "waiting" ? 2 : state.status === "failed" ? 3 : 0;
      const character = node.character;
      character.texture = characterFrames[characterRow][index];
      character.width = Math.min(72, columnWidth * 0.5);
      character.height = character.width * 1.3;
      character.position.set(x, y - station.height * 0.7);
      node.anchor = anchor;
      character.tint = statusColor(state.status);
      character.alpha = state.available ? 1 : 0.45;
      node.label.position.set(x, y + 4);
      node.label.text = callbacks.roleLabel(roleId);
      node.hit.clear().circle(x, y - station.height, Math.max(18, station.width * 0.38)).fill({ color: colors.gold, alpha: 0.001 });
      node.hit.visible = true;
      const slots = getOfficeDeviceSlots(state);
      slots.devices.forEach((device, deviceIndex) => {
        const deviceNode = node.devices[deviceIndex];
        if (!deviceNode) return;
        deviceNode.device = device;
        deviceNode.root.visible = true;
        deviceNode.root.position.set(x + (deviceIndex - 1) * 40, y + 32);
        deviceNode.marker.clear().circle(0, 0, 9).fill({ color: statusColor(device.visualStatus), alpha: 0.9 });
        deviceNode.label.text = callbacks.statusLabel(device.visualStatus);
      });
      for (let deviceIndex = slots.devices.length; deviceIndex < node.devices.length; deviceIndex += 1) {
        const deviceNode = node.devices[deviceIndex];
        if (deviceNode) { deviceNode.device = undefined; deviceNode.root.visible = false; }
      }
      node.overflow.text = slots.overflowCount > 0 ? `+${slots.overflowCount}` : "";
      node.overflow.visible = slots.overflowCount > 0;
      node.overflow.position.set(x, y + 60);
    });
  };
  resize();
  guarded(() => policy.start());

  return {
    update(next) { guarded(() => { latestSnapshot = next; render(next); renderOnceIfStopped(); }); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      policy.stop();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", visibilityListener);
      document.removeEventListener("pointerdown", userActivity);
      document.removeEventListener("keydown", userActivity);
      motionQuery?.removeEventListener("change", motionListener);
      app.destroy(true, { children: true, texture: false, textureSource: false });
    },
  };
}
