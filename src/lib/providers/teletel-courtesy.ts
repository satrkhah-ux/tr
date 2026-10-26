/**
 * «شكراً» … «عفواً» … «🌹»: a client who closes the talk with a pleasantry is not waiting for an answer (the owner,
 * 2026-10-26: the client always wants to be the one who ends the conversation, and his last rose made the file «بانتظار
 * الرد»). Pure: what a message says, not who sent it — the caller knows the client wrote it.
 */

const WORDS = new Set([
  // thanks and blessings
  "شكرا", "شكراً", "شكر", "جزيلا", "جزيلاً", "مشكور", "مشكورين", "مشكورة", "ممنون", "يعطيك", "يعطيكم", "العافية", "عافية", "جزاك", "جزاكم", "الله", "خير", "خيرا", "بارك", "فيك", "فيكم", "يجزاك", "يجزيك", "يوفقك", "يوفقكم", "يحفظك", "يحفظكم", "يسلمك", "يسلمكم", "يسلم", "يسلمو", "تسلم", "تسلمين", "تسلموا", "ايدك", "ايديك", "ايديكم", "يديك", "يعطيكي", "حياك", "حياكم", "الف", "ألف", "عافيه",
  // agreement
  "تمام", "طيب", "اوكي", "اوك", "أوكي", "ok", "okay", "k", "حاضر", "ابشر", "أبشر", "زين", "ممتاز", "رائع", "جميل", "حلو", "مرة", "مره", "جدا", "جداً",
  // address and farewell
  "لك", "لكم", "لكي", "يا", "غالي", "الغالي", "حبيبي", "اخي", "أخي", "اخوي", "استاذ", "أستاذ", "أستاذي", "استاذي", "بشمهندس", "دكتور", "عزيزي", "مع", "السلامة", "سلامة", "امان", "أمان", "في", "الله", "اللهم", "صلى", "وسلم", "ان", "إن", "شاء", "يارب",
  // english
  "thanks", "thank", "you", "thx", "ty", "great", "good", "nice", "perfect", "bye", "ok", "okay", "cool", "much", "so", "very",
]);

/** letters, digits and Arabic letters — anything else (emoji, hearts, flowers, punctuation) carries no request */
const LETTER = /[\p{L}\p{N}]/u;

export function isClosingCourtesy(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > 80) return false;
  // a question is a request
  if (/[?؟]/.test(raw)) return false;
  const words = raw
    .replace(/[ً-ٰٟـ]/g, "")
    .toLowerCase()
    .split(/[\s,.!،؛:;"'()\-_\/\\]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  // only emoji, hearts, flowers, punctuation: «🌹» «👍» «❤️»
  if (words.length === 0) return !LETTER.test(raw) || /\p{Extended_Pictographic}/u.test(raw);
  return words.length <= 8 && words.every((w) => WORDS.has(w));
}

/** the streak the client's last message started is short: it is the courtesy itself, not a question left unanswered before it */
export const COURTESY_STREAK_MAX_S = 10 * 60;

/**
 * Is this open conversation only «waiting» because the client said thanks (or sent a rose) after we answered?
 * `firstReplyAt`: we did answer at some point; `waitingSince` and `lastActivityAt`: Teletel's clocks (seconds).
 */
export function waitingIsCourtesy(c: { waitingSince: number; firstReplyAt: number | null; lastActivityAt: number; preview: string }): boolean {
  if (!c.waitingSince || !c.firstReplyAt) return false;
  if (c.lastActivityAt - c.waitingSince > COURTESY_STREAK_MAX_S) return false;
  return isClosingCourtesy(c.preview);
}
