import React from "react";
import type { OfficeRoleDefinition, OfficeRoleState, OfficeWorkItemKey } from "./types";

export interface RoleCardProps {
  readonly role: OfficeRoleDefinition;
  readonly state: OfficeRoleState;
  readonly locale?: "zh" | "en";
  readonly onOpen: (trigger?: HTMLButtonElement) => void;
  readonly onWorkItemOpen?: (key: OfficeWorkItemKey) => void;
}

export const statusLabels: Record<OfficeRoleState["status"], { readonly zh: string; readonly en: string }> = {
  idle: { zh: "空闲", en: "Idle" },
  offline: { zh: "不可用", en: "Offline" },
  queued: { zh: "排队中", en: "Queued" },
  running: { zh: "工作中", en: "Working" },
  waiting: { zh: "等待处理", en: "Waiting" },
  completed: { zh: "已完成", en: "Completed" },
  failed: { zh: "失败", en: "Failed" },
  cancelled: { zh: "已取消", en: "Cancelled" },
  unknown: { zh: "同步中", en: "Syncing" },
};

export function officeStatusLabel(state: OfficeRoleState, locale: "zh" | "en"): string {
  if (state.status === "waiting" && state.waitingUserCount > 0) {
    return locale === "zh" ? "等待你处理" : "Waiting for you";
  }
  return statusLabels[state.status][locale];
}

function emptyState(role: OfficeRoleDefinition): OfficeRoleState {
  return {
    roleId: role.roleId,
    status: "idle",
    activeCount: 0,
    queuedCount: 0,
    waitingUserCount: 0,
    failedCount: 0,
    recentItems: [],
    devices: [],
    overflowCount: 0,
    available: true,
  };
}

export function RoleCard({ role, state, locale = "en", onOpen, onWorkItemOpen }: RoleCardProps) {
  const label = role.label[locale];
  const labelForStatus = officeStatusLabel(state, locale);
  const availability = state.available ? "" : locale === "zh" ? "，当前不可用" : ", currently unavailable";
  const inspectLabel = locale === "zh" ? `查看 ${label} 状态` : `View status for ${label}`;
  return <article className="virtual-office-role-card" data-role-id={role.roleId}>
    <div className="virtual-office-role-card__header"><div><h2>{label}</h2><span className={`virtual-office-status virtual-office-status--${state.status}`} role="status" aria-label={`${label}: ${labelForStatus}${availability}`}>{labelForStatus}</span></div><button type="button" onClick={(event) => onOpen(event.currentTarget)} aria-label={inspectLabel}>{locale === "zh" ? "查看状态" : "View status"}</button></div>
    <dl className="virtual-office-role-card__metrics"><div><dt>{locale === "zh" ? "进行中" : "Active"}</dt><dd>{state.activeCount}</dd></div><div><dt>{locale === "zh" ? "排队" : "Queued"}</dt><dd>{state.queuedCount}</dd></div><div><dt>{locale === "zh" ? "待处理" : "Waiting"}</dt><dd>{state.waitingUserCount}</dd></div><div><dt>{locale === "zh" ? "失败" : "Failed"}</dt><dd>{state.failedCount}</dd></div></dl>
    <div className="virtual-office-devices" aria-label={locale === "zh" ? "进行中的任务" : "Active tasks"}>{state.devices.map((device, index) => <button key={device.deviceId} type="button" className={`virtual-office-device virtual-office-device--${device.visualStatus}`} aria-label={`${label} ${locale === "zh" ? `任务 ${index + 1}，${statusLabels[device.visualStatus][locale]}` : `Task ${index + 1}, ${statusLabels[device.visualStatus][locale]}`}`} onClick={() => onWorkItemOpen?.(device.workItemKey)}>{statusLabels[device.visualStatus][locale]}</button>)}{state.overflowCount > 0 ? <span className="virtual-office-device-overflow" aria-label={`${locale === "zh" ? "还有" : "Plus "}${state.overflowCount}`}>+{state.overflowCount}</span> : null}</div>
    <div className="virtual-office-recent"><h3>{locale === "zh" ? "最近成果" : "Recent work"}</h3>{state.recentItems.length ? state.recentItems.slice(0, 20).map((item) => <button key={`${item.sourceAdapterId}:${item.workItemId}`} type="button" className="virtual-office-recent__item" onClick={() => onWorkItemOpen?.({ sourceAdapterId: item.sourceAdapterId, workItemId: item.workItemId })}>{item.title}</button>) : <p className="virtual-office-recent__empty">{locale === "zh" ? "暂无最近成果" : "No recent work"}</p>}</div>
  </article>;
}

export { emptyState };
