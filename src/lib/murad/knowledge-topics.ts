/** «ذاكرة مُراد»'s subjects and shape — no server code, so the settings page can show them (knowledge.ts folds them). */
export const TOPICS = { visa: "التأشيرات", package: "البكجات والوجهات", flight: "الطيران", hotel: "الفنادق", transport: "المواصلات", general: "عام وسياسات" } as const;
export type Topic = keyof typeof TOPICS;
export type Knowledge = { at: string | null; topics: Partial<Record<Topic, { at: string; lessons: number; items: { q: string; a: string }[] }>> };

/**
 * When a subject's reference is read again. The backlog sweep adds about 1,200 lessons an hour, so «40 new» was true every
 * few minutes and the strong model re-read 400 lessons for a subject every minute (the owner, 2026-10-26: «openAI يستهلك
 * كثيرا»): now a subject is folded when it has 300 new lessons AND three hours have passed since its last fold, or when its
 * reference is twelve hours old — at most 8 folds a day per subject, not a thousand.
 */
export const FOLD_NEW_ENOUGH = 300;
export const FOLD_MIN_GAP_MS = 3 * 3600_000;
export const FOLD_STALE_MS = 12 * 3600_000;

export function foldDue(lessons: number, was: { at: string; lessons: number } | undefined, now: number): boolean {
  if (lessons <= 0) return false;
  if (!was) return true;
  const age = now - Date.parse(was.at);
  return age > FOLD_STALE_MS || (age >= FOLD_MIN_GAP_MS && lessons - was.lessons >= FOLD_NEW_ENOUGH);
}

