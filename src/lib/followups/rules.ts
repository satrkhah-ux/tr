export const OUTCOMES = {
  no_answer: "لم يرد", interested: "مهتم", revise_offer: "طلب تعديل العرض",
  later: "التواصل لاحقًا", not_interested: "غير مهتم", completed: "اكتملت المتابعة", transferred: "تحويل لقسم آخر",
} as const;
export const STAGES = { new: "جديد", working: "قيد المتابعة", waiting: "بانتظار العميل", scheduled: "مجدول", transferred: "تم التحويل", completed: "مكتمل" } as const;
export type WorkRow = {
  id: string; conversation_id: number; contact_name: string | null; contact_phone: string | null;
  status: "open" | "done"; stage: keyof typeof STAGES; assigned_to: string | null; assigned_at: string | null;
  request_started_at: string; created_at: string; next_followup_at: string | null; first_followed_at: string | null;
  last_attempt_at: string | null; last_client_at: string | null; last_synced_at: string | null;
  source: string; source_team_id: number | null; transfer_reason: string | null; outcome: string | null;
  external_status: string | null; attempt_count: number; send_lock: string | null; done_at: string | null;
};
export type Attempt = { id: string; employee_id: string | null; kind: string; outcome: string | null; note: string | null; due_at: string | null; provider_message_id: number | null; delivery_state: string; created_at: string };
export type FollowupAccess = { employeeId: string; manager: boolean };
export type WorkResult = { ok: true; duplicate?: boolean; state?: string; id?: string } | { ok: false; error: string };
export function mayRead(row: Pick<WorkRow, "assigned_to" | "status">, access: FollowupAccess): boolean {
  return access.manager || row.assigned_to === access.employeeId || (row.status === "open" && !row.assigned_to);
}
export function mayAct(row: Pick<WorkRow, "assigned_to">, access: FollowupAccess): boolean {
  return access.manager || row.assigned_to === access.employeeId;
}
export function validateResult(outcome: string, dueAt: string | null, note: string, now = Date.now()): string | null {
  if (!Object.hasOwn(OUTCOMES, outcome)) return "invalid";
  if (dueAt && (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= now)) return "due";
  if (["no_answer", "later"].includes(outcome) && !dueAt) return "due";
  if (["completed", "not_interested", "transferred"].includes(outcome) && !note.trim()) return "note";
  return null;
}
export const WORK_COLS = "id,conversation_id,contact_name,contact_phone,status,stage,assigned_to,assigned_at,request_started_at,created_at,next_followup_at,first_followed_at,last_attempt_at,last_client_at,last_synced_at,source,source_team_id,transfer_reason,outcome,external_status,attempt_count,send_lock,done_at";
