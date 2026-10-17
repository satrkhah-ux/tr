"use client";

import { createContext, useContext, type ReactNode } from "react";
import { can, dashboardViewFor, type DashboardView, type Permission, type Role } from "./roles";
import { FEATURE_DEFAULTS, type Feature, type FeatureFlags } from "@/lib/features";

/** The role being looked through («عرض النظام كـ»), as current.ts currentViewAs() resolves it. */
export type ViewAsRole = { roleId: string; name: string };

type RoleContextValue = {
  /**
   * The coarse label of what this request runs with. View-as is resolved on the
   * server now (current.ts reads the cookie), so the label already reflects it
   * and realRole and effectiveRole are the same value.
   */
  realRole: Role;
  effectiveRole: Role;
  /** the role being looked through, or null on the account's own. */
  viewAs: ViewAsRole | null;
  /** the account's OWN role may switch (roles.ts canSwitchRoles) — never narrowed by view-as. */
  canSwitch: boolean;
  /** the account's OWN role carries developer.access — who may touch developer-held roles and logins. */
  isDeveloper: boolean;
  can: (permission: Permission) => boolean;
  /** is this system service switched on (features.ts, /developer)? */
  featureOn: (feature: Feature) => boolean;
  dashboardView: DashboardView;
};

const RoleCtx = createContext<RoleContextValue | null>(null);

export function RoleProvider({
  realRole,
  permissions,
  features = FEATURE_DEFAULTS,
  viewAs = null,
  canSwitch = false,
  isDeveloper = false,
  children,
}: {
  realRole: Role;
  /** what this request may do (current.ts) — the viewed-as role's keys while switching. */
  permissions: readonly Permission[];
  /** the services switched on, read once on the server (features-server.ts). */
  features?: FeatureFlags;
  viewAs?: ViewAsRole | null;
  canSwitch?: boolean;
  isDeveloper?: boolean;
  children: ReactNode;
}) {
  // The old dev-only, label-based view-as (localStorage) is gone: it previewed a
  // label's DEFAULT set, which no real role matches, and only in development.
  const value: RoleContextValue = {
    realRole,
    effectiveRole: realRole,
    viewAs,
    canSwitch,
    isDeveloper,
    can: (permission: Permission) => permissions.includes(permission),
    featureOn: (feature: Feature) => features[feature],
    dashboardView: dashboardViewFor(realRole),
  };

  return <RoleCtx.Provider value={value}>{children}</RoleCtx.Provider>;
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleCtx);
  if (!ctx) {
    return {
      realRole: "visitor",
      effectiveRole: "visitor",
      viewAs: null,
      canSwitch: false,
      isDeveloper: false,
      can: (permission: Permission) => can("visitor", permission),
      featureOn: (feature: Feature) => FEATURE_DEFAULTS[feature],
      dashboardView: dashboardViewFor("visitor"),
    };
  }
  return ctx;
}
