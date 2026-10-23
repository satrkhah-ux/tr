import { describe, expect, it } from "vitest";
import { isOfferMessage, isVisaOffer, lastOffer, offerLine, offerText, mayAct, mayRead, stepDue, stepFor, todayGroup, toOfferMsg, validateResult, type OfferMsg, type WorkRow } from "./rules";
import { canOpenPath } from "@/lib/roles/section-access";

describe("follow-up access and work rules", () => {
  const worker = { employeeId: "one", manager: false, claim: true };
  const seller = { employeeId: "one", manager: false, claim: false };
  it("exposes available files without permitting unclaimed writes", () => {
    expect(mayRead({ assigned_to: null, status: "open" }, worker)).toBe(true);
    expect(mayAct({ assigned_to: null }, worker)).toBe(false);
    expect(mayRead({ assigned_to: null, status: "done" }, worker)).toBe(false);
  });
  it("lets a seller work his own offers only, with nothing to claim", () => {
    expect(mayRead({ assigned_to: "one", status: "open" }, seller)).toBe(true);
    expect(mayAct({ assigned_to: "one" }, seller)).toBe(true);
    expect(mayRead({ assigned_to: null, status: "open" }, seller)).toBe(false);
  });
  it("revokes the old worker after reassignment", () => {
    expect(mayRead({ assigned_to: "two", status: "open" }, worker)).toBe(false);
    expect(mayAct({ assigned_to: "two" }, worker)).toBe(false);
    expect(mayAct({ assigned_to: "two" }, { ...worker, manager: true })).toBe(true);
  });
  it("opens the section to the team and the sellers, not to client-list viewers", () => {
    expect(canOpenPath("/followups", (key) => key === "clients.view")).toBe(false);
    expect(canOpenPath("/followups/file", (key) => key === "followups.work")).toBe(true);
    expect(canOpenPath("/followups", (key) => key === "offers.write")).toBe(true);
    expect(canOpenPath("/clients", (key) => key === "followups.work")).toBe(false);
  });
  it("needs a future time only when one is chosen, and a reason to close", () => {
    expect(validateResult("no_answer", null, "")).toBeNull();
    expect(validateResult("later", "2020-01-01", "")).toBe("due");
    expect(validateResult("interested", "invalid", "")).toBe("due");
    expect(validateResult("not_completed", null, "")).toBe("reason");
    expect(validateResult("not_completed", null, "", "السعر")).toBeNull();
    expect(validateResult("not_interested", null, "لا يرغب")).toBeNull();
    expect(validateResult("completed", null, "")).toBeNull();
    expect(validateResult("transferred", null, "x")).toBe("invalid");
    expect(validateResult("toString", null, "x")).toBe("invalid");
  });
});

describe("offer detection (the evaluator's sample, narrowed)", () => {
  const ours = (text: string, extra: Partial<OfferMsg> = {}): OfferMsg => ({ at: 1000, text, fromClient: false, isPrivate: false, senderId: 7, pdf: false, ...extra });
  it("sees a price, a programme link, a file number or a PDF", () => {
    expect(isOfferMessage(ours("سعر البكج للشخصين 8,400 ريال شامل الطيران"))).toBe(true);
    expect(isOfferMessage(ours("الإجمالي: ٦٥٠٠"))).toBe(true);
    expect(isOfferMessage(ours("SAR 4500 total"))).toBe(true);
    expect(isOfferMessage(ours("تفاصيل عرضك https://pkg.traveliun.com/o/abc"))).toBe(true);
    expect(isOfferMessage(ours("رقم الملف: AD-9-7801-20261022"))).toBe(true);
    expect(isOfferMessage(ours("", { pdf: true }))).toBe(true);
  });
  it("does not take a question about a package, or a note, as an offer", () => {
    expect(isOfferMessage(ours("حياك الله، أي نوع بكج تفضل؟ وكم عدد الأشخاص؟"))).toBe(false);
    expect(isOfferMessage(ours("عندنا عروض كثيرة على تركيا"))).toBe(false);
    expect(isOfferMessage(ours("السعر 4500 ريال", { isPrivate: true }))).toBe(false);
    expect(isOfferMessage(ours("كم السعر 4500 ريال؟", { fromClient: true }))).toBe(false);
  });
  it("follows the offer only while the client has not written after it", () => {
    const client = (at: number, text = "تمام"): OfferMsg => ({ at, text, fromClient: true, isPrivate: false, senderId: null, pdf: false });
    expect(lastOffer([client(1), ours("السعر 4500 ريال", { at: 2 }), ours("ننتظر ردك", { at: 3 })])).toMatchObject({ at: 2, lastAt: 3, senderId: 7 });
    expect(lastOffer([ours("السعر 4500 ريال", { at: 2 }), client(3)])).toBeNull();
    expect(lastOffer([client(1), ours("أي وجهة تفضل؟", { at: 2 })])).toBeNull();
    // a private note after the offer is not the client speaking
    expect(lastOffer([ours("السعر 4500 ريال", { at: 2 }), ours("ملاحظة داخلية", { at: 3, isPrivate: true })])).toMatchObject({ at: 2, lastAt: 2 });
  });
  it("stops at an invoice or the bookings after the price, and finds the file number in a PDF's name", () => {
    const client = (at: number): OfferMsg => ({ at, text: "تم التحويل", fromClient: true, isPrivate: false, senderId: null, pdf: false });
    expect(lastOffer([client(1), ours("السعر 4500 ريال", { at: 2 }), ours("تفضل الفاتورة", { at: 3, pdf: true })])).toBeNull();
    expect(lastOffer([client(1), ours("", { at: 2, pdf: true }), ours("هذي حجوزات الفنادق", { at: 3 })])).toBeNull();
    expect(lastOffer([client(1), ours("", { at: 2, pdf: true, serial: "AA-1-13393-20270118" }), ours("تفضل شيك البرنامج", { at: 3 })])).toMatchObject({ at: 2, serial: "AA-1-13393-20270118" });
    expect(isOfferMessage(ours("هذا البرنامج فيه خيارين للفنادق والاسعار شامل الاستقبال"))).toBe(true);
    // an offer's own terms are not a booking
    expect(lastOffer([client(1), ours(`عرض سياحي إلى تركيا ${"تفاصيل البرنامج ".repeat(30)} السعر 9800 ريال · جميع الحجوزات والخدمات تخضع للتوفر`, { at: 2 })])).toMatchObject({ at: 2 });
    expect(toOfferMsg({ id: 3, message_type: 1, content: "", attachments: [{ file_type: "file", data_url: "https://x/rails/AA-1-13393-20270118.pdf?disposition=inline" }] })).toMatchObject({ pdf: true, serial: "AA-1-13393-20270118" });
  });
  it("reads Teletel's message shape: a PDF attachment, activity lines dropped", () => {
    expect(toOfferMsg({ id: 1, message_type: 1, content: null, attachments: [{ file_type: "file", data_url: "https://x/y/offer.pdf" }], sender: { id: 9 } })).toMatchObject({ pdf: true, senderId: 9, fromClient: false });
    expect(toOfferMsg({ id: 2, message_type: 2, content: "تم إسنادها" })).toBeNull();
  });
});

describe("what the card says of the offer (the evaluator's live rows, 2026-10-23)", () => {
  it("keeps the title and the price, without the marks or the company's header", () => {
    expect(offerLine("🌍 **TRAVELIUN | ترافليون للسفر والسياحة** 🇹🇷\n**عرض سياحي مميز إلى تركيا** 🇹🇷\n━━━━━━━━\n**إسطنبول • سبنجا • بورصة**\n💵 **السعر الإجمالي:** 12600 ريال")).toBe("عرض سياحي مميز إلى تركيا 🇹🇷 · 💵 السعر الإجمالي: 12600 ريال");
    expect(offerLine("وهذا عرض ثاني السعر 8045 ريال")).toBe("وهذا عرض ثاني السعر 8045 ريال");
    // a first file's line, already flattened
    expect(offerLine("🌍 **TRAVELIUN | ترافليون للسفر والسياحة** 🇹🇷 **عرض سياحي مميز إلى تركيا** 🇹🇷")).toBe("🌍 🇹🇷 عرض سياحي مميز إلى تركيا 🇹🇷");
  });
  it("names a PDF sent alone by our words beside it", () => {
    const pdf = { at: 100, text: "", fromClient: false, isPrivate: false, senderId: 1, pdf: true };
    expect(offerText([pdf, { ...pdf, at: 160, pdf: false, text: "تفضل شيك البرنامج اندونيسيا\n9 ليالي 10 ايام" }], pdf)).toBe("تفضل شيك البرنامج اندونيسيا");
    expect(offerText([pdf], pdf)).toBe("ملف مرفق (PDF)");
  });
  it("tells a visa's papers from a trip", () => {
    expect(isVisaOffer("**الاوراق المطلوبه** صورة الجواز وصورة شخصية · الرسوم غير مسترده · السعر 750 ريال")).toBe(true);
    expect(isVisaOffer("1-الجواز الاصل صالح لمده 6 شهور على الاقل بعد انتهاء الإقامة · السعر 450 ريال")).toBe(true);
    expect(isVisaOffer("تأشيرة سنغافورة لغرض الأعمال تتطلب نفس المستندات · 600 ريال")).toBe(true);
    expect(isVisaOffer("تفضل استاذي برنامجك السياحي يشمل تاشيرات فيتنام والفنادق · السعر 9800 ريال")).toBe(false);
  });
});

describe("the cadence: two hours, days 1, 3, 7", () => {
  const H = 3600_000;
  const at = Date.parse("2026-10-20T09:00:00Z");
  it("schedules each step from the offer, never back to back", () => {
    expect(stepDue(0, at, at)).toBe(at + 2 * H);
    expect(stepDue(1, at, at + 2 * H)).toBe(at + 24 * H);
    expect(stepDue(2, at, at + 24 * H)).toBe(at + 72 * H);
    // day 1 done late, on day 2.5: day 3 waits twenty hours
    expect(stepDue(2, at, at + 60 * H)).toBe(at + 80 * H);
  });
  it("starts a late file at its latest due step, one catch-up only", () => {
    expect(stepFor(at, at + 3 * H)).toBe(0);
    expect(stepFor(at, at + 30 * H)).toBe(1);
    expect(stepFor(at, at + 100 * H)).toBe(2);
    expect(stepFor(at, at + 169 * H)).toBe(3);
  });
  it("groups «اليوم»: the client wrote back, due today, late; the old list stays out", () => {
    const now = Date.parse("2026-10-23T09:00:00Z");
    const row = { status: "open", source: "price", step: 1, client_waiting: false, stage: "waiting", next_followup_at: "2026-10-23T05:00:00Z" } as WorkRow;
    expect(todayGroup(row, now)).toBe("due");
    expect(todayGroup({ ...row, next_followup_at: "2026-10-22T05:00:00Z" }, now)).toBe("late");
    // came in today with yesterday's step: due, not late, on its first day
    expect(todayGroup({ ...row, created_at: "2026-10-23T02:00:00Z", next_followup_at: "2026-10-22T05:00:00Z" }, now)).toBe("due");
    expect(todayGroup({ ...row, next_followup_at: "2026-10-24T05:00:00Z" }, now)).toBeNull();
    expect(todayGroup({ ...row, client_waiting: true, next_followup_at: null }, now)).toBe("replied");
    expect(todayGroup({ ...row, source: "sla", step: null, stage: "new", next_followup_at: null }, now)).toBeNull();
    expect(todayGroup({ ...row, source: "teletel", step: null, stage: "new", next_followup_at: null }, now)).toBe("due");
  });
});
