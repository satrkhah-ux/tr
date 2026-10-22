import { fold } from "@/lib/leads/sheet";
import type { TurnMessage } from "./core";
export function latestClientQuestion(messages: TurnMessage[]): string {
  const publicMessages = messages.filter((m) => !m.isPrivate).sort((a, b) => a.at - b.at || a.id - b.id);
  const lastReply = publicMessages.findLastIndex((m) => !m.fromClient);
  return publicMessages.slice(lastReply + 1).filter((m) => m.fromClient).map((m) => m.text).join("\n");
}
export const asksVisaPrice = (text: string) => /سعر|تكلف|بكم|بكام|رسوم|price|cost|how much/i.test(text);
export const futureImageReview = (text: string) => /(?:سوف|سأ|ساقوم|سأقوم|راح|سنقوم|سأعمل|ساعمل|ساراجع|سأراجع|سأفحص|جاري|جارٍ)[^.!؟\n]{0,55}(?:مراجع|راجع|فحص|تحليل|الصور|الجواز)/u.test(text);
/** A price answer is grounded in the catalogue, never optional model prose. */
export function visaPriceAnswer(country: string | null, catalog: unknown, includePrice: boolean): string {
  if (!includePrice) return "بخصوص السعر: يؤكده لك مختص التأشيرات؛ عرض الأسعار غير متاح في هذه المحادثة حالياً.";
  if (!country) return "بخصوص السعر: ما الدولة ونوع التأشيرة المطلوبة حتى أحدد لك السعر الصحيح؟";
  const rows = Array.isArray(catalog) ? catalog.filter((r) => r && typeof r === "object" && typeof r.country === "string" && fold(r.country) === fold(country)) as { sell_price?: number | null; sell_currency?: string | null; visa_type?: string | null }[] : [];
  const priced = rows.filter((r) => typeof r.sell_price === "number" && r.sell_price > 0 && r.sell_currency);
  if (!priced.length) return `بخصوص سعر تأشيرة ${country}: لا يوجد سعر معتمد مسجّل حالياً؛ يحدده مختص التأشيرات حسب تفاصيل الطلب. يمكننا متابعة تجهيز البيانات دون انتظار التسعير.`;
  return `الأسعار المسجّلة لتأشيرة ${country} للشخص:\n` + priced.map((r) => `${r.visa_type || "التأشيرة"}: ${r.sell_price!.toLocaleString("en-US")} ${r.sell_currency}`).join("\n") + "\nيؤكد المختص انطباق السعر على الجنسية ونوع الطلب قبل الدفع.";
}
