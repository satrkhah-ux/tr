import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pullSheet } from "@/lib/leads/sync";
import { recordCronRun } from "@/lib/data/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/leads/pull — «العملاء»: the conversations sheet into client_leads,
 * so a conversation is dated the day it was logged (the sheet has no date column).
 *
 * Called by ONE crontab on the live VPS:
 *   *\/2 * * * *  curl -fsS -X POST -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/leads/pull
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
    const result = await pullSheet(createSupabaseServiceClient() as unknown as SupabaseClient);
    if (result.error) throw new Error(result.error);
    return result;
  });
  return NextResponse.json({ ok: true, ...summary });
}
