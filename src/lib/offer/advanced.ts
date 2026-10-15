/**
 * «البكج المتقدم» — the trip as the CLIENT travels it, beside the services WE sell.
 *
 * The basic screen assumes one country, one arrival airport that is also the
 * reception point and the first hotel's city. Real files break every one of
 * those: a Georgia package whose client lands in Trabzon, sleeps in Rize on
 * their own, is met at the Georgian side of the border and leaves from Tbilisi.
 *
 * So nothing here is assumed equal to anything else. Places are records of
 * their own (an airport, a hotel, ONE side of a border crossing, an address…);
 * the client's known movements are `segments` (information — a self transfer is
 * a segment); what we sell is `services` (reception, transfers, tours…) and
 * `stays`. A service may depend on a segment (the flight it meets) but never
 * becomes it, and a ticket edit never turns a hotel pickup into an airport one:
 * only a service that says `use_arrival_airport` follows the flight.
 *
 * Every rule is generic: no country, airport or city is named in code.
 *
 * Stored inside the draft (`DraftData.journey`), so an old file without it is
 * untouched, and while it is `enabled` it OWNS the file's transfers (the basic
 * transport plan prints no airport pickup the journey does not contain).
 *
 * Pure: no React, no Supabase, no clock (callers pass `now`).
 */

import { toInstant } from "./schedule";
import type { DraftData, DraftPricingItem, GeneratorLookups } from "./draft-types";

// ---------- vocabulary ----------

export type PlaceKind = "airport" | "hotel" | "border" | "train" | "bus" | "port" | "address" | "landmark" | "tbd";
export type MoveMode = "flight" | "car" | "bus" | "train" | "ferry" | "border" | "self" | "other";
export type Party = "company" | "client" | "third_party";
export type ItemStatus = "tentative" | "confirmed" | "in_progress" | "done" | "cancelled" | "review" | "feasibility";
export type ServiceKind = "reception" | "farewell" | "transfer" | "tour" | "ticket" | "other";

export const PLACE_KIND_AR: Record<PlaceKind, string> = {
  airport: "مطار",
  hotel: "فندق",
  border: "معبر حدودي",
  train: "محطة قطار",
  bus: "محطة حافلات",
  port: "ميناء",
  address: "عنوان خاص",
  landmark: "معلم / نقطة لقاء",
  tbd: "يحدد لاحقاً",
};
export const MODE_AR: Record<MoveMode, string> = {
  flight: "طيران",
  car: "سيارة",
  bus: "حافلة",
  train: "قطار",
  ferry: "عبّارة",
  border: "عبور حدود",
  self: "انتقال ذاتي",
  other: "أخرى",
};
export const PARTY_AR: Record<Party, string> = { company: "الشركة", client: "العميل", third_party: "طرف ثالث" };
export const STATUS_AR: Record<ItemStatus, string> = {
  tentative: "مبدئي",
  confirmed: "مؤكد",
  in_progress: "قيد التنفيذ",
  done: "مكتمل",
  cancelled: "ملغى",
  review: "يحتاج مراجعة",
  feasibility: "بانتظار التحقق من قابلية التنفيذ",
};
export const SERVICE_AR: Record<ServiceKind, string> = {
  reception: "استقبال",
  farewell: "توديع",
  transfer: "نقل",
  tour: "جولة",
  ticket: "تذاكر",
  other: "خدمة",
};
/** the services that move people from one place to another. */
export const MOVING: ReadonlySet<ServiceKind> = new Set(["reception", "farewell", "transfer"]);

// ---------- records ----------

export type Place = {
  id: string;
  kind: PlaceKind;
  name: string;
  country: string;
  /** optional on purpose: a border post or a mountain lodge has no city to give. */
  city: string;
  /** airport terminal, when it matters. */
  terminal: string;
  /** border only: which side we mean — the country that side belongs to. */
  side: string;
  address: string;
  lat: number | null;
  lng: number | null;
  /** «عند البوابة 3، لافتة باسم العميل» — printed for the driver and the client. */
  meeting: string;
  /** IANA zone; every clock at this place is read in it. */
  tz: string | null;
};

export type TravellerKind = "adult" | "child" | "infant";
export type Traveller = { id: string; name: string; kind: TravellerKind; group: string };
export type TravelGroup = { id: string; name: string };

/** A movement the client makes — ours or not. Information first; a price only through a service. */
export type Segment = {
  id: string;
  mode: MoveMode;
  from: string;
  to: string;
  /** local wall clock at `from` / `to` ("YYYY-MM-DDTHH:mm"), when known. */
  dep: string | null;
  arr: string | null;
  /** traveller ids; empty = everyone. */
  pax: string[];
  arranged_by: Party;
  /** carrier / operator as written on the ticket. */
  operated_by: string;
  /** the service of ours this movement is part of; null = information only. */
  service_id: string | null;
  status: ItemStatus;
  /** flight number / train number. */
  ref: string;
  /** ticket or booking reference — two different ones on a connection need a check. */
  ticket: string;
  notes: string;
  /** «ترتيب ذاتي، التفاصيل غير معروفة» — a gap the agent chose to close without inventing it. */
  details_unknown: boolean;
  /** an estimate of the travel time, said with its source, never a fake precision. */
  estimate_minutes: number | null;
  estimate_source: string;
};

export type ServiceStop = { place: string; pick: string[]; drop: string[] };

export type Service = {
  id: string;
  kind: ServiceKind;
  title: string;
  from: string | null;
  to: string | null;
  /** ordered intermediate stops (extra pickups / drop-offs, a border crossed on one car). */
  stops: ServiceStop[];
  /** the driver's meeting time, local at `from`. NOT the landing time. */
  at: string | null;
  /** the movement this service waits for (a flight's landing), if any. */
  depends_on: string | null;
  /** take the pickup point from `depends_on`'s arrival place — a deliberate choice. */
  use_arrival_airport: boolean;
  pax: string[];
  booked_by: Party;
  /** supplier / driver / company actually doing it. */
  operated_by: string;
  paid_by: Party;
  /** in the package price. A row in the plan is NOT a line on the bill unless this says so. */
  included: boolean;
  /** offered, not part of the package. */
  optional: boolean;
  /** «حدود التزامنا»: what we answer for. */
  commitment: string;
  /** the whole service, once — never per segment or per traveller. */
  price: number | null;
  currency: string;
  status: ItemStatus;
  ref: string;
  notes: string;
};

export type Stay = {
  id: string;
  place: string;
  check_in: string | null;
  check_out: string | null;
  /** hotel clock; default 14:00 / 12:00 when the hotel did not say. */
  check_in_time: string;
  check_out_time: string;
  pax: string[];
  rooms: number;
  included: boolean;
  booked_by: Party;
  paid_by: Party;
  price: number | null;
  currency: string;
  status: ItemStatus;
  ref: string;
  notes: string;
  /** a basic-screen hotel line this stay IS — then that line prices it, not this. */
  hotel_ref: string | null;
};

export type ChangeEntry = {
  at: string;
  by: string;
  entity: "place" | "segment" | "service" | "stay" | "traveller";
  id: string;
  label: string;
  field: string;
  before: string;
  after: string;
};

export type AdvancedJourney = {
  enabled: boolean;
  main_country: string;
  extra_countries: string[];
  groups: TravelGroup[];
  travellers: Traveller[];
  places: Place[];
  segments: Segment[];
  services: Service[];
  stays: Stay[];
  /** server-stamped; whatever a browser sends here is ignored. */
  log: ChangeEntry[];
  /** when operations last took the instructions; later changes print as new. */
  ops_issued_at: string | null;
};

// ---------- factories ----------

let seq = 0;
export function newId(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${seq.toString(36)}`;
}

export function emptyJourney(): AdvancedJourney {
  return {
    enabled: false,
    main_country: "",
    extra_countries: [],
    groups: [],
    travellers: [],
    places: [],
    segments: [],
    services: [],
    stays: [],
    log: [],
    ops_issued_at: null,
  };
}

export function newPlace(p: Partial<Place> & Pick<Place, "kind" | "name">): Place {
  return { id: newId("pl"), country: "", city: "", terminal: "", side: "", address: "", lat: null, lng: null, meeting: "", tz: null, ...p };
}

export function newSegment(s: Partial<Segment> & Pick<Segment, "mode" | "from" | "to">): Segment {
  return {
    id: newId("sg"),
    dep: null,
    arr: null,
    pax: [],
    arranged_by: "client",
    operated_by: "",
    service_id: null,
    status: "tentative",
    ref: "",
    ticket: "",
    notes: "",
    details_unknown: false,
    estimate_minutes: null,
    estimate_source: "",
    ...s,
  };
}

export function newService(s: Partial<Service> & Pick<Service, "kind">): Service {
  return {
    id: newId("sv"),
    title: "",
    from: null,
    to: null,
    stops: [],
    at: null,
    depends_on: null,
    use_arrival_airport: false,
    pax: [],
    booked_by: "company",
    operated_by: "",
    paid_by: "company",
    included: true,
    optional: false,
    commitment: "",
    price: null,
    currency: "SAR",
    status: "tentative",
    ref: "",
    notes: "",
    ...s,
  };
}

export function newStay(s: Partial<Stay> & Pick<Stay, "place">): Stay {
  return {
    id: newId("st"),
    check_in: null,
    check_out: null,
    check_in_time: "14:00",
    check_out_time: "12:00",
    pax: [],
    rooms: 1,
    included: true,
    booked_by: "company",
    paid_by: "company",
    price: null,
    currency: "SAR",
    status: "tentative",
    ref: "",
    notes: "",
    hotel_ref: null,
    ...s,
  };
}

/** Whatever the jsonb holds comes back complete — a field added later never crashes an older file. */
export function normalizeJourney(raw: unknown): AdvancedJourney | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<AdvancedJourney>;
  const arr = <T>(v: unknown, fix: (x: T) => T): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => x && typeof x === "object").map(fix) : []);
  return {
    ...emptyJourney(),
    enabled: r.enabled === true,
    main_country: typeof r.main_country === "string" ? r.main_country : "",
    extra_countries: Array.isArray(r.extra_countries) ? r.extra_countries.filter((c) => typeof c === "string") : [],
    groups: arr<TravelGroup>(r.groups, (g) => ({ id: String(g.id), name: String(g.name ?? "") })),
    travellers: arr<Traveller>(r.travellers, (t) => ({ id: String(t.id), name: String(t.name ?? ""), kind: t.kind ?? "adult", group: String(t.group ?? "") })),
    places: arr<Place>(r.places, (p) => newPlace({ ...p, id: String(p.id) })),
    segments: arr<Segment>(r.segments, (s) => newSegment({ ...s, id: String(s.id), pax: Array.isArray(s.pax) ? s.pax : [] })),
    services: arr<Service>(r.services, (s) => newService({ ...s, id: String(s.id), pax: Array.isArray(s.pax) ? s.pax : [], stops: Array.isArray(s.stops) ? s.stops : [] })),
    stays: arr<Stay>(r.stays, (s) => newStay({ ...s, id: String(s.id), pax: Array.isArray(s.pax) ? s.pax : [] })),
    log: arr<ChangeEntry>(r.log, (e) => e),
    ops_issued_at: typeof r.ops_issued_at === "string" ? r.ops_issued_at : null,
  };
}

// ---------- reading ----------

export function placeOf(j: AdvancedJourney, id: string | null | undefined): Place | undefined {
  return id ? j.places.find((p) => p.id === id) : undefined;
}

/** «معبر سارب — الجانب الجورجي (جورجيا)», never just «الحدود». */
export function placeLabel(p: Place | undefined): string {
  if (!p) return "موقع غير محدد";
  if (p.kind === "tbd") return p.name ? `${p.name} (يحدد لاحقاً)` : "موقع يحدد لاحقاً";
  const where = [p.city, p.country].filter(Boolean).join("، ");
  const base = p.kind === "border" ? `${p.name || "المعبر"} — جانب ${p.side || "غير محدد"}` : p.name || PLACE_KIND_AR[p.kind];
  const terminal = p.kind === "airport" && p.terminal ? ` (صالة ${p.terminal})` : "";
  return `${base}${terminal}${where && p.kind !== "border" ? ` — ${where}` : ""}`;
}

/** empty pax = everyone on the file. */
export function paxIds(j: AdvancedJourney, pax: string[]): string[] {
  return pax.length ? pax : j.travellers.map((t) => t.id);
}

/** Where a service actually picks up: the flight's arrival only when the agent chose that. */
export function serviceFrom(j: AdvancedJourney, s: Service): string | null {
  if (s.use_arrival_airport && s.depends_on) {
    const seg = j.segments.find((g) => g.id === s.depends_on);
    if (seg) return seg.to;
  }
  return s.from;
}

/** One traveller's leg of a multi-stop service: where THEY get in and out. */
export function serviceLegFor(j: AdvancedJourney, s: Service, travellerId: string): { from: string | null; to: string | null } {
  let from = serviceFrom(j, s);
  let to = s.to;
  for (const stop of s.stops) {
    if (stop.pick.includes(travellerId)) from = stop.place;
    if (stop.drop.includes(travellerId)) to = stop.place;
  }
  return { from, to };
}

export function isOurSegment(s: Segment): boolean {
  return !!s.service_id || s.arranged_by === "company";
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Nights from the stay's own dates — never from the flights or the client's first landing. */
export function stayNights(s: Pick<Stay, "check_in" | "check_out">): number | null {
  if (!s.check_in || !s.check_out) return null;
  return daysBetween(s.check_in, s.check_out);
}

/** Room-nights are a COST unit: 3 nights in 2 rooms is 6 room-nights and still 3 nights. */
export function roomNights(s: Stay): number | null {
  const n = stayNights(s);
  return n == null ? null : n * Math.max(s.rooms, 1);
}

// ---------- time ----------

function instant(local: string | null, tz: string | null | undefined): number | null {
  const d = toInstant(local, tz ?? null);
  return d ? d.getTime() : null;
}

/** For ORDERING only: the true instant when the zone is known, else the wall clock read as UTC. */
function sortKey(local: string | null, tz: string | null | undefined): number | null {
  if (!local) return null;
  return instant(local, tz) ?? Date.parse(`${local.slice(0, 16)}:00Z`);
}

function hhmm(local: string | null): string {
  return local && local.length >= 16 ? local.slice(11, 16) : "";
}

function fmtWhen(local: string | null): string {
  if (!local) return "موعد غير محدد";
  const [d, t] = [local.slice(0, 10), hhmm(local)];
  return t ? `${d} ${t}` : d;
}

// ---------- the walk ----------

export type MoveItem = {
  type: "segment" | "service" | "stay";
  id: string;
  from: string | null;
  to: string | null;
  start: string | null;
  end: string | null;
  startKey: number | null;
  endKey: number | null;
  startTz: string | null;
  endTz: string | null;
};

/** Everything one traveller does, in time order. A service with linked segments is told by its segments. */
export function travellerItems(j: AdvancedJourney, travellerId: string): MoveItem[] {
  const out: MoveItem[] = [];
  const has = (pax: string[]) => paxIds(j, pax).includes(travellerId);
  const covered = new Set(j.segments.map((s) => s.service_id).filter(Boolean));
  for (const s of j.segments) {
    if (s.status === "cancelled" || !has(s.pax)) continue;
    const ft = placeOf(j, s.from)?.tz ?? null;
    const tt = placeOf(j, s.to)?.tz ?? null;
    out.push({ type: "segment", id: s.id, from: s.from, to: s.to, start: s.dep, end: s.arr, startKey: sortKey(s.dep, ft), endKey: sortKey(s.arr, tt), startTz: ft, endTz: tt });
  }
  for (const s of j.services) {
    if (s.status === "cancelled" || !MOVING.has(s.kind) || covered.has(s.id) || !has(s.pax)) continue;
    const leg = serviceLegFor(j, s, travellerId);
    const tz = placeOf(j, leg.from)?.tz ?? null;
    const key = sortKey(s.at, tz);
    out.push({ type: "service", id: s.id, from: leg.from, to: leg.to, start: s.at, end: null, startKey: key, endKey: key, startTz: tz, endTz: placeOf(j, leg.to)?.tz ?? null });
  }
  for (const s of j.stays) {
    if (s.status === "cancelled" || !has(s.pax) || !s.check_in) continue;
    const tz = placeOf(j, s.place)?.tz ?? null;
    const start = `${s.check_in}T${s.check_in_time || "14:00"}`;
    const end = s.check_out ? `${s.check_out}T${s.check_out_time || "12:00"}` : null;
    out.push({ type: "stay", id: s.id, from: s.place, to: s.place, start, end, startKey: sortKey(start, tz), endKey: sortKey(end, tz), startTz: tz, endTz: tz });
  }
  return out
    .filter((i) => i.startKey != null)
    .sort((a, b) => a.startKey! - b.startKey! || (a.type === "stay" ? 1 : 0) - (b.type === "stay" ? 1 : 0));
}

// ---------- checks ----------

export type Severity = "error" | "warning" | "missing";
export type JourneyIssue = { severity: Severity; code: string; message: string; refs: string[] };

export const MIN_CONNECTION_MINUTES = 60;
/** a pickup more than this after check-out needs a late check-out or a wait arranged. */
export const LATE_DEPARTURE_HOURS = 3;

function samePlace(j: AdvancedJourney, a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // unknown is not a contradiction — it is reported as missing elsewhere
  if (a === b) return true;
  const pa = placeOf(j, a);
  const pb = placeOf(j, b);
  // two records for the same hotel/airport typed twice
  return !!pa && !!pb && pa.kind === pb.kind && pa.kind !== "border" && !!pa.name && pa.name.trim() === pb.name.trim() && pa.country === pb.country;
}

function itemLabel(j: AdvancedJourney, i: MoveItem): string {
  if (i.type === "stay") return `الإقامة في ${placeLabel(placeOf(j, i.from))}`;
  if (i.type === "service") {
    const s = j.services.find((x) => x.id === i.id)!;
    return `${s.title || SERVICE_AR[s.kind]} من ${placeLabel(placeOf(j, i.from))}`;
  }
  const s = j.segments.find((x) => x.id === i.id)!;
  return `${MODE_AR[s.mode]}${s.ref ? ` ${s.ref}` : ""} من ${placeLabel(placeOf(j, s.from))} إلى ${placeLabel(placeOf(j, s.to))}`;
}

/**
 * Three severities, as the company asked: an ERROR blocks approving the item,
 * a WARNING needs a human to look, MISSING is allowed on a draft and shown.
 * Nothing here fills a gap: a missing leg is reported, never invented.
 */
export function checkJourney(j: AdvancedJourney): JourneyIssue[] {
  const issues: JourneyIssue[] = [];
  const add = (severity: Severity, code: string, message: string, ...refs: string[]) => {
    const key = `${code}:${refs.join(",")}`;
    if (!issues.some((x) => `${x.code}:${x.refs.join(",")}` === key)) issues.push({ severity, code, message, refs });
  };

  for (const s of j.segments) {
    if (s.status === "cancelled") continue;
    const ft = placeOf(j, s.from)?.tz;
    const tt = placeOf(j, s.to)?.tz;
    const d = instant(s.dep, ft);
    const a = instant(s.arr, tt);
    if (d != null && a != null && a < d) add("error", "seg.arrBeforeDep", `${MODE_AR[s.mode]} ${s.ref}: الوصول أسبق من الانطلاق بعد احتساب المناطق الزمنية`, s.id);
    else if (s.dep && s.arr && (d == null || a == null) && s.arr < s.dep && ft !== tt)
      add("warning", "seg.tzUnknown", `${MODE_AR[s.mode]} ${s.ref}: الوقتان بتوقيتين مختلفين ولا تُعرف المنطقة الزمنية — تحقق منهما`, s.id);
    if (s.mode === "flight" && !s.ref.trim() && !s.details_unknown) add("missing", "seg.noFlightNo", `رقم الرحلة غير معروف: ${placeLabel(placeOf(j, s.from))} ← ${placeLabel(placeOf(j, s.to))}`, s.id);
    if (!s.from || !s.to) add("missing", "seg.noPlace", `مقطع ${MODE_AR[s.mode]} بلا نقطة انطلاق أو وصول`, s.id);
    if (s.status === "review") add("warning", "seg.review", `${MODE_AR[s.mode]} ${s.ref}: يحتاج مراجعة`, s.id);
    if (s.status === "feasibility") add("missing", "seg.feasibility", `${MODE_AR[s.mode]} ${s.ref}: بانتظار التحقق من قابلية التنفيذ`, s.id);
  }

  for (const s of j.stays) {
    if (s.status === "cancelled") continue;
    const n = stayNights(s);
    const where = placeLabel(placeOf(j, s.place));
    if (n != null && n < 0) add("error", "stay.outBeforeIn", `${where}: تاريخ الخروج أسبق من تاريخ الدخول`, s.id);
    const p = placeOf(j, s.place);
    if (!p || p.kind === "tbd" || !p.name.trim()) add("missing", "stay.noHotel", `الفندق لم يُحدد${s.check_in ? ` (${s.check_in})` : ""}`, s.id);
    if (!s.check_in || !s.check_out) add("missing", "stay.noDates", `${where}: تاريخا الدخول والخروج غير مكتملين`, s.id);
  }

  for (const s of j.services) {
    if (s.status === "cancelled") continue;
    const title = s.title || SERVICE_AR[s.kind];
    const from = serviceFrom(j, s);
    if (MOVING.has(s.kind) && s.status === "confirmed" && (!from || !s.to)) add("error", "svc.confirmedNoPlace", `${title}: خدمة نقل مؤكدة بلا نقطة انطلاق أو وصول`, s.id);
    if (MOVING.has(s.kind) && !s.at) add("missing", "svc.noTime", `${title}: الموعد ينتظر التأكيد`, s.id);
    if (MOVING.has(s.kind) && (placeOf(j, from)?.kind === "tbd" || placeOf(j, s.to)?.kind === "tbd")) add("missing", "svc.placeTbd", `${title}: موقع يحدد لاحقاً`, s.id);
    if (s.status === "feasibility") add("missing", "svc.feasibility", `${title}: بانتظار التحقق من قابلية التنفيذ`, s.id);
    if (s.status === "review") add("warning", "svc.review", `${title}: يحتاج مراجعة`, s.id);
    const seg = s.depends_on ? j.segments.find((g) => g.id === s.depends_on) : undefined;
    if (seg) {
      const landed = instant(seg.arr, placeOf(j, seg.to)?.tz);
      const meet = instant(s.at, placeOf(j, from)?.tz);
      if (landed != null && meet != null && meet < landed) add("warning", "svc.beforeArrival", `${title}: موعد اللقاء ${hhmm(s.at)} قبل وصول ${seg.ref || MODE_AR[seg.mode]} ${hhmm(seg.arr)}`, s.id, seg.id);
      if (!samePlace(j, seg.to, from)) add("warning", "svc.notWhereArrives", `${title}: مرتبط بـ${seg.ref || MODE_AR[seg.mode]} الذي يصل إلى ${placeLabel(placeOf(j, seg.to))} لا إلى نقطة الاستقبال ${placeLabel(placeOf(j, from))}`, s.id, seg.id);
      if (seg.status === "cancelled" || seg.status === "review") add("warning", "svc.segmentChanged", `${title}: المقطع المرتبط ${seg.ref || MODE_AR[seg.mode]} ${STATUS_AR[seg.status]} — راجع الخدمة`, s.id, seg.id);
    }
  }
  // a service tied to a cancelled movement is caught above only while the movement is listed
  for (const s of j.services) {
    if (s.depends_on && !j.segments.some((g) => g.id === s.depends_on)) add("warning", "svc.segmentGone", `${s.title || SERVICE_AR[s.kind]}: المقطع الذي يعتمد عليه حُذف`, s.id);
  }

  // per traveller: continuity, conflicts, the hotel clock
  for (const t of j.travellers.length ? j.travellers : [{ id: "", name: "", kind: "adult" as const, group: "" }]) {
    const items = travellerItems(j, t.id);
    let here: string | null = null;
    let last: MoveItem | null = null;
    let lastMove: MoveItem | null = null;
    const stays = items.filter((i) => i.type === "stay");
    for (const it of items) {
      if (last && here && it.from && !samePlace(j, here, it.from)) {
        const sev: Severity = it.type === "service" ? "warning" : "missing";
        const msg =
          it.type === "service"
            ? `نقطة البداية (${placeLabel(placeOf(j, it.from))}) تختلف عن مكان وجود العميل المتوقع (${placeLabel(placeOf(j, here))}) ولا يوجد انتقال مسجل`
            : `مقطع ناقص: من ${placeLabel(placeOf(j, here))} إلى ${placeLabel(placeOf(j, it.from))} — سجّله أو اختر «ترتيب ذاتي، التفاصيل غير معروفة»`;
        add(sev, it.type === "service" ? "gap.service" : "gap.segment", msg, last.id, it.id);
      }
      if (it.type !== "stay") {
        if (lastMove && lastMove.endKey != null && it.startKey != null && it.startKey < lastMove.endKey)
          add("warning", "conflict.move", `تعارض للمسافرين أنفسهم: ${itemLabel(j, it)} يبدأ قبل انتهاء ${itemLabel(j, lastMove)}`, lastMove.id, it.id);
        const a = lastMove && j.segments.find((s) => s.id === lastMove!.id);
        const b = j.segments.find((s) => s.id === it.id);
        if (a && b && a.mode === "flight" && b.mode === "flight" && lastMove!.endKey != null && it.startKey != null) {
          const gap = (it.startKey - lastMove!.endKey) / 60_000;
          if (gap >= 0 && gap < MIN_CONNECTION_MINUTES) add("warning", "tight", `وقت غير كافٍ ظاهرياً بين ${a.ref || "الرحلة"} و${b.ref || "الرحلة"} (${Math.round(gap)} دقيقة)`, a.id, b.id);
          if (a.ticket.trim() && b.ticket.trim() && a.ticket.trim() !== b.ticket.trim())
            add("warning", "separateTickets", `${a.ref || "رحلة"} و${b.ref || "رحلة"} على تذكرتين منفصلتين (${a.ticket} / ${b.ticket}) — راجع وقت الربط`, a.id, b.id);
        }
        // the hotel's clock: landing after midnight or before check-in time, leaving long after check-out
        for (const st of stays) {
          const stay = j.stays.find((s) => s.id === st.id)!;
          // a transfer's drop-off time is unknown: it is at the hotel no earlier than its pickup
          const reached = it.end ?? it.start;
          if (reached && it.to && samePlace(j, it.to, st.from) && stay.check_in && reached.slice(0, 10) === stay.check_in) {
            const h = Number(reached.slice(11, 13));
            if (h < 6) add("warning", "stay.afterMidnight", `${placeLabel(placeOf(j, st.from))}: الوصول ${fmtWhen(reached)} بعد منتصف الليل والحجز يبدأ ${stay.check_in} — راجع هل يلزم حجز الليلة السابقة`, it.id, st.id);
            else if (hhmm(reached) < (stay.check_in_time || "14:00")) add("warning", "stay.early", `${placeLabel(placeOf(j, st.from))}: الوصول ${hhmm(reached)} قبل موعد الدخول ${stay.check_in_time} — رتّب انتظاراً أو دخولاً مبكراً (غير مضمون)`, it.id, st.id);
          }
          if (it.from && it.start && samePlace(j, it.from, st.from) && stay.check_out && it.start.slice(0, 10) === stay.check_out) {
            const [ch, cm] = (stay.check_out_time || "12:00").split(":").map(Number);
            const [h, m] = hhmm(it.start).split(":").map(Number);
            if (h * 60 + m - (ch * 60 + cm) > LATE_DEPARTURE_HOURS * 60)
              add("warning", "stay.lateDeparture", `${placeLabel(placeOf(j, st.from))}: الخروج ${stay.check_out_time} والانطلاق ${hhmm(it.start)} — رتّب خروجاً متأخراً أو مكان انتظار`, st.id, it.id);
          }
        }
        lastMove = it;
      }
      if (it.to) here = it.to;
      last = it;
    }
    for (let i = 0; i < stays.length; i++)
      for (let k = i + 1; k < stays.length; k++) {
        const a = stays[i];
        const b = stays[k];
        if (a.endKey != null && b.startKey != null && b.startKey < a.endKey && b.startKey >= a.startKey!)
          add("warning", "conflict.stay", `إقامتان متداخلتان للمسافرين أنفسهم: ${itemLabel(j, a)} و${itemLabel(j, b)}`, a.id, b.id);
      }
  }
  return issues;
}

/** Errors that block approving THIS item (status → confirmed). */
export function blockingFor(issues: JourneyIssue[], id: string): JourneyIssue[] {
  return issues.filter((i) => i.severity === "error" && i.refs.includes(id));
}

// ---------- timeline ----------

export type Tag = "included" | "optional" | "self" | "third_party" | "missing" | "review";
export const TAG_AR: Record<Tag, string> = {
  included: "خدمة مشمولة",
  optional: "خدمة اختيارية",
  self: "ترتيب ذاتي",
  third_party: "طرف ثالث",
  missing: "معلومة ناقصة",
  review: "يحتاج مراجعة",
};

export type TimelineRow = MoveItem & { title: string; tags: Tag[]; status: ItemStatus };

export function timeline(j: AdvancedJourney, travellerId: string, issues = checkJourney(j)): TimelineRow[] {
  const flagged = (id: string, sev: Severity) => issues.some((i) => i.severity === sev && i.refs.includes(id));
  return travellerItems(j, travellerId).map((it) => {
    const tags: Tag[] = [];
    let title: string;
    let status: ItemStatus;
    if (it.type === "segment") {
      const s = j.segments.find((x) => x.id === it.id)!;
      title = itemLabel(j, it);
      status = s.status;
      tags.push(s.service_id ? "included" : s.arranged_by === "third_party" ? "third_party" : s.arranged_by === "client" ? "self" : "included");
    } else if (it.type === "service") {
      const s = j.services.find((x) => x.id === it.id)!;
      title = `${s.title || SERVICE_AR[s.kind]}: ${placeLabel(placeOf(j, it.from))} ← ${placeLabel(placeOf(j, it.to))}`;
      status = s.status;
      tags.push(s.paid_by === "third_party" || s.booked_by === "third_party" ? "third_party" : s.optional ? "optional" : s.included ? "included" : "self");
    } else {
      const s = j.stays.find((x) => x.id === it.id)!;
      title = `${itemLabel(j, it)} — ${stayNights(s) ?? "?"} ليلة`;
      status = s.status;
      tags.push(s.included ? "included" : s.booked_by === "third_party" ? "third_party" : "self");
    }
    if (flagged(it.id, "missing")) tags.push("missing");
    if (flagged(it.id, "warning") || flagged(it.id, "error") || status === "review" || status === "feasibility") tags.push("review");
    return { ...it, title, tags, status };
  });
}

// ---------- spans ----------

export type Spans = {
  /** the client's whole trip, from the first known movement to the last. */
  travel: { from: string | null; to: string | null };
  /** our first and last service (or included stay). */
  services: { from: string | null; to: string | null };
  /** distinct nights in stays we include — concurrent rooms do not add nights. */
  includedNights: number;
  roomNights: number;
  /** nights the client sleeps somewhere we do not sell. */
  externalNights: number;
};

function nightsSet(stays: Stay[]): Set<string> {
  const out = new Set<string>();
  for (const s of stays) {
    const n = stayNights(s);
    if (n == null || n <= 0) continue;
    for (let i = 0; i < n; i++) out.add(new Date(Date.parse(`${s.check_in}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export function spans(j: AdvancedJourney, travellerIds?: string[]): Spans {
  const who = travellerIds ?? j.travellers.map((t) => t.id);
  const covers = (pax: string[]) => !who.length || paxIds(j, pax).some((id) => who.includes(id));
  const stays = j.stays.filter((s) => s.status !== "cancelled" && covers(s.pax));
  const included = stays.filter((s) => s.included);
  const dates: string[] = [];
  const ours: string[] = [];
  for (const s of j.segments) if (s.status !== "cancelled" && covers(s.pax)) dates.push(...[s.dep, s.arr].filter((x): x is string => !!x).map((x) => x.slice(0, 10)));
  for (const s of stays) dates.push(...[s.check_in, s.check_out].filter((x): x is string => !!x));
  for (const s of j.services) if (s.status !== "cancelled" && s.included && covers(s.pax) && s.at) ours.push(s.at.slice(0, 10));
  for (const s of included) ours.push(...[s.check_in, s.check_out].filter((x): x is string => !!x));
  dates.push(...ours);
  const range = (xs: string[]) => (xs.length ? { from: [...xs].sort()[0], to: [...xs].sort().at(-1)! } : { from: null, to: null });
  const inc = nightsSet(included);
  const ext = nightsSet(stays.filter((s) => !s.included));
  return {
    travel: range(dates),
    services: range(ours),
    includedNights: inc.size,
    roomNights: included.reduce((sum, s) => sum + (roomNights(s) ?? 0), 0),
    externalNights: [...ext].filter((d) => !inc.has(d)).length,
  };
}

// ---------- the client's words ----------

function moveWords(j: AdvancedJourney, s: Service): string {
  const from = placeOf(j, serviceFrom(j, s));
  const to = placeOf(j, s.to);
  const via = s.stops.map((x) => placeLabel(placeOf(j, x.place))).filter(Boolean);
  const viaText = via.length ? ` مروراً بـ${via.join("، ")}` : "";
  if (s.kind === "reception") return `استقبالكم من ${placeLabel(from)}${from?.meeting ? ` (${from.meeting})` : ""} ثم نقلكم إلى ${placeLabel(to)}${viaText}`;
  if (s.kind === "farewell") return `توديعكم من ${placeLabel(from)} إلى ${placeLabel(to)}${viaText}`;
  if (MOVING.has(s.kind)) return `نقلكم من ${placeLabel(from)} إلى ${placeLabel(to)}${viaText}`;
  return s.title || SERVICE_AR[s.kind];
}

export type ClientLines = { includes: string[]; excludes: string[]; pending: string[] };

/**
 * What the client document says about the route. «استقبال مطار» is written only
 * when the pickup place IS an airport — a hotel or border pickup says so.
 */
export function clientLines(j: AdvancedJourney): ClientLines {
  const out: ClientLines = { includes: [], excludes: [], pending: [] };
  const multi = j.groups.length > 1;
  const groupsToTell = multi ? j.groups : [{ id: "", name: "" }];
  for (const g of groupsToTell) {
    const who = g.id ? j.travellers.filter((t) => t.group === g.id).map((t) => t.id) : j.travellers.map((t) => t.id);
    const prefix = g.id ? `${g.name}: ` : "";
    const touches = (pax: string[]) => !who.length || paxIds(j, pax).some((id) => who.includes(id));
    type Row = { key: number; text: string; ours: boolean };
    const rows: Row[] = [];
    for (const s of j.services) {
      if (s.status === "cancelled" || !touches(s.pax) || !s.included || s.optional || s.paid_by !== "company") continue;
      const key = sortKey(s.at, placeOf(j, serviceFrom(j, s))?.tz) ?? Number.MAX_SAFE_INTEGER;
      rows.push({ key, text: `${moveWords(j, s)}${s.at ? ` — ${fmtWhen(s.at)}` : ""}`, ours: true });
    }
    for (const s of j.stays) {
      if (s.status === "cancelled" || !touches(s.pax)) continue;
      const tz = placeOf(j, s.place)?.tz;
      const key = sortKey(s.check_in ? `${s.check_in}T${s.check_in_time}` : null, tz) ?? Number.MAX_SAFE_INTEGER;
      const text = `الإقامة في ${placeLabel(placeOf(j, s.place))} من ${s.check_in ?? "؟"} إلى ${s.check_out ?? "؟"} (${stayNights(s) ?? "?"} ليالٍ)`;
      if (s.included) rows.push({ key, text, ours: true });
      else out.excludes.push(`${prefix}${text} — ${s.booked_by === "third_party" ? "بترتيب طرف ثالث" : "محجوزة من قبلكم"}، غير مشمولة`);
    }
    for (const s of j.segments) {
      if (s.status === "cancelled" || !touches(s.pax) || isOurSegment(s)) continue;
      const to = placeLabel(placeOf(j, s.to));
      const text =
        s.mode === "flight"
          ? `وصولكم إلى ${to} وفق تذكرتكم${s.ref ? ` (${s.ref})` : ""}`
          : `${MODE_AR[s.mode]} من ${placeLabel(placeOf(j, s.from))} إلى ${to}`;
      out.excludes.push(`${prefix}${text} — ${s.arranged_by === "third_party" ? "بترتيب طرف ثالث، خارج مسؤوليتنا" : "ترتيب ذاتي غير مشمول"}`);
    }
    rows.sort((a, b) => a.key - b.key);
    const ours = rows.filter((r) => r.ours);
    if (ours.length) {
      out.includes.push(`${prefix}تبدأ خدماتنا: ${ours[0].text}`);
      for (const r of ours.slice(1, -1)) out.includes.push(`${prefix}${r.text}`);
      if (ours.length > 1) out.includes.push(`${prefix}تنتهي خدماتنا: ${ours.at(-1)!.text}`);
    }
  }
  for (const i of checkJourney(j)) if (i.severity === "missing") out.pending.push(`بانتظار التأكيد: ${i.message}`);
  out.pending = [...new Set(out.pending)];
  return out;
}

// ---------- operations ----------

export type OpsLine = {
  id: string;
  when: string;
  kind: string;
  from: string;
  to: string;
  stops: string[];
  pax: string;
  operator: string;
  depends: string;
  meeting: string;
  notes: string;
  status: string;
  /** changed since operations last took the instructions. */
  changed: boolean;
};

export function opsLines(j: AdvancedJourney): OpsLine[] {
  const since = j.ops_issued_at ?? "";
  const nameOf = (id: string) => j.travellers.find((t) => t.id === id)?.name || id;
  return j.services
    .filter((s) => s.status !== "cancelled" && s.booked_by === "company")
    .map((s) => {
      const from = placeOf(j, serviceFrom(j, s));
      const seg = s.depends_on ? j.segments.find((g) => g.id === s.depends_on) : undefined;
      const pax = paxIds(j, s.pax);
      return {
        id: s.id,
        when: fmtWhen(s.at),
        kind: s.title || SERVICE_AR[s.kind],
        from: placeLabel(from),
        to: placeLabel(placeOf(j, s.to)),
        stops: s.stops.map((x) => `${placeLabel(placeOf(j, x.place))}${x.pick.length ? ` — ركوب ${x.pick.map(nameOf).join("، ")}` : ""}${x.drop.length ? ` — نزول ${x.drop.map(nameOf).join("، ")}` : ""}`),
        pax: `${pax.length} مسافر${pax.length && pax.length <= 6 ? `: ${pax.map(nameOf).join("، ")}` : ""}`,
        operator: s.operated_by || "لم يُحدد المنفذ",
        // landing and meeting are two different clocks
        depends: seg ? `يعتمد على ${MODE_AR[seg.mode]} ${seg.ref} — الهبوط ${fmtWhen(seg.arr)} / اللقاء ${fmtWhen(s.at)}` : "",
        meeting: from?.meeting ?? "",
        notes: s.notes,
        status: STATUS_AR[s.status],
        changed: !!since && j.log.some((e) => e.at > since && (e.id === s.id || (seg && e.id === seg.id) || e.id === from?.id || e.id === s.to)),
      };
    })
    .sort((a, b) => a.when.localeCompare(b.when));
}

// ---------- pricing ----------

/**
 * One line per service we charge for — ONCE, whatever number of segments or
 * travellers it covers. A stay that is a basic-screen hotel line is priced
 * there (hotel_ref), never twice.
 */
export function journeyPricingLines(j: AdvancedJourney | undefined): (DraftPricingItem & { source: "typed" | "none" })[] {
  if (!j?.enabled) return [];
  const out: (DraftPricingItem & { source: "typed" | "none" })[] = [];
  for (const s of j.services) {
    if (s.status === "cancelled" || !s.included || s.optional || s.paid_by !== "company") continue;
    out.push({
      item_type: MOVING.has(s.kind) ? "transport" : s.kind === "other" ? "other" : "service",
      description: s.title || `${SERVICE_AR[s.kind]}: ${placeLabel(placeOf(j, serviceFrom(j, s)))} ← ${placeLabel(placeOf(j, s.to))}`,
      ref: `journey:${s.id}`,
      quantity: 1,
      buy_price: s.price,
      buy_currency: s.currency || "SAR",
      sell_price: s.price,
      sell_currency: s.currency || "SAR",
      source: s.price == null ? "none" : "typed",
    });
  }
  for (const s of j.stays) {
    if (s.status === "cancelled" || !s.included || s.paid_by !== "company" || s.hotel_ref) continue;
    out.push({
      item_type: "hotel",
      description: `${placeLabel(placeOf(j, s.place))} — ${stayNights(s) ?? "?"} ليالٍ × ${s.rooms} غرفة`,
      ref: journeyStayRef(s.id),
      quantity: 1,
      buy_price: s.price,
      buy_currency: s.currency || "SAR",
      sell_price: s.price,
      sell_currency: s.currency || "SAR",
      source: s.price == null ? "none" : "typed",
    });
  }
  return out;
}

export function journeyStayRef(id: string): string {
  return `journey-stay:${id}`;
}

/** what the included services and stays of ours add up to, per currency — the change-impact figure. */
export function journeyCost(j: AdvancedJourney): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of journeyPricingLines({ ...j, enabled: true })) if (l.sell_price != null) out[l.sell_currency] = (out[l.sell_currency] ?? 0) + l.sell_price;
  return out;
}

// ---------- changes ----------

const TRACKED: Record<ChangeEntry["entity"], string[]> = {
  place: ["kind", "name", "country", "city", "side", "terminal", "address", "meeting", "tz"],
  segment: ["mode", "from", "to", "dep", "arr", "pax", "arranged_by", "status", "ref", "ticket", "service_id"],
  service: ["kind", "from", "to", "stops", "at", "depends_on", "use_arrival_airport", "pax", "operated_by", "paid_by", "included", "price", "currency", "status"],
  stay: ["place", "check_in", "check_out", "check_in_time", "check_out_time", "pax", "rooms", "included", "price", "status"],
  traveller: ["name", "group"],
};

function show(v: unknown): string {
  if (v == null || v === "") return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Field-level differences, previous → next. */
export function diffJourney(prev: AdvancedJourney | undefined, next: AdvancedJourney, by: string, at: string): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  const lists: [ChangeEntry["entity"], { id: string }[], { id: string }[]][] = [
    ["place", prev?.places ?? [], next.places],
    ["segment", prev?.segments ?? [], next.segments],
    ["service", prev?.services ?? [], next.services],
    ["stay", prev?.stays ?? [], next.stays],
    ["traveller", prev?.travellers ?? [], next.travellers],
  ];
  const label = (entity: ChangeEntry["entity"], x: Record<string, unknown>) =>
    entity === "place" ? placeLabel(x as Place) : entity === "segment" ? `${MODE_AR[(x as Segment).mode]} ${(x as Segment).ref}` : entity === "service" ? (x as Service).title || SERVICE_AR[(x as Service).kind] : entity === "stay" ? `إقامة ${(x as Stay).check_in ?? ""}` : (x as Traveller).name;
  for (const [entity, before, after] of lists) {
    for (const n of after as Record<string, unknown>[]) {
      const p = (before as Record<string, unknown>[]).find((x) => x.id === n.id);
      if (!p) {
        if (prev) out.push({ at, by, entity, id: String(n.id), label: label(entity, n), field: "إضافة", before: "—", after: label(entity, n) });
        continue;
      }
      for (const f of TRACKED[entity]) if (JSON.stringify(p[f] ?? null) !== JSON.stringify(n[f] ?? null)) out.push({ at, by, entity, id: String(n.id), label: label(entity, n), field: f, before: show(p[f]), after: show(n[f]) });
    }
    for (const p of before as Record<string, unknown>[])
      if (!(after as { id: string }[]).some((x) => x.id === p.id)) out.push({ at, by, entity, id: String(p.id), label: label(entity, p), field: "حذف", before: label(entity, p), after: "—" });
  }
  return out;
}

/** Services touched by a change: their own fields, the movement they wait for, a place they use. */
export function affectedServices(j: AdvancedJourney, changes: ChangeEntry[]): Service[] {
  const ids = new Set(changes.map((c) => c.id));
  const stayPlaces = new Set(j.stays.filter((s) => ids.has(s.id)).map((s) => s.place));
  return j.services.filter(
    (s) =>
      ids.has(s.id) ||
      (s.depends_on && ids.has(s.depends_on)) ||
      [serviceFrom(j, s), s.to, ...s.stops.map((x) => x.place)].some((p) => p && (ids.has(p) || stayPlaces.has(p))),
  );
}

/**
 * The server's half of an edit: log it with WHO made it, and put any CONFIRMED
 * service the edit touched back to «يحتاج مراجعة» — the route is re-checked by a
 * person, never rewritten silently. The browser's own `log` is ignored.
 * Consecutive edits of the same field by the same person within 10 minutes are
 * one entry (autosave sends a word at a time).
 */
export function withChangeLog(prev: AdvancedJourney | undefined, sent: AdvancedJourney, by: string, now: string): AdvancedJourney {
  const changes = diffJourney(prev, sent, by, now);
  const log = [...(prev?.log ?? [])];
  for (const c of changes) {
    const lastSame = log.slice(-20).reverse().find((e) => e.id === c.id && e.field === c.field);
    if (lastSame && lastSame.by === c.by && Date.parse(c.at) - Date.parse(lastSame.at) < 10 * 60_000) {
      lastSame.after = c.after;
      lastSame.at = c.at;
    } else log.push(c);
  }
  // a browser that was already showing the review flips has sent them; a stale one has not
  const { journey, hit } = reviewAffected(prev, sent);
  for (const id of hit) log.push({ at: now, by: "النظام", entity: "service", id, label: sent.services.find((s) => s.id === id)?.title || "خدمة", field: "status", before: "confirmed", after: "review" });
  return { ...journey, log: log.slice(-500), ops_issued_at: sent.ops_issued_at ?? prev?.ops_issued_at ?? null };
}

/**
 * Confirmed services an edit touched go back to «يحتاج مراجعة». Run by the
 * screen on every edit (so the agent sees it at once) and again by the server.
 */
export function reviewAffected(prev: AdvancedJourney | undefined, next: AdvancedJourney): { journey: AdvancedJourney; hit: Set<string> } {
  if (!prev) return { journey: next, hit: new Set() };
  const changes = diffJourney(prev, next, "", "");
  const own = new Set(["status", "price", "currency", "operated_by", "paid_by", "included", "booked_by"]);
  const external = changes.filter((c) => c.entity !== "service" || !own.has(c.field));
  const hit = new Set(
    affectedServices(next, external)
      .filter((s) => prev.services.find((p) => p.id === s.id)?.status === "confirmed" && s.status === "confirmed")
      // a confirmed service whose OWN status the agent just set is theirs
      .filter((s) => !changes.some((c) => c.id === s.id && c.field === "status"))
      .map((s) => s.id),
  );
  if (!hit.size) return { journey: next, hit };
  return { journey: { ...next, services: next.services.map((s) => (hit.has(s.id) ? { ...s, status: "review" as const } : s)) }, hit };
}

// ---------- shortcuts (records in the SAME structure — no separate system) ----------

/** reception from the airport a movement lands at, explicitly tied to it. */
export function addAirportReception(j: AdvancedJourney, segmentId: string, to: string | null, pax: string[] = []): AdvancedJourney {
  const seg = j.segments.find((s) => s.id === segmentId);
  const svc = newService({ kind: "reception", depends_on: segmentId, use_arrival_airport: true, from: seg?.to ?? null, to, pax: pax.length ? pax : seg?.pax ?? [] });
  return { ...j, services: [...j.services, svc] };
}

export function addPlaceReception(j: AdvancedJourney, from: string, to: string | null, pax: string[] = []): AdvancedJourney {
  return { ...j, services: [...j.services, newService({ kind: "reception", from, to, pax })] };
}

/** the client makes their own way: a known self movement, possibly with no details. */
export function addSelfArrival(j: AdvancedJourney, from: string, to: string, pax: string[] = []): AdvancedJourney {
  return { ...j, segments: [...j.segments, newSegment({ mode: "self", from, to, pax, arranged_by: "client", details_unknown: true })] };
}

/** ONE car across: the border is a stop on the same service; whether the car may cross is a check, not an assumption. */
export function addBorderTransferOneDriver(j: AdvancedJourney, from: string, border: string, to: string, pax: string[] = []): AdvancedJourney {
  return { ...j, services: [...j.services, newService({ kind: "transfer", from, to, pax, stops: [{ place: border, pick: [], drop: [] }], status: "feasibility", notes: "تحقق: هل يسمح للسيارة والسائق بالعبور؟ وهل المعبر متاح لهؤلاء المسافرين؟" })] };
}

/** two drivers, a crossing between them: drive to side A, cross (self), drive from side B. */
export function addBorderTransferTwoDrivers(j: AdvancedJourney, from: string, sideA: string, sideB: string, to: string, pax: string[] = []): AdvancedJourney {
  const first = newService({ kind: "transfer", from, to: sideA, pax, title: "نقل إلى المعبر" });
  const crossing = newSegment({ mode: "border", from: sideA, to: sideB, pax, arranged_by: "client", notes: "عبور ذاتي بين السائقين" });
  const second = newService({ kind: "transfer", from: sideB, to, pax, title: "نقل من المعبر", depends_on: crossing.id });
  return { ...j, services: [...j.services, first, second], segments: [...j.segments, crossing] };
}

/** one reception per arriving movement, each for exactly the people on it. */
export function addGroupArrivalReceptions(j: AdvancedJourney, to: string | null): AdvancedJourney {
  const arrivals = j.segments.filter((s) => s.mode === "flight" && s.status !== "cancelled" && !j.services.some((v) => v.depends_on === s.id));
  // only the LAST movement of each traveller chain into the area is met — a transit leg is not a pickup
  const lastLegs = arrivals.filter((s) => !arrivals.some((n) => n !== s && n.from === s.to && paxIds(j, n.pax).some((p) => paxIds(j, s.pax).includes(p))));
  return lastLegs.reduce((acc, s) => addAirportReception(acc, s.id, to, s.pax), j);
}

// ---------- legacy files ----------

/**
 * Seeds a journey from a basic file. Only what is EXPLICIT moves: flights become
 * information segments, hotels become stays priced by their own lines. An
 * airport is NOT assumed to be the reception point — a sold airport transfer
 * comes across as a reception marked «يحتاج مراجعة».
 */
export function journeyFromDraft(data: DraftData, lookups?: Pick<GeneratorLookups, "airports" | "countries">): AdvancedJourney {
  const j = emptyJourney();
  j.enabled = true;
  j.main_country = data.trip.country;
  const group: TravelGroup = { id: newId("gr"), name: "المجموعة" };
  j.groups = [group];
  const kinds: [TravellerKind, number][] = [["adult", data.trip.adults], ["child", data.trip.children], ["infant", data.trip.infants]];
  const word: Record<TravellerKind, string> = { adult: "بالغ", child: "طفل", infant: "رضيع" };
  for (const [kind, n] of kinds)
    for (let i = 1; i <= n; i++)
      j.travellers.push({ id: newId("tr"), name: i === 1 && kind === "adult" && data.customer.customer_name ? data.customer.customer_name : `${word[kind]} ${i}`, kind, group: group.id });
  const countryTz = (name: string) => lookups?.countries.find((c) => c.name === name)?.timezone ?? null;
  const airport = (code: string): string => {
    const hit = j.places.find((p) => p.kind === "airport" && p.terminal === "" && (p.name === code || p.address === code));
    if (hit) return hit.id;
    const a = lookups?.airports.find((x) => x.code === code || x.name === code);
    const p = newPlace({ kind: "airport", name: a?.name ?? code, address: code, country: a?.country ?? "", city: a?.city ?? "", tz: a?.timezone ?? null });
    j.places.push(p);
    return p.id;
  };
  for (const f of data.flights) {
    if (!f.from_airport || !f.to_airport) continue;
    j.segments.push(
      newSegment({
        mode: "flight",
        from: airport(f.from_airport),
        to: airport(f.to_airport),
        dep: f.departure_at,
        arr: f.arrival_at,
        ref: [f.airline_iata, f.flight_no].filter(Boolean).join(" "),
        operated_by: f.airline,
        arranged_by: (f.leg_order === "internal" ? data.scope.flights_domestic : data.scope.flights_intl) ? "company" : "client",
        status: f.flight_no ? "confirmed" : "tentative",
      }),
    );
  }
  for (const h of data.hotels) {
    const city = data.cities.find((c) => c.city_name === h.city_name);
    const p = newPlace({ kind: h.hotel_name ? "hotel" : "tbd", name: h.hotel_name, city: h.city_name, country: city?.country || data.trip.country, tz: countryTz(city?.country || data.trip.country) });
    j.places.push(p);
    j.stays.push(newStay({ place: p.id, check_in: city?.check_in ?? null, check_out: city?.check_out ?? null, rooms: Math.max(h.rooms.length, 1), hotel_ref: h.id, status: "tentative" }));
  }
  if (data.scope.transport && data.transport_plan.airport.enabled) {
    const landing = j.segments.find((s) => s.mode === "flight" && data.flights.find((f) => f.leg_order === "outbound" && airport(f.to_airport) === s.to));
    j.services.push(
      newService({
        kind: "reception",
        depends_on: landing?.id ?? null,
        from: landing?.to ?? null,
        to: j.stays[0]?.place ?? null,
        status: "review",
        notes: "مُرحّل من الملف الأساسي: تأكد من نقطة الاستقبال الفعلية قبل الاعتماد",
      }),
    );
  }
  return j;
}
