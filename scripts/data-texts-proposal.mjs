/**
 * Order 9 — visas onto /countries, and the English of «يشمل / لا يشمل / الشروط».
 * READ ONLY → data-import/data-texts-proposal.json.
 *
 *   node scripts/data-texts-proposal.mjs          rules only
 *   node scripts/data-texts-proposal.mjs --ai     + an English draft from OpenAI for
 *                                                 each flagged line (OPENAI_API_KEY in
 *                                                 .env.local; OPENAI_MODEL optional)
 *
 * Sections, each item with `ok` (true = the apply does it):
 *   visas    the old static /visas rows (src/lib/traveliun-pages.generated.json),
 *            each with the country of /countries its free text names («Fransa»,
 *            «russia», «Singaporean»). Moved into the visas table (0072) —
 *            the text kept in `country`, the match in `country_id`.  ok: true when matched
 *   terms    English that cannot print as is: missing, Arabic inside, a number
 *            moved to the end by the old right-to-left editor («hour customer
 *            service in english 24»). `to` is a suggestion                ok: false
 *            Only spacing / a first capital letter                         ok: true
 *
 * NOT here — hotels: the Arabic spelling of the hotels with a Latin «Arabic»
 * name (and the English fields holding Arabic) are reviewed on the existing
 * review page (order 1, ~240 names, catalog-cleanup's 277 «latin» items).
 * Doing them twice would give the owner two lists that disagree.
 */
import { readFileSync } from "node:fs";
import { arg, env, propose } from "./data-model-lib.mjs";
import { normAr, normEn } from "../src/lib/catalog/norm.ts";

const AI = process.argv.includes("--ai");
/** Free-text country names the old /visas page used, folded → an English country name. */
const COUNTRY_ALIAS = new Map([
  ["fransa", "france"],
  ["almanya", "germany"],
  ["ispanya", "spain"],
  ["italya", "italy"],
  ["ingiltere", "united kingdom"],
  ["uk", "united kingdom"],
  ["england", "united kingdom"],
  ["usa", "united states"],
  ["america", "united states"],
  ["turkiye", "turkey"],
]);
const hasArabic = (s) => /[ء-ي]/.test(s ?? "");

/** One English draft for an Arabic line — only with --ai and a key. */
async function draftEnglish(arabic) {
  const key = env().OPENAI_API_KEY;
  if (!AI || !key) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env().OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Translate this line from a Saudi travel agency's package terms into short, natural English for the client's document. Keep numbers and names. Reply with the English line only.",
        },
        { role: "user", content: arabic },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || null;
}

await propose("texts", async (q) => {
  // ---- visas ----
  const pages = JSON.parse(readFileSync(arg("pages", "src/lib/traveliun-pages.generated.json"), "utf8"));
  const page = Array.isArray(pages) ? pages.find((p) => p.route === "/visas") : pages["/visas"];
  const countries = await q("select id, arabic_name, english_name from public.countries");
  const findCountry = (text) => {
    const en = normEn(text);
    const wanted = COUNTRY_ALIAS.get(en) ?? en;
    return (
      countries.find((c) => normAr(c.arabic_name) === normAr(text)) ??
      countries.find((c) => wanted && normEn(c.english_name) === wanted) ??
      // «Singaporean» → Singapore: the name the adjective starts with
      countries.find((c) => wanted && normEn(c.english_name) && wanted.startsWith(normEn(c.english_name))) ??
      null
    );
  };
  const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const visas = (page?.rows ?? []).map((r) => {
    const country = findCountry(r.country);
    return {
      country: r.country,
      country_id: country?.id ?? null,
      country_name: country?.arabic_name ?? null,
      visa_type: r.visa_type || null,
      buy_price: num(r.buy_price),
      buy_currency: r.buy_currency || null,
      sell_price: num(r.sell_price),
      sell_currency: r.sell_currency || null,
      arabic_requirements: r.arabic_requirements || null,
      english_requirements: r.english_requirements || null,
      ok: Boolean(country),
    };
  });
  // a failed query would end the read-only transaction, so ask whether the table exists first
  const [{ exists }] = await q("select to_regclass('public.visas') is not null as exists");
  const visasInTable = exists ? (await q("select count(*)::int n from public.visas"))[0].n : null;

  // ---- terms: the English that would print wrong ----
  const terms = [];
  for (const t of await q("select id, kind, arabic_text, english_text from public.terms order by kind, sort")) {
    const en = (t.english_text ?? "").trim();
    let issue = null;
    let to = en;
    if (!en) issue = "missing";
    else if (hasArabic(en)) issue = "arabic_in_english";
    else if (/\s\d+$/.test(en) && !/^\d/.test(en)) {
      issue = "number_moved";
      const [, rest, n] = en.match(/^(.*\S)\s+(\d+)$/);
      to = `${n}-${rest}`;
    } else {
      to = en.replace(/\s+/g, " ").replace(/^[a-z]/, (c) => c.toUpperCase());
      if (to !== en) issue = "tidy";
    }
    if (!issue) continue;
    if (issue !== "tidy") to = (await draftEnglish(t.arabic_text)) ?? (issue === "number_moved" ? to : "");
    terms.push({ id: t.id, kind: t.kind, arabic: t.arabic_text, from: t.english_text, to, issue, ai: AI && issue !== "tidy", ok: issue === "tidy" });
  }

  const notes = [
    "hotels skipped: their Latin-in-Arabic names are on the review page (order 1)",
    ...(visasInTable === null ? ["0072 is not applied: no visas table yet; the apply needs it"] : visasInTable > 0 ? [`the visas table already has ${visasInTable} rows: the apply only fills their country_id`] : []),
    ...(AI && !env().OPENAI_API_KEY ? ["--ai given but no OPENAI_API_KEY: rule suggestions only"] : []),
  ];
  console.log(`visas ${visas.length} (${visas.filter((v) => v.ok).length} matched), terms ${terms.length} (${terms.filter((t) => t.ok).length} tidy-only)`);
  return { notes, visas, terms };
});
