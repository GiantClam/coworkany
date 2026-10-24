import type { NavigationAdapter, OfficeSnapshot, OfficeWorkItemKey } from "./types";
import { officeRoleForWorkItem } from "./role-registry";

export type ActivateResult =
  | { readonly ok: true; readonly route: string }
  | { readonly ok: false; readonly reason: "not-found" | "route-unavailable" };

/** Navigate only from a stable source/work-item pair. A stale key is a no-op. */
export function activateOfficeWorkItem(key: OfficeWorkItemKey, snapshot: OfficeSnapshot, navigation: NavigationAdapter): ActivateResult {
  const item = snapshot.workItems.find((candidate) => candidate.sourceAdapterId === key.sourceAdapterId && candidate.workItemId === key.workItemId);
  if (!item) return { ok: false, reason: "not-found" };
  const role = officeRoleForWorkItem(item);
  if (!role) return { ok: false, reason: "route-unavailable" };
  // Production snapshots contain only capability-enabled roles. Keep direct callers
  // with a deliberately minimal snapshot usable, while rejecting disabled roles when
  // the snapshot carries the role capability projection.
  const roleState = snapshot.roles.find((candidate) => candidate.roleId === item.roleId);
  if (snapshot.roles.length > 0 && (!roleState || !roleState.available)) return { ok: false, reason: "route-unavailable" };
  const route = role.workItemRoute(item);
  navigation.go(route);
  return { ok: true, route };
}
