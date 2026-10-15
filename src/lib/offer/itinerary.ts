/**
 * Day-by-day itinerary — the pure model behind the «البرنامج اليومي» stage.
 *
 * The days are DERIVED, never hand-numbered: a trip of N nights has N+1 days,
 * each day's date comes from the arrival date, and each day's city comes from
 * the cities chain (the city whose stay covers that date). Only the TEXT is
 * authored — by the agent or the AI generator — and rebuilding the skeleton
 * preserves it, so changing the trip length never destroys written days.
 *
 * Pure module: no React, no Supabase, no network. Safe to import anywhere.
 */

import {
  deriveCityDates,
  FREE_DAY_TITLE,
  hopMode,
  hopVehicle,
  isFreeDay,
  tourVehicle,
  vehicleText,
  type DraftCity,
  type DraftData,
  type DraftDay,
  type DraftFlight,
  type DraftTrip,
  type TourPick,
  type TransportMode,
  type TransportPlan,
} from "./draft-types";
import { itineraryStartDate, localDatePart } from "./schedule";
import { advancedDayLines } from "./advanced";

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * How many days the program covers. Nights + 1 (arrival day … departure day);
 * falls back to the explicit `days` field for trips entered without nights.
 */
export function dayCount(trip: Pick<DraftTrip, "nights" | "days">): number {
  const nights = Number.isFinite(trip.nights) ? trip.nights : 0;
  if (nights > 0) return nights + 1;
  const days = Number.isFinite(trip.days) ? trip.days : 0;
  return Math.max(days, 0);
}

/**
 * The city a given date belongs to: the one whose stay covers it. The departure
 * date equals the last check-out, which no stay covers — it belongs to the last
 * city (you wake up there and fly home).
 */
export function cityForDate(date: string | null, cities: DraftCity[]): string {
  if (!date || cities.length === 0) return "";
  for (const city of cities) {
    if (city.check_in && city.check_out && date >= city.check_in && date < city.check_out) {
      return city.city_name;
    }
  }
  // the night between two cities spent travelling (arrives_next_day): the day still starts in the one it leaves
  const leaving = cities.find((c) => c.check_out === date);
  if (leaving) return leaving.city_name;
  const last = cities[cities.length - 1];
  if (last?.check_out && date >= last.check_out) return last.city_name;
  return cities[0]?.city_name ?? "";
}

/**
 * Rebuild the day list from the trip + cities, carrying over the authored text
 * of any day that still exists. Returns a NEW array; inputs untouched.
 *
 * Matching is by day_number — shortening a trip drops the tail days (and their
 * text); lengthening it appends empty ones. Dates and cities are ALWAYS
 * recomputed, so they can never drift from the trip.
 */
export function buildDaySkeleton(
  trip: Pick<DraftTrip, "nights" | "days" | "arrival_date">,
  cities: DraftCity[],
  existing: DraftDay[] = [],
  /** used when the cities chain names no city — in practice the destination. */
  fallbackCity = "",
  /**
   * Days spent getting there before the first night — an overnight flight that
   * leaves on the 15th and lands on the 16th puts one travel day first. The
   * programme starts when the plane leaves; the hotels when it lands.
   */
  travelDays = 0,
): DraftDay[] {
  const stay = dayCount(trip);
  if (stay <= 0) return [];
  const travel = Math.max(travelDays, 0);
  const total = stay + travel;
  const dated = deriveCityDates(trip.arrival_date, cities);
  const start = trip.arrival_date ? addDays(trip.arrival_date, -travel) : null;
  // Text follows its PLACE in the trip, never its date: moving the whole trip
  // a day keeps every day's text (only a reading for a date that changed is
  // dropped). Travel days and stay days are counted apart, so adding a travel
  // day in front does not slide the arrival day's text onto the flight.
  // A stay day's place is its day_number less the travel days before it.
  const priorTravel = new Map<number, DraftDay>();
  const priorStay = new Map<number, DraftDay>();
  for (const d of existing) {
    if (d.kind === "travel") {
      priorTravel.set(d.day_number - 1, d);
    } else {
      const before = existing.filter((x) => x.kind === "travel" && x.day_number < d.day_number).length;
      priorStay.set(d.day_number - 1 - before, d);
    }
  }

  return Array.from({ length: total }, (_, i) => {
    const day_number = i + 1;
    const date = start ? addDays(start, i) : null;
    const prior = i < travel ? priorTravel.get(i) : priorStay.get(i - travel);
    if (i < travel) {
      // A travel day is in no city yet, and says so in its title.
      return {
        day_number,
        date,
        city_name: "",
        title: prior?.title || ("السفر إلى " + (fallbackCity.trim() || "الوجهة")),
        activities: prior?.activities ?? [],
        weather: null,
        ai_generated: prior?.ai_generated ?? false,
        kind: "travel" as const,
      };
    }
    return {
      day_number,
      date,
      // Agents don't always name the cities (some put the city in the hotel
      // field), so fall back to the destination rather than leaving the day
      // placeless — the weather lookup and the printed document both need it.
      city_name: cityForDate(date, dated) || fallbackCity.trim(),
      title: prior?.title ?? "",
      activities: prior?.activities ?? [],
      // A cached reading is only valid for the date it was fetched for; if the
      // trip moved, drop it rather than print last month's weather.
      weather: prior && prior.date === date ? (prior.weather ?? null) : null,
      ai_generated: prior?.ai_generated ?? false,
      // whose the text is travels with it — dropped here, a day the screen wrote
      // was read as the agent's on the next pass, and a changed tour never reached it
      ...(prior?.auto_title !== undefined ? { auto_title: prior.auto_title } : {}),
    };
  });
}

/**
 * The skeleton for a whole draft. Uses the SAME start date as the rest of the
 * system (the outbound flight's arrival when there is one, else the trip's
 * arrival date) so day 1 can never disagree with the hotels or the cities.
 */
export function draftDaySkeleton(data: DraftData): DraftDay[] {
  const arrival = itineraryStartDate(data.trip, data.flights);
  return buildDaySkeleton(
    { ...data.trip, arrival_date: arrival },
    data.cities,
    data.days,
    data.trip.destination || data.trip.country,
    travelDaysBefore(arrival, data.flights),
  );
}

/**
 * How many days the group spends getting there before its first night: from
 * the outbound flight's LOCAL departure date to the first check-in. 0 without
 * a flight, or when it lands the same day.
 */
export function travelDaysBefore(arrival: string | null, flights: DraftFlight[]): number {
  const first = flights
    .filter((f) => f.leg_order === "outbound")
    .sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""))[0];
  const leaves = localDatePart(first?.departure_at);
  if (!leaves || !arrival || leaves >= arrival) return 0;
  return Math.round((Date.parse(arrival + "T00:00:00Z") - Date.parse(leaves + "T00:00:00Z")) / 86_400_000);
}

/** True when the draft's days no longer match what its trip, flights and cities describe. */
export function draftDaysNeedRebuild(data: DraftData): boolean {
  const fresh = draftDaySkeleton(data);
  if (fresh.length !== data.days.length) return true;
  return fresh.some(
    (d, i) => d.date !== data.days[i].date || d.city_name !== data.days[i].city_name || d.kind !== data.days[i].kind,
  );
}

/** True when the skeleton is out of sync with the trip/cities (dates or cities moved). */
export function daysNeedRebuild(
  trip: Pick<DraftTrip, "nights" | "days" | "arrival_date">,
  cities: DraftCity[],
  days: DraftDay[],
  fallbackCity = "",
): boolean {
  const fresh = buildDaySkeleton(trip, cities, days, fallbackCity);
  if (fresh.length !== days.length) return true;
  return fresh.some((d, i) => d.date !== days[i].date || d.city_name !== days[i].city_name);
}

/** Days that carry no authored content — what the AI generator should fill. */
export function emptyDays(days: DraftDay[]): DraftDay[] {
  return days.filter((d) => !d.title.trim() && d.activities.every((a) => !a.trim()));
}

/** True once every day has a title — the itinerary reads as complete. */
export function itineraryComplete(days: DraftDay[]): boolean {
  return days.length > 0 && days.every((d) => d.title.trim().length > 0);
}

/** The distinct cities the itinerary visits, in order — the AI prompt's context. */
export function itineraryCities(days: DraftDay[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of days) {
    const name = day.city_name.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * The transport line for one day of the programme.
 *
 * «المواصلات» stopped being a stage and became three answers about vehicles —
 * which is how an agent thinks about it, but not how a CLIENT reads a
 * programme. A client reads day by day, so the answer has to arrive on the day
 * it applies to: the van at the airport on day one, the sedan on tour days, the
 * train to the next city on the day the city changes.
 *
 * Returns null for a day with nothing to say, so callers can render it or not
 * without a second condition.
 */
export function transportNoteForDay(
  plan: TransportPlan,
  days: DraftDay[],
  index: number,
  /** the draft's flights — a domestic hop that lands this day is how the group moves. */
  flights: DraftFlight[] = [],
): string | null {
  const day = days[index];
  if (!day || day.kind === "travel") return null;

  // the arrival day is the first day the group is THERE, not the day it flies out
  const arrivalIndex = days.findIndex((d) => d.kind !== "travel");
  const first = index === arrivalIndex;
  const last = index === days.length - 1;
  const cityChanged = index > arrivalIndex && days[index - 1]?.city_name !== day.city_name;
  const hop = cityChanged
    ? flights.find(
        (f) => f.leg_order === "internal" && localDatePart(f.arrival_at) === day.date && f.to_city?.trim() === day.city_name,
      )
    : undefined;
  // the evening the group flies on and lands after midnight: it leaves from here today
  const overnight = !cityChanged && !last ? overnightLeg(flights, day) : undefined;

  const parts: string[] = [];

  if (plan.airport.enabled && (first || last)) {
    const label = first ? "استقبال من المطار إلى الفندق" : "توديع من الفندق إلى المطار";
    const car = vehicleText(first ? plan.airport : (plan.farewell ?? plan.airport));
    parts.push(car ? `${label} — ${car}` : label);
  }

  // A day the group changes city is a travel day, not a touring day; saying
  // both would put two vehicles on one line and invite the question.
  if (hop) {
    parts.push(`الانتقال إلى ${day.city_name} — طيران داخلي${legNote(hop)}`);
  } else if (overnight) {
    parts.push(`التوجه إلى المطار للسفر إلى ${overnight.to_city?.trim() ?? ""} — طيران داخلي${legNote(overnight)}`);
  } else if (plan.intercity.enabled && cityChanged) {
    const how = hopVehicle(plan, hopMode(plan, days[index - 1]?.city_name ?? "", day.city_name));
    parts.push(`الانتقال إلى ${day.city_name} — ${how}`);
  } else if (plan.tours.enabled && !first && !last && !isFreeDay(day) && !day.activities.some((a) => a.startsWith(TOUR_CAR_LINE))) {
    // a day whose tour already says its car («التنقل بـفان × 2») does not repeat the trip's
    const label = "سيارة الجولات";
    const car = vehicleText(plan.tours);
    parts.push(car ? `${label} — ${car}` : label);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A clock on a leg, or "" — midnight is how a leg with no time yet is stored. */
const clock = (iso: string | null | undefined) => {
  const t = (iso ?? "").slice(11, 16);
  return t && t !== "00:00" ? t : "";
};

/** The domestic leg that leaves from the day's city that evening and lands on a later day. */
function overnightLeg(flights: DraftFlight[], day: DraftDay): DraftFlight | undefined {
  return flights.find(
    (f) =>
      f.leg_order === "internal" &&
      f.from_city?.trim() === day.city_name &&
      localDatePart(f.departure_at) === day.date &&
      (localDatePart(f.arrival_at) ?? "") > (day.date ?? ""),
  );
}

/** « (MH1432، الإقلاع 22:30، الوصول 01:10 +1)» — what is known of the leg, or "". */
function legNote(f: DraftFlight): string {
  const leaves = localDatePart(f.departure_at);
  const lands = localDatePart(f.arrival_at);
  const next = Boolean(leaves && lands && lands > leaves);
  const parts = [
    f.flight_no.trim(),
    clock(f.departure_at) && `الإقلاع ${clock(f.departure_at)}`,
    clock(f.arrival_at) && `الوصول ${clock(f.arrival_at)}${next ? " +1" : ""}`,
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join("، ")})` : "";
}

/** A ready-made day from the old system (tour_programs, 0052) — text only. */
export type TourProgram = {
  id: string;
  city_name: string;
  title: string;
  description: string;
  is_free_day: boolean;
  sort_order: number | null;
};

/** «الجولة الأولى» says nothing on its own in a document; «الجولة الأولى في لنكاوي» does. */
export function programDayText(program: TourProgram): Pick<DraftDay, "title" | "activities"> {
  const generic = /^الجول[ةه] /.test(program.title) && !program.title.includes(program.city_name);
  return {
    title: generic ? `${program.title} في ${program.city_name}` : program.title,
    activities: program.description.trim() ? [program.description.trim()] : [],
  };
}

/**
 * A day a tour can go on: not the arrival day, not the day home, and not a day
 * the group changes city — those are travel days.
 */
export function isTouringDay(days: DraftDay[], index: number): boolean {
  if (index <= 0 || index >= days.length - 1 || days[index].kind === "travel") return false;
  // the day after a travel day is the arrival day: the day before it is in no city
  return days[index - 1]?.city_name === days[index]?.city_name;
}

/**
 * «تعبئة الأيام من البرامج الجاهزة» — each city's tours, in the old system's
 * order, onto that city's EMPTY touring days.
 *
 * Never writes over a day that has a title or an activity: the agent's text,
 * or the AI's, is theirs. A tour already used on another day is not repeated.
 * Free-day templates are not tours and are never picked here.
 */
export function fillDaysFromPrograms(days: DraftDay[], programs: TourProgram[]): { days: DraftDay[]; filled: number } {
  const used = new Set(days.map((d) => d.title.trim()).filter(Boolean));
  const queue = new Map<string, TourProgram[]>();
  for (const p of [...programs].sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9))) {
    if (p.is_free_day) continue;
    queue.set(p.city_name, [...(queue.get(p.city_name) ?? []), p]);
  }
  let filled = 0;
  const next = days.map((day, index) => {
    if (day.title.trim() || day.activities.some((a) => a.trim()) || !isTouringDay(days, index)) return day;
    const list = queue.get(day.city_name) ?? [];
    while (list.length > 0) {
      const program = list.shift()!;
      const text = programDayText(program);
      if (used.has(text.title)) continue;
      used.add(text.title);
      filled += 1;
      return { ...day, ...text, ai_generated: false };
    }
    return day;
  });
  return { days: next, filled };
}

// ---------- the day and its tour: one model for the basic screen and the generator ----------

/** How a tour day says its car and how many — «التنقل بـفان × 2». The client document prints it on a line of its own. */
export const TOUR_CAR_LINE = "التنقل بـ";

/** The first thing that happens on arrival — the company's own welcome, on every file. */
export const WELCOME = "الاستقبال من المطار من قبل موظف ترافليون والتوجه إلى الفندق";
/** The day home, as the company says it. */
export const FAREWELL = "تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة";

/** The arrival day's lines: this file's own (arrival_lines), else «بكج متقدم»'s, else the welcome. */
export function arrivalLines(data: Pick<DraftData, "arrival_lines" | "advanced">): string[] {
  return typed(data.arrival_lines) ?? [advancedDayLines(data.advanced).arrive ?? WELCOME];
}

/** The day home's lines: this file's own (departure_lines), else «بكج متقدم»'s, else the farewell. */
export function departureLines(data: Pick<DraftData, "departure_lines" | "advanced">): string[] {
  return typed(data.departure_lines) ?? [advancedDayLines(data.advanced).leave ?? FAREWELL];
}

/** The lines typed, without a blank one just added on the screen; none left is «the default». */
function typed(lines: string[] | undefined): string[] | null {
  const kept = lines?.map((l) => l.trim()).filter(Boolean);
  return kept && kept.length > 0 ? kept : null;
}

/** The day titles the basic screen wrote before days carried `auto_title` — its to rewrite. */
const AUTO_TITLE = /^(الوصول إلى |الانتقال إلى |جولة سياحية في |السفر إلى |المغادرة$|العودة إلى )/;
const isAutoTitle = (title: string) => !title.trim() || title === FREE_DAY_TITLE || AUTO_TITLE.test(title);

/**
 * How the group reaches a city it moves to, as the day's activities say it —
 * with the flight's number and clocks once they are known. After a night spent
 * flying (`overnight`) the day starts at the airport it lands at.
 */
function moveLines(mode: TransportMode, city: string, leg: DraftFlight | undefined, overnight = false): string[] {
  if (mode === "flight") {
    const no = leg?.flight_no.trim() ?? "";
    const leaves = clock(leg?.departure_at);
    const lands = clock(leg?.arrival_at);
    if (overnight) {
      return [`الوصول إلى ${leg?.to_airport.trim() || `مطار ${city}`}${lands ? ` الساعة ${lands}` : ""}`, "الاستقبال من قبل موظف ترافليون والتوجه إلى الفندق"];
    }
    return [
      "تسجيل الخروج من الفندق والتوجه إلى المطار",
      `السفر إلى ${city} على الطيران الداخلي${no ? ` (${no})` : ""}${leaves ? ` — الإقلاع ${leaves}` : ""}${lands ? ` والوصول ${lands}` : ""}`,
      `الاستقبال من مطار ${city} والتوجه إلى الفندق`,
    ];
  }
  const how = mode === "train" ? "بالقطار" : mode === "ship" ? "بالعبّارة" : "براً";
  return ["تسجيل الخروج من الفندق", `الانتقال ${how} إلى ${city} والتوجه إلى الفندق`];
}

/** The evening the group leaves a city on a flight that lands after midnight (the next city arrives_next_day). */
function leaveLines(city: string, leg: DraftFlight | undefined): string[] {
  const no = leg?.flight_no.trim() ?? "";
  const leaves = clock(leg?.departure_at);
  const from = leg?.from_airport.trim() ?? "";
  return [
    "تسجيل الخروج من الفندق",
    `التوجه إلى المطار والسفر إلى ${city} على الطيران الداخلي${no ? ` (${no})` : ""}${leaves ? ` — الإقلاع الساعة ${leaves}` : ""}${from ? ` من ${from}` : ""}`,
  ];
}

/** The domestic leg into `city` on `date`: landing that day, else leaving it, else any into the city. */
function legInto(flights: DraftFlight[], city: string, date: string | null): DraftFlight | undefined {
  const into = flights.filter((f) => f.leg_order === "internal" && f.to_city?.trim() === city);
  return into.find((f) => localDatePart(f.arrival_at) === date) ?? into.find((f) => localDatePart(f.departure_at) === date) ?? into[0];
}

/**
 * Resize a city's tour picks to its tour count, keeping what was chosen. A new
 * pick goes in `cars` cars when given (the trip's tour cars); without it, one.
 */
export function withTourCount(picks: TourPick[] | undefined, count: number, cars?: number): TourPick[] {
  const list = (picks ?? []).slice(0, count);
  while (list.length < count) list.push({ program_id: null, title: "", text: "", price: null, ...(cars ? { cars } : {}) });
  return list;
}

/**
 * The days a city's tours go on, in the order they are handed out: the days
 * after the group arrives first (the arrival day is spent arriving), then the
 * arrival day itself — only once those are taken does a day get a second tour.
 */
export function tourDays(city: Pick<DraftCity, "check_in" | "nights">): string[] {
  const all = cityDates(city);
  return [...all.slice(1), ...all.slice(0, 1)];
}

/** Every date the group sleeps in the city — the days a tour may be put on. */
export function cityDates(city: Pick<DraftCity, "check_in" | "nights">): string[] {
  if (!city.check_in) return [];
  return Array.from({ length: Math.max(city.nights, 1) }, (_, k) => addDays(city.check_in!, k));
}

/** The day the group leaves the city — for the last city, the day it flies home («جولة قبل المغادرة»). */
export function departureDay(city: Pick<DraftCity, "check_in" | "nights">): string | null {
  return city.check_in ? addDays(city.check_in, Math.max(city.nights, 1)) : null;
}

/**
 * Every tour gets its day written down — the first of `days` no tour has yet;
 * once they are all taken, the days are shared in turn. A tour that already
 * has a day keeps it.
 */
export function fillTourDates(picks: TourPick[], days: string[]): TourPick[] {
  if (days.length === 0) return picks;
  const used = new Set(picks.map((p) => p.date).filter(Boolean));
  let turn = 0;
  return picks.map((p) => {
    if (p.date) return p;
    const date = days.find((d) => !used.has(d)) ?? days[turn++ % days.length];
    used.add(date);
    return { ...p, date };
  });
}

/**
 * The city's tours at a count, each with its day, in date order. A day the city
 * no longer has (its dates moved) is let go and the tour takes the next free one.
 *
 * On the trip's last city (`last`) a tour the agent put on the day home
 * («جولة قبل المغادرة», `departure`) stays on that day, wherever it moves; on
 * any other city it is a tour like the rest. Only the mark puts a tour there:
 * the free days handed out never include the day home, so no file's tours move.
 */
export function withTours(city: Pick<DraftCity, "check_in" | "nights" | "tour_picks">, count: number, cars?: number, last = false): TourPick[] {
  const own = cityDates(city);
  const leaving = departureDay(city);
  const kept = withTourCount(city.tour_picks, count, cars).map((p) =>
    p.departure
      ? last
        ? { ...p, date: leaving ?? p.date ?? null }
        : { ...p, departure: undefined, date: null }
      : p.date && own.length > 0 && !own.includes(p.date)
        ? { ...p, date: null }
        : p,
  );
  return fillTourDates(kept, tourDays(city)).sort(byDate);
}

const byDate = (a: TourPick, b: TourPick) => (a.date ?? "9999").localeCompare(b.date ?? "9999");

/**
 * The programme, written from the cities, how the group moves between them and
 * each city's tours — the one rule the basic screen and the generator share:
 * the arrival with the company's welcome, the day of each move (a domestic
 * flight reads «to the airport — the flight — met at the next airport»), each
 * tour on its day with the car it goes in («التنقل بـفان × 2»), free days, and
 * the way home.
 *
 * A day is the screen's while its title is still the one written here
 * (`auto_title`); the first hand edit makes it the agent's, and it is never
 * rewritten again. A day keeps its weather, and the AI's wording of the same
 * tour. A day without the mark is the agent's: the generator's typed and empty
 * days are left as they are — only the basic screen (`legacyTitles`) reads a
 * file from before the mark by its titles.
 */
export function daysFromTours(data: DraftData, legacyTitles = false): DraftDay[] {
  const days = draftDaySkeleton(data);
  const cities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
  const plan = data.transport_plan;
  const stay = days.map((d, i) => (d.kind === "travel" ? -1 : i)).filter((i) => i >= 0);
  const firstStay = stay[0] ?? -1;
  const lastDay = days.length - 1;

  // the evenings the group flies on overnight (the next city arrives_next_day): date → that city
  const flyOn = new Map<string, string>();
  cities.forEach((c, k) => {
    const out = cities[k - 1]?.check_out;
    if (k > 0 && c.arrives_next_day && out) flyOn.set(out, c.city_name);
  });

  // 1. which city each day is in, and what kind of day it is
  type Kind = "travel" | "arrive" | "move" | "leave" | "last" | "stay";
  const cityOf: number[] = [];
  const kindOf: Kind[] = [];
  let at = -1;
  days.forEach((day, i) => {
    if (day.kind === "travel") {
      cityOf.push(-1);
      kindOf.push("travel");
      return;
    }
    const moved = i === firstStay || days[i - 1]?.city_name !== day.city_name;
    if (moved && i !== lastDay) at += 1;
    cityOf.push(at);
    kindOf.push(i === lastDay ? "last" : i === firstStay ? "arrive" : moved ? "move" : day.date && flyOn.has(day.date) ? "leave" : "stay");
  });

  // 2. each city's tours: a tour with a date goes on that day; the rest take the
  // city's free days in turn. A client may want more tours than the city has
  // days — they share a day rather than being refused — and a city with no free
  // day at all takes them on the day the group arrives.
  const toursOn = plan.tours.enabled;
  const toursOf = new Map<number, TourPick[]>();
  const put = (day: number, pick: TourPick) => toursOf.set(day, [...(toursOf.get(day) ?? []), pick]);
  cities.forEach((city, c) => {
    const count = toursOn ? (city.tours ?? 0) : 0;
    if (count === 0) return;
    const cityDays = days.map((_, i) => i).filter((i) => cityOf[i] === c);
    const free = cityDays.filter((i) => kindOf[i] === "stay");
    const undated: TourPick[] = [];
    // the same days the city card shows — the last city's may hold the day home
    for (const pick of withTours(city, count, undefined, c === cities.length - 1)) {
      const named = { ...pick, title: pick.free ? FREE_DAY_TITLE : pick.title.trim() || `جولة سياحية في ${city.city_name}` };
      const day = pick.date ? cityDays.find((i) => days[i].date === pick.date) : undefined;
      if (day !== undefined) put(day, named);
      else undated.push(named);
    }
    const open = free.filter((i) => !toursOf.has(i));
    const slots = open.length > 0 ? open : free.length > 0 ? free : cityDays.slice(0, 1);
    undated.forEach((pick, k) => {
      if (slots.length > 0) put(slots[k % slots.length], pick);
    });
  });

  const tripCar = plan.tours.car_type.trim();

  // 3. the days
  return days.map((day, i) => {
    if (day.kind === "travel") return day;
    const kind = kindOf[i];
    let title: string;
    let activities: string[] = [];
    if (kind === "last") {
      title = "المغادرة";
      activities = departureLines(data);
    } else if (kind === "arrive") {
      title = `الوصول إلى ${day.city_name}`;
      activities = arrivalLines(data);
    } else if (kind === "leave") {
      const to = flyOn.get(day.date ?? "") ?? "";
      const leg = data.flights.find(
        (f) => f.leg_order === "internal" && f.to_city?.trim() === to && localDatePart(f.departure_at) === day.date,
      );
      title = `السفر إلى ${to}`;
      activities = leaveLines(to, leg);
    } else if (kind === "move") {
      const from = days[i - 1]?.city_name ?? "";
      const mode = hopMode(plan, from, day.city_name);
      const overnight = Boolean(cities[cityOf[i]]?.arrives_next_day);
      title = mode === "flight" ? (overnight ? `الوصول إلى ${day.city_name}` : `السفر إلى ${day.city_name}`) : `الانتقال إلى ${day.city_name}`;
      activities = moveLines(mode, day.city_name, legInto(data.flights, day.city_name, day.date), overnight);
    } else title = FREE_DAY_TITLE;

    // «يوم حر» picked on purpose keeps the day free; it is not a tour
    const picked = toursOf.get(i) ?? [];
    const tours = picked.filter((t) => !t.free);
    if (tours.length === 0 && kind === "stay") {
      // a free day says what its programme says about it, if anything
      activities = picked.flatMap((t) => (t.text.trim() ? [t.text.trim()] : [])).slice(0, 1);
    } else if (tours.length > 0) {
      const line = (t: TourPick) => (t.text.trim() ? `${t.title}: ${t.text.trim()}` : t.title);
      // the car each tour goes in, and how many — said once
      const cars = [...new Set(tours.map((t) => tourVehicle(t, tripCar)).filter(Boolean))];
      const car = cars.length > 0 ? [`${TOUR_CAR_LINE}${cars.join(" و")}`] : [];
      if (kind === "stay") {
        // the day is named after its first tour; any more the client asked for follow it
        title = tours[0].title;
        activities = [...(tours[0].text.trim() ? [tours[0].text.trim()] : []), ...tours.slice(1).map(line), ...car];
      } else if (kind === "last") {
        // «جولة قبل المغادرة»: the tour and its car, then the way to the airport
        activities = [...tours.map(line), ...car, ...activities];
      } else activities = [...activities, ...tours.map(line), ...car];
    }

    // an empty day holding a tour is the tour's: the programme opens already written from it
    const empty = !day.title.trim() && day.activities.every((a) => !a.trim());
    const owned =
      day.auto_title !== undefined ? day.title === day.auto_title : (legacyTitles && isAutoTitle(day.title)) || (empty && tours.length > 0);
    if (!owned) return day;
    // the AI's wording of the same day stays; another day's text does not
    if (day.ai_generated && day.title === title) return { ...day, auto_title: title };
    return { ...day, title, activities, auto_title: title, ai_generated: false };
  });
}

/**
 * The generator's «اختر جولة جاهزة»: the programme becomes the day's tour — a
 * pick of its city, on that day, in the trip's tour cars, priced from the lists
 * — and the day is written from it. No programme takes the day's tour away and
 * leaves the day empty again.
 *
 * Null when no tour can go on the day (a travel day — see dayTours)
 * or the sale has no tours: such a day only takes the programme's text.
 */
export function withDayTour(data: DraftData, index: number, program: TourProgram | null): Pick<DraftData, "cities" | "days"> | null {
  const on = dayTours(data, index);
  if (!on) return null;
  const { at, date } = on;
  const day = data.days[index];

  const others = on.all.filter((p) => p.date !== date);
  const text = program?.description.trim() ?? "";
  const pick: TourPick | null = !program
    ? null
    : program.is_free_day
      ? { program_id: program.id, title: FREE_DAY_TITLE, text, price: null, date, free: true }
      : { program_id: program.id, title: programDayText(program).title, text, price: null, date, cars: data.transport_plan.tours.cars, ...(on.departure ? { departure: true } : {}) };
  const picks = pick ? [...others, pick].sort(byDate) : others;
  const cities = data.cities.map((c, i) => (i === at ? { ...c, tours: picks.length, tour_picks: picks } : c));

  // the agent chose this day's tour: the day is the screen's to write — or, with none, theirs again, empty
  const cleared: DraftDay = { ...day, title: "", activities: [], ai_generated: false, auto_title: pick ? "" : undefined };
  return { cities, days: daysFromTours({ ...data, cities, days: data.days.map((d, i) => (i === index ? cleared : d)) }) };
}

/**
 * The city stop a programme day sleeps in, and the tours on it (that stop's
 * picks dated on the day). The day home belongs to the last city
 * (`departure` — «جولة قبل المغادرة»). Null for a day no tour can go on: a
 * travel day, or a sale without tours.
 */
export function dayTours(
  data: DraftData,
  index: number,
): { at: number; date: string; all: TourPick[]; picks: TourPick[]; departure: boolean } | null {
  const day = data.days[index];
  if (!day?.date || day.kind === "travel" || !data.transport_plan.tours.enabled) return null;
  const date = day.date;
  const dated = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
  const lastAt = dated.length - 1;
  const departure = index === data.days.length - 1 && lastAt >= 0 && dated[lastAt].city_name === day.city_name && departureDay(dated[lastAt]) === date;
  const at = departure ? lastAt : dated.findIndex((c) => c.city_name === day.city_name && cityDates(c).includes(date));
  if (at < 0) return null;
  const all = withTours(dated[at], dated[at].tours ?? 0, undefined, at === lastAt);
  return { at, date, all, picks: all.filter((p) => p.date === date), departure };
}

/**
 * One tour of a programme day changed in place — the generator's open day:
 * its service, car, count, price or wording. The day's k-th tour takes the
 * slice (a day with none gets one, in the trip's tour cars), so swapping a tour
 * never adds a second; null takes it away. A new service writes the day from it
 * again (as «اختر جولة»); a car, a count or a price reaches the day only while
 * the day is the screen's. Null when no tour can go on the day.
 */
export function withDayPick(data: DraftData, index: number, k: number, slice: Partial<TourPick> | null): Pick<DraftData, "cities" | "days"> | null {
  const on = dayTours(data, index);
  if (!on) return null;
  const { at, date, all } = on;
  const old = on.picks[k];
  if (!old && !slice) return null;
  const picks = !slice
    ? all.filter((p) => p !== old)
    : old
      ? all.map((p) => (p === old ? { ...p, ...slice, date } : p))
      : [...all, { program_id: null, title: "", text: "", price: null, cars: data.transport_plan.tours.cars, ...slice, date, ...(on.departure ? { departure: true } : {}) }].sort(byDate);
  const cities = data.cities.map((c, i) => (i === at ? { ...c, tours: picks.length, tour_picks: picks } : c));
  const service = !slice || "title" in slice || "program_id" in slice || "free" in slice;
  if (!service) return { cities, days: daysFromTours({ ...data, cities }) };
  const left = picks.some((p) => p.date === date);
  const cleared = (d: DraftDay): DraftDay => ({ ...d, title: "", activities: [], ai_generated: false, auto_title: left ? "" : undefined });
  return { cities, days: daysFromTours({ ...data, cities, days: data.days.map((d, i) => (i === index ? cleared(d) : d)) }) };
}

/**
 * What a typed or chosen service is: «يوم حر», one of the city's ready
 * programmes (its wording comes with it), or a tour of the agent's own.
 */
export function tourService(title: string, programs: TourProgram[]): Pick<TourPick, "program_id" | "title" | "text" | "free"> {
  if (title.trim() === FREE_DAY_TITLE) return { program_id: null, title: FREE_DAY_TITLE, text: "", free: true };
  const hit = programs.find((p) => !p.is_free_day && programDayText(p).title === title);
  return hit
    ? { program_id: hit.id, title, text: hit.description.trim(), free: false }
    : { program_id: null, title, text: "", free: false };
}

/**
 * «تعبئة أيام المدينة من البرامج الجاهزة» (and, without a city, every city's):
 * the rule of fillDaysFromPrograms — each city's programmes in order onto its
 * empty touring days, none twice — but each one a real tour of its day, in the
 * trip's tour cars and priced from the lists, so it reaches the pricing sheet
 * and the basic screen like one chosen by hand. A sale without tours takes the
 * text. A day already holding a tour keeps it.
 */
export function fillCityTours(data: DraftData, programs: TourProgram[], city?: string): Pick<DraftData, "cities" | "days"> & { filled: number } {
  const own = city === undefined ? programs : programs.filter((p) => p.city_name === city);
  const text = fillDaysFromPrograms(data.days, own);
  let next: Pick<DraftData, "cities" | "days"> = { cities: data.cities, days: data.days };
  let filled = 0;
  text.days.forEach((d, i) => {
    if (d === data.days[i]) return;
    const live = { ...data, ...next };
    if (dayTours(live, i)?.picks.some((p) => p.free || p.title.trim())) return;
    const program = own.find((p) => p.city_name === d.city_name && programDayText(p).title === d.title);
    const service = program ? { program_id: program.id, title: d.title, text: program.description.trim(), free: false } : null;
    next = (service && withDayPick(live, i, 0, service)) || { ...next, days: next.days.map((x, j) => (j === i ? d : x)) };
    filled += 1;
  });
  return { ...next, filled };
}

/**
 * The AI's wording of one day. It writes activities only: a day holding a tour
 * keeps the title the tour gives it and its car line, and the tour, its price
 * and its car are never its to change — they live on the city's picks, which
 * this never touches. A day without a tour takes the AI's title too.
 */
export function withAiText(data: DraftData, index: number, text: Pick<DraftDay, "title" | "activities">): DraftDay {
  const day = data.days[index];
  if (!dayTours(data, index)?.picks.some((p) => !p.free)) return { ...day, ...text, ai_generated: true };
  const cleared = data.days.map((d, i) => (i === index ? { ...d, title: "", activities: [], ai_generated: false, auto_title: "" } : d));
  const screen = daysFromTours({ ...data, days: cleared })[index];
  const car = screen.activities.filter((a) => a.startsWith("التنقل بـ"));
  return { ...day, title: screen.title, activities: [...text.activities, ...car], ai_generated: true, auto_title: screen.title };
}
