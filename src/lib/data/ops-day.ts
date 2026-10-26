"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { listOperationWork } from "@/lib/data/operations-work";
import { loadWizardCase } from "@/lib/data/wizard-case";
import { readiness, readyLabel } from "@/lib/operations/wizard/index";
import { calmUrgency, type CalmUrgency } from "@/lib/operations/wizard/calm";
import type { TranslationKey } from "@/lib/i18n";
import type { WizardStep } from "@/lib/operations/wizard/types";

/**
 * «مهام اليوم» for the operations clerk (the owner, 2026-10-26): one list
 * across every live case of what still misses, each row opening its case —
 * and «أنجزت اليوم», followed BY THE SYSTEM: an item leaves the list the
 * moment its evidence exists (readiness is derived), and the done line reads
 * today's audit trail, so nothing is ticked by hand and nothing is stored.
 *
 * ponytail: loadWizardCase per case (~a dozen reads each), capped at 30 cases
 * ordered by travel date — live cases number in the tens (the board's own
 * trade); page the loader if the office ever runs hundreds.
 */

export type OpsDayItem = {
  operationId: string;
  serial: string;
  customer: string;
  travelStart: string | null;
  urgency: CalmUrgency;
  step: WizardStep;
  /** t(labelKey) is the item's words — the wizard's own readiness keys */
  labelKey: TranslationKey;
};

export type OpsDayDone = { at: string; action: string; operationId: string | null };

export type OpsDay = { items: OpsDayItem[]; done: OpsDayDone[]; today: string; cases: number };

const URGENCY_RANK: Record<CalmUrgency, number> = { late: 0, soon: 1, normal: 2 };

export async function getOpsDay(): Promise<OpsDay> {
  const { items: cases, today } = await listOperationWork();
  const live = cases
    .filter((c) => c.client_status !== "completed" && c.client_status !== "cancelled" && c.execution_status !== "travelled" && c.execution_status !== "cancelled")
    .sort((a, b) => (a.travel_start ?? "9999").localeCompare(b.travel_start ?? "9999"))
    .slice(0, 30);

  const items: OpsDayItem[] = [];
  for (const c of live) {
    const data = await loadWizardCase(c.id).catch(() => null);
    if (!data) continue;
    const urgency = calmUrgency(c.travel_start, today);
    const gaps = readiness(data).filter((i) => !i.ok && !i.optional);
    for (const i of gaps.slice(0, 5)) {
      items.push({
        operationId: c.id,
        serial: c.serial,
        customer: c.customer_name ?? "—",
        travelStart: c.travel_start,
        urgency,
        step: i.step,
        labelKey: readyLabel(i),
      });
    }
  }
  items.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || (a.travelStart ?? "9999").localeCompare(b.travelStart ?? "9999"));

  // «أنجزت اليوم» — my own trail today, derived, never ticked by hand
  const done: OpsDayDone[] = [];
  try {
    const me = await getCurrentEmployeeId();
    if (me) {
      const service = createSupabaseServiceClient() as unknown as SupabaseClient;
      const dayStart = new Date(`${today}T00:00:00+03:00`).toISOString();
      const { data } = await service
        .from("audit_logs")
        .select("action, created_at, meta, entity")
        .eq("actor_id", me)
        .gte("created_at", dayStart)
        .like("entity", "operation%")
        .order("created_at", { ascending: false })
        .limit(60);
      for (const r of (data ?? []) as { action: string; created_at: string; meta: Record<string, unknown> | null }[]) {
        done.push({ at: r.created_at, action: r.action, operationId: typeof r.meta?.operation_id === "string" ? r.meta.operation_id : null });
      }
    }
  } catch {
    /* the list still serves without the done line */
  }

  return { items, done, today, cases: live.length };
}
