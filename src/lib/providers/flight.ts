/**
 * Flight search behind a stable provider interface — same pattern as hotels.
 * Mock adapter now; a real provider (Amadeus / a GDS) plugs in later via env.
 */

export type FlightSearchParams = {
  from: string;
  to: string;
  date: string;
  passengers?: number;
  maxPrice?: number;
  currency?: string;
};

export type FlightResult = {
  id: string;
  carrier: string;
  from: string;
  to: string;
  date: string;
  departTime: string;
  arriveTime: string;
  stops: number;
  baggage: string;
  price: number;
  currency: string;
};

export interface FlightProvider {
  readonly id: string;
  search(params: FlightSearchParams): Promise<FlightResult[]>;
}

const CARRIERS = [
  "الخطوط السعودية",
  "طيران ناس",
  "الاتحاد للطيران",
  "طيران الإمارات",
  "الخطوط القطرية",
  "الخطوط التركية",
];

class MockFlightProvider implements FlightProvider {
  readonly id = "mock";

  async search(params: FlightSearchParams): Promise<FlightResult[]> {
    const currency = params.currency ?? "SAR";
    const passengers = params.passengers ?? 1;
    const all: FlightResult[] = CARRIERS.map((carrier, index) => {
      const stops = index % 3 === 0 ? 0 : 1;
      const basePrice = 780 + index * 190 + stops * 140;
      const departHour = 6 + index * 2;
      return {
        id: `mock-${index}`,
        carrier,
        from: params.from,
        to: params.to,
        date: params.date,
        departTime: `${String(departHour % 24).padStart(2, "0")}:15`,
        arriveTime: `${String((departHour + 3 + stops) % 24).padStart(2, "0")}:40`,
        stops,
        baggage: stops === 0 ? "30 كجم" : "20 كجم",
        price: basePrice * passengers,
        currency,
      };
    });

    return all
      .filter((f) => (params.maxPrice ? f.price <= params.maxPrice : true))
      .sort((a, b) => a.price - b.price);
  }
}

export function getFlightProvider(): FlightProvider {
  const selected = process.env.FLIGHT_PROVIDER ?? "mock";
  if (selected === "amadeus" && process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    // Real provider goes here once credentials are configured.
  }
  return new MockFlightProvider();
}
