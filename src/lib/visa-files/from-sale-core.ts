import { fold } from "./rules";

/**
 * «عند بيع تأشيرة يُفتح ملفها تلقائياً» (the owner, 2026-10-26: «عندما يتم بيع تأشيرة … يفتح اسم العميل والدولة
 * والخدمة المطلوبة ويكون الملف جاهز للموظف للمراجعة والإدخال»). The sale is the client's confirmation of a file
 * (operations.ts recordConfirmation); its visa lines come from the draft that was issued. Pure: no database here.
 */

export type SaleVisaLine = { country: string; visaType: string | null; applicants: number; note: string | null };

/** the timeline's and the file note's first words — what finds a sale's files again, so one sale never opens a file twice */
export const saleMarker = (serial: string) => `من البيع ${serial}`;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The visa lines the issued draft sells: one per country and type, the heads added up; none when the visas switch was off. */
export function saleVisaLines(draft: Record<string, unknown> | null): SaleVisaLine[] {
  if (!draft || (draft.scope as { visas?: unknown } | null | undefined)?.visas === false) return [];
  const raw = Array.isArray(draft.visas) ? draft.visas : [];
  const lines = new Map<string, SaleVisaLine>();
  for (const item of raw) {
    const v = (item ?? {}) as Record<string, unknown>;
    const country = text(v.country);
    if (!country) continue;
    const heads = Math.min(50, Math.max(1, Math.floor(Number(v.count)) || 1));
    const visaType = text(v.visa_type) || null;
    const key = `${fold(country)}|${fold(visaType ?? "")}`;
    const seen = lines.get(key);
    if (seen) {
      seen.applicants = Math.min(50, seen.applicants + heads);
      seen.note = seen.note ?? (text(v.note) || null);
    } else {
      lines.set(key, { country, visaType, applicants: heads, note: text(v.note) || null });
    }
  }
  return [...lines.values()];
}

/** the catalogue row a sale line follows: the same country and type, else the country's only row — never a guess between several */
export function catalogFor<T extends { country: string | null; visa_type: string | null }>(line: SaleVisaLine, rows: T[]): T | null {
  const ofCountry = rows.filter((r) => fold(r.country ?? "") === fold(line.country));
  const typed = line.visaType ? ofCountry.find((r) => fold(r.visa_type ?? "") === fold(line.visaType as string)) : undefined;
  return typed ?? (ofCountry.length === 1 ? ofCountry[0] : null);
}
