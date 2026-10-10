import { useEffect, useRef } from "react";
import { reduceOfficeSurfaceState, type OfficeSurfaceState } from "./office-surface-state";
import type { OfficeRoleAnchor, OfficeRoleId, OfficeSnapshot, OfficeStatus, OfficeWorkItemKey } from "./types";

export function OfficeCanvasEnhancement({ snapshot, onActivate, onSelectRole, roleLabel, statusLabel, onStateChange }: { readonly snapshot: OfficeSnapshot; readonly onActivate: (key: OfficeWorkItemKey) => void; readonly onSelectRole: (roleId: OfficeRoleId, anchor: OfficeRoleAnchor) => void; readonly roleLabel: (roleId: OfficeRoleId) => string; readonly statusLabel: (status: OfficeStatus) => string; readonly onStateChange?: (state: OfficeSurfaceState) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<{ update: (next: OfficeSnapshot) => void; destroy: () => void } | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  const presentationRef = useRef({ onSelectRole, roleLabel, statusLabel });
  presentationRef.current = { onSelectRole, roleLabel, statusLabel };
  const stateRef = useRef<OfficeSurfaceState>({ kind: "react-ready" });
  const transition = (event: Parameters<typeof reduceOfficeSurfaceState>[1]) => {
    stateRef.current = reduceOfficeSurfaceState(stateRef.current, event);
    onStateChange?.(stateRef.current);
  };
  useEffect(() => {
    let active = true;
    let sceneFailed = false;
    const host = hostRef.current;
    if (!host) return;
    const cleanupScene = () => {
      handleRef.current?.destroy();
      handleRef.current = null;
      host.replaceChildren();
    };
    transition({ type: "pixi-load" });
    void import("./office-scene").then(({ mountOfficeScene }) => active ? mountOfficeScene(host, snapshotRef.current, {
      onActivate: (key) => activateRef.current(key),
      onSelectRole: (roleId, anchor) => presentationRef.current.onSelectRole(roleId, anchor),
      roleLabel: (roleId) => presentationRef.current.roleLabel(roleId),
      statusLabel: (status) => presentationRef.current.statusLabel(status),
      onError: (error) => {
        if (!active || sceneFailed) return;
        sceneFailed = true;
        cleanupScene();
        transition({ type: "pixi-failed", error: error instanceof Error ? error.message : String(error) });
      },
    }) : null).then((handle) => {
      if (!handle) return;
      if (!active || sceneFailed) { handle.destroy(); return; }
      handleRef.current = handle;
      handle.update(snapshotRef.current);
      if (sceneFailed) return;
      transition({ type: "pixi-ready" });
    }).catch((error: unknown) => {
      if (!active || sceneFailed) return;
      cleanupScene();
      sceneFailed = true;
      transition({ type: "pixi-load-failed", error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      active = false;
      cleanupScene();
    };
  }, []);
  useEffect(() => { handleRef.current?.update(snapshot); }, [snapshot, roleLabel, statusLabel]);
  return <div ref={hostRef} className="virtual-office-scene" aria-hidden="true" />;
}
