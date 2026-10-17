/**
 * «بلا منفّذ»: 'ops' is the column's default AND a real choice — «قسم العمليات» books it
 * itself (0027). Only the default, which nobody picked (no assigned_at), is no executor
 * yet; the picker and the chip say so instead of «قسم العمليات».
 */
export const isUnassigned = (b: { assignee_kind?: string; assigned_at?: string | null }) => (b.assignee_kind ?? "ops") === "ops" && !b.assigned_at;
