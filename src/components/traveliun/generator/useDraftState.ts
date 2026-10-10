"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveDraftStages } from "@/lib/data/drafts";
import type { DraftData } from "@/lib/offer/draft-types";

export type SaveState = "idle" | "saving" | "saved" | "error";

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
    const result = await saveDraftStages(draftId, slice);
    setSaveState(result.ok ? "saved" : "error");
  }, [draftId]);

  const patch = useCallback(
    (slice: Partial<DraftData>) => {
      setData((current) => ({ ...current, ...slice }));
      pendingRef.current = { ...pendingRef.current, ...slice };
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  /** Adopt a draft the server already saved — WITHOUT scheduling a save back. */
  const replace = useCallback((next: DraftData) => {
    pendingRef.current = {};
    setData(next);
  }, []);

  // never lose pending work on unmount / stage navigation
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void flush();
    };
  }, [flush]);

  return { data, patch, replace, flush, saveState };
}
