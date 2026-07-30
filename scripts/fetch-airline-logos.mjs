// Fetch each carrier's mark ONCE into the public `airlines` bucket and record the
// path on the row. Usage: node scripts/fetch-airline-logos.mjs [--force]
//
// Why store instead of hotlinking: the offer PDF is printed by headless Chromium
// from setContent with NO network, so a remote <img> would print as a broken box —
// and a client link that depends on someone else's CDN staying up is a document
// that decays. Fetched once, ours from then on.
//
// Source: pics.avs.io (200x50 transparent PNG, keyed by IATA designator). It
// answers 404 for a designator it does not know, which is what makes it safe to
// trust — an unknown carrier gets no logo rather than a placeholder we would then
// print as if it were the airline's mark.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const force = process.argv.includes("--force");
const BUCKET = "airlines";
const SOURCES = [(iata) => `https://pics.avs.io/200/50/${iata}.png`, (iata) => `https://images.kiwi.com/airlines/64/${iata}.png`];

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(
  force
    ? "select iata, arabic_name from airlines order by iata"
    : "select iata, arabic_name from airlines where logo_path is null order by iata",
);
console.log(`${rows.length} carriers to fetch${force ? " (forced)" : ""}`);

let stored = 0;
let missing = [];

for (const row of rows) {
  let bytes = null;
  let from = null;
  for (const build of SOURCES) {
    const url = build(row.iata);
    try {
      const res = await fetch(url);
      // 303 is this CDN's way of handing back a generic placeholder; treat it as
      // "not found" rather than printing someone else's shape as the airline's.
      if (res.status !== 200) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 400) continue;
      bytes = buf;
      from = new URL(url).host;
      break;
    } catch {
      /* try the next source */
    }
  }

  if (!bytes) {
    missing.push(row.iata);
    continue;
  }

  const path = `${row.iata}.png`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!upload.ok) {
    console.log(`  ! ${row.iata} upload failed: ${upload.status} ${await upload.text()}`);
    continue;
  }

  await client.query("update airlines set logo_path = $1 where iata = $2", [path, row.iata]);
  stored += 1;
  console.log(`  ✓ ${row.iata.padEnd(3)} ${row.arabic_name}  (${bytes.byteLength} B from ${from})`);
}

console.log(`\nstored ${stored}, without a mark: ${missing.length ? missing.join(", ") : "none"}`);
await client.end();
