import { describe, expect, it } from "vitest";
import { compareLinks, parsePastedPrice } from "./compare";

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
