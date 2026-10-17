"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { gateCaseManager, gateOperation } from "@/lib/operations/access";
import { isIsoDate } from "@/lib/operations/payments";
import { withoutWaits } from "@/lib/operations/wizard/followup";
import { writeWaits } from "@/lib/data/wizard-sync";
import { WAIT_FROM, WIZARD_STEPS, type ReadyExceptions, type WaitFrom, type WizardStep } from "@/lib/operations/wizard/types";

/**
 * «معالج الحجوزات» — the two things the wizard itself stores on a case
 * (operations.waits / ready_exceptions, 0084): «ينتظر» per step, and a
 * manager's exception to the payment rule before «جاهز للسفر». Every other
 * write a step makes goes through the action that already owns it
 * (upsertTraveler, recordPayment, issueDocument …).
 *
 * A wait is written one step's key at a time (wizard-sync.ts writeWaits:
 * re-read and retried when the case changed in between, guarded by
 * updated_at): two people setting «ينتظر» on the same case at once both keep
 * theirs.
 */

type Fail = { ok: false; error: TranslationKey };

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const NOTE_MAX = 300;

/** Set «ينتظر» on a step — or clear it (`wait` null): done, or by hand. */
export async function setStepWait(
  operationId: string,
  step: WizardStep,
  wait: { from: WaitFrom; until: string; note?: string | null } | null,
): Promise<{ ok: true } | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  if (!WIZARD_STEPS.includes(step)) return { ok: false, error: "err.updateFailed" };
  if (wait && (!WAIT_FROM.includes(wait.from) || !isIsoDate(wait.until))) return { ok: false, error: "wz.wait.err.invalid" };
  try {
    const set = wait
      ? { from: wait.from, until: wait.until, note: wait.note?.trim().slice(0, NOTE_MAX) || null, at: new Date().toISOString(), by: await getCurrentEmployeeId() }
      : null;
    // only this step's key — whatever another step holds is re-read and kept
    const res = await writeWaits(await db(), operationId, (waits) => (set ? { ...waits, [step]: set } : withoutWaits(waits, [step])));
    // checked: a write RLS refuses must not be audited as done
    if (!res.ok) return { ok: false, error: "err.updateFailed" };
    if (!res.waits) return { ok: true };
    await logAudit({
      action: "operation.waiting",
      entity: "operations",
      entity_id: operationId,
      meta: wait ? { step, from: wait.from, until: wait.until } : { step, cleared: true },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * A manager lets the case be «جاهز للسفر» before it is paid in full — or takes
 * that back (`note` null). The manager's step on this case (gateCaseManager);
 * 0085 makes the database refuse it to anyone else's session too.
 */
export async function setPaymentException(operationId: string, note: string | null): Promise<{ ok: true } | Fail> {
  const denied = await gateCaseManager(operationId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { data, error: readError } = await supabase.from("operations").select("ready_exceptions").eq("id", operationId).maybeSingle();
    if (readError || !data) return { ok: false, error: "err.loadFailed" };
    const raw = (data as { ready_exceptions: unknown }).ready_exceptions;
    const exceptions: ReadyExceptions = raw && typeof raw === "object" ? { ...(raw as ReadyExceptions) } : {};
    if (note === null) delete exceptions.payment;
    else exceptions.payment = { by: await getCurrentEmployeeId(), at: new Date().toISOString(), note: note.trim().slice(0, NOTE_MAX) || null };
    const { error } = await supabase.from("operations").update({ ready_exceptions: exceptions }).eq("id", operationId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({
      action: "operation.ready_exception",
      entity: "operations",
      entity_id: operationId,
      meta: { rule: "payment", granted: note !== null, note: exceptions.payment?.note ?? null },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
