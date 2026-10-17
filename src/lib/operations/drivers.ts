/**
 * The drivers' side of a trip: which bookings put a car in front of the
 * travellers, when, and what the driver and the client are told.
 *
 * Every fact lives in operation_bookings.detail under the Arabic keys the pull
 * writes (seed-plan.ts) — no columns of its own, so a driver card is edited the
 * way any booking detail is, and old bookings need no migration.
 *
 * Pure: no React, no Supabase.
 */

import { splitVehicle, TRANSPORT_AIRPORT, vehicleText } from "@/lib/offer/draft-types";
import { BEFORE_DOMESTIC, BEFORE_INTL, LANDS, LATER, MEET_AFTER_LANDING, shift } from "./seed-plan";

/** The detail keys a driver card reads and writes. */
export const DRV = {
  time: "الوقت",
  start: "وقت الانطلاق",
  flight: "الرحلة",
  meet: "نقطة الالتقاء",
  car: "السيارة",
  /** how many of that car — its own key, so a model typed into «السيارة» keeps the count. */
  cars: "عدد السيارات",
  plate: "رقم السيارة",
  driver: "السائق",
  phone: "جوال السائق",
  // operations order 11: what the driver's link and the flight tracker write
  status: "حالة السائق",
  handedAt: "وقت الاستقبال",
  landing: "الهبوط المحدّث",
} as const;

/** The two steps a driver marks on his day's page — the words stored in DRV.status. */
export const DRIVER_STEP = { on_way: "في الطريق", done: "تم الاستقبال" } as const;
export type DriverStep = keyof typeof DRIVER_STEP;

// ---------------- the car and how many ----------------

/** A typed number of cars, or null: a whole number from 1 to 50. */
export function carCount(v: unknown): number | null {
  const s = String(v ?? "").trim();
  const n = /^\d{1,2}$/.test(s) ? Number(s) : 0;
  return n >= 1 && n <= 50 ? n : null;
}

type Detail = Record<string, string> | null | undefined;

/**
 * The model and the count. The count's own key wins; a booking pulled before
 * it existed kept the count inside the car text («فان × 2»), read back here.
 */
export function carOf(detail: Detail): { model: string; count: number } {
  const { car_type, cars } = splitVehicle(detail?.[DRV.car] ?? "");
  return { model: car_type, count: carCount(detail?.[DRV.cars]) ?? cars };
}

/** «فان × 2» — the car as every reader prints it. */
export function carText(detail: Detail): string {
  const { model, count } = carOf(detail);
  return model ? vehicleText({ car_type: model, cars: count }) : count > 1 ? `× ${count}` : "";
}

/** What an edit form starts from: the model alone under «السيارة», the count beside it — nothing when no car is set. */
export function carFields(detail: Detail): Record<string, string> {
  if (!detail?.[DRV.car]?.trim() && !detail?.[DRV.cars]?.trim()) return {};
  const { model, count } = carOf(detail);
  return { [DRV.car]: model, [DRV.cars]: String(count) };
}

/** The step a booking's detail says the driver reached, or null. */
export function driverStep(detail: Record<string, string> | null): DriverStep | null {
  const v = detail?.[DRV.status];
  return v === DRIVER_STEP.done ? "done" : v === DRIVER_STEP.on_way ? "on_way" : null;
}

type BookingLike = { kind: string; title: string; start_date: string | null; detail: Record<string, string> | null };

export type ServiceKind = "reception" | "farewell" | "transfer" | "tour";

/** A drive (reception, drop-off, between cities) or a tour — null for anything no driver works. */
export function driverServiceKind(b: BookingLike): ServiceKind | null {
  if (b.kind === "transport") {
    if (b.title.startsWith(`${TRANSPORT_AIRPORT} ←`)) return "reception";
    if (b.title.endsWith(`← ${TRANSPORT_AIRPORT}`)) return "farewell";
    return "transfer";
  }
  // the pull gives a tour its start time; one added by hand is at least titled so
  if (b.kind === "service" && (DRV.start in (b.detail ?? {}) || b.title.startsWith("جولة"))) return "tour";
  return null;
}

/** Where this kind keeps its meeting time — a tour «sets off», a drive «meets». */
export const timeKey = (kind: ServiceKind): string => (kind === "tour" ? DRV.start : DRV.time);

/** The meeting time, or "" while it still reads «يُحدَّد لاحقاً». */
export function meetTime(b: BookingLike): string {
  const d = b.detail ?? {};
  const t = (d[DRV.time] || d[DRV.start] || "").trim();
  return t === LATER ? "" : t;
}

// ---------------- the flight a drive meets ----------------

export type Leg = { flight_no: string; from: string; to: string; departure: string | null; arrival: string | null };

const at = (s: string | undefined): string | null => {
  const m = s?.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : null;
};

/** «SV834 · RUH → KUL · 2026-11-20 01:00 · الوصول 2026-11-20 14:30» — one leg line of a flight booking. */
export function parseLeg(text: string): Leg | null {
  const [no, route, when, ...rest] = text.split("·").map((s) => s.trim());
  const r = route?.match(/^(\S+)\s*→\s*(\S+)$/);
  if (!no || !r) return null;
  return {
    flight_no: no === "—" ? "" : no,
    from: r[1],
    to: r[2],
    departure: at(when),
    arrival: at(rest.find((p) => p.startsWith(LANDS))),
  };
}

/** Every leg of a flight booking, keyed by its line («الذهاب», «رحلة 2») — or the older one-leg form. */
export function flightLegs(detail: Record<string, string>): { key: string; leg: Leg }[] {
  const legs = Object.entries(detail).flatMap(([key, text]) => {
    const leg = parseLeg(text);
    return leg ? [{ key, leg }] : [];
  });
  if (legs.length > 0 || !(detail["رقم الرحلة"] || detail["الإقلاع"])) return legs;
  return [
    {
      key: "رقم الرحلة",
      leg: {
        flight_no: detail["رقم الرحلة"] ?? "",
        from: detail["من"] ?? "",
        to: detail["إلى"] ?? "",
        departure: at(detail["الإقلاع"]),
        arrival: at(detail["الوصول"]),
      },
    },
  ];
}

/** «SV834 RUH → KUL» — how a transfer names the flight it meets. */
export function linkOf(text: string | undefined): { flight_no: string; from: string; to: string } | null {
  const m = text?.trim().match(/^(\S+)\s+(\S+)\s*→\s*(\S+)$/);
  return m ? { flight_no: m[1] === "—" ? "" : m[1], from: m[2], to: m[3] } : null;
}

export type Retime = { id: string; start_date: string | null; detail: Record<string, string> };

const minutes = (a: string, b: string) => (Date.parse(`${a}:00Z`) - Date.parse(`${b}:00Z`)) / 60_000;

/**
 * After a flight booking is edited: the receptions and drop-offs tied to its
 * legs, re-timed — met 45 min after the landing, picked up 2 h (domestic) or
 * 3 h (international) before take-off. Only a leg whose line actually changed
 * moves anything, so a time ops set by hand survives an edit to the cabin class.
 * A line written before landings were recorded moves its reception by however
 * much the take-off moved.
 */
export function retimeTransfers(
  flight: { title: string; detail: Record<string, string> },
  previous: Record<string, string> | null,
  transfers: (BookingLike & { id: string })[],
): Retime[] {
  const domestic = flight.title.startsWith("طيران داخلي");
  const all = flightLegs(flight.detail);
  const legs = all.filter(({ key }) => previous?.[key] !== flight.detail[key]);
  const dep = (l: Leg) => l.departure ?? "";
  const out: Retime[] = [];
  for (const t of transfers) {
    const kind = driverServiceKind(t);
    if (kind !== "reception" && kind !== "farewell") continue;
    const link = linkOf(t.detail?.[DRV.flight]);
    if (!link) continue;
    // by number first; a renumbered flight (the airline swapped it) is still found by its route
    // and a ticket that connects where the plan flew direct (RUH → DOH → IST for «RUH → IST») by the leg
    // landing at (or leaving) the drive's airport — only when the journey's other end is on the ticket too,
    // so a domestic return into the same airport never takes the international arrival's reception
    const hit =
      legs.find(({ leg }) => link.flight_no && leg.flight_no === link.flight_no) ??
      legs.find(({ leg }) => leg.from === link.from && leg.to === link.to) ??
      (kind === "reception"
        ? legs.find(({ leg }) => leg.to === link.to && all.some((o) => o.leg.from === link.from && dep(o.leg) <= dep(leg)))
        : legs.find(({ leg }) => leg.from === link.from && all.some((o) => o.leg.to === link.to && dep(o.leg) >= dep(leg))));
    if (!hit) continue;
    const { key, leg } = hit;

    let next: { date: string; time: string } | null = null;
    if (kind === "farewell") {
      if (leg.departure) next = shift(leg.departure, -(domestic ? BEFORE_DOMESTIC : BEFORE_INTL));
    } else if (leg.arrival) {
      next = shift(leg.arrival, MEET_AFTER_LANDING);
    } else {
      const before = previous?.[key] ? parseLeg(previous[key]) : null;
      const time = meetTime(t);
      if (before?.departure && leg.departure && t.start_date && time) {
        const moved = minutes(leg.departure, before.departure);
        if (moved) next = shift(`${t.start_date}T${time}`, moved);
      }
    }

    const detail = { ...(t.detail ?? {}) };
    if (next) detail[DRV.time] = next.time;
    detail[DRV.flight] = `${leg.flight_no || "—"} ${leg.from} → ${leg.to}`;
    const date = next?.date ?? t.start_date;
    if (date !== t.start_date || detail[DRV.time] !== t.detail?.[DRV.time] || detail[DRV.flight] !== t.detail?.[DRV.flight]) {
      out.push({ id: t.id, start_date: date, detail });
    }
  }
  return out;
}

// ---------------- what the client sees ----------------

export type ClientService = {
  kind: ServiceKind;
  title: string;
  date: string | null;
  time: string;
  meet: string;
  car: string;
  flight: string;
  program: string;
  /** only on the day of the service — never earlier. */
  driver: { name: string; phone: string; plate: string } | null;
  /** what the driver marked on his link: on his way, or the guests are with him. */
  progress: DriverStep | null;
};

/**
 * A drive or a tour as the traveller's page shows it. The driver's name, phone
 * and plate appear ON the service day (the company's — Riyadh — date) and not a
 * day before: drivers get swapped up to the last evening, and a stale number in
 * the client's hands is worse than none.
 */
export function clientService(b: BookingLike, today: string): ClientService | null {
  const kind = driverServiceKind(b);
  if (!kind) return null;
  const d = b.detail ?? {};
  const named = Boolean(d[DRV.driver] || d[DRV.phone]);
  return {
    kind,
    title: b.title,
    date: b.start_date,
    time: meetTime(b),
    meet: d[DRV.meet] ?? "",
    car: carText(d),
    flight: d[DRV.flight] ?? "",
    program: d["البرنامج"] ?? "",
    driver: b.start_date === today && named ? { name: d[DRV.driver] ?? "", phone: d[DRV.phone] ?? "", plate: d[DRV.plate] ?? "" } : null,
    progress: driverStep(d),
  };
}

// ---------------- what the driver is sent ----------------

export type DriverBrief = {
  kind: ServiceKind;
  serial: string;
  title: string;
  date: string | null;
  time: string;
  flight: string;
  meet: string;
  hotel: { name: string; name_en: string | null; address: string | null; city: string } | null;
  guests: string[];
  pax: string;
  car: string;
  plate: string;
  contact: string;
};

const KIND_LINE: Record<ServiceKind, string> = {
  reception: "استقبال من المطار / Airport pick-up",
  farewell: "توصيل إلى المطار / Airport drop-off",
  transfer: "انتقال / Transfer",
  tour: "جولة / Tour",
};

export function mapsLink(...parts: (string | null | undefined)[]): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.filter(Boolean).join(", "))}`;
}

/** A phone as wa.me wants it: digits with the country code — a Saudi «05…» gains its 966. */
export function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^00/, "");
  return /^05\d{8}$/.test(d) ? `966${d.slice(1)}` : d;
}

/** The card as one WhatsApp message. Bilingual labels: the driver abroad may not read Arabic. */
export function driverMessage(b: DriverBrief): string {
  const h = b.hotel;
  return [
    `${KIND_LINE[b.kind]} — ${b.serial}`,
    b.kind === "tour" || b.kind === "transfer" ? b.title : null,
    `التاريخ / Date: ${b.date ?? "—"}`,
    `الوقت / Time: ${b.time || "—"}`,
    b.flight ? `الرحلة / Flight: ${b.flight}` : null,
    b.meet ? `نقطة الالتقاء / Meeting point: ${b.meet}` : null,
    h ? `الفندق / Hotel: ${[h.name, h.name_en].filter(Boolean).join(" — ")}` : null,
    h ? `الموقع / Map: ${mapsLink(h.address || h.name_en || h.name, h.city)}` : null,
    `الضيوف / Guests (${b.pax || b.guests.length}): ${b.guests.join("، ") || "—"}`,
    b.car || b.plate ? `السيارة / Car: ${[b.car, b.plate].filter(Boolean).join(" · ")}` : null,
    b.contact ? `للتواصل / Contact: ${b.contact}` : null,
  ]
    .filter((l): l is string => Boolean(l))
    .join("\n");
}
