import type { SupabaseClient } from "@supabase/supabase-js";
import { extCaller, extJson } from "@/lib/ext/auth";
import { logAudit } from "@/lib/data/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/ext/conversation/<id>/remind {dueAt, text} — «ذكّرني» from the side
 * panel: the employee's own reminder on this conversation, as «متابعتي»'s
 * remindMe writes it (sellers, within 62 days); «تنبيهاتي» sends it when due.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await extCaller(request, "panel");
  if (caller instanceof Response) return caller;
  if (!caller.can("offers.write")) return extJson({ ok: false, error: "forbidden" }, 403);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return extJson({ ok: false, error: "bad_id" }, 400);
  const body = (await request.json().catch(() => null)) as { dueAt?: unknown; text?: unknown } | null;
  const due = typeof body?.dueAt === "string" ? Date.parse(body.dueAt) : NaN;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 500) : "";
  if (!Number.isFinite(due) || due < Date.now() - 60_000 || due > Date.now() + 62 * 86_400_000) return extJson({ ok: false, error: "bad_date" }, 400);
  const { data, error } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
    .from("my_followup_reminders")
    .insert({ employee_id: caller.employeeId, conversation_id: id, text, due_at: new Date(due).toISOString() })
    .select("id")
    .single();
  if (error || !data) return extJson({ ok: false, error: "unavailable" }, 503);
  await logAudit({
    action: "ext.reminder_set",
    entity: "my_followup_reminders",
    entity_id: String((data as { id: number }).id),
    meta: { conversation_id: id, due_at: new Date(due).toISOString() },
    actor: { id: caller.employeeId, label: caller.name },
  });
  return extJson({ ok: true });
}
