"use client";

import { useEffect } from "react";
import { AUTH_STORAGE_KEY } from "@/lib/supabase/constants";

/**
 * A session signed out elsewhere (lib/supabase/server.ts sessionGone): drop the dead
 * cookie — as the browser client's own removeItem does — and load the page again.
 * Without a cookie the proxy itself sends a staff page to /sign-in (and back here
 * after it); a public page, a client's offer link, simply opens.
 */
export function SessionGone() {
  useEffect(() => {
    document.cookie = `${AUTH_STORAGE_KEY}=; path=/; max-age=0; SameSite=Lax`;
    // once: a cookie that would not go must not become a reload loop
    try {
      if (Date.now() - Number(sessionStorage.getItem("tv-session-gone") ?? 0) < 30_000) return;
      sessionStorage.setItem("tv-session-gone", String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, []);
  return null;
}
