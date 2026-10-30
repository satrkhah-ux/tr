import { describe, expect, it } from "vitest";
import { emptyDraftData, emptyFlight, normalizeDraftData, stayCancellation, type DraftData } from "@/lib/offer/draft-types";
import { addCity } from "@/lib/offer/basic";
import { clientPolicy, draftRefund, endOfRiyadhDay, FLIGHT_POLICY, refundBadge, reminderStep, reminderText, riyadhDay } from "./refund-mode";
import { planBookingsFromDraft } from "./seed-plan";
import { cancellationDeadlineNear, type OperationSnapshot } from "./signals";
import { preparedMessages } from "./client-booking-state";
import { shownDetail } from "./voucher-dto";

function trip(hotel: { refundable?: boolean | null; refundable_until?: string | null; pay_by?: string | null }): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", arrival_date: "2026-11-20", nights: 4, adults: 2 };
  data.scope = { ...data.scope, hotels: true, flights_intl: true };
  data = { ...data, ...addCity(data, { name: "كوالالمبور", nights: 4, tours: 0, hotel: { id: "h1", name: "بولمان" }, room: "ديلوكس", rooms: 1, price: 1600 }, "SAR") };
  data.hotels = data.hotels.map((h) => ({ ...h, ...hotel }));
  data.flights = [
    { ...emptyFlight("outbound"), flight_no: "SV834", from_airport: "RUH", to_airport: "KUL", departure_at: "2026-11-20T01:00", arrival_at: "2026-11-20T14:30" },
    { ...emptyFlight("inbound"), flight_no: "SV835", from_airport: "KUL", to_airport: "RUH", departure_at: "2026-11-24T16:00", arrival_at: "2026-11-24T20:00" },
  ];
  return normalizeDraftData(data);
}

describe("the draft's refund mode", () => {
  it("keeps the three choices apart — pay_by only without a refundable mark", () => {
    expect(draftRefund({ refundable: false })).toEqual({ mode: "non_refundable", date: null });
    expect(draftRefund({ refundable: true, refundable_until: "2026-11-10" })).toEqual({ mode: "refundable_until", date: "2026-11-10" });
    expect(draftRefund({ pay_by: "2026-11-05" })).toEqual({ mode: "pay_by", date: "2026-11-05" });
    expect(draftRefund({ refundable: false, pay_by: "2026-11-05" })?.mode).toBe("non_refundable");
    expect(draftRefund({})).toBeNull();
    expect(draftRefund({ pay_by: "" })).toBeNull();
  });

  it("normalises: an older line stays as it was, a bad or clashing pay_by is dropped", () => {
    expect(trip({ pay_by: "2026-11-05" }).hotels[0].pay_by).toBe("2026-11-05");
    expect(trip({ pay_by: "5/11" }).hotels[0].pay_by).toBeUndefined();
    expect(trip({ refundable: true, pay_by: "2026-11-05" }).hotels[0].pay_by).toBeUndefined();
    expect(trip({ refundable: true, refundable_until: "2026-11-10" }).hotels[0].refundable_until).toBe("2026-11-10");
  });

  it("never prints the hold on the client's offer", () => {
    expect(stayCancellation({ sourcing: null, refundable: null, refundable_until: null })).toBeNull();
    expect(stayCancellation(trip({ pay_by: "2026-11-05" }).hotels[0])).toBeNull();
    expect(stayCancellation({ sourcing: null, refundable: true, refundable_until: "2026-11-10" })).toBe("قابل للاسترداد حتى 2026-11-10");
  });
});

describe("the pull carries it to operations", () => {
  const hotelOf = (d: DraftData) => planBookingsFromDraft(d, "شروط الشركة").find((r) => r.kind === "hotel")!;

  it("a pay_by stay: the policy, the day's end in Riyadh, the mode — the mode never printed", () => {
    const h = hotelOf(trip({ pay_by: "2026-11-05" }));
    expect([h.cancellation_policy, h.cancellation_deadline, h.detail.refund_mode]).toEqual(["يُلغى إن لم يُدفع قبل 2026-11-05", "2026-11-05T20:59:59.000Z", "pay_by"]);
    expect(shownDetail(h.detail).refund_mode).toBeUndefined();
    expect(clientPolicy(h.cancellation_policy, h.detail)).toBeNull();
  });

  it("refundable until / non-refundable / unsaid", () => {
    const r = hotelOf(trip({ refundable: true, refundable_until: "2026-11-10" }));
    expect([r.cancellation_policy, riyadhDay(r.cancellation_deadline), r.detail.refund_mode]).toEqual(["قابل للاسترداد حتى 2026-11-10", "2026-11-10", "refundable_until"]);
    const n = hotelOf(trip({ refundable: false }));
    expect([n.cancellation_policy, n.cancellation_deadline, n.detail.refund_mode]).toEqual(["غير قابل للاسترداد", null, "non_refundable"]);
    const u = hotelOf(trip({}));
    expect([u.cancellation_policy, u.cancellation_deadline, u.detail.refund_mode]).toEqual(["شروط الشركة", null, undefined]);
  });

  it("flights: non-refundable once issued", () => {
    const f = planBookingsFromDraft(trip({}), "x").find((r) => r.kind === "flight")!;
    expect([f.cancellation_policy, f.detail.refund_mode]).toEqual([FLIGHT_POLICY, "non_refundable"]);
  });
});

describe("the deadline signal", () => {
  const TODAY = "2026-11-02";
  const op = (b: Partial<OperationSnapshot["bookings"][number]>): OperationSnapshot => ({
    client_status: "confirmed",
    execution_status: "pending_bookings",
    travel_start: "2026-11-20",
    total: null,
    paid: 0,
    bookings: [{ id: "b1", kind: "hotel", title: "أ", status: "pending", cancellation_deadline: endOfRiyadhDay("2026-11-04"), ...b }],
    documents: [],
    travelers: [],
  });

  it("a pay_by hold fires before it is confirmed, and stops once paid", () => {
    expect(cancellationDeadlineNear(op({ refund_mode: "pay_by" }), TODAY)).toEqual(["أ"]);
    expect(cancellationDeadlineNear(op({ refund_mode: "pay_by", status: "prebooked" }), TODAY)).toEqual(["أ"]);
    expect(cancellationDeadlineNear(op({ refund_mode: "pay_by", is_paid: true }), TODAY)).toEqual([]);
    expect(cancellationDeadlineNear(op({ refund_mode: "pay_by", status: "cancelled" }), TODAY)).toEqual([]);
  });

  it("everything else keeps the confirmed-only rule", () => {
    expect(cancellationDeadlineNear(op({ refund_mode: "refundable_until" }), TODAY)).toEqual([]);
    expect(cancellationDeadlineNear(op({ refund_mode: "refundable_until", status: "confirmed" }), TODAY)).toEqual(["أ"]);
    expect(cancellationDeadlineNear(op({ refund_mode: "pay_by", cancellation_deadline: endOfRiyadhDay("2026-11-09") }), TODAY)).toEqual([]);
  });
});

describe("the reminders", () => {
  it("3 days, 1 day, the day itself — a missed morning caught by the next", () => {
    const day = "2026-11-05";
    expect(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((t) => reminderStep(day, t))).toEqual([null, 3, 3, 1, 0, null]);
  });

  it("says it in the owner's words", () => {
    expect(reminderText("pay_by", "بولمان", "2026-11-05", "2026-11-04")).toBe("⏳ ادفع قبل 2026-11-05 (بعد يوم) وإلا يُلغى الحجز: بولمان");
    expect(reminderText("refundable_until", "بولمان", "2026-11-05", "2026-11-05")).toBe("⏳ آخر يوم للإلغاء المجاني اليوم 2026-11-05: بولمان");
  });

  it("the row's badge: red within 3 days unpaid", () => {
    expect(refundBadge("pay_by", "2026-11-05", false, "2026-11-03")).toEqual({ text: "يُلغى إن لم يُدفع قبل 2026-11-05", tone: "red" });
    expect(refundBadge("pay_by", "2026-11-20", false, "2026-11-03")?.tone).toBe("amber");
    expect(refundBadge("pay_by", "2026-11-05", true, "2026-11-03")?.tone).toBe("green");
    expect(refundBadge("refundable_until", "2026-11-20", false, "2026-11-03")).toEqual({ text: "استرجاع حتى 2026-11-20", tone: "green" });
    expect(refundBadge("non_refundable", null, false, "2026-11-03")?.text).toBe("غير مسترجع");
    expect(refundBadge(null, null, false, "2026-11-03")).toBeNull();
  });
});

describe("the client's reminder — prepared, never sent", () => {
  const hotel = {
    id: "b1",
    kind: "hotel",
    title: "بولمان",
    city_name: "كوالالمبور",
    start_date: "2026-11-20",
    end_date: "2026-11-24",
    status: "pending",
    confirmation_number: null,
    company_ref: null,
    is_paid: false,
    cancellation_deadline: endOfRiyadhDay("2026-11-05"),
    detail: { refund_mode: "pay_by" },
  };
  const base = { hello: "عميلنا أحمد،", destination: "ماليزيا", serial: "AD-1", link: "https://x/trip/t", voucherStays: [], sent: new Set<string>(), today: "2026-11-03", owed: true };

  it("within 3 days, unpaid, the client owing: one reminder that never says «held»", () => {
    const [m, ...rest] = preparedMessages({ ...base, bookings: [hotel] });
    expect(rest).toEqual([]);
    expect(m.key).toBe("paydue:b1:2026-11-05");
    expect(m.body).toContain("نذكّركم بأن حجز فندق بولمان في كوالالمبور يتطلب إتمام السداد قبل");
    expect(m.body).not.toContain("يُلغى");
  });

  it("not when paid, nothing owed, too early, or already sent", () => {
    expect(preparedMessages({ ...base, bookings: [{ ...hotel, is_paid: true }] })).toEqual([]);
    expect(preparedMessages({ ...base, owed: false, bookings: [hotel] })).toEqual([]);
    expect(preparedMessages({ ...base, today: "2026-10-30", bookings: [hotel] })).toEqual([]);
    expect(preparedMessages({ ...base, sent: new Set(["paydue:b1:2026-11-05"]), bookings: [hotel] })).toEqual([]);
  });
});
