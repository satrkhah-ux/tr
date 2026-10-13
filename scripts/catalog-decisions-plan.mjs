/**
 * The owner's decisions on the held catalogue items (the review page,
 * https://claude.ai/artifact/AfixDTbMm1xdKy4Ax1Fj3V) turned into a plan the
 * apply script runs — read-only, writes data-import/catalog-decisions-plan.json.
 *
 *   node scripts/catalog-decisions-plan.mjs <dir>
 *
 * <dir> holds review/merges.json, review/renames.json, review/questions.json as
 * the artifact's database exports them ({ items: { key: "yes" | "no" } }).
 * Only «yes» is acted on; «no» and undecided items stay as they are.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/catalog-decisions-plan.mjs <exported-decisions-dir>");
const read = (name) => {
  const f = join(dir, "review", `${name}.json`);
  if (!existsSync(f)) return {};
  const doc = JSON.parse(readFileSync(f, "utf8"));
  return (doc.data ?? doc).items ?? {};
};
const decisions = { merges: read("merges"), renames: read("renames"), questions: read("questions"), wrong: read("wrong"), dups: read("dups"), wrongNames: read("wrongNames") };
// the review page's own items (with the wrong-name and duplicate sections built from the live data)
const reviewItems = JSON.parse(readFileSync("data-import/catalog-review-items.json", "utf8"));
const yes = (section, key) => decisions[section][key] === "yes";

const proposal = JSON.parse(readFileSync("data-import/catalog-cleanup-2026-10-13-proposal.json", "utf8"));
const refsOf = (r) => Object.entries(r.refs ?? {}).reduce((sum, [k, v]) => sum + (k === "legacy_id_map" ? 0 : Number(v) || 0), 0);

const hotel_merges = proposal.hotel_merges.filter((m) => yes("merges", `m-${m.keep_id}`));
const hotel_renames = proposal.hotel_renames
  .filter((r) => r.kind === "latin_to_arabic" && yes("renames", `r-${r.id}`))
  .map((r) => ({ ...r, english_to: undefined }));
const deletions = { hotels: [], room_types: [] };

// a row carrying another hotel's name: merged into its twin, or given the Arabic name typed
for (const w of reviewItems.wrong ?? []) {
  if (!yes("wrong", w.key)) continue;
  if (w.twin) {
    hotel_merges.push({ keep_id: w.twin.id, drop_ids: [w.row.id], final_arabic: w.twin.ar, final_english: w.twin.en, rows: [w.twin, w.row], note: "owner: wrong-name row into its twin" });
  } else if ((decisions.wrongNames[w.key] ?? "").trim()) {
    hotel_renames.push({ id: w.row.id, from: w.row.ar, to: decisions.wrongNames[w.key].trim(), kind: "owner", english_to: undefined });
  }
}
// a duplicate group: every row into the first (Arabic-named, most used)
for (const d of reviewItems.dups ?? []) {
  if (!yes("dups", d.key)) continue;
  const [keep, ...rest] = d.rows;
  hotel_merges.push({ keep_id: keep.id, drop_ids: rest.map((r) => r.id), final_arabic: keep.ar, final_english: keep.en, rows: d.rows, note: "owner: duplicate group" });
}
const manual = [];

proposal.uncertain.forEach((u, i) => {
  if (!yes("questions", `q-${i}`)) return;
  const rows = u.rows ?? [];
  if (u.kind === "hotel-maybe-duplicate" && rows.length >= 2) {
    // the row more offers point at is the one kept, its names with it
    const keep = rows.slice().sort((a, b) => refsOf(b) - refsOf(a))[0];
    hotel_merges.push({
      keep_id: keep.id,
      drop_ids: rows.filter((r) => r.id !== keep.id).map((r) => r.id),
      final_arabic: keep.arabic_name,
      final_english: keep.english_name,
      rows,
      note: `owner: ${u.question}`,
    });
  } else if (u.kind === "hotel-placeholder") {
    deletions.hotels.push(...rows.map((r) => r.id));
  } else if (u.kind === "room-type" || u.kind === "room-types-combos") {
    deletions.room_types.push(...rows.map((r) => r.id));
  } else {
    // a move names its city only in words; the generic-origin question is a decision, not a row
    manual.push({ kind: u.kind, question: u.question, rows: rows.map((r) => ({ id: r.id, name: r.arabic_name, city: r.city })) });
  }
});

const plan = {
  _about: "Owner-approved subset of the 2026-10-13 proposal (review page decisions). Applied by scripts/catalog-decisions-apply.mjs.",
  generated_at: new Date().toISOString(),
  hotel_merges,
  hotel_moves: [],
  hotel_renames,
  hotel_english_fixes: [],
  room_type_renames: [],
  room_type_merges: [],
  generic_rooms: { missing: [] },
  deletions,
  manual,
};
writeFileSync("data-import/catalog-decisions-plan.json", JSON.stringify(plan, null, 1));
console.log(
  `plan: ${hotel_merges.length} merges, ${hotel_renames.length} renames, delete ${deletions.hotels.length} hotels / ${deletions.room_types.length} room types (if unused), ${manual.length} for a person`,
);
for (const m of manual) console.log("  manual:", m.kind, "—", m.question);
