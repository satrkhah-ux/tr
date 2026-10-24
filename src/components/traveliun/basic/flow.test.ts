import { describe, expect, it } from "vitest";
import { fileSections, sectionOf, SECTION_ORDER } from "./flow";

const all = { intl: true, domestic: true, pricing: true };

describe("Basic's sections (the owner, 2026-10-25)", () => {
  it("runs client → international flights → hotels → domestic flights → programme, then services, price and issuing", () => {
    expect(SECTION_ORDER).toEqual(["client", "flights", "hotels", "domestic", "programme", "services", "pricing", "finish"]);
    expect(fileSections(all)).toEqual(SECTION_ORDER);
  });

  it("skips the domestic flights when no move between the cities is flown", () => {
    expect(fileSections({ ...all, domestic: false })).toEqual(["client", "flights", "hotels", "programme", "services", "pricing", "finish"]);
  });

  it("skips the international flights for a trip without them, and the price for who may not see it", () => {
    expect(fileSections({ intl: false, domestic: false, pricing: false })).toEqual(["client", "hotels", "programme", "services", "finish"]);
  });
});

describe("«ينقص» goes to the section that answers it", () => {
  const sections = fileSections(all);

  it("a domestic leg's missing price, airport or day → the domestic flights", () => {
    for (const key of ["pg.err.domFlightUnpriced", "pg.err.domFlightIncomplete", "pg.err.domesticMismatch"])
      expect(sectionOf({ stage: "flights", key }, sections)).toBe("domestic");
  });

  it("the international flights' own → the flights; without a domestic section a domestic check → the hotels, where the move is set", () => {
    expect(sectionOf({ stage: "flights", key: "pg.err.flightUnpriced" }, sections)).toBe("flights");
    expect(sectionOf({ stage: "flights", key: "pg.err.domesticMismatch" }, fileSections({ ...all, domestic: false }))).toBe("hotels");
  });

  it("a stay or a city → the hotels; a car or an untitled day → the programme; the client's → the client", () => {
    expect(sectionOf({ stage: "hotels", key: "pg.err.stayUnpriced" }, sections)).toBe("hotels");
    expect(sectionOf({ stage: "cities", key: "pg.err.noCities" }, sections)).toBe("hotels");
    expect(sectionOf({ stage: "transport", key: "pg.err.transportVehicle" }, sections)).toBe("programme");
    expect(sectionOf({ stage: "itinerary", key: "pg.err.dayUntitled" }, sections)).toBe("programme");
    expect(sectionOf({ stage: "customer", key: "pg.err.noMealPlan" }, sections)).toBe("client");
  });

  it("a section the file does not have answers nothing", () => {
    expect(sectionOf({ stage: "pricing", key: "pg.err.priceMissing" }, fileSections({ ...all, pricing: false }))).toBeNull();
    expect(sectionOf({ stage: "terms" }, sections)).toBeNull();
  });
});
