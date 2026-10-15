/**
 * Order 9 — applies data-import/data-texts-proposal.json (ok: true). Needs 0072 (visas).
 *
 *   node scripts/data-texts-apply.mjs            dry run (rolls back)
 *   node scripts/data-texts-apply.mjs --commit   backup, then one transaction
 *
 *  - visas: an empty table receives every old row (its text in `country`, the
 *    matched country in `country_id` — an unmatched row comes too, with no
 *    country_id, so nothing the old page showed is lost); a table that already
 *    has rows only gets the country_id of approved matches filled. /visas
 *    switches to the table once it has rows (src/app/visas/page.tsx).
 *  - terms: the approved English, where it is still the text the proposal saw.
 */
import { applyInTransaction, approved, readProposal } from "./data-model-lib.mjs";

const plan = readProposal("texts");

await applyInTransaction("texts", {
  backup: async (q) => ({
    visas: await q("select * from public.visas"),
    terms: await q("select id, english_text from public.terms where id = any($1)", [approved(plan.terms).map((t) => t.id)]),
  }),
  apply: async (q, log) => {
    const [{ n }] = await q("select count(*)::int n from public.visas");
    if (n === 0) {
      for (const v of plan.visas ?? []) {
        await q(
          `insert into public.visas (country, country_id, visa_type, buy_price, buy_currency, sell_price, sell_currency, arabic_requirements, english_requirements)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [v.country, v.ok ? v.country_id : null, v.visa_type, v.buy_price, v.buy_currency, v.sell_price, v.sell_currency, v.arabic_requirements, v.english_requirements],
        );
        log.push({ kind: v.ok ? "visa-added" : "visa-added-without-country", country: v.country, type: v.visa_type });
      }
    } else {
      for (const v of approved(plan.visas)) {
        const done = await q("update public.visas set country_id = $2 where country = $1 and country_id is null returning id", [v.country, v.country_id]);
        if (done.length) log.push({ kind: "visa-country", country: v.country, to: v.country_name, rows: done.length });
      }
    }
    for (const t of approved(plan.terms)) {
      if (!String(t.to ?? "").trim()) continue;
      const done = await q("update public.terms set english_text = $3 where id = $1 and english_text is not distinct from $2 returning id", [t.id, t.from, t.to.trim()]);
      log.push({ kind: done.length ? "term-english" : "term-changed-since", from: t.from, to: t.to });
    }
  },
});
