/**
 * Free text with phone numbers in it — «طوارئ السفارة: +60 12 319 9854 / 999» —
 * cut into plain text and dialable numbers, so a page can make each number a
 * tel: link and set it left-to-right (inside Arabic text a bare «+62 361 761263»
 * is laid out backwards, «761263 361 62+»).
 *
 * A number is a run of digits and single spaces, optionally led by «+», with at
 * least three digits — so «24 ساعة» stays words while «112» and «1155» dial.
 */
export type PhonePart = { text: string; tel: string | null };

const RUN = /\+?\d(?:[  ]?\d)+/g;

export function phoneParts(text: string): PhonePart[] {
  const parts: PhonePart[] = [];
  let last = 0;
  for (const m of text.matchAll(RUN)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 3) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index), tel: null });
    parts.push({ text: m[0], tel: `tel:${m[0].startsWith("+") ? "+" : ""}${digits}` });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), tel: null });
  return parts;
}

/**
 * Our own Saudi number as it must be dialled from abroad: «0569222111» →
 * «+966 56 922 2111». A traveller calling home from Kuala Lumpur cannot reach a
 * local 05… number, and should not have to know to add the country code.
 * Anything already international, or not a Saudi number, is left as it is.
 */
export function fromAbroad(phone: string): { display: string; tel: string } {
  const digits = phone.replace(/\D/g, "").replace(/^00/, "");
  const local = digits.match(/^0?(5\d{8})$/)?.[1] ?? (digits.startsWith("9665") && digits.length === 12 ? digits.slice(3) : null);
  if (local) {
    return { display: `+966 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`, tel: `tel:+966${local}` };
  }
  const plus = phone.trim().startsWith("+") || phone.trim().startsWith("00");
  return { display: phone.trim(), tel: `tel:${plus ? "+" : ""}${digits}` };
}
