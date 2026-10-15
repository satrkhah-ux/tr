import { describe, expect, it } from "vitest";
import { deriveTransportRows, normalizeDraftData, transportRef, type DraftData } from "./draft-types";
import { addService, basicDays, cityServices, moveCity, priceAtSource, removeService, setService } from "./basic";
import { ownerExample } from "./draft-test-helpers";
import { suggestPricing, type PricingReference } from "./pricing-suggest";

const rowsOf = (data: DraftData, i: number) => cityServices(data, i).map((r) => [r.kind, r.date, r.text]);

describe("a city visit's services: the trip writes them once", () => {
  it("Selangor: met at KUL and driven to the hotel in Selangor, then seen off to KUL the day it flies", () => {
    expect(rowsOf(ownerExample(), 0)).toEqual([
      ["reception", "2026-10-20", "الاستقبال من مطار كوالالمبور الدولي والتوصيل إلى فندق صن واي بيراميد في سيلانجور"],
      ["farewell", "2026-10-22", "التوصيل من فندق سيلانجور إلى مطار كوالالمبور الدولي"],
    ]);
  });

  it("Langkawi and Penang: met at their own airports (no «في» — the airport is the city's), seen off the day they fly", () => {
    const data = ownerExample();
    expect(rowsOf(data, 1)).toEqual([
      ["reception", "2026-10-22", "الاستقبال من مطار لنكاوي الدولي والتوصيل إلى الفندق"],
      ["farewell", "2026-10-25", "التوصيل من فندق لنكاوي إلى مطار لنكاوي الدولي"],
    ]);
    const penang = cityServices(data, 2);
    expect(penang.map((r) => [r.kind, r.date, r.text]).sort()).toEqual([
      ["farewell", "2026-10-27", "التوصيل من فندق بينانج إلى مطار بينانج الدولي"],
      ["reception", "2026-10-25", "الاستقبال من مطار بينانج الدولي والتوصيل إلى الفندق"],
    ]);
    // the flight's clock beside the row it meets
    expect(cityServices(data, 1).find((r) => r.kind === "reception")?.clock).toBe("16:05");
    expect(penang.find((r) => r.kind === "farewell")?.clock).toBe("18:00");
  });

  it("never twice: one reception and one farewell a visit, each its own pricing line", () => {
    const data = ownerExample();
    const all = data.cities.flatMap((_, i) => cityServices(data, i));
    expect(all).toHaveLength(6);
    for (const i of [0, 1, 2]) {
      expect(cityServices(data, i).filter((r) => r.kind === "reception")).toHaveLength(1);
      expect(cityServices(data, i).filter((r) => r.kind === "farewell")).toHaveLength(1);
    }
    expect(new Set(all.map((r) => r.ref)).size).toBe(6);
    // and they are exactly the transport rows the sheet prices
    expect(deriveTransportRows(data.transport_plan, data.cities).filter((r) => r.from_place !== "الجولات السياحية").map(transportRef).sort()).toEqual(
      all.map((r) => r.ref).sort(),
    );
  });

  it("says nothing without transport in the sale", () => {
    const data = ownerExample();
    expect(cityServices({ ...data, scope: { ...data.scope, transport: false } }, 0)).toEqual([]);
  });
});

describe("«+ إضافة خدمة» and taking a row away", () => {
  it("adds a row of any type on a day of the visit, priced on its own line", () => {
    const data = ownerExample();
    const cities = addService(data.cities, 1, "transfer", "2026-10-24");
    const added = cityServices({ ...data, cities }, 1).find((r) => !r.auto)!;
    expect(added).toMatchObject({ kind: "transfer", date: "2026-10-24", text: "التوصيل داخل لنكاوي", car_type: "فان", cars: 1 });
    expect(added.ref).toMatch(/^transport:svc:/);
    const row = deriveTransportRows(data.transport_plan, cities).find((r) => transportRef(r) === added.ref)!;
    expect(row).toMatchObject({ from_place: "لنكاوي", to_place: "لنكاوي", date: "2026-10-24", text: "التوصيل داخل لنكاوي" });

    // its type changes what it is: a reception goes from the airport to the hotel
    const id = added.id;
    const met = setService(cities, 1, id, { kind: "reception" });
    expect(deriveTransportRows(data.transport_plan, met).find((r) => transportRef(r) === added.ref)).toMatchObject({ from_place: "المطار", to_place: "فندق لنكاوي" });

    // and it goes
    expect(cityServices({ ...data, cities: removeService(met, 1, id) }, 1)).toHaveLength(2);
  });

  it("takes the trip's own reception away — it is not written again", () => {
    const data = ownerExample();
    const cities = removeService(data.cities, 1, "in");
    expect(cityServices({ ...data, cities }, 1).map((r) => r.kind)).toEqual(["farewell"]);
    expect(deriveTransportRows(data.transport_plan, cities).some((r) => r.to_place === "فندق لنكاوي")).toBe(false);
  });
});

describe("a reorder", () => {
  it("lets go of what was set on a road that is no longer driven; an added row stays", () => {
    const data = ownerExample();
    let cities = setService(data.cities, 0, "out", { price: 150 });
    cities = addService(cities, 0, "transfer", "2026-10-21");
    cities = setService(cities, 1, "in", { price: 99 });
    // Penang before Langkawi: Selangor now flies to Penang, Langkawi is met from Penang
    const moved = moveCity({ ...data, cities }, 1, 2).cities;
    expect(moved.map((c) => c.city_name)).toEqual(["سيلانجور", "بينانج", "لنكاوي"]);
    expect(moved[0].services?.map((s) => s.id)).toEqual([cities[0].services![1].id]);
    expect(moved[2].services).toEqual([]);
  });
});

describe("each row's price is its pricing line", () => {
  const reference: PricingReference = {
    transfers: [{ from_city: "مطار كوالالمبور الدولي", to_city: "سيلانجور", car_type: "فان", price: 200, currency: "SAR" }],
    services: [],
    rooms: [],
    fleet: [],
  };
  const line = (data: DraftData, ref: string) => suggestPricing(data, reference, { hotel: "فندق", airline: "طيران" }).find((i) => i.ref === ref)!;

  it("the list's price until one is typed on the row; typed, the row's car, cars and price are the line", () => {
    const data = ownerExample();
    const reception = cityServices(data, 0)[0];
    expect(line(data, reception.ref)).toMatchObject({ quantity: 1, sell_price: 200, buy_price: 200, source: "list" });

    const cities = setService(data.cities, 0, "in", { price: 180, cars: 2 });
    const next = { ...data, cities, transport: deriveTransportRows(data.transport_plan, cities) };
    const row = cityServices(next, 0)[0];
    expect(row).toMatchObject({ price: 180, cars: 2, car_type: "فان" });
    expect(line(next, row.ref)).toMatchObject({ quantity: 2, sell_price: 180, buy_price: 180, sell_currency: "SAR", source: "typed" });
  });

  it("a price typed on the sheet is written back on the row", () => {
    const data = ownerExample();
    const farewell = cityServices(data, 1).find((r) => r.kind === "farewell")!;
    const back = priceAtSource(data, { item_type: "transport", ref: farewell.ref }, { price: 140 });
    expect(back?.cities?.[1].services).toEqual([{ id: "out", price: 140 }]);
    expect(cityServices({ ...data, ...back }, 1).find((r) => r.kind === "farewell")?.price).toBe(140);
  });
});

describe("an old Basic file opens as it was", () => {
  it("keeps the same days, the same transfer rows and the same total", () => {
    // a file saved before the services table: no `services` on any stop
    const old = ownerExample();
    old.hotels = old.hotels.map((h) => ({ ...h, rooms: h.rooms.map((r) => ({ ...r, price: 1000 })) }));
    const raw = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
    const back = normalizeDraftData(raw);

    expect(back.cities.every((c) => !("services" in c))).toBe(true);
    expect(basicDays(back)).toEqual(old.days);
    expect(back.transport).toEqual(old.transport);
    expect(JSON.stringify(back.transport)).not.toMatch(/"(price|text|ref)"/);

    const reference: PricingReference = {
      transfers: [{ from_city: "مطار كوالالمبور الدولي", to_city: "سيلانجور", car_type: "فان", price: 200, currency: "SAR" }],
      services: [],
      rooms: [],
      fleet: [],
    };
    const items = suggestPricing(back, reference, { hotel: "فندق", airline: "طيران" });
    const total = items.reduce((sum, i) => sum + (i.sell_price ?? 0) * i.quantity, 0);
    // three stays at 1,000, KUL ↔ Selangor both ways at the list's 200, three tours (250 + 300 + 280)
    expect(total).toBe(3000 + 400 + 830);
    expect(items.filter((i) => i.item_type === "transport").map((i) => i.ref)).toEqual([
      "transport:المطار>فندق سيلانجور>فان",
      "transport:فندق بينانج>المطار>فان",
      "transport:فندق سيلانجور>المطار>فان",
      "transport:المطار>فندق لنكاوي>فان",
      "transport:فندق لنكاوي>المطار>فان",
      "transport:المطار>فندق بينانج>فان",
    ]);
  });
});
