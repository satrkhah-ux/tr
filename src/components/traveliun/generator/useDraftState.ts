"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveDraftStages } from "@/lib/data/drafts";
import type { DraftData } from "@/lib/offer/draft-types";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * What has not reached the server yet, kept in the browser too: a deploy
 * mid-shift turned the save into a 404 and the reload that followed lost the
 * prices just typed. ponytail: twelve hours, then dropped — an older slice
 * could overwrite what another screen saved since; a server version check
 * would make this exact.
 */
const PENDING_KEY = (draftId: string) => `tv-draft-pending:${draftId}`;
const PENDING_MAX_AGE = 12 * 3_600_000;
function keepPending(draftId: string, slice: Partial<DraftData>) {
  try {
    if (Object.keys(slice).length === 0) window.localStorage.removeItem(PENDING_KEY(draftId));
    else window.localStorage.setItem(PENDING_KEY(draftId), JSON.stringify({ at: Date.now(), slice }));
  } catch {
    // private window, storage full — the server save still runs
  }
}
function readPending(draftId: string): Partial<DraftData> | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY(draftId));
    if (!raw) return null;
    const { at, slice } = JSON.parse(raw) as { at: number; slice: Partial<DraftData> };
    return Date.now() - at < PENDING_MAX_AGE && slice && typeof slice === "object" ? slice : null;
  } catch {
    return null;
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
): {
  data: DraftData;
  patch: (slice: Partial<DraftData>) => void;
  replace: (next: DraftData) => void;
  flush: () => Promise<void>;
  saveState: SaveState;
} {
  const [data, setData] = useState<DraftData>(initialData);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pendingRef = useRef<Partial<DraftData>>({});
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(async () => {
    const slice = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(slice).length === 0) return;
    setSaveState("saving");
    try {
      const result = await saveDraftStages(draftId, slice);
      if (!result.ok) pendingRef.current = { ...slice, ...pendingRef.current };
      keepPending(draftId, pendingRef.current);
      setSaveState(result.ok ? "saved" : "error");
    } catch {
      // The call itself failed — offline, or this tab is from before a deploy
      // and the server no longer knows its action. It never resolved before,
      // so «جارٍ الحفظ» spun forever; now it says so, and the work is kept to
      // go up with the next save.
      pendingRef.current = { ...slice, ...pendingRef.current };
      keepPending(draftId, pendingRef.current);
      setSaveState("error");
    }
  }, [draftId]);

  const patch = useCallback(
    (slice: Partial<DraftData>) => {
      setData((current) => ({ ...current, ...slice }));
      pendingRef.current = { ...pendingRef.current, ...slice };
      keepPending(draftId, pendingRef.current);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), 700);
    },
    [draftId, flush],
  );

  // A save the last visit could not make comes back here, on top of the saved
  // draft, and goes up — after mount, so the server render stays the same.
  useEffect(() => {
    const restore = window.setTimeout(() => {
      const slice = readPending(draftId);
      if (!slice) return;
      setData((current) => ({ ...current, ...slice }));
      pendingRef.current = { ...slice, ...pendingRef.current };
      void flush();
    }, 0);
    return () => window.clearTimeout(restore);
  }, [draftId, flush]);

  /** Adopt a draft the server already saved — WITHOUT scheduling a save back. */
  const replace = useCallback(
    (next: DraftData) => {
      pendingRef.current = {};
      keepPending(draftId, {});
      setData(next);
    },
    [draftId],
  );

  // never lose pending work on unmount / stage navigation
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void flush();
    };
  }, [flush]);

  return { data, patch, replace, flush, saveState };
}
