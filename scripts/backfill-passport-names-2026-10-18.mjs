/**
 * «اسم الواتساب ليس اسم الجواز» (the owner, 2026-10-18), the data half.
 *
 * Until today traveller 1 was seeded with the client's CONTACT name (the
 * WhatsApp name, customers.arabic_name — «al 3r18y» on AD-2-3599), and a
 * passport read never replaced it. This finds the travellers whose name is
 * still exactly that contact name and:
 *
 *   a. with a passport on file → the passport's name (the code's rule now:
 *      a planned name gives way to the passport's — travelers.ts savedName);
 *   b. with no passport yet → left as it is, unless `--clear-unread`: then
 *      unnamed («مسافر 1» on screen) until the passport is read.
 *
 * A name a person changed since is never touched: after 0091 only rows it
 * marked `seed` are candidates.
 *
 * Dry run by default, and the dry run decrypts NOTHING — it reads only whether
 * a passport is on file. `--commit` writes, after a backup of every row it
 * touches; each passport is opened the way the app opens one: an audit row
 * («passport.viewed», purpose backfill_names, the full name only) FIRST, the
 * same transaction, and no name is ever printed.
 *
 *   node scripts/backfill-passport-names-2026-10-18.mjs [--commit] [--clear-unread]
 */
import { createDecipheriv } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const CLEAR_UNREAD = process.argv.includes("--clear-unread");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);

/** src/lib/crypto/secrets.ts decryptSecret: base64(iv 12 | tag 16 | ciphertext), AES-256-GCM. */
function passportName(blob) {
  const key = Buffer.from(env.SETTINGS_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY is missing or not 32 bytes");
  try {
    const raw = Buffer.from(blob, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    return typeof json?.full_name === "string" ? json.full_name.trim() : "";
  } catch {
    return null; // tampered or a different key — counted, never guessed
  }
}

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;

try {
  const hasSource =
    (await q(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'operation_travelers' and column_name = 'name_source'`))
      .length > 0;
  const norm = (col) => `lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`;
  // the passport's presence as a yes/no computed in the database — the dry run never fetches a blob
  const picked = await q(`
    select * from (
      select t.id, t.operation_id, f.serial, t.display_name,
             ${hasSource ? "t.name_source" : "null::text as name_source"},
             row_number() over (partition by t.operation_id order by t.sort, t.created_at) as n,
             (t.passport_encrypted is not null) as has_passport,
             ${norm("t.display_name")} = ${norm("c.arabic_name")} as is_contact
        from operation_travelers t
        join operations o on o.id = t.operation_id
        join offers f on f.id = o.offer_id
        join customers c on c.id = f.customer_id
    ) x
     where btrim(display_name) <> '' and is_contact${hasSource ? " and name_source = 'seed'" : ""}
     order by serial, n`);
  const withPassport = picked.filter((r) => r.has_passport);
  const unread = picked.filter((r) => !r.has_passport);

  console.log(`0091 applied: ${hasSource ? "yes" : "no (every name equal to the contact name counts)"}`);
  console.log(`travellers still carrying the client's contact name: ${picked.length}`);
  console.log(`  a. passport on file → its name: ${withPassport.length}`);
  for (const r of withPassport) console.log(`     ${r.serial} — traveller ${r.n}`);
  console.log(`  b. no passport yet → ${CLEAR_UNREAD ? "unnamed" : "left as is (--clear-unread to unname)"}: ${unread.length}`);
  for (const r of unread) console.log(`     ${r.serial} — traveller ${r.n}`);

  if (!COMMIT) {
    console.log("\ndry run — no passport opened, nothing written; pass --commit to apply");
  } else {
    const touched = [...withPassport, ...(CLEAR_UNREAD ? unread : [])];
    const backup = { operation_travelers: touched.map((r) => ({ id: r.id, operation_id: r.operation_id, display_name: r.display_name, name_source: r.name_source })) };
    mkdirSync("data-import/backups", { recursive: true });
    const file = `data-import/backups/backfill-passport-names-2026-10-18-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(backup, null, 1));
    console.log("\nbackup:", file);

    await q("begin");
    let renamed = 0;
    let skipped = 0;
    for (const r of withPassport) {
      const [{ passport_encrypted: blob } = {}] = await q(`select passport_encrypted from operation_travelers where id = $1`, [r.id]);
      if (!blob) {
        skipped += 1;
        continue;
      }
      // the audit row FIRST, as getTravelerPassport does: who opened which passport, and why
      await q(
        `insert into audit_logs (actor_id, actor_email, action, entity, entity_id, meta) values (null, 'backfill-passport-names', 'passport.viewed', 'operation_travelers', $1, $2::jsonb)`,
        [r.id, JSON.stringify({ operation_id: r.operation_id, purpose: "backfill_names", fields: ["full_name"] })],
      );
      const name = passportName(blob);
      if (!name) {
        skipped += 1;
        continue;
      }
      await q(`update operation_travelers set display_name = $2, updated_at = now()${hasSource ? ", name_source = 'passport'" : ""} where id = $1`, [r.id, name]);
      renamed += 1;
    }
    let cleared = 0;
    if (CLEAR_UNREAD) {
      for (const r of unread) {
        await q(`update operation_travelers set display_name = '', updated_at = now() where id = $1`, [r.id]);
        cleared += 1;
      }
    }
    await q("commit");
    console.log(`committed: ${renamed} named from the passport, ${skipped} skipped (no readable name), ${cleared} unnamed`);
  }
} catch (error) {
  await q("rollback").catch(() => {});
  console.error("rolled back:", error.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
