// Submit the client's WhatsApp templates (WA_TEMPLATES in src/lib/operations/client-messages.ts)
// to Meta for approval, through the same WhatsApp Business account Teletel sends from.
//
// Only the messages switched on in /settings/client-comms, the programme and the booking update.
// Usage: node scripts/submit-wa-templates.mjs            (dry run: prints what would be sent)
//        node scripts/submit-wa-templates.mjs --submit   (submits the ones not already on the account)
//        … --only=traveliun_program_ready,traveliun_program_updated   (just these)
//
// The Meta token and the business account id are read from Teletel's WhatsApp inbox
// (TELETEL_* in .env.local) at run time and never printed. Templates already on the
// account — any status — are skipped: Meta refuses a second one with the same name.
// Teletel syncs approved templates back on its own; nothing else to do afterwards.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { WA_TEMPLATES } from "../src/lib/operations/client-messages.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUBMIT = process.argv.includes("--submit");
const GRAPH = "https://graph.facebook.com/v21.0";
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);
const base = env.TELETEL_BASE_URL.replace(/\/$/, "");
const tl = (path) =>
  fetch(`${base}/api/v1/accounts/${env.TELETEL_ACCOUNT_ID || "1"}${path}`, { headers: { api_access_token: env.TELETEL_API_TOKEN } }).then((r) => r.json());

const inboxes = (await tl("/inboxes")).payload ?? [];
const inbox = inboxes.find((i) => i.channel_type === "Channel::Whatsapp" && i.provider === "whatsapp_cloud");
if (!inbox) throw new Error("no WhatsApp Cloud inbox on Teletel");
const detail = await tl(`/inboxes/${inbox.id}`);
const token = detail.provider_config?.api_key;
const waba = detail.provider_config?.business_account_id;
if (!token || !waba) throw new Error("the inbox does not expose its Meta connection");
const existing = new Map((detail.message_templates ?? []).map((t) => [t.name, t.status]));

// only the messages a manager has switched on (/settings/client-comms) — and the programme
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const enabled = new Set((await db.query("select key from public.client_message_templates where enabled")).rows.map((r) => r.key));
await db.end();

// Meta wants one example value per variable, in the template's own order
const SAMPLE = {
  name: "أحمد",
  destination: "ماليزيا",
  serial: "AD-6-3056-20261017",
  date: "الخميس، 20 نوفمبر",
  link: "https://pkg.traveliun.com/trip/abc123",
  discount: "300 ريال",
};

/** A sample PDF for a document header: Meta wants an uploaded example file. */
async function documentHandle() {
  const debug = await fetch(`${GRAPH}/debug_token?input_token=${token}&access_token=${token}`).then((r) => r.json());
  const appId = debug?.data?.app_id;
  if (!appId) return null;
  const pdf = Buffer.from(
    "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  const session = await fetch(`${GRAPH}/${appId}/uploads?file_name=sample.pdf&file_length=${pdf.length}&file_type=application/pdf&access_token=${token}`, {
    method: "POST",
  }).then((r) => r.json());
  if (!session?.id) return null;
  const up = await fetch(`${GRAPH}/${session.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0" },
    body: pdf,
  }).then((r) => r.json());
  return up?.h ?? null;
}

// --only=name1,name2: submit just these templates
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean);

for (const [key, def] of Object.entries(WA_TEMPLATES)) {
  if (only && !only.includes(def.name)) continue;
  // the programme and the prepared booking updates are always sent by a person — no switch to wait for
  if (!["programme", "programme_updated", "booking_update", "payment_due", "coupon"].includes(key) && !key.startsWith("offer_followup_") && !enabled.has(key)) continue;
  if (existing.has(def.name)) {
    console.log(`= ${def.name}: already on the account (${existing.get(def.name)})`);
    continue;
  }
  const components = [{ type: "BODY", text: def.body, example: { body_text: [def.params.map((p) => SAMPLE[p])] } }];
  if (def.document) {
    const handle = SUBMIT ? await documentHandle() : "<uploaded sample pdf>";
    if (!handle) {
      console.log(`! ${def.name}: could not upload the sample PDF — create this one by hand in WhatsApp Manager (header: Document)`);
      continue;
    }
    components.unshift({ type: "HEADER", format: "DOCUMENT", example: { header_handle: [handle] } });
  }
  const payload = { name: def.name, language: "ar", category: def.category ?? "UTILITY", components };
  if (!SUBMIT) {
    console.log(`- would submit ${def.name}:\n${JSON.stringify(payload, null, 2)}\n`);
    continue;
  }
  const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
  console.log(
    res.id
      ? `+ ${def.name}: submitted (${res.status ?? "PENDING"}, ${res.category ?? ""})`
      : `! ${def.name}: ${[res.error?.message, res.error?.error_user_title, res.error?.error_user_msg].filter(Boolean).join(" — ") || JSON.stringify(res)}`,
  );
}
