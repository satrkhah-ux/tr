import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { addTeletelNote, assignMuradHandoff, conversationEvents, listAssignableAgents, listOpenConversations, setTeletelStatus, teletelGet, unassignTeletel } from "@/lib/providers/teletel";
import { closerOf, decideReturn, durationText, staleToClose, type ClosedBy } from "./lifecycle-rules";

// always the service role: the in-app «تحديث» runs the pull with a staff session, and closures are written by the system only
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/**
 * The conversation's life in Teletel (order 2, part C — the user, 2026-10-22:
 * «اغلاق المحادثات و ارجاعها للموظف التي كانت لديه … نظام تليتيل»):
 *   · resolved by an employee → when the client writes again it goes back to THAT employee;
 *   · resolved by the system (stale, nobody waiting on us) → it comes back unassigned, as a new request;
 *   · every closing kept (conversation_closures): who, when, why, and what happened on return.
 * client_leads.conversation_state says where each one stands, for «الشاشات» and /m (order 3).
 * The rules are lifecycle-rules.ts; this file does them.
 */

type Closure = { id: string; conversation_id: number; closed_at: string; closed_by_kind: ClosedBy; closed_by_agent_id: number | null; closed_by_name: string | null };

/**
 * The pull saw a conversation leave Teletel's open list: who resolved it, from
 * Teletel's own «تم تحديث حالة المحادثة لـ"مغلقة" بواسطة X». A closing the
 * system recorded itself (closeStale) is already there and stays the system's.
 */
export async function recordClosed(conversationId: number, assigneeId: number | null, inboxId: number | null): Promise<ClosedBy | null> {
  const service = db();
  const { data: open } = await service.from("conversation_closures").select("closed_by_kind").eq("conversation_id", conversationId).is("reopened_at", null).maybeSingle();
  if (open) return (open as { closed_by_kind: ClosedBy }).closed_by_kind;
  const [events, agents] = await Promise.all([conversationEvents(conversationId), listAssignableAgents(inboxId)]);
  const closer = closerOf(events ?? [], Math.floor(Date.now() / 1000), agents);
  const kind: ClosedBy = closer ? "employee" : "system";
  const closedAt = new Date((closer?.at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const { error } = await service.from("conversation_closures").insert({
    conversation_id: conversationId,
    closed_at: closedAt,
    closed_by_kind: kind,
    closed_by_agent_id: closer?.agentId ?? null,
    closed_by_name: closer?.name ?? null,
    assignee_agent_id: assigneeId,
    reason: closer ? null : "أُغلقت في تيلي تيل دون موظف معروف",
  });
  if (error) return null;
  await service
    .from("client_leads")
    .update({ conversation_state: kind === "employee" ? "closed_by_employee" : "closed_by_system", closed_at: closedAt, closed_by_kind: kind, closed_by_name: closer?.name ?? null })
    .eq("teletel_conversation_id", conversationId);
  return kind;
}

/**
 * The client wrote to a conversation we saw closed: back to the employee who
 * closed it, or — the system's closing — unassigned, so Teletel's own intake
 * (and «مُراد»'s reception) takes it as a new request. Once per closing.
 */
export async function onClientReturn(conversationId: number, atSec: number, byClient = true): Promise<"returned_to_employee" | "unassigned" | "kept" | null> {
  const service = db();
  const { data } = await service
    .from("conversation_closures")
    .select("id, conversation_id, closed_at, closed_by_kind, closed_by_agent_id, closed_by_name")
    .eq("conversation_id", conversationId)
    .is("reopened_at", null)
    .lte("closed_at", new Date(atSec * 1000).toISOString())
    .maybeSingle();
  const closure = data as Closure | null;
  if (!closure) return null;
  // claimed: the webhook and the pull may both see the same return
  const reopenedAt = new Date(atSec * 1000).toISOString();
  const { data: claimed } = await service.from("conversation_closures").update({ reopened_at: reopenedAt }).eq("id", closure.id).is("reopened_at", null).select("id").maybeSingle();
  if (!claimed) return null;
  // a colleague reopened it themselves (nobody waiting on us): theirs, nothing moved
  if (!byClient) {
    await service.from("conversation_closures").update({ reopen_action: "kept" }).eq("id", closure.id);
    await service.from("client_leads").update({ conversation_state: "open", closed_at: null, closed_by_kind: null, closed_by_name: null }).eq("teletel_conversation_id", conversationId);
    return "kept";
  }
  const conv = await teletelGet<{ meta?: { assignee?: { id?: number } | null; team?: { id?: number } | null } }>(`/conversations/${conversationId}`);
  const decision = decideReturn(closure, conv?.meta?.assignee?.id ?? null);
  let done = true;
  if (decision.act === "assign") done = await assignMuradHandoff(conversationId, null, decision.agentId);
  if (decision.act === "unassign") done = await unassignTeletel(conversationId);
  const action = decision.act === "unassign" ? "unassigned" : "returned_to_employee";
  await service
    .from("conversation_closures")
    .update({ reopen_action: action, reopened_to_agent_id: decision.act === "unassign" ? null : (closure.closed_by_agent_id ?? conv?.meta?.assignee?.id ?? null), ...(done ? {} : { reason: "تعذّر الإسناد عند العودة" }) })
    .eq("id", closure.id);
  await service.from("client_leads").update({ conversation_state: "waiting", status: "open", closed_at: null, closed_by_kind: null, closed_by_name: null }).eq("teletel_conversation_id", conversationId);
  await addTeletelNote(
    conversationId,
    action === "unassigned"
      ? "🔁 عاد العميل بعد إغلاق آلي — المحادثة طلب جديد غير مسند."
      : `🔁 عاد العميل — أُعيدت المحادثة إلى ${closure.closed_by_name ?? "الموظف"} الذي أغلقها${done ? "" : " (تعذّر الإسناد — أسندها يدوياً)"}.`,
  );
  return action;
}

/** The webhook's entry: an incoming client message (api/teletel/webhook). */
export async function clientWrote(conversationId: number, atSec: number): Promise<void> {
  if (conversationId) await onClientReturn(conversationId, atSec);
}

/** Murad keeps out of a conversation that came back to its employee this visit (reception-run.ts). */
export async function returnedToEmployee(conversationId: number, sinceSec: number): Promise<boolean> {
  const service = db();
  const { count } = await service
    .from("conversation_closures")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("reopen_action", "returned_to_employee")
    .gte("reopened_at", new Date(sinceSec * 1000).toISOString());
  return Boolean(count);
}

/**
 * The system's closing (off until «إدارة المحادثات» sets conversation_autoclose_hours):
 * open conversations idle that long where WE spoke last — never one
 * whose client is waiting on us. Recorded before Teletel is asked, so the pull
 * reads it as the system's. A few a run.
 */
export async function closeStale(hours: number, limit = 20): Promise<number> {
  const service = db();
  const list = await listOpenConversations(true);
  if (!list) return 0;
  let n = 0;
  for (const c of staleToClose(list.rows, Math.floor(Date.now() / 1000), hours).slice(0, limit)) {
    const { data, error } = await service
      .from("conversation_closures")
      .insert({ conversation_id: c.id, closed_at: new Date().toISOString(), closed_by_kind: "system", closed_by_name: "النظام", assignee_agent_id: c.assigneeId, reason: `لا رد منذ ${durationText(hours)} وآخر رسالة منّا` })
      .select("id")
      .maybeSingle();
    if (error || !data) continue;
    await addTeletelNote(c.id, `🤖 أُغلقت آلياً («إدارة المحادثات»): لا رد منذ ${durationText(hours)} وآخر رسالة منّا. إذا كتب العميل تعود طلباً جديداً.`);
    if (!(await setTeletelStatus(c.id, "resolved"))) {
      await service.from("conversation_closures").delete().eq("id", (data as { id: string }).id);
      continue;
    }
    await service.from("client_leads").update({ status: "closed", delay: null, conversation_state: "closed_by_system", closed_at: new Date().toISOString(), closed_by_kind: "system", closed_by_name: "النظام" }).eq("teletel_conversation_id", c.id);
    n += 1;
  }
  return n;
}
