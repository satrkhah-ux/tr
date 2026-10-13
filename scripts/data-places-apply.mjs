/**
 * Orders 5 and 9.3 — applies data-import/data-places-proposal.json (ok: true).
 * Needs 0072 (airports.kind and its IATA check).
 *
 *   node scripts/data-places-apply.mjs            dry run (rolls back)
 *   node scripts/data-places-apply.mjs --commit   backup, then one transaction
 *
 * Airports: kind and code. Cities / countries: the Arabic name (and the English
 * one when the item gives `english_to`). When no airport breaks the IATA rule
 * any more, the NOT VALID check of 0072 is validated in the same transaction.
 *
 * A renamed city keeps its id, so hotels, airports and offers follow it. Drafts
 * name cities as text and match them folded (ة/ه alike), so «السعوديه» →
 * «السعودية» changes nothing for them; a real respelling («يلوا» → «يالوفا»)
 * should also go into CITY_RENAMED in scripts/legacy-build-reference-sql.mjs,
 * or a legacy refresh brings the old spelling back.
 */
import { applyInTransaction, approved, readProposal } from "./data-model-lib.mjs";

const plan = readProposal("places");
const cityIds = [...approved(plan.cities), ...approved(plan.spellings).filter((s) => s.table === "cities")].map((c) => c.id);
const countryIds = approved(plan.spellings).filter((s) => s.table === "countries").map((c) => c.id);

await applyInTransaction("places", {
  backup: async (q) => ({
    airports: await q("select * from public.airports where id = any($1)", [approved(plan.airports).map((a) => a.id)]),
    cities: await q("select * from public.cities where id = any($1)", [cityIds]),
    countries: await q("select * from public.countries where id = any($1)", [countryIds]),
  }),
  apply: async (q, log) => {
    for (const a of approved(plan.airports)) {
      const code = a.to_code ? String(a.to_code).trim().toUpperCase() : null;
      await q("update public.airports set kind = $2, code = $3 where id = $1", [a.id, a.to_kind, code]);
      log.push({ kind: "airport", name: a.name, to_kind: a.to_kind, from_code: a.from_code, to_code: code });
    }
    for (const c of approved(plan.cities)) {
      if (!String(c.to ?? "").trim() || c.conflict) continue;
      await q("update public.cities set arabic_name = $2, english_name = coalesce($3, english_name) where id = $1", [c.id, c.to.trim(), c.english_to ?? null]);
      log.push({ kind: "city", from: c.from, to: c.to });
    }
    for (const s of approved(plan.spellings)) {
      const table = s.table === "countries" ? "countries" : "cities";
      await q(`update public.${table} set arabic_name = $2 where id = $1`, [s.id, s.to]);
      log.push({ kind: `spelling-${table}`, from: s.from, to: s.to });
    }
    const [{ n }] = await q("select count(*)::int n from public.airports where not (code is null or (kind = 'airport' and code ~ '^[A-Z]{3}$'))");
    if (n === 0) {
      await q("alter table public.airports validate constraint airports_iata_check");
      log.push({ kind: "iata-check-validated" });
    } else {
      console.log(`${n} airports still break the IATA rule — the check stays NOT VALID until they are fixed:`);
      for (const r of await q("select code, arabic_name, kind from public.airports where not (code is null or (kind = 'airport' and code ~ '^[A-Z]{3}$'))")) console.log("  ", r);
    }
  },
});
