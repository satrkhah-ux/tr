import { describe, expect, it } from "vitest";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import type { SupplierWork } from "@/lib/data/supplier-work";
import { buildSupplierRequest } from "@/lib/operations/supplier-request";
import { isUnassigned } from "@/lib/operations/wizard";
import { driverTargets, requestTrips, transportCities, transportReadiness, transportState } from "./transport";
import type { WizardCase } from "./types";

// AD-2-7287 as the pull wrote it: 2 receptions, 3 tours in two cities, a hotel that is not transport
let n = 0;
function booking(over: Partial<OperationBooking>): OperationBooking {
  n += 1;
  return {
    id: `b${n}`,
    operation_id: "op",
    kind: "transport",
    title: "",
    city_name: "",
    start_date: null,
    end_date: null,
    detail: {},
    supplier_name: "",
    source: "manual",
    status: "pending",
    is_paid: false,
    origin: "offer",
    assignee_kind: "ops",
    assignee_employee_id: null,
    assignee_partner_id: null,
    assignee_supplier_id: null,
    assignee_label: null,
    assigned_at: null,
    handoff_note: null,
    confirmation_number: null,
    quoted_net: null,
    net_charged: null,
    currency: "SAR",
    cancellation_policy: null,
    cancellation_deadline: null,
    note: null,
    company_ref: null,
    pnr: null,
    ticket_numbers: [],
    flight_legs: [],
    baggage: null,
    ...over,
  };
}

const tzReception = booking({ title: "المطار ← فندق طرابزون", city_name: "طرابزون", start_date: "2026-10-20", detail: { الوقت: "يُحدَّد لاحقاً" } });
const tour1 = booking({ kind: "service", title: "جولة: جولة حيدر نبي", city_name: "طرابزون", start_date: "2026-10-21", detail: { "وقت الانطلاق": "09:00", المدينة: "طرابزون" } });
const tour2 = booking({ kind: "service", title: "جولة: جولة زيغانا", city_name: "طرابزون", start_date: "2026-10-22", detail: { "وقت الانطلاق": "09:00" } });
const istReception = booking({ title: "المطار ← فندق اسطنبول", city_name: "إسطنبول", start_date: "2026-10-23" });
const istTour = booking({ kind: "service", title: "جولة: جولة السلطان احمد", city_name: "اسطنبول", start_date: "2026-10-24", detail: { "وقت الانطلاق": "09:00" } });
const hotel = booking({ kind: "hotel", title: "فندق", city_name: "طرابزون" });
const sim = booking({ kind: "service", title: "شريحة اتصال" });

const wc = (bookings: OperationBooking[], supplierWork: SupplierWork | null = null) => ({ bookings, supplierWork }) as unknown as WizardCase;
const all = [istTour, tour2, hotel, tzReception, tour1, sim, istReception];

describe("«المواصلات» by city", () => {
  it("groups the drives and tours by city, in trip order, and nothing else", () => {
    const cities = transportCities(wc(all));
    expect(cities.map((c) => c.name)).toEqual(["طرابزون", "إسطنبول"]);
    expect(cities[0].trips.map((t) => t.booking.id)).toEqual([tzReception.id, tour1.id, tour2.id]);
    // «إسطنبول» and «اسطنبول» are one city
    expect(cities[1].trips.map((t) => t.booking.id)).toEqual([istReception.id, istTour.id]);
    expect(cities[0].trips[0].time).toBe("");
    expect(cities[0].trips[1]).toMatchObject({ kind: "tour", time: "09:00" });
  });

  it("is «na» without a drive or a tour, and asks nothing", () => {
    expect(transportState(wc([hotel, sim]))).toBe("na");
    expect(transportReadiness(wc([hotel]))).toEqual([]);
  });

  it("needs a supplier and a confirmation for every city; the driver is optional", () => {
    const sup = (b: OperationBooking, id: string, status = "pending") =>
      ({ ...b, assignee_kind: "supplier", assignee_supplier_id: id, assigned_at: "2026-10-17T10:00:00Z", status }) as OperationBooking;
    const half = [sup(tzReception, "agentTZ"), sup(tour1, "agentTZ"), sup(tour2, "agentTZ"), istReception, istTour];
    expect(transportState(wc(half))).toBe("todo");
    expect(transportReadiness(wc(half)).map((r) => [r.key, r.ok, r.optional ?? false])).toEqual([
      ["wz.transport.ready.supplier", false, false],
      ["wz.transport.ready.confirmed", false, false],
      ["wz.transport.ready.driver", false, true],
    ]);
    const done = [tzReception, tour1, tour2, istReception, istTour].map((b) => sup(b, b.city_name === "طرابزون" ? "agentTZ" : "agentIST", "confirmed"));
    expect(transportState(wc(done))).toBe("done");
    expect(transportReadiness(wc(done)).filter((r) => !r.optional).every((r) => r.ok)).toBe(true);
  });

  it("asks one supplier for the city's open trips — or nobody while they are split", () => {
    const sup = (b: OperationBooking, id: string, status = "pending") => ({ ...b, assignee_kind: "supplier", assignee_supplier_id: id, status }) as OperationBooking;
    const city = (list: OperationBooking[]) => transportCities(wc(list))[0];
    expect(requestTrips(city([sup(tzReception, "A"), sup(tour1, "A"), sup(tour2, "A", "confirmed")]))).toEqual({ supplierId: "A", ids: [tzReception.id, tour1.id] });
    expect(requestTrips(city([sup(tzReception, "A"), tour1]))).toBeNull();
    expect(requestTrips(city([sup(tzReception, "A"), sup(tour1, "B")]))).toBeNull();
  });

  it("reads where the city's request stands from its worst open trip", () => {
    const work = (states: Record<string, [string, string | null]>) =>
      ({ now: "2026-10-17T12:00:00Z", bookings: Object.entries(states).map(([booking_id, [state, sent_at]]) => ({ booking_id, state, sent_at })) }) as unknown as SupplierWork;
    const list = [tzReception, tour1, tour2];
    const c = transportCities(wc(list, work({ [tzReception.id]: ["sent", "2026-10-17T09:00:00Z"], [tour1.id]: ["overdue", "2026-10-16T09:00:00Z"], [tour2.id]: ["sent", "2026-10-17T09:00:00Z"] })))[0];
    expect(c.request).toBe("overdue");
    expect(c.sentAt).toBe("2026-10-16T09:00:00Z");
  });

  it("writes the city's driver once, sparing a trip given its own", () => {
    const drv = (b: OperationBooking, name: string, phone = "") => ({ ...b, detail: { ...b.detail, السائق: name, "جوال السائق": phone } }) as OperationBooking;
    const c = transportCities(wc([drv(tzReception, "Murat", "+90 555"), drv(tour1, "Murat", "+90 555"), drv(tour2, "Ali")]))[0];
    expect(c.driver).toEqual({ name: "Murat", phone: "+90 555" });
    expect(driverTargets(c)).toEqual([tzReception.id, tour1.id]);
    // nobody named yet: every trip
    expect(driverTargets(transportCities(wc([tzReception, tour1]))[0])).toEqual([tzReception.id, tour1.id]);
  });

  it("sends a city's trips as one numbered request", () => {
    const { subject, body } = buildSupplierRequest({
      lang: "ar",
      reference: "AD-2-7287",
      contact: null,
      booking: { kind: "transport", title: tzReception.title, city_name: "طرابزون", start_date: "2026-10-20", end_date: null, detail: { الوقت: "15:45" } },
      also: [{ kind: "service", title: tour1.title, city_name: "طرابزون", start_date: "2026-10-21", end_date: null, detail: { "وقت الانطلاق": "09:00", المدينة: "طرابزون" } }],
      travelers: [{ name: "AHMED", kind: "adult" }],
      note: null,
    });
    expect(subject).toBe("طلب حجز AD-2-7287 — المطار ← فندق طرابزون (+1)");
    expect(body).toContain("1) المطلوب: المطار ← فندق طرابزون\nالتاريخ: 2026-10-20\n• الوقت: 15:45");
    expect(body).toContain("\n\n2) المطلوب: جولة: جولة حيدر نبي\nالمدينة: طرابزون\nالتاريخ: 2026-10-21\n• وقت الانطلاق: 09:00");
    // the guests once, not per trip
    expect(body.match(/AHMED/g)?.length).toBe(1);
  });
});

describe("«بلا منفّذ»", () => {
  it("is the default nobody chose — not «قسم العمليات» picked on purpose", () => {
    expect(isUnassigned({ assignee_kind: "ops", assigned_at: null })).toBe(true);
    expect(isUnassigned({ assignee_kind: "ops", assigned_at: "2026-10-17T10:00:00Z" })).toBe(false);
    expect(isUnassigned({ assignee_kind: "supplier", assigned_at: null })).toBe(false);
  });
});
