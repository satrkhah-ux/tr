/**
 * «الخطاب الرسمي» — one A4 sheet per employee, in the house identity, with their
 * Teletel numbers, the company's terms and tips that stand on those numbers.
 *
 * Pure module (no server-only): the sheet, the test and the sender all read it.
 * Nothing here sends anything — the owner approves the look first.
 */

export type LetterNumbers = {
  /** every Teletel conversation assigned to them now */
  total: number;
  /** clients who confirmed with them: confirmed operations files they sold + «المؤكدون خارج النظام» they entered */
  confirmed: number;
  open: number;
  closed: number;
};

/** minutes from sla_rules: first reply, reply during the conversation */
export type LetterTargets = { firstReply: number; reply: number };

export const letterTerms = (t: LetterTargets): string[] => [
  `أول رد على العميل خلال ${t.firstReply} دقائق من رسالته الأولى.`,
  `أثناء المحادثة لا يتجاوز ردّك ${t.reply} دقيقة.`,
  "لا تُغلق محادثة والعميل ينتظر ردك، ولا تترك محادثة مفتوحة بعد انتهائها.",
  "سجّل كل حجز مؤكد في النظام في نفس اليوم ليُحسب لك.",
  "يكون التواصل مع العميل عبر تيلي تيل فقط، ليبقى كل شيء موثقاً.",
  "أبقِ إشعارات بوت «تنبيهاتي» مفعّلة طوال الدوام، وتابع تنبيهاته أولاً بأول.",
];

export const share = (part: number, total: number): string => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");

/** Letter 2 comes this long after letter 1. */
export const SECOND_LETTER_DAYS = 10;

/**
 * Letter 2's verdict on closing: kept to it, unless 20 or more are still open
 * and not down by a quarter since letter 1.
 * ponytail: fixed thresholds (20 open, −25%); a setting when the owner wants to tune them.
 */
export const closedEnough = (before: LetterNumbers, now: LetterNumbers): boolean => !(now.open >= 20 && now.open > before.open * 0.75);

export const delta = (before: number, now: number): string => (now === before ? "0" : now > before ? `+${now - before}` : `−${before - now}`);

export function comparisonLines(before: LetterNumbers, now: LetterNumbers): string[] {
  const closed = now.closed - before.closed;
  return [
    closed > 0 ? `أغلقت ${closed} محادثة خلال هذه المدة.` : "لم تُغلق أي محادثة خلال هذه المدة.",
    now.open < before.open
      ? `انخفضت محادثاتك المفتوحة من ${before.open} إلى ${now.open}.`
      : now.open > before.open
        ? `ارتفعت محادثاتك المفتوحة من ${before.open} إلى ${now.open}.`
        : `بقيت محادثاتك المفتوحة ${now.open} كما هي.`,
    `العملاء الذين أكّدوا معك: ${now.confirmed} (كانوا ${before.confirmed} في الخطاب رقم 1).`,
  ];
}

export const WITHDRAW_NOTICE = "لم تلتزم بإغلاق المحادثات المنتهية خلال المهلة، وسيتم سحب المحادثات منك آلياً بعد استلامك هذا الخطاب.";
export const COMMITTED_NOTE = "شكراً لالتزامك بإغلاق المحادثات المنتهية، استمر على ذلك.";

/** At most three, the most pressing first; a clean sheet gets praise, not an invented problem. */
export function letterTips(n: LetterNumbers): string[] {
  const tips: string[] = [];
  if (n.total === 0) return ["لا توجد محادثات مسندة لك بعد في تيلي تيل."];
  if (n.open >= 20 && n.open / n.total > 0.5) {
    tips.push(`محادثاتك المفتوحة ${n.open} (${share(n.open, n.total)} من محادثاتك). راجعها: أكمل مع من ينتظر ردك، وأغلق ما انتهى.`);
  }
  if (n.closed === 0) {
    tips.push("لم تُغلق أي محادثة بعد. إغلاق المحادثة المنتهية يُبقي قائمتك واضحة، ويُظهر لك من ينتظرك فعلاً.");
  }
  if (n.confirmed === 0) {
    tips.push("لا يوجد لك حجز مؤكد مسجّل في النظام. إذا أكّد عميل معك فسجّله في النظام ليُحسب لك.");
  } else {
    tips.push(`العملاء الذين أكّدوا معك: ${n.confirmed} (${share(n.confirmed, n.total)} من محادثاتك). تابع المهتمين خلال 24 ساعة من سؤالهم لترفع هذه النسبة.`);
  }
  if (tips.length === 1 && n.confirmed > 0) tips.unshift("قائمتك المفتوحة منظّمة، استمر على هذا المستوى.");
  return tips.slice(0, 3);
}
