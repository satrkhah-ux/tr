import { classifyInquiry, type Place } from "./auto";
import { inferConversationDestination } from "./destination";
import { requestText } from "./request-text";

type Message = { id: number; at: number; text: string; fromClient: boolean; isPrivate: boolean };

/** Keep the request through its follow-up details. A question about what a
 * package includes is not a new request for flights, hotels or a driver. */
export function classifyConversationInquiry(messages: Message[], places: Place[], since: number, labels: string[] = [], manualDestination: string | null = null): string {
  const client = messages.filter(m => m.fromClient && !m.isPrivate).sort((a,b) => a.at-b.at || a.id-b.id);
  let service: string | null = null;
  let serviceAt = 0;
  let fromAdvert = false;
  for (const message of client) {
    const text = requestText(message.text);
    const normalized = text.replace(/[أإآ]/g,"ا").replace(/[ـ\u064b-\u065f]/g,"").trim();
    if (/^(?:(?:طيب|هل)\s+)?(?:شامل|يشمل|مع\s*(?:ال)?طيران|مع\s*(?:ال)?تذاكر)/.test(normalized)) continue;
    const travelRequest = /عروض|عرض|جولات|جدول|رحل[ةه]|بكج|برنامج|سياح/.test(normalized);
    let kind = classifyInquiry([], text);
    if ((!kind || kind === "طلب غير واضح") && travelRequest && inferConversationDestination([message], places).destination) kind = "بكج";
    if (!kind || kind === "طلب غير واضح") continue;
    const request = /^(?:(?:طيب|انا|لو سمحت|لوتكرمتي)\s+)?(?:ابي|ابغى|اريد|نبي|نبغى|عايز|عاوز|محتاج|احتاج|بدي|ودي|حابه|حاب|ممكن|استخراج|تقديم|حجز)\s*.{0,22}(?:بكج|باكج|برنامج|تاشير|تئشير|فيزا|فيزه|رخص|طيران|تذاكر|تذكره|فندق|فنادق|سياره|سيارة|سائق)/.test(normalized)
      || /(?:اسال|استفسر|استفسار|تفاصيل)\s+عن\s*.{0,20}(?:تاشير|فيزا|فيزه|بكج|طيران|فندق)/.test(normalized);
    const change = /(?:بدل|غيرت|خلها|غيرها)\s*.{0,15}(?:بكج|طيران|تاشير|فيزا|فندق|سيار|سائق)|(?:فقط|بس)\s*(?:(?:ابي|ابغى|احتاج|اريد)\s*)?(?:ال)?(?:بكج|طيران|تاشير|فيزا|فندق|سيار|سائق)/.test(normalized);
    const packageDetails = service === "بكج" && kind !== "بكج" && !/فقط|بس|بدل|غيرت/.test(normalized)
      && (/جولات|جدول|برنامج|بكج/.test(normalized) || /^(?:شامل|مع|الفندق|السائق|كم الطيران)/.test(normalized));
    const packageRequest = kind === "بكج" && /بكج|باكج|شهر\s*عسل|جدول\s*سياحي/.test(normalized);
    if (!service || (!packageDetails && (fromAdvert || packageRequest || request || change || (serviceAt < since && message.at >= since && normalized.split(/\s+/).length <= 3)))) {
      service = kind;
      serviceAt = message.at;
      fromAdvert = /مرحبا بكم في ترافليون|احجز بكجات سفر مع ترافليون/.test(message.text);
    }
  }
  if (service) return service;
  const inferred = inferConversationDestination(messages, places, since);
  const destination = inferred.destination ?? (inferred.ambiguous ? "وجهات متعددة" : manualDestination);
  return classifyInquiry(labels, "", { destination }) || "طلب غير واضح";
}
