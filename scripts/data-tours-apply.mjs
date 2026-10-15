/**
 * Order 7 — applies data-import/data-tours-proposal.json (ok: true).
 * Needs 0072 (tour_prices, tours.program_id / city_id).
 *
 *   node scripts/data-tours-apply.mjs            dry run (rolls back)
 *   node scripts/data-tours-apply.mjs --commit   backup, then one transaction
 *
 * Per group: the vehicle prices into tour_prices (a price already typed on
 * /price-grid wins), the kept row renamed to the bare tour with its «from»
 * price, programme and city, the legacy ids of the folded rows pointed at it,
 * then those rows deleted. Nothing references a tours row by id but
 * legacy_id_map — drafts name a tour by its text, and findTourPrice still finds
 * «جولة X (فان)» in the grouped tour at the van's price.
 *
 * Programmes: approved titles and spelling fixes.
 */
import { applyInTransaction, approved, readProposal } from "./data-model-lib.mjs";

const plan = readProposal("tours");
const groups = approved(plan.groups);

await applyInTransaction("tours", {
  backup: async (q) => ({
    tours: await q("select * from public.tours"),
    legacy_id_map: await q("select * from public.legacy_id_map where entity = 'tour'"),
    tour_programs: await q("select id, title, description_ar from public.tour_programs where id = any($1)", [
      [...approved(plan.titles), ...approved(plan.typos)].map((p) => p.id),
    ]),
  }),
  apply: async (q, log) => {
    for (const g of groups) {
      const [keep] = await q("select id from public.tours where id = $1", [g.keep_id]);
      if (!keep) {
        log.push({ kind: "group-missing", base: g.base });
        continue;
      }
      for (const p of g.prices) {
        await q(
          "insert into public.tour_prices (tour_id, car_type, price, currency) values ($1, $2, $3, $4) on conflict (tour_id, car_type) do nothing",
          [g.keep_id, p.car_type, p.price, p.currency],
        );
      }
      await q(
        `update public.tours set arabic_name = $2, price = $3, currency = coalesce($4, currency),
                program_id = coalesce(program_id, $5), city_id = coalesce(city_id, $6)
          where id = $1`,
        [g.keep_id, g.base, g.base_price, g.base_currency, g.program_id, g.city_id],
      );
      if (g.drop_ids.length > 0) {
        await q("update public.legacy_id_map set new_id = $1 where entity = 'tour' and new_id = any($2)", [g.keep_id, g.drop_ids]);
        await q("delete from public.tours where id = any($1)", [g.drop_ids]);
      }
      log.push({ kind: "tour-grouped", base: g.base, prices: g.prices.length, folded: g.drop_ids.length });
    }
    for (const t of approved(plan.titles)) {
      if (!String(t.to ?? "").trim()) continue;
      await q("update public.tour_programs set title = $2 where id = $1", [t.id, t.to.trim()]);
      log.push({ kind: "programme-title", from: t.from, to: t.to });
    }
    for (const t of approved(plan.typos)) {
      // a title approved above is not undone by its spelling fix
      await q(
        // and a text edited since the proposal is left as the person wrote it
        "update public.tour_programs set title = case when title = $2 then $3 else title end, description_ar = case when description_ar = $4 then $5 else description_ar end where id = $1",
        [t.id, t.title_from, t.title_to, t.text_from, t.text_to],
      );
      log.push({ kind: "programme-spelling", id: t.id });
    }
    const [after] = await q("select (select count(*)::int from public.tours) tours, (select count(*)::int from public.tour_prices) prices");
    console.log("after:", after);
  },
});
