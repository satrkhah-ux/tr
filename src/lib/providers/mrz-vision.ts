import "server-only";
import sharp from "sharp";
import { parseTd3, type MrzPassport } from "@/lib/operations/mrz";

/**
 * Passport photo → the passport fields, by OpenAI vision.
 *
 * The model is asked to TRANSCRIBE, not to understand: the lines go to the pure
 * parser (src/lib/operations/mrz.ts), whose check digits catch a misread
 * character, and the employee reviews every field before anything is saved.
 * Gated on the same key as the other assistants (isOpenAIConfigured) — without
 * it the button is not drawn.
 *
 * The owner, 2026-10-22: «الجوازات لا يقرأها بالشكل الصحيح» — 15 reads since
 * 10-15, none passed every check digit. The raw photo went to gpt-4o-mini,
 * which shrinks it to ~768 px: the MRZ was a few pixels tall. Now the bottom of
 * the page (the MRZ band) goes enlarged, grey and stretched, beside the whole
 * page (for the printed and Arabic names), to a stronger model; a band that
 * fails a check is read once more from the whole page, and the better read wins.
 *
 * SERVER-ONLY: the key never reaches the browser; read at runtime like openai.ts.
 *   OPENAI_PASSPORT_MODEL  optional — the passport reader (default gpt-4o)
 *   OPENAI_MODEL           the fallback when the account cannot use that one
 */

const PASSPORT_MODEL = "gpt-4o";
const FALLBACK_MODEL = "gpt-4o-mini";

export type PassportReadResult =
  /** passport null: the lines did not parse as a passport MRZ */
  | { ok: true; passport: MrzPassport | null; model: string }
  | { ok: false; error: "not_configured" | "request_failed" | "bad_response" };

type Image = { mime: string; base64: string };
type Answer = { line1: string; line2: string; printed_name: string; arabic_name: string; model: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["line1", "line2", "printed_name", "arabic_name"],
  properties: {
    line1: { type: "string" },
    line2: { type: "string" },
    printed_name: { type: "string" },
    arabic_name: { type: "string" },
  },
} as const;

const RULES = [
  "line1, line2: the two machine-readable zone (MRZ) lines at the bottom of the page, EXACTLY, character for character.",
  "Each line has 44 characters from A-Z, 0-9 and '<'. Count the '<' and keep every one. Do not correct, translate or guess.",
  // given names first: how full_name (mrz.ts) and a ticket write it
  "printed_name: the holder's name as PRINTED in Latin letters on the page (not from the MRZ), in full: the given names, then the surname.",
  "arabic_name: the holder's name in Arabic script when the page prints one, as printed.",
  "Whatever is not visible or not readable: an empty string.",
];
const BAND = "Image 1 is the bottom of a passport's data page, enlarged and in grey for the MRZ; image 2 is the whole page. Read the MRZ from image 1 (from image 2 only if image 1 does not show it) and the names from image 2.";
const PAGE = "This is a photo of a passport's data page.";

/** Upright by EXIF; the bottom 30 % (the MRZ band) at least 1600 px wide, grey and stretched; the whole page at the same width. Null when sharp cannot open it. */
async function prepare(bytes: Buffer): Promise<{ band: Image; page: Image } | null> {
  try {
    const { data, info } = await sharp(bytes).rotate().raw().toBuffer({ resolveWithObject: true });
    const upright = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    // OpenAI fits an image within 2048 px anyway
    const width = Math.min(Math.max(info.width, 1600), 2048);
    const top = Math.floor(info.height * 0.7);
    const [band, page] = await Promise.all([
      upright().extract({ left: 0, top, width: info.width, height: info.height - top }).resize({ width }).grayscale().normalise().sharpen().png().toBuffer(),
      upright().resize({ width }).jpeg({ quality: 90 }).toBuffer(),
    ]);
    return { band: { mime: "image/png", base64: band.toString("base64") }, page: { mime: "image/jpeg", base64: page.toString("base64") } };
  } catch {
    return null;
  }
}

async function ask(key: string, intro: string, images: Image[]): Promise<Answer | "request_failed" | "bad_response"> {
  const models = [...new Set([process.env["OPENAI_PASSPORT_MODEL"] || PASSPORT_MODEL, process.env["OPENAI_MODEL"] || FALLBACK_MODEL])];
  for (const model of models) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: [intro, ...RULES].join("\n") },
                ...images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: "high" } })),
              ],
            },
          ],
          response_format: { type: "json_schema", json_schema: { name: "passport_page", strict: true, schema: SCHEMA } },
        }),
      });
      // a model this account cannot use: the shared one next
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const a = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as Partial<Record<keyof Answer, unknown>>;
      if (typeof a.line1 !== "string" || typeof a.line2 !== "string") return "bad_response";
      const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
      return { line1: a.line1, line2: a.line2, printed_name: text(a.printed_name).toUpperCase(), arabic_name: text(a.arabic_name), model };
    } catch {
      return "request_failed";
    }
  }
  return "request_failed";
}

const parse = (a: Answer, today: string) => {
  const res = parseTd3(`${a.line1}\n${a.line2}`, today);
  return res.ok ? res.passport : null;
};
/** checks passed, of five; -1 for no MRZ at all */
const score = (p: MrzPassport | null) => (p ? 5 - p.failed.length : -1);

export async function readPassportImage(file: { mime: string; bytes: Buffer }, today: string): Promise<PassportReadResult> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return { ok: false, error: "not_configured" };
  const prepared = await prepare(file.bytes);
  // an image sharp cannot open goes as it came, as before
  const first = prepared
    ? await ask(key, BAND, [prepared.band, prepared.page])
    : await ask(key, PAGE, [{ mime: file.mime, base64: file.bytes.toString("base64") }]);
  if (typeof first === "string") return { ok: false, error: first };

  let passport = parse(first, today);
  let model = first.model;
  let { printed_name, arabic_name } = first;
  if (prepared && score(passport) < 5) {
    // the band failed a check digit, or held no MRZ (a photo taken sideways): once more on the whole page
    const second = await ask(key, PAGE, [prepared.page]);
    if (typeof second !== "string") {
      const again = parse(second, today);
      if (score(again) > score(passport)) [passport, model] = [again, second.model];
      printed_name ||= second.printed_name;
      arabic_name ||= second.arabic_name;
    }
  }
  if (!passport) return { ok: true, passport: null, model };
  return {
    ok: true,
    passport: { ...passport, ...(printed_name ? { printed_name } : {}), ...(arabic_name ? { arabic_name } : {}) },
    model,
  };
}
