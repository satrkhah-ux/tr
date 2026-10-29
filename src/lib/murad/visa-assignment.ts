export type VisaAgent = { id: number; name: string; availability_status?: string; confirmed?: boolean; inbox_ids?: number[] };
export type MuradReceipt = { receivedAt: string; firstResponder?: boolean; waitSec: number; assignedAt?: string; team?: string; agent?: string | null; pending?: boolean };
