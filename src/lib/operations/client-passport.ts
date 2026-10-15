/**
 * The client's passport uploads from the trip link (operations order 11) —
 * the rules, without I/O.
 *
 * An upload is a SUBMISSION: it waits for staff, and never writes the
 * traveller's verified passport by itself. The client learns only that it
 * arrived; what was read off the photo stays on our side.
 */

export type SubmissionStatus = "pending" | "accepted" | "rejected" | "superseded";

/** Uploads per traveller in any 24 hours — enough to retake a blurry photo, too few to abuse the reader. */
export const CLIENT_PASSPORT_DAILY_LIMIT = 3;
export const CLIENT_PASSPORT_MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
/** What the MRZ reader is handed — a picture; a PDF is stored for staff to read. */
export const MRZ_READABLE = /^image\/(jpeg|png|webp)$/;

export type FileProblem = "empty" | "too_large" | "type";

export function checkPassportFile(file: { size: number; type: string }): FileProblem | null {
  if (file.size === 0) return "empty";
  if (file.size > CLIENT_PASSPORT_MAX_BYTES) return "too_large";
  if (!ACCEPTED_TYPE.test(file.type)) return "type";
  return null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The cap is a count over the table: uploads of this traveller in the 24 hours before `now`. */
export function uploadAllowed(createdAts: string[], now: Date): boolean {
  const since = now.getTime() - DAY_MS;
  return createdAts.filter((c) => Date.parse(c) > since).length < CLIENT_PASSPORT_DAILY_LIMIT;
}

/** What the client sees per traveller. */
export type ClientPassportState = "needed" | "received" | "on_file" | "retake" | "update";

/**
 * `latest` is the traveller's newest submission. A passport already on file
 * (typed by staff or accepted earlier) reads as received — unless operations
 * flagged it (`flagged`: travelers.ts passportNeedsUpdate — expired, under six
 * months, or the age disagrees with the booking), then a valid one is asked
 * for. A rejected photo asks for another only while nothing is on file.
 */
export function clientPassportState(hasPassport: boolean, latest: SubmissionStatus | null, flagged = false): ClientPassportState {
  if (latest === "pending") return "received";
  if (hasPassport && flagged) return "update";
  if (hasPassport || latest === "accepted") return "on_file";
  if (latest === "rejected") return "retake";
  return "needed";
}

/** The newest PENDING submission per traveller — what staff review; older ones were superseded on upload. */
export function latestPending<T extends { traveler_id: string; status: SubmissionStatus; created_at: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) {
    if (r.status !== "pending") continue;
    const seen = out[r.traveler_id];
    if (!seen || r.created_at > seen.created_at) out[r.traveler_id] = r;
  }
  return out;
}
