import "server-only";
import { assignMuradHandoff } from "@/lib/providers/teletel";
import { onList, type MuradControl } from "./control";

/**
 * Every hand-over Murad makes goes through here (the owner, 2026-10-24): a number on «لا يُحوّل أبداً» is handed to
 * no one, and a colleague on «موقوف» is skipped — the department still gets it.
 */
export async function handOver(control: MuradControl, conversationId: number, teamId: number | null, agentId: number | null, phone: string | null | undefined): Promise<boolean> {
  if (onList(phone, control.noHandoff)) return false;
  return assignMuradHandoff(conversationId, teamId, agentId && control.paused?.includes(agentId) ? null : agentId);
}
