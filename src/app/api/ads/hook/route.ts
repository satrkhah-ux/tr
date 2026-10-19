import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { rowsFromPayload } from "@/lib/ads/payload";
import { adsHookKey } from "@/lib/ads/key";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ads/hook?key=… — the owner's Google Ads Script, every hour (and
 * once for the history): the account's numbers per day and campaign, where the
 * clicks were, what was searched, the hour (lib/ads/payload.ts). Upserted by
 * day — today's partial rows are overwritten each hour, a closed day stays.
 *
 * The key is a hash of ADMIN_API_SECRET with its own label (lib/ads/key.ts).
 */
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: NextRequest): Promise<NextResponse> {
  const key = adsHookKey();
  const given = req.nextUrl.searchParams.get("key") ?? "";
  if (!key || !same(given, key)) return NextResponse.json({ ok: false }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 8_000_000) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const rows = rowsFromPayload(body, today);
  if (!rows) return NextResponse.json({ ok: false, error: "unknown_shape" }, { status: 400 });

  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  const at = new Date().toISOString();
  const put = async (table: string, list: Record<string, unknown>[], conflict: string) => {
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await db.from(table).upsert(list.slice(i, i + 500).map((r) => ({ ...r, updated_at: at })), { onConflict: conflict });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  };
  try {
    await put("ad_stats", rows.days, "day,campaign");
    await put("ad_locations", rows.locations, "day,campaign,country,city");
    await put("ad_search_terms", rows.terms, "day,campaign,term");
    await put("ad_hours", rows.hours, "day,campaign,hour");
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "db" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, days: rows.days.length, locations: rows.locations.length, terms: rows.terms.length, hours: rows.hours.length });
}
