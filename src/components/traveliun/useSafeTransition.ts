"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

/**
 * Raised when a call to the server fails outright — offline, or (the usual
 * case) a new version was deployed while this page was open and the server no
 * longer knows the old page's actions. Heard by the shell's banner.
 */
export const SERVER_LOST_EVENT = "tv:server-lost";

/**
 * useTransition whose action cannot take the page down.
 *
 * A server action that throws inside startTransition goes to the nearest error
 * boundary — after a deploy mid-shift that was «This page couldn't load», and
 * the confirmation number just typed was gone. Here the error is caught, the
 * page and its fields stay as they are, and the shell says what happened.
 */
export function useSafeTransition(): [boolean, (action: () => Promise<unknown> | unknown) => void] {
  const [pending, start] = useTransition();
  const run = useCallback(
    (action: () => Promise<unknown> | unknown) =>
      start(async () => {
        try {
          await action();
        } catch (error) {
          console.error(error);
          window.dispatchEvent(new Event(SERVER_LOST_EVENT));
        }
      }),
    [],
  );
  return [pending, run];
}

/**
 * A field's value kept in this tab's sessionStorage, so reloading after a
 * deploy does not lose what was typed (a confirmation number, a payment). Not
 * localStorage: it leaves with the tab, never stays on a shared computer.
 */
export function useSessionField(key: string, initial: string): [string, (value: string) => void, () => void] {
  const [value, setValue] = useState(initial);
  // what an earlier load of this tab left unsent comes back after mount, so the server render stays the same
  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const kept = window.sessionStorage.getItem(`tv-field:${key}`);
        if (kept) setValue(kept);
      } catch {
        // storage unavailable: the field simply starts as it is
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, [key]);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      try {
        if (next) window.sessionStorage.setItem(`tv-field:${key}`, next);
        else window.sessionStorage.removeItem(`tv-field:${key}`);
      } catch {
        // storage unavailable: the field still works
      }
    },
    [key],
  );
  /** Sent: forget it. */
  const clear = useCallback(() => {
    try {
      window.sessionStorage.removeItem(`tv-field:${key}`);
    } catch {
      // nothing kept
    }
  }, [key]);
  return [value, set, clear];
}
