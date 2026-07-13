"use server";

import { getFlightProvider, type FlightResult, type FlightSearchParams } from "@/lib/providers/flight";
import { getHotelProvider, type HotelResult, type HotelSearchParams } from "@/lib/providers/hotel";

export async function searchHotels(params: HotelSearchParams): Promise<HotelResult[]> {
  try {
    return await getHotelProvider().search(params);
  } catch {
    return [];
  }
}

export async function searchFlights(params: FlightSearchParams): Promise<FlightResult[]> {
  try {
    return await getFlightProvider().search(params);
  } catch {
    return [];
  }
}
