import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyOps } from "@/lib/data/ops-notify";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";
import { isFlightLookupConfigured } from "@/lib/providers/flight-lookup";
import { flightObservations } from "@/lib/providers/flight-status";
import { toInstant } from "@/lib/offer/schedule";
import { DRV } from "@/lib/operations/drivers";
import { inWindow, pickObservation, toStored, trackDecision, trackTargets, type FlightObservation } from "@/lib/operations/flight-track";

/**
 * The travel-day flight watch (operations order 11, suggestion 4). Run by the
 * morning cron (/api/ops/daily) and every 30 minutes by /api/ops/flights.
 *
 * For each reception of today or tomorrow (Riyadh) tied to a numbered flight:
 * ask the provider for the landing, and when it drifted more than 15 minutes
 * from what the reception was last timed on, re-time it (landing + 45), tell
 * operations once (operation_alerts) and send the driver a note when he has a
 * Teletel conversation. Service role, no session: the caller is the cron.
 *
 * ponytail: one provider call per flight number per run, only from six hours
 * before the landing to two after. AviationStack's free plan is 100 calls a
 * month — a busy season needs the paid plan, or a wider cron interval.
 */

export type FlightTrackResult = { checked: number; moved: number; alerts: number; skipped?: "not_configured" };

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type OfferJoin = { serial: string; customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null };
type Transfer = {
  id: string;
  operation_id: string;
  kind: string;
  title: string;
  start_date: string | null;
  detail: Record<string, string> | null;
  operations: { execution_status: string; offers: OfferJoin | OfferJoin[] | null } | null;
};

export async function trackFlights(now = new Date()): Promise<FlightTrackResult> {
  const result: FlightTrackResult = { checked: 0, moved: 0, alerts: 0 };
  if (!isFlightLookupConfigured()) return { ...result, skipped: "not_configured" };
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;

  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const { data } = await supabase
    .from("operation_bookings")
    .select("id, operation_id, kind, title, start_date, detail, operations(execution_status, offers(serial, customers(arabic_name)))")
    .eq("kind", "transport")
    .in("start_date", [today, addDays(today, 1)])
    .neq("status", "cancelled");
  const transfers = ((data ?? []) as unknown as Transfer[]).filter((t) => one(t.operations)?.execution_status !== "cancelled");
  if (transfers.length === 0) return result;

  const { data: flights } = await supabase
    .from("operation_bookings")
    .select("operation_id, detail")
    .in("operation_id", [...new Set(transfers.map((t) => t.operation_id))])
    .eq("kind", "flight")
    .neq("status", "cancelled");
  const targets = trackTargets(transfers, (flights ?? []) as { operation_id: string; detail: Record<string, string> | null }[]);
  if (targets.length === 0) return result;

  const codes = [...new Set(targets.map((t) => t.leg.to).filter(Boolean))];
  const { data: airports } = codes.length ? await supabase.from("airports").select("code, iana_timezone").in("code", codes) : { data: [] };
  const zone = new Map(((airports ?? []) as { code: string; iana_timezone: string | null }[]).map((a) => [a.code, a.iana_timezone]));
  const byId = new Map(transfers.map((t) => [t.id, t]));
  const asked = new Map<string, Promise<FlightObservation[] | null>>();

  for (const target of targets) {
    try {
      const basis = target.tracked ?? target.leg.arrival;
      if (!inWindow(toInstant(basis, zone.get(target.leg.to) ?? null), now)) continue;
      if (!asked.has(target.flight_no)) asked.set(target.flight_no, flightObservations(target.flight_no));
      const rows = await asked.get(target.flight_no);
      result.checked += 1;
      const observed = rows ? pickObservation(rows, target.leg) : null;
      const decision = observed ? trackDecision({ planned: target.leg.arrival, tracked: target.tracked, observed }) : null;
      const transfer = byId.get(target.id);
      if (!decision || !transfer) continue;

      const detail: Record<string, string> = { ...(transfer.detail ?? {}), [DRV.time]: decision.meet.time, [DRV.landing]: toStored(decision.landing) };
      const { error } = await supabase.from("operation_bookings").update({ start_date: decision.meet.date, detail }).eq("id", target.id);
      if (error) continue;
      result.moved += 1;

      const offer = one(one(transfer.operations)?.offers);
      const name = one(offer?.customers)?.arabic_name;
      const drift = decision.delay > 0 ? `متأخرة ${decision.delay} دقيقة` : decision.delay < 0 ? `مبكرة ${-decision.delay} دقيقة` : "في موعدها";
      const landing = toStored(decision.landing);
      const meet = `${decision.meet.date} ${decision.meet.time}`;

      // once per move: the same landing seen again by the next run says nothing new
      const { error: seen } = await supabase.from("operation_alerts").insert({ operation_id: target.operation_id, kind: "flight_drift", ref: `${target.id}@${decision.landing}` });
      let driverNotified = false;
      if (!seen) {
        result.alerts += 1;
        await notifyOps(
          `✈️ ${target.flight_no} ${drift}${decision.landed ? " — هبطت" : ""}\nالهبوط ${landing} ← الاستقبال ${meet}\n${offer?.serial ?? ""}${name ? ` — ${name}` : ""}`,
          `/operations/${target.operation_id}`,
        );
        const phone = detail[DRV.phone]?.trim();
        const conversation = phone ? await conversationForPhone(phone) : null;
        if (conversation) {
          const note = [
            `تحديث موعد الاستقبال / Pick-up time update — ${offer?.serial ?? ""}`,
            `الرحلة / Flight: ${target.flight_no}`,
            `${decision.landed ? "هبطت / Landed" : "الهبوط المتوقع / Expected landing"}: ${landing}`,
            `موعد الالتقاء الجديد / New meeting time: ${meet}`,
          ].join("\n");
          driverNotified = (await sendTeletelMessage(conversation, note)) !== null;
        }
      }
      await logAudit({
        action: "booking.retimed",
        entity: "operation_bookings",
        entity_id: target.id,
        meta: { flight: target.flight_no, landing: decision.landing, delay: decision.delay, date: decision.meet.date, time: decision.meet.time, driver_notified: driverNotified },
        actor: { id: null, label: "flight-tracker" },
      });
    } catch {
      /* one flight's failure never stops the others */
    }
  }
  return result;
}
