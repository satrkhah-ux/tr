import "server-only";
import { addTeletelNote, assignAgentThenTeam, assignMuradHandoff } from "@/lib/providers/teletel";
import { saleHolder } from "@/lib/leads/lifecycle";
import { onList, type MuradControl } from "./control";

/**
 * Every hand-over Murad makes goes through here (the owner, 2026-10-24): a number on «لا يُحوّل أبداً» is handed to
 * no one, and a colleague on «موقوف» is skipped — the department still gets it. A named colleague is set before the
 * department: the department first lets its own auto-assignment hand the client to someone else for a moment, and
 * «تنبيهاتي» tells that one (2026-10-24, «مراجعة فقط»: 40450 flashed to another seller). A colleague outside that
 * department loses the agent on the team change — then the old order, department then colleague.
 */
export async function handOver(control: MuradControl, conversationId: number, teamId: number | null, agentId: number | null, phone: string | null | undefined): Promise<boolean> {
  if (onList(phone, control.noHandoff)) return false;
  const agent = agentId && control.paused?.includes(agentId) ? null : agentId;
  // never away from the employee holding a client who bought (the owner, 2026-10-29: 39733) — not handed over
  const holder = await saleHolder(conversationId);
  if (holder && holder.agentId !== agent) {
    await addTeletelNote(conversationId, `🔒 مُراد لم يحوّل المحادثة: العميل اشترى منّا وهي مع ${holder.name ?? "موظفها"} — تبقى معه.`);
    return false;
  }
  if (teamId && agent && (await assignAgentThenTeam(conversationId, agent, teamId))) return true;
  return assignMuradHandoff(conversationId, teamId, agent);
}
