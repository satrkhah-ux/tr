// «المطار» (0099): put Almatar's Arabic logo (from almatar.com) in the public
// `brands` bucket and point its booking_partners row at it, so its portal and
// its vouchers carry its own mark. Run AFTER 0099 is applied.
//
//   node scripts/almatar-setup.mjs            dry run (default)
//   node scripts/almatar-setup.mjs --commit   upload + set logo_path
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const commit = process.argv.includes("--commit");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data: company, error } = await admin.from("booking_partners").select("id, name, logo_path").eq("slug", "almatar").maybeSingle();
if (error || !company) {
  console.error("no Almatar row — apply 0099 first", error?.message ?? "");
  process.exitCode = 1;
} else {
  const res = await fetch("https://almatar.com/assets/img/almatar_logo_ar.png", { headers: { "user-agent": "Mozilla/5.0" } });
  const png = Buffer.from(await res.arrayBuffer());
  const isPng = png.subarray(0, 4).toString("hex") === "89504e47";
  const path = `${company.id}/almatar-logo-ar.png`;
  console.log(`Almatar ${company.id} — logo now: ${company.logo_path ?? "none"}; fetched ${png.length} bytes, png=${isPng}`);
  if (!isPng) {
    console.error("not a PNG — nothing written");
    process.exitCode = 1;
  } else if (!commit) {
    console.log(`dry run — would upload brands/${path}. Re-run with --commit.`);
  } else {
    const up = await admin.storage.from("brands").upload(path, png, { contentType: "image/png", upsert: true });
    if (up.error) throw up.error;
    const set = await admin.from("booking_partners").update({ logo_path: path }).eq("id", company.id);
    if (set.error) throw set.error;
    console.log(`uploaded brands/${path} and set logo_path`);
  }
}
