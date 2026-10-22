import type { DraftData } from "@/lib/offer/draft-types";

/**
 * What a tab could not save yet, as it is kept in localStorage: the edits
 * (`slice`), when they were last written (`at`, this PC's clock), and the
 * server's own time of the last save they build on (`base`).
 */
export type PendingEntry = { at: number; base?: string; slice: Partial<DraftData> };

export const PENDING_MAX_AGE = 12 * 3_600_000;

/**
 * The kept edits a reload should replay onto the draft as the server has it
 * now (`savedAt`), or null to drop them.
 *
 * Replayed when nobody saved the draft since the save they build on — both
 * times are the server's, so a PC clock running a few seconds behind can no
 * longer make fresh edits look older than the last save and throw them away
 * (the deploy of 2026-10-22). Or, as before, when they were typed after that
 * save. Never older than twelve hours.
 */
export function pendingToReplay(raw: string | null, savedAt: string, now: number): Partial<DraftData> | null {
  if (!raw) return null;
  try {
    const { at, base, slice } = JSON.parse(raw) as PendingEntry;
    if (!slice || typeof slice !== "object" || Object.keys(slice).length === 0) return null;
    if (!(now - at < PENDING_MAX_AGE)) return null;
    const server = Date.parse(savedAt);
    const untouched = typeof base === "string" && Date.parse(base) >= server;
    return untouched || at > server ? slice : null;
  } catch {
    return null;
  }
}
