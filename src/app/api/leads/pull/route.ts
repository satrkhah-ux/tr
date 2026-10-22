import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pullSheet } from "@/lib/leads/sync";
import { pullTeletel } from "@/lib/leads/teletel-pull";
import { closeIdle } from "@/lib/leads/lifecycle";
import { AUTOCLOSE_SETTING, readAutocloseHours, TRAVELLERS_SETTING } from "@/lib/leads/lifecycle-rules";
import { getTeletelConfig } from "@/lib/providers/teletel";
import { recordCronRun } from "@/lib/data/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/leads/pull — «العملاء»: Teletel's open conversations into client_leads
 * (phase two, teletel-pull.ts); without Teletel, the conversations sheet.
 *
 * Called by ONE crontab on the live VPS:
 *   *\/5 * * * *  curl -fsS -X POST -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/leads/pull
 *
 * The pull is idempotent (one row per sheet_key, inserts ignore a key already
 * there), so a second caller during a server move writes nothing twice.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // every run leaves its trace for /developer (cron-runs.ts)
  const summary = await recordCronRun("leads_pull", async () => {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    // phase two: Teletel's conversations; the sheet only where Teletel is not configured
    const result = getTeletelConfig() ? await pullTeletel(service) : await pullSheet(service);
    if (result.error) throw new Error(result.error);
    // the system's closings (leads/lifecycle.ts), both set on «إدارة المحادثات»: the confirmed travellers (on unless
    // stopped there) and, once a time is set, the conversations nobody answered that long
    const { data: settings } = await service.from("app_settings").select("key, value").in("key", [AUTOCLOSE_SETTING, TRAVELLERS_SETTING]);
    const v = new Map(((settings ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const opts = { hours: readAutocloseHours(v.get(AUTOCLOSE_SETTING)), travellers: v.get(TRAVELLERS_SETTING) !== "off" };
    return getTeletelConfig() ? { ...result, closed: await closeIdle(opts) } : result;
  });
  return NextResponse.json({ ok: true, ...summary });
}
