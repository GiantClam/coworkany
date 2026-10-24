import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NavigationAdapter, OfficeCapabilities, OfficeRoleAnchor, OfficeRoleId, OfficeWorkItemKey } from "./types";
import type { OfficeStore } from "./office-store";
import { enabledOfficeRoles } from "./role-registry";
import { activateOfficeWorkItem } from "./navigation";
import { OfficeCanvasEnhancement } from "./OfficeCanvasEnhancement";
import type { OfficeSurfaceState } from "./office-surface-state";
import { officeSceneEnabled } from "./renderer-gate";
import { statusLabels } from "./RoleCard";
import { OfficeRoleStatusCard } from "./OfficeRoleStatusCard";
import { officeRoleAnchorForLayout } from "./office-layout";
import { clampOfficePopover, type OfficePopoverPosition } from "./office-popover-position";

export interface VirtualOfficeHomeProps {
  readonly store: OfficeStore;
  readonly capabilities: OfficeCapabilities;
  readonly navigation: NavigationAdapter;
  readonly locale?: "zh" | "en";
  readonly sceneEnabled?: boolean;
  readonly standalone?: boolean;
}
export function VirtualOfficeHome({ store, capabilities, navigation, locale = "en", sceneEnabled = officeSceneEnabled(import.meta.env ?? {}), standalone = false }: VirtualOfficeHomeProps) {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
  const [surfaceState, setSurfaceState] = useState<OfficeSurfaceState>({ kind: "react-ready" });
  const [selectedRoleId, setSelectedRoleId] = useState<OfficeRoleId | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<OfficeRoleAnchor | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<OfficePopoverPosition | null>(null);
  const officeRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store]);
  const roles = enabledOfficeRoles(capabilities);
  const selectedRole = selectedRoleId ? roles.find((role) => role.roleId === selectedRoleId) : undefined;
  const selectedState = selectedRoleId ? snapshot.roles.find((state) => state.roleId === selectedRoleId) : undefined;
  const closeRole = useCallback((restoreFocus = true) => {
    setSelectedRoleId(null);
    setSelectedAnchor(null);
    setPopoverPosition(null);
    if (restoreFocus) stageRef.current?.focus();
  }, []);
  const selectRole = useCallback((roleId: OfficeRoleId, anchor?: OfficeRoleAnchor) => {
    if (!roles.some((role) => role.roleId === roleId)) return;
    const stage = stageRef.current;
    setSelectedRoleId(roleId);
    setSelectedAnchor(anchor ?? { x: (stage?.clientWidth ?? 0) / 2, y: Math.max(48, (stage?.clientHeight ?? 0) * 0.42) });
  }, [roles]);
  const openWorkItem = useCallback((key: OfficeWorkItemKey) => { activateOfficeWorkItem(key, snapshot, navigation); }, [navigation, snapshot]);
  useEffect(() => {
    if (!selectedRoleId) return;
    if (!selectedRole || !selectedState) closeRole(false);
  }, [closeRole, selectedRole, selectedRoleId, selectedState]);
  useEffect(() => {
    if (!selectedRoleId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !officeRef.current?.contains(target)) closeRole();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRole();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeRole, selectedRoleId]);
  useLayoutEffect(() => {
    const office = officeRef.current;
    const stage = stageRef.current;
    const popover = popoverRef.current;
    if (!office || !stage || !popover || !selectedRoleId) {
      setPopoverPosition(null);
      return;
    }
    const update = () => {
      const anchor = selectedAnchor ?? officeRoleAnchorForLayout(selectedRoleId, stage.clientWidth, stage.clientHeight) ?? { x: stage.clientWidth / 2, y: stage.clientHeight * 0.42 };
      setPopoverPosition(clampOfficePopover(anchor, { width: popover.offsetWidth, height: popover.offsetHeight }, { width: stage.clientWidth, height: stage.clientHeight }));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(stage);
    observer?.observe(popover);
    return () => observer?.disconnect();
  }, [locale, selectedAnchor, selectedRoleId, snapshot.revision]);
  useLayoutEffect(() => {
    if (!selectedRoleId) return;
    popoverRef.current?.querySelector<HTMLButtonElement>("[data-office-status-close]")?.focus();
  }, [selectedAnchor, selectedRoleId]);
  const sceneError = surfaceState.kind === "react-ready" ? surfaceState.error : undefined;
  const sceneNotice = sceneError ? (locale === "zh" ? "场景暂不可用。" : "The studio scene is unavailable.") : null;
  const sceneFallback = !sceneEnabled || Boolean(sceneError);
  const rolePopover = selectedRole && selectedState ? <div
    ref={popoverRef}
    className={`virtual-office-role-popover-host${popoverPosition ? ` is-${popoverPosition.placement}` : ""}`.trim()}
    style={popoverPosition ? { left: popoverPosition.left, top: popoverPosition.top } : { left: 14, top: 14 }}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <OfficeRoleStatusCard role={selectedRole} state={selectedState} locale={locale} onClose={() => closeRole()} onEnter={() => navigation.go(selectedRole.homeRoute)} onWorkItemOpen={openWorkItem} />
  </div> : null;
  return <section ref={officeRef} className={`virtual-office${standalone ? " virtual-office--standalone" : ""}`.trim()} aria-label={locale === "zh" ? "虚拟办公室" : "Virtual office"}>
    {roles.length ? <>
      <div ref={stageRef} className={`virtual-office-stage${sceneFallback ? " virtual-office-stage--fallback" : ""}`.trim()} tabIndex={-1}>
        {!sceneFallback ? <OfficeCanvasEnhancement
          snapshot={snapshot}
          onActivate={openWorkItem}
          onSelectRole={(roleId, anchor) => selectRole(roleId, anchor)}
          roleLabel={(roleId) => roles.find((role) => role.roleId === roleId)?.label[locale] ?? roleId}
          statusLabel={(status) => statusLabels[status][locale]}
          onStateChange={setSurfaceState}
        /> : <p className="virtual-office-stage__fallback-note" role="status">{sceneNotice ?? (locale === "zh" ? "场景暂不可用，角色仍可通过辅助控件访问。" : "The scene is unavailable; roles remain available through accessible controls.")}</p>}
        {rolePopover}
      </div>
      <div className="virtual-office-role-controls" role="group" aria-label={locale === "zh" ? "办公室角色" : "Office roles"}>
        {roles.map((role) => {
          const state = snapshot.roles.find((item) => item.roleId === role.roleId);
          const status = state ? statusLabels[state.status][locale] : locale === "zh" ? "同步中" : "Syncing";
          return <button key={role.roleId} type="button" data-role-id={role.roleId} aria-label={`${role.label[locale]}: ${status}`} onClick={() => {
            const stage = stageRef.current;
            selectRole(role.roleId, stage ? officeRoleAnchorForLayout(role.roleId, stage.clientWidth, stage.clientHeight) : undefined);
          }}>{role.label[locale]}</button>;
        })}
      </div>
    </> : <p className="virtual-office-empty">{locale === "zh" ? "当前没有可用的工作角色。" : "No work roles are available right now."}</p>}
  </section>;
}
