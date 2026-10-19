/**
 * Google Ads → «رؤية للإعلانات» (the owner, 2026-10-19). Pure: what the
 * owner's Ads Script posts, made into rows — and which country a campaign
 * sells, from its name. The doing is app/api/ads/hook.
 *
 * Two shapes are read:
 *  · v2 (the new script): `{ v: 2, currency, days: [{ date, final, campaigns }],
 *    locations, terms, hours }` — every row dated by the account (Riyadh);
 *  · v1 (the bot's, its 22 archives): `{ currency, totals, campaigns: [{ name,
 *    status, today, yesterday }] }` — «today» is the day it was received
 *    (`receivedAtKsa`), partial; «yesterday» the day before, closed.
 */

export type AdDayRow = { day: string; campaign: string; status: string | null; cost: number; clicks: number; impressions: number; conversions: number; currency: string | null; final: boolean };
export type AdLocationRow = { day: string; campaign: string; country: string; city: string; clicks: number; impressions: number; cost: number };
export type AdTermRow = { day: string; campaign: string; term: string; clicks: number; impressions: number; cost: number; conversions: number };
export type AdHourRow = { day: string; campaign: string; hour: number; clicks: number; impressions: number; cost: number };
export type AdRows = { days: AdDayRow[]; locations: AdLocationRow[]; terms: AdTermRow[]; hours: AdHourRow[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** at most this many rows of each kind in one post — the script sends a week at a time */
export const MAX_ROWS = 20_000;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const int = (v: unknown) => Math.round(num(v));
const text = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.slice(0, MAX_ROWS).map(obj) : []);

const shift = (day: string, by: number) => new Date(Date.parse(`${day}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** The rows a post carries, or null when it is neither shape. `today`: the Riyadh day it arrived, for a v1 post without its own. */
export function rowsFromPayload(payload: unknown, today: string): AdRows | null {
  const p = obj(payload);
  const currency = text(p.currency, 8) || null;
  const out: AdRows = { days: [], locations: [], terms: [], hours: [] };
  const metrics = (m: Record<string, unknown>) => ({ cost: num(m.cost), clicks: int(m.clicks), impressions: int(m.impressions), conversions: num(m.conversions) });

  if (Array.isArray(p.days)) {
    for (const d of list(p.days)) {
      const day = text(d.date, 10);
      if (!DAY.test(day)) continue;
      for (const c of list(d.campaigns)) {
        const campaign = text(c.name);
        if (campaign) out.days.push({ day, campaign, status: text(c.status, 20) || null, ...metrics(c), currency, final: d.final === true });
      }
    }
    for (const r of list(p.locations)) {
      const day = text(r.date, 10);
      const campaign = text(r.campaign);
      const country = text(r.country, 80);
      if (DAY.test(day) && campaign && country) out.locations.push({ day, campaign, country, city: text(r.city, 120), clicks: int(r.clicks), impressions: int(r.impressions), cost: num(r.cost) });
    }
    for (const r of list(p.terms)) {
      const day = text(r.date, 10);
      const campaign = text(r.campaign);
      const term = text(r.term, 200);
      if (DAY.test(day) && campaign && term) out.terms.push({ day, campaign, term, clicks: int(r.clicks), impressions: int(r.impressions), cost: num(r.cost), conversions: num(r.conversions) });
    }
    for (const r of list(p.hours)) {
      const day = text(r.date, 10);
      const campaign = text(r.campaign);
      const hour = int(r.hour);
      if (DAY.test(day) && campaign && hour >= 0 && hour <= 23) out.hours.push({ day, campaign, hour, clicks: int(r.clicks), impressions: int(r.impressions), cost: num(r.cost) });
    }
    return out;
  }

  if (Array.isArray(p.campaigns)) {
    const received = text(p.receivedAtKsa, 16).slice(0, 10);
    const day = DAY.test(received) ? received : today;
    for (const c of list(p.campaigns)) {
      const campaign = text(c.name);
      if (!campaign) continue;
      const status = text(c.status, 20) || null;
      if (c.yesterday) out.days.push({ day: shift(day, -1), campaign, status, ...metrics(obj(c.yesterday)), currency, final: true });
      if (c.today) out.days.push({ day, campaign, status, ...metrics(obj(c.today)), currency, final: false });
    }
    return out;
  }
  return null;
}

/**
 * The country a campaign sells, from its name («003 بحث ماليزيا 🟩 كامل» →
 * ماليزيا) — the bot's own table (traveliun-bot src/ads.js CAMP_DEST), the
 * visa campaigns as «تأشيرات», and a general one («بحث عام», «شامل») as «عام».
 */
const CAMP_DEST: [string, string][] = [
  ["ماليزيا", "ماليزيا"],
  ["تايل", "تايلاند"],
  ["اسطنبول", "تركيا"],
  ["طرابزون", "تركيا"],
  ["تركيا", "تركيا"],
  ["اندونيسيا", "إندونيسيا"],
  ["بالي", "إندونيسيا"],
  ["فيتنام", "فيتنام"],
  ["دبي", "الإمارات"],
  ["الامارات", "الإمارات"],
  ["سنغافور", "سنغافورة"],
  ["لندن", "بريطانيا"],
  ["بريطانيا", "بريطانيا"],
  ["اوروبا", "أوروبا"],
  ["اوربا", "أوروبا"],
  ["اذربيجان", "أذربيجان"],
  ["البوسن", "البوسنة"],
  ["جورجيا", "جورجيا"],
  ["المالديف", "المالديف"],
  ["موريشيوس", "موريشيوس"],
  ["كوريا", "كوريا"],
  ["مكه", "السعودية (داخلي)"],
  ["المدينه", "السعودية (داخلي)"],
  ["كروز", "كروز"],
  ["فيزا", "تأشيرات"],
  ["تاشير", "تأشيرات"],
  ["visa", "تأشيرات"],
  ["عام", "عام"],
  ["شامل", "عام"],
];

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[إأآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

export function campaignCountry(name: string): string {
  const n = fold(name);
  return CAMP_DEST.find(([k]) => n.includes(fold(k)))?.[1] ?? "عام";
}
