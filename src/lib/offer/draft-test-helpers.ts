import { withRooms, type DraftData } from "./draft-types";

/**
 * Answer every question the card flow will not move past, without touching
 * what a test sets up on purpose. Tests about ONE rule start from a draft that
 * is otherwise publishable, so a failure points at that rule and nothing else.
 */
export function withRequiredAnswers(data: DraftData): DraftData {
  const plan = data.transport_plan;
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
    services: data.services.includes.length > 0 ? data.services : { ...data.services, includes: ["الإقامة"] },
    visas: data.visas.length > 0 ? data.visas : [{ country: data.trip.country, visa_type: "سياحية", count: 1, note: "" }],
    hotels: data.hotels.map((h) => withRooms(h, h.rooms.map((r) => ({ ...r, price: r.price ?? 100 })))),
  };
}
