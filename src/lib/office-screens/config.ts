/**
 * «الشاشات» settings (app_settings.office_screens) and the words the screens
 * show. Pure — the settings page, the screen route and the tests share it.
 */
export const SCREENS_SETTING = "office_screens";
export const SCREENS_BUCKET = "office-screens";
export const SCREEN_KINDS = ["بكج", "فنادق", "طيران", "تأشيرات", "يستفسر"] as const;
/** the screens' copy of an ad: 1920×1080 (TV browsers lay out at 1080p; a 4K decode stutters on their chips) */
export const AD_WIDTH = 1920;
export const AD_HEIGHT = 1080;
export const AD_MAX_BYTES = 15 * 1024 * 1024;

export type ScreenAd = { id: string; name: string; active: boolean };
export type ScreensConfig = {
  /** how many screens hang in the office */
  screens: number;
  /** the screen numbers as they hang, from the LEFT to the right — the ads and the ticker move that way */
  order: number[];
  slotSec: number;
  /** which kinds of request alert («بكج» by default) */
  kinds: string[];
  /** the ticker's speed, in pixels a second of a 1920-wide screen */
  tickerSpeed: number;
  /** the band comes up every this many minutes for one pass (the owner: «كل 10 دقائق»), and when its words change */
  tickerEveryMin: number;
  /** until when every load of a screen runs the demo — one pass and a «تجربة» alert (the owner, 2026-10-19: while the TVs are set up) */
  demoUntil: string;
  ads: ScreenAd[];
};

export const SCREENS_DEFAULT: ScreensConfig = { screens: 4, order: [1, 2, 3, 4], slotSec: 12, kinds: ["بكج"], tickerSpeed: 110, tickerEveryMin: 10, demoUntil: "2026-10-20T21:00:00.000Z", ads: [] };

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function normalizeConfig(raw: unknown): ScreensConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ScreensConfig>;
  const screens = clamp(r.screens, 1, 9, SCREENS_DEFAULT.screens);
  // every screen exactly once: what the order names first, then any it left out
  const named = (Array.isArray(r.order) ? r.order : []).map(Number).filter((n, i, a) => n >= 1 && n <= screens && a.indexOf(n) === i);
  const order = [...named, ...Array.from({ length: screens }, (_, i) => i + 1).filter((n) => !named.includes(n))];
  const kinds = (Array.isArray(r.kinds) ? r.kinds : SCREENS_DEFAULT.kinds).filter((k): k is string => (SCREEN_KINDS as readonly string[]).includes(k as string));
  const ads = (Array.isArray(r.ads) ? r.ads : [])
    .filter((a): a is ScreenAd => Boolean(a && typeof a.id === "string" && /^[a-z0-9-]{4,40}$/.test(a.id)))
    .map((a) => ({ id: a.id, name: String(a.name ?? "").slice(0, 60), active: a.active !== false }));
  return { screens, order, slotSec: clamp(r.slotSec, 4, 120, SCREENS_DEFAULT.slotSec), kinds, tickerSpeed: clamp(r.tickerSpeed, 30, 400, SCREENS_DEFAULT.tickerSpeed), tickerEveryMin: clamp(r.tickerEveryMin, 2, 120, SCREENS_DEFAULT.tickerEveryMin), demoUntil: Number.isFinite(Date.parse(String(r.demoUntil))) ? new Date(String(r.demoUntil)).toISOString() : SCREENS_DEFAULT.demoUntil, ads };
}

/** where screen n hangs, 0 = the leftmost; −1 when the office has no screen n */
export function positionOf(cfg: ScreensConfig, n: number): number {
  return n >= 1 && n <= cfg.screens ? cfg.order.indexOf(n) : -1;
}

/** the alert's big line (the owner, 2026-10-20: encouragement, not «طلب»): «بكج إلى تركيا», «فندق في تركيا» … */
export function serviceLine(kind: string, country: string): string {
  if (kind === "يستفسر") return `استفسار عن ${country}`;
  if (kind === "فنادق") return `فندق في ${country}`;
  if (kind === "طيران") return `طيران إلى ${country}`;
  if (kind === "تأشيرات") return `تأشيرة إلى ${country}`;
  return `بكج إلى ${country}`;
}

const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const RIYADH_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

/** the Riyadh day (its midnight, in UTC ms) a moment falls on */
export function riyadhDay(ms: number): number {
  return Math.floor((ms + RIYADH_MS) / DAY_MS) * DAY_MS - RIYADH_MS;
}

function dayLabel(dayStart: number): string {
  const d = new Date(dayStart + RIYADH_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  // the digits in a left-to-right isolate: inside Arabic text the bidi rules would otherwise print 19-10-2026 as 2026-10-19
  return `${DAYS[d.getUTCDay()]} ${LRI}${dd}-${mm}-${d.getUTCFullYear()}${PDI}`;
}

/**
 * The ticker (the owner, 2026-10-19): today's most requested countries, Saudi
 * never among them (a Saudi place is where the client is — resolvePlace), the
 * top 8 by conversations, no counts. Fewer than 3 today → yesterday's, with its
 * own date. `days` maps a lead's countries to the Riyadh days it was active.
 */
/** a Riyadh day's most requested countries, most first, eight at most */
export function topCountries(leads: { country: string; days: number[] }[], day: number): string[] {
  return countryRanking(leads, day).map((r) => r.country);
}

export function countryRanking(leads: { country: string; days: number[] }[], day: number): { country: string; count: number }[] {
  const count = new Map<string, number>();
  for (const l of leads) if (l.days.includes(day)) count.set(l.country, (count.get(l.country) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar")).slice(0, 8).map(([country, count]) => ({ country, count }));
}

export function tickerText(leads: { country: string; days: number[] }[], now: number): string | null {
  const today = riyadhDay(now);
  const top = (day: number) => topCountries(leads, day);
  const t = top(today);
  if (t.length >= 3) return `الدول الأكثر طلباً اليوم — ${dayLabel(today)}: ${t.join(" · ")}`;
  const y = top(today - DAY_MS);
  if (y.length) return `الدول الأكثر طلباً أمس — ${dayLabel(today - DAY_MS)}: ${y.join(" · ")}`;
  return t.length ? `الدول الأكثر طلباً اليوم — ${dayLabel(today)}: ${t.join(" · ")}` : null;
}

/** room for the ticker's text in reference pixels (42 px Arabic, bold) — every screen agrees on it; a screen whose font runs wider shrinks to fit */
export const TICKER_FONT_REF = 42;
export function tickerWidth(text: string): number {
  return Math.ceil(text.length * TICKER_FONT_REF * 0.45 + TICKER_FONT_REF * 2);
}

const PLACEHOLDER = /^(عميل|زبون|unknown|customer|client|test|guest)$/i;
const KEEP = /[ء-يA-Za-zً-ْ'-]/g;

/**
 * The client's name on the alert (the owner, 2026-10-20: «الاسم واللقب أو الاسم
 * الذي مكتوب لدينا» — he chose it knowing the screens are open): the name as
 * recorded on «العملاء», at most three words, Latin as written. A phone or a
 * number, emoji, «#123» or a placeholder («عميل», «Unknown») is no name — the
 * alert then says only «بكج إلى تركيا». Nothing else about the client is sent.
 */
export function displayName(raw: string | null | undefined): string | null {
  const words = (raw ?? "")
    .split(/\s+/)
    .filter((w) => !w.startsWith("#") && !/\d{3,}/.test(w))
    .map((w) => (w.match(KEEP) ?? []).join(""))
    .filter((w) => w.length > 0 && w !== "-" && w !== "'");
  if (!words.length || (words.length === 1 && PLACEHOLDER.test(words[0]))) return null;
  return words.slice(0, 3).join(" ");
}
