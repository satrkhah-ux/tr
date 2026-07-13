"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { AUTH_COOKIE_MAX_AGE, AUTH_STORAGE_KEY, getSupabaseEnv } from "./constants";

/**
 * Cookie-backed storage adapter so the Supabase session is available to the
 * server (middleware / RSC) via `document.cookie`, not just localStorage.
 */
const cookieStorage = {
  getItem(key: string): string | null {
    if (typeof document === "undefined") return null;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  },
  setItem(key: string, value: string): void {
    if (typeof document === "undefined") return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${AUTH_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  },
  removeItem(key: string): void {
    if (typeof document === "undefined") return;
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
  },
};

let browserClient: SupabaseClient<Database> | undefined;

/** Singleton browser Supabase client (typed against the Traveliun schema). */
export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const { url, anonKey } = getSupabaseEnv();
  browserClient = createClient<Database>(url, anonKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      storage: cookieStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });

  return browserClient;
}
