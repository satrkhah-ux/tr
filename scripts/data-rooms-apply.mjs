/**
 * Order 4 — applies data-import/data-rooms-proposal.json (items with ok: true).
 * Needs 0072 (room_types.category).
 *
 *   node scripts/data-rooms-apply.mjs            dry run (rolls back)
 *   node scripts/data-rooms-apply.mjs --commit   backup, then one transaction
 *
 *  - categories: set where still empty (a category a person chose since stays);
 *  - reattach:   a hotel-bound copy of the room name — skipped if the hotel
 *                already has it (the unique index decides, folded name);
 *  - non_rooms:  deleted only if NOTHING uses it now (offers, drafts) — checked
 *                here, not trusted from the proposal. Its legacy_id_map rows
 *                stay, so a legacy refresh does not bring it back.
 */
import { applyInTransaction, approved, readProposal } from "./data-model-lib.mjs";

const plan = readProposal("rooms");

await applyInTransaction("rooms", {
  backup: async (q) => ({ room_types: await q("select * from public.room_types") }),
  apply: async (q, log) => {
    for (const c of approved(plan.categories)) {
      const done = await q("update public.room_types set category = $2 where id = $1 and category is null returning id", [c.id, c.category]);
      if (done.length) log.push({ kind: "category", id: c.id, category: c.category });
    }
    for (const r of approved(plan.reattach)) {
      const done = await q(
        "insert into public.room_types (hotel_id, arabic_name, english_name, category) values ($1, $2, $3, $4) on conflict do nothing returning id",
        [r.hotel_id, r.name, r.english ?? null, r.category ?? null],
      );
      if (done.length) log.push({ kind: "reattach", hotel: r.hotel, name: r.name });
    }
    // drafts are read once: a room type a draft names by id is in use
    const draftIds = new Set();
    for (const d of await q("select data from public.offer_drafts")) {
      for (const h of d.data?.hotels ?? []) for (const id of [h.room_type_id, ...(h.rooms ?? []).map((r) => r?.room_type_id)]) if (id) draftIds.add(id);
    }
    for (const n of approved(plan.non_rooms)) {
      const [{ n: offers }] = await q("select count(*)::int n from public.offer_hotels where room_type_id = $1", [n.id]);
      if (offers > 0 || draftIds.has(n.id)) {
        log.push({ kind: "non-room-kept-in-use", id: n.id, name: n.name });
        continue;
      }
      await q("delete from public.room_types where id = $1", [n.id]);
      log.push({ kind: "non-room-deleted", id: n.id, name: n.name });
    }
    const [after] = await q("select count(*)::int total, count(*) filter (where hotel_id is not null)::int hotel_bound, count(category)::int categorised from public.room_types");
    console.log("after:", after);
  },
});
