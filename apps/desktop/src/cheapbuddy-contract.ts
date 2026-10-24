import type { DesktopProviderConfig } from "./provider-config";

export type CheapBuddyAccountAction = "status" | "login" | "verify" | "refresh" | "logout";

export type CheapBuddyProduct = {
  readonly id: string;
  readonly kind: "recharge" | "membership";
  readonly name: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly description?: string;
  readonly period?: string;
};

export type CheapBuddyAccountState = {
  readonly status: "signed_out" | "verification_required" | "connected" | "no_models" | "session_expired";
  readonly persistent: boolean;
  readonly account?: { readonly id: number | string; readonly email: string; readonly username?: string; readonly balance?: number };
  readonly products: readonly CheapBuddyProduct[];
  readonly rechargeCatalogAvailable: boolean;
  readonly memberships: readonly { readonly id: string; readonly name: string; readonly expiresAt?: string }[];
  readonly provider?: DesktopProviderConfig;
  readonly updatedAt?: string;
  readonly warning?: string;
};

export const SIGNED_OUT_CHEAPBUDDY_STATE: CheapBuddyAccountState = {
  status: "signed_out", persistent: false, products: [], rechargeCatalogAvailable: false, memberships: [],
};
