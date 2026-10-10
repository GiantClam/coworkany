export type OfficeSurfaceState =
  | { readonly kind: "react-ready"; readonly error?: string }
  | { readonly kind: "pixi-loading" }
  | { readonly kind: "pixi-ready" };

export type OfficeSurfaceEvent =
  | { readonly type: "pixi-load" }
  | { readonly type: "pixi-ready" }
  | { readonly type: "pixi-failed" | "pixi-load-failed" | "asset-load-failed" | "pixi-init-failed" | "manifest-invalid"; readonly error: string };

export function reduceOfficeSurfaceState(state: OfficeSurfaceState, event: OfficeSurfaceEvent): OfficeSurfaceState {
  if (event.type === "pixi-load") return { kind: "pixi-loading" };
  if (event.type === "pixi-ready") return { kind: "pixi-ready" };
  if (event.type.endsWith("failed") || event.type === "manifest-invalid") return { kind: "react-ready", error: event.error };
  return state;
}
