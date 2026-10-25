import { deriveCityDates, type DraftData } from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { splitNights } from "@/lib/murad/auto-offer";
import { normAr } from "@/lib/catalog/norm";

/**
 * «تنفيذ طلب العميل على الملف» (the owner, 2026-10-24, order 2 phase ب) — the
 * pure half: a structured edit plan (what the model read from the client's
 * words) applied to a COPY of the draft. Only safe, reversible operations:
 * drop or keep cities, change days / party / rooms / arrival. No price is ever
 * invented — a locked total is cleared and flagged for the employee to review,
 * a missing room price is flagged, the day-by-day programme is never rewritten.
 */

export type ClientEditPlan = {
  /** cities the client wants removed, by name as said */
  remove_cities: string[];
  /** when the client wants ONLY these cities, by name as said (wins over remove_cities) */
  keep_only_cities: string[];
  set_days: number | null;
  set_adults: number | null;
  set_rooms: number | null;
  /** YYYY-MM-DD, only when the client named a new arrival */
  set_arrival: string | null;
  /** what the client asked, in one Arabic line */
  summary: string;
  /** anything asked that these operations cannot do — stays the employee's */
  beyond: string;
};

export const CLIENT_EDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["remove_cities", "keep_only_cities", "set_days", "set_adults", "set_rooms", "set_arrival", "summary", "beyond"],
  properties: {
    remove_cities: { type: "array", items: { type: "string" } },
    keep_only_cities: { type: "array", items: { type: "string" } },
    set_days: { type: ["integer", "null"] },
    set_adults: { type: ["integer", "null"] },
    set_rooms: { type: ["integer", "null"] },
    set_arrival: { type: ["string", "null"] },
    summary: { type: "string" },
    beyond: { type: "string" },
  },
} as const;

const cityKey = (name: string) => normAr(name).replace(/^ال/, "");

export type AppliedEdit = { data: DraftData; flags: string[]; changed: boolean };

export function applyClientEdit(original: DraftData, plan: ClientEditPlan): AppliedEdit {
  const flags: string[] = [];
  let data: DraftData = JSON.parse(JSON.stringify(original)) as DraftData;
  data.produced_serial = null;
  let changed = false;

  // --- cities: keep-only wins, else remove; never down to zero ---
  const keepOnly = new Set(plan.keep_only_cities.map(cityKey).filter(Boolean));
  const remove = new Set(plan.remove_cities.map(cityKey).filter(Boolean));
  if (keepOnly.size || remove.size) {
    const kept = data.cities.filter((c) => (keepOnly.size ? keepOnly.has(cityKey(c.city_name)) : !remove.has(cityKey(c.city_name))));
    if (!kept.length) {
      flags.push("طلب العميل يُسقط كل المدن — لم أغيّر المدن، راجعها بنفسك.");
    } else if (kept.length !== data.cities.length) {
      const keptKeys = new Set(kept.map((c) => c.key));
      data = {
        ...data,
        cities: kept,
        hotels: data.hotels.filter((h) => keptKeys.has(h.city_key)),
      };
      changed = true;
    } else if (keepOnly.size || remove.size) {
      flags.push("لم أجد في الملف مدينة بالأسماء المذكورة — المدن كما هي.");
    }
  }

  // --- days / nights: a stated length re-splits the KEPT route's proportions ---
  if (plan.set_days && plan.set_days > 1 && plan.set_days <= 60) {
    const nights = plan.set_days - 1;
    const split = splitNights(data.cities.map((c) => ({ city: c.city_name, nights: Math.max(c.nights, 1), hotel: "" })), nights);
    data = { ...data, cities: data.cities.slice(0, split.length).map((c, k) => ({ ...c, nights: split[k].nights })) };
    data.trip = { ...data.trip, days: plan.set_days, nights };
    changed = true;
  } else if (changed) {
    // cities went: the trip is as long as what remains
    const nights = data.cities.reduce((n, c) => n + Math.max(c.nights, 0), 0);
    data.trip = { ...data.trip, nights, days: nights + 1 };
  }

  if (plan.set_adults && plan.set_adults > 0 && plan.set_adults <= 50 && plan.set_adults !== data.trip.adults) {
    data.trip = { ...data.trip, adults: plan.set_adults };
    changed = true;
    flags.push("تغيّر عدد الأشخاص — راجع الغرف والأسعار.");
  }
  if (plan.set_rooms && plan.set_rooms > 0 && plan.set_rooms <= 25 && plan.set_rooms !== data.trip.rooms) {
    data.trip = { ...data.trip, rooms: plan.set_rooms };
    changed = true;
    flags.push("تغيّر عدد الغرف — راجع غرف الفنادق وأسعارها.");
  }
  if (plan.set_arrival && /^\d{4}-\d{2}-\d{2}$/.test(plan.set_arrival) && plan.set_arrival !== data.trip.arrival_date) {
    data.trip = { ...data.trip, arrival_date: plan.set_arrival };
    changed = true;
  }

  if (changed) {
    // the stops' dates follow the new arrival and nights; the day-by-day programme is the employee's to review, never rewritten here
    data = { ...data, cities: deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities) };
    if (original.cities.length !== data.cities.length || plan.set_days) flags.push("تغيّر المسار أو المدة — راجع البرنامج اليومي.");
    // a room's typed price covers the WHOLE stay (DraftRoomSpec.price): a stay whose nights moved must be re-priced by the employee
    const beforeNights = new Map(original.cities.map((c) => [c.key, c.nights]));
    for (const c of data.cities) {
      if (beforeNights.has(c.key) && beforeNights.get(c.key) !== c.nights) flags.push(`تغيّرت ليالي ${c.city_name} — سعر الفندق مكتوب لكامل الإقامة، راجعه.`);
    }

    // a total locked by a ready offer no longer matches the new structure: the engine prices from the lines, and the employee reviews
    if (data.pricing.final_total != null) {
      data = { ...data, pricing: { ...data.pricing, final_total: null }, source: null } as DraftData;
      flags.push("كان السعر الإجمالي مقفلاً من عرض جاهز — أُلغي القفل ليُحسب من البنود، راجع السعر.");
    }
    for (const h of data.hotels) {
      if ((h.rooms ?? []).some((r) => r.price == null)) flags.push(`سعر ناقص: ${h.hotel_name || h.city_name}.`);
    }
  }

  return { data, flags: [...new Set(flags)], changed };
}
