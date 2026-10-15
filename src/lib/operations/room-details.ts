/**
 * A hotel booking's rooms as the hotel confirmed them («تفاصيل الغرفة», room
 * catalogue 2026-10-15) and as the voucher prints them.
 *
 * Stored in operation_bookings.detail[ROOM_SPEC_KEY] as JSON text:
 *   { locale: "auto" | "ar" | "en", rooms: { "الغرفة" | "الغرفة 2" | "نوع الغرفة": spec } }
 * one spec per room line, so a stay booking a double and a twin describes each.
 * The pull seeds the type and category (the offer's codes, else read from the
 * old name); operations adds the rest once the hotel is confirmed, never before.
 *
 * Pure: no React, no Supabase.
 */
import catalog from "@/lib/catalog/hotel-room-catalog.json";
import { BOARD_AR } from "@/components/offer-doc/labels";
import {
  bedsText,
  catalogLabel,
  classifyRoomName,
  exportLocale,
  hotelNameFor,
  roomIssues,
  roomName,
  type BedStatus,
  type LocaleChoice,
  type NameStatus,
  type RoomIssue,
  type RoomLocale,
  type RoomSpec,
} from "@/lib/catalog/room-catalog";
import { toEnglish } from "./supplier-request";
import { ROOM_SPEC_KEY, shownDetail } from "./voucher-dto";

export type ConnectingStatus = "confirmed" | "on_request" | "not_applicable";
export type BookingRoomSpec = RoomSpec & { connecting_status?: ConnectingStatus };
export type BookingRooms = { locale: LocaleChoice; rooms: Record<string, BookingRoomSpec> };
type Detail = Record<string, string> | null | undefined;

/** «الغرفة», «الغرفة 2» (the pull, «إضافة حجز») and «نوع الغرفة» (the older pull). */
export const ROOM_LINE = /^(الغرفة( \d+)?|نوع الغرفة)$/;

/** The room lines a booking has — «الغرفة» when it names none yet (saving writes it). */
export function roomLines(detail: Detail): string[] {
  const lines = Object.keys(shownDetail(detail)).filter((k) => ROOM_LINE.test(k));
  return lines.length > 0 ? lines : ["الغرفة"];
}

/** The owner: «اجعلها تظهر بعد تأكيد الفندق» — a confirmed hotel only. */
export const roomDetailsOpen = (b: { kind: string; status: string }) => b.kind === "hotel" && b.status === "confirmed";

export function readRooms(detail: Detail): BookingRooms {
  try {
    const raw = JSON.parse(detail?.[ROOM_SPEC_KEY] ?? "") as Partial<BookingRooms> | null;
    const locale = raw?.locale === "ar" || raw?.locale === "en" ? raw.locale : "auto";
    return { locale, rooms: raw?.rooms && typeof raw.rooms === "object" ? raw.rooms : {} };
  } catch {
    return { locale: "auto", rooms: {} };
  }
}

export const roomsJson = (rooms: Record<string, BookingRoomSpec>, locale: LocaleChoice = "auto") => JSON.stringify({ locale, rooms });

// ---------- the room line's text: «ديلوكس × 2 — شامل الإفطار» ----------

/** The room, its «× n» and its board, apart — so a new name keeps the other two. */
export function splitRoomText(text: string): { room: string; multiplier: string; board: string } {
  let rest = text.trim();
  let board = "";
  for (const b of Object.values(BOARD_AR)) {
    if (rest.endsWith(` — ${b}`)) {
      board = b;
      rest = rest.slice(0, -(b.length + 3)).trim();
      break;
    }
  }
  const multiplier = rest.match(/×\s*\d+$/)?.[0] ?? "";
  return { room: rest.slice(0, rest.length - multiplier.length).trim(), multiplier, board };
}

const joinRoomText = (room: string, multiplier: string, board: string) => [[room, multiplier].filter(Boolean).join(" "), board].filter(Boolean).join(" — ");

/** What the line reads once details are saved: the catalogue's Arabic name, keeping the count and the board. */
export function roomLineText(old: string, spec: BookingRoomSpec): string {
  const name = roomName(spec, "ar").name;
  if (!name) return old;
  const { multiplier, board } = splitRoomText(old);
  return joinRoomText(name, multiplier, board);
}

// ---------- seeding and the editor's starting point ----------

/** A draft room as the offer side writes it (the codes are its; older drafts have only the name). */
export type SeedRoom = { room_type_name: string; room_type_code?: string | null; room_category_code?: string | null; suite_subtype_code?: string | null };

/** The offer's own codes; else the old name read into a type and category; null when it names no type. */
export function seededSpec(room: SeedRoom): BookingRoomSpec | null {
  const type = room.room_type_code?.trim();
  if (type) {
    return { room_type_id: type, room_category_id: room.room_category_code || null, suite_subtype_id: type === "suite" ? room.suite_subtype_code || null : null };
  }
  const read = classifyRoomName(splitRoomText(room.room_type_name).room);
  return read.room_type_id ? read : null;
}

/** What the editor opens on: the saved spec, else what the line's text says. */
export function roomSpecFor(detail: Detail, line: string): BookingRoomSpec {
  return readRooms(detail).rooms[line] ?? classifyRoomName(splitRoomText(detail?.[line] ?? "").room);
}

// ---------- validation ----------

export type RoomDetailIssue = RoomIssue | "room_type" | "connecting";

/** The file's rules (roomIssues), its required type, and its connecting rule. */
export function roomDetailIssues(spec: BookingRoomSpec): RoomDetailIssue[] {
  const out: RoomDetailIssue[] = roomIssues(spec);
  if (!spec.room_type_id) out.push("room_type");
  if (spec.feature_ids?.includes("connecting") && spec.connecting_status !== "confirmed" && spec.connecting_status !== "on_request") out.push("connecting");
  return out;
}

const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x !== ""))] : []);
const id = (v: unknown) => (typeof v === "string" && v ? v : null);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const status = (name: string, v: unknown): NameStatus => (!name ? "missing" : v === "verified" ? "verified" : "draft");

/** A spec from the browser, reduced to the catalogue's fields and types — the server stores nothing else. */
export function cleanSpec(raw: unknown): BookingRoomSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const groups = (Array.isArray(r.bed_groups) ? r.bed_groups : []).flatMap((g: { id?: unknown; beds?: unknown }) =>
    g && id(g.id) && Array.isArray(g.beds)
      ? [{ id: id(g.id)!, beds: (g.beds as { bed_type_id?: unknown; quantity?: unknown }[]).flatMap((b) => (b && id(b.bed_type_id) ? [{ bed_type_id: id(b.bed_type_id)!, quantity: Number(b.quantity) }] : [])) }]
      : [],
  );
  const custom = (r.custom_room_name ?? {}) as Record<string, unknown>;
  const names = { ar: text(custom.ar), en: text(custom.en) };
  const statuses = (r.custom_name_status ?? {}) as Record<string, unknown>;
  const bed = ["guaranteed", "on_request", "unspecified"].includes(r.bed_configuration_status as string) ? (r.bed_configuration_status as BedStatus) : "unspecified";
  const connecting = r.connecting_status === "confirmed" || r.connecting_status === "on_request" ? r.connecting_status : "not_applicable";
  return {
    room_type_id: id(r.room_type_id),
    room_category_id: id(r.room_category_id),
    suite_subtype_id: id(r.suite_subtype_id),
    bedroom_count: count(r.bedroom_count),
    bed_groups: groups,
    selected_bed_group_id: id(r.selected_bed_group_id),
    bed_configuration_status: bed,
    view_ids: ids(r.view_ids),
    feature_ids: ids(r.feature_ids),
    max_guests: count(r.max_guests),
    max_adults: count(r.max_adults),
    max_children: count(r.max_children),
    ...(names.ar || names.en
      ? { custom_room_name: { ar: names.ar || null, en: names.en || null }, custom_name_status: { ar: status(names.ar, statuses.ar), en: status(names.en, statuses.en) } }
      : {}),
    connecting_status: connecting,
  };
}

/**
 * The booking's detail with the editor's rooms saved — null when a room line is
 * not the booking's or a room breaks a rule. Each line is rewritten in the
 * catalogue's Arabic, which is what the client's programme prints.
 */
export function applyRoomDetails(detail: Record<string, string>, rooms: Record<string, unknown>, locale: unknown): Record<string, string> | null {
  const lines = roomLines(detail);
  const saved = { ...readRooms(detail).rooms };
  const out = { ...detail };
  for (const [line, raw] of Object.entries(rooms)) {
    const spec = cleanSpec(raw);
    if (!lines.includes(line) || roomDetailIssues(spec).length > 0) return null;
    saved[line] = spec;
    out[line] = roomLineText(detail[line] ?? "", spec);
  }
  out[ROOM_SPEC_KEY] = roomsJson(saved, locale === "ar" || locale === "en" ? locale : "auto");
  return out;
}

// ---------- the voucher ----------

const RULES = catalog.room_name_export;
const CONNECTING: Record<"confirmed" | "on_request", Record<RoomLocale, string>> = {
  confirmed: { ar: "مؤكدة", en: "Confirmed" },
  on_request: RULES.bed_status_suffix.on_request,
};

/** The export contract's notes: the beds when a custom name hides them, and the connecting rooms' state. */
export function roomNotes(spec: BookingRoomSpec, locale: RoomLocale): string[] {
  const out: string[] = [];
  const custom = spec.custom_room_name;
  const beds = custom && (custom.ar?.trim() || custom.en?.trim()) ? bedsText(spec, locale) : null;
  if (beds) out.push(`${RULES.field_labels[locale].beds}: ${beds}`);
  if (spec.feature_ids?.includes("connecting") && (spec.connecting_status === "confirmed" || spec.connecting_status === "on_request")) {
    out.push(`${catalogLabel("features", "connecting", locale)}: ${CONNECTING[spec.connecting_status][locale]}`);
  }
  return out;
}

/** The hotel as the catalogue has it — its names and its country (ISO-2). Null: not in /hotels. */
export type StayHotel = { ar: string | null; en: string | null; country: string | null };
export type StayError = "hotelUnknown" | "hotelName" | "roomName" | "roomInvalid";
export type VoucherStay =
  | { ok: true; locale: RoomLocale; title: string; alt_name: string | null; city_name: string; detail: Record<string, string>; notes: string[] }
  | { ok: false; error: StayError; locale: RoomLocale };

/**
 * One stay on a hotel voucher, in its own language: the booking's choice, then
 * the hotel country's (the file's destination policy), then English. The hotel
 * and the rooms are named in it or the voucher is refused — an English voucher
 * never falls back to Arabic in silence. A line without details keeps its old
 * text (older bookings); other values go through the supplier request's
 * English (boards, «2 بالغ», the city from `glossary`).
 */
export function voucherStay(
  b: { title: string; city_name: string; detail: Record<string, string> },
  hotel: StayHotel | null,
  glossary: Record<string, string> = {},
): VoucherStay {
  const { locale: stay, rooms } = readRooms(b.detail);
  const locale = exportLocale({ stay, countryCode: hotel?.country });
  const names = { ar: hotel?.ar ?? b.title, en: hotel?.en ?? null };
  const name = hotelNameFor(names, locale);
  if (!name.name) return { ok: false, error: hotel ? "hotelName" : "hotelUnknown", locale };
  const other = hotelNameFor(names, locale === "en" ? "ar" : "en").name;
  const say = (v: string) => (locale === "en" ? toEnglish(v, glossary) : v);

  const shown = shownDetail(b.detail);
  const lines = Object.keys(shown).filter((k) => ROOM_LINE.test(k));
  const detail: Record<string, string> = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(shown)) {
    const spec = lines.includes(k) ? rooms[k] : undefined;
    if (!spec) {
      detail[k] = say(v);
      continue;
    }
    if (roomDetailIssues(spec).length > 0) return { ok: false, error: "roomInvalid", locale };
    const room = roomName(spec, locale);
    if (room.error || !room.name) return { ok: false, error: "roomName", locale };
    const { multiplier, board } = splitRoomText(v);
    detail[k] = joinRoomText(room.name, multiplier, say(board));
    const which = lines.length > 1 ? `${locale === "en" ? k.replace(/^نوع الغرفة$/, "Room type").replace(/^الغرفة/, "Room") : k} — ` : "";
    notes.push(...roomNotes(spec, locale).map((n) => which + n));
  }
  return { ok: true, locale, title: name.name, alt_name: other && other !== name.name ? other : null, city_name: say(b.city_name), detail, notes };
}
