/**
 * Apply the owner's catalogue decisions (scripts/catalog-decisions-plan.mjs →
 * data-import/catalog-decisions-plan.json) — the same merge / rename / draft
 * repointing as round 4 (catalog-cleanup-2026-10-13.mjs), with nothing held
 * back: the owner already decided every item in the plan. Plus the deletions he
 * approved (placeholder hotels, non-room room types), each only if nothing uses it.
 *
 *   node scripts/catalog-decisions-apply.mjs            dry run (rolls back)
 *   node scripts/catalog-decisions-apply.mjs --commit   backup, then apply
 *
 * One transaction: any error and nothing changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const plan = JSON.parse(readFileSync("data-import/catalog-decisions-plan.json", "utf8"));

// the owner decided each of these — nothing is held back
const hotelMerges = plan.hotel_merges;
const hotelRenames = plan.hotel_renames;
const deletions = plan.deletions ?? { hotels: [], room_types: [] };

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const q = (sql, args = []) => client.query(sql, args);

const log = [];
const roomMap = new Map(); // dropped room type → the one kept
const hotelMap = new Map(); // dropped hotel → the one kept

try {
  // ---- the backup: every row this can touch ----
  const allHotelIds = [
    ...hotelMerges.flatMap((m) => [m.keep_id, ...m.drop_ids]),
    ...plan.hotel_moves.map((m) => m.id),
    ...hotelRenames.map((r) => r.id),
    ...plan.hotel_english_fixes.map((r) => r.id),
    ...deletions.hotels,
  ];
  const allRoomIds = [
    ...plan.room_type_merges.flatMap((m) => [m.keep_id, ...m.drop_ids]),
    ...plan.room_type_renames.map((r) => r.id),
    ...deletions.room_types,
  ];
  const backup = {
    hotels: (await q("select * from public.hotels where id = any($1)", [allHotelIds])).rows,
    room_types: (await q("select * from public.room_types where id = any($1) or hotel_id = any($2)", [allRoomIds, allHotelIds])).rows,
    offer_hotels: (await q("select id, hotel_id, room_type_id from public.offer_hotels where hotel_id = any($1) or room_type_id = any($2)", [allHotelIds, allRoomIds])).rows,
    hotel_rate_memory: (await q("select * from public.hotel_rate_memory where hotel_id = any($1)", [allHotelIds])).rows,
    hotel_content_cache: (await q("select id, internal_hotel_id from public.hotel_content_cache where internal_hotel_id = any($1)", [allHotelIds])).rows,
    legacy_id_map: (await q("select * from public.legacy_id_map where new_id = any($1)", [[...allHotelIds, ...allRoomIds]])).rows,
    offer_drafts: (await q("select id, data from public.offer_drafts")).rows,
  };

  await q("begin");

  // ---- room types: merge the duplicates, then fix the spellings ----
  for (const m of plan.room_type_merges) {
    for (const d of m.drop_ids) roomMap.set(d, m.keep_id);
    await q("update public.offer_hotels set room_type_id = $1 where room_type_id = any($2)", [m.keep_id, m.drop_ids]);
    await q("update public.legacy_id_map set new_id = $1 where entity = 'room_type' and new_id = any($2)", [m.keep_id, m.drop_ids]);
    await q("delete from public.room_types where id = any($1)", [m.drop_ids]);
    await q("update public.room_types set arabic_name = $2, english_name = coalesce($3, english_name) where id = $1", [m.keep_id, m.final, m.final_english ?? null]);
    log.push({ kind: "room-merge", keep: m.keep_id, drop: m.drop_ids.length, final: m.final });
  }
  for (const r of plan.room_type_renames) {
    if (roomMap.has(r.id)) continue;
    await q("update public.room_types set arabic_name = $2, english_name = coalesce($3, english_name) where id = $1", [r.id, r.to, r.english_to ?? null]);
    log.push({ kind: "room-rename", from: r.from, to: r.to });
  }

  // ---- hotels: merge (references first), move, rename ----
  for (const m of hotelMerges) {
    for (const d of m.drop_ids) {
      hotelMap.set(d, m.keep_id);
      await q("update public.offer_hotels set hotel_id = $1 where hotel_id = $2", [m.keep_id, d]);
      await q("update public.hotel_content_cache set internal_hotel_id = $1 where internal_hotel_id = $2", [m.keep_id, d]);
      await q("update public.legacy_id_map set new_id = $1 where entity = 'hotel' and new_id = $2", [m.keep_id, d]);
      // a remembered price the kept hotel already has for the same room and board wins
      await q(
        `delete from public.hotel_rate_memory r where r.hotel_id = $2 and exists (
           select 1 from public.hotel_rate_memory k where k.hotel_id = $1 and k.room_type_name = r.room_type_name
             and coalesce(k.board_type, '') = coalesce(r.board_type, ''))`,
        [m.keep_id, d],
      );
      await q("update public.hotel_rate_memory set hotel_id = $1 where hotel_id = $2", [m.keep_id, d]);
      // its room types join the kept hotel's — a name it already has becomes that one
      const rooms = (await q("select id, arabic_name from public.room_types where hotel_id = $1", [d])).rows;
      for (const rt of rooms) {
        const twin = (
          await q("select id from public.room_types where hotel_id = $1 and catalog_norm(arabic_name) = catalog_norm($2) limit 1", [m.keep_id, rt.arabic_name])
        ).rows[0];
        if (twin) {
          roomMap.set(rt.id, twin.id);
          await q("update public.offer_hotels set room_type_id = $1 where room_type_id = $2", [twin.id, rt.id]);
          await q("update public.legacy_id_map set new_id = $1 where entity = 'room_type' and new_id = $2", [twin.id, rt.id]);
          await q("delete from public.room_types where id = $1", [rt.id]);
        } else {
          await q("update public.room_types set hotel_id = $1 where id = $2", [m.keep_id, rt.id]);
        }
      }
    }
    await q("delete from public.hotels where id = any($1)", [m.drop_ids]);
    await q("update public.hotels set arabic_name = coalesce($2, arabic_name), english_name = coalesce($3, english_name) where id = $1", [
      m.keep_id,
      m.final_arabic ?? null,
      m.final_english ?? null,
    ]);
    log.push({ kind: "hotel-merge", keep: m.final_arabic, drop: m.drop_ids.length });
  }
  for (const mv of plan.hotel_moves) {
    if (hotelMap.has(mv.id)) continue;
    await q("update public.hotels set city_id = $2 where id = $1", [mv.id, mv.to_city_id]);
    log.push({ kind: "hotel-move", name: mv.name, to: mv.to_city });
  }
  for (const r of hotelRenames) {
    if (hotelMap.has(r.id)) continue;
    await q("update public.hotels set arabic_name = $2, english_name = case when $3::boolean then $4 else english_name end where id = $1", [
      r.id,
      r.to,
      r.english_to !== undefined,
      r.english_to ?? null,
    ]);
    log.push({ kind: "hotel-rename", from: r.from, to: r.to });
  }
  for (const r of plan.hotel_english_fixes) {
    if (hotelMap.has(r.id)) continue;
    await q("update public.hotels set english_name = $2 where id = $1", [r.id, r.to ?? null]);
    log.push({ kind: "hotel-english", name: r.arabic_name, from: r.from, to: r.to });
  }

  // ---- the clear generic rooms every client understands ----
  for (const g of plan.generic_rooms.missing ?? []) {
    if (g.covered_by_proposal) continue;
    const has = (await q("select 1 from public.room_types where hotel_id is null and catalog_norm(arabic_name) = catalog_norm($1)", [g.name])).rows[0];
    if (!has) {
      await q("insert into public.room_types (arabic_name, english_name, hotel_id) values ($1, $2, null)", [g.name, g.english ?? null]);
      log.push({ kind: "room-add", name: g.name });
    }
  }

  // ---- the owner's deletions: only what no offer, price memory or draft uses ----
  const draftText = JSON.stringify(backup.offer_drafts.map((d) => d.data));
  for (const id of deletions.hotels) {
    if (hotelMap.has(id)) continue;
    const used = (await q("select (select count(*) from public.offer_hotels where hotel_id = $1) + (select count(*) from public.hotel_rate_memory where hotel_id = $1) n", [id])).rows[0];
    if (Number(used.n) > 0 || draftText.includes(id)) {
      log.push({ kind: "delete-skipped", id, why: "in use" });
      continue;
    }
    await q("delete from public.room_types where hotel_id = $1 and not exists (select 1 from public.offer_hotels o where o.room_type_id = room_types.id)", [id]);
    await q("delete from public.hotels where id = $1", [id]);
    log.push({ kind: "hotel-delete", id });
  }
  for (const id of deletions.room_types) {
    const used = (await q("select count(*)::int n from public.offer_hotels where room_type_id = $1", [id])).rows[0];
    if (used.n > 0 || draftText.includes(id)) {
      log.push({ kind: "delete-skipped", id, why: "in use" });
      continue;
    }
    await q("delete from public.room_types where id = $1", [id]);
    log.push({ kind: "room-delete", id });
  }

  // ---- drafts: a hotel or a room type that went points at the one kept ----
  let draftsTouched = 0;
  for (const d of backup.offer_drafts) {
    const data = d.data ?? {};
    let changed = false;
    const hotels = (data.hotels ?? []).map((h) => {
      const next = { ...h };
      if (h.hotel_id && hotelMap.has(h.hotel_id)) (next.hotel_id = hotelMap.get(h.hotel_id)), (changed = true);
      if (h.room_type_id && roomMap.has(h.room_type_id)) (next.room_type_id = roomMap.get(h.room_type_id)), (changed = true);
      if (Array.isArray(h.rooms)) {
        next.rooms = h.rooms.map((r) => {
          if (r?.room_type_id && roomMap.has(r.room_type_id)) {
            changed = true;
            return { ...r, room_type_id: roomMap.get(r.room_type_id) };
          }
          return r;
        });
      }
      return next;
    });
    if (changed) {
      await q("update public.offer_drafts set data = $2 where id = $1", [d.id, { ...data, hotels }]);
      draftsTouched += 1;
    }
  }

  const count = (kind) => log.filter((l) => l.kind === kind).length;
  console.log(
    `room merges ${count("room-merge")}, room renames ${count("room-rename")}, hotel merges ${count("hotel-merge")} (${hotelMap.size} rows gone), moves ${count("hotel-move")}, renames ${count("hotel-rename")}, english fixes ${count("hotel-english")}, generic rooms added ${count("room-add")}, drafts repointed ${draftsTouched}`,
  );
  const after = (await q("select (select count(*)::int from public.hotels) hotels, (select count(*)::int from public.room_types) rooms")).rows[0];
  console.log("after:", after);
  console.log(`deleted: ${count("hotel-delete")} hotels, ${count("room-delete")} room types; skipped (in use): ${count("delete-skipped")}; for a person: ${(plan.manual ?? []).length}`);

  if (!COMMIT) {
    await q("rollback");
    console.log("\ndry run — rolled back; pass --commit to apply");
  } else {
    mkdirSync("data-import/backups", { recursive: true });
    const file = `data-import/backups/catalog-decisions-2026-10-13-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(backup));
    await q("commit");
    writeFileSync(file.replace(".json", ".log.json"), JSON.stringify(log, null, 1));
    console.log("committed; backup:", file);
  }
} catch (error) {
  await q("rollback").catch(() => {});
  console.error("rolled back:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
