/**
 * Order 6 — the old transfer rows, classified: what each end of «مطار
 * كوالالمبور الدولي ← ايبوه» IS (an airport / station / port of /airports, or a
 * city), as ids. READ ONLY → data-import/data-transfers-proposal.json.
 *
 *   node scripts/data-transfers-proposal.mjs
 *
 * One road (from, to, vehicle) was imported several times — the retired prices
 * beside the current one, all under one timestamp. Only the CURRENT row is
 * classified (the old system's last row, the same choice latest() makes in
 * src/lib/offer/pricing-suggest.ts); the retired ones stay text-only and are
 * listed, so «one price per road and vehicle» (0072's unique index) holds.
 *
 * Sections:
 *   classified  both ends resolved, the current row of its road     ok: true
 *   unresolved  an end matching nothing, or several things           (fix the name, or classify on /price-grid)
 *   retired     an older price of a road that has a current row      (left as text)
 */
import { hasColumn, propose } from "./data-model-lib.mjs";
import { guessPlaceKind } from "../src/lib/catalog/model.ts";
import { normAr, normEn } from "../src/lib/catalog/norm.ts";

const POINT_KIND = { airport: "airport", train_station: "station", bus_station: "station", port: "port" };
const looksLikePoint = (text) => guessPlaceKind(text) !== "airport" || /مطار|airport/i.test(text);

await propose("transfers", async (q) => {
  const ready = await hasColumn(q, "transfers", "from_kind");
  const withKind = await hasColumn(q, "airports", "kind");
  const rows = await q(
    `select t.id, t.from_city, t.to_city, t.car_type, t.price, t.currency, t.country_id, t.created_at, m.legacy_id
       ${ready ? ", t.from_kind" : ", null as from_kind"}
     from public.transfers t
     left join public.legacy_id_map m on m.entity = 'transfer' and m.source = 'app' and m.new_id = t.id`,
  );
  const airports = await q(`select id, arabic_name, english_name, code, country_id${withKind ? ", kind" : ", 'airport' as kind"} from public.airports`);
  const cities = await q("select id, arabic_name, english_name, country_id from public.cities");

  /** One end of a road → { kind, id, name } | { why }. */
  const resolve = (raw, countryId) => {
    const text = String(raw ?? "").replace(/^فندق\s+/, "").trim();
    if (!text) return { why: "empty" };
    const code = text.match(/\(([A-Z]{3})\)\s*$/)?.[1];
    if (code || looksLikePoint(text)) {
      const name = normAr(text.replace(/\s*\([A-Z0-9]{3,5}\)\s*$/, ""));
      const pool = airports.filter((a) => !countryId || a.country_id === countryId);
      let hits = code ? pool.filter((a) => a.code === code) : [];
      if (hits.length === 0) hits = pool.filter((a) => normAr(a.arabic_name) === name || (normEn(a.english_name) && normEn(a.english_name) === normEn(text)));
      if (hits.length === 0) hits = pool.filter((a) => normAr(a.arabic_name).includes(name) || name.includes(normAr(a.arabic_name)));
      if (hits.length !== 1) return { why: hits.length ? `ambiguous: ${hits.map((a) => a.code || a.arabic_name).join(" / ")}` : "no such airport/station/port" };
      return { kind: POINT_KIND[hits[0].kind] ?? "airport", id: hits[0].id, name: hits[0].arabic_name };
    }
    const hits = cities.filter(
      (c) => (!countryId || c.country_id === countryId) && (normAr(c.arabic_name) === normAr(text) || (normEn(text) && normEn(c.english_name) === normEn(text))),
    );
    if (hits.length !== 1) return { why: hits.length ? "several cities" : "no such city" };
    return { kind: "city", id: hits[0].id, name: hits[0].arabic_name };
  };

  // the current row of each road: the newest, then the old system's last
  const road = (r) => `${r.country_id}|${normAr(r.from_city)}|${normAr(r.to_city)}|${normAr(r.car_type)}`;
  const newer = (a, b) => {
    const ta = Date.parse(a.created_at) || 0;
    const tb = Date.parse(b.created_at) || 0;
    return ta !== tb ? ta > tb : Number(a.legacy_id ?? -1) > Number(b.legacy_id ?? -1);
  };
  const current = new Map();
  for (const r of rows) {
    const k = road(r);
    if (!current.has(k) || newer(r, current.get(k))) current.set(k, r);
  }

  const classified = [];
  const unresolved = [];
  const retired = [];
  for (const r of rows) {
    if (r.from_kind) continue; // already structured
    const cur = current.get(road(r));
    if (cur.id !== r.id) {
      retired.push({ id: r.id, from: r.from_city, to: r.to_city, car: r.car_type, price: r.price, currency: r.currency, current_id: cur.id });
      continue;
    }
    const from = resolve(r.from_city, r.country_id);
    const to = resolve(r.to_city, r.country_id);
    if (from.why || to.why) {
      unresolved.push({ id: r.id, from: r.from_city, to: r.to_city, car: r.car_type, price: r.price, from_problem: from.why ?? null, to_problem: to.why ?? null });
      continue;
    }
    classified.push({
      id: r.id, from: r.from_city, to: r.to_city, car: r.car_type, price: r.price, currency: r.currency,
      from_kind: from.kind, from_id: from.id, from_name: from.name,
      to_kind: to.kind, to_id: to.id, to_name: to.name,
      airport_to_city: from.kind !== "city" && to.kind === "city",
      ok: true,
    });
  }
  const notes = ready ? [] : ["0072 is not applied: the apply needs transfers.from_kind …"];
  console.log(
    `classified ${classified.length} (${classified.filter((c) => c.airport_to_city).length} airport → city), unresolved ${unresolved.length}, retired ${retired.length}`,
  );
  return { notes, classified, unresolved, retired };
});
