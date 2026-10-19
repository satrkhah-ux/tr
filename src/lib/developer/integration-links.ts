/**
 * «الربط الخارجي» — the link to open each thing at (the owner, 2026-10-19:
 * «أريد تظهر الروابط الموجودة في النظام»). Read from where the system itself
 * reads it — the ready-offers sheet from app_settings or its env, the leads
 * sheet, Teletel's address, the site — so the link is the one in use, not one
 * typed beside it; a bot's is its @name, and a link typed in the row's notes
 * still shows. A webhook or any URL carrying a key is never one of them.
 *
 * Pure: the caller gathers the context.
 */

export type IntegrationLink = { url: string; label: string };

export type LinkContext = {
  /** the deployed system, e.g. https://pkg.traveliun.com */
  site: string;
  readySheet: string | null;
  leadsSheet: string | null;
  /** Teletel's browser address (TELETEL_BASE_URL) */
  teletel: string | null;
};

const sheet = (id: string | null): IntegrationLink | null =>
  id ? { url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`, label: "فتح الشيت" } : null;

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

/** By the row's automatic check — what the system is wired to. */
function byCheck(key: string, ctx: LinkContext): IntegrationLink | null {
  switch (key) {
    case "sheet_ready_offers":
      return sheet(ctx.readySheet);
    case "sheet_leads":
      return sheet(ctx.leadsSheet);
    case "teletel":
      return ctx.teletel ? { url: ctx.teletel, label: host(ctx.teletel) } : null;
    case "tls_pkg":
      return { url: ctx.site, label: host(ctx.site) };
    case "domain_traveliun":
      return { url: "https://traveliun.com", label: "traveliun.com" };
    case "suppliers":
      return { url: `${ctx.site}/settings/suppliers`, label: "صفحة الموردين" };
    case "openai":
      return { url: "https://platform.openai.com/usage", label: "لوحة OpenAI" };
    case "aviationstack":
      return { url: "https://aviationstack.com/dashboard", label: "لوحة AviationStack" };
    case "weather":
      return { url: "https://open-meteo.com", label: "open-meteo.com" };
    case "ads_fresh":
      return { url: "https://ads.google.com", label: "Google Ads" };
    default:
      return null;
  }
}

/** A URL a key could ride in — never shown as a link. */
const carriesSecret = (url: string) => /[?&](key|token|secret|sig|signature|apikey|api_key|access_token)=/i.test(url) || /\/macros\/s\//.test(url);

export function integrationLink(
  row: { kind: string; name: string; check_key: string | null; notes: string | null },
  ctx: LinkContext,
): IntegrationLink | null {
  const wired = row.check_key ? byCheck(row.check_key, ctx) : null;
  if (wired) return wired;
  const bot = row.kind === "bot" ? row.name.match(/@([A-Za-z][A-Za-z0-9_]{4,31})/) : null;
  if (bot) return { url: `https://t.me/${bot[1]}`, label: `@${bot[1]}` };
  const typed = row.notes?.match(/https?:\/\/[^\s،,)]+/)?.[0];
  return typed && !carriesSecret(typed) ? { url: typed, label: host(typed) } : null;
}
