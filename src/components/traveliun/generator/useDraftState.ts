"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveDraftStages } from "@/lib/data/drafts";
import type { DraftData } from "@/lib/offer/draft-types";
import { withFlightTotals } from "@/lib/offer/flight-fare";
import { createSaveQueue } from "./save-queue";
import { pendingToReplay } from "./pending-edits";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * What has not reached the server yet, kept in the browser too: a deploy
 * mid-shift turned the save into a 404 and the reload that followed lost the
 * prices just typed. It comes back only onto the save it was typed on, or onto
 * one older than it — never over a newer save from another screen — and only
 * within twelve hours (pending-edits.ts). Signing out clears it
 * (clearPendingDrafts). Nothing secret goes in: the draft as this agent sees it.
 */
export const PENDING_PREFIX = "tv-draft-pending:";
const PENDING_KEY = (draftId: string) => `${PENDING_PREFIX}${draftId}`;
function keepPending(draftId: string, slice: Partial<DraftData>, base: string | undefined) {
  try {
    if (Object.keys(slice).length === 0) window.localStorage.removeItem(PENDING_KEY(draftId));
    else window.localStorage.setItem(PENDING_KEY(draftId), JSON.stringify({ at: Date.now(), base, slice }));
  } catch {
    // private window, storage full — the server save still runs
  }
}
function readPending(draftId: string, savedAt: string): Partial<DraftData> | null {
  try {
    const slice = pendingToReplay(window.localStorage.getItem(PENDING_KEY(draftId)), savedAt, Date.now());
    if (!slice) window.localStorage.removeItem(PENDING_KEY(draftId));
    return slice;
  } catch {
    return null;
  }
}

/** On sign-out: no client's name or phone stays on a shared office computer. */
export function clearPendingDrafts() {
  try {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith(PENDING_PREFIX)) window.localStorage.removeItem(key);
  } catch {
    // storage unavailable — nothing was kept
  }
}

/**
 * The live draft and its auto-save — the one copy of this machinery.
 *
 * Patches accumulate into a pending slice and go up 700 ms after the last
 * keystroke, so typing a city name is one write and not twelve. The pending
 * slice is merged by TOP-LEVEL KEY, which is why two stages editing the same
 * slice must never be mounted at once: the later patch would win on the whole
 * object rather than on the field it changed.
 *
 * `flush` is exposed because the card flow has no route changes to lean on.
 * The eleven stage routes got their flush for free from unmounting on
 * navigation; a single page has to ask for it before it moves the agent on, and
 * before any server action that re-reads the draft it has just written to.
 */
export function useDraftState(
  draftId: string,
  initialData: DraftData,
  /** when the server last saved this draft — given, unsaved edits are kept in the browser and restored onto an older save. */
  savedAt?: string,
): {
  data: DraftData;
  patch: (slice: Partial<DraftData>) => void;
  replace: (next: DraftData) => void;
  flush: () => Promise<void>;
  saveState: SaveState;
  /** edits a reload brought back from the browser (and sent up again) — say so once */
  restored: boolean;
} {
  const [raw, setData] = useState<DraftData>(initialData);
  // a «للفرد» flight total follows the travellers the moment they change, on every screen
  const data = useMemo(() => {
    const flight_booking = withFlightTotals(raw.flight_booking, raw.trip);
    return flight_booking === raw.flight_booking ? raw : { ...raw, flight_booking };
  }, [raw]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timerRef = useRef<number | null>(null);
  // the server's time of the last save this tab knows — what its kept edits build on
  const baseRef = useRef(savedAt);
  const [restored, setRestored] = useState(false);

  const queue = useMemo(() => createSaveQueue<DraftData>(async (slice) => {
    const result = await saveDraftStages(draftId, slice);
    if (!result.ok) throw new Error(result.error);
    if (result.savedAt) baseRef.current = result.savedAt;
  }), [draftId]);

  const flush = useCallback(async () => {
    setSaveState("saving");
    try {
      await queue.flush();
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      // Issuing must stop when the latest price has not reached the server.
      throw error;
    } finally {
      if (savedAt) keepPending(draftId, queue.pending(), baseRef.current);
    }
  }, [draftId, savedAt, queue]);

  const patch = useCallback(
    (slice: Partial<DraftData>) => {
      setData((current) => ({ ...current, ...slice }));
      queue.patch(slice);
      if (savedAt) keepPending(draftId, queue.pending(), baseRef.current);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush().catch(() => undefined), 700);
    },
    [draftId, flush, savedAt, queue],
  );

  // A save the last visit could not make comes back here, on top of the saved
  // draft, and goes up — after mount, so the server render stays the same.
  useEffect(() => {
    const restore = window.setTimeout(() => {
      const slice = savedAt ? readPending(draftId, savedAt) : null;
      if (!slice) return;
      setData((current) => ({ ...current, ...slice }));
      queue.patch({ ...slice, ...queue.pending() });
      setRestored(true);
      void flush().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(restore);
  }, [draftId, flush, savedAt, queue]);

  /** Adopt a draft the server already saved — WITHOUT scheduling a save back. */
  const replace = useCallback(
    (next: DraftData) => {
      queue.clear();
      if (savedAt) keepPending(draftId, {}, baseRef.current);
      setData(next);
    },
    [draftId, savedAt, queue],
  );

  // never lose pending work on unmount / stage navigation
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void flush().catch(() => undefined);
    };
  }, [flush]);

  return { data, patch, replace, flush, saveState, restored };
}
