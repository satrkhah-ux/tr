import "server-only";
import type { BoardType } from "@/lib/types";

/**
 * Almosafer DEMO snapshot — REAL data captured 2026-07-21 from Almosafer's own
 * official connector (search_hotels / search_flights), for the management demo.
 *
 * ⚠️ THIS IS A FIXTURE, NOT A LIVE FEED. Prices were real at capture time and
 * WILL drift. It exists only to show, inside our own system, exactly the kind of
 * result an official Almosafer partner API would return — so management can
 * approve that API. It is gated behind ALMOSAFER_DEMO=1 and every surface that
 * shows it is labelled «عرض توضيحي». When the real API lands, the adapter swaps
 * this fixture for a live fetch and nothing else changes.
 *
 * Prices are SAR, taxes included. Hotel rates are per-night (the honest number);
 * the adapter multiplies by the itinerary's own night count, so the demo adapts
 * to whatever dates the agent picked instead of freezing a 3-night total.
 */

export const ALMOSAFER_CAPTURE_DATE = "2026-07-21";
export const ALMOSAFER_DEMO_LABEL = "المسافر — عرض توضيحي";

export type AlmosaferDemoHotel = {
  id: number;
  name: string;
  star: number;
  district: string | null;
  landmark: string | null;
  landmarkKm: number | null;
  perNight: number; // SAR, tax-incl, per night for 2 adults
  reviewScore: number;
  reviewCount: number;
  image: string;
  board: BoardType;
  freeCancellation: boolean;
  lat: number;
  lng: number;
};

/** Keyed by a normalised city name; the matcher below maps Arabic/English in. */
export const ALMOSAFER_DEMO_HOTELS: Record<string, AlmosaferDemoHotel[]> = {
  "kuala lumpur": [
    { id: 1053875, name: "جراند ميلينيوم كوالا لمبور", star: 5, district: "Bukit Bintang", landmark: "أبراج بتروناس التوأم", landmarkKm: 1.1, perNight: 501, reviewScore: 8.2, reviewCount: 997, image: "http://hotelcms-contents-live.almosafer.com/3d0a1b3a-fd64-483b-9eb9-3b7539d68c01.jpg", board: "RO", freeCancellation: false, lat: 3.147958, lng: 101.712274 },
    { id: 1412038, name: "ترادرز هوتل كوالالمبور", star: 5, district: "KLCC", landmark: "أبراج بتروناس التوأم", landmarkKm: 0.5, perNight: 618, reviewScore: 9.3, reviewCount: 84, image: "http://hotelcms-contents-live.almosafer.com/b6c6d458-571d-473f-ae0b-89fe6e498e1c.jpg", board: "RO", freeCancellation: false, lat: 3.153911, lng: 101.714874 },
    { id: 1755920, name: "بافيليون هوتل كوالالمبور مانيدجد باي بانيان تري", star: 5, district: "Bukit Bintang", landmark: "أبراج بتروناس التوأم", landmarkKm: 1.0, perNight: 676, reviewScore: 9.2, reviewCount: 634, image: "http://hotelcms-contents-live.almosafer.com/4d4c06fc-6374-43b1-96b3-11cfd70f4cee.jpg", board: "BB", freeCancellation: false, lat: 3.148633, lng: 101.714849 },
    { id: 1053886, name: "أسكوت كوالالمبور", star: 5, district: "City Centre", landmark: "أبراج بتروناس التوأم", landmarkKm: 0.3, perNight: 746, reviewScore: 8.8, reviewCount: 769, image: "http://hotelcms-contents-live.almosafer.com/9d4ba147-3620-4c56-b9dc-54c55fde7d4d.jpg", board: "BB", freeCancellation: true, lat: 3.155099, lng: 101.710331 },
    { id: 1053940, name: "جراند حياة كوالالمبور", star: 5, district: "KLCC", landmark: "أبراج بتروناس التوأم", landmarkKm: 0.4, perNight: 816, reviewScore: 9.4, reviewCount: 1002, image: "http://hotelcms-contents-live.almosafer.com/2e04b142-23d4-4a84-b2b5-fb438d71256c.jpg", board: "RO", freeCancellation: false, lat: 3.15371, lng: 101.712152 },
    { id: 1053910, name: "جيه دبليو ماريوت كوالالمبور", star: 5, district: "Bukit Bintang", landmark: "أبراج بتروناس التوأم", landmarkKm: 1.1, perNight: 915, reviewScore: 9.2, reviewCount: 75, image: "http://hotelcms-contents-live.almosafer.com/2e4ab760-b4a4-452a-b473-9b2bf8370c60.jpg", board: "RO", freeCancellation: true, lat: 3.147988, lng: 101.71366 },
    { id: 1053874, name: "ذا ريتز-كارلتون، كوالا لمبور", star: 5, district: "Bukit Bintang", landmark: "أبراج بتروناس التوأم", landmarkKm: 1.2, perNight: 981, reviewScore: 8.8, reviewCount: 999, image: "http://hotelcms-contents-live.almosafer.com/85214dc6-a05a-485f-85ec-0fa98e396918.jpg", board: "BB", freeCancellation: true, lat: 3.146887, lng: 101.715445 },
  ],
  langkawi: [
    { id: 3999113, name: "هيلتون بوراو باي لانجكاوي ريزورت", star: 5, district: null, landmark: null, landmarkKm: null, perNight: 1028, reviewScore: 10, reviewCount: 3, image: "http://hotelcms-contents-live.almosafer.com/d2aff0c7-1f72-4102-8b95-154dc1d222a8.jpg", board: "RO", freeCancellation: false, lat: 6.365506, lng: 99.67173 },
    { id: 1041235, name: "برجايا لانجكاوي ريزورت", star: 5, district: null, landmark: null, landmarkKm: null, perNight: 1169, reviewScore: 8.9, reviewCount: 84, image: "http://hotelcms-contents-live.almosafer.com/cdbabfa7-f037-4c05-92ae-de0dba424e6f.jpg", board: "BB", freeCancellation: false, lat: 6.367182, lng: 99.667141 },
    { id: 1058797, name: "بلانجي بيتش ريزورت آند سبا، لانكاوي", star: 5, district: null, landmark: null, landmarkKm: null, perNight: 1245, reviewScore: 9.0, reviewCount: 82, image: "http://hotelcms-contents-live.almosafer.com/ec803ff6-3aec-4dc8-987e-9f3f4eb23041.jpg", board: "RO", freeCancellation: false, lat: 6.299228, lng: 99.720859 },
    { id: 2940199, name: "باركرويال لانكاوي ريزورت", star: 5, district: null, landmark: null, landmarkKm: null, perNight: 1285, reviewScore: 9.3, reviewCount: 52, image: "http://hotelcms-contents-live.almosafer.com/61d89a11-7a60-462a-bd3b-311751ee0e55.jpg", board: "BB", freeCancellation: true, lat: 6.282729, lng: 99.730192 },
    { id: 1041239, name: "ذا دانا لانكاوي", star: 5, district: null, landmark: null, landmarkKm: null, perNight: 1438, reviewScore: 9.6, reviewCount: 999, image: "http://hotelcms-contents-live.almosafer.com/4e209690-4316-4827-a6ed-a883416c28b6.jpg", board: "BB", freeCancellation: true, lat: 6.368153, lng: 99.680927 },
    { id: 1425620, name: "ذا سانت ريجيس لانغكاوي", star: 5, district: "كواه", landmark: null, landmarkKm: null, perNight: 2187, reviewScore: 9.2, reviewCount: 306, image: "http://hotelcms-contents-live.almosafer.com/ca0f8f08-d6c6-45d4-89da-66d66cb6ab41.jpg", board: "BB", freeCancellation: true, lat: 6.296149, lng: 99.862577 },
  ],
  bangkok: [
    { id: 1082680, name: "أماري بانكوك", star: 5, district: "باثوموان", landmark: "القصر الكبير", landmarkKm: 5.3, perNight: 643, reviewScore: 9.1, reviewCount: 134, image: "http://hotelcms-contents-live.almosafer.com/880fc03a-bdd9-4086-be9f-5450e9e78e70.jpg", board: "RO", freeCancellation: true, lat: 13.750846, lng: 100.540076 },
    { id: 1082689, name: "سنتارا جراند آت سنترال وورلد", star: 5, district: "باثوموان", landmark: "القصر الكبير", landmarkKm: 5.1, perNight: 758, reviewScore: 9.2, reviewCount: 108, image: "http://hotelcms-contents-live.almosafer.com/bd0130d3-2911-481d-90d9-ac108cdba9ee.jpg", board: "RO", freeCancellation: false, lat: 13.747658, lng: 100.538613 },
    { id: 1082821, name: "غراند سنتر بوينت راتشادامري", star: 5, district: "راتشابراسونج", landmark: "القصر الكبير", landmarkKm: 5.4, perNight: 874, reviewScore: 9.1, reviewCount: 102, image: "http://hotelcms-contents-live.almosafer.com/452d8f8f-d56d-46aa-8b30-f63aa269c187.jpg", board: "RO", freeCancellation: false, lat: 13.74155, lng: 100.540862 },
    { id: 2644079, name: "كيمبتون ماا لاي بانكوك", star: 5, district: null, landmark: "القصر الكبير", landmarkKm: 5.8, perNight: 1222, reviewScore: 9.8, reviewCount: 44, image: "http://hotelcms-contents-live.almosafer.com/463512e5-0302-4af2-85af-7c78e72c9ac2.jpg", board: "BB", freeCancellation: true, lat: 13.737679, lng: 100.543443 },
    { id: 2914695, name: "تشاتريوم جراند بانكوك", star: 5, district: null, landmark: "القصر الكبير", landmarkKm: 4.7, perNight: 1337, reviewScore: 9.6, reviewCount: 80, image: "http://hotelcms-contents-live.almosafer.com/5636c252-3d4c-46b2-a60f-62a645762f42.jpg", board: "BB", freeCancellation: true, lat: 13.749797, lng: 100.534885 },
  ],
  bali: [
    { id: 2539596, name: "ييلو هوتل كوتا بيتشووك بالي", star: 3, district: "وسط مدينة كوتا", landmark: null, landmarkKm: null, perNight: 186, reviewScore: 8.4, reviewCount: 62, image: "http://hotelcms-contents-live.almosafer.com/d34376f5-80f1-4099-a416-6b1fff6ec871.jpg", board: "RO", freeCancellation: true, lat: -8.716046, lng: 115.170135 },
    { id: 2949231, name: "إينارا ألاس هاروم", star: 5, district: "ميلايا", landmark: null, landmarkKm: null, perNight: 507, reviewScore: 9.4, reviewCount: 19, image: "http://hotelcms-contents-live.almosafer.com/b6d42114-e5a8-4a39-8b9b-02f09a951d7a.jpg", board: "BB", freeCancellation: false, lat: -8.422908, lng: 115.268426 },
    { id: 2949223, name: "ميتلاند فينيا أوبود", star: 5, district: "جيانيار", landmark: null, landmarkKm: null, perNight: 663, reviewScore: 9.0, reviewCount: 13, image: "http://hotelcms-contents-live.almosafer.com/c0096f73-98c4-436a-bd9c-c4f3a405afe5.jpg", board: "BB", freeCancellation: false, lat: -8.473015, lng: 115.263589 },
    { id: 2949195, name: "أيانا سيجارا بالي", star: 5, district: "خليج جيمباران", landmark: null, landmarkKm: null, perNight: 2074, reviewScore: 9.2, reviewCount: 26, image: "http://hotelcms-contents-live.almosafer.com/ae74d8d6-a763-4274-b8aa-dbd870ae819c.jpg", board: "RO", freeCancellation: false, lat: -8.786513, lng: 115.140365 },
  ],
  istanbul: [
    { id: 3154237, name: "موفنبيك هوتل إسطنبول مرمرة سي", star: 5, district: "Zeytinburnu", landmark: null, landmarkKm: null, perNight: 534, reviewScore: 9.4, reviewCount: 132, image: "http://hotelcms-contents-live.almosafer.com/88877246-2e2b-4c25-be7b-4c268ced1895.jpg", board: "RO", freeCancellation: false, lat: 40.986278, lng: 28.907217 },
    { id: 1073108, name: "راديسون بلو هوتل، إسطنبول شيشلي", star: 5, district: null, landmark: "قصر دولمة بهجة", landmarkKm: 2.7, perNight: 642, reviewScore: 8.2, reviewCount: 730, image: "http://hotelcms-contents-live.almosafer.com/54f55a7c-9a8c-4c34-ae3e-3c84327ef244.jpg", board: "RO", freeCancellation: false, lat: 41.061764, lng: 28.98881 },
    { id: 1132413, name: "هيلتون إسطنبول بومونتي", star: 4, district: "Bomonti", landmark: "قصر دولمة بهجة", landmarkKm: 2.7, perNight: 736, reviewScore: 8.9, reviewCount: 1051, image: "http://hotelcms-contents-live.almosafer.com/884157dd-f216-4914-ab89-12c843f90a1a.jpg", board: "RO", freeCancellation: false, lat: 41.05816, lng: 28.979218 },
    { id: 1317959, name: "ويندام جراند ليفنت إسطنبول", star: 5, district: "Levent", landmark: null, landmarkKm: null, perNight: 764, reviewScore: 9.2, reviewCount: 1000, image: "http://hotelcms-contents-live.almosafer.com/52460dbb-3d6d-4f9d-b9b1-94b4044df603.jpg", board: "RO", freeCancellation: true, lat: 41.077364, lng: 29.01235 },
    { id: 1439664, name: "سي في كيه بارك بوسفورس إسطنبول", star: 5, district: "Beyoglu", landmark: "قصر توبكابي", landmarkKm: 2.6, perNight: 1061, reviewScore: 8.8, reviewCount: 997, image: "http://hotelcms-contents-live.almosafer.com/a0e049b1-13be-4142-9555-6e2a41a7d577.jpg", board: "RO", freeCancellation: false, lat: 41.03494, lng: 28.988416 },
  ],
};

/** Map a free-typed Arabic/English city name onto a fixture key. */
export function almosaferDemoCityKey(city: string): string | null {
  const s = city.trim().toLowerCase();
  if (s.includes("لمبور") || s.includes("كوالا") || s.includes("kuala") || s.includes("لامبور")) return "kuala lumpur";
  if (s.includes("لنكاوي") || s.includes("لانغكاوي") || s.includes("لانكاوي") || s.includes("langkawi")) return "langkawi";
  if (s.includes("بانكوك") || s.includes("bangkok")) return "bangkok";
  if (s.includes("بالي") || s.includes("كوتا") || s.includes("أوبود") || s.includes("bali") || s.includes("kuta") || s.includes("ubud")) return "bali";
  if (s.includes("اسطنبول") || s.includes("إسطنبول") || s.includes("استانبول") || s.includes("istanbul")) return "istanbul";
  return null;
}

// ---------- flights (JED <-> KUL, 2 adults, round-trip, captured 2026-07-21) ----------

export type AlmosaferDemoFlightLeg = {
  airlineCode: string;
  airline: string;
  flightCode: string;
  fromCode: string;
  from: string;
  toCode: string;
  to: string;
  departure: string; // local wall-clock ISO "YYYY-MM-DDTHH:mm"
  arrival: string;
  durationMinutes: number;
  stops: number;
  via: string | null;
  cabinBaggage: string;
  checkedBaggage: string | null;
};

export type AlmosaferDemoFlight = {
  id: string;
  totalSar: number; // whole round trip, 2 adults, tax incl
  outbound: AlmosaferDemoFlightLeg;
  inbound: AlmosaferDemoFlightLeg;
};

const leg = (
  airlineCode: string,
  airline: string,
  flightCode: string,
  fromCode: string,
  from: string,
  toCode: string,
  to: string,
  departure: string,
  arrival: string,
  durationMinutes: number,
  stops: number,
  via: string | null,
  checked: string | null,
): AlmosaferDemoFlightLeg => ({
  airlineCode,
  airline,
  flightCode,
  fromCode,
  from,
  toCode,
  to,
  departure,
  arrival,
  durationMinutes,
  stops,
  via,
  cabinBaggage: "7 KG",
  checkedBaggage: checked,
});

export const ALMOSAFER_DEMO_FLIGHTS: AlmosaferDemoFlight[] = [
  {
    id: "EY-via-AUH",
    totalSar: 6354,
    outbound: leg("EY", "طيران الاتحاد", "EY-602", "JED", "جدة", "KUL", "كوالالمبور", "2026-08-01T03:10", "2026-08-02T08:25", 1455, 1, "أبوظبي (AUH)", null),
    inbound: leg("EY", "طيران الاتحاد", "EY-489", "KUL", "كوالالمبور", "JED", "جدة", "2026-08-08T09:50", "2026-08-09T10:30", 1780, 1, "أبوظبي (AUH)", null),
  },
  {
    id: "G9-via-SHJ",
    totalSar: 6878,
    outbound: leg("G9", "العربية للطيران", "G9-150", "JED", "جدة", "KUL", "كوالالمبور", "2026-08-01T23:45", "2026-08-03T02:20", 1295, 1, "الشارقة (SHJ)", null),
    inbound: leg("G9", "العربية للطيران", "G9-801", "KUL", "كوالالمبور", "JED", "جدة", "2026-08-08T10:00", "2026-08-08T15:45", 645, 1, "الشارقة (SHJ)", null),
  },
  {
    id: "MH-direct",
    totalSar: 10030,
    outbound: leg("MH", "الخطوط الجوية الماليزية", "MH-4752", "JED", "جدة", "KUL", "كوالالمبور", "2026-08-01T10:35", "2026-08-02T00:35", 540, 0, null, "30 KG"),
    inbound: leg("MH", "الخطوط الجوية الماليزية", "MH-156", "KUL", "كوالالمبور", "JED", "جدة", "2026-08-08T14:50", "2026-08-08T19:00", 550, 0, null, "30 KG"),
  },
  {
    id: "D7-direct",
    totalSar: 10174,
    outbound: leg("D7", "طيران آسيا أكس", "D7-701", "JED", "جدة", "KUL", "كوالالمبور", "2026-08-01T21:55", "2026-08-02T12:40", 585, 0, null, null),
    inbound: leg("D7", "طيران آسيا أكس", "D7-700", "KUL", "كوالالمبور", "JED", "جدة", "2026-08-08T16:35", "2026-08-08T20:25", 530, 0, null, null),
  },
  {
    id: "SV-direct",
    totalSar: 11126,
    outbound: leg("SV", "السعودية", "SV-840", "JED", "جدة", "KUL", "كوالالمبور", "2026-08-01T10:35", "2026-08-02T00:35", 540, 0, null, "قطعة واحدة"),
    inbound: leg("SV", "السعودية", "SV-835", "KUL", "كوالالمبور", "JED", "جدة", "2026-08-08T17:35", "2026-08-08T21:10", 515, 0, null, "قطعة واحدة"),
  },
];
