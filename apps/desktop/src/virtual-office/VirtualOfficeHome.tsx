import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NavigationAdapter, OfficeCapabilities, OfficeRoleAnchor, OfficeRoleDefinition, OfficeRoleId, OfficeWorkItemKey } from "./types";
import type { OfficeStore } from "./office-store";
import { enabledOfficeRoles } from "./role-registry";
import { FallbackOfficeList } from "./FallbackOfficeList";
import { activateOfficeWorkItem } from "./navigation";
import { OfficeCanvasEnhancement } from "./OfficeCanvasEnhancement";
import type { OfficeSurfaceState } from "./office-surface-state";
import { officeSceneEnabled } from "./renderer-gate";
import { statusLabels } from "./RoleCard";
import { OfficeRoleStatusCard } from "./OfficeRoleStatusCard";
import { officeRoleAnchorForLayout } from "./office-layout";
import { clampOfficePopover, officeAnchorFromRects, type OfficePopoverPosition } from "./office-popover-position";

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => store.subscribe(() => setSnapshot(store.getSnapshot())), [store]);
  const roles = enabledOfficeRoles(capabilities);
  const selectedRole = selectedRoleId ? roles.find((role) => role.roleId === selectedRoleId) : undefined;
  const selectedState = selectedRoleId ? snapshot.roles.find((state) => state.roleId === selectedRoleId) : undefined;
  const closeRole = useCallback((restoreFocus = true) => {
    setSelectedRoleId(null);
    setSelectedAnchor(null);
    setPopoverPosition(null);
    if (restoreFocus) {
      const trigger = triggerRef.current;
      if (trigger) trigger.focus();
      else stageRef.current?.focus();
    }
    triggerRef.current = null;
  }, []);
  const selectRole = useCallback((roleId: OfficeRoleId, anchor?: OfficeRoleAnchor, trigger?: HTMLButtonElement) => {
    if (!roles.some((role) => role.roleId === roleId)) return;
    triggerRef.current = trigger ?? null;
    const stage = stageRef.current;
    setSelectedRoleId(roleId);
    setSelectedAnchor(anchor ?? { x: (stage?.clientWidth ?? 0) / 2, y: Math.max(48, (stage?.clientHeight ?? 0) * 0.42) });
  }, [roles]);
  const selectFallbackRole = useCallback((role: OfficeRoleDefinition, trigger?: HTMLButtonElement) => selectRole(role.roleId, undefined, trigger), [selectRole]);
  const openWorkItem = useCallback((key: OfficeWorkItemKey) => { activateOfficeWorkItem(key, snapshot, navigation); }, [navigation, snapshot]);
  useEffect(() => {
    if (!selectedRoleId) return;
    if (!selectedRole || !selectedState) closeRole(false);
  }, [closeRole, selectedRole, selectedRoleId, selectedState]);
  useEffect(() => {
    if (!selectedRoleId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !stageRef.current?.contains(target)) closeRole();
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
    const trigger = triggerRef.current;
    const host = trigger ? office : stage;
    if (!office || !stage || !host || !popover || !selectedRoleId) {
      setPopoverPosition(null);
      return;
    }
    const update = () => {
      const anchor = trigger
        ? officeAnchorFromRects(trigger.getBoundingClientRect(), office.getBoundingClientRect())
        : officeRoleAnchorForLayout(selectedRoleId, stage.clientWidth, stage.clientHeight) ?? selectedAnchor ?? { x: stage.clientWidth / 2, y: stage.clientHeight * 0.42 };
      setPopoverPosition(clampOfficePopover(anchor, { width: popover.offsetWidth, height: popover.offsetHeight }, { width: host.clientWidth, height: host.clientHeight }));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(office);
    observer?.observe(stage);
    observer?.observe(popover);
    if (trigger) observer?.observe(trigger);
    return () => observer?.disconnect();
  }, [locale, selectedAnchor, selectedRoleId, snapshot.revision]);
  useLayoutEffect(() => {
    if (!selectedRoleId) return;
    popoverRef.current?.querySelector<HTMLButtonElement>("[data-office-status-close]")?.focus();
  }, [selectedAnchor, selectedRoleId]);
  const sceneError = surfaceState.kind === "react-ready" ? surfaceState.error : undefined;
  const sceneNotice = sceneError ? (locale === "zh" ? "场景增强不可用，列表视图仍可继续使用。" : "Scene enhancement is unavailable; the list view remains usable.") : null;
  const sceneFallback = !sceneEnabled || Boolean(sceneError);
  const fallbackSelection = Boolean(triggerRef.current);
  const rolePopover = selectedRole && selectedState ? <div
    ref={popoverRef}
    className={`virtual-office-role-popover-host${popoverPosition ? ` is-${popoverPosition.placement}` : ""}`.trim()}
    style={popoverPosition ? { left: popoverPosition.left, top: popoverPosition.top } : { left: 14, top: 14 }}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <OfficeRoleStatusCard role={selectedRole} state={selectedState} locale={locale} onClose={() => closeRole()} onEnter={() => navigation.go(selectedRole.homeRoute)} onWorkItemOpen={openWorkItem} />
  </div> : null;
  return <section ref={officeRef} className={`virtual-office${standalone ? " virtual-office--standalone" : ""}`.trim()} aria-label={locale === "zh" ? "虚拟办公室" : "Virtual office"}>
    <header className="virtual-office__header"><div>
      <p className="virtual-office__eyebrow">{locale === "zh" ? "工作空间" : "WORKSPACE"}</p>
      <h1>{locale === "zh" ? "虚拟办公室" : "Virtual office"}</h1>
      <p className="virtual-office__description">{locale === "zh" ? "从这里查看正在处理的工作，并回到对应工作区继续操作。" : "See active work here, then return to the matching workspace to continue."}</p>
      {sceneNotice ? <p className="virtual-office__scene-notice" role="status">{sceneNotice}</p> : null}
    </div></header>
    {roles.length ? <>
      <div ref={stageRef} className={`virtual-office-stage${sceneFallback ? " virtual-office-stage--fallback" : ""}`.trim()} tabIndex={-1}>
        {!sceneFallback ? <OfficeCanvasEnhancement
          snapshot={snapshot}
          onActivate={openWorkItem}
          onSelectRole={(roleId, anchor) => selectRole(roleId, anchor)}
          roleLabel={(roleId) => roles.find((role) => role.roleId === roleId)?.label[locale] ?? roleId}
          statusLabel={(status) => statusLabels[status][locale]}
          onStateChange={setSurfaceState}
        /> : <p className="virtual-office-stage__fallback-note">{locale === "zh" ? "当前使用可访问的角色列表视图。" : "Using the accessible role list view."}</p>}
        {!fallbackSelection ? rolePopover : null}
      </div>
      <FallbackOfficeList roles={roles} states={snapshot.roles} locale={locale} onSelect={selectFallbackRole} onWorkItemOpen={openWorkItem} />
      {fallbackSelection ? rolePopover : null}
    </> : <p className="virtual-office-empty">{locale === "zh" ? "当前没有可用的工作角色。" : "No work roles are available right now."}</p>}
  </section>;
}
