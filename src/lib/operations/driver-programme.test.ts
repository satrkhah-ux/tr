import { describe, expect, it } from "vitest";
import { hotelMap, hotelsMessage, LATER, programmeMessage, programmeUpdate, recipientKey, type ProgrammeInput } from "./driver-programme";
import type { TransportCity } from "./wizard/transport";

// AD-2-7287: Trabzon then Istanbul, as the pull wrote it — before the tickets are read
const trabzon: ProgrammeInput = {
  serial: "AD-2-7287-20261017",
  from: "2026-10-20",
  to: "2026-10-26",
  customer: "أحمد علي",
  travellers: 2,
  country: "تركيا",
  trips: [
    { kind: "farewell", title: "فندق طرابزون ← المطار", city: "طرابزون", date: "2026-10-23", time: "", flight: "— TZX → IST", car: "سيارة صغيرة" },
    { kind: "tour", title: "جولة: جولة حيدر نبي", city: "طرابزون", date: "2026-10-21", time: "09:00", flight: "", car: "سيارة صغيرة" },
    { kind: "reception", title: "المطار ← فندق طرابزون", city: "طرابزون", date: "2026-10-20", time: "", flight: "— IST → TZX", car: "سيارة صغيرة" },
  ],
  stays: [
    { name: "ترابزون سي بيرل", name_en: "ترابزون سي بيرل", city: "طرابزون", check_in: "2026-10-20", check_out: "2026-10-23", address: null, phone: null, map: null, coords: { lat: 41.0, lng: 39.72 } },
  ],
  legs: [],
  airports: { TZX: "مطار طرابزون" },
  emergency: "0569222111",
};

describe("the driver's programme", () => {
  it("lists the booking, the guest, the car, the airport and the trips in time order", () => {
    const text = programmeMessage(trabzon);
    expect(text).toContain("الحجز / Booking: AD-2-7287-20261017 · 20/10/2026 → 26/10/2026");
    expect(text).toContain("اسم الزبون / Guest: أحمد علي · 2 مسافر / pax");
    expect(text).toContain("الدولة / Country: تركيا");
    expect(text).toContain("السيارة / Car: سيارة صغيرة");
    // no ticket read yet: said so, never «—»
    expect(text).toContain(`✈️ الوصول / Arrival: مطار طرابزون TZX · 20/10 · رحلة / Flight: ${LATER} · الوقت / Time: ${LATER}`);
    expect(text).toContain(`✈️ المغادرة / Departure: مطار طرابزون TZX · 23/10 · رحلة / Flight: ${LATER}`);
    const lines = text.split("\n");
    const at = lines.indexOf("البرنامج / Programme:");
    expect(lines.slice(at + 1, at + 4)).toEqual(["20/10 · استقبال من المطار ← ترابزون سي بيرل", "21/10 · 09:00 · جولة حيدر نبي", "23/10 · توديع ← مطار طرابزون"]);
    expect(text).toContain("للطوارئ / Emergency: 0569222111");
    expect(text).not.toMatch(/: —/);
  });

  it("takes the flight's number and local time from the ticket's legs", () => {
    const text = programmeMessage({
      ...trabzon,
      legs: [
        { flight_no: "TK2834", from: "IST", to: "TZX", departs_at: "2026-10-20T12:30:00+03:00", arrives_at: "2026-10-20T14:20:00+03:00" },
        { flight_no: "TK2837", from: "TZX", to: "IST", departs_at: "2026-10-23T16:05:00+03:00", arrives_at: "2026-10-23T18:00:00+03:00" },
      ],
    });
    expect(text).toContain("✈️ الوصول / Arrival: مطار طرابزون TZX · 20/10 · رحلة / Flight: TK2834 · الوقت / Time: 14:20");
    expect(text).toContain("✈️ المغادرة / Departure: مطار طرابزون TZX · 23/10 · رحلة / Flight: TK2837 · الوقت / Time: 16:05");
  });

  it("prepares only what changed since it was sent", () => {
    const before = programmeMessage(trabzon);
    expect(programmeUpdate(before, before, trabzon.serial)).toBeNull();
    expect(programmeUpdate(null, before, trabzon.serial)).toBeNull();
    const after = programmeMessage({ ...trabzon, legs: [{ flight_no: "TK2834", from: "IST", to: "TZX", departs_at: null, arrives_at: "2026-10-20T14:20:00+03:00" }] });
    expect(programmeUpdate(before, after, trabzon.serial)).toBe(
      "تحديث / Update — AD-2-7287-20261017\n✈️ الوصول / Arrival: مطار طرابزون TZX · 20/10 · رحلة / Flight: TK2834 · الوقت / Time: 14:20",
    );
  });
});

describe("the driver's hotels", () => {
  it("leaves a missing address or phone out and warns about it, with a short map link", () => {
    const { body, gaps } = hotelsMessage(trabzon);
    expect(body).toContain("🏨 ترابزون سي بيرل — طرابزون");
    expect(body).toContain("الدخول / Check-in: 20/10 · الخروج / Check-out: 23/10");
    expect(body).not.toContain("العنوان");
    expect(body).not.toContain("%");
    expect(body).toContain("https://www.google.com/maps/search/ترابزون+سي+بيرل/@41,39.72,14z");
    expect(gaps).toEqual([{ hotel: "ترابزون سي بيرل", missing: ["address", "phone"] }]);
  });

  it("prefers the hotel's own link, else its English name", () => {
    const stay = trabzon.stays[0];
    expect(hotelMap({ ...stay, map: "https://maps.app.goo.gl/abc" })).toBe("https://maps.app.goo.gl/abc");
    expect(hotelMap({ ...stay, name_en: "Arise Hotel & Golden Horn", coords: null, city: "اسطنبول" })).toBe(
      "https://www.google.com/maps/search/Arise+Hotel+Golden+Horn+اسطنبول",
    );
  });
});

describe("who gets a city's part", () => {
  const city = (driver: { name: string; phone: string }, supplierId: string | null) => ({ driver, supplierId }) as TransportCity;
  it("is the driver once named, else the agent its trips are with", () => {
    expect(recipientKey(city({ name: "Murat", phone: "+90 555 111" }, "s1"))).toBe("tel:90555111");
    expect(recipientKey(city({ name: "Murat", phone: "" }, "s1"))).toBe("drv:murat");
    expect(recipientKey(city({ name: "", phone: "" }, "s1"))).toBe("sup:s1");
    expect(recipientKey(city({ name: "", phone: "" }, null))).toBe("");
  });
});
