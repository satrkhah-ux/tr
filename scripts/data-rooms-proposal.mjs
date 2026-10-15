/**
 * Order 4 — room types: a category each, re-attached to their hotels, and the
 * rows that are not rooms at all. READ ONLY → data-import/data-rooms-proposal.json.
 *
 *   node scripts/data-rooms-proposal.mjs [--extracted data-import/extracted]
 *
 * The legacy hotel ↔ room pairs come from the old system's dump, extracted
 * first (it never touches the database):
 *
 *   node scripts/legacy-extract-reference.mjs [data-import/traveliun-legacy.sql]
 *     → data-import/extracted/rooms_types.json (+ rooms.json)
 *
 * The old `rooms_types` table holds one row per hotel-room combination; the
 * import kept only the distinct NAMES as global rows (hotel_id null), so no
 * hotel knows its own rooms. Here each (hotel, room name) pair the old system
 * had becomes a proposed hotel-bound copy — the global row stays, offers point
 * at it.
 *
 * Sections, each item with `ok` (true = the apply does it):
 *   categories  classifyRoom(name) for rows with none            ok: true
 *   reattach    a hotel-bound copy per legacy (hotel, room) pair  ok: true when ≤ 3 hotels had the name
 *   non_rooms   codes, joined rooms, hotel names                  ok: false (a person decides; used rows never go)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { arg, hasColumn, propose } from "./data-model-lib.mjs";
import { classifyRoom, nonRoomReason } from "../src/lib/catalog/model.ts";
import { looksLikeHotel, normAr } from "../src/lib/catalog/norm.ts";

const dir = arg("extracted", "data-import/extracted");
const load = (name) => (existsSync(join(dir, `${name}.json`)) ? JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) : null);
/** Hotel-specific names are shared by a handful of hotels at most; above this a name is generic. */
const SPECIFIC_MAX = 3;

await propose("rooms", async (q) => {
  const withCategory = await hasColumn(q, "room_types", "category");
  const rooms = await q(`select id, arabic_name, english_name, hotel_id${withCategory ? ", category" : ", null as category"} from public.room_types`);
  const hotels = new Map((await q("select id, arabic_name from public.hotels")).map((h) => [h.id, h.arabic_name]));

  // ---- where a room type is used (by id: offers and drafts; by name nothing breaks) ----
  const used = new Map();
  for (const r of await q("select room_type_id, count(*)::int n from public.offer_hotels where room_type_id is not null group by 1")) used.set(r.room_type_id, r.n);
  for (const d of await q("select data from public.offer_drafts")) {
    for (const h of d.data?.hotels ?? []) {
      for (const id of [h.room_type_id, ...(h.rooms ?? []).map((r) => r?.room_type_id)]) if (id) used.set(id, (used.get(id) ?? 0) + 1);
    }
  }

  // ---- 1. categories ----
  const categories = [];
  const unclassified = [];
  for (const r of rooms) {
    if (r.category) continue;
    const category = classifyRoom(r.arabic_name, r.english_name);
    if (category) categories.push({ id: r.id, name: r.arabic_name, english: r.english_name, hotel: hotels.get(r.hotel_id) ?? null, category, ok: true });
    else unclassified.push({ id: r.id, name: r.arabic_name, english: r.english_name });
  }

  // ---- 2. non-rooms ----
  const non_rooms = rooms.flatMap((r) => {
    const reason = nonRoomReason(r.arabic_name) ?? (!classifyRoom(r.arabic_name, r.english_name) && looksLikeHotel(r.arabic_name) ? "hotel" : null);
    return reason ? [{ id: r.id, name: r.arabic_name, english: r.english_name, reason, used: used.get(r.id) ?? 0, ok: false }] : [];
  });

  // ---- 3. re-attach from the legacy dump ----
  const notes = [];
  const reattach = [];
  const legacyTypes = load("rooms_types");
  const legacyRooms = load("rooms");
  // which file pairs a hotel with a room name, and under which columns
  let pairs = [];
  if (legacyTypes?.[0] && "hotel_id" in legacyTypes[0]) {
    pairs = legacyTypes.map((r) => ({ hotel: r.hotel_id, name: r.arabic_name, english: r.english_name }));
  } else if (legacyRooms?.[0] && "hotel_id" in legacyRooms[0]) {
    const typeCol = ["room_type_id", "rooms_type_id", "type_id"].find((c) => c in legacyRooms[0]);
    const typeById = new Map((legacyTypes ?? []).map((t) => [t.id, t]));
    if (typeCol) pairs = legacyRooms.map((r) => ({ hotel: r.hotel_id, name: typeById.get(r[typeCol])?.arabic_name, english: typeById.get(r[typeCol])?.english_name }));
  }
  if (!legacyTypes) notes.push(`no ${dir}/rooms_types.json — run scripts/legacy-extract-reference.mjs first; re-attach skipped`);
  else if (pairs.length === 0) notes.push(`legacy rooms carry no hotel column (rooms_types columns: ${Object.keys(legacyTypes[0] ?? {}).join(", ")}); re-attach skipped`);

  if (pairs.length > 0) {
    const hotelOf = new Map((await q("select legacy_id, new_id from public.legacy_id_map where entity = 'hotel' and source = 'app'")).map((m) => [Number(m.legacy_id), m.new_id]));
    const own = new Set(rooms.filter((r) => r.hotel_id).map((r) => `${r.hotel_id}|${normAr(r.arabic_name)}`));
    const byName = new Map(); // folded name → { name, english, hotels:Set }
    for (const p of pairs) {
      const name = String(p.name ?? "").replace(/\s+/g, " ").trim();
      const hotel = hotelOf.get(Number(p.hotel));
      if (!name || !hotel || !hotels.has(hotel)) continue;
      const key = normAr(name);
      const entry = byName.get(key) ?? { name, english: p.english ? String(p.english).trim() || null : null, hotels: new Set() };
      entry.hotels.add(hotel);
      byName.set(key, entry);
    }
    for (const [key, entry] of byName) {
      if (nonRoomReason(entry.name)) continue; // a code is not copied anywhere
      for (const hotel of entry.hotels) {
        if (own.has(`${hotel}|${key}`)) continue;
        reattach.push({
          hotel_id: hotel,
          hotel: hotels.get(hotel),
          name: entry.name,
          english: entry.english,
          category: classifyRoom(entry.name, entry.english),
          hotels_with_name: entry.hotels.size,
          ok: entry.hotels.size <= SPECIFIC_MAX,
        });
      }
    }
  }

  console.log(
    `categories ${categories.length} (unclassified ${unclassified.length}), non-rooms ${non_rooms.length} (${non_rooms.filter((n) => n.used).length} used), re-attach ${reattach.length} (${reattach.filter((r) => r.ok).length} ok)`,
  );
  for (const n of notes) console.log("note:", n);
  return { notes, categories, unclassified, non_rooms, reattach };
});
