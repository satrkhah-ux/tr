import { describe, expect, it } from "vitest";
import { carCount, carFields, carOf, carText, clientService, driverServiceKind, DRV, parseLeg, retimeTransfers, waNumber } from "./drivers";

const intl = {
  title: "طيران دولي RUH ⇄ KUL",
  detail: {
    الذهاب: "SV834 · RUH → KUL · 2026-11-20 01:00 · الوصول 2026-11-20 14:30",
    العودة: "SV835 · KUL → RUH · 2026-11-27 16:00 · الوصول 2026-11-27 20:00",
    الركاب: "2 بالغ + 2 طفل",
  },
};
const dom = {
  title: "طيران داخلي KUL → LGK · LGK → KUL",
  detail: {
    "رحلة 1": "MH1430 · KUL → LGK · 2026-11-24 10:00 · الوصول 2026-11-24 11:05",
    "رحلة 2": "MH1431 · LGK → KUL · 2026-11-27 09:00 · الوصول 2026-11-27 10:05",
  },
};
const reception = {
  id: "r1",
  kind: "transport",
  title: "المطار ← فندق كوالالمبور",
  start_date: "2026-11-20",
  detail: { الوقت: "15:15", الرحلة: "SV834 RUH → KUL", "نقطة الالتقاء": "صالة القادمين — KUL" },
};
const farewell = {
  id: "f1",
  kind: "transport",
  title: "فندق لنكاوي ← المطار",
  start_date: "2026-11-27",
  detail: { الوقت: "07:00", الرحلة: "MH1431 LGK → KUL", "نقطة الالتقاء": "بهو الفندق" },
};

describe("the reception follows the flight", () => {
  it("reads a leg line, landing included", () => {
    expect(parseLeg(intl.detail.الذهاب)).toEqual({ flight_no: "SV834", from: "RUH", to: "KUL", departure: "2026-11-20T01:00", arrival: "2026-11-20T14:30" });
    expect(parseLeg("— · RUH → KUL · يُحدَّد لاحقاً")).toEqual({ flight_no: "", from: "RUH", to: "KUL", departure: null, arrival: null });
    expect(parseLeg("2 بالغ + 2 طفل")).toBeNull();
  });

  it("meets the travellers 45 minutes after the new landing", () => {
    const moved = { ...intl, detail: { ...intl.detail, الذهاب: "SV834 · RUH → KUL · 2026-11-20 03:00 · الوصول 2026-11-20 16:30" } };
    expect(retimeTransfers(moved, intl.detail, [reception])).toEqual([
      { id: "r1", start_date: "2026-11-20", detail: { ...reception.detail, الوقت: "17:15" } },
    ]);
  });

  it("crosses midnight onto the next day", () => {
    const late = { ...intl, detail: { ...intl.detail, الذهاب: "SV834 · RUH → KUL · 2026-11-20 10:00 · الوصول 2026-11-20 23:40" } };
    expect(retimeTransfers(late, intl.detail, [reception])[0]).toMatchObject({ start_date: "2026-11-21", detail: { الوقت: "00:25" } });
  });

  it("picks up 2 h before a domestic take-off, and leaves a hand-set time alone when the leg did not move", () => {
    const moved = { ...dom, detail: { ...dom.detail, "رحلة 2": "MH1431 · LGK → KUL · 2026-11-27 10:30 · الوصول 2026-11-27 11:35" } };
    expect(retimeTransfers(moved, dom.detail, [farewell])[0].detail.الوقت).toBe("08:30");
    const handSet = { ...farewell, detail: { ...farewell.detail, الوقت: "06:30" } };
    expect(retimeTransfers({ ...dom, detail: { ...dom.detail, الدرجة: "سياحية" } }, dom.detail, [handSet])).toEqual([]);
  });

  it("finds a renumbered flight by its route and renames the link", () => {
    const swapped = { ...intl, detail: { ...intl.detail, الذهاب: "SV836 · RUH → KUL · 2026-11-20 01:00 · الوصول 2026-11-20 14:30" } };
    expect(retimeTransfers(swapped, intl.detail, [reception])[0].detail.الرحلة).toBe("SV836 RUH → KUL");
  });

  it("moves a reception by the take-off's shift when the line has no landing yet", () => {
    const before = { الذهاب: "SV834 · RUH → KUL · 2026-11-20 01:00" };
    const after = { ...intl, detail: { الذهاب: "SV834 · RUH → KUL · 2026-11-20 02:30" } };
    expect(retimeTransfers(after, before, [reception])[0].detail.الوقت).toBe("16:45");
  });
});

describe("what the client and the driver are told", () => {
  const withDriver = { ...reception, detail: { ...reception.detail, السائق: "Ali", "جوال السائق": "+60 12 345 6789", "رقم السيارة": "WXY 1234" } };

  it("shows the driver on the service day and never before", () => {
    expect(clientService(withDriver, "2026-11-19")?.driver).toBeNull();
    expect(clientService(withDriver, "2026-11-20")?.driver).toEqual({ name: "Ali", phone: "+60 12 345 6789", plate: "WXY 1234" });
    expect(clientService({ ...withDriver, kind: "hotel" }, "2026-11-20")).toBeNull();
  });

  it("knows a tour from a SIM card", () => {
    expect(driverServiceKind({ kind: "service", title: "جولة: المدينة", start_date: null, detail: { "وقت الانطلاق": "09:00" } })).toBe("tour");
    expect(driverServiceKind({ kind: "service", title: "شريحة اتصال × 2", start_date: null, detail: { العدد: "2" } })).toBeNull();
    expect(driverServiceKind(farewell)).toBe("farewell");
  });

  it("dials a Saudi mobile with its country code", () => {
    expect(waNumber("0569222111")).toBe("966569222111");
    expect(waNumber("+60 12-345 6789")).toBe("60123456789");
  });
});

describe("the car and how many — the count has its own key", () => {
  it("reads a booking pulled before the key: the count inside the car text", () => {
    expect(carOf({ [DRV.car]: "فان × 2" })).toEqual({ model: "فان", count: 2 });
    expect(carText({ [DRV.car]: "فان × 2" })).toBe("فان × 2");
    expect(carText({ [DRV.car]: "ميني فان" })).toBe("ميني فان");
  });

  it("keeps the count when a model is typed over the car", () => {
    expect(carText({ [DRV.car]: "Hyundai Staria", [DRV.cars]: "2" })).toBe("Hyundai Staria × 2");
    // the key wins over an old «× n» left in the text
    expect(carText({ [DRV.car]: "فان × 2", [DRV.cars]: "3" })).toBe("فان × 3");
    expect(carText({ [DRV.cars]: "2" })).toBe("× 2");
    expect(carText({})).toBe("");
  });

  it("opens the edit form on the model alone, the count beside it", () => {
    expect(carFields({ [DRV.car]: "فان × 2", السائق: "Ali" })).toEqual({ [DRV.car]: "فان", [DRV.cars]: "2" });
    expect(carFields({ السائق: "Ali" })).toEqual({});
  });

  it("takes a whole number from 1 to 50", () => {
    expect([carCount("1"), carCount(" 50 "), carCount("0"), carCount("51"), carCount("2.5"), carCount("")]).toEqual([1, 50, null, null, null, null]);
  });

  it("shows the client the car with its count", () => {
    const tour = { kind: "service", title: "جولة: المدينة", start_date: "2026-11-21", detail: { "وقت الانطلاق": "09:00", [DRV.car]: "H1", [DRV.cars]: "2" } };
    expect(clientService(tour, "2026-11-20")?.car).toBe("H1 × 2");
  });
});
