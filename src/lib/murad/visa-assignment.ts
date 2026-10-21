export type VisaAgent = { id: number; name: string; availability_status?: string; confirmed?: boolean; inbox_ids?: number[] };
export type MuradReceipt = { receivedAt: string; firstResponder?: boolean; waitSec: number; assignedAt?: string; team?: string; agent?: string | null; pending?: boolean };
/** Only online members who can access the conversation inbox; busy is not available. */
export function chooseVisaAgent(members: VisaAgent[], inboxId: number | null, workloads: Map<number, number>): VisaAgent | null {
  return members.filter((a) => a.availability_status === "online" && a.confirmed !== false && inboxId !== null && Array.isArray(a.inbox_ids) && a.inbox_ids.includes(inboxId))
    .sort((a, b) => (workloads.get(a.id) ?? 0) - (workloads.get(b.id) ?? 0) || a.id - b.id)[0] ?? null;
}
