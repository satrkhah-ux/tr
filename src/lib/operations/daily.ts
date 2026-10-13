import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyOps, notifyPartnerCase } from "@/lib/data/ops-notify";
import { readinessFor } from "@/lib/data/operation-sync";
import { sendClientMessage } from "@/lib/data/client-messages";
import { passportValidFor } from "./progress";
import { canAdvanceClient, canAdvanceExecution, type ClientStatus, type ExecutionStatus } from "./state";

/**
 * The operations day (operations order 6), run once a morning by the server's
 * crontab through /api/ops/daily:
 *
 *  1. a trip whose last day has passed is «سافر»;
 *  2. a «سافر» case is closed (client «مكتمل») once rated, or seven days after;
 *  3. alerts — 7, 3 and 1 days before travel with what is still missing, a
 *     passport that ends within six months of the return — each sent ONCE
 *     (operation_alerts), to the operations team on Telegram.
 */

export type DailyResult = { travelled: number; completed: number; alerts: number };

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

type Op = {
  id: string;
  offer_id: string;
  client_status: ClientStatus;
  execution_status: ExecutionStatus;
  travel_start: string | null;
  travel_end: string | null;
  offers: { serial: string; customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null } | { serial: string; customers: unknown }[] | null;
};

const serialOf = (op: Op) => (Array.isArray(op.offers) ? op.offers[0]?.serial : op.offers?.serial) ?? "";

/** Send an alert unless this one (operation, kind, ref) already went out. */
async function alertOnce(supabase: SupabaseClient, operationId: string, kind: string, ref: string, text: string): Promise<boolean> {
  const { error } = await supabase.from("operation_alerts").insert({ operation_id: operationId, kind, ref });
  if (error) return false; // the unique key: already sent
  await notifyOps(text, `/operations/${operationId}`);
  return true;
}

export async function runOpsDaily(today: string): Promise<DailyResult> {
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
  const result: DailyResult = { travelled: 0, completed: 0, alerts: 0 };
  const { data } = await supabase
    .from("operations")
    .select("id, offer_id, client_status, execution_status, travel_start, travel_end, offers(serial, customers(arabic_name))")
    .neq("execution_status", "cancelled")
    .limit(2000);
  const ops = (data ?? []) as unknown as Op[];

  const ratings = new Set(
    (((await supabase.from("operation_ratings").select("operation_id")).data ?? []) as { operation_id: string }[]).map((r) => r.operation_id),
  );

  for (const op of ops) {
    // 1. back home
    if (op.travel_end && op.travel_end < today && canAdvanceExecution(op.execution_status, "travelled")) {
      await supabase.from("operations").update({ execution_status: "travelled", updated_at: new Date().toISOString() }).eq("id", op.id);
      await supabase.from("offers").update({ pipeline_stage: "completed" }).eq("id", op.offer_id);
      await logAudit({ action: "operation.execution_status", entity: "operations", entity_id: op.id, meta: { from: op.execution_status, to: "travelled", auto: true }, actor: { id: null, label: "ops-daily" } });
      await notifyPartnerCase({ offerId: op.offer_id, what: "سافر" });
      await sendClientMessage(op.id, "rate_trip");
      op.execution_status = "travelled";
      result.travelled += 1;
    }
    // 2. closed: rated, or a week after the return
    if (
      op.execution_status === "travelled" &&
      op.travel_end &&
      (ratings.has(op.id) || addDays(op.travel_end, 7) <= today) &&
      canAdvanceClient(op.client_status, "completed")
    ) {
      await supabase.from("operations").update({ client_status: "completed", updated_at: new Date().toISOString() }).eq("id", op.id);
      await logAudit({ action: "operation.client_status", entity: "operations", entity_id: op.id, meta: { from: op.client_status, to: "completed", auto: true }, actor: { id: null, label: "ops-daily" } });
      result.completed += 1;
      continue;
    }
    // 3. before travel
    if (!op.travel_start || op.travel_start < today || op.execution_status === "travelled") continue;
    const days = Math.round((Date.parse(op.travel_start) - Date.parse(today)) / 86_400_000);
    const name = (() => {
      const o = Array.isArray(op.offers) ? op.offers[0] : op.offers;
      const c = o?.customers as { arabic_name: string | null } | { arabic_name: string | null }[] | null | undefined;
      return (Array.isArray(c) ? c[0]?.arabic_name : c?.arabic_name) ?? "";
    })();
    const head = `${serialOf(op)}${name ? ` — ${name}` : ""}`;

    // the client: the day before, and on arrival (each once — sendClientMessage keeps count)
    if (days === 1) await sendClientMessage(op.id, "day_before");
    if (days === 0) await sendClientMessage(op.id, "welcome");

    if ([7, 3, 1].includes(days)) {
      const items = (await readinessFor(op.id)) ?? [];
      const missing = items.filter((i) => !i.ok);
      if (missing.length && (await alertOnce(supabase, op.id, "before_travel", String(days), [`⏰ السفر بعد ${days === 1 ? "يوم" : `${days} أيام`}: ${head}`, "", ...missing.map((i) => `• ${i.detail}`)].join("\n")))) {
        result.alerts += 1;
      }
    }

    const { data: travelers } = await supabase.from("operation_travelers").select("id, display_name, passport_expiry").eq("operation_id", op.id);
    for (const t of (travelers ?? []) as { id: string; display_name: string; passport_expiry: string | null }[]) {
      if (t.passport_expiry && !passportValidFor(t.passport_expiry, op.travel_end)) {
        if (await alertOnce(supabase, op.id, "passport", t.id, `🛂 جواز ${t.display_name || "مسافر"} ينتهي ${t.passport_expiry} — أقل من 6 أشهر بعد العودة (${head})`)) result.alerts += 1;
      }
    }
  }
  return result;
}
