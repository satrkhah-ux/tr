import {
  deriveCityDates,
  deriveTransportRows,
  emptyDraftData,
  emptyFlight,
  withCityKeys,
  withRooms,
  type DraftData,
  type DraftFlight,
} from "./draft-types";
import { basicDays, hotelForCity } from "./basic";

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
      dom_price: data.flight_booking.dom_price ?? 500,
    },
    services: data.services.includes.length > 0 ? data.services : { ...data.services, includes: ["الإقامة"] },
    visas: data.visas.length > 0 ? data.visas : [{ country: data.trip.country, visa_type: "سياحية", count: 1, note: "" }],
    hotels: data.hotels.map((h) =>
      withRooms({ ...h, supplier: h.supplier || "TBO Holidays" }, h.rooms.map((r) => ({ ...r, price: r.price ?? 100 }))),
    ),
  };
}

const KUL = "مطار كوالالمبور الدولي (KUL)";
const LGK = "مطار لنكاوي الدولي (LGK)";
const PEN = "مطار بينانج الدولي (PEN)";

const leg = (order: DraftFlight["leg_order"], from: [string, string], to: [string, string], dep: string, arr: string | null): DraftFlight => ({
  ...emptyFlight(order),
  from_airport: from[0],
  from_city: from[1],
  to_airport: to[0],
  to_city: to[1],
  departure_at: dep,
  arrival_at: arr,
});

/**
 * The owner's example: land at KUL on Tue 20 Oct and sleep in Selangor (another
 * city) two nights — a tour that same day, the 21st free — fly KUL→LGK on the
 * 22nd, three nights in Langkawi, fly LGK→PEN on the 25th, two nights in Penang,
 * home on the 27th.
 */
export function ownerExample(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 7, days: 8, adults: 2 };
  data.transport_plan = {
    airport: { enabled: true, car_type: "فان", cars: 1, note: "" },
    tours: { enabled: true, car_type: "سيارة صغيرة", cars: 1, note: "" },
    intercity: { enabled: true, mode: "flight", modes: ["flight"], car_type: "فان", cars: 1, note: "" },
  };
  data.flights = [
    leg("outbound", ["مطار الأمير محمد بن عبدالعزيز الدولي (MED)", "المدينة المنورة"], [KUL, "كوالالمبور"], "2026-10-20T01:30", "2026-10-20T13:10"),
    leg("internal", [KUL, "كوالالمبور"], [LGK, "لنكاوي"], "2026-10-22T15:00", "2026-10-22T16:05"),
    leg("internal", [LGK, "لنكاوي"], [PEN, "بينانج"], "2026-10-25T12:00", "2026-10-25T12:40"),
    leg("inbound", [PEN, "بينانج"], ["مطار الأمير محمد بن عبدالعزيز الدولي (MED)", "المدينة المنورة"], "2026-10-27T18:00", null),
  ];
  data.cities = withCityKeys(
    deriveCityDates("2026-10-20", [
      { city_name: "سيلانجور", nights: 2, tours: 1, tour_picks: [{ program_id: null, title: "جولة في مدينة الأضواء", text: "", price: 250, date: "2026-10-20", cars: 1 }], check_in: null, check_out: null },
      { city_name: "لنكاوي", nights: 3, tours: 1, tour_picks: [{ program_id: null, title: "جولة الجزر", text: "", price: 300, date: "2026-10-23", cars: 1 }], check_in: null, check_out: null },
      { city_name: "بينانج", nights: 2, tours: 1, tour_picks: [{ program_id: null, title: "جولة في بينانج", text: "", price: 280, date: "2026-10-26", cars: 1 }], check_in: null, check_out: null },
    ]),
  );
  data.hotels = data.cities.map((c, i) => ({ ...hotelForCity(data, c.city_name, "SAR", c.key), hotel_name: ["صن واي بيراميد", "ميريتوس بيلانجي", "شانغريلا راسا سايانج"][i] }));
  data.transport = deriveTransportRows(data.transport_plan, data.cities);
  data.days = basicDays(data);
  return data;
}
