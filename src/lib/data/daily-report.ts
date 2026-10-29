"use server";

import { currentCan } from "@/lib/roles/current";
import { leadThread } from "@/lib/data/leads";
import { reasonFromMessages } from "@/lib/leads/incomplete-reason";
import type { SupervisionFigures } from "@/lib/leads/daily-report";
import { getSupervisionReport } from "@/lib/followups/supervision/actions";

/**
 * «التقرير» — why each unclear request is unclear («ارسل مرفقات فقط», «تحية فقط»), read from what the client wrote in
 * their Teletel conversation. Only the reason comes back, never the client's words. The reviewer presses a button for it:
 * it is a live read of Teletel per conversation, so at most 20 at a time, three at once; whatever cannot be told is
 * left out and the reviewer types it. Staff who open «العملاء» (clients.view), like the page itself.
 *
 * `tried`: the conversations that were read (told or not), so the next press goes on to the next ones; `failed`: those
 * Teletel (or the session) could not answer — said to the reviewer, not read as «nothing to tell».
 */
const MAX = 20;
const AT_ONCE = 3;

export type ReasonsResult = { reasons: Record<string, string>; tried: string[]; failed: number };

export async function incompleteReasons(ids: string[]): Promise<ReasonsResult> {
  const wanted = Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))].slice(0, MAX) : [];
  if (!(await currentCan("clients.view"))) return { reasons: {}, tried: [], failed: wanted.length };
  const reasons: Record<string, string> = {};
  const tried: string[] = [];
  let failed = 0;
  for (let i = 0; i < wanted.length; i += AT_ONCE) {
    await Promise.all(
      wanted.slice(i, i + AT_ONCE).map(async (id) => {
        const thread = await leadThread(id).catch(() => null);
        if (!thread?.ok) {
          failed += 1;
          return;
        }
        tried.push(id);
        const reason = reasonFromMessages(thread.messages);
        if (reason) reasons[id] = reason;
      }),
    );
  }
  return { reasons, tried, failed };
}

/**
 * «متابعة الموظفين» for the report: session C's supervision figures (followups/supervision/actions.ts
 * getSupervisionReport) over the last `days` × 24 hours, as they are — what the caller may see there is what comes back
 * (a manager sees everyone, a supervisor their scope: `all` says which). null when the supervision is not set up yet (its
 * tables are applied by the coordinator) or nothing could be read.
 */
export async function getReportSupervision(days: number): Promise<SupervisionFigures | null> {
  if (!(await currentCan("clients.view"))) return null;
  const span = Math.min(Math.max(Math.round(Number.isFinite(days) ? days : 1), 1), 180);
  const report = await getSupervisionReport(span).catch(() => null);
  if (!report || !report.enabled) return null;
  const all = (await Promise.all([currentCan("followups.manage"), currentCan("dashboard.admin"), currentCan("developer.access")])).some(Boolean);
  return {
    days: span,
    all,
    lines: report.employees
      .filter((row) => row.key !== "—")
      .map((row) => ({ name: report.names[row.key] ?? "موظف", due: row.due, done: row.done, overdue: row.overdue, compliance: row.compliance })),
  };
}
