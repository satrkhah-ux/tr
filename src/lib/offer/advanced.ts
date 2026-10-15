/**
 * «بكج متقدم» — the SAME basic file, plus four short answers for the trips that
 * do not fit «land at the airport, get picked up there, fly home from it»:
 *
 *   1. how the client arrives and leaves, where and when,
 *   2. where and when we meet them, and where we leave them (airport / a hotel / ONE side of a border / they come themselves),
 *   3. what they arrange themselves (never on the bill, said as «غير مشمول»),
 *   4. a border between two cities: one car across, or two cars with a self crossing.
 *
 * Every choice starts UNANSWERED ("") — the agent picks; an unanswered choice
 * leaves Basic exactly as it was and is listed as a gap. The dates fill
 * themselves from Basic (fillAdvanced) and keep following it until the agent
 * types their own.
 *
 * The answers only reword what Basic already derives: the transfer rows, the
 * day lines and the «يشمل / لا يشمل» lines. Nothing is assumed from a country
 * or an airport name. A file without `advanced` (or with it off) is the basic file.
 *
 * Pure: no React, no Supabase.
 */

import { deriveCityDates, hopKey, type DraftData, type DraftTransport } from "./draft-types";
import { itineraryStartDate, toInstant } from "./schedule";
import { offsetFromHome } from "./timezones";

export type ArriveBy = "" | "flight" | "land" | "rail_sea" | "already";
export type PointKind = "" | "airport" | "hotel" | "border" | "self";

export type ServicePoint = {
  kind: PointKind;
  /** hotel / crossing / airport name, as the agent picks it. */
  place: string;
  /** border only: the side we mean — the country that side belongs to. */
  side: string;
  /** the country this point is in — chosen first; it narrows the airports, hotels and crossings offered. For a border it IS the side. */
  country: string;
  /** the day and the driver's meeting time ("HH:MM") — not the landing time. */
  date: string;
  time: string;
};

export type BorderHop = { drivers: 1 | 2; crossing: string; side_from: string; side_to: string };

/** the date fields Basic can fill. */
export type AdvancedDateKey = "arrive_date" | "arrive_time" | "checkin_date" | "reception_date" | "farewell_date" | "leave_date" | "leave_time";

export type DraftAdvanced = {
  on: boolean;
  /** the country the client lands / arrives in — it narrows the airports and stations offered. */
  arrive_country: string;
  arrive_by: ArriveBy;
  /** where the client actually lands / arrives, when it is not where we meet them. */
  arrive_at: string;
  arrive_date: string;
  arrive_time: string;
  /** the first hotel we book — a night before it is not ours. */
  checkin_date: string;
  leave_country: string;
  leave_by: ArriveBy;
  leave_from: string;
  leave_date: string;
  leave_time: string;
  reception: ServicePoint;
  farewell: ServicePoint;
  /** «ليلة في فندق بريزا», «الانتقال إلى الحدود»… */
  self_items: string[];
  /** keyed `${from}>${to}` (city names), only for hops that cross a border. */
  borders: Record<string, BorderHop>;
  /**
   * The pickup is in one country and the first hotel in another (lands in
   * Trabzon, sleeps in Batumi): how the transfer crosses — one car across, or
   * two cars with the group crossing on foot between them. Absent = not asked / not answered.
   */
  reception_cross?: BorderHop;
  /** date fields still following Basic; a field the agent edits leaves this list. */
  auto: AdvancedDateKey[];
  /**
   * Which end of the trip is unusual — the agent picks one or both. The other
   * end stays exactly Basic's (an airport pickup / drop-off), asked nothing.
   */
  parts: { arrival: boolean; departure: boolean };
};

export const ARRIVE_BY_AR: Record<Exclude<ArriveBy, "">, string> = { flight: "طيران", land: "برّاً", rail_sea: "قطار / عبّارة", already: "موجود مسبقاً في البلد" };
export const POINT_AR: Record<Exclude<PointKind, "">, string> = { airport: "المطار", hotel: "فندق", border: "الحدود", self: "يصل بنفسه" };

const point = (): ServicePoint => ({ kind: "", place: "", side: "", country: "", date: "", time: "" });

/** where this point is: its own country, a border's side, else where the client lands / leaves. */
export function pointCountry(p: ServicePoint, fallback: string): string {
  return p.country || (p.kind === "border" ? p.side : "") || fallback;
}

/** an airport point with its own airport picked names it; otherwise it is the airport they fly into / out of. */
function airportPoint(p: ServicePoint, by: ArriveBy, flown: string, fallback: string): string {
  return p.place.trim() ? pointText(p) : airportOf(by, flown, fallback);
}

/** The answers that count: an end the agent did not open is Basic's own, whatever was typed into it before. */
export function activeAdvanced(adv: DraftAdvanced): DraftAdvanced {
  const blank = point();
  let out = adv;
  if (!adv.parts.arrival)
    out = { ...out, arrive_country: "", arrive_by: "", arrive_at: "", arrive_date: "", arrive_time: "", checkin_date: "", reception: blank, reception_cross: undefined };
  if (!adv.parts.departure) out = { ...out, leave_country: "", leave_by: "", leave_from: "", leave_date: "", leave_time: "", farewell: blank };
  return out;
}

export function emptyAdvanced(): DraftAdvanced {
  return {
    on: false,
    arrive_country: "",
    arrive_by: "",
    arrive_at: "",
    arrive_date: "",
    arrive_time: "",
    checkin_date: "",
    leave_country: "",
    leave_by: "",
    leave_from: "",
    leave_date: "",
    leave_time: "",
    reception: point(),
    farewell: point(),
    self_items: [],
    borders: {},
    auto: [],
    parts: { arrival: false, departure: false },
  };
}

export function normalizeAdvanced(raw: unknown): DraftAdvanced | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<DraftAdvanced>;
  const e = emptyAdvanced();
  return {
    ...e,
    ...r,
    on: r.on === true,
    reception: { ...e.reception, ...(r.reception ?? {}) },
    farewell: { ...e.farewell, ...(r.farewell ?? {}) },
    self_items: Array.isArray(r.self_items) ? r.self_items.filter((x) => typeof x === "string") : [],
    borders: r.borders && typeof r.borders === "object" ? r.borders : {},
    auto: Array.isArray(r.auto) ? r.auto : [],
    // a file answered before the choice existed had both ends open
    parts: r.parts && typeof r.parts === "object" ? { arrival: r.parts.arrival === true, departure: r.parts.departure === true } : { arrival: r.on === true, departure: r.on === true },
  };
}

// ---------- dates that fill themselves ----------

export type AdvancedDefaults = Partial<Record<"arrive_date" | "arrive_time" | "checkin_date" | "leave_date" | "leave_time", string>>;

const getDate = (a: DraftAdvanced, k: AdvancedDateKey): string =>
  k === "reception_date" ? a.reception.date : k === "farewell_date" ? a.farewell.date : a[k];

const putDate = (a: DraftAdvanced, k: AdvancedDateKey, v: string): DraftAdvanced =>
  k === "reception_date"
    ? { ...a, reception: { ...a.reception, date: v } }
    : k === "farewell_date"
      ? { ...a, farewell: { ...a.farewell, date: v } }
      : { ...a, [k]: v };

/**
 * Basic's dates poured into the empty date fields, and kept in step with Basic
 * while they are still Basic's. Reception defaults to the first night we book
 * (the arrival day when there is none), the farewell to the departure day.
 */
export function fillAdvanced(adv: DraftAdvanced, d: AdvancedDefaults): DraftAdvanced {
  const want: Record<AdvancedDateKey, string> = {
    arrive_date: d.arrive_date ?? "",
    arrive_time: d.arrive_time ?? "",
    checkin_date: d.checkin_date ?? "",
    reception_date: d.arrive_date || d.checkin_date || "",
    farewell_date: d.leave_date ?? "",
    leave_date: d.leave_date ?? "",
    leave_time: d.leave_time ?? "",
  };
  let out = adv;
  const auto = new Set(adv.auto);
  // own dates first, then the ones that follow them: we meet the group the day it arrives, leave it the day it leaves
  const order: AdvancedDateKey[] = ["arrive_date", "arrive_time", "checkin_date", "leave_date", "leave_time", "reception_date", "farewell_date"];
  for (const k of order) {
    if (k === "reception_date") want[k] = out.arrive_date || want[k];
    if (k === "farewell_date") want[k] = out.leave_date || want[k];
    const now = getDate(out, k);
    if ((now === "" || auto.has(k)) && want[k] && want[k] !== now) {
      out = putDate(out, k, want[k]);
      auto.add(k);
    }
  }
  return auto.size === adv.auto.length && out === adv ? adv : { ...out, auto: [...auto] };
}

/** Basic's own dates: the landing of the last outbound leg, the first hotel night, the first homeward take-off. */
export function advancedDefaults(data: Pick<DraftData, "trip" | "flights" | "cities">): AdvancedDefaults {
  const out = data.flights.filter((f) => f.leg_order === "outbound").at(-1);
  const home = data.flights.find((f) => f.leg_order === "inbound");
  const firstCity = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities)[0];
  return {
    // a planned leg has only its day: the trip's arrival day, else the day it flies, until the ticket says
    arrive_date: out?.arrival_at?.slice(0, 10) || data.trip.arrival_date || out?.departure_at?.slice(0, 10) || "",
    arrive_time: out?.arrival_at?.slice(11, 16) || "",
    checkin_date: firstCity?.check_in || "",
    leave_date: home?.departure_at?.slice(0, 10) || data.trip.departure_date || "",
    leave_time: home?.departure_at?.slice(11, 16) || "",
  };
}

/** the agent typed this date: it stops following Basic. */
export function setAdvancedDate(adv: DraftAdvanced, k: AdvancedDateKey, v: string): DraftAdvanced {
  return { ...putDate(adv, k, v), auto: adv.auto.filter((x) => x !== k) };
}

// ---------- words ----------

/** «معبر سارب — جانب جورجيا» rather than «الحدود». */
export function pointText(p: ServicePoint, airportName = "المطار"): string {
  if (p.kind === "airport" || p.kind === "") return p.place ? `مطار ${p.place.replace(/^مطار\s+/, "")}` : airportName;
  if (p.kind === "hotel") return p.place ? `فندق ${p.place.replace(/^فندق\s+/, "")}` : "الفندق";
  if (p.kind === "border") return `${p.place || "المعبر الحدودي"}${p.side ? ` — جانب ${p.side}` : ""}`;
  return "";
}

/** «مطار طرابزون» when the client flies into a named place, else Basic's «المطار». */
function airportOf(by: ArriveBy, place: string, fallback: string): string {
  const p = place.trim();
  return by === "flight" && p ? (p.startsWith("مطار") ? p : `مطار ${p}`) : fallback;
}

const when = (date: string, time: string) => [date, time && `الساعة ${time}`].filter(Boolean).join(" ");
const note = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" — ");

export { hopKey };

/**
 * Basic's derived transfer rows, reworded by the answers. Rows the answers do
 * not touch (or an unanswered choice) come back unchanged.
 */
export function withAdvancedTransport(rows: DraftTransport[], adv: DraftAdvanced | undefined, airport = "المطار"): DraftTransport[] {
  if (!adv?.on) return rows;
  adv = activeAdvanced(adv);
  // the arrival pickup is the first row from the airport, the farewell the last row to it
  const first = rows.findIndex((r) => r.from_place === airport);
  const last = rows.map((r) => r.to_place).lastIndexOf(airport);
  const out: DraftTransport[] = [];
  rows.forEach((row, i) => {
    if (i === first && adv.reception.kind) {
      const rx = adv.reception;
      if (rx.kind === "self") return;
      // the city card's own words for this row said «from the airport»: a pickup moved elsewhere drops them
      const words = rx.kind === "airport" ? {} : { text: undefined };
      const met = { ...row, ...words, from_place: rx.kind === "airport" ? airportPoint(rx, adv.arrive_by, adv.arrive_at, airport) : pointText(rx), date: rx.date || row.date, note: note(rx.time && `اللقاء ${rx.time}`, row.note) };
      const cross = adv.reception_cross;
      if (cross?.crossing.trim() && cross.drivers === 2) {
        const side = (c: string) => `${cross.crossing}${c ? ` — جانب ${c}` : ""}`;
        out.push({ ...met, to_place: side(cross.side_from), note: note("السائق الأول", met.note) });
        // the price typed for the reception is the whole service's — on the first car only, never twice
        out.push({ ...met, price: undefined, from_place: side(cross.side_to), note: note("السائق الثاني بعد عبور الحدود", row.note) });
      } else if (cross?.crossing.trim()) out.push({ ...met, note: note(met.note, `عبر ${cross.crossing} — تحقق من سماح السيارة والسائق بالعبور`) });
      else out.push(met);
      return;
    }
    if (i === last && adv.farewell.kind) {
      const fw = adv.farewell;
      if (fw.kind !== "self")
        out.push({ ...row, ...(fw.kind === "airport" ? {} : { text: undefined }), to_place: fw.kind === "airport" ? airportPoint(fw, adv.leave_by, adv.leave_from, airport) : pointText(fw), date: fw.date || row.date, note: note(fw.time && `الانطلاق ${fw.time}`, row.note) });
      return;
    }
    const hop = adv.borders[hopKey(row.from_place, row.to_place)];
    if (hop?.crossing.trim()) {
      const side = (s: string) => `${hop.crossing}${s ? ` — جانب ${s}` : ""}`;
      if (hop.drivers === 2) {
        out.push({ ...row, to_place: side(hop.side_from), note: note("السائق الأول", row.note) });
        out.push({ ...row, price: undefined, from_place: side(hop.side_to), note: note("السائق الثاني بعد عبور الحدود", row.note) });
      } else out.push({ ...row, note: note(`عبر ${hop.crossing} — تحقق من سماح السيارة والسائق بالعبور`, row.note) });
      return;
    }
    out.push(row);
  });
  return out;
}

/** Basic's blanket «يشمل» line — wrong once the group is met or left anywhere but the airport. */
export const AIRPORT_TRANSFER_LINE = "الإستقبال والتوديع من المطار إلى الفندق والعكس";

export function meetsElsewhere(adv: DraftAdvanced | undefined): boolean {
  const off = (k: PointKind) => k !== "" && k !== "airport";
  if (!adv?.on) return false;
  const a = activeAdvanced(adv);
  return off(a.reception.kind) || off(a.farewell.kind);
}

/** The words the client reads: where and when our service starts and ends, and what is theirs. */
export function advancedLines(adv: DraftAdvanced | undefined): { includes: string[]; excludes: string[] } {
  if (!adv?.on) return { includes: [], excludes: [] };
  adv = activeAdvanced(adv);
  const includes: string[] = [];
  const excludes: string[] = [];
  const arrive = adv.arrive_at.trim();
  const leave = adv.leave_from.trim();
  const { reception: rx, farewell: fw } = adv;
  const by = (b: ArriveBy) => (b ? ` (${ARRIVE_BY_AR[b]})` : "");
  const at = (p: ServicePoint) => (p.date ? ` — ${when(p.date, p.time)}` : p.time ? ` الساعة ${p.time}` : "");

  if (adv.arrive_by === "already") excludes.push("وصولكم إلى البلد — ترتيب ذاتي، غير مشمول");
  else if (arrive && rx.kind && rx.kind !== "airport")
    excludes.push(`وصولكم إلى ${arrive}${by(adv.arrive_by)}${when(adv.arrive_date, adv.arrive_time) ? ` ${when(adv.arrive_date, adv.arrive_time)}` : ""} وفق ترتيبكم — غير مشمول`);
  if (rx.kind === "self") excludes.push("الوصول إلى الفندق الأول — ترتيب ذاتي، غير مشمول");
  else if (rx.kind === "airport") {
    if (arrive && adv.arrive_by === "flight") includes.push(`تبدأ خدماتنا باستقبالكم من ${airportOf("flight", arrive, "المطار")}${at(rx)}`);
  } else if (rx.kind) {
    if (arrive && adv.arrive_by !== "already") excludes.push(`الانتقال من ${arrive} إلى ${pointText(rx)} — ترتيب ذاتي، غير مشمول`);
    includes.push(`تبدأ خدماتنا باستقبالكم من ${pointText(rx)}${at(rx)}`);
  }
  const cross = adv.reception_cross;
  if (rx.kind && rx.kind !== "self" && cross?.drivers && cross.crossing.trim())
    includes.push(`نقلكم من نقطة الاستقبال عبر ${cross.crossing.trim()} إلى فندقكم${cross.drivers === 2 ? " — بسيارتين، تعبرون الحدود بينهما بأنفسكم" : ""}`);
  if (fw.kind === "self") excludes.push("التوجه إلى نقطة المغادرة — ترتيب ذاتي، غير مشمول");
  else if (fw.kind === "airport") {
    if (leave && adv.leave_by === "flight") includes.push(`تنتهي خدماتنا بتوصيلكم إلى ${airportOf("flight", leave, "المطار")}${at(fw)}`);
  } else if (fw.kind) includes.push(`تنتهي خدماتنا بتوصيلكم إلى ${pointText(fw)}${at(fw)}`);
  if (leave && fw.kind && fw.kind !== "airport") excludes.push(`مغادرتكم من ${leave}${by(adv.leave_by)} — غير مشمولة`);
  for (const hop of [...Object.values(adv.borders), ...(adv.reception_cross ? [adv.reception_cross] : [])]) if (hop.crossing.trim() && hop.drivers === 2) excludes.push(`عبور ${hop.crossing} بين السائقين — يعبره المسافرون بأنفسهم`);
  for (const item of adv.self_items) if (item.trim()) excludes.push(`${item.trim()} — يرتّبه العميل بنفسه، غير مشمول`);
  return { includes, excludes };
}

/**
 * The airports table also holds train stations, bus stations and ports (the
 * old system's «12go» stops). Their names say which they are.
 */
export function isStation(name: string): boolean {
  return /محط[ةه]|قطار|ميناء|مرفأ|حافلات|باص|station|port|pier|ferry|12go/i.test(name);
}
const looksAirport = (name: string) => /مطار|airport/i.test(name) && !isStation(name);

/** the place does not fit the way the client travels: a station picked for a flight, an airport for a train. */
function wrongPlace(by: ArriveBy, place: string): string | null {
  const p = place.trim();
  if (!p) return null;
  if (by === "flight" && isStation(p)) return `«${p}» محطة وليست مطاراً — غيّر الوسيلة إلى «${ARRIVE_BY_AR.rail_sea}» أو اختر مطاراً`;
  if (by === "rail_sea" && looksAirport(p)) return `«${p}» مطار — غيّر الوسيلة إلى «${ARRIVE_BY_AR.flight}» أو اختر محطة / ميناء`;
  return null;
}

/** an international departure: at the airport three hours before take-off. */
export const AIRPORT_LEAD_MINUTES = 180;
const minsText = (m: number) => {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
};

export type StepKey = "arrive" | "reception" | "checkin" | "farewell" | "leave";
export type AdvancedStep = {
  key: StepKey;
  title: string;
  /** the step told as one sentence, from the answers. */
  sentence: string;
  /** contradictions — the trip cannot happen this way. */
  errors: string[];
  /** not answered yet, or worth a second look. */
  missing: string[];
};

/** an IANA zone for a country name, or null when the catalogue has none. */
export type TzOf = (country: string) => string | null;

/**
 * Every clock on the card is LOCAL to its own place — as tickets print them.
 * Two clocks are compared as real instants once their zones are known; a 22:40
 * landing in Kuala Lumpur and a 22:00 pickup on the Thai side are 20 minutes apart,
 * not 40 the wrong way. Without a zone, the wall clocks are compared as written.
 */
/** a before b — by the clock when both have one, else by the day alone (an unknown time is not midnight). */
function earlier(aDate: string, aTime: string, aTz: string | null, bDate: string, bTime: string, bTz: string | null): boolean {
  if (!aTime || !bTime) return aDate < bDate;
  return instantOf(aDate, aTime, aTz) < instantOf(bDate, bTime, bTz);
}

function instantOf(date: string, time: string, tz: string | null): number {
  const local = `${date}T${time || "00:00"}`;
  return toInstant(local, tz)?.getTime() ?? Date.parse(`${local}:00Z`);
}

/** «بتوقيت ماليزيا، +5 س عن السعودية» — said whenever a time is shown in a zone that is not home. */
function zoneNote(country: string, tz: string | null, date: string): string {
  if (!country || !tz) return "";
  const diff = offsetFromHome(tz, date || null);
  if (diff === null || diff === 0) return ` بتوقيت ${country}`;
  const h = Math.abs(diff);
  return ` بتوقيت ${country} (${diff > 0 ? "+" : "−"}${Number.isInteger(h) ? h : h.toFixed(1)} س عن السعودية)`;
}
const day = (date: string, time = "", zone = "") => (date ? `يوم ${date}${time ? ` الساعة ${time}${zone}` : ""}` : "— التاريخ غير محدد");
const hasSelf = (adv: DraftAdvanced) => adv.self_items.some((x) => x.trim());

/**
 * The trip in its own order — arrive, met, first night, left, leave — each step
 * a sentence the agent can read back, with what contradicts and what is missing
 * right under it. Nothing is corrected: the agent decides.
 */
export function advancedSteps(adv: DraftAdvanced, tzOf: TzOf = () => null, firstCountry = "", firstStay = ""): AdvancedStep[] {
  const parts = adv.parts;
  adv = activeAdvanced(adv);
  const rx = adv.reception;
  const fw = adv.farewell;
  // where each clock is read: a border side is its own country; the rest is where they land / leave
  const rxCountry = pointCountry(rx, adv.arrive_country);
  const fwCountry = pointCountry(fw, adv.leave_country);
  const tzA = tzOf(adv.arrive_country);
  const tzR = tzOf(rxCountry);
  const tzF = tzOf(fwCountry);
  const tzL = tzOf(adv.leave_country);
  const step = (key: StepKey, title: string): AdvancedStep => ({ key, title, sentence: "", errors: [], missing: [] });

  const arrive = step("arrive", "الوصول");
  const arriveWhere = adv.arrive_at.trim() || adv.arrive_country || "؟";
  arrive.sentence =
    adv.arrive_by === "already"
      ? `العميل موجود مسبقاً في ${adv.arrive_country || "البلد"}`
      : `يصل العميل إلى ${arriveWhere}${adv.arrive_country && adv.arrive_at.trim() ? ` (${adv.arrive_country})` : ""}${adv.arrive_by ? ` — ${ARRIVE_BY_AR[adv.arrive_by]}` : ""} ${day(adv.arrive_date, adv.arrive_time, zoneNote(adv.arrive_country, tzA, adv.arrive_date))}`;
  if (!adv.arrive_country) arrive.missing.push("اختر دولة الوصول");
  if (!adv.arrive_by) arrive.missing.push("اختر وسيلة الوصول");
  else if (adv.arrive_by !== "already" && !adv.arrive_at.trim()) arrive.missing.push("اختر مكان الوصول");
  const wa = wrongPlace(adv.arrive_by, adv.arrive_at);
  if (wa) arrive.errors.push(wa);
  if (adv.arrive_by && adv.arrive_by !== "already" && !adv.arrive_date) arrive.missing.push("تاريخ الوصول غير محدد");

  const reception = step("reception", "الاستقبال");
  if (!rx.kind) {
    reception.sentence = "لم يُحدد من أين نستقبله";
    reception.missing.push("اختر نقطة الاستقبال");
  } else if (rx.kind === "self") reception.sentence = "لا استقبال — يصل إلى الفندق بنفسه";
  else {
    const where = `${rx.kind === "airport" ? airportPoint(rx, adv.arrive_by, adv.arrive_at, "المطار") : pointText(rx)}${rx.country && rx.kind !== "border" ? ` (${rx.country})` : ""}`;
    reception.sentence = `نستقبله من ${where} ${day(rx.date, rx.time, zoneNote(rxCountry, tzR, rx.date))}`;
    // picked up in one country, first night in another: the transfer crosses a border — say how
    const pickupCountry = rxCountry;
    if (rx.kind !== "border" && pickupCountry && firstCountry && pickupCountry !== firstCountry) {
      const cross = adv.reception_cross;
      if (!cross?.drivers) reception.missing.push(`نقطة الاستقبال في ${pickupCountry} وأول فندق في ${firstCountry} — اختر كيف يعبر الحدود`);
      else {
        reception.sentence += ` ثم ننقله إلى ${firstCountry} عبر ${cross.crossing.trim() || "المعبر"} — ${cross.drivers === 2 ? "سائقان، ويعبر الحدود بنفسه بينهما" : "سائق واحد يعبر الحدود"}`;
        if (!cross.crossing.trim()) reception.missing.push("اكتب اسم المعبر");
      }
    }
    if (rx.kind !== "airport" && !rx.place.trim()) reception.missing.push(`اختر ${rx.kind === "hotel" ? "الفندق" : "المعبر"}`);
    if (!rx.country) reception.missing.push("اختر دولة الاستقبال");
    if (rx.kind === "border" && !rx.side) reception.missing.push("حدد أي جانب من الحدود");
    if (!rx.date) reception.missing.push("يوم الاستقبال غير محدد");
    if (rx.kind !== "airport" && !rx.time) reception.missing.push("موعد اللقاء ينتظر التأكيد");
    if (rx.kind === "airport" && adv.arrive_by && adv.arrive_by !== "flight") reception.errors.push(`العميل يصل ${ARRIVE_BY_AR[adv.arrive_by]} — لا يوجد مطار نستقبله منه`);
    if (rx.date && adv.arrive_date && adv.arrive_by !== "already" && earlier(rx.date, rx.time, tzR, adv.arrive_date, adv.arrive_time, tzA))
      reception.errors.push(`الاستقبال (${rx.date}${rx.time ? ` ${rx.time}` : ""}) قبل وصول العميل (${adv.arrive_date}${adv.arrive_time ? ` ${adv.arrive_time}` : ""})`);
    // met in another country than the one they land in: how do they get there?
    if (rx.kind === "border" && rx.side && adv.arrive_country && rx.side !== adv.arrive_country && !hasSelf(adv))
      reception.missing.push(`يصل إلى ${adv.arrive_country} ونستقبله في جانب ${rx.side} — كيف ينتقل بينهما؟ أضفه في «ما يرتّبه بنفسه»`);
    if ((rx.kind === "hotel" || rx.kind === "border") && adv.arrive_by && adv.arrive_by !== "already" && !adv.arrive_at.trim())
      reception.missing.push("من أين يأتي إلى نقطة الاستقبال؟ اختر مكان وصوله");
  }

  const checkin = step("checkin", "أول ليلة نحجزها");
  checkin.sentence = `${firstStay ? `أول فندق في البيسك: ${firstStay}` : "الدخول لأول فندق"} ${adv.checkin_date ? day(adv.checkin_date) : "— تاريخ الدخول غير محدد"}`;
  if (adv.checkin_date && adv.arrive_date && adv.arrive_by !== "already") {
    if (adv.checkin_date < adv.arrive_date) checkin.errors.push(`الدخول للفندق (${adv.checkin_date}) قبل وصول العميل (${adv.arrive_date}) — ليلة محجوزة بلا نزيل`);
    else if (adv.checkin_date > adv.arrive_date && !hasSelf(adv))
      checkin.missing.push(`ليلة ${adv.arrive_date} لا يوجد لها فندق — أين يبيت؟ أضفها في «ما يرتّبه بنفسه» أو احجزها`);
    else if (adv.checkin_date === adv.arrive_date && adv.arrive_time && adv.arrive_time < "06:00")
      checkin.missing.push(`الوصول ${adv.arrive_time} بعد منتصف الليل والدخول ${adv.checkin_date} — هل يلزم حجز الليلة السابقة؟`);
  }
  if (adv.checkin_date && rx.date && rx.kind && rx.kind !== "self" && adv.checkin_date < rx.date) checkin.errors.push(`الدخول للفندق (${adv.checkin_date}) قبل استقباله (${rx.date})`);

  const farewell = step("farewell", "التوديع");
  if (!fw.kind) {
    farewell.sentence = "لم يُحدد أين نودّعه";
    farewell.missing.push("اختر نقطة التوديع");
  } else if (fw.kind === "self") farewell.sentence = "لا توديع — يغادر بنفسه";
  else {
    const where = `${fw.kind === "airport" ? airportPoint(fw, adv.leave_by, adv.leave_from, "المطار") : pointText(fw)}${fw.country && fw.kind !== "border" ? ` (${fw.country})` : ""}`;
    farewell.sentence = `نوصله إلى ${where} ${day(fw.date, fw.time, zoneNote(fwCountry, tzF, fw.date))}`;
    if (fw.kind !== "airport" && !fw.place.trim()) farewell.missing.push(`اختر ${fw.kind === "hotel" ? "الفندق" : "المعبر"}`);
    if (!fw.country) farewell.missing.push("اختر دولة التوديع");
    if (fw.kind === "border" && !fw.side) farewell.missing.push("حدد أي جانب من الحدود");
    if (!fw.date) farewell.missing.push("يوم التوديع غير محدد");
    if (fw.kind === "airport" && adv.leave_by && adv.leave_by !== "flight") farewell.errors.push(`العميل يغادر ${ARRIVE_BY_AR[adv.leave_by]} — لا يوجد مطار نوصله إليه`);
    if (fw.kind === "airport" && fw.time && adv.leave_time && fw.date && fw.date === adv.leave_date) {
      const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      if (mins(adv.leave_time) - mins(fw.time) < AIRPORT_LEAD_MINUTES)
        farewell.errors.push(`الانطلاق إلى المطار ${fw.time} والإقلاع ${adv.leave_time} — يجب أن ينطلق قبل الإقلاع بثلاث ساعات على الأقل (${minsText(mins(adv.leave_time) - AIRPORT_LEAD_MINUTES)} أو قبل)`);
    }
    if (fw.date && adv.leave_date && fw.date > adv.leave_date) farewell.errors.push(`التوديع (${fw.date}) بعد مغادرة العميل (${adv.leave_date})`);
    if (fw.date && rx.date && rx.kind && rx.kind !== "self" && fw.date < rx.date) farewell.errors.push(`التوديع (${fw.date}) قبل الاستقبال (${rx.date})`);
  }

  const leave = step("leave", "المغادرة");
  const leaveWhere = adv.leave_from.trim() || adv.leave_country || "؟";
  leave.sentence =
    adv.leave_by === "already"
      ? `يبقى العميل في ${adv.leave_country || "البلد"} بعد البرنامج`
      : `يغادر من ${leaveWhere}${adv.leave_country && adv.leave_from.trim() ? ` (${adv.leave_country})` : ""}${adv.leave_by ? ` — ${ARRIVE_BY_AR[adv.leave_by]}` : ""} ${day(adv.leave_date, adv.leave_time, zoneNote(adv.leave_country, tzL, adv.leave_date))}`;
  if (!adv.leave_country) leave.missing.push("اختر دولة المغادرة");
  if (!adv.leave_by) leave.missing.push("اختر وسيلة المغادرة");
  else if (adv.leave_by !== "already" && !adv.leave_from.trim()) leave.missing.push("اختر مكان المغادرة");
  const wl = wrongPlace(adv.leave_by, adv.leave_from);
  if (wl) leave.errors.push(wl);
  if (adv.leave_date && adv.arrive_date && earlier(adv.leave_date, adv.leave_time, tzL, adv.arrive_date, adv.arrive_time, tzA))
    leave.errors.push(`المغادرة (${adv.leave_date}) قبل الوصول (${adv.arrive_date})`);

  return [...(parts.arrival ? [arrive, reception, checkin] : []), ...(parts.departure ? [farewell, leave] : [])];
}

/** Everything still open or contradictory, in the trip's order — the steps' and the border hops'. */
export function advancedGaps(adv: DraftAdvanced | undefined, tzOf?: TzOf, firstCountry?: string, firstStay?: string): string[] {
  if (!adv?.on) return [];
  if (!adv.parts.arrival && !adv.parts.departure) return ["اختر ما المختلف في هذه الرحلة: الوصول، أو المغادرة، أو كلاهما"];
  const out = advancedSteps(adv, tzOf, firstCountry, firstStay).flatMap((s) => [...s.errors, ...s.missing]);
  for (const [key, hop] of Object.entries(adv.borders)) if (!hop.crossing.trim()) out.push(`${key.replace(">", " ← ")}: اكتب اسم المعبر`);
  return out;
}

/**
 * The day card's transport line (itinerary.transportNoteForDay) says «من المطار»;
 * with a reception or farewell elsewhere it says where, or nothing when the
 * client comes by themselves.
 */
export function advancedDayNote(note: string | null, adv: DraftAdvanced | undefined): string | null {
  if (!note || !adv?.on) return note;
  adv = activeAdvanced(adv);
  const swap = (text: string, from: string, p: ServicePoint, line: string) => {
    if (!p.kind || p.kind === "airport" || !text.includes(from)) return text;
    // the note joins its parts with « · »: drop the whole part
    if (p.kind === "self") return text.split(" · ").filter((part) => !part.startsWith(from)).join(" · ");
    return text.replace(from, line);
  };
  const out = swap(
    swap(note, "توديع من الفندق إلى المطار", adv.farewell, `توديع من الفندق إلى ${pointText(adv.farewell)}`),
    "استقبال من المطار إلى الفندق",
    adv.reception,
    `استقبال من ${pointText(adv.reception)} إلى الفندق`,
  );
  return out || null;
}

/** The programme's first / last day lines when we do not meet or leave them at the airport; null = Basic's own words. */
export function advancedDayLines(adv: DraftAdvanced | undefined): { arrive: string | null; leave: string | null } {
  if (!adv?.on) return { arrive: null, leave: null };
  adv = activeAdvanced(adv);
  const rx = adv.reception;
  const fw = adv.farewell;
  return {
    arrive:
      !rx.kind || rx.kind === "airport"
        ? null
        : rx.kind === "self"
          ? "الوصول إلى الفندق بترتيبكم الخاص"
          : `الاستقبال من ${pointText(rx)}${rx.time ? ` الساعة ${rx.time}` : ""} من قبل موظف ترافليون والتوجه إلى الفندق`,
    leave: !fw.kind || fw.kind === "airport" ? null : fw.kind === "self" ? "تسجيل الخروج من الفندق" : `تسجيل الخروج من الفندق والتوجه إلى ${pointText(fw)}`,
  };
}

/**
 * The dates the agent typed HERE, for Basic — so nothing is typed twice. Basic's
 * programme starts with the first night we book (else the landing day) and ends
 * the day the client leaves. Only typed answers travel: a date that came from
 * Basic going back to Basic would be a loop. The package country is offered when
 * Basic has none: where we meet them (else where they land).
 */
export function advancedTripDates(adv: DraftAdvanced): { arrival_date?: string; departure_date?: string; country?: string } {
  const a = activeAdvanced(adv);
  const typed = (k: AdvancedDateKey, v: string) => (v && !adv.auto.includes(k) ? v : undefined);
  return {
    arrival_date: typed("checkin_date", a.checkin_date) ?? typed("arrive_date", a.arrive_date),
    departure_date: typed("leave_date", a.leave_date),
    country: pointCountry(a.reception, a.arrive_country) || pointCountry(a.farewell, a.leave_country) || undefined,
  };
}
