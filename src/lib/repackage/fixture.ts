/**
 * One complete, priced repackage for the tests: a client linked from the start, a
 * three-stop Georgia package, a supplier cost that is not a round number (so a
 * leak of it into a client tree cannot be mistaken for anything else), our sell
 * price, and two additions — one priced, one free. Invented data only.
 */
import {
  emptyExtractedPackage,
  emptyRepackageData,
  type ExtractedPackage,
  type RepackageData,
} from "./repackage-types";

/** What the supplier charges us — recognisable on sight if it ever shows up where it must not. */
export const SUPPLIER_COST = 7391.5;
/** What we sell the package for, before the additions. */
export const SELL = 8500;
/** The priced addition's sell price. */
export const ADDITION_PRICE = 320;

export function georgiaPackage(over: Partial<ExtractedPackage> = {}): ExtractedPackage {
  return {
    ...emptyExtractedPackage(),
    destination: "جورجيا",
    country: "جورجيا",
    cities: [
      { city_name: "تبليسي", nights: 3 },
      { city_name: "باتومي", nights: 2 },
    ],
    trip_nights: 5,
    arrival_date: "2026-11-10",
    departure_date: "2026-11-15",
    adults: 2,
    children: 1,
    infants: 0,
    hotels: [
      { city_name: "تبليسي", hotel_name: "Twenties Hotel", room_type: "غرفة ديلوكس", board: "BB", nights: 3, check_in: null, check_out: null },
      { city_name: "باتومي", hotel_name: "Sea Pearl", room_type: "غرفة بإطلالة", board: "HB", nights: 2, check_in: null, check_out: null },
    ],
    flights: [{ airline: "Air Test", flight_no: "AT100", from_airport: "RUH", to_airport: "TBS", departure_at: "2026-11-10T04:20", arrival_at: "2026-11-10T08:00" }],
    transfers: ["استقبال وتوديع من المطار"],
    includes: ["الإقامة في الفنادق", "الإفطار اليومي"],
    excludes: ["التأشيرة", "المصاريف الشخصية"],
    visas: [],
    terms: ["الأسعار قابلة للتغيير حسب التوفر."],
    supplier_total: SUPPLIER_COST,
    supplier_currency: "SAR",
    ...over,
  };
}

export function georgiaData(over: Partial<RepackageData> = {}): RepackageData {
  const base = emptyRepackageData();
  return {
    ...base,
    source: { ...base.source, supplier_name: "مورّد تجريبي", imported_at: "2026-10-20T10:00:00Z", how: "ai-text" },
    customer: { customer_name: "عميل تجريبي", customer_phone: "0500000000" },
    extracted: georgiaPackage(),
    confidence: { country: 1, cities: 1, trip_nights: 1, hotels: 1, supplier_total: 1 },
    additions: [
      { id: "a1", title: "جولة نهرية", detail: "ساعتان مع مرشد", sell_price: ADDITION_PRICE },
      { id: "a2", title: "شريحة اتصال", detail: "", sell_price: null },
    ],
    final_total: SELL,
    final_currency: "SAR",
    ...over,
  };
}
