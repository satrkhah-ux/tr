import { describe, expect, it } from "vitest";
import { emptyDraftData, emptyFlight } from "./draft-types";
import { suggestPricing } from "./pricing-suggest";
import {
  addAirportReception,
  addBorderTransferOneDriver,
  addBorderTransferTwoDrivers,
  addGroupArrivalReceptions,
  addPlaceReception,
  checkJourney,
  clientLines,
  emptyJourney,
  journeyFromDraft,
  journeyPricingLines,
  newPlace,
  newSegment,
  newService,
  newStay,
  normalizeJourney,
  opsLines,
  roomNights,
  serviceFrom,
  spans,
  stayNights,
  timeline,
  withChangeLog,
  type AdvancedJourney,
} from "./advanced";

const IST = "Europe/Istanbul";
const TBS = "Asia/Tbilisi";

/** Georgia package, the client lands in Trabzon — no country or airport is special-cased in the module. */
function georgia() {
  const j: AdvancedJourney = { ...emptyJourney(), enabled: true, main_country: "جورجيا" };
  j.groups = [{ id: "g1", name: "العائلة" }];
  j.travellers = [
    { id: "t1", name: "أحمد", kind: "adult", group: "g1" },
    { id: "t2", name: "سارة", kind: "adult", group: "g1" },
  ];
  const ruh = newPlace({ kind: "airport", name: "مطار الرياض", country: "السعودية", tz: "Asia/Riyadh" });
  const tzx = newPlace({ kind: "airport", name: "مطار طرابزون", city: "طرابزون", country: "تركيا", tz: IST });
  const rize = newPlace({ kind: "hotel", name: "فندق ريزا", city: "ريزا", country: "تركيا", tz: IST });
  const trSide = newPlace({ kind: "border", name: "معبر سارب", side: "تركيا", country: "تركيا", tz: IST });
  const geSide = newPlace({ kind: "border", name: "معبر سارب", side: "جورجيا", country: "جورجيا", tz: TBS, meeting: "بعد بوابة الجوازات الجورجية" });
  const batumi = newPlace({ kind: "hotel", name: "فندق باتومي", city: "باتومي", country: "جورجيا", tz: TBS });
  const tbs = newPlace({ kind: "airport", name: "مطار تبليسي", city: "تبليسي", country: "جورجيا", tz: TBS });
  j.places = [ruh, tzx, rize, trSide, geSide, batumi, tbs];
  const flight = newSegment({ mode: "flight", from: ruh.id, to: tzx.id, dep: "2026-11-10T08:00", arr: "2026-11-10T12:00", ref: "XY 101", arranged_by: "client", status: "confirmed" });
  j.segments = [flight];
  j.stays = [newStay({ place: batumi.id, check_in: "2026-11-11", check_out: "2026-11-14", rooms: 2, price: 1200 })];
  return { j, ruh, tzx, rize, trSide, geSide, batumi, tbs, flight };
}

const codes = (j: AdvancedJourney) => checkJourney(j).map((i) => `${i.severity}:${i.code}`);

describe("advanced package — the ten acceptance files", () => {
  it("1. Trabzon arrival, airport reception to Batumi: the reception follows the flight by choice, the doc says airport", () => {
    const { j: base, flight, batumi } = georgia();
    const j = addAirportReception(base, flight.id, batumi.id);
    j.services[0].at = "2026-11-10T13:00";
    j.services[0].to = batumi.id;
    // the stay starts on the 11th: the client sleeps somewhere on the 10th — not invented
    j.stays[0].check_in = "2026-11-10";
    expect(serviceFrom(j, j.services[0])).toBe(flight.to);
    const errors = checkJourney(j).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    const lines = clientLines(j);
    expect(lines.includes[0]).toContain("تبدأ خدماتنا: استقبالكم من مطار طرابزون");
    expect(lines.excludes.join()).toContain("وصولكم إلى مطار طرابزون — طرابزون، تركيا وفق تذكرتكم");
    // the package country and the arrival country are different, and that is not an error
    expect(codes(j).some((c) => c.startsWith("error"))).toBe(false);
  });

  it("2. same flight, reception at the Georgian side of the border: self leg to the border shown, not «استقبال مطار»", () => {
    const { j: base, tzx, trSide, geSide, batumi } = georgia();
    let j = { ...base, segments: [...base.segments, newSegment({ mode: "self", from: tzx.id, to: trSide.id, dep: "2026-11-11T08:00", arr: "2026-11-11T10:00" }), newSegment({ mode: "border", from: trSide.id, to: geSide.id, dep: "2026-11-11T10:00", arr: "2026-11-11T12:00" })] };
    j = addPlaceReception(j, geSide.id, batumi.id);
    j.services[0].at = "2026-11-11T12:30";
    const lines = clientLines(j);
    expect(lines.includes[0]).toContain("استقبالكم من معبر سارب — جانب جورجيا (بعد بوابة الجوازات الجورجية)");
    expect(lines.includes.join()).not.toContain("مطار");
    expect(lines.excludes.join()).toContain("انتقال ذاتي من مطار طرابزون — طرابزون، تركيا إلى معبر سارب — جانب تركيا — ترتيب ذاتي غير مشمول");
    // the walk is continuous: no gap reported
    expect(codes(j).filter((c) => c.includes("gap"))).toEqual([]);
  });

  it("3. same flight, reception from the Rize hotel the client booked: flight kept, no airport pickup created, Rize not priced", () => {
    const { j: base, tzx, rize, batumi } = georgia();
    let j = { ...base, segments: [...base.segments, newSegment({ mode: "self", from: tzx.id, to: rize.id, dep: "2026-11-10T13:00", arr: "2026-11-10T14:30" })] };
    j.stays = [newStay({ place: rize.id, check_in: "2026-11-10", check_out: "2026-11-11", included: false, booked_by: "client", paid_by: "client", price: 300 }), ...j.stays];
    j = addPlaceReception(j, rize.id, batumi.id);
    j.services[0].at = "2026-11-11T10:00";
    expect(j.services.filter((s) => s.use_arrival_airport)).toEqual([]);
    const lines = clientLines(j);
    expect(lines.includes[0]).toContain("استقبالكم من فندق ريزا");
    expect(lines.excludes.join()).toContain("الإقامة في فندق ريزا");
    // Rize is the client's night: not in the price, not in the included nights
    expect(journeyPricingLines(j).filter((l) => l.item_type === "hotel").map((l) => l.description).join()).not.toContain("ريزا");
    const s = spans(j);
    expect(s.includedNights).toBe(3);
    expect(s.externalNights).toBe(1);
    expect(s.travel.from).toBe("2026-11-10");
    expect(s.services.from).toBe("2026-11-11");
  });

  it("4. Malaysia arrival, then a flight to Bali and a stay there: two countries, continuous, no error", () => {
    const j: AdvancedJourney = { ...emptyJourney(), enabled: true, main_country: "إندونيسيا", travellers: [{ id: "a", name: "س", kind: "adult", group: "" }] };
    const kul = newPlace({ kind: "airport", name: "KUL", country: "ماليزيا", tz: "Asia/Kuala_Lumpur" });
    const dps = newPlace({ kind: "airport", name: "DPS", country: "إندونيسيا", tz: "Asia/Makassar" });
    const hotel = newPlace({ kind: "hotel", name: "فندق بالي", country: "إندونيسيا", tz: "Asia/Makassar" });
    const ruh = newPlace({ kind: "airport", name: "RUH", country: "السعودية", tz: "Asia/Riyadh" });
    j.places = [ruh, kul, dps, hotel];
    const intl = newSegment({ mode: "flight", from: ruh.id, to: kul.id, dep: "2026-12-01T01:00", arr: "2026-12-01T15:00", ref: "MH 1" });
    const hop = newSegment({ mode: "flight", from: kul.id, to: dps.id, dep: "2026-12-01T17:30", arr: "2026-12-01T20:30", ref: "AK 2" });
    j.segments = [intl, hop];
    j.stays = [newStay({ place: hotel.id, check_in: "2026-12-01", check_out: "2026-12-05" })];
    const withRx = addAirportReception(j, hop.id, hotel.id);
    withRx.services[0].at = "2026-12-01T21:00";
    expect(codes(withRx).filter((c) => !c.startsWith("missing"))).toEqual([]);
    // Malaysia is a transit: no stay and no service there
    expect(spans(withRx).includedNights).toBe(4);
  });

  it("5. Malaysia arrival with the Bali leg not recorded: the gap is shown, never filled in", () => {
    const j: AdvancedJourney = { ...emptyJourney(), enabled: true, travellers: [{ id: "a", name: "س", kind: "adult", group: "" }] };
    const kul = newPlace({ kind: "airport", name: "KUL", country: "ماليزيا", tz: "Asia/Kuala_Lumpur" });
    const hotel = newPlace({ kind: "hotel", name: "فندق بالي", country: "إندونيسيا", tz: "Asia/Makassar" });
    const ruh = newPlace({ kind: "airport", name: "RUH", country: "السعودية", tz: "Asia/Riyadh" });
    j.places = [ruh, kul, hotel];
    j.segments = [newSegment({ mode: "flight", from: ruh.id, to: kul.id, dep: "2026-12-01T01:00", arr: "2026-12-01T15:00", ref: "MH 1" })];
    j.stays = [newStay({ place: hotel.id, check_in: "2026-12-02", check_out: "2026-12-05" })];
    const issues = checkJourney(j);
    const gap = issues.find((i) => i.code === "gap.segment");
    expect(gap?.severity).toBe("missing");
    expect(gap?.message).toContain("KUL");
    expect(gap?.message).toContain("فندق بالي");
    expect(j.segments).toHaveLength(1); // nothing invented
    expect(clientLines(j).pending.join()).toContain("مقطع ناقص");
  });

  it("6. a family arriving on two flights and leaving on three: one reception per arriving party, a departure each", () => {
    const j: AdvancedJourney = { ...emptyJourney(), enabled: true };
    j.groups = [{ id: "A", name: "أ" }, { id: "B", name: "ب" }];
    j.travellers = ["1", "2", "3", "4", "5"].map((id, i) => ({ id, name: `م${id}`, kind: "adult" as const, group: i < 3 ? "A" : "B" }));
    const ist = newPlace({ kind: "airport", name: "IST", tz: IST });
    const saw = newPlace({ kind: "airport", name: "SAW", tz: IST });
    const hotel = newPlace({ kind: "hotel", name: "فندق إسطنبول", tz: IST });
    const home = newPlace({ kind: "airport", name: "MED", tz: "Asia/Riyadh" });
    j.places = [ist, saw, hotel, home];
    j.segments = [
      newSegment({ mode: "flight", from: home.id, to: ist.id, dep: "2026-11-01T02:00", arr: "2026-11-01T06:00", ref: "TK1", pax: ["1", "2", "3"] }),
      newSegment({ mode: "flight", from: home.id, to: saw.id, dep: "2026-11-01T10:00", arr: "2026-11-01T14:00", ref: "PC2", pax: ["4", "5"] }),
    ];
    let k = addGroupArrivalReceptions(j, hotel.id);
    expect(k.services).toHaveLength(2);
    expect(k.services.map((s) => s.pax)).toEqual([["1", "2", "3"], ["4", "5"]]);
    expect(k.services.map((s) => serviceFrom(k, s))).toEqual([ist.id, saw.id]);
    // three departures for three parties
    k = { ...k, services: [...k.services, ...[["1"], ["2", "3"], ["4", "5"]].map((pax, i) => newService({ kind: "farewell", from: hotel.id, to: ist.id, pax, at: `2026-11-0${5 + i}T09:00` }))] };
    expect(opsLines(k).filter((l) => l.kind === "توديع")).toHaveLength(3);
    expect(journeyPricingLines(k)).toHaveLength(5); // one line per service, never per traveller
  });

  it("7. a border transfer on two cars with a self crossing between: three records, separate responsibility", () => {
    const { j: base, rize, trSide, geSide, batumi } = georgia();
    const j = addBorderTransferTwoDrivers(base, rize.id, trSide.id, geSide.id, batumi.id);
    expect(j.services.map((s) => [s.from, s.to])).toEqual([[rize.id, trSide.id], [geSide.id, batumi.id]]);
    const crossing = j.segments.find((s) => s.mode === "border")!;
    expect(crossing.arranged_by).toBe("client");
    expect(j.services[1].depends_on).toBe(crossing.id);
    const tl = timeline({ ...j, services: j.services.map((s, i) => ({ ...s, at: `2026-11-11T${i ? "12" : "09"}:00` })), segments: j.segments.map((s) => (s === crossing ? { ...s, dep: "2026-11-11T10:30", arr: "2026-11-11T11:30" } : s)) }, "t1");
    const kinds = tl.filter((r) => r.type !== "stay" && r.id !== base.segments[0].id).map((r) => r.tags[0]);
    expect(kinds).toEqual(["included", "self", "included"]);
    // one car alone is a single service whose crossing is a feasibility check, not a promise
    const one = addBorderTransferOneDriver(base, rize.id, geSide.id, batumi.id);
    expect(one.services[0].status).toBe("feasibility");
    expect(checkJourney(one).some((i) => i.code === "svc.feasibility")).toBe(true);
  });

  it("8. landing after midnight into a hotel booked from that date: the check-in date is flagged", () => {
    const { j: base, ruh, batumi } = georgia();
    const bus = newPlace({ kind: "airport", name: "مطار باتومي", country: "جورجيا", tz: TBS });
    const j = { ...base, places: [...base.places, bus] };
    j.segments = [newSegment({ mode: "flight", from: ruh.id, to: bus.id, dep: "2026-11-11T00:30", arr: "2026-11-11T02:40", ref: "J2 9" })];
    const k = addAirportReception(j, j.segments[0].id, batumi.id);
    k.services[0].at = "2026-11-11T03:10";
    const midnight = checkJourney(k).find((i) => i.code === "stay.afterMidnight");
    expect(midnight?.severity).toBe("warning");
    expect(midnight?.message).toContain("2026-11-11");
    // and the landing time is not the meeting time
    expect(opsLines(k)[0].depends).toContain("الهبوط 2026-11-11 02:40 / اللقاء 2026-11-11 03:10");
  });

  it("9. arrival airport changed after confirmation: the confirmed reception goes to review, logged with who, price untouched", () => {
    const { j: base, flight, batumi, tbs } = georgia();
    const confirmed = addAirportReception(base, flight.id, batumi.id);
    confirmed.services[0] = { ...confirmed.services[0], status: "confirmed", at: "2026-11-10T13:00", price: 400 };
    const changed = structuredClone(confirmed);
    changed.segments[0].to = tbs.id;
    const saved = withChangeLog(confirmed, changed, "موظف ١", "2026-11-01T10:00:00Z");
    expect(saved.services[0].status).toBe("review");
    expect(saved.services[0].price).toBe(400);
    expect(saved.log.find((e) => e.field === "to")).toMatchObject({ by: "موظف ١", entity: "segment" });
    expect(saved.log.some((e) => e.by === "النظام" && e.after === "review")).toBe(true);
    // a reception that did NOT choose «use the arrival airport» is never moved by a ticket edit
    const hotelPickup = addPlaceReception(base, batumi.id, batumi.id);
    const t2 = structuredClone(hotelPickup);
    t2.segments[0].to = tbs.id;
    expect(serviceFrom(withChangeLog(hotelPickup, t2, "x", "2026-11-01T10:00:00Z"), t2.services[0])).toBe(batumi.id);
  });

  it("10. a simple one-country file stays simple: one flight, one stay, one reception — no noise", () => {
    const j: AdvancedJourney = { ...emptyJourney(), enabled: true, travellers: [{ id: "a", name: "س", kind: "adult", group: "" }] };
    const home = newPlace({ kind: "airport", name: "MED", tz: "Asia/Riyadh" });
    const ist = newPlace({ kind: "airport", name: "IST", tz: IST });
    const hotel = newPlace({ kind: "hotel", name: "فندق", tz: IST });
    j.places = [home, ist, hotel];
    j.segments = [newSegment({ mode: "flight", from: home.id, to: ist.id, dep: "2026-11-01T10:00", arr: "2026-11-01T13:00", ref: "TK 1" })];
    j.stays = [newStay({ place: hotel.id, check_in: "2026-11-01", check_out: "2026-11-04" })];
    const k = addAirportReception(j, j.segments[0].id, hotel.id);
    k.services[0].at = "2026-11-01T13:45";
    expect(checkJourney(k)).toEqual([
      expect.objectContaining({ code: "stay.early" }), // 13:00 landing, 14:00 check-in — said, not assumed away
    ]);
  });
});

describe("advanced package — rules", () => {
  it("errors block: arrival before departure across zones, check-out before check-in, a confirmed transfer with no place", () => {
    const j: AdvancedJourney = { ...emptyJourney(), enabled: true };
    const a = newPlace({ kind: "airport", name: "A", tz: "Asia/Riyadh" });
    const b = newPlace({ kind: "airport", name: "B", tz: IST });
    j.places = [a, b];
    // 10:00 Riyadh = 10:00 Istanbul (both UTC+3); landing 09:30 is before take-off
    j.segments = [newSegment({ mode: "flight", from: a.id, to: b.id, dep: "2026-11-01T10:00", arr: "2026-11-01T09:30", ref: "X1" })];
    j.stays = [newStay({ place: b.id, check_in: "2026-11-05", check_out: "2026-11-03" })];
    j.services = [newService({ kind: "transfer", status: "confirmed", from: a.id })];
    expect(checkJourney(j).filter((i) => i.severity === "error").map((i) => i.code).sort()).toEqual(["seg.arrBeforeDep", "stay.outBeforeIn", "svc.confirmedNoPlace"]);
  });

  it("a cross-zone flight that LOOKS backwards on the clocks is fine", () => {
    const j: AdvancedJourney = { ...emptyJourney(), enabled: true };
    const ist = newPlace({ kind: "airport", name: "IST", tz: IST });
    const lhr = newPlace({ kind: "airport", name: "LHR", tz: "Europe/London" });
    j.places = [ist, lhr];
    j.segments = [newSegment({ mode: "flight", from: ist.id, to: lhr.id, dep: "2026-11-01T10:00", arr: "2026-11-01T11:30", ref: "TK 1" })];
    expect(codes(j)).toEqual([]);
  });

  it("3 nights in 2 rooms: 3 nights, 6 room-nights", () => {
    const s = newStay({ place: "p", check_in: "2026-11-01", check_out: "2026-11-04", rooms: 2 });
    expect(stayNights(s)).toBe(3);
    expect(roomNights(s)).toBe(6);
  });

  it("concurrent stays are fine for different people and flagged for the same people", () => {
    const j: AdvancedJourney = { ...emptyJourney(), travellers: [{ id: "a", name: "", kind: "adult", group: "" }, { id: "b", name: "", kind: "adult", group: "" }] };
    const h1 = newPlace({ kind: "hotel", name: "H1", tz: IST });
    const h2 = newPlace({ kind: "hotel", name: "H2", tz: IST });
    j.places = [h1, h2];
    j.stays = [newStay({ place: h1.id, check_in: "2026-11-01", check_out: "2026-11-03", pax: ["a"] }), newStay({ place: h2.id, check_in: "2026-11-01", check_out: "2026-11-03", pax: ["b"] })];
    expect(codes(j).filter((c) => c.includes("conflict"))).toEqual([]);
    j.stays[1].pax = ["a"];
    expect(codes(j)).toContain("warning:conflict.stay");
  });

  it("two tickets on a connection ask for a check; a tight connection is flagged", () => {
    const j: AdvancedJourney = { ...emptyJourney(), travellers: [{ id: "a", name: "", kind: "adult", group: "" }] };
    const [x, y, z] = ["X", "Y", "Z"].map((n) => newPlace({ kind: "airport", name: n, tz: IST }));
    j.places = [x, y, z];
    j.segments = [
      newSegment({ mode: "flight", from: x.id, to: y.id, dep: "2026-11-01T08:00", arr: "2026-11-01T10:00", ref: "A1", ticket: "T-1" }),
      newSegment({ mode: "flight", from: y.id, to: z.id, dep: "2026-11-01T10:40", arr: "2026-11-01T12:00", ref: "B2", ticket: "T-2" }),
    ];
    expect(codes(j)).toEqual(expect.arrayContaining(["warning:tight", "warning:separateTickets"]));
  });

  it("a reception tied to a flight it meets before landing, or that lands elsewhere, is a warning", () => {
    const { j: base, flight, batumi, geSide } = georgia();
    const j = addPlaceReception(base, geSide.id, batumi.id);
    j.services[0] = { ...j.services[0], depends_on: flight.id, at: "2026-11-10T11:00" };
    expect(codes(j)).toEqual(expect.arrayContaining(["warning:svc.notWhereArrives"]));
    const k = addAirportReception(base, flight.id, batumi.id);
    k.services[0].at = "2026-11-10T11:00";
    expect(codes(k)).toContain("warning:svc.beforeArrival");
  });

  it("a hotel booked by the client with our reception: a service point, not a price", () => {
    const { j: base, batumi } = georgia();
    base.stays[0] = { ...base.stays[0], included: false, booked_by: "client", paid_by: "client" };
    const j = addPlaceReception(base, base.places[1].id, batumi.id);
    expect(journeyPricingLines(j).map((l) => l.item_type)).toEqual(["transport"]);
  });

  it("a late pickup after check-out is flagged; a cruise night adds no hotel", () => {
    const { j: base, batumi, tbs } = georgia();
    const j = { ...base, services: [newService({ kind: "farewell", from: batumi.id, to: tbs.id, at: "2026-11-14T19:00" })] };
    expect(codes(j)).toContain("warning:stay.lateDeparture");
    const cruise = { ...base, stays: [], segments: [...base.segments, newSegment({ mode: "ferry", from: base.places[1].id, to: batumi.id, dep: "2026-11-10T20:00", arr: "2026-11-11T07:00" })] };
    expect(cruise.stays).toEqual([]);
    expect(spans(cruise).includedNights).toBe(0);
  });

  it("returning to the same hotel is a second stay, not a merged one", () => {
    const { j: base, batumi } = georgia();
    base.stays.push(newStay({ place: batumi.id, check_in: "2026-11-16", check_out: "2026-11-17" }));
    expect(base.stays).toHaveLength(2);
    expect(spans(base).includedNights).toBe(4);
  });

  it("a legacy file: flights become information, an airport is not assumed to be the reception", () => {
    const d = emptyDraftData();
    d.trip = { ...d.trip, country: "تركيا", adults: 2 };
    d.flights = [{ ...emptyFlight("outbound"), from_airport: "MED", to_airport: "IST", flight_no: "123", airline_iata: "TK", departure_at: "2026-11-01T10:00", arrival_at: "2026-11-01T13:00" }];
    d.transport_plan.airport.enabled = false;
    const j = journeyFromDraft(d);
    expect(j.segments).toHaveLength(1);
    expect(j.services).toEqual([]);
    d.transport_plan.airport.enabled = true;
    const k = journeyFromDraft(d);
    expect(k.services[0]).toMatchObject({ kind: "reception", status: "review" });
    expect(k.travellers).toHaveLength(2);
  });

  it("normalize: an old draft has no journey; a partial one comes back whole", () => {
    expect(normalizeJourney(undefined)).toBeUndefined();
    const j = normalizeJourney({ enabled: true, services: [{ id: "s", kind: "reception" }] })!;
    expect(j.services[0].stops).toEqual([]);
    expect(j.services[0].included).toBe(true);
  });

  it("pricing: journey lines join the sheet only while the journey is on", () => {
    const d = emptyDraftData();
    const { j } = georgia();
    const k = addPlaceReception(j, j.places[4].id, j.places[5].id);
    k.services[0].price = 350;
    d.journey = k;
    const ref = { transfers: [], services: [], rooms: [], fleet: [], tours: [] };
    const refs = suggestPricing(d, ref as never, { hotel: "", airline: "" }).map((i) => i.ref);
    expect(refs).toEqual(expect.arrayContaining([`journey:${k.services[0].id}`]));
    d.journey = { ...k, enabled: false };
    expect(suggestPricing(d, ref as never, { hotel: "", airline: "" }).some((i) => i.ref?.startsWith("journey"))).toBe(false);
  });
});
