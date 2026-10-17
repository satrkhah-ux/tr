/**
 * Where a file stands, as the employee needs to see it in «النظام بيسك» (the
 * owner, 2026-10-17: «حالة البكج مثلاً مؤكد أو تم إرساله… لم تتواجد في البيسك»).
 *
 * One ladder, read from what the system already records — the offer's status
 * and its validity, whether the employee sent it to the client (and which
 * version), and the operation's two tracks once the client confirmed:
 *
 *   مسودة ← صدر ← أُرسل للعميل ← مؤكّد ← مسدّد جزئياً ← مسدّد بالكامل ← جاهز للسفر ← سافر
 *   with «انتهت صلاحية العرض» for a priced offer past its date, and «ملغى».
 *
 * Pure: no React, no Supabase.
 */

import type { OfferStatus } from "@/lib/types";
import type { ClientStatus, ExecutionStatus } from "@/lib/operations/state";

export const FILE_STATES = ["draft", "issued", "sent", "expired", "confirmed", "paid_partial", "paid_full", "ready", "travelled", "cancelled"] as const;
export type FileState = (typeof FILE_STATES)[number];

export type FileFacts = {
  serial: string | null;
  offerStatus: OfferStatus | null;
  /** the date the prices hold to (offers.valid_until). */
  validUntil: string | null;
  /** the version the client was last sent (null: never), and the newest issued one. */
  sentVersion: number | null;
  version: number | null;
  op: { client_status: ClientStatus; execution_status: ExecutionStatus } | null;
  /** today in the company's zone (Asia/Riyadh), YYYY-MM-DD. */
  today: string;
};

/** The one state a file is in — the furthest it has got, a cancellation over everything. */
export function fileState(f: FileFacts): FileState {
  const op = f.op;
  if (f.offerStatus === "cancelled" || op?.client_status === "cancelled" || op?.execution_status === "cancelled") return "cancelled";
  if (op?.execution_status === "travelled") return "travelled";
  if (op?.execution_status === "ready_to_travel") return "ready";
  if (op?.client_status === "paid_full" || op?.client_status === "completed") return "paid_full";
  if (op?.client_status === "paid_partial") return "paid_partial";
  if (op || f.offerStatus === "confirmed") return "confirmed";
  if (!f.serial) return "draft";
  // a priced offer past its date asks for a price check before anything else
  if (f.validUntil && f.validUntil.slice(0, 10) < f.today) return "expired";
  return f.sentVersion != null ? "sent" : "issued";
}

/** Sent once, then issued again: the client has an older version than the file. */
export function staleSend(f: Pick<FileFacts, "sentVersion" | "version">): boolean {
  return f.sentVersion != null && f.version != null && f.version > f.sentVersion;
}

/** States the client has not confirmed yet — «العميل أكّد» belongs to them. */
export const AWAITING_CLIENT: readonly FileState[] = ["issued", "sent", "expired"];

/**
 * «إلغاء الملف» from Basic: only before operations hold anything — a partner's
 * file is the partner's, and a confirmed file is cancelled from its case.
 */
export function canCancelFile(f: { partner: boolean; hasCase: boolean; state: FileState }): "ok" | "partner" | "inOperations" | "already" {
  if (f.state === "cancelled") return "already";
  if (f.partner) return "partner";
  if (f.hasCase) return "inOperations";
  return "ok";
}

/** One line of the file's history. `key` is a Basic label; `status` names a track's state. */
export type TimelineEntry = {
  at: string;
  key: "issued" | "reissued" | "sent" | "sentManual" | "sentWindow" | "sentFailed" | "confirmed" | "cancelled" | "client" | "execution";
  by: string | null;
  version?: number | null;
  status?: string | null;
  note?: string | null;
};

export type HistoryRow = { to_status: string; note: string | null; created_at: string; by: string | null };
export type AuditRow = { action: string; meta: Record<string, unknown> | null; created_at: string; by: string | null };

/** The status history and the audit rows, merged in time order (newest first). */
export function fileTimeline(history: HistoryRow[], audits: AuditRow[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const h of history) {
    if (h.to_status === "sent") out.push({ at: h.created_at, key: "issued", by: h.by, note: h.note });
    else if (h.to_status === "confirmed") out.push({ at: h.created_at, key: "confirmed", by: h.by, note: h.note });
    else if (h.to_status === "cancelled") out.push({ at: h.created_at, key: "cancelled", by: h.by, note: h.note });
  }
  for (const a of audits) {
    const m = a.meta ?? {};
    const version = typeof m.version === "number" ? m.version : null;
    if (a.action === "offer.reissued") out.push({ at: a.created_at, key: "reissued", by: a.by, version });
    else if (a.action === "offer.client_sent") {
      const result = String(m.result ?? "");
      const key = result === "sent" ? "sent" : result === "manual" ? "sentManual" : result === "window" ? "sentWindow" : "sentFailed";
      out.push({ at: a.created_at, key, by: a.by, version });
    } else if (a.action === "operation.client_status") out.push({ at: a.created_at, key: "client", by: a.by, status: String(m.to ?? m.status ?? "") || null });
    else if (a.action === "operation.execution_status") out.push({ at: a.created_at, key: "execution", by: a.by, status: String(m.to ?? m.status ?? "") || null });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** The latest version a client was really sent — a «window» note or a failure is not a send. */
export function lastSentVersion(audits: Pick<AuditRow, "action" | "meta">[]): number | null {
  let best: number | null = null;
  for (const a of audits) {
    if (a.action !== "offer.client_sent") continue;
    const m = a.meta ?? {};
    if (m.result !== "sent" && m.result !== "manual") continue;
    const v = typeof m.version === "number" ? m.version : 1;
    best = best == null ? v : Math.max(best, v);
  }
  return best;
}
