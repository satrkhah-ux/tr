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
import { itineraryStartDate } from "./schedule";

export type ArriveBy = "" | "flight" | "land" | "rail_sea" | "already";
export type PointKind = "" | "airport" | "hotel" | "border" | "self";

export type ServicePoint = {
  kind: PointKind;
  /** hotel / crossing / airport name, as the agent picks it. */
  place: string;
  /** border only: the side we mean — the country that side belongs to. */
  side: string;
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
  /** date fields still following Basic; a field the agent edits leaves this list. */
  auto: AdvancedDateKey[];
};

export const ARRIVE_BY_AR: Record<Exclude<ArriveBy, "">, string> = { flight: "طيران", land: "برّاً", rail_sea: "قطار / عبّارة", already: "موجود مسبقاً في البلد" };
export const POINT_AR: Record<Exclude<PointKind, "">, string> = { airport: "المطار", hotel: "فندق", border: "الحدود", self: "يصل بنفسه" };

const point = (): ServicePoint => ({ kind: "", place: "", side: "", date: "", time: "" });

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
    reception_date: d.checkin_date || d.arrive_date || "",
    farewell_date: d.leave_date ?? "",
    leave_date: d.leave_date ?? "",
    leave_time: d.leave_time ?? "",
  };
  let out = adv;
  const auto = new Set(adv.auto);
  for (const k of Object.keys(want) as AdvancedDateKey[]) {
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
  // the arrival pickup is the first row from the airport, the farewell the last row to it
  const first = rows.findIndex((r) => r.from_place === airport);
  const last = rows.map((r) => r.to_place).lastIndexOf(airport);
  const out: DraftTransport[] = [];
  rows.forEach((row, i) => {
    if (i === first && adv.reception.kind) {
      const rx = adv.reception;
      if (rx.kind !== "self")
        out.push({ ...row, from_place: rx.kind === "airport" ? airportOf(adv.arrive_by, adv.arrive_at, airport) : pointText(rx), date: rx.date || row.date, note: note(rx.time && `اللقاء ${rx.time}`, row.note) });
      return;
    }
    if (i === last && adv.farewell.kind) {
      const fw = adv.farewell;
      if (fw.kind !== "self")
        out.push({ ...row, to_place: fw.kind === "airport" ? airportOf(adv.leave_by, adv.leave_from, airport) : pointText(fw), date: fw.date || row.date, note: note(fw.time && `الانطلاق ${fw.time}`, row.note) });
      return;
    }
    const hop = adv.borders[hopKey(row.from_place, row.to_place)];
    if (hop?.crossing.trim()) {
      const side = (s: string) => `${hop.crossing}${s ? ` — جانب ${s}` : ""}`;
      if (hop.drivers === 2) {
        out.push({ ...row, to_place: side(hop.side_from), note: note("السائق الأول", row.note) });
        out.push({ ...row, from_place: side(hop.side_to), note: note("السائق الثاني بعد عبور الحدود", row.note) });
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
  return !!adv?.on && (off(adv.reception.kind) || off(adv.farewell.kind));
}

/** The words the client reads: where and when our service starts and ends, and what is theirs. */
export function advancedLines(adv: DraftAdvanced | undefined): { includes: string[]; excludes: string[] } {
  if (!adv?.on) return { includes: [], excludes: [] };
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
  if (fw.kind === "self") excludes.push("التوجه إلى نقطة المغادرة — ترتيب ذاتي، غير مشمول");
  else if (fw.kind === "airport") {
    if (leave && adv.leave_by === "flight") includes.push(`تنتهي خدماتنا بتوصيلكم إلى ${airportOf("flight", leave, "المطار")}${at(fw)}`);
  } else if (fw.kind) includes.push(`تنتهي خدماتنا بتوصيلكم إلى ${pointText(fw)}${at(fw)}`);
  if (leave && fw.kind && fw.kind !== "airport") excludes.push(`مغادرتكم من ${leave}${by(adv.leave_by)} — غير مشمولة`);
  for (const hop of Object.values(adv.borders)) if (hop.crossing.trim() && hop.drivers === 2) excludes.push(`عبور ${hop.crossing} بين السائقين — يعبره المسافرون بأنفسهم`);
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

/** What is still open or does not add up — said to the agent, never invented. */
export function advancedGaps(adv: DraftAdvanced | undefined): string[] {
  if (!adv?.on) return [];
  const gaps: string[] = [];
  if (!adv.arrive_country) gaps.push("اختر دولة وصول العميل");
  if (!adv.arrive_by) gaps.push("اختر كيف يصل العميل");
  if (!adv.leave_country) gaps.push("اختر دولة مغادرة العميل");
  if (!adv.leave_by) gaps.push("اختر كيف يغادر العميل");
  for (const w of [wrongPlace(adv.arrive_by, adv.arrive_at), wrongPlace(adv.leave_by, adv.leave_from)]) if (w) gaps.push(w);
  for (const [label, p] of [["الاستقبال", adv.reception], ["التوديع", adv.farewell]] as const) {
    if (!p.kind) {
      gaps.push(`اختر نقطة ${label}`);
      continue;
    }
    if (p.kind === "self") continue;
    if (p.kind !== "airport" && !p.place.trim()) gaps.push(`${label}: اختر ${p.kind === "hotel" ? "الفندق" : "المعبر"}`);
    if (p.kind === "border" && !p.side.trim()) gaps.push(`${label}: حدد أي جانب من الحدود`);
    if (!p.date) gaps.push(`${label}: التاريخ غير محدد`);
    if (p.kind !== "airport" && !p.time.trim()) gaps.push(`${label}: موعد اللقاء ينتظر التأكيد`);
  }
  if (adv.arrive_by && adv.arrive_by !== "already" && (adv.reception.kind === "hotel" || adv.reception.kind === "border") && !adv.arrive_at.trim())
    gaps.push("من أين يأتي العميل إلى نقطة الاستقبال؟ اختر مكان وصوله");
  // the dates against each other — reported, never corrected
  const rx = adv.reception;
  if (adv.arrive_date && rx.kind && rx.kind !== "self" && rx.date && rx.date < adv.arrive_date) gaps.push(`الاستقبال (${rx.date}) قبل وصول العميل (${adv.arrive_date})`);
  if (adv.arrive_date && adv.checkin_date && adv.checkin_date > adv.arrive_date && !adv.self_items.some((x) => x.trim()))
    gaps.push(`بين الوصول (${adv.arrive_date}) والدخول للفندق (${adv.checkin_date}) ليلة غير محجوزة — أضفها لما يرتّبه العميل أو احجزها`);
  if (adv.arrive_date && adv.checkin_date === adv.arrive_date && adv.arrive_time && adv.arrive_time < "06:00")
    gaps.push(`الوصول ${adv.arrive_time} بعد منتصف الليل والدخول ${adv.checkin_date} — هل يلزم حجز الليلة السابقة؟`);
  if (adv.leave_date && adv.farewell.kind && adv.farewell.kind !== "self" && adv.farewell.date && adv.farewell.date > adv.leave_date)
    gaps.push(`التوديع (${adv.farewell.date}) بعد مغادرة العميل (${adv.leave_date})`);
  for (const [key, hop] of Object.entries(adv.borders)) if (!hop.crossing.trim()) gaps.push(`${key.replace(">", " ← ")}: اكتب اسم المعبر`);
  return gaps;
}

/**
 * The day card's transport line (itinerary.transportNoteForDay) says «من المطار»;
 * with a reception or farewell elsewhere it says where, or nothing when the
 * client comes by themselves.
 */
export function advancedDayNote(note: string | null, adv: DraftAdvanced | undefined): string | null {
  if (!note || !adv?.on) return note;
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
