import {
  actionDue, dueAmount, missingDocs, paymentState, replyOverdue, VISA_OPEN, VISA_STATUSES,
  type VisaBoard, type VisaFile, type VisaFilter, type VisaRow, type VisaStatus,
} from "./types";
import { fold } from "./rules";

/**
 * The board's numbers and rows (the owner, 2026-10-26: «لوحة كاملة للطلبات التي جهزت وقيد التنفيذ والعملاء لم يسددوا»).
 * Pure: the action reads every file the caller may see and hands them here with the clock.
 *
 * ponytail: the aggregation is in memory over the caller's files — right for a department's few thousand
 * files; if the table ever outgrows that, move the counters to an SQL view and keep this for the rows.
 */
export type BoardFile = Pick<VisaFile,
  "id" | "serial" | "status" | "country" | "visaType" | "applicants" | "clientName" | "clientPhone" | "assignedTo" | "appliedAt" | "expectedReplyAt" | "repliedAt" |
  "feeService" | "feeEmbassy" | "currency" | "paid" | "nextAction" | "nextActionAt" | "updatedAt" | "createdAt" | "documents">;

const isOpen = (f: Pick<BoardFile, "status">) => (VISA_OPEN as readonly string[]).includes(f.status);
/** the client owes money: anything not cancelled whose fees are not all in (a delivered file with a debt counts) */
export const owes = (f: BoardFile) => f.status !== "cancelled" && dueAmount(f) > 0;

const FOCUS: Record<NonNullable<VisaFilter["focus"]>, (f: BoardFile, now: number) => boolean> = {
  missingDocs: (f) => isOpen(f) && missingDocs(f).length > 0,
  replyOverdue: (f, now) => replyOverdue(f, now),
  actionDue: (f, now) => actionDue(f, now),
  toDeliver: (f) => f.status === "approved",
  unpaid: (f) => owes(f),
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

function matches(f: BoardFile, filter: VisaFilter, now: number): boolean {
  const { status, country, assignedTo, payment, search, focus } = filter;
  if (status && status !== "all" && (status === "open" ? !isOpen(f) : f.status !== status)) return false;
  if (country && fold(f.country) !== fold(country)) return false;
  if (assignedTo && (assignedTo === "none" ? f.assignedTo !== null : f.assignedTo !== assignedTo)) return false;
  if (payment) {
    const state = paymentState(f);
    if (payment === "owing" ? state !== "unpaid" && state !== "partial" : state !== payment) return false;
  }
  if (focus && !FOCUS[focus](f, now)) return false;
  const q = search?.trim();
  if (q) {
    const hay = fold(`${f.serial} ${f.clientName} ${f.country} ${f.visaType ?? ""}`);
    // a phone typed the local way (05…) still finds +9665…
    const core = digits(q).replace(/^0+/, "");
    if (!hay.includes(fold(q)) && !(core.length >= 3 && digits(f.clientPhone).includes(core))) return false;
  }
  return true;
}

/** What needs doing first: an action that is due, then a reply that is late, then the newest. */
function order(files: BoardFile[], now: number): BoardFile[] {
  const tier = (f: BoardFile) => (actionDue(f, now) ? 0 : replyOverdue(f, now) ? 1 : 2);
  const at = (v: string | null) => (v ? Date.parse(v) : 0);
  return [...files].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (ta === 0 && a.nextActionAt !== b.nextActionAt) return at(a.nextActionAt) - at(b.nextActionAt);
    if (ta === 1 && a.expectedReplyAt !== b.expectedReplyAt) return at(a.expectedReplyAt) - at(b.expectedReplyAt);
    return at(b.createdAt) - at(a.createdAt);
  });
}

const toRow = (f: BoardFile): VisaRow => ({
  id: f.id, serial: f.serial, status: f.status, country: f.country, visaType: f.visaType, applicants: f.applicants, clientName: f.clientName, clientPhone: f.clientPhone, assignedTo: f.assignedTo,
  appliedAt: f.appliedAt, expectedReplyAt: f.expectedReplyAt, feeService: f.feeService, feeEmbassy: f.feeEmbassy, currency: f.currency, paid: f.paid, nextAction: f.nextAction, nextActionAt: f.nextActionAt,
  updatedAt: f.updatedAt, createdAt: f.createdAt, missingDocs: missingDocs(f).length,
});

export const DEFAULT_ROW_LIMIT = 200;
export const MAX_ROW_LIMIT = 500;

export function buildBoard(files: BoardFile[], filter: VisaFilter = {}, people: { id: string; name: string }[] = [], at: number = Date.now()): VisaBoard {
  const byStatus = Object.fromEntries(VISA_STATUSES.map((s) => [s, 0])) as Record<VisaStatus, number>;
  const due: Record<string, number> = {};
  let unpaidFiles = 0;
  let missing = 0;
  let overdue = 0;
  let actions = 0;
  let toDeliver = 0;
  const load = new Map<string, number>();
  for (const f of files) {
    byStatus[f.status] += 1;
    if (owes(f)) {
      unpaidFiles += 1;
      due[f.currency] = Math.round(((due[f.currency] ?? 0) + dueAmount(f)) * 100) / 100;
    }
    if (FOCUS.missingDocs(f, at)) missing += 1;
    if (FOCUS.replyOverdue(f, at)) overdue += 1;
    if (FOCUS.actionDue(f, at)) actions += 1;
    if (f.status === "approved") toDeliver += 1;
    if (f.assignedTo && isOpen(f)) load.set(f.assignedTo, (load.get(f.assignedTo) ?? 0) + 1);
  }
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_ROW_LIMIT) || DEFAULT_ROW_LIMIT, 1), MAX_ROW_LIMIT);
  return {
    people: people.map((p) => ({ id: p.id, name: p.name, open: load.get(p.id) ?? 0 })),
    counts: { total: files.length, byStatus, unpaid: { files: unpaidFiles, due }, missingDocs: missing, replyOverdue: overdue, actionDue: actions, toDeliver },
    rows: order(files.filter((f) => matches(f, filter, at)), at).slice(0, limit).map(toRow),
  };
}
