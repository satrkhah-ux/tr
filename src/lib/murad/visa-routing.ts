import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addTeletelNote, conversationEvents, listTeletelTeams, teletelGet } from "@/lib/providers/teletel";
import { pickAgent } from "@/lib/routing/switchboard";
import type { VisaAgent, MuradReceipt } from "./visa-assignment";
import { currentAssignment } from "@/lib/leads/assignment";
import { onList } from "./control";
import { handOver } from "./handover";
import { readControl } from "./control-store";

/**
 * The team member to take a conversation now — «البدّالة» decides (routing/switchboard.ts, the owner 2026-10-29): the one
 * already holding it when available, else the available colleague (not on leave, a status button, offline or «موقوف»)
 * with the fewest clients waiting. Null: nobody can (the team's queue holds it); undefined: the team could not be read.
 */
export async function onlineTeamAgent(teamId: number, inboxId: number | null, holderId: number | null): Promise<VisaAgent | null | undefined> {
  const choice = await pickAgent({ teamId, inboxId, holderAgentId: holderId });
  return choice === undefined ? undefined : choice ? { id: choice.candidate.agentId, name: choice.candidate.name } : null;
}

/** Claimed in the database so overlapping minute jobs cannot route the same request twice. */
export async function routeCompletedVisa(service: SupabaseClient, logId: string): Promise<boolean> {
  const { data } = await service.from("murad_log").update({ reason: "visa:handoff_working", acted_at: new Date().toISOString() }).eq("id", logId).eq("reason", "visa:handoff_pending").select("conversation_id,intake,created_at").maybeSingle();
  if (!data) return false;
  const id = Number(data.conversation_id);
  try {
    const teams = await listTeletelTeams();
    const team = teams.find((t) => /تأش|تاش|فيزا/i.test(t.name));
    if (!team) throw Error("visa_team_missing");
    const conversation = await teletelGet<{ inbox_id?: number; status?: string; meta?: { assignee?: { id?: number }; sender?: { phone_number?: string } } }>(`/conversations/${id}`);
    if (!conversation) throw Error("conversation_unavailable");
    const events = await conversationEvents(id);
    if (!events) throw Error("conversation_history_unavailable");
    if (conversation.status === "resolved" || events.some((e) => e.kind === "activity" && /مغلق|resolved/u.test(e.text) && e.at > Date.parse(data.created_at) / 1000)) {
      await service.from("murad_log").update({ reason: "visa:handoff_cancelled", error: "conversation_closed_since_intake" }).eq("id", logId);
      return false;
    }
    const control = await readControl(service);
    // the owner's own line is handed to no one: the flow ends here, as handed over
    if (onList(conversation.meta?.sender?.phone_number, control.noHandoff)) {
      await service.from("murad_log").update({ reason: "visa:handoff", error: null, intake: { ...data.intake, visa_handoff: { teamId: null, agentId: null, assignedAt: new Date().toISOString(), noHandoff: true } } }).eq("id", logId);
      return true;
    }
    const agent = await onlineTeamAgent(team.id, conversation.inbox_id ?? null, conversation.meta?.assignee?.id ?? null);
    if (agent === undefined) throw Error("visa_members_unavailable");
    if (!(await handOver(control, id, team.id, agent?.id ?? null, conversation.meta?.sender?.phone_number))) throw Error("visa_assignment_failed");
    // Team auto-assignment must not silently give an offline employee this request.
    const current = await teletelGet<{ meta?: { team?: { id?: number }; assignee?: { id?: number; name?: string } } }>(`/conversations/${id}`);
    if (current?.meta?.team?.id !== team.id || (current.meta.assignee?.id ?? null) !== (agent?.id ?? null)) throw Error("visa_assignment_not_confirmed");
    const assignedAt = new Date().toISOString();
    const { data: lead, error: leadError } = await service.from("client_leads").select("id,murad_receipt").eq("teletel_conversation_id", id).maybeSingle();
    if (leadError || !lead) throw Error("visa_lead_missing");
    const receipt = lead.murad_receipt as MuradReceipt | null;
    if (!receipt) throw Error("visa_receipt_missing");
    const { data: employees } = await service.from("employees").select("id,arabic_name,english_name").eq("status", "Active");
    const assignment = currentAssignment({ assignee: agent?.name ?? null, team: team.name }, employees ?? []);
    const updated: MuradReceipt = { ...receipt, assignedAt, team: team.name, agent: agent?.name ?? null, pending: false };
    const { error } = await service.from("client_leads").update({ ...assignment, murad_receipt: updated, assigned_at: assignedAt, assignee_reply_at: null, auto_route: team.name, auto_routed_at: assignedAt, auto_wait_sec: receipt.waitSec, updated_at: assignedAt }).eq("id", lead.id);
    if (error) throw Error("visa_receipt_save_failed");
    await service.from("murad_log").update({ reason: "visa:handoff", error: null, intake: { ...data.intake, visa_handoff: { teamId: team.id, agentId: agent?.id ?? null, assignedAt } } }).eq("id", logId);
    await addTeletelNote(id, `مُراد: استلم الطلب خلال ${receipt.waitSec} ثانية، وأكمل جمعه وأسنده إلى ${team.name}${agent ? ` — ${agent.name}` : " — بانتظار موظف متاح في القسم"}.`);
    return true;
  } catch (error) {
    await service.from("murad_log").update({ reason: "visa:handoff_pending", error: error instanceof Error ? error.message : "visa_routing_failed" }).eq("id", logId);
    return false;
  }
}
export async function retryVisaHandoffs(service: SupabaseClient): Promise<void> {
  await service.from("murad_log").update({ reason: "visa:handoff_pending" }).eq("reason", "visa:handoff_working").lt("acted_at", new Date(Date.now() - 180000).toISOString());
  const { data } = await service.from("murad_log").select("id").eq("reason", "visa:handoff_pending").order("acted_at").limit(3);
  for (const row of data ?? []) await routeCompletedVisa(service, row.id);
}
