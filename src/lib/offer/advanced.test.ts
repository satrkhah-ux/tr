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
const adv = (patch: Partial<DraftAdvanced>): DraftAdvanced => ({ ...emptyAdvanced(), on: true, parts: { arrival: true, departure: true }, arrive_country: "تركيا", arrive_by: "flight", leave_country: "جورجيا", leave_by: "flight", ...patch });

describe("«بكج متقدم» — four answers on top of the basic file", () => {
  it("off (or absent) changes nothing: the basic file stays the basic file", () => {
    expect(withAdvancedTransport(rows, undefined)).toEqual(rows);
    expect(withAdvancedTransport(rows, emptyAdvanced())).toEqual(rows);
    expect(advancedLines(undefined)).toEqual({ includes: [], excludes: [] });
  });

  it("Trabzon arrival, reception at the Georgian side of the border: no «من المطار» anywhere", () => {
    const a = adv({ arrive_at: "مطار طرابزون", reception: { kind: "border", place: "معبر سارب", side: "جورجيا", country: "جورجيا", date: "", time: "12:30" }, farewell: { kind: "airport", place: "", side: "", country: "تركيا", date: "2026-11-14", time: "" } });
    const out = withAdvancedTransport(rows, a);
    expect(out[0]).toMatchObject({ from_place: "معبر سارب — جانب جورجيا", to_place: "فندق باتومي", note: "اللقاء 12:30" });
    expect(out[1].to_place).toBe(TRANSPORT_AIRPORT); // the farewell was left at the airport
    const lines = advancedLines(a);
    expect(lines.includes).toEqual(["تبدأ خدماتنا باستقبالكم من معبر سارب — جانب جورجيا الساعة 12:30"]);
    expect(lines.excludes).toEqual([
      "وصولكم إلى مطار طرابزون (طيران) وفق ترتيبكم — غير مشمول",
      "الانتقال من مطار طرابزون إلى معبر سارب — جانب جورجيا — ترتيب ذاتي، غير مشمول",
    ]);
    expect(advancedGaps(a)).toEqual(expect.arrayContaining(["يوم الاستقبال غير محدد", "يصل إلى تركيا ونستقبله في جانب جورجيا — كيف ينتقل بينهما؟ أضفه في «ما يرتّبه بنفسه»"]));
    // the blanket «يشمل» line about the airport goes, the file's own lines stay
    const d = normalizeDraftData({ ...emptyDraftData(), advanced: a } as never);
    expect(withScopeLines(d).includes.join()).not.toContain("من المطار");
  });

  it("reception from a hotel the client booked: the night is theirs, said once as «غير مشمول»", () => {
    const a = adv({ arrive_at: "مطار طرابزون", reception: { kind: "hotel", place: "ريزا جراند", side: "", country: "تركيا", date: "", time: "" }, self_items: ["ليلة في فندق ريزا جراند"] });
    expect(withAdvancedTransport(rows, a)[0].from_place).toBe("فندق ريزا جراند");
    expect(advancedLines(a).excludes).toContain("ليلة في فندق ريزا جراند — يرتّبه العميل بنفسه، غير مشمول");
    expect(advancedGaps(a)).toEqual(expect.arrayContaining(["يوم الاستقبال غير محدد", "موعد اللقاء ينتظر التأكيد", "اختر نقطة التوديع"]));
  });

  it("the client comes by themselves: the pickup row is gone (so it is not priced) and the day note drops it", () => {
    const a = adv({ arrive_by: "already", reception: { kind: "self", place: "", side: "", country: "", date: "", time: "" } });
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
    const a = adv({ leave_by: "land", leave_from: "أرمينيا", farewell: { kind: "border", place: "معبر صدخلو", side: "جورجيا", country: "جورجيا", date: "", time: "09:00" } });
    expect(withAdvancedTransport(rows, a)[1]).toMatchObject({ to_place: "معبر صدخلو — جانب جورجيا", note: "الانطلاق 09:00" });
    expect(advancedLines(a).includes).toEqual(["تنتهي خدماتنا بتوصيلكم إلى معبر صدخلو — جانب جورجيا الساعة 09:00"]);
    expect(advancedLines(a).excludes).toContain("مغادرتكم من أرمينيا (برّاً) — غير مشمولة");
    expect(advancedDayNote("توديع من الفندق إلى المطار — سيدان", a)).toBe("توديع من الفندق إلى معبر صدخلو — جانب جورجيا — سيدان");
  });

  it("what is missing is said, never invented", () => {
    const a = adv({ reception: { kind: "border", place: "", side: "", country: "", date: "", time: "" }, borders: { "أ>ب": { drivers: 2, crossing: "", side_from: "", side_to: "" } } });
    expect(advancedGaps(a)).toEqual(expect.arrayContaining(["اختر المعبر", "حدد أي جانب من الحدود", "يوم الاستقبال غير محدد", "موعد اللقاء ينتظر التأكيد", "اختر نقطة التوديع", "من أين يأتي إلى نقطة الاستقبال؟ اختر مكان وصوله", "أ ← ب: اكتب اسم المعبر"]));
  });

  it("an airport reception names the airport the client flies into", () => {
    const a = adv({ arrive_at: "طرابزون", leave_from: "مطار تبليسي", reception: { kind: "airport", place: "", side: "", country: "تركيا", date: "", time: "" }, farewell: { kind: "airport", place: "", side: "", country: "تركيا", date: "", time: "" } });
    expect(withAdvancedTransport(rows, a).slice(0, 2).map((r) => [r.from_place, r.to_place])).toEqual([
      ["مطار طرابزون", "فندق باتومي"],
      ["فندق تبليسي", "مطار تبليسي"],
    ]);
    expect(advancedLines(a).includes).toEqual(["تبدأ خدماتنا باستقبالكم من مطار طرابزون", "تنتهي خدماتنا بتوصيلكم إلى مطار تبليسي"]);
  });

  it("dates fill from Basic, follow it, and stop following once typed; mismatches are said", () => {
    let a = fillAdvanced(adv({}), { arrive_date: "2026-11-10", arrive_time: "12:00", checkin_date: "2026-11-11", leave_date: "2026-11-14" });
    expect([a.arrive_date, a.checkin_date, a.reception.date, a.farewell.date]).toEqual(["2026-11-10", "2026-11-11", "2026-11-10", "2026-11-14"]);
    // Basic moved a day later: the dates follow
    a = fillAdvanced(a, { arrive_date: "2026-11-11", checkin_date: "2026-11-12", leave_date: "2026-11-15" });
    expect([a.arrive_date, a.reception.date]).toEqual(["2026-11-11", "2026-11-11"]);
    // the agent sets the reception day: it stays theirs
    a = fillAdvanced(setAdvancedDate(a, "reception_date", "2026-11-10"), { checkin_date: "2026-11-20" });
    expect(a.reception.date).toBe("2026-11-10");
    a = { ...a, reception: { ...a.reception, kind: "border" } };
    expect(advancedGaps(a)).toEqual(expect.arrayContaining(["الاستقبال (2026-11-10) قبل وصول العميل (2026-11-11 12:00)", "ليلة 2026-11-11 لا يوجد لها فندق — أين يبيت؟ أضفها في «ما يرتّبه بنفسه» أو احجزها"]));
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

describe("«بكج متقدم» — the trip read in order (the owner's own file)", () => {
  it("the screenshot's dates: met before arriving, a hotel before arriving, leaving before arriving — each said at its step", async () => {
    const { advancedSteps } = await import("./advanced");
    const a = adv({
      arrive_country: "ماليزيا",
      arrive_at: "مطار كوالالمبور الدولي (KUL)",
      arrive_date: "2026-10-18",
      arrive_time: "22:40",
      checkin_date: "2026-10-17",
      reception: { kind: "border", place: "باتايا", side: "تايلاند", country: "تايلاند", date: "2026-10-16", time: "22:40" },
      farewell: { kind: "airport", place: "", side: "", country: "تركيا", date: "2026-10-15", time: "" },
      leave_country: "الإمارات",
      leave_from: "مطار العين الدولي (AAN)",
      leave_date: "2026-10-16",
      leave_time: "22:40",
    });
    const s = Object.fromEntries(advancedSteps(a).map((x) => [x.key, x]));
    expect(s.arrive.errors).toEqual([]);
    expect(s.reception.errors).toEqual(["الاستقبال (2026-10-16 22:40) قبل وصول العميل (2026-10-18 22:40)"]);
    expect(s.reception.missing).toContain("يصل إلى ماليزيا ونستقبله في جانب تايلاند — كيف ينتقل بينهما؟ أضفه في «ما يرتّبه بنفسه»");
    expect(s.checkin.errors[0]).toContain("الدخول للفندق (2026-10-17) قبل وصول العميل (2026-10-18)");
    expect(s.farewell.errors).toEqual(["التوديع (2026-10-15) قبل الاستقبال (2026-10-16)"]);
    expect(s.leave.errors).toEqual(["المغادرة (2026-10-16) قبل الوصول (2026-10-18)"]);
    expect(s.arrive.sentence).toBe("يصل العميل إلى مطار كوالالمبور الدولي (KUL) (ماليزيا) — طيران يوم 2026-10-18 الساعة 22:40");
  });

  it("clocks are compared across zones, and each says its zone", async () => {
    const { advancedSteps } = await import("./advanced");
    const zones: Record<string, string> = { ماليزيا: "Asia/Kuala_Lumpur", تايلاند: "Asia/Bangkok" };
    const tz = (c: string) => zones[c] ?? null;
    // lands 22:40 Malaysia (= 21:40 Thailand); pickup 22:00 on the Thai side is AFTER landing in real time
    const a = adv({
      arrive_country: "ماليزيا",
      arrive_at: "مطار كوالالمبور",
      arrive_date: "2026-10-18",
      arrive_time: "22:40",
      reception: { kind: "border", place: "معبر", side: "تايلاند", country: "تايلاند", date: "2026-10-18", time: "22:00" },
      self_items: ["الانتقال إلى الحدود"],
    });
    const s = advancedSteps(a, tz);
    expect(s[1].errors).toEqual([]); // wall clocks alone (22:00 < 22:40) would have called it «before arrival»
    expect(s[0].sentence).toContain("الساعة 22:40 بتوقيت ماليزيا (+5 س عن السعودية)");
    expect(s[1].sentence).toContain("الساعة 22:00 بتوقيت تايلاند (+4 س عن السعودية)");
    // the same pickup at 21:00 Thai time IS before the landing
    expect(advancedSteps({ ...a, reception: { ...a.reception, time: "21:00" } }, tz)[1].errors.length).toBe(1);
  });
});

describe("«بكج متقدم» — lands in one country, first night in another", () => {
  it("Trabzon airport → Batumi: asks how the transfer crosses, then splits it at the border for two drivers", async () => {
    const { advancedSteps } = await import("./advanced");
    const base = adv({ arrive_country: "تركيا", arrive_at: "مطار طرابزون (TZX)", reception: { kind: "airport", place: "", side: "", country: "تركيا", date: "2026-10-18", time: "23:30" } });
    expect(advancedSteps(base, undefined, "جورجيا")[1].missing).toContain("نقطة الاستقبال في تركيا وأول فندق في جورجيا — اختر كيف يعبر الحدود");
    const two = { ...base, reception_cross: { drivers: 2 as const, crossing: "معبر سارب", side_from: "تركيا", side_to: "جورجيا" } };
    const s = advancedSteps(two, undefined, "جورجيا")[1];
    expect(s.missing).toEqual([]);
    expect(s.sentence).toContain("ثم ننقله إلى جورجيا عبر معبر سارب — سائقان، ويعبر الحدود بنفسه بينهما");
    expect(withAdvancedTransport(rows, two).slice(0, 2).map((r) => [r.from_place, r.to_place])).toEqual([
      ["مطار طرابزون (TZX)", "معبر سارب — جانب تركيا"],
      ["معبر سارب — جانب جورجيا", "فندق باتومي"],
    ]);
    expect(advancedLines(two).excludes).toContain("عبور معبر سارب بين السائقين — يعبره المسافرون بأنفسهم");
    // one car across: one row, the crossing a thing to check
    const one = { ...two, reception_cross: { ...two.reception_cross, drivers: 1 as const } };
    expect(withAdvancedTransport(rows, one)[0].note).toContain("عبر معبر سارب — تحقق من سماح السيارة");
    // same country: nothing asked
    expect(advancedSteps(base, undefined, "تركيا")[1].missing).toEqual([]);
  });
});

it("a pickup with no time yet, on the landing day, is not «before arrival»", async () => {
  const { advancedSteps } = await import("./advanced");
  const a = adv({ arrive_country: "تركيا", arrive_at: "مطار", arrive_date: "2026-11-11", arrive_time: "11:30", reception: { kind: "airport", place: "", side: "", country: "تركيا", date: "2026-11-11", time: "" } });
  expect(advancedSteps(a)[1].errors).toEqual([]);
  expect(advancedSteps({ ...a, reception: { ...a.reception, date: "2026-11-10" } })[1].errors.length).toBe(1);
});

describe("«بكج متقدم» — only the unusual end, typed once, the car before the plane", () => {
  it("departure only: the arrival stays Basic's airport pickup and asks nothing", async () => {
    const { advancedSteps, advancedGaps } = await import("./advanced");
    const a = adv({
      parts: { arrival: false, departure: true },
      reception: { kind: "border", place: "سارب", side: "جورجيا", country: "جورجيا", date: "", time: "" },
      farewell: { kind: "airport", place: "", side: "", country: "جورجيا", date: "2026-10-30", time: "18:00" },
      leave_country: "جورجيا",
      leave_from: "مطار تبليسي الدولي (TBS)",
      leave_date: "2026-10-30",
      leave_time: "22:45",
    });
    expect(advancedSteps(a).map((s) => s.key)).toEqual(["farewell", "leave"]);
    expect(withAdvancedTransport(rows, a)[0]).toEqual(rows[0]); // the pickup typed earlier no longer counts
    expect(advancedGaps(a)).toEqual([]);
    expect(advancedGaps({ ...a, parts: { arrival: false, departure: false } })).toEqual(["اختر ما المختلف في هذه الرحلة: الوصول، أو المغادرة، أو كلاهما"]);
  });

  it("a car to the airport at take-off time is flagged with the latest time it may leave", async () => {
    const { advancedSteps } = await import("./advanced");
    const a = adv({
      parts: { arrival: false, departure: true },
      farewell: { kind: "airport", place: "", side: "", country: "جورجيا", date: "2026-10-30", time: "22:45" },
      leave_date: "2026-10-30",
      leave_time: "22:45",
      leave_from: "مطار تبليسي",
      leave_country: "جورجيا",
    });
    expect(advancedSteps(a)[0].errors).toEqual(["الانطلاق إلى المطار 22:45 والإقلاع 22:45 — يجب أن ينطلق قبل الإقلاع بثلاث ساعات على الأقل (19:45 أو قبل)"]);
    expect(advancedSteps({ ...a, farewell: { ...a.farewell, time: "19:30" } })[0].errors).toEqual([]);
  });

  it("dates typed here go to Basic; dates that came from Basic do not go back", async () => {
    const { advancedTripDates } = await import("./advanced");
    const a = adv({ checkin_date: "2026-10-20", leave_date: "2026-10-30", reception: { kind: "border", place: "", side: "جورجيا", country: "جورجيا", date: "", time: "" } });
    expect(advancedTripDates(a)).toEqual({ arrival_date: "2026-10-20", departure_date: "2026-10-30", country: "جورجيا" });
    expect(advancedTripDates({ ...a, auto: ["checkin_date", "leave_date"] }).arrival_date).toBeUndefined();
  });
});

describe("«بكج متقدم» → the planned flights", () => {
  it("lands where the card says and flies home from where it says; a ticket is never rewritten", async () => {
    const { withAdvancedAirports } = await import("./basic");
    const { emptyDraftData, emptyFlight } = await import("./draft-types");
    const airports = [
      { id: "1", name: "مطار الأمير محمد بن عبدالعزيز", code: "MED", timezone: "Asia/Riyadh", city: "المدينة المنورة", country: "السعودية" },
      { id: "2", name: "مطار إسطنبول", code: "IST", timezone: "Europe/Istanbul", city: "إسطنبول", country: "تركيا" },
      { id: "3", name: "مطار طرابزون", code: "TZX", timezone: "Europe/Istanbul", city: "طرابزون", country: "تركيا" },
      { id: "4", name: "مطار تبليسي الدولي", code: "TBS", timezone: "Asia/Tbilisi", city: "تبليسي", country: "جورجيا" },
    ];
    const d = emptyDraftData();
    d.flights = [
      { ...emptyFlight("outbound"), from_airport: "مطار الأمير محمد بن عبدالعزيز (MED)", to_airport: "مطار إسطنبول (IST)", departure_at: "2026-10-22T00:00" },
      { ...emptyFlight("inbound"), from_airport: "مطار إسطنبول (IST)", to_airport: "مطار الأمير محمد بن عبدالعزيز (MED)", departure_at: "2026-10-27T00:00" },
    ];
    d.advanced = adv({ arrive_at: "مطار طرابزون (TZX)", leave_from: "مطار تبليسي الدولي (TBS)" });
    const out = withAdvancedAirports(d, airports)!;
    const legs = out.flights.map((f) => [f.leg_order, f.from_airport, f.to_airport, f.departure_at]);
    expect(legs).toEqual([
      ["outbound", "مطار الأمير محمد بن عبدالعزيز (MED)", "مطار طرابزون (TZX)", "2026-10-22T00:00"],
      ["inbound", "مطار تبليسي الدولي (TBS)", "مطار الأمير محمد بن عبدالعزيز (MED)", "2026-10-27T00:00"],
    ]);
    expect(out.flights[1].from_tz).toBe("Asia/Tbilisi");
    // only the arrival is unusual: the flight home keeps leaving from where it lands
    const arrivalOnly = withAdvancedAirports({ ...d, advanced: { ...d.advanced!, parts: { arrival: true, departure: false } } }, airports)!;
    expect(arrivalOnly.flights[1].from_airport).toBe("مطار طرابزون (TZX)");
    // a ticket in: nothing is rewritten
    d.flights[0] = { ...d.flights[0], flight_no: "TK 123" };
    expect(withAdvancedAirports(d, airports)).toBeNull();
  });
});

describe("«بكج متقدم» with the city card's services table", () => {
  it("a price typed for the reception counts once when the transfer splits at the border; airport wording goes when the pickup moves", async () => {
    const priced = [{ ...rows[0], price: 300, text: "الاستقبال من مطار باتومي" }, ...rows.slice(1)];
    const two = adv({ arrive_country: "تركيا", arrive_at: "مطار طرابزون (TZX)", reception: { kind: "airport", place: "", side: "", country: "تركيا", date: "", time: "" }, reception_cross: { drivers: 2, crossing: "معبر سارب", side_from: "تركيا", side_to: "جورجيا" } });
    const out = withAdvancedTransport(priced, two);
    expect(out.slice(0, 2).map((r) => r.price)).toEqual([300, undefined]);
    // the sheet's refs: the first keeps the row's own, the second car is a line of its own
    const { transportRef } = await import("./draft-types");
    expect(out.slice(0, 2).map((r) => r.ref)).toEqual([transportRef(rows[0]), `${transportRef(rows[0])}:2`]);
    const border = adv({ reception: { kind: "border", place: "معبر سارب", side: "جورجيا", country: "جورجيا", date: "", time: "" } });
    expect(withAdvancedTransport(priced, border)[0].text).toBeUndefined();
    expect(withAdvancedTransport(priced, border)[0].price).toBe(300);
  });
});
