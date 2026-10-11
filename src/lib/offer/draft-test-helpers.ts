import { withRooms, type DraftData } from "./draft-types";

/**
 * Answer every question the card flow will not move past, without touching
 * what a test sets up on purpose. Tests about ONE rule start from a draft that
 * is otherwise publishable, so a failure points at that rule and nothing else.
 */
export function withRequiredAnswers(data: DraftData): DraftData {
  const plan = data.transport_plan;
  // A fixture with no flights is a test about something else: it does not sell
  // flights, rather than failing on the flights it never set up.
  const sellsFlights = data.flights.length > 0;
  const car = (leg: typeof plan.airport) => ({ ...leg, car_type: leg.car_type || "سيدان", cars: leg.cars || 1 });
  return {
    ...data,
    customer: {
      ...data.customer,
      customer_name: data.customer.customer_name || "عميل تجريبي",
      customer_phone: data.customer.customer_phone || "0500000000",
    },
    trip: { ...data.trip, meal_plan: data.trip.meal_plan ?? "breakfast" },
    transport_plan: { ...plan, airport: car(plan.airport), tours: car(plan.tours), intercity: { ...plan.intercity, ...car(plan.intercity) } },
    scope: sellsFlights ? data.scope : { ...data.scope, flights_intl: false, flights_domestic: false },
    flight_booking: {
      ...data.flight_booking,
      intl_price: data.flight_booking.intl_price ?? 2000,
      intl_supplier: data.flight_booking.intl_supplier || "TBO Holidays",
      dom_price: data.flight_booking.dom_price ?? 500,
      dom_supplier: data.flight_booking.dom_supplier || "TBO Holidays",
    },
    services: data.services.includes.length > 0 ? data.services : { ...data.services, includes: ["الإقامة"] },
    visas: data.visas.length > 0 ? data.visas : [{ country: data.trip.country, visa_type: "سياحية", count: 1, note: "" }],
    hotels: data.hotels.map((h) =>
      withRooms({ ...h, supplier: h.supplier || "TBO Holidays" }, h.rooms.map((r) => ({ ...r, price: r.price ?? 100 }))),
    ),
  };
}
