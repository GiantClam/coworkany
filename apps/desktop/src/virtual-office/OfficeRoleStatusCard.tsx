import React from "react";
import type { OfficeRoleDefinition, OfficeRoleState, OfficeWorkItemKey } from "./types";
import { officeStatusLabel, statusLabels } from "./RoleCard";

export interface OfficeRoleStatusCardProps {
  readonly role: OfficeRoleDefinition;
  readonly state: OfficeRoleState;
  readonly locale?: "zh" | "en";
  readonly onEnter: () => void;
  readonly onWorkItemOpen?: (key: OfficeWorkItemKey) => void;
  readonly onClose?: () => void;
  readonly unavailableReason?: string;
}

export function OfficeRoleStatusCard({ role, state, locale = "en", onEnter, onWorkItemOpen, onClose, unavailableReason }: OfficeRoleStatusCardProps) {
  const label = role.label[locale];
  const status = officeStatusLabel(state, locale);
  const enterLabel = locale === "zh" ? "进入工作区" : "Enter workspace";
  const closeLabel = locale === "zh" ? "关闭状态卡" : "Close status card";
  const unavailable = unavailableReason ?? (locale === "zh" ? "当前不可用" : "Currently unavailable");
  return <aside className="virtual-office-role-popover" data-office-status-card role="dialog" aria-label={`${label} ${locale === "zh" ? "状态" : "status"}`}>
    <div className="virtual-office-role-popover__header">
      <div>
        <p className="virtual-office-role-popover__eyebrow">{locale === "zh" ? "角色状态" : "ROLE STATUS"}</p>
        <h2>{label}</h2>
        <p className={`virtual-office-status virtual-office-status--${state.status}`} role="status">{status}</p>
      </div>
      {onClose ? <button type="button" className="virtual-office-role-popover__close" data-office-status-close onClick={onClose} aria-label={closeLabel}>×</button> : null}
    </div>
    <dl className="virtual-office-role-popover__metrics">
      <div><dt>{locale === "zh" ? "进行中" : "Active"}</dt><dd>{state.activeCount}</dd></div>
      <div><dt>{locale === "zh" ? "排队" : "Queued"}</dt><dd>{state.queuedCount}</dd></div>
      <div><dt>{locale === "zh" ? "待处理" : "Waiting"}</dt><dd>{state.waitingUserCount}</dd></div>
      <div><dt>{locale === "zh" ? "失败" : "Failed"}</dt><dd>{state.failedCount}</dd></div>
    </dl>
    {!state.available ? <p className="virtual-office-role-popover__notice" role="status">{unavailable}</p> : null}
    <section className="virtual-office-role-popover__section" aria-label={locale === "zh" ? "当前任务" : "Current tasks"}>
      <h3>{locale === "zh" ? "当前任务" : "Current tasks"}</h3>
      {state.devices.length ? <div className="virtual-office-role-popover__items">{state.devices.map((device, index) => <button key={device.deviceId} type="button" className={`virtual-office-role-popover__item virtual-office-role-popover__item--${device.visualStatus}`} onClick={() => onWorkItemOpen?.(device.workItemKey)}>{locale === "zh" ? `任务 ${index + 1} · ${statusLabels[device.visualStatus][locale]}` : `Task ${index + 1} · ${statusLabels[device.visualStatus][locale]}`}</button>)}{state.overflowCount > 0 ? <span className="virtual-office-role-popover__overflow">+{state.overflowCount}</span> : null}</div> : <p className="virtual-office-role-popover__empty">{locale === "zh" ? "当前没有进行中的任务" : "No current tasks"}</p>}
    </section>
    <section className="virtual-office-role-popover__section" aria-label={locale === "zh" ? "最近成果" : "Recent work"}>
      <h3>{locale === "zh" ? "最近成果" : "Recent work"}</h3>
      {state.recentItems.length ? <div className="virtual-office-role-popover__recent">{state.recentItems.slice(0, 5).map((item) => <button key={`${item.sourceAdapterId}:${item.workItemId}`} type="button" onClick={() => onWorkItemOpen?.({ sourceAdapterId: item.sourceAdapterId, workItemId: item.workItemId })}>{item.title}</button>)}</div> : <p className="virtual-office-role-popover__empty">{locale === "zh" ? "暂无最近成果" : "No recent work"}</p>}
    </section>
    <button type="button" className="virtual-office-role-popover__enter" disabled={!state.available} onClick={onEnter}>{enterLabel}</button>
  </aside>;
}
