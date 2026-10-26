/**
 * A price as the employee selected it on a hotel site: «SAR 1,890», «US$504»,
 * «ر.س ١٬٢٥٠», «€ 1.234», «RM 720», «2,100 ر.س 1,890 ر.س» (the struck price, then
 * the one to pay). The amount is the LAST one written beside a currency — a site
 * puts the final price after the struck one; with no currency anywhere, the last
 * amount. The currency only from a mark beside a number, never from a word
 * elsewhere in the text («الرسوم» is not «ر.س»). Null currency: not said — the
 * form asks, defaulting to riyals.
 */
export type ReadPrice = { amount: number; currency: string | null };

/** marks that name a currency — matched only touching a number (spaces allowed) */
const MARKS: [RegExp, string][] = [
  [/US\$|\$/u, "USD"],
  [/€/u, "EUR"],
  [/£/u, "GBP"],
  [/₺/u, "TRY"],
  [/฿/u, "THB"],
  [/₹/u, "INR"],
  [/ر\.\s?س\.?|﷼|ريال(?:\s?سعودي)?/u, "SAR"],
  [/د\.\s?إ\.?|درهم(?:\s?إماراتي)?/u, "AED"],
  [/دولار(?:\s?أمريكي)?/u, "USD"],
  [/يورو/u, "EUR"],
  [/رينجت|RM/u, "MYR"],
  [/روبية(?:\s?إندونيسية)?|Rp/u, "IDR"],
  [/ليرة(?:\s?تركية)?|TL/u, "TRY"],
  [/لاري/u, "GEL"],
  [/د\.\s?ك\.?|دينار\s?كويتي/u, "KWD"],
  [/ر\.\s?ق\.?|ريال\s?قطري/u, "QAR"],
  [/جنيه(?:\s?مصري)?/u, "EGP"],
];
const ISO = /^(?:SAR|USD|AED|EUR|GBP|MYR|IDR|THB|TRY|GEL|KWD|QAR|BHD|OMR|EGP|JOD|AZN|MVR|LKR|INR|CHF|JPY|CNY|SGD|AUD|CAD|GEL|KZT|UZS|MAD|TND|PHP|VND|KRW|HKD|MXN|BRL|ZAR|RUB)$/;

const WESTERN = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".")
    .replace(/[  ]/g, " ");

/** «1,234.56», «1.234,56», «1 234», «1.234» (a thousands group), «1234.5» → the number */
function number(raw: string): number | null {
  let s = raw.trim();
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // the later mark is the decimal one
    s = lastDot > lastComma ? s.replace(/[ ,]/g, "") : s.replace(/[ .]/g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    // «1,890» a group; «12,50» a decimal
    s = /,\d{3}(?!\d)/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/[ ,]/g, "") : s.replace(/ /g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    // «1.234» (and «1.234.567») a group when every part after a dot is three digits
    s = /^\d{1,3}(?:\.\d{3})+$/.test(s.replace(/ /g, "")) ? s.replace(/[ .]/g, "") : s.replace(/ /g, "");
  } else s = s.replace(/ /g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function currencyAt(text: string): string | null {
  const t = text.trim();
  const iso = /([A-Za-z]{3})$|^([A-Za-z]{3})/.exec(t);
  const code = (iso?.[1] ?? iso?.[2] ?? "").toUpperCase();
  if (ISO.test(code)) return code;
  for (const [re, cur] of MARKS) {
    const anchored = new RegExp(`(?:${re.source})\\s*$|^\\s*(?:${re.source})`, "u");
    if (anchored.test(t)) return cur;
  }
  return null;
}

export function readPrice(text: string): ReadPrice | null {
  if (!text?.trim()) return null;
  const s = WESTERN(text);
  const found: { amount: number; currency: string | null }[] = [];
  const re = /\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const amount = number(m[0]);
    if (amount == null) continue;
    // the few characters touching the number on either side
    const before = s.slice(Math.max(0, m.index - 14), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 14);
    found.push({ amount, currency: currencyAt(before.split(/[\d|•·\n]/).pop() ?? "") ?? currencyAt(after.split(/[\d|•·\n]/)[0] ?? "") });
  }
  if (!found.length) return null;
  const priced = found.filter((f) => f.currency);
  return (priced.length ? priced : found).at(-1) ?? null;
}
