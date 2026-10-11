// Carry out scripts/catalog-dedupe-decisions.json against the live catalogue.
//
// Usage:
//   node scripts/catalog-dedupe-report.mjs            (refresh the candidates first)
//   node scripts/catalog-dedupe-apply.mjs             (DRY RUN — rolls back, prints the plan)
//   node scripts/catalog-dedupe-apply.mjs --commit    (backs up, then does it)
//   --decisions <file>   a later round (default scripts/catalog-dedupe-decisions.json);
//                        a round without a hotels / room_types section leaves them alone
//
// One transaction. Every reference to a dropped row is moved to the row that
// stays BEFORE the drop — offers, rate memory, content cache, airports, climate
// notes, draft JSON and legacy_id_map — so nothing is orphaned, and a later
// refresh from the old system maps onto the survivor instead of recreating the
// duplicate. A deleted non-city keeps its legacy_id_map row for the same reason.
//
// The backup (data-import/backups/, gitignored) holds every row this can touch.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { normEn } from "../src/lib/catalog/norm.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = process.argv.includes("--commit");
const env = readFileSync(join(root, ".env.local"), "utf8");
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const cand = JSON.parse(readFileSync(join(root, "data-import/catalog-candidates.json"), "utf8"));
const decArg = process.argv.indexOf("--decisions");
const decFile = decArg > 0 ? process.argv[decArg + 1] : "scripts/catalog-dedupe-decisions.json";
const dec = JSON.parse(readFileSync(join(root, decFile), "utf8"));

// ------------------------------------------------------------ id resolution
function resolver(rows, table) {
  return (prefix) => {
    const hits = rows.filter((r) => r.id.startsWith(prefix));
    if (hits.length !== 1) throw new Error(`${table}: prefix ${prefix} matches ${hits.length} rows`);
    return hits[0].id;
  };
}

/** Union-find over ids; returns the groups of 2+. */
function unite(pairs) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  for (const [a, b] of pairs) parent.set(find(a), find(b));
  const out = new Map();
  for (const x of parent.keys()) out.set(find(x), [...(out.get(find(x)) ?? []), x]);
  return [...out.values()].filter((g) => g.length > 1);
}

const hasArabic = (s) => /[؀-ۿ]/.test(s ?? "");
/** «Hard Rock Hotel Bali.» / «.Studio» / «Resorts World Langkawi ،» → the name. */
const tidy = (s) => (s ?? "").replace(/^[\s.,،/'"\[\]()]+|[\s.,،/'"\[\]()]+$/g, "").replace(/\s+/g, " ").trim();

/**
 * Pairs from candidate groups and approved near pairs, minus any group that
 * contains a skipped pair (a skipped pair inside a bigger group poisons it).
 */
function mergeGroups(section, decision, resolve, byId) {
  const skip = (decision.skip_groups?.pairs ?? []).map((p) => p.map(resolve));
  const poisoned = (ids) => skip.some(([a, b]) => ids.includes(a) && ids.includes(b));
  const pairs = [];
  for (const g of section.groups) {
    const ids = g.map((r) => r.id);
    if (poisoned(ids)) continue;
    for (let i = 1; i < ids.length; i++) pairs.push([ids[0], ids[i]]);
  }
  for (const [a, b] of decision.approve_near ?? []) pairs.push([resolve(a), resolve(b)]);
  if (decision.auto_merge_near_at != null) {
    for (const p of section.near) {
      if (p.similarity >= decision.auto_merge_near_at && !poisoned(p.rows.map((r) => r.id))) {
        pairs.push([p.rows[0].id, p.rows[1].id]);
      }
    }
  }
  return unite(pairs).map((ids) => ids.map((id) => byId.get(id)));
}

const refs = (r) => (r.offers ?? 0) + (r.rates ?? 0) + (r.drafts ?? 0) + (r.content ?? 0) + (r.rooms ?? 0);

/** The row that stays: most referenced → Arabic-script name → stars → Latin English → longest Arabic → oldest. */
function pickSurvivor(rows, keepIds) {
  const forced = rows.find((r) => keepIds.has(r.id));
  if (forced) return forced;
  return [...rows].sort(
    (a, b) =>
      refs(b) - refs(a) ||
      Number(hasArabic(b.arabic_name)) - Number(hasArabic(a.arabic_name)) ||
      Number(b.stars != null) - Number(a.stars != null) ||
      Number(Boolean(normEn(b.english_name))) - Number(Boolean(normEn(a.english_name))) ||
      tidy(b.arabic_name).length - tidy(a.arabic_name).length ||
      String(a.created_at).localeCompare(String(b.created_at)),
  )[0];
}

// ------------------------------------------------------------ plan
const allHotels = new Map();
for (const g of cand.hotels.groups) for (const h of g) allHotels.set(h.id, h);
for (const p of cand.hotels.near) for (const h of p.rows) allHotels.set(h.id, h);
const allRooms = new Map();
for (const g of cand.room_types.groups) for (const r of g) allRooms.set(r.id, r);
for (const p of cand.room_types.near) for (const r of p.rows) allRooms.set(r.id, r);

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, params) => (await db.query(sql, params)).rows;

const cityRows = await q("select id, arabic_name, english_name, country_id from cities");
const cityId = resolver(cityRows, "cities");
const hotelId = resolver([...allHotels.values()], "hotels");
const roomId = resolver([...allRooms.values()], "room_types");

/** Name overrides keyed by ANY member of a group, so they hold whichever row survives. */
function namesFor(rows, overrides, resolve) {
  const map = new Map(
    Object.entries(overrides ?? {})
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => [resolve(k), v]),
  );
  return rows.map((r) => map.get(r.id)).find(Boolean) ?? {};
}

/** Share of the letters that are Arabic — «River home - Villa Sara هاد» is 0.15, not an Arabic name. */
const arabicShare = (s) => {
  const letters = (s ?? "").match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => /[؀-ۿ]/.test(c)).length / letters.length : 0;
};
const latinEnglish = (rows) => rows.map((r) => r.english_name).filter((e) => normEn(e));

const hotelKeep = new Set((dec.hotels?.keep ?? []).map(hotelId));
const hotelPlan = (dec.hotels ? mergeGroups(cand.hotels, dec.hotels, hotelId, allHotels) : []).map((rows) => {
  const keep = pickSurvivor(rows, hotelKeep);
  const drop = rows.filter((r) => r.id !== keep.id);
  const named = namesFor(rows, dec.hotels.names, hotelId);
  // A Latin-only survivor borrows a sibling's name only when that name really is Arabic.
  const arabic =
    named.arabic_name ??
    (arabicShare(keep.arabic_name) >= 0.5
      ? keep.arabic_name
      : (rows.find((r) => arabicShare(r.arabic_name) >= 0.5)?.arabic_name ?? keep.arabic_name));
  const english =
    named.english_name ??
    (normEn(keep.english_name) ? keep.english_name : (latinEnglish(rows).sort((a, b) => b.length - a.length)[0] ?? keep.english_name));
  return { keep, drop, arabic_name: tidy(arabic), english_name: tidy(english) || null };
});

/**
 * Room types are generic catalogue words, so the WORDING decides, not the row:
 * the spelling with the proper ة, without a doubled-letter typo («ببغرفة»),
 * and the plainest English («Family room», not «Family Bunks with 4 bunk beds»).
 */
const taMarbuta = (s) => (tidy(s).match(/ة/g) ?? []).length;
const doubled = (s) => (tidy(s).match(/(\p{L})\1/gu) ?? []).length;
const roomPlan = (dec.room_types ? mergeGroups(cand.room_types, dec.room_types, roomId, allRooms) : []).map((rows) => {
  const keep = pickSurvivor(rows, new Set());
  const named = namesFor(rows, dec.room_types.names, roomId);
  const wording = [...rows]
    .filter((r) => arabicShare(r.arabic_name) >= 0.5)
    .sort(
      (a, b) =>
        taMarbuta(b.arabic_name) - taMarbuta(a.arabic_name) ||
        doubled(a.arabic_name) - doubled(b.arabic_name) ||
        tidy(b.arabic_name).length - tidy(a.arabic_name).length,
    )[0];
  const english = latinEnglish(rows).sort((a, b) => tidy(a).length - tidy(b).length)[0] ?? keep.english_name;
  return {
    keep,
    drop: rows.filter((r) => r.id !== keep.id),
    arabic_name: tidy(named.arabic_name ?? wording?.arabic_name ?? keep.arabic_name),
    english_name: tidy(named.english_name ?? english) || null,
  };
});

const cityPlan = (dec.cities.merge ?? []).map((m) => ({
  keep: cityId(m.keep),
  drop: m.drop.map(cityId),
  arabic_name: m.arabic_name ?? null,
  english_name: m.english_name ?? null,
}));
const cityDelete = (dec.cities.delete?.ids ?? []).map(cityId);
const cityRename = (dec.cities.rename ?? []).map((r) => ({ id: cityId(r.id), arabic_name: r.arabic_name, english_name: r.english_name }));

// Every overlap between plans is a bug in the decisions, not something to guess around.
const seen = new Set();
for (const id of [...hotelPlan.flatMap((p) => p.drop.map((d) => d.id)), ...roomPlan.flatMap((p) => p.drop.map((d) => d.id))]) {
  if (seen.has(id)) throw new Error(`row ${id} dropped twice`);
  seen.add(id);
}

console.log(`plan: cities merge ${cityPlan.length}, delete ${cityDelete.length}, rename ${cityRename.length}`);
console.log(`      hotels  merge ${hotelPlan.length} groups / drop ${hotelPlan.reduce((n, p) => n + p.drop.length, 0)}`);
console.log(`      rooms   merge ${roomPlan.length} groups / drop ${roomPlan.reduce((n, p) => n + p.drop.length, 0)}`);

writeFileSync(
  join(root, "data-import/catalog-plan.json"),
  JSON.stringify({ cityPlan, cityDelete, cityRename, hotelPlan, roomPlan }, null, 1),
);

// ------------------------------------------------------------ backup
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (COMMIT) {
  mkdirSync(join(root, "data-import/backups"), { recursive: true });
  const backup = {};
  for (const t of ["cities", "hotels", "room_types", "airports", "city_climate_notes", "hotel_rate_memory", "offer_drafts", "repackage_imports", "transfers", "markup_rules"]) {
    backup[t] = await q(`select * from public.${t}`);
  }
  backup.offer_hotels = await q("select id, hotel_id, room_type_id from public.offer_hotels");
  backup.hotel_content_cache = await q("select id, internal_hotel_id from public.hotel_content_cache");
  backup.legacy_id_map = await q("select * from public.legacy_id_map where entity in ('city','hotel','room_type')");
  const file = join(root, `data-import/backups/catalog-${stamp}.json`);
  writeFileSync(file, JSON.stringify(backup));
  console.log(`backup → ${file}`);
}

// ------------------------------------------------------------ execute
/** Rewrite every occurrence of a dropped id inside the JSON documents that carry ids. */
async function rewriteJson(from, to) {
  for (const [table, col] of [["offer_drafts", "data"], ["repackage_imports", "data"]]) {
    await q(`update public.${table} set ${col} = replace(${col}::text, $1, $2)::jsonb where ${col}::text like '%' || $1 || '%'`, [from, to]);
  }
}

const log = [];
await q("begin");
try {
  // ---- cities
  for (const p of cityPlan) {
    for (const d of p.drop) {
      await q("update public.hotels set city_id = $2 where city_id = $1", [d, p.keep]);
      await q("update public.airports set city_id = $2 where city_id = $1", [d, p.keep]);
      await q(
        `update public.city_climate_notes n set city_id = $2 where city_id = $1
           and not exists (select 1 from public.city_climate_notes k where k.city_id = $2 and k.month = n.month)`,
        [d, p.keep],
      );
      await q("delete from public.city_climate_notes where city_id = $1", [d]);
      await q("update public.legacy_id_map set new_id = $2 where entity = 'city' and new_id = $1", [d, p.keep]);
      await rewriteJson(d, p.keep);
      await q("delete from public.cities where id = $1", [d]);
    }
    if (p.arabic_name) await renameCity(p.keep, p.arabic_name, p.english_name);
    log.push({ kind: "city-merge", keep: p.keep, drop: p.drop });
  }
  for (const r of cityRename) {
    await renameCity(r.id, r.arabic_name, r.english_name);
    log.push({ kind: "city-rename", ...r });
  }
  for (const id of cityDelete) {
    const [{ hotels, airports }] = await q(
      "select (select count(*)::int from public.hotels where city_id = $1) hotels, (select count(*)::int from public.airports where city_id = $1) airports",
      [id],
    );
    if (hotels || airports) throw new Error(`city ${id} still has ${hotels} hotels / ${airports} airports — not deleting`);
    await q("delete from public.cities where id = $1", [id]);
    log.push({ kind: "city-delete", id });
  }
  for (const [country, names] of Object.entries(dec.cities.sort ?? {})) {
    for (const [i, name] of names.entries()) {
      const res = await db.query(
        `update public.cities set sort_order = $3 where catalog_norm(arabic_name) = catalog_norm($2)
           and country_id = (select id from public.countries where catalog_norm(arabic_name) = catalog_norm($1))`,
        [country, name, i + 1],
      );
      if (res.rowCount !== 1) throw new Error(`sort: ${country}/${name} matched ${res.rowCount} rows`);
    }
  }

  // ---- hotels
  for (const p of hotelPlan) {
    const keep = p.keep.id;
    for (const d of p.drop.map((r) => r.id)) {
      await q("update public.offer_hotels set hotel_id = $2 where hotel_id = $1", [d, keep]);
      await q(
        `update public.hotel_rate_memory m set hotel_id = $2 where hotel_id = $1
           and not exists (select 1 from public.hotel_rate_memory k where k.hotel_id = $2
             and k.room_type_name = m.room_type_name and coalesce(k.board_type,'') = coalesce(m.board_type,''))`,
        [d, keep],
      );
      await q("update public.room_types set hotel_id = $2 where hotel_id = $1", [d, keep]);
      await q("update public.hotel_content_cache set internal_hotel_id = $2 where internal_hotel_id = $1", [d, keep]);
      await q("update public.legacy_id_map set new_id = $2 where entity = 'hotel' and new_id = $1", [d, keep]);
      await rewriteJson(d, keep);
    }
    // Fill what the survivor lacks from the rows it absorbs, then drop them.
    const ids = p.drop.map((r) => r.id);
    await q(
      `update public.hotels h set
         arabic_name = $2, english_name = $3,
         stars = coalesce(h.stars, (select max(stars) from public.hotels where id = any($4))),
         address = coalesce(h.address, (select max(address) from public.hotels where id = any($4))),
         google_maps = coalesce(h.google_maps, (select max(google_maps) from public.hotels where id = any($4))),
         contact_number = coalesce(h.contact_number, (select max(contact_number) from public.hotels where id = any($4))),
         website = coalesce(h.website, (select max(website) from public.hotels where id = any($4)))
       where h.id = $1`,
      [keep, p.arabic_name, p.english_name, ids],
    );
    await q("delete from public.hotels where id = any($1)", [ids]);
    log.push({ kind: "hotel-merge", keep, name: p.arabic_name, drop: p.drop.map((r) => `${r.arabic_name} | ${r.english_name}`) });
  }

  // ---- room types
  for (const p of roomPlan) {
    const keep = p.keep.id;
    const ids = p.drop.map((r) => r.id);
    for (const d of ids) {
      await q("update public.offer_hotels set room_type_id = $2 where room_type_id = $1", [d, keep]);
      await q("update public.legacy_id_map set new_id = $2 where entity = 'room_type' and new_id = $1", [d, keep]);
      await rewriteJson(d, keep);
    }
    await q("update public.room_types set arabic_name = $2, english_name = $3 where id = $1", [keep, p.arabic_name, p.english_name]);
    await q("delete from public.room_types where id = any($1)", [ids]);
    log.push({ kind: "room-merge", keep, name: p.arabic_name, drop: p.drop.map((r) => r.arabic_name) });
  }

  // ---- what is left must already satisfy 0048, or it would fail on apply
  const [left] = await q(`select
    (select count(*)::int from (select 1 from public.cities group by country_id, catalog_norm(arabic_name) having count(*) > 1) x) cities,
    (select count(*)::int from (select 1 from public.room_types group by coalesce(hotel_id,'00000000-0000-0000-0000-000000000000'::uuid), catalog_norm(arabic_name) having count(*) > 1) x) rooms`);
  console.log(`remaining duplicate keys — cities ${left.cities}, room types ${left.rooms}`);

  if (COMMIT) {
    await q("commit");
    writeFileSync(join(root, `data-import/backups/catalog-${stamp}.log.json`), JSON.stringify(log, null, 1));
    console.log("✓ committed");
  } else {
    await q("rollback");
    console.log("dry run — rolled back. Re-run with --commit to apply.");
  }
} catch (error) {
  await q("rollback");
  console.error(`✗ rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}

/**
 * A city's name is also written as TEXT in transfers, markup rules and drafts.
 * Renaming the row alone would leave «سنغفورا» transfers pointing at nothing.
 */
async function renameCity(id, arabic, english) {
  const [{ arabic_name: old }] = await q("select arabic_name from public.cities where id = $1", [id]);
  await q("update public.cities set arabic_name = $2, english_name = coalesce($3, english_name) where id = $1", [id, arabic, english]);
  if (!old || old === arabic) return;
  await q("update public.transfers set from_city = $2 where catalog_norm(from_city) = catalog_norm($1)", [old, arabic]);
  await q("update public.transfers set to_city = $2 where catalog_norm(to_city) = catalog_norm($1)", [old, arabic]);
  await q("update public.markup_rules set city = $2 where catalog_norm(city) = catalog_norm($1)", [old, arabic]);
  // Quoted, so only a whole JSON string value «"سنغفورا"» changes — never a substring of a hotel name.
  await q(
    `update public.offer_drafts set data = replace(data::text, $1, $2)::jsonb where data::text like '%' || $1 || '%'`,
    [JSON.stringify(old), JSON.stringify(arabic)],
  );
}
