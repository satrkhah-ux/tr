/**
 * Order 6 — applies data-import/data-transfers-proposal.json (classified, ok: true).
 * Needs 0072 (transfers.from_kind / from_id / to_kind / to_id).
 *
 *   node scripts/data-transfers-apply.mjs            dry run (rolls back)
 *   node scripts/data-transfers-apply.mjs --commit   backup, then one transaction
 *
 * Writes the two ends' kinds and ids beside the text, which stays. A row is
 * skipped when it was classified since (from_kind set) or when its road and
 * vehicle already has a structured price — one typed on /price-grid wins.
 */
import { applyInTransaction, approved, readProposal } from "./data-model-lib.mjs";

const plan = readProposal("transfers");
const items = approved(plan.classified);

await applyInTransaction("transfers", {
  backup: async (q) => ({
    transfers: await q("select id, from_kind, from_id, to_kind, to_id from public.transfers where id = any($1)", [items.map((i) => i.id)]),
  }),
  apply: async (q, log) => {
    for (const t of items) {
      const done = await q(
        `update public.transfers t set from_kind = $2, from_id = $3, to_kind = $4, to_id = $5
          where t.id = $1 and t.from_kind is null
            and not exists (
              select 1 from public.transfers o
               where o.from_kind = $2 and o.from_id = $3 and o.to_kind = $4 and o.to_id = $5
                 and o.car_type is not distinct from t.car_type)
          returning t.id`,
        [t.id, t.from_kind, t.from_id, t.to_kind, t.to_id],
      );
      log.push({ kind: done.length ? "classified" : "skipped", id: t.id, road: `${t.from} ← ${t.to}`, car: t.car });
    }
  },
});
