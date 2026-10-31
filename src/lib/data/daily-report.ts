"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { leadThread } from "@/lib/data/leads";
import { reasonFromMessages } from "@/lib/leads/incomplete-reason";
import type { SupervisionFigures } from "@/lib/leads/daily-report";
import { getSupervisionReport } from "@/lib/followups/supervision/actions";
import { exemptNow } from "@/lib/manager-screen/exempt";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";

/**
 * «التقرير» — why each unclear request is unclear («ارسل مرفقات فقط», «تحية فقط»), read from what the client wrote in
 * their Teletel conversation. Only the reason comes back, never the client's words. The reviewer presses a button for it:
 * it is a live read of Teletel per conversation, so at most 20 at a time, three at once; a reason is given only when the
 * whole history was read (a cut-off thread could be hiding the request itself), and whatever cannot be told is left out
 * and the reviewer types it. Staff who open «العملاء» (clients.view), like the page itself.
 *
 * `tried`: the conversations that were read (told or not), so the next press goes on to the next ones; `failedIds`: those
 * Teletel (or the session) could not answer — said to the reviewer and tried again after the others, not read as «nothing
 * to tell».
 */
const MAX = 20;
const AT_ONCE = 3;

export type ReasonsResult = { reasons: Record<string, string>; tried: string[]; failedIds: string[] };

export async function incompleteReasons(ids: string[]): Promise<ReasonsResult> {
  const wanted = Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, MAX) : [];
  if (!(await currentCan("clients.view"))) return { reasons: {}, tried: [], failedIds: wanted };
  const reasons: Record<string, string> = {};
  const tried: string[] = [];
  const failedIds: string[] = [];
  for (let i = 0; i < wanted.length; i += AT_ONCE) {
    await Promise.all(
      wanted.slice(i, i + AT_ONCE).map(async (id) => {
        const thread = await leadThread(id).catch(() => null);
        if (!thread?.ok) {
          failedIds.push(id);
          return;
        }
        tried.push(id);
        const reason = thread.historyComplete ? reasonFromMessages(thread.messages) : null;
        if (reason) reasons[id] = reason;
      }),
    );
  }
  return { reasons, tried, failedIds };
}

/**
 * «متابعة الموظفين» for the report: session C's supervision figures (followups/supervision/actions.ts
 * getSupervisionReport) over the last `days` × 24 hours, as they are — what the caller may see there is what comes back
 * (a manager sees everyone, a supervisor their scope: `all` says which managers). The colleagues exempted from lateness
 * («لا يُحسب عليهم تأخير», app_settings lateness_exempt) are left out: no figure of lateness is printed against them.
 * null when the supervision is not set up yet (its tables are applied by the coordinator) or nothing could be read.
 */
export async function getReportSupervision(days: number): Promise<SupervisionFigures | null> {
  if (!(await currentCan("clients.view"))) return null;
  const span = Math.min(Math.max(Math.round(Number.isFinite(days) ? days : 1), 1), 180);
  const report = await getSupervisionReport(span).catch(() => null);
  if (!report || !report.enabled) return null;
  const [all, exempt] = await Promise.all([
    Promise.all([currentCan("followups.manage"), currentCan("dashboard.admin"), currentCan("developer.access")]).then((r) => r.some(Boolean)),
    exemptNow(createSupabaseServiceClient() as unknown as SupabaseClient),
  ]);
  return {
    days: span,
    all,
    lines: report.employees
      .filter((row) => row.key !== "—" && !exempt.employeeIds.has(row.key))
      .map((row) => ({ name: report.names[row.key] ?? "موظف", due: row.due, done: row.done, overdue: row.overdue, compliance: row.compliance })),
  };
}

/**
 * «مطابقة تقريري» (the owner, 2026-10-31): the daily report a follow-up employee writes by hand, kept per day and per
 * employee (app_settings `staff_report:<day>:<employee>`) beside the comparison she saw — read back by her, and by the
 * coordinator who studies the differences until one way of counting is agreed. reports.staff_compare, or a manager.
 */
export type StaffReportSaved = { text: string; name: string | null; at: string; rows: unknown };

async function staffReportKey(day: string): Promise<{ key: string; employeeId: string } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const allowed = (await Promise.all([currentCan("reports.staff_compare"), currentCan("dashboard.admin")])).some(Boolean);
  const employeeId = allowed ? await getCurrentEmployeeId() : null;
  return employeeId ? { key: `staff_report:${day}:${employeeId}`, employeeId } : null;
}

/** null when the caller may not compare; else what she saved for that day (or null) */
export async function getStaffReport(day: string): Promise<{ saved: StaffReportSaved | null } | null> {
  const k = await staffReportKey(day);
  if (!k) return null;
  const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient).from("app_settings").select("value").eq("key", k.key).maybeSingle();
  try {
    return { saved: data?.value ? (JSON.parse(data.value) as StaffReportSaved) : null };
  } catch {
    return { saved: null };
  }
}

export async function saveStaffReport(day: string, text: string, rows: unknown): Promise<{ ok: boolean; error?: string }> {
  const k = await staffReportKey(day);
  if (!k) return { ok: false, error: "لا صلاحية لحفظ التقرير" };
  const body = String(text ?? "").slice(0, 20_000);
  if (!body.trim()) return { ok: false, error: "التقرير فارغ" };
  const db = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data: me } = await db.from("employees").select("arabic_name").eq("id", k.employeeId).maybeSingle();
  const value: StaffReportSaved = { text: body, name: (me?.arabic_name as string | undefined)?.replace(/[\u200e\u200f]/g, "").trim() ?? null, at: new Date().toISOString(), rows: JSON.parse(JSON.stringify(rows ?? null)) };
  const { error } = await db.from("app_settings").upsert({ key: k.key, value: JSON.stringify(value), updated_at: value.at });
  if (error) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "reports.staff_saved", entity: "employees", entity_id: k.employeeId, meta: { day, key: k.key } });
  return { ok: true };
}
