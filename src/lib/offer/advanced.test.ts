import { describe, expect, it } from "vitest";
import { emptyDraftData, normalizeDraftData, TRANSPORT_AIRPORT } from "./draft-types";
import { withScopeLines } from "./basic";
import { advancedDayNote, advancedGaps, advancedLines, emptyAdvanced, fillAdvanced, hopKey, setAdvancedDate, withAdvancedTransport, type DraftAdvanced } from "./advanced";

/** Basic's own rows for a Batumi → Tbilisi file with airport transfers and a road hop. */
const rows = [
  { from_place: TRANSPORT_AIRPORT, to_place: "فندق باتومي", car_type: "سيدان", date: "2026-11-11", note: "" },
  { from_place: "فندق تبليسي", to_place: TRANSPORT_AIRPORT, car_type: "سيدان", date: null, note: "" },
  { from_place: "باتومي", to_place: "تبليسي", car_type: "سيدان", date: "2026-11-13", note: "" },
];
const adv = (patch: Partial<DraftAdvanced>): DraftAdvanced => ({ ...emptyAdvanced(), on: true, arrive_country: "تركيا", arrive_by: "flight", leave_country: "جورجيا", leave_by: "flight", ...patch });

describe("«بكج متقدم» — four answers on top of the basic file", () => {
  it("off (or absent) changes nothing: the basic file stays the basic file", () => {
    expect(withAdvancedTransport(rows, undefined)).toEqual(rows);
    expect(withAdvancedTransport(rows, emptyAdvanced())).toEqual(rows);
    expect(advancedLines(undefined)).toEqual({ includes: [], excludes: [] });
  });

  it("Trabzon arrival, reception at the Georgian side of the border: no «من المطار» anywhere", () => {
    const a = adv({ arrive_at: "مطار طرابزون", reception: { kind: "border", place: "معبر سارب", side: "جورجيا", date: "", time: "12:30" }, farewell: { kind: "airport", place: "", side: "", date: "2026-11-14", time: "" } });
    const out = withAdvancedTransport(rows, a);
    expect(out[0]).toMatchObject({ from_place: "معبر سارب — جانب جورجيا", to_place: "فندق باتومي", note: "اللقاء 12:30" });
    expect(out[1].to_place).toBe(TRANSPORT_AIRPORT); // the farewell was left at the airport
    const lines = advancedLines(a);
    expect(lines.includes).toEqual(["تبدأ خدماتنا باستقبالكم من معبر سارب — جانب جورجيا الساعة 12:30"]);
    expect(lines.excludes).toEqual([
      "وصولكم إلى مطار طرابزون (طيران) وفق ترتيبكم — غير مشمول",
      "الانتقال من مطار طرابزون إلى معبر سارب — جانب جورجيا — ترتيب ذاتي، غير مشمول",
    ]);
    expect(advancedGaps(a)).toEqual(["الاستقبال: التاريخ غير محدد"]);
    // the blanket «يشمل» line about the airport goes, the file's own lines stay
    const d = normalizeDraftData({ ...emptyDraftData(), advanced: a } as never);
    expect(withScopeLines(d).includes.join()).not.toContain("من المطار");
  });

  it("reception from a hotel the client booked: the night is theirs, said once as «غير مشمول»", () => {
    const a = adv({ arrive_at: "مطار طرابزون", reception: { kind: "hotel", place: "ريزا جراند", side: "", date: "", time: "" }, self_items: ["ليلة في فندق ريزا جراند"] });
    expect(withAdvancedTransport(rows, a)[0].from_place).toBe("فندق ريزا جراند");
    expect(advancedLines(a).excludes).toContain("ليلة في فندق ريزا جراند — يرتّبه العميل بنفسه، غير مشمول");
    expect(advancedGaps(a)).toEqual(["الاستقبال: التاريخ غير محدد", "الاستقبال: موعد اللقاء ينتظر التأكيد", "اختر نقطة التوديع"]);
  });

  it("the client comes by themselves: the pickup row is gone (so it is not priced) and the day note drops it", () => {
    const a = adv({ arrive_by: "already", reception: { kind: "self", place: "", side: "", date: "", time: "" } });
    expect(withAdvancedTransport(rows, a).map((r) => r.from_place)).toEqual(["فندق تبليسي", "باتومي"]);
    expect(advancedLines(a).excludes).toContain("وصولكم إلى البلد — ترتيب ذاتي، غير مشمول");
    expect(advancedDayNote("استقبال من المطار إلى الفندق — سيدان", a)).toBeNull();
    expect(advancedDayNote("استقبال من المطار إلى الفندق — سيدان · سيارة الجولات", a)).toBe("سيارة الجولات");
  });

  it("two drivers across a border: two rows with a clear hand-over, the crossing is the client's", () => {
    const a = adv({ borders: { [hopKey("باتومي", "تبليسي")]: { drivers: 2, crossing: "معبر سارب", side_from: "تركيا", side_to: "جورجيا" } } });
    const out = withAdvancedTransport(rows, a);
    expect(out.slice(2).map((r) => [r.from_place, r.to_place])).toEqual([
      ["باتومي", "معبر سارب — جانب تركيا"],
      ["معبر سارب — جانب جورجيا", "تبليسي"],
    ]);
    expect(advancedLines(a).excludes).toContain("عبور معبر سارب بين السائقين — يعبره المسافرون بأنفسهم");
    // one driver: one row, and the crossing is a thing to check, not a promise
    const one = withAdvancedTransport(rows, adv({ borders: { [hopKey("باتومي", "تبليسي")]: { drivers: 1, crossing: "معبر سارب", side_from: "", side_to: "" } } }));
    expect(one).toHaveLength(3);
    expect(one[2].note).toContain("تحقق من سماح السيارة");
  });

  it("farewell to a border, departure overland from another country", () => {
    const a = adv({ leave_by: "land", leave_from: "أرمينيا", farewell: { kind: "border", place: "معبر صدخلو", side: "جورجيا", date: "", time: "09:00" } });
    expect(withAdvancedTransport(rows, a)[1]).toMatchObject({ to_place: "معبر صدخلو — جانب جورجيا", note: "الانطلاق 09:00" });
    expect(advancedLines(a).includes).toEqual(["تنتهي خدماتنا بتوصيلكم إلى معبر صدخلو — جانب جورجيا الساعة 09:00"]);
    expect(advancedLines(a).excludes).toContain("مغادرتكم من أرمينيا (برّاً) — غير مشمولة");
    expect(advancedDayNote("توديع من الفندق إلى المطار — سيدان", a)).toBe("توديع من الفندق إلى معبر صدخلو — جانب جورجيا — سيدان");
  });

  it("what is missing is said, never invented", () => {
    const a = adv({ reception: { kind: "border", place: "", side: "", date: "", time: "" }, borders: { "أ>ب": { drivers: 2, crossing: "", side_from: "", side_to: "" } } });
    expect(advancedGaps(a)).toEqual([
      "الاستقبال: اختر المعبر",
      "الاستقبال: حدد أي جانب من الحدود",
      "الاستقبال: التاريخ غير محدد",
      "الاستقبال: موعد اللقاء ينتظر التأكيد",
      "اختر نقطة التوديع",
      "من أين يأتي العميل إلى نقطة الاستقبال؟ اختر مكان وصوله",
      "أ ← ب: اكتب اسم المعبر",
    ]);
  });

  it("an airport reception names the airport the client flies into", () => {
    const a = adv({ arrive_at: "طرابزون", leave_from: "مطار تبليسي", reception: { kind: "airport", place: "", side: "", date: "", time: "" }, farewell: { kind: "airport", place: "", side: "", date: "", time: "" } });
    expect(withAdvancedTransport(rows, a).slice(0, 2).map((r) => [r.from_place, r.to_place])).toEqual([
      ["مطار طرابزون", "فندق باتومي"],
      ["فندق تبليسي", "مطار تبليسي"],
    ]);
    expect(advancedLines(a).includes).toEqual(["تبدأ خدماتنا باستقبالكم من مطار طرابزون", "تنتهي خدماتنا بتوصيلكم إلى مطار تبليسي"]);
  });

  it("dates fill from Basic, follow it, and stop following once typed; mismatches are said", () => {
    let a = fillAdvanced(adv({}), { arrive_date: "2026-11-10", arrive_time: "12:00", checkin_date: "2026-11-11", leave_date: "2026-11-14" });
    expect([a.arrive_date, a.checkin_date, a.reception.date, a.farewell.date]).toEqual(["2026-11-10", "2026-11-11", "2026-11-11", "2026-11-14"]);
    // Basic moved a day later: the dates follow
    a = fillAdvanced(a, { arrive_date: "2026-11-11", checkin_date: "2026-11-12", leave_date: "2026-11-15" });
    expect([a.arrive_date, a.reception.date]).toEqual(["2026-11-11", "2026-11-12"]);
    // the agent sets the reception day: it stays theirs
    a = fillAdvanced(setAdvancedDate(a, "reception_date", "2026-11-10"), { checkin_date: "2026-11-20" });
    expect(a.reception.date).toBe("2026-11-10");
    a = { ...a, reception: { ...a.reception, kind: "border" } };
    expect(advancedGaps(a)).toEqual(expect.arrayContaining(["الاستقبال (2026-11-10) قبل وصول العميل (2026-11-11)", "بين الوصول (2026-11-11) والدخول للفندق (2026-11-20) ليلة غير محجوزة — أضفها لما يرتّبه العميل أو احجزها"]));
  });
});

describe("«بكج متقدم» — Basic's dates", () => {
  it("reads the landing, the first hotel night and the flight home; a planned leg gives its day", async () => {
    const { emptyDraftData, emptyFlight } = await import("./draft-types");
    const { advancedDefaults } = await import("./advanced");
    const d = emptyDraftData();
    d.flights = [
      { ...emptyFlight("outbound"), departure_at: "2026-11-10T08:00", arrival_at: "2026-11-10T12:00" },
      { ...emptyFlight("inbound"), departure_at: "2026-11-14T19:00" },
    ];
    expect(advancedDefaults(d)).toMatchObject({ arrive_date: "2026-11-10", arrive_time: "12:00", leave_date: "2026-11-14", leave_time: "19:00" });
    d.flights[0] = { ...d.flights[0], arrival_at: null, departure_at: "2026-11-09" };
    expect(advancedDefaults(d).arrive_date).toBe("2026-11-09");
  });
});

describe("«بكج متقدم» — the place fits the way they travel", () => {
  it("a station picked for a flight (the airports table holds stations too) is flagged", async () => {
    const { isStation } = await import("./advanced");
    expect(isStation("محطة القطار هانوي (12go)")).toBe(true);
    expect(isStation("مطار طرابزون (TZX)")).toBe(false);
    expect(isStation("محطه الباص في نينه بينه (bu)")).toBe(true);
    const a = adv({ arrive_at: "محطة القطار هانوي (12go)" });
    expect(advancedGaps(a)[0]).toBe("«محطة القطار هانوي (12go)» محطة وليست مطاراً — غيّر الوسيلة إلى «قطار / عبّارة» أو اختر مطاراً");
    expect(advancedGaps({ ...a, arrive_by: "rail_sea" }).some((g) => g.includes("محطة وليست"))).toBe(false);
  });
});
