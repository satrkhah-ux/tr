import { describe, expect, it } from "vitest";
import { compareLinks, convertAmount, parsePastedPrice, pastedToRoomPrice } from "./compare";

describe("pastedToRoomPrice (Basic «استخدم هذا السعر»)", () => {
  const sarPer = { USD: 3.75, GEL: 1.4 };
  it("splits a whole-stay paste per room and per night in the stay's own currency", () => {
    expect(pastedToRoomPrice({ amount: 1200, currency: "SAR" }, { currency: "SAR", nights: 3, rooms: 2 }, sarPer)).toEqual({ perRoomStay: 600, perRoomNight: 200 });
    // 750 SAR pasted for a USD stay of 2 nights, 1 room → 200 USD, 100 a night
    expect(pastedToRoomPrice({ amount: 750, currency: "SAR" }, { currency: "USD", nights: 2, rooms: 1 }, sarPer)).toEqual({ perRoomStay: 200, perRoomNight: 100 });
  });
  it("refuses an unknown currency and a zero", () => {
    expect(pastedToRoomPrice({ amount: 100, currency: "JPY" }, { currency: "SAR", nights: 1, rooms: 1 }, sarPer)).toBeNull();
    expect(pastedToRoomPrice({ amount: 0, currency: "SAR" }, { currency: "SAR", nights: 1, rooms: 1 }, sarPer)).toBeNull();
  });
  it("convertAmount goes through SAR both ways", () => {
    expect(convertAmount(100, "USD", "SAR", sarPer)).toBe(375);
    expect(convertAmount(375, "SAR", "USD", sarPer)).toBe(100);
    expect(convertAmount(10, "USD", "USD", sarPer)).toBe(10);
  });
});

describe("compareLinks", () => {
  it("Booking carries the verified params; Agoda a name search with dates; المسافر its hotels page", () => {
    const links = compareLinks({ hotelName: "Old Wall", cityEn: "Tbilisi", cityAr: "تبليسي", checkIn: "2026-12-01", checkOut: "2026-12-03", adults: 2, rooms: 1 });
    const booking = new URL(links.find((l) => l.key === "booking")!.url);
    expect(booking.searchParams.get("ss")).toBe("Old Wall Tbilisi");
    expect(booking.searchParams.get("checkin")).toBe("2026-12-01");
    expect(booking.searchParams.get("checkout")).toBe("2026-12-03");
    expect(booking.searchParams.get("group_adults")).toBe("2");
    expect(booking.searchParams.get("no_rooms")).toBe("1");
    const agoda = new URL(links.find((l) => l.key === "agoda")!.url);
    expect(agoda.searchParams.get("textSearch")).toBe("Old Wall Tbilisi");
    expect(agoda.searchParams.get("los")).toBe("2");
    expect(links.find((l) => l.key === "almosafer")!.url).toContain("almosafer.com");
  });
  it("falls back to the Arabic city and survives missing dates", () => {
    const links = compareLinks({ cityAr: "تبليسي", cityEn: null, checkIn: null, checkOut: null, adults: 2, rooms: 2 });
    const booking = new URL(links[0].url);
    expect(booking.searchParams.get("ss")).toBe("تبليسي");
    expect(booking.searchParams.get("checkin")).toBeNull();
  });
});

describe("parsePastedPrice", () => {
  it("reads western and Arabic digits, separators, and the currency word or sign", () => {
    expect(parsePastedPrice("SAR 1,250.50 لليلتين")).toEqual({ amount: 1250.5, currency: "SAR", assumed: false });
    expect(parsePastedPrice("١٬٢٥٠ ر.س")).toEqual({ amount: 1250, currency: "SAR", assumed: false });
    expect(parsePastedPrice("$ 340 total")).toEqual({ amount: 340, currency: "USD", assumed: false });
    expect(parsePastedPrice("درهم 999")).toEqual({ amount: 999, currency: "AED", assumed: false });
  });
  it("takes the largest number (a pasted line often also holds nights or stars) and assumes SAR when nothing is said", () => {
    expect(parsePastedPrice("فندق 4 نجوم — 2 ليالٍ — 1,180")).toEqual({ amount: 1180, currency: "SAR", assumed: true });
    expect(parsePastedPrice("لا سعر هنا")).toBeNull();
    expect(parsePastedPrice("")).toBeNull();
  });
});
