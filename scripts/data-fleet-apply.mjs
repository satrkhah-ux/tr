/**
 * Order 8 — applies data-import/data-fleet-proposal.json (ok: true).
 *
 *   node scripts/data-fleet-apply.mjs            dry run (rolls back)
 *   node scripts/data-fleet-apply.mjs --commit   backup, then one transaction
 *
 *  - test drivers deleted (operations name a driver by text, nothing points at the row);
 *  - duplicate services deleted, their legacy ids pointed at the row kept
 *    (so a legacy refresh does not re-add them);
 *  - pax_capacity filled from the name, where still empty;
 *  - a non-car becomes a services row (in the country the item names) and its
 *    car type is disabled — kept, so old drafts that name it still read;
 *  - one spelling per car: the kept row renamed, the others disabled, and the
 *    transfers / tour prices priced under the old names follow the new one.
 */
import { applyInTransaction, approved, readProposal } from "./data-model-lib.mjs";

const plan = readProposal("fleet");

await applyInTransaction("fleet", {
  backup: async (q) => ({
    drivers: await q("select * from public.drivers where id = any($1)", [approved(plan.test_drivers).map((d) => d.id)]),
    services: await q("select * from public.services"),
    transportation_types: await q("select * from public.transportation_types"),
    legacy_id_map: await q("select * from public.legacy_id_map where entity = 'service'"),
    transfers: await q("select id, car_type from public.transfers"),
    tour_prices: await q("select id, car_type from public.tour_prices").catch(() => []),
  }),
  apply: async (q, log) => {
    for (const d of approved(plan.test_drivers)) {
      await q("delete from public.drivers where id = $1", [d.id]);
      log.push({ kind: "driver-deleted", name: d.name, mobile: d.mobile });
    }
    for (const s of approved(plan.service_dupes)) {
      await q("update public.legacy_id_map set new_id = $1 where entity = 'service' and new_id = any($2)", [s.keep_id, s.drop_ids]);
      await q("delete from public.services where id = any($1)", [s.drop_ids]);
      log.push({ kind: "service-merged", name: s.name, dropped: s.drop_ids.length });
    }
    for (const c of approved(plan.car_seats)) {
      const done = await q("update public.transportation_types set pax_capacity = $2 where id = $1 and pax_capacity is null returning id", [c.id, c.pax]);
      if (done.length) log.push({ kind: "car-seats", name: c.name, pax: c.pax });
    }
    for (const n of approved(plan.non_cars)) {
      const s = n.service;
      await q(
        `insert into public.services (country_id, arabic_name, english_name, service_type, buy_price, buy_currency, sell_price, sell_currency)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [n.country_id ?? null, s.arabic_name, s.english_name, s.service_type, s.buy_price, s.buy_currency, s.sell_price, s.sell_currency],
      );
      await q("update public.transportation_types set status = 'Disabled' where id = $1", [n.id]);
      log.push({ kind: "non-car-moved", name: n.name, country: n.country_id ?? "NONE — set it on /services" });
    }
    for (const g of approved(plan.car_spellings)) {
      const name = String(g.keep_name ?? "").trim();
      if (!name) continue;
      const olds = g.names.map((r) => r.name);
      await q("update public.transportation_types set arabic_name = $2 where id = $1", [g.keep_id, name]);
      await q("update public.transportation_types set status = 'Disabled' where id = any($1) and id <> $2", [g.names.map((r) => r.id), g.keep_id]);
      // a structured road already priced under the new name keeps that price (one price per road and vehicle)
      await q(
        `update public.transfers t set car_type = $1 where car_type = any($2)
           and (t.from_kind is null or not exists (select 1 from public.transfers o
             where o.from_kind = t.from_kind and o.from_id = t.from_id and o.to_kind = t.to_kind and o.to_id = t.to_id and o.car_type = $1))`,
        [name, olds],
      );
      // a tour already priced under the new name keeps that price
      await q(
        `update public.tour_prices p set car_type = $1 where car_type = any($2)
           and not exists (select 1 from public.tour_prices o where o.tour_id = p.tour_id and o.car_type = $1)`,
        [name, olds],
      );
      log.push({ kind: "car-spelling", from: olds.join(" | "), to: name });
    }
  },
});
