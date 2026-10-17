import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { OfferStatus } from "@/lib/types";
import type { ClientStatus, ExecutionStatus } from "@/lib/operations/state";
import {
  fileState,
  fileTimeline,
  lastSentVersion,
  staleSend,
  type AuditRow,
  type FileState,
  type HistoryRow,
  type TimelineEntry,
} from "@/lib/offer/file-state";

/**
 * The files' states for Basic, read with the service role — offers, the
 * operations and the audit log are closed to sessions — and only for the files
 * the caller's own list or draft already gave them (draft-store's gate). Not a
 * server action: callable from server code only.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
export const riyadhToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

type OfferRow = { id: string; serial: string; status: OfferStatus; valid_until: string | null; employee_id: string | null; partner_company_id: string | null; created_at: string | null };
const OFFER_COLUMNS = "id, serial, status, valid_until, employee_id, partner_company_id, created_at";
type OpRow = { id: string; offer_id: string; client_status: ClientStatus; execution_status: ExecutionStatus };

export type FileStatusRow = {
  state: FileState;
  /** the client has an older version than the file */
  stale: boolean;
  /** the version the client last had — the chip of a sent file names it, not the newest. */
  sent_version: number | null;
  operation_id: string | null;
};

const SENT_ACTION = "offer.client_sent";

/** One state per issued file of the list, by draft id. A file the lookup misses reads as issued. */
export async function fileStatesFor(drafts: { id: string; produced_serial: string | null; version: number | null }[]): Promise<Record<string, FileStatusRow>> {
  const issued = drafts.filter((d) => d.produced_serial);
  const out: Record<string, FileStatusRow> = {};
  if (issued.length === 0) return out;
  try {
    const service = db();
    const { data: offers } = await service
      .from("offers")
      .select(OFFER_COLUMNS)
      .in("serial", issued.map((d) => d.produced_serial as string));
    const bySerial = new Map(((offers ?? []) as OfferRow[]).map((o) => [o.serial, o]));
    const ids = [...bySerial.values()].map((o) => o.id);
    const [ops, sends] = await Promise.all([
      ids.length ? service.from("operations").select("id, offer_id, client_status, execution_status").in("offer_id", ids) : Promise.resolve({ data: [] }),
      ids.length
        ? service.from("audit_logs").select("entity_id, action, meta").eq("entity", "offers").eq("action", SENT_ACTION).in("entity_id", ids)
        : Promise.resolve({ data: [] }),
    ]);
    const opOf = new Map(((ops.data ?? []) as OpRow[]).map((o) => [o.offer_id, o]));
    const sendsOf = new Map<string, Pick<AuditRow, "action" | "meta">[]>();
    for (const s of (sends.data ?? []) as { entity_id: string; action: string; meta: Record<string, unknown> | null }[]) {
      sendsOf.set(s.entity_id, [...(sendsOf.get(s.entity_id) ?? []), s]);
    }
    const today = riyadhToday();
    for (const d of issued) {
      const offer = bySerial.get(d.produced_serial as string);
      if (!offer) continue;
      const op = opOf.get(offer.id) ?? null;
      const sentVersion = lastSentVersion(sendsOf.get(offer.id) ?? []);
      const facts = { serial: offer.serial, offerStatus: offer.status, validUntil: offer.valid_until, sentVersion, version: d.version, issuedAt: offer.created_at, op, today };
      out[d.id] = { state: fileState(facts), stale: staleSend(facts), sent_version: sentVersion, operation_id: op?.id ?? null };
    }
  } catch {
    // the list still opens; the chips fall back to «صدر»
  }
  return out;
}

export type FileStatusDetail = {
  offer: OfferRow;
  operation: OpRow | null;
  state: FileState;
  stale: boolean;
  version: number | null;
  sentVersion: number | null;
  timeline: TimelineEntry[];
};

/** One file in full: its state, the versions sent, and its history. */
export async function loadFileStatus(serial: string): Promise<FileStatusDetail | null> {
  const service = db();
  const { data: offerData } = await service
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("serial", serial)
    .maybeSingle();
  const offer = offerData as OfferRow | null;
  if (!offer) return null;
  const [opRes, historyRes, rendersRes] = await Promise.all([
    service.from("operations").select("id, offer_id, client_status, execution_status").eq("offer_id", offer.id).maybeSingle(),
    service.from("offer_status_history").select("to_status, note, created_at, changed_by").eq("offer_id", offer.id),
    service.from("offer_renders").select("version, rendered_at, rendered_by").eq("offer_id", offer.id).eq("variant", "client"),
  ]);
  const operation = (opRes.data ?? null) as OpRow | null;
  const entityIds = [offer.id, ...(operation ? [operation.id] : [])];
  const { data: auditData } = await service
    .from("audit_logs")
    .select("action, meta, created_at, actor_id")
    .in("entity_id", entityIds)
    .in("action", [SENT_ACTION, "operation.cancelled", "operation.client_status", "operation.execution_status"])
    .order("created_at", { ascending: false })
    .limit(60);
  const history = (historyRes.data ?? []) as { to_status: string; note: string | null; created_at: string; changed_by: string | null }[];
  const audits = (auditData ?? []) as { action: string; meta: Record<string, unknown> | null; created_at: string; actor_id: string | null }[];
  // the people, by name
  const renders = (rendersRes.data ?? []) as { version: number; rendered_at: string; rendered_by: string | null }[];
  const people = [...new Set([...history.map((h) => h.changed_by), ...audits.map((a) => a.actor_id), ...renders.map((r) => r.rendered_by)].filter((x): x is string => Boolean(x)))];
  const { data: names } = people.length ? await service.from("employees").select("id, arabic_name").in("id", people) : { data: [] };
  const nameOf = new Map(((names ?? []) as { id: string; arabic_name: string | null }[]).map((e) => [e.id, e.arabic_name]));
  const historyRows: HistoryRow[] = history.map((h) => ({ to_status: h.to_status, note: h.note, created_at: h.created_at, by: h.changed_by ? (nameOf.get(h.changed_by) ?? null) : null }));
  const auditRows: AuditRow[] = audits.map((a) => ({ action: a.action, meta: a.meta, created_at: a.created_at, by: a.actor_id ? (nameOf.get(a.actor_id) ?? null) : null }));
  const version = Math.max(0, ...renders.map((r) => r.version)) || null;
  const sentVersion = lastSentVersion(auditRows);
  const facts = { serial: offer.serial, offerStatus: offer.status, validUntil: offer.valid_until, sentVersion, version, issuedAt: offer.created_at, op: operation, today: riyadhToday() };
  const renderRows = renders.map((r) => ({ version: r.version, at: r.rendered_at, by: r.rendered_by ? (nameOf.get(r.rendered_by) ?? null) : null }));
  return {
    offer,
    operation,
    state: fileState(facts),
    stale: staleSend(facts),
    version,
    sentVersion,
    timeline: fileTimeline(historyRows, auditRows, renderRows),
  };
}
