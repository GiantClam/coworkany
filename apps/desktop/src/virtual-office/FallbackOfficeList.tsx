import React from "react";
import type { OfficeRoleDefinition, OfficeRoleState, OfficeWorkItemKey } from "./types";
import { emptyState, RoleCard } from "./RoleCard";

export function FallbackOfficeList({ roles, states, locale = "en", onSelect, onWorkItemOpen }: { readonly roles: readonly OfficeRoleDefinition[]; readonly states: readonly OfficeRoleState[]; readonly locale?: "zh" | "en"; readonly onSelect: (role: OfficeRoleDefinition, trigger?: HTMLButtonElement) => void; readonly onWorkItemOpen?: (key: OfficeWorkItemKey) => void }) {
  return <section className="virtual-office-fallback" aria-label={locale === "zh" ? "办公室角色" : "Office roles"}>{roles.map((role) => <RoleCard key={role.roleId} role={role} state={states.find((state) => state.roleId === role.roleId) ?? emptyState(role)} locale={locale} onOpen={(trigger) => onSelect(role, trigger)} onWorkItemOpen={onWorkItemOpen} />)}</section>;
}
