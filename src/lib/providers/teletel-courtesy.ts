/**
 * «شكراً» … «عفواً» … «🌹»: a client who closes the talk with a pleasantry is not waiting for an answer (the owner,
 * 2026-10-26: the client always wants to be the one who ends the conversation, and his last rose made the file «بانتظار
 * الرد» — and there are dozens of such closings, not one). Pure: what a message says, not who sent it — the caller knows
 * the client wrote it.
 *
 * Two kinds, because a few words close a talk only sometimes:
 *  · «closing» — thanks, blessings, «you are welcome», «no problem», replies to a greeting, farewells, emoji, hearts, flowers.
 *    They close the talk whatever was said before.
 *  · «agreement» — «تمام», «اوكي», «حاضر», «فهمت», «ان شاء الله»: the client may be closing OR accepting our proposal. They close
 *    the talk only when our last message asked nothing (ourLastAsked); the caller reads that message.
 * A short message (up to 8 words) made ONLY of such vocabulary counts; one word outside it («السعر», «الحجز», a name, a
 * number), a question mark, or a lone answer («لا», «ايه», «نعم», «صح») makes it a request. A voice note and a file are
 * labels, not words, so they never count.
 */

const CLOSING = [
  // thanks and thanking back
  "شكرا", "شكر", "شكرك", "شكراكم", "جزيلا", "مشكور", "مشكورين", "مشكوره", "ممنون", "ممنونك", "تشكر", "يشكرك", "امتنان", "ممتن",
  // «may God give you strength / reward you / bless you / keep you»
  "يعطيك", "يعطيكم", "يعطيكي", "العافيه", "عافيه", "يعافيك", "يعافيكم", "جزاك", "جزاكم", "يجزاك", "يجزيك", "يجزيكم", "بارك", "يبارك", "فيك", "فيكم", "فيكي", "اللهم", "الله", "خير", "خيرا", "يوفقك", "يوفقكم", "يوفق", "وفقك", "وفقكم", "يحفظك", "يحفظكم", "يحفظ", "يسعدك", "يسعدكم", "يسعدني", "اسعدك", "اسعدكم", "يكرمك", "يكرمكم", "يرضي", "يرضيك", "يخليك", "يخليكم", "يرزقك", "يرزقكم", "يستر", "سلمت", "سلمتم", "تسلم", "تسلمين", "تسلموا", "يسلم", "يسلمك", "يسلمكم", "يسلمو", "يسلموا", "ايدك", "ايديك", "ايديكم", "يديك", "الايادي", "قصرت", "قصرتم", "قصرتوا", "ماقصرت", "ماقصرتم", "ماقصرتوا", "عدمناك", "عدمنا", "عدمناكم", "يحرمنا", "يحرمك", "ربي", "ربنا", "يارب", "رب", "صلي", "وسلم", "عليه", "سلامتك", "سلامات", "الف", "الحمد", "لله", "الحمدلله", "حمدلله", "سبحان", "سبحانك", "ماشاء", "شاء", "تبارك", "عليك", "عليكم", "ما", "لا",
  // «you are welcome» and «no problem»
  "عفوا", "العفو", "مافي", "منك", "منكم", "منكي", "عفوك", "الرحب", "الرحاب", "السعه", "والسعه", "على", "ولا", "يهمك", "يهمكم", "يهم", "مو", "مب", "مشكله", "مشكل", "فيه", "في", "عادي", "باس", "بأس", "شي", "شيء", "واجب", "الواجب", "خدمتك", "خدمتكم", "حاضرين", "تحت", "امرك", "امركم",
  // replies to a greeting, farewells
  "هلا", "اهلا", "سهلا", "وسهلا", "ياهلا", "مرحبا", "والله", "بالله", "مرحبتين", "حياك", "حياكم", "حياكي", "وعليكم", "السلام", "ورحمه", "وبركاته", "النور", "نور", "الورد", "صباحالنور", "مساءالنور", "مع", "السلامه", "سلامه", "امان", "معك", "معكم", "اللقاء", "الي", "تصبح", "تصبحون", "تصبحين", "اتشرف", "اتشرفنا", "تشرفنا", "شرفتنا", "الشرف", "شرف", "لنا",
  // address
  "لك", "لكم", "لكي", "يا", "غالي", "الغالي", "غاليه", "حبيبي", "حبيبتي", "اخي", "اخوي", "اختي", "استاذ", "استاذي", "استاذه", "بشمهندس", "دكتور", "دكتوره", "عزيزي", "عزيزتي", "العمر", "طويل", "ياغالي", "ياحبيبي", "يااخي", "ياخوي", "يالغالي", "طال", "عمرك",
  // english
  "thanks", "thank", "you", "thx", "ty", "great", "good", "nice", "perfect", "bye", "cool", "much", "so", "very", "appreciate", "appreciated", "regards", "welcome", "no", "problem", "np", "a", "lot", "have", "day",
];

const AGREE = [
  "تمام", "طيب", "طيبين", "اوكي", "اوكيه", "اوكه", "اوك", "ok", "okay", "k", "kk", "حاضر", "ابشر", "زين", "ممتاز", "رائع", "جميل", "حلو", "ماشي", "تم", "تمت", "خلاص", "خلص", "فهمت", "فهمنا", "فهمتك", "واضح", "وضح", "صار", "يصير", "ان", "انشاء", "انشالله", "شالله", "باذن", "noted", "got", "it", "sure", "good",
];

/** a single word that is an ANSWER to a question, not a closing — «لا», «ما», «في», «على»… need company to mean something */
const NOT_ALONE = new Set(["لا", "ما", "في", "على", "مع", "الي", "لك", "يا", "فيه", "شي", "شيء", "عليك", "عليكم", "معك", "معكم", "خير", "رب", "ربي", "ربنا", "الله", "مشكل", "no", "a", "have", "day", "much", "so", "very", "you", "it", "got", "good", "k", "ان", "شاء", "عفوك"]);

/** the way a word is looked up: the letter forms folded together, so «أوكيه» and «اوكيه», «مشكلة» and «مشكله» meet */
const fold = (w: string) =>
  w
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ىی]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ک/g, "ك")
    .toLowerCase();

const CLOSING_SET = new Set(CLOSING.map(fold));
const AGREE_SET = new Set(AGREE.map(fold));
const NOT_ALONE_SET = new Set([...NOT_ALONE].map(fold));

/** letters and digits (Arabic, Latin, Persian…) — anything else (emoji, hearts, flowers, punctuation) carries no request */
const LETTER = /[\p{L}\p{N}]/u;

export type CourtesyKind = "closing" | "agreement";

export function courtesyKind(text: string | null | undefined): CourtesyKind | null {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > 90) return null;
  // a question is a request
  if (/[?؟]/.test(raw)) return null;
  const words = fold(raw)
    .replace(/(صباح|مساء)\s+النور/g, "$1النور")
    .split(/[\s,.!،؛:;"'()\-_\/\\]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  // only emoji, hearts, flowers, punctuation, a dot: «🌹» «👍» «❤️» «.»
  if (words.length === 0) return !LETTER.test(raw) || /\p{Extended_Pictographic}/u.test(raw) ? "closing" : null;
  // a bare «السلام عليكم» opens a talk; only «وعليكم السلام» answers one
  if (words[0] === "السلام") return null;
  if (words.length > 8) return null;
  if (words.length === 1 && NOT_ALONE_SET.has(words[0])) return null;
  if (!words.every((w) => CLOSING_SET.has(w) || AGREE_SET.has(w))) return null;
  return words.some((w) => AGREE_SET.has(w) && !CLOSING_SET.has(w)) ? "agreement" : "closing";
}

export const isClosingCourtesy = (text: string | null | undefined): boolean => courtesyKind(text) === "closing";

/** the streak the client's last message started is short: it is the courtesy itself, not a question left unanswered before it */
export const COURTESY_STREAK_MAX_S = 10 * 60;

type OpenFact = { waitingSince: number; firstReplyAt: number | null; lastActivityAt: number; preview: string };

/** the kind of closing this open conversation's wait is, when it is nothing but one (we had answered; the streak is the closing itself) */
export function waitingCourtesy(c: OpenFact): CourtesyKind | null {
  if (!c.waitingSince || !c.firstReplyAt) return null;
  if (c.lastActivityAt - c.waitingSince > COURTESY_STREAK_MAX_S) return null;
  return courtesyKind(c.preview);
}

/** thanks, blessings, a rose: closed for sure, no other message needed */
export const waitingIsCourtesy = (c: OpenFact): boolean => waitingCourtesy(c) === "closing";

/** our own last message asked for something — «تمام» after it is an answer, not a goodbye */
const ASKS = /[?؟]|(^|\s)(هل|تبي|تبغي|تبغى|تريد|ترغب|تحب|نحجز|احجز|اكد|أكد|تاكيد|تأكيد|موافق|رايك|رأيك|ارسل|أرسل|ابعث|زودنا|زودني|اخبرني|أخبرنا|اخبرنا|متى|كم|وين|ايش|ماذا|لو سمحت|ممكن|يرجى|الرجاء|نحتاج|محتاجين|اعطنا|أعطنا|حدد|حددوا|اختر|اختار|قرر|قرروا|بانتظار|ننتظر|منتظرين)(\s|$)/;
export const ourLastAsked = (text: string | null | undefined): boolean => ASKS.test((text ?? "").trim());
