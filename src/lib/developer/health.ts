import type { TranslationKey, TranslationParams } from "@/lib/i18n";

/**
 * The pure half of /developer's connection checks: what a result looks like,
 * how a latency or a job's age becomes a status, and how hosts and provider
 * errors are masked before they reach the browser. No I/O — checks.ts does that.
 */

/** idle = configured but deliberately not called (a metered API waits for its «اختبار» button). */
export type CheckStatus = "ok" | "warn" | "down" | "unconfigured" | "idle";
export type CheckGroup = "core" | "api" | "bots" | "jobs";

/** Text travels as a dictionary key, so the card reads in the viewer's language. */
export type Msg = { key: TranslationKey; params?: TranslationParams };

export type CheckResult = {
  id: string;
  group: CheckGroup;
  label: TranslationKey;
  status: CheckStatus;
  latencyMs: number | null;
  checkedAt: string;
  detail: Msg;
  extra?: Msg[];
  /** a scheduled job's last recorded run */
  lastRunAt?: string;
  /** a live call costs quota: only the «اختبار» button makes one */
  manual?: boolean;
};

export const CHECK_TIMEOUT_MS = 5000;
/** Slower than this answers, but is worth a look. */
export const SLOW_MS = 1500;

export function latencyStatus(ms: number): CheckStatus {
  return ms > SLOW_MS ? "warn" : "ok";
}

/**
 * A job meant to run every `everyMs`: on time within a grace of an hour (or a
 * tenth of the period, if longer); late → warn; three periods without a run → down.
 */
export function ageStatus(ageMs: number | null, everyMs: number): CheckStatus {
  if (ageMs === null) return "down";
  if (ageMs <= everyMs + Math.max(everyMs / 10, 3_600_000)) return "ok";
  return ageMs <= everyMs * 3 ? "warn" : "down";
}

/** The card's colour for several rows at once: the worst of them. */
export function worstStatus(statuses: CheckStatus[]): CheckStatus {
  const order: CheckStatus[] = ["down", "warn", "ok", "idle", "unconfigured"];
  return order.find((s) => statuses.includes(s)) ?? "unconfigured";
}

/**
 * "https://rpuxabcdefghijklmunq.supabase.co/rest" → "rpux…unq.supabase.co".
 * A long first label is a project ref or tenant id — enough is shown to tell
 * two projects apart, not to address one. Path and query (where keys ride) never show.
 */
export function maskHost(url: string | null | undefined): string {
  if (!url) return "";
  let host: string;
  try {
    host = new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return "";
  }
  const [first, ...rest] = host.split(".");
  return [first.length > 8 ? `${first.slice(0, 4)}…${first.slice(-3)}` : first, ...rest].join(".");
}

/** A provider's error text, with every secret we hold cut out and the length capped. */
export function scrub(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("•••");
  return out.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** A check's or a run's moment on the agency's clock (Riyadh), Latin digits like the rest of the app. */
export function whenText(iso: string, withDate = false): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    ...(withDate ? {} : { second: "2-digit" }),
  });
}

/** Resolve to `fallback()` if `work` has not settled within `ms` — one dead service must not hang the page. */
export async function withTimeout<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
