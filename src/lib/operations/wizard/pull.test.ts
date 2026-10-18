import { describe, expect, it } from "vitest";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { flightsReadiness, flightsState } from "./flights";
import { hotelsReadiness, hotelsState } from "./hotels";
import { notPulled } from "./pull";
import { tourBeforeArrival, transportCities, transportReadiness, transportState } from "./transport";
import type { OfferKinds, WizardCase } from "./types";

const booking = (p: Partial<OperationBooking>): OperationBooking =>
  ({ id: "b", kind: "hotel", status: "pending", title: "", city_name: "", start_date: null, detail: {}, confirmation_number: null, ...p }) as OperationBooking;
const wcase = (bookings: OperationBooking[], offerKinds?: OfferKinds | null) => ({ bookings, supplierWork: null, offerKinds }) as unknown as WizardCase;
const ALL: OfferKinds = { flight: true, hotel: true, transport: true };

describe("«لا ينطبق» only when the offer has none — AD-2-3599 opened with no booking (owner's order A1)", () => {
  it("reads «مطلوب» and blocks «جاهز للسفر» while the offer's flights, hotels and drives are not pulled", () => {
    const empty = wcase([], ALL);
    expect([flightsState(empty), hotelsState(empty), transportState(empty)]).toEqual(["todo", "todo", "todo"]);
    expect([...flightsReadiness(empty), ...hotelsReadiness(empty), ...transportReadiness(empty)]).toEqual([
      { step: "flights", key: "pulled", ok: false },
      { step: "hotels", key: "pulled", ok: false },
      { step: "transport", key: "pulled", ok: false },
    ]);
  });

  it("is «لا ينطبق» for a kind the offer does not book — and when the offer could not be read, as before", () => {
    const hotelsOnly = wcase([], { flight: false, hotel: true, transport: false });
    expect([flightsState(hotelsOnly), hotelsState(hotelsOnly), transportState(hotelsOnly)]).toEqual(["na", "todo", "na"]);
    expect(flightsReadiness(hotelsOnly)).toEqual([]);
    expect(hotelsState(wcase([], null))).toBe("na");
    expect(hotelsState(wcase([]))).toBe("na");
  });

  it("a kind cancelled on purpose was pulled — «لا ينطبق», not «لم تُسحب»", () => {
    const data = wcase([booking({ kind: "flight", status: "cancelled" })], ALL);
    expect(notPulled(data, "flight")).toBe(false);
    expect(flightsState(data)).toBe("na");
    expect(notPulled(data, "hotel")).toBe(true);
  });

  it("counts a tour or a transfer as the transport the offer books — a SIM card is not", () => {
    expect(notPulled(wcase([booking({ kind: "service", title: "شريحة اتصال × 2" })], ALL), "transport")).toBe(true);
    expect(notPulled(wcase([booking({ kind: "service", title: "جولة: أوبود" })], ALL), "transport")).toBe(false);
  });
});

describe("a tour on the day the group lands (owner's order H)", () => {
  const trips = (bookings: OperationBooking[]) => {
    const [city] = transportCities({ bookings, supplierWork: null });
    return { city, trip: (title: string) => city.trips.find((t) => t.booking.title === title)! };
  };
  const reception = (time: string) => booking({ id: "r", kind: "transport", title: "المطار ← فندق بالي", city_name: "بالي", start_date: "2026-10-07", detail: { الوقت: time } });
  const tour = (id: string, date: string, time: string) =>
    booking({ id, kind: "service", title: `جولة: ${id}`, city_name: "بالي", start_date: date, detail: { "وقت الانطلاق": time } });

  it("warns on a 09:00 tour the day of an untimed landing (AD-2-3599), not on the next day's", () => {
    const { city, trip } = trips([reception("يُحدَّد لاحقاً"), tour("أولى", "2026-10-07", "09:00"), tour("ثانية", "2026-10-08", "09:00")]);
    expect(tourBeforeArrival(trip("جولة: أولى"), city)).toBe(true);
    expect(tourBeforeArrival(trip("جولة: ثانية"), city)).toBe(false);
  });

  it("is quiet once the tour sets off well after the group is met", () => {
    const met = (at: string, starts: string) => {
      const { city, trip } = trips([reception(at), tour("أولى", "2026-10-07", starts)]);
      return tourBeforeArrival(trip("جولة: أولى"), city);
    };
    // met 15:15 (landing 14:30 + 45): a tour at 16:00 is too soon, 17:30 is fine
    expect(met("15:15", "16:00")).toBe(true);
    expect(met("15:15", "17:30")).toBe(false);
  });
});
