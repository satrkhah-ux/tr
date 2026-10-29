import { after, type NextRequest, NextResponse } from "next/server";
import { runMurad } from "@/lib/murad/run";
import { receptionSweep } from "@/lib/murad/reception-run";
import { recordCronRun } from "@/lib/data/cron-runs";
import { runIntegrationChecks } from "@/lib/developer/integrations-run";
import { syncFollowups } from "@/lib/followups/service";
import { summarizeDue } from "@/lib/followups/summary";
import { followupDigest } from "@/lib/followups/remind";
import { staffTick } from "@/lib/telegram/staff-events";
import { learnSweep } from "@/lib/murad/lessons";
import { foldKnowledge } from "@/lib/murad/knowledge";
import { sweepSharedAccounts } from "@/lib/routing/shared-sweep";
import { sweepSecretaryPlans } from "@/lib/secretary/plan";
import { sweepSecretarySuggestions } from "@/lib/secretary/suggest";
import { sweepNotifications } from "@/lib/notifications/sweep";
import { sweepFollowupSupervision } from "@/lib/followups/supervision/sweep";
import { readSettings } from "@/lib/murad/run";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/murad/run — «مُراد»: a client waiting five minutes with no human
 * answer gets one from Murad (src/lib/murad/run.ts).
 *
 * Called by ONE crontab line on the live VPS, every minute:
 *   * * * * *  curl -fsS -X POST -H "x-admin-secret: $ADMIN_API_SECRET" https://pkg.traveliun.com/api/murad/run
 *
 * The secret is the whole authentication (as /api/ops/daily): it writes to
 * clients' conversations. Overlapping calls are safe — a lease keeps a second
 * run out ({skipped: "busy"}), and each client turn is claimed once in murad_log.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env["ADMIN_API_SECRET"];
  return Boolean(expected) && req.headers.get("x-admin-secret") === expected;
}

// one chain at a time in this process: a sync that outlives the minute (61 s on 2026-10-25) is not started twice
let chain = false;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false }, { status: 401 });
  // every job that need not shape the answer is registered FIRST, before anything is awaited: the cron's curl gives up
  // at 55 s, and an after() registered once the caller has gone never runs (2026-10-25: the follow-ups sync took 61 s
  // and «تنبيهاتي», the summaries, the learning and the shared-login sweep all stopped)
  after(async () => {
    if (chain) return;
    chain = true;
    try {
      await recordCronRun("followups_sync", syncFollowups).catch(() => null);
      // «تنبيهاتي»: assignments the webhook missed, on the list the sync just refreshed
      await recordCronRun("staff_tick", staffTick).catch(() => null);
      // «ملخص مُراد» for the follow-ups whose thread moved — the model takes seconds each
      await summarizeDue().catch(() => null);
    } finally {
      chain = false;
    }
  });
  // «تنبيهاتي» 10:00 and 16:00: each seller's follow-ups due today
  after(() => followupDigest().catch(() => null));
  // «تعلّم من كل المحادثات»: a few past conversations a minute (lessons.ts)
  after(async () => {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const settings = await readSettings(service);
    await learnSweep(service, settings.control, [...(settings.control.admins ?? []), ...settings.autoList]);
    // «ذاكرة مُراد»: one subject folded at most, when enough new lessons came in (knowledge.ts)
    if (settings.control.learn) await foldKnowledge(service).catch(() => null);
  });
  // «لا طلب بلا صاحب»: a client waiting on a shared Teletel login goes to a seller (routing/shared-sweep.ts)
  after(() => recordCronRun("shared_sweep", sweepSharedAccounts).catch(() => null));
  // «سكرتيري الخاص»: the day plan on the first open of the system today (secretary/plan.ts)
  after(() => recordCronRun("secretary_plans", sweepSecretaryPlans).catch(() => null));
  // «سكرتيري الخاص»: cheaper same-star proposals for a price objection or a day's silence (secretary/suggest.ts)
  after(() => sweepSecretarySuggestions().catch(() => null));
  // «مركز الإشعارات»: what «متابعتي» ranks for whoever is online lands in the bell (notifications/sweep.ts)
  after(() => recordCronRun("notify_sweep", sweepNotifications).catch(() => null));
  // «إشراف المتابعة»: late follow-ups to the employee, then a supervisor, then the management (followups/supervision/sweep.ts)
  after(() => recordCronRun("followup_supervision", sweepFollowupSupervision).catch(() => null));
  // every run leaves its trace for /developer, answered anyone or not (cron-runs.ts)
  // «المستقبل الآلي»: what the webhook missed, before Murad's own turns (no model, its turns claimed one by one)
  const received = await receptionSweep().catch(() => 0);
  // «الربط الخارجي»: every 30 minutes at most (integrations-run.ts) — the minute job is the clock, nothing new to schedule
  await runIntegrationChecks().catch(() => null);
  const summary = await recordCronRun("murad_run", runMurad);
  return NextResponse.json({ ok: true, received, ...summary });
}
