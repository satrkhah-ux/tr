"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { can, dashboardViewFor, type DashboardView, type Permission, type Role } from "./roles";

type RoleContextValue = {
  /** The user's real role from the DB — never changed by view-as. */
  realRole: Role;
  /** Role the UI currently renders as (view-as in dev, otherwise realRole). */
  effectiveRole: Role;
  /** dev-only override, or null. */
  viewAs: Role | null;
  setViewAs: (role: Role) => void;
  resetViewAs: () => void;
  /** True only in development — gates the view-as feature. */
  devMode: boolean;
  can: (permission: Permission) => boolean;
  dashboardView: DashboardView;
};

const RoleCtx = createContext<RoleContextValue | null>(null);

const STORAGE_KEY = "traveliun-view-as";
// Inlined at build time; false in a production build → view-as fully disabled.
const DEV_MODE = process.env.NODE_ENV !== "production";

export function RoleProvider({ realRole, children }: { realRole: Role; children: ReactNode }) {
  const [viewAs, setViewAsState] = useState<Role | null>(null);

  useEffect(() => {
    if (!DEV_MODE) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Role | null;
      if (stored) setViewAsState(stored);
    } catch {
      /* ignore */
    }
  }, []);

  const setViewAs = useCallback((role: Role) => {
    if (!DEV_MODE) return;
    setViewAsState(role);
    try {
      window.localStorage.setItem(STORAGE_KEY, role);
    } catch {
      /* ignore */
    }
  }, []);

  const resetViewAs = useCallback(() => {
    setViewAsState(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // view-as only affects the EFFECTIVE role, and only in dev. It never touches
  // realRole and grants no server access (RLS + server actions use the real session).
  const effectiveRole = DEV_MODE && viewAs ? viewAs : realRole;

  const value: RoleContextValue = {
    realRole,
    effectiveRole,
    viewAs: DEV_MODE ? viewAs : null,
    setViewAs,
    resetViewAs,
    devMode: DEV_MODE,
    can: (permission: Permission) => can(effectiveRole, permission),
    dashboardView: dashboardViewFor(effectiveRole),
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
      setViewAs: () => {},
      resetViewAs: () => {},
      devMode: false,
      can: (permission: Permission) => can("visitor", permission),
      dashboardView: dashboardViewFor("visitor"),
    };
  }
  return ctx;
}
