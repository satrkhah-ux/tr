import type { SupabaseClient } from "@supabase/supabase-js";
import { extCaller, extJson } from "@/lib/ext/auth";
import { logAudit } from "@/lib/data/audit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const NOTES_MAX = 200;

/**
 * POST /api/ext/conversation/<id>/note {note} — the employee's own note on this
 * conversation («متابعتي»'s my_followup_marks c:<id>, the same one its page
 * shows); empty clears it. Never seen by the client.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await extCaller(request, "panel");
  if (caller instanceof Response) return caller;
  if (!caller.can("offers.write")) return extJson({ ok: false, error: "forbidden" }, 403);
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return extJson({ ok: false, error: "bad_id" }, 400);
  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  if (typeof body?.note !== "string") return extJson({ ok: false, error: "bad_note" }, 400);
  const note = body.note.trim().slice(0, 1000);
  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  // a ceiling on one employee's noted conversations (a note already there may always be changed or cleared)
  if (note) {
    const [{ count, error: countError }, { data: mine }] = await Promise.all([
      db.from("my_followup_marks").select("key", { count: "exact", head: true }).eq("employee_id", caller.employeeId).not("note", "is", null),
      db.from("my_followup_marks").select("note").eq("employee_id", caller.employeeId).eq("key", `c:${id}`).maybeSingle(),
    ]);
    if (countError) return extJson({ ok: false, error: "unavailable" }, 503);
    if (!(mine as { note?: string | null } | null)?.note && (count ?? 0) >= NOTES_MAX) return extJson({ ok: false, error: "too_many" }, 429);
  }
  const { error } = await db
    .from("my_followup_marks")
    .upsert({ employee_id: caller.employeeId, key: `c:${id}`, note: note || null, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
  if (error) return extJson({ ok: false, error: "unavailable" }, 503);
  await logAudit({ action: "ext.note_saved", entity: "my_followup_marks", entity_id: `c:${id}`, meta: { conversation_id: id, length: note.length }, actor: { id: caller.employeeId, label: caller.name } });
  return extJson({ ok: true });
}
