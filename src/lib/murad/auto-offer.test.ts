import { describe, expect, it } from "vitest";
import { askText, DEFAULT_OFFERS, holdToText, missing, offerText, outOfRule, priceOffer, splitNights, tripDays } from "./auto-offer";

const georgia = DEFAULT_OFFERS[0];

describe("«عرض آلي» — Georgia, the owner's defaults (2026-10-18)", () => {
  it("splits the route in its proportions: 9 nights of 2/1/2/1 → تبليسي 3 + باكورياني 2 + باتومي 3 + تبليسي 1", () => {
    expect(splitNights(georgia.cities, 9).map((c) => `${c.city} ${c.nights}`)).toEqual(["تبليسي 3", "باكورياني 2", "باتومي 3", "تبليسي 1"]);
    expect(splitNights(georgia.cities, 6).map((c) => c.nights)).toEqual([2, 1, 2, 1]);
    expect(splitNights(georgia.cities, 2)).toEqual([{ ...georgia.cities[0], nights: 2 }]);
    for (const n of [4, 5, 7, 11, 14]) expect(splitNights(georgia.cities, n).reduce((s, c) => s + c.nights, 0)).toBe(n);
  });

  it("prices the owner's example: 10 days / 9 nights for two — 2,130 $ + 15 % = 2,449.5 $ ≈ 9,186 ريال", () => {
    const p = priceOffer(georgia, 10, 2, 3.75);
    expect(p).toMatchObject({ days: 10, nights: 9, rooms: 1, cost: 2130, total: 2449.5, totalSar: 9186 });
  });

  it("a room for every two adults", () => {
    expect(priceOffer(georgia, 10, 3, 3.75).rooms).toBe(2);
  });

  it("asks once for everything, then only for what is missing; a date is never required", () => {
    const none = { name: null, arrival: null, departure: null, days: null, adults: null, children: null };
    expect(missing(none)).toEqual(["name", "days", "people"]);
    expect(missing({ ...none, name: "محمد", days: 10, adults: 2 })).toEqual([]);
    expect(missing({ ...none, name: "محمد", arrival: "2026-11-15", departure: "2026-11-24", adults: 2 })).toEqual([]);
    expect(tripDays({ days: null, arrival: "2026-11-15", departure: "2026-11-24" })).toBe(10);
    expect(askText("جورجيا", ["name", "days", "people"], true)).toBe("حياك الله، عشان نجهز لك برنامج جورجيا: تكرماً الاسم، وتاريخ الوصول، وعدد الأيام، وعدد الأشخاص (بالغين وأطفال)؟");
    // «10 أيام» already said: not asked again
    expect(askText("جورجيا", ["name", "people"], true)).toBe("حياك الله، عشان نجهز لك برنامج جورجيا: تكرماً الاسم، وتاريخ الوصول، وعدد الأشخاص (بالغين وأطفال)؟");
    expect(askText("جورجيا", ["people"], false)).toBe("شكراً لك، باقي فقط: عدد الأشخاص (بالغين وأطفال)؟");
  });

  it("more than four, or children, go to a colleague", () => {
    const a = { name: "محمد", arrival: null, departure: null, days: 10 };
    expect(outOfRule({ ...a, adults: 2, children: 0 }, georgia)).toBe(false);
    expect(outOfRule({ ...a, adults: 2, children: 1 }, georgia)).toBe(true);
    expect(outOfRule({ ...a, adults: 5, children: 0 }, georgia)).toBe(true);
  });

  it("writes the proposal with the route, the total, and «مبدئي»", () => {
    const text = offerText({ name: "محمد", country: "جورجيا", price: priceOffer(georgia, 10, 2, 3.75), arrival: "2026-11-15", provisional: true, c: georgia });
    expect(text).toContain("10 أيام / 9 ليالٍ");
    expect(text).toContain("باكورياني: ليلتان — Dialog");
    expect(text).toContain("تبليسي: ليلة واحدة — Old Wall");
    expect(text).toContain("(التواريخ مبدئية)");
    expect(text).toContain("تبليسي: 3 ليالٍ — Old Wall Tbilisi 4★");
    expect(text).toContain("9,186 ريال");
    expect(text).toContain("لا يشمل: الطيران الدولي");
  });
});

describe("the model's dates held to what the client wrote", () => {
  const none = { name: null, arrival: null, departure: null, days: null, adults: null, children: null };
  const today = "2026-10-18";
  it("no date in the text → none, whatever the model proposed", () => {
    expect(holdToText("ابي رحلة جورجيا 10 أيام", { ...none, arrival: "2026-11-01", departure: "2026-11-11", days: 10 }, today)).toMatchObject({ arrival: null, departure: null, days: 10 });
  });
  it("a slipped year moves to the next to come; the departure only when two dates are named", () => {
    expect(holdToText("15 نوفمبر", { ...none, arrival: "2023-11-15", departure: "2023-11-25", days: 10 }, today)).toMatchObject({ arrival: "2026-11-15", departure: null, days: 10 });
  });
  it("two dates: the days are counted from them, both days in", () => {
    expect(holdToText("من 5 ديسمبر الى 12 ديسمبر", { ...none, arrival: "2026-12-05", departure: "2026-12-12", days: 7 }, today)).toMatchObject({ days: 8 });
  });
  it("«null» as a name is no name", () => {
    expect(holdToText("x", { ...none, name: "null" }, today).name).toBeNull();
  });
  it("the manager's test (2026-10-19): «انا وزوجتي» is no name, and «1 نووفمبر» is a date", () => {
    const text = "انا وزوجتي لمدة 10 ايام \nتاريخ السفر 1 نووفمبر";
    const held = holdToText(text, { ...none, name: "انا وزوجتي", arrival: "2026-11-01", days: 10, adults: 2 }, today);
    expect(held).toMatchObject({ name: null, arrival: "2026-11-01", days: 10, adults: 2 });
    expect(missing(held)).toEqual(["name"]);
    for (const party of ["شخصين", "عائلتي", "أنا", "انا وابني", "نحن 3"]) expect(holdToText("x", { ...none, name: party }, today).name).toBeNull();
    for (const real of ["محمد", "عبدالله السالم", "Sara"]) expect(holdToText("x", { ...none, name: real }, today).name).toBe(real);
  });
});
