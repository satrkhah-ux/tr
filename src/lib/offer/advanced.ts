/**
 * «بكج متقدم» — the SAME basic file, plus four short answers for the trips that
 * do not fit «land at the airport, get picked up there, fly home from it»:
 *
 *   1. how the client arrives and leaves (flight / overland / train-ferry / already there),
 *   2. where we meet them and where we leave them (airport / a hotel / ONE side of a border / they come themselves),
 *   3. what they arrange themselves (never on the bill, said as «غير مشمول»),
 *   4. a border between two cities: one car across, or two cars with a self crossing.
 *
 * The answers only reword what Basic already derives: the transfer rows and the
 * «يشمل / لا يشمل» lines. Nothing is assumed from a country or an airport name.
 * A file without `advanced` (or with it off) is exactly the basic file.
 *
 * Pure: no React, no Supabase.
 */

import { hopKey, type DraftTransport } from "./draft-types";

export type ArriveBy = "flight" | "land" | "rail_sea" | "already";
export type PointKind = "airport" | "hotel" | "border" | "self";

export type ServicePoint = {
  kind: PointKind;
  /** hotel / crossing / airport name, as the agent writes it. */
  place: string;
  /** border only: the side we mean — the country that side belongs to. */
  side: string;
  /** the driver's meeting time ("HH:MM"), not the landing time. */
  time: string;
};

export type BorderHop = { drivers: 1 | 2; crossing: string; side_from: string; side_to: string };

export type DraftAdvanced = {
  on: boolean;
  arrive_by: ArriveBy;
  /** where the client actually lands / arrives, when it is not where we meet them. */
  arrive_at: string;
  leave_by: ArriveBy;
  leave_from: string;
  reception: ServicePoint;
  farewell: ServicePoint;
  /** «ليلة في فندق بريزا», «الانتقال إلى الحدود»… */
  self_items: string[];
  /** keyed `${from}>${to}` (city names), only for hops that cross a border. */
  borders: Record<string, BorderHop>;
};

export const ARRIVE_BY_AR: Record<ArriveBy, string> = { flight: "طيران", land: "برّاً", rail_sea: "قطار / عبّارة", already: "موجود مسبقاً في البلد" };
export const POINT_AR: Record<PointKind, string> = { airport: "المطار", hotel: "فندق", border: "الحدود", self: "يصل بنفسه" };

const point = (kind: PointKind = "airport"): ServicePoint => ({ kind, place: "", side: "", time: "" });

export function emptyAdvanced(): DraftAdvanced {
  return { on: false, arrive_by: "flight", arrive_at: "", leave_by: "flight", leave_from: "", reception: point(), farewell: point(), self_items: [], borders: {} };
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
  };
}

/** «معبر سارب — جانب جورجيا» rather than «الحدود». */
export function pointText(p: ServicePoint, airportName = "المطار"): string {
  if (p.kind === "airport") return p.place ? `مطار ${p.place.replace(/^مطار\s+/, "")}` : airportName;
  if (p.kind === "hotel") return p.place ? `فندق ${p.place.replace(/^فندق\s+/, "")}` : "الفندق";
  if (p.kind === "border") return `${p.place || "المعبر الحدودي"}${p.side ? ` — جانب ${p.side}` : ""}`;
  return "";
}

export { hopKey };

const note = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" — ");

/**
 * Basic's derived transfer rows, reworded by the answers. Rows the answers do
 * not touch come back unchanged.
 */
export function withAdvancedTransport(rows: DraftTransport[], adv: DraftAdvanced | undefined, airport = "المطار"): DraftTransport[] {
  if (!adv?.on) return rows;
  // the arrival pickup is the first row from the airport, the farewell the last row to it
  const first = rows.findIndex((r) => r.from_place === airport);
  const last = rows.map((r) => r.to_place).lastIndexOf(airport);
  const out: DraftTransport[] = [];
  rows.forEach((row, i) => {
    if (i === first) {
      if (adv.reception.kind !== "self") out.push({ ...row, from_place: pointText(adv.reception, airport), note: note(adv.reception.time && `اللقاء ${adv.reception.time}`, row.note) });
      return;
    }
    if (i === last) {
      if (adv.farewell.kind !== "self") out.push({ ...row, to_place: pointText(adv.farewell, airport), note: note(adv.farewell.time && `الانطلاق ${adv.farewell.time}`, row.note) });
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
  return !!adv?.on && (adv.reception.kind !== "airport" || adv.farewell.kind !== "airport");
}

/** The words the client reads: where our service starts and ends, and what is theirs. */
export function advancedLines(adv: DraftAdvanced | undefined): { includes: string[]; excludes: string[] } {
  if (!adv?.on) return { includes: [], excludes: [] };
  const includes: string[] = [];
  const excludes: string[] = [];
  const arrive = adv.arrive_at.trim();
  const { reception: rx, farewell: fw } = adv;
  if (adv.arrive_by === "already") excludes.push("وصولكم إلى البلد — ترتيب ذاتي، غير مشمول");
  else if (arrive && rx.kind !== "airport") excludes.push(`وصولكم إلى ${arrive} (${ARRIVE_BY_AR[adv.arrive_by]}) وفق ترتيبكم — غير مشمول`);
  if (rx.kind === "self") excludes.push("الوصول إلى الفندق الأول — ترتيب ذاتي، غير مشمول");
  else if (rx.kind !== "airport") {
    if (arrive && adv.arrive_by !== "already") excludes.push(`الانتقال من ${arrive} إلى ${pointText(rx)} — ترتيب ذاتي، غير مشمول`);
    includes.push(`تبدأ خدماتنا باستقبالكم من ${pointText(rx)}${rx.time ? ` الساعة ${rx.time}` : ""}`);
  }
  if (fw.kind === "self") excludes.push("التوجه إلى نقطة المغادرة — ترتيب ذاتي، غير مشمول");
  else if (fw.kind !== "airport") includes.push(`تنتهي خدماتنا بتوصيلكم إلى ${pointText(fw)}`);
  const leave = adv.leave_from.trim();
  if (leave && fw.kind !== "airport") excludes.push(`مغادرتكم من ${leave} (${ARRIVE_BY_AR[adv.leave_by]}) — غير مشمولة`);
  for (const hop of Object.values(adv.borders)) if (hop.crossing.trim() && hop.drivers === 2) excludes.push(`عبور ${hop.crossing} بين السائقين — يعبره المسافرون بأنفسهم`);
  for (const item of adv.self_items) if (item.trim()) excludes.push(`${item.trim()} — يرتّبه العميل بنفسه، غير مشمول`);
  return { includes, excludes };
}

/** What is still open — said to the agent, never invented. */
export function advancedGaps(adv: DraftAdvanced | undefined): string[] {
  if (!adv?.on) return [];
  const gaps: string[] = [];
  for (const [label, p] of [["الاستقبال", adv.reception], ["التوديع", adv.farewell]] as const) {
    if (p.kind === "self" || p.kind === "airport") continue;
    if (!p.place.trim()) gaps.push(`${label}: اكتب اسم ${p.kind === "hotel" ? "الفندق" : "المعبر"}`);
    if (p.kind === "border" && !p.side.trim()) gaps.push(`${label}: حدد أي جانب من الحدود`);
    if (!p.time.trim()) gaps.push(`${label}: موعد اللقاء ينتظر التأكيد`);
  }
  if (adv.arrive_by !== "already" && (adv.reception.kind === "hotel" || adv.reception.kind === "border") && !adv.arrive_at.trim())
    gaps.push("من أين يأتي العميل إلى نقطة الاستقبال؟ اكتب مكان وصوله");
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
  const swap = (text: string, from: string, p: ServicePoint, word: "استقبال" | "توديع") => {
    const i = text.indexOf(from);
    if (i < 0) return text;
    const tail = text.slice(i + from.length); // « — vehicle» and anything after
    const head = text.slice(0, i);
    // the note joins its parts with « · »: drop the whole part
    if (p.kind === "self") return text.split(" · ").filter((part) => !part.startsWith(from)).join(" · ");
    if (p.kind === "airport") return text;
    const line = word === "استقبال" ? `استقبال من ${pointText(p)} إلى الفندق` : `توديع من الفندق إلى ${pointText(p)}`;
    return head + line + tail;
  };
  const out = swap(swap(note, "توديع من الفندق إلى المطار", adv.farewell, "توديع"), "استقبال من المطار إلى الفندق", adv.reception, "استقبال");
  return out || null;
}

/** The programme's first / last day lines when we do not meet or leave them at the airport; null = Basic's own words. */
export function advancedDayLines(adv: DraftAdvanced | undefined): { arrive: string | null; leave: string | null } {
  if (!adv?.on) return { arrive: null, leave: null };
  const rx = adv.reception;
  const fw = adv.farewell;
  return {
    arrive:
      rx.kind === "airport"
        ? null
        : rx.kind === "self"
          ? "الوصول إلى الفندق بترتيبكم الخاص"
          : `الاستقبال من ${pointText(rx)}${rx.time ? ` الساعة ${rx.time}` : ""} من قبل موظف ترافليون والتوجه إلى الفندق`,
    leave: fw.kind === "airport" ? null : fw.kind === "self" ? "تسجيل الخروج من الفندق" : `تسجيل الخروج من الفندق والتوجه إلى ${pointText(fw)}`,
  };
}
