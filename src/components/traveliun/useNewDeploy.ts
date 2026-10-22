"use client";

import { useEffect, useState } from "react";

/**
 * True once the server runs a newer deploy than this page was built from.
 *
 * Asked every minute while the tab is visible, and when it comes back into
 * view. Before, a tab learned of a deploy only when a save or a click failed
 * (2026-10-22, twice in a day); now the editor can save first and say so.
 * Never reloads by itself — that is the agent's call. Off without a deploy id
 * (dev).
 */
export function useNewDeploy(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    // read at run time: under Turbopack it is a global Next sets from the page
    const own = process.env.NEXT_DEPLOYMENT_ID;
    if (!own || stale) return;
    let gone = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { id } = (await res.json()) as { id?: string | null };
        if (!gone && id && id !== own) setStale(true);
      } catch {
        // mid-swap, offline, or the session ran out (a sign-in page is no JSON) — the next check tells
      }
    };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      gone = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [stale]);
  return stale;
}
