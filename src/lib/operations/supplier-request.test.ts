import { describe, expect, it } from "vitest";
import {
  assigneeGroups,
  assigneesFor,
  bookingCost,
  countryInName,
  isOpsTeam,
  buildSupplierRequest,
  requestState,
  supplierBalances,
  suppliersFor,
  type SupplierRequestInput,
} from "./supplier-request";

// AD-6-3056: a tour in Kuala Lumpur, as the seed writes it
const tour: SupplierRequestInput = {
  lang: "en",
  reference: "AD-6-3056-20261012",
  contact: "Mr. Lim",
  booking: {
    kind: "service",
    title: "جولة: جولة سياحية في كوالالمبور",
    city_name: "كوالالمبور",
    start_date: "2026-11-03",
    end_date: null,
    detail: { المدينة: "كوالالمبور", "وقت الانطلاق": "09:00", السيارة: "فان", الركاب: "4" },
  },
  travelers: [
    { name: "AHMED ALI", kind: "adult" },
    { name: "SARA ALI", kind: "adult" },
    { name: "OMAR ALI", kind: "child" },
    { name: "", kind: "child" },
  ],
  note: null,
  glossary: { كوالالمبور: "Kuala Lumpur", فان: "Van" },
};

describe("buildSupplierRequest", () => {
  it("writes an English request with the passport names and the tour's start", () => {
    const { subject, body } = buildSupplierRequest(tour);
    expect(subject).toBe("Booking request AD-6-3056-20261012 — Tour: City tour in Kuala Lumpur");
    expect(body).toContain("Dear Mr. Lim,");
    expect(body).toContain("Our reference: AD-6-3056-20261012");
    expect(body).toContain("Date: 2026-11-03");
    expect(body).toContain("• Start time: 09:00");
    expect(body).toContain("• Vehicle: Van");
    expect(body).toContain("1. AHMED ALI (adult)");
    expect(body).toContain("3. OMAR ALI (child)");
    // a blank name is not a traveller
    expect(body).not.toContain("4.");
    // the city is said once, not again as a detail
    expect(body.match(/Kuala Lumpur/g)?.length).toBe(2);
  });

  it("translates a transfer's meeting point, pax and arrow", () => {
    const { body } = buildSupplierRequest({
      ...tour,
      booking: {
        kind: "transport",
        title: "المطار ← فندق كوالالمبور",
        city_name: "كوالالمبور",
        start_date: "2026-11-01",
        end_date: null,
        detail: { الوقت: "15:45", الرحلة: "SV834 RUH → KUL", "نقطة الالتقاء": "صالة القادمين — KUL", الركاب: "2 بالغ + 2 طفل" },
      },
    });
    expect(body).toContain("Service: Airport → Hotel Kuala Lumpur");
    expect(body).toContain("• Meeting point: Arrivals hall — KUL");
    expect(body).toContain("• Flight: SV834 RUH → KUL");
    expect(body).toContain("• Passengers: 2 adults + 2 children");
  });

  it("writes a hotel request in Arabic with check-in and check-out and numbered rooms", () => {
    const { body } = buildSupplierRequest({
      ...tour,
      lang: "ar",
      contact: null,
      booking: {
        kind: "hotel",
        title: "فندق الريتز",
        city_name: "لنكاوي",
        start_date: "2026-11-05",
        end_date: "2026-11-08",
        detail: { "الغرفة 1": "ديلوكس — شامل الإفطار", "عدد الليالي": "3" },
      },
      travelers: [],
      note: "غرفتان متجاورتان",
    });
    expect(body).toContain("السلام عليكم،");
    expect(body).toContain("الدخول: 2026-11-05");
    expect(body).toContain("الخروج: 2026-11-08");
    expect(body).toContain("• الغرفة 1: ديلوكس — شامل الإفطار");
    expect(body).toContain("الأسماء تُرسل لاحقاً");
    expect(body).toContain("ملاحظة: غرفتان متجاورتان");
  });

  it("numbers a room label in English and keeps an unknown label as it is", () => {
    const { body } = buildSupplierRequest({
      ...tour,
      booking: { ...tour.booking, kind: "hotel", detail: { "الغرفة 2": "شامل الإفطار", "ملاحظة خاصة": "x" } },
    });
    expect(body).toContain("• Room 2: Bed & breakfast");
    expect(body).toContain("• ملاحظة خاصة: x");
  });
});

describe("suppliersFor", () => {
  const list = [
    { id: "a", categories: "فنادق، طيران" },
    { id: "b", categories: "تنقلات، خدمات" },
    { id: "c", categories: "" },
  ];
  it("offers those that sell the kind, and those who never said", () => {
    expect(suppliersFor(list, "service").map((s) => s.id)).toEqual(["b", "c"]);
    expect(suppliersFor(list, "visa").map((s) => s.id)).toEqual(["b", "c"]);
    expect(suppliersFor(list, "hotel").map((s) => s.id)).toEqual(["a", "c"]);
  });
  it("offers everyone when nobody matches", () => {
    expect(suppliersFor([{ id: "a", categories: "فنادق" }], "transport").map((s) => s.id)).toEqual(["a"]);
  });
});

describe("assigneesFor — «ينفّذه» (AD-2-3599: ~49 names for one hotel)", () => {
  type A = { kind: "ops" | "employee" | "partner" | "supplier"; id: string | null; label: string; categories?: string | null };
  // as company_suppliers holds them (2026-10-18), with the team and two partner companies
  const list: A[] = [
    { kind: "ops", id: null, label: "قسم العمليات" },
    { kind: "employee", id: "e1", label: "سارة" },
    { kind: "partner", id: "p1", label: "شركة الأفق للسفر والسياحة" },
    { kind: "partner", id: "p2", label: "عالم الفخامة" },
    { kind: "supplier", id: "tbo", label: "TBO Holidays", categories: "طيران، تنقلات، فنادق، خدمات" },
    { kind: "supplier", id: "beds", label: "beds online", categories: "فنادق" },
    { kind: "supplier", id: "novotel", label: "فندق نوفوتيل جاكرتا", categories: "فنادق" },
    { kind: "supplier", id: "villas", label: "فلل الرمان", categories: "فنادق" },
    { kind: "supplier", id: "qudra", label: "قدرة", categories: "تنقلات" },
    { kind: "supplier", id: "flynas", label: "Flynas", categories: "طيران" },
  ];
  const ids = (kind: "hotel" | "transport" | "flight", title: string, holder: string | null = null, partner: string | null = null) =>
    assigneesFor(list, { kind, title }, holder, partner).map((a) => a.id ?? a.kind);

  it("a hotel: the team, the colleagues, the hotel sellers — never another hotel, nor a partner on our own file", () => {
    expect(ids("hotel", "فندق اريادوتا بالي")).toEqual(["ops", "e1", "tbo", "beds"]);
  });

  it("offers a hotel listed as a supplier for a booking of that very hotel", () => {
    expect(ids("hotel", "نوفوتيل جاكرتا - غرفة مزدوجة شامل الإفطار")).toEqual(["ops", "e1", "tbo", "beds", "novotel"]);
  });

  it("transport and flights by their own kinds", () => {
    expect(ids("transport", "المطار ← فندق بالي")).toEqual(["ops", "e1", "tbo", "qudra"]);
    expect(ids("flight", "طيران دولي JED ⇄ DPS")).toEqual(["ops", "e1", "tbo", "flynas"]);
  });

  it("a partner company only on its own file, and whoever holds the booking stays listed", () => {
    expect(ids("hotel", "فندق اريادوتا بالي", null, "p2")).toEqual(["ops", "e1", "p2", "tbo", "beds"]);
    expect(ids("hotel", "فندق اريادوتا بالي", "partner:p1")).toEqual(["ops", "e1", "p1", "tbo", "beds"]);
    expect(ids("hotel", "فندق اريادوتا بالي", "supplier:qudra")).toEqual(["ops", "e1", "tbo", "beds", "qudra"]);
  });
});

describe("«ينفّذه» in groups (the owner, 2026-10-22: the developer and the ads agency were offered beside ops)", () => {
  it("counts as the operations team a role that runs every file — not the administration, not the developer, not sales", () => {
    expect(isOpsTeam(["operations.write", "operations.passport"])).toBe(true); // «الاوبريشن», «التأشيرات»
    expect(isOpsTeam(["dashboard.admin", "operations.write"])).toBe(false); // «كل الصلاحيات»
    expect(isOpsTeam(["dashboard.admin", "developer.access", "operations.write"])).toBe(false); // «مطوّر»
    expect(isOpsTeam(["operations.own", "operations.manage_own"])).toBe(false); // «مبيعات» — «سين تكنولوجي» is on it
    expect(isOpsTeam([])).toBe(false); // inactive
  });

  it("reads a supplier's country from its name — a country, its first word, or a city", () => {
    const countries = ["ماليزيا", "إندونيسيا", "جورجيا", "البوسنة والهرسك", "تايلاند"];
    const cities = [{ name: "جاكرتا", country: "إندونيسيا" }];
    expect(countryInName("فرع ماليزيا", countries, cities)).toBe("ماليزيا");
    expect(countryInName("فرع اندونيسيا", countries, cities)).toBe("إندونيسيا");
    expect(countryInName("اون تايم جورجيا", countries, cities)).toBe("جورجيا");
    expect(countryInName("حول العالم البوسنه", countries, cities)).toBe("البوسنة والهرسك");
    expect(countryInName("فندق نوفوتيل جاكرتا", countries, cities)).toBe("إندونيسيا");
    expect(countryInName("TBO Holidays", countries, cities)).toBeNull();
  });

  type A = { kind: "ops" | "employee" | "partner" | "supplier"; id: string | null; label: string; team?: boolean; country?: string | null };
  const list: A[] = [
    { kind: "ops", id: null, label: "قسم العمليات" },
    { kind: "employee", id: "dev", label: "المطوّر" },
    { kind: "employee", id: "ads", label: "سين تكنولوجي" },
    { kind: "employee", id: "visa", label: "ريموندا", team: true },
    { kind: "partner", id: "p", label: "شركة" },
    { kind: "supplier", id: "tbo", label: "TBO Holidays", country: null },
    { kind: "supplier", id: "my", label: "فرع ماليزيا", country: "ماليزيا" },
    { kind: "supplier", id: "id", label: "فرع اندونيسيا", country: "إندونيسيا" },
  ];
  const shape = (r: { groups: { key: string; country: string | null; items: A[] }[] }) => r.groups.map((g) => [g.key, g.country, g.items.map((a) => a.label)]);

  it("lists the team, the partner, the suppliers by country («عام» last) — the other colleagues only on «الكل»", () => {
    const closed = assigneeGroups(list, null, false);
    expect(shape(closed)).toEqual([
      ["team", null, ["قسم العمليات", "ريموندا"]],
      ["partner", null, ["شركة"]],
      ["suppliers", "إندونيسيا", ["فرع اندونيسيا"]],
      ["suppliers", "ماليزيا", ["فرع ماليزيا"]],
      ["suppliers", null, ["TBO Holidays"]],
    ]);
    expect(closed.hidden).toBe(2);
    const open = assigneeGroups(list, null, true);
    expect(open.groups.at(-1)?.items.map((a) => a.label)).toEqual(["المطوّر", "سين تكنولوجي"]);
    expect(open.hidden).toBe(0);
  });

  it("keeps the colleague holding the booking in view, hidden or not", () => {
    const r = assigneeGroups(list, "employee:ads", false);
    expect(r.groups.at(-1)).toEqual({ key: "others", country: null, items: [list[2]] });
    expect(r.hidden).toBe(1);
  });
});

describe("requestState", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const b = { status: "pending", request_status: "sent", request_sent_at: "2026-10-14T06:00:00Z", assigned_at: "2026-10-14T05:00:00Z" };
  it("is sent until the reply window passes, then overdue", () => {
    expect(requestState(b, now, 24)).toBe("sent");
    expect(requestState(b, now, 6)).toBe("overdue");
  });
  it("is confirmed by the booking itself, whatever the request says", () => {
    expect(requestState({ ...b, status: "confirmed", request_status: null, request_sent_at: null }, now, 24)).toBe("confirmed");
  });
  it("reads a decline, and forgets a request made before the booking changed hands", () => {
    expect(requestState({ ...b, request_status: "declined" }, now, 24)).toBe("declined");
    expect(requestState({ ...b, assigned_at: "2026-10-14T07:00:00Z" }, now, 24)).toBe("none");
    expect(requestState({ ...b, status: "cancelled" }, now, 24)).toBe("none");
  });
});

describe("the account", () => {
  it("costs a booking at what was charged, else its net, else the offer line", () => {
    expect(bookingCost({ net_charged: 900, quoted_net: 1000, currency: "MYR" })).toEqual({ amount: 900, currency: "MYR" });
    expect(bookingCost({ net_charged: null, quoted_net: 1000, currency: "" })).toEqual({ amount: 1000, currency: "SAR" });
    expect(bookingCost({ net_charged: null, quoted_net: null, currency: "SAR" }, { amount: 50, currency: "USD" })).toEqual({ amount: 50, currency: "USD" });
    expect(bookingCost({ net_charged: null, quoted_net: null, currency: "SAR" })).toBeNull();
  });

  it("nets payments and refunds per currency; negative means they owe us", () => {
    const rows = supplierBalances(
      [
        { amount: 1200.5, currency: "SAR" },
        { amount: 300, currency: "SAR" },
        { amount: 100, currency: "USD" },
      ],
      [
        { kind: "payment", amount: 1000, currency: "SAR" },
        { kind: "refund", amount: 200, currency: "SAR" },
        { kind: "payment", amount: 150, currency: "USD" },
      ],
    );
    expect(rows).toEqual([
      { currency: "SAR", owed: 1500.5, paid: 800, balance: 700.5 },
      { currency: "USD", owed: 100, paid: 150, balance: -50 },
    ]);
  });
});
