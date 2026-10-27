// Audited, optimistic catalogue repair. Dry run unless --apply is passed.
// Only non-price catalogue columns are accepted. Conflicts roll back the batch.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

process.loadEnvFile(".env.local");
const root = process.argv[2];
if (!root) throw new Error("Pass the reviewed audit directory");
const apply = process.argv.includes("--apply");
const read = name => JSON.parse(fs.readFileSync(path.join(root, name)));
const baseline = read("baseline.json");
const tables = structuredClone(baseline.tables);
const plan = new Map();
const permitted = {
  hotels: new Set(["arabic_name", "english_name", "city_id", "country_id", "address", "contact_number", "website", "stars", "verified", "verified_at"]),
  cities: new Set(["arabic_name", "english_name", "lat", "lng", "sort_order", "default_hotel"]),
  airports: new Set(["kind", "code"]),
  transfers: new Set(["from_city", "to_city", "country_id"]),
};
function patch(table, id, changes, source) {
  const row = tables[table].find(r => r.id === id);
  if (!row) throw new Error(`Missing ${table} record ${id}`);
  const key = `${table}:${id}`;
  const entry = plan.get(key) || { table, id, before: {}, changes: {}, sources: [] };
  for (const [column, value] of Object.entries(changes)) {
    if (!permitted[table]?.has(column)) throw new Error(`Forbidden column ${table}.${column}`);
    if (String(row[column] ?? "") === String(value ?? "")) continue;
    if (!(column in entry.before)) entry.before[column] = baseline.tables[table].find(r => r.id === id)[column] ?? null;
    row[column] = value;
    entry.changes[column] = value;
  }
  if (Object.keys(entry.changes).length) {
    entry.sources = [...new Set([...entry.sources, source])];
    plan.set(key, entry);
  }
}

for (const row of read("arabic-reviewed.json")) patch("hotels", row.id, { arabic_name: row.arabic_name }, "Reviewed Arabic rendering of the existing property name; English name preserved");

const details = new Map();
for (const file of fs.readdirSync(path.join(root, "supplier")).filter(f => f.startsWith("details-EN"))) {
  for (const row of read(`supplier/${file}`).HotelDetails || []) details.set(String(row.HotelCode), row);
}
const mismatchIds = new Set(read("city-match-review.json").map(r => r.id));
for (const match of read("supplier-matches.json")) {
  // A provider can have a similarly named property in a different city.
  if (mismatchIds.has(match.id)) continue;
  const row = tables.hotels.find(h => h.id === match.id);
  const detail = details.get(String(match.source.HotelCode));
  if (!row || !detail || detail.CountryCode?.toUpperCase() !== match.source._country) continue;
  const changes = {};
  if (detail.Address?.trim()) changes.address = detail.Address.trim();
  if (String(detail.PhoneNumber || "").replace(/\D/g, "").length >= 7) changes.contact_number = String(detail.PhoneNumber).trim();
  if (!row.stars && !match.ratingConflict && Number(detail.HotelRating) >= 1 && Number(detail.HotelRating) <= 5) changes.stars = Number(detail.HotelRating);
  // Provider website fields sometimes contain reseller links; do not call those the hotel's website.
  const city = tables.cities.find(c => c.id === row.city_id);
  if (city) changes.country_id = city.country_id;
  patch("hotels", row.id, changes, `TBO Hoteldetails ${detail.HotelCode}; ${baseline.takenAt}; ${match.source._file}`);
  if (row.city_id && row.stars >= 1 && row.stars <= 5 && /[ء-ي]/.test(row.arabic_name) && row.address?.trim() && String(row.contact_number || "").replace(/\D/g, "").length >= 7) {
    patch("hotels", row.id, { verified: true, verified_at: baseline.takenAt }, `Identity matched by full property name, country and city catalogue; public details reviewed from TBO ${detail.HotelCode}`);
  }
}

// Small evidence-backed corrections beyond the supplier's unambiguous matches.
for (const item of read("manual-corrections.json")) patch(item.table, item.id, item.changes, item.source);

for (const airport of tables.airports) {
  if (airport.kind !== "airport") continue;
  const name = `${airport.arabic_name} ${airport.english_name}`;
  const kind = /train|قطار/i.test(name) ? "train_station" : /bus|باص/i.test(name) ? "bus_station" : null;
  if (kind) patch("airports", airport.id, { kind, code: null }, "Existing station name identifies a train/bus station, not an airport; station codes are not IATA codes");
}

const uses = new Map(read("hotel-uses.json").map(u => [u.hotel_id, u.uses]));
const merges = read("reviewed-merges.json");
const mergedIds = new Set(merges.map(m => m.drop));
for (const country of tables.countries) {
  const cities = tables.cities.filter(c => c.country_id === country.id);
  let order = Math.max(0, ...cities.map(c => Number(c.sort_order || 0)));
  for (const city of cities.filter(c => c.sort_order === null).sort((a,b) => a.arabic_name.localeCompare(b.arabic_name, "ar"))) {
    patch("cities", city.id, { sort_order: ++order }, "Preserved existing manual priorities; remaining cities ordered alphabetically within their country");
  }
}
for (const city of tables.cities.filter(c => !c.default_hotel?.trim())) {
  const eligible = tables.hotels.filter(h => h.city_id === city.id && !mergedIds.has(h.id) && !["Disabled", "Inactive"].includes(h.status) && h.arabic_name?.trim());
  const best = eligible.sort((a,b) => (uses.get(b.id)||0) - (uses.get(a.id)||0) || Number(b.verified) - Number(a.verified) || a.arabic_name.localeCompare(b.arabic_name, "ar"))[0];
  if (best) patch("cities", city.id, { default_hotel: best.arabic_name }, "Owner-approved most-used hotel; ties prefer verified data then Arabic alphabetical order");
}
const entries = [...plan.values()];
fs.writeFileSync(path.join(root, "repair-plan.json"), JSON.stringify(entries, null, 2));
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const summary = { mode: apply ? "apply" : "dry-run", rows: entries.length, tables: {}, fields: {}, conflicts: [], merged: [], quality: [] };
try {
  await db.connect();
  await db.query("begin isolation level repeatable read");
  await db.query("set local lock_timeout = '10s'");
  const priceSnapshot = async () => {
    const result = {};
    for (const table of ["tours", "transfers", "tour_prices", "hotel_rate_memory", "room_types"]) {
      result[table] = (await db.query(`select md5(coalesce(string_agg((to_jsonb(r) - array['from_city','to_city','country_id','updated_at'])::text, '' order by r.id), '')) as hash from public.${table} r`)).rows[0].hash;
    }
    return result;
  };
  const pricesBefore = await priceSnapshot();
  for (const table of Object.keys(permitted)) {
    const batch = entries.filter(e => e.table === table);
    if (!batch.length) continue;
    const locked = await db.query(`select * from public.${table} where id=any($1::uuid[]) order by id for update`, [batch.map(e => e.id)]);
    const current = new Map(locked.rows.map(r => [r.id,r]));
    for (const entry of batch) {
      const row = current.get(entry.id);
      if (!row || Object.entries(entry.before).some(([key, value]) => String(row[key] ?? "") !== String(value ?? ""))) summary.conflicts.push({ table, id: entry.id });
    }
    if (summary.conflicts.length) throw new Error(`Concurrent edits: ${summary.conflicts.length}; entire batch rolled back`);
    const columns = [...new Set(batch.flatMap(e => Object.keys(e.changes)))];
    const updated = await db.query(`update public.${table} h set ${columns.map(c => `"${c}"=case when e.changes ? '${c}' then v."${c}" else h."${c}" end`).join(",")}
      from jsonb_to_recordset($1::jsonb) as e(id uuid, changes jsonb), lateral jsonb_populate_record(null::public.${table}, e.changes) v
      where h.id=e.id`, [JSON.stringify(batch)]);
    if (updated.rowCount !== batch.length) throw new Error(`Incomplete ${table} update`);
    const audits = batch.map(entry => ({ entity_id: entry.id, meta: { batch: "catalog-quality-2026-10-27", changes: Object.fromEntries(Object.keys(entry.changes).map(f => [f,[entry.before[f],entry.changes[f]]])), sources: entry.sources } }));
    await db.query("insert into public.audit_logs (action,entity,entity_id,meta) select 'catalog.quality_repaired',$1,a.entity_id,a.meta from jsonb_to_recordset($2::jsonb) a(entity_id text,meta jsonb)", [table, JSON.stringify(audits)]);
    summary.tables[table] = batch.length;
    for (const entry of batch) for (const field of Object.keys(entry.changes)) summary.fields[`${table}.${field}`] = (summary.fields[`${table}.${field}`] || 0) + 1;
  }
  if (summary.conflicts.length) throw new Error(`Concurrent edits: ${summary.conflicts.length}; entire batch rolled back`);
  // Only reviewed, unused duplicate catalogue rows can be consolidated here.
  // A newly attached quote, room, rate or draft aborts the whole repair instead
  // of invoking the general merge tool (which can choose between rate conflicts).
  for (const merge of merges) {
    const rows = (await db.query("select * from public.hotels where id=any($1::uuid[]) order by id for update", [[merge.drop, merge.keep]])).rows;
    if (rows.length !== 2) throw new Error("Duplicate pair changed; review again");
    const removed = rows.find(r => r.id === merge.drop);
    const kept = rows.find(r => r.id === merge.keep);
    if (removed.city_id !== kept.city_id || removed.country_id !== kept.country_id) throw new Error("Duplicate destinations differ");
    for (const table of ["room_types", "offer_hotels", "hotel_rate_memory"]) {
      const refs = await db.query(`select 1 from public.${table} where hotel_id=$1 limit 1`, [merge.drop]);
      if (refs.rowCount) throw new Error(`Duplicate gained a ${table} reference; review instead of merging`);
    }
    for (const table of ["offer_drafts", "operation_bookings"]) {
      const refs = await db.query(`select 1 from public.${table} r where to_jsonb(r)::text like $1 limit 1`, [`%${merge.drop}%`]);
      if (refs.rowCount) throw new Error(`Duplicate gained a ${table} reference; review instead of merging`);
    }
    await db.query("update public.hotel_content_cache set internal_hotel_id=$1 where internal_hotel_id=$2", [merge.keep, merge.drop]);
    await db.query("update public.legacy_id_map set new_id=$1 where entity='hotel' and new_id=$2", [merge.keep, merge.drop]);
    await db.query("insert into public.audit_logs(action,entity,entity_id,meta) values ('catalog.duplicate_consolidated','hotels',$1,$2::jsonb)", [merge.keep, JSON.stringify({ batch: "catalog-quality-2026-10-27", removed, source: merge.source })]);
    await db.query("delete from public.hotels where id=$1", [merge.drop]);
    summary.merged.push(merge);
  }
  const pricesAfter = await priceSnapshot();
  if (JSON.stringify(pricesBefore) !== JSON.stringify(pricesAfter)) throw new Error("Pricing or room data changed during repair; rolled back");
  summary.pricesUnchanged = true;
  await db.query("set local role service_role");
  summary.quality = (await db.query("select * from public.data_quality_counts() order by issue")).rows;
  const review = {};
  for (const [key, fn] of [["hotel_duplicate", "hotels"], ["hotel_no_contact", "hotels"], ["hotel_no_stars", "hotels"], ["hotel_unverified", "hotels"], ["transfer_not_from_airport", "transfers"], ["tour_duplicate", "tours"], ["city_no_default_hotel", "cities"]]) {
    review[key] = (await db.query(`select * from public.data_quality_${fn}($1)`, [key])).rows;
  }
  fs.writeFileSync(path.join(root, apply ? "remaining-review.json" : "preview-review.json"), JSON.stringify(review, null, 2));
  await db.query("reset role");
  await db.query(apply ? "commit" : "rollback");
  fs.writeFileSync(path.join(root, apply ? "applied.json" : "dry-run.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await db.query("rollback").catch(() => {});
  fs.writeFileSync(path.join(root, "repair-error.json"), JSON.stringify({ message: error.message, summary }, null, 2));
  throw error;
} finally { await db.end(); }
