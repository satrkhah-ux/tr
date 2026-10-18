import { describe, expect, it } from "vitest";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { flightsReadiness, flightsState } from "./flights";
import { hotelsReadiness, hotelsState } from "./hotels";
import { notPulled } from "./pull";
import { transportReadiness, transportState } from "./transport";
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
