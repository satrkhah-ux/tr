import type { OperationBooking } from "@/lib/data/operation-bookings";
import { flightTicketed, hotelFinal } from "@/lib/operations/client-booking-state";
import { derivedExecution } from "@/lib/operations/progress";
import { CLIENT_DOCUMENT_KINDS, type VoucherKind } from "@/lib/operations/voucher-dto";
import type { ReadinessCase, ReadinessItem, StepState, WizardCase } from "./types";

/**
 * Step 6 — «المستندات والإرسال»: no «إصدار» button per document. Each one
 * issues by itself the moment what it prints is final — on the server, after
 * every confirmation, whatever screen made it (wizard-sync.ts
 * autoIssueDocuments, run by operation-sync) — and this file says which are
 * due, which are out, and what each of the rest still waits for.
 *
 * The hotel voucher is ONE file with every hotel, issued once all of them hold
 * their FINAL confirmation — confirmed AND the hotel's own number, not ours
 * (client-booking-state hotelFinal, the rule issueDocument enforces). The user,
 * 2026-10-22: «يفضل الفنادق تكون بملف واحد بعد التأكيد الكلي» — it was one
 * voucher per hotel as each came back (the owner, 2026-10-17). The
 * ticket waits for every flight; the itinerary for the authored days; the
 * arrival sign for a transfer to meet the travellers. issueDocument keeps its
 * own checks: a voucher it refuses comes back as an error, never a blank page.
 * (A flight counts by the one flight-done rule, client-booking-state
 * flightTicketed — the flights step's own.)
 */

export type DocWhy = "hotel_final" | "flights" | "days" | "transfer";
export type DocLine = {
  kind: VoucherKind;
  booking_id: string | null;
  /** the hotel's name, for a per-hotel voucher (none is planned now; the type keeps the field for the screens) */
  title: string | null;
  state: "issued" | "due" | "waiting";
  why?: DocWhy;
  /** the live document's share token, once issued */
  token?: string;
};

type Docs = Pick<WizardCase, "bookings" | "documents" | "hasDays" | "travelers">;

const live = (b: OperationBooking) => b.status !== "cancelled" && b.status !== "failed";

export function documentPlan(data: Docs): DocLine[] {
  const docs = data.documents.filter((d) => !d.revoked_at);
  // the whole-file paper only: an older single-hotel voucher is not the file's voucher
  const out = (kind: VoucherKind, bookingId: string | null = null) => docs.find((d) => d.kind === kind && (d.booking_id ?? null) === bookingId);
  const line = (kind: VoucherKind, ready: boolean, why: DocWhy, booking: OperationBooking | null = null): DocLine => {
    const doc = out(kind, booking?.id ?? null);
    return {
      kind,
      booking_id: booking?.id ?? null,
      title: booking?.title ?? null,
      ...(doc ? { state: "issued" as const, token: doc.token } : ready ? { state: "due" as const } : { state: "waiting" as const, why }),
    };
  };
  const bookings = data.bookings.filter(live);
  const flights = bookings.filter((b) => b.kind === "flight");
  const hotels = bookings.filter((b) => b.kind === "hotel");
  const lead = data.travelers[0]?.display_name.trim();
  return [
    ...(hotels.length ? [line("hotel_voucher", hotels.every(hotelFinal), "hotel_final")] : []),
    ...(flights.length ? [line("flight_ticket", flights.every(flightTicketed), "flights")] : []),
    line("itinerary", data.hasDays, "days"),
    line("welcome_board", Boolean(lead) && bookings.some((b) => b.kind === "transport"), "transfer"),
  ];
}

/** What is issued now — by the server after every change, and by the shell's AutoIssue for whatever is still due. */
export const dueDocuments = (data: Docs) => documentPlan(data).filter((l) => l.state === "due");

/**
 * A snapshot as one comparable string: keys sorted at every level (jsonb gives
 * them back in its own order), the issue day left out — the same paper issued
 * again tomorrow is still the same paper.
 */
export function snapshotKey(snapshot: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  const rest: Record<string, unknown> = { ...((snapshot ?? {}) as Record<string, unknown>) };
  delete rest.issued_at;
  return JSON.stringify(canon(rest));
}

type IssuedDoc = { booking_id: string | null; revoked_at: string | null; created_at: string; snapshot_json: unknown };

/**
 * The live document of this kind and booking that already prints exactly this
 * snapshot — `docs` are the case's documents of one kind. Issuing again would
 * only add an identical version, so issueDocument hands this one back instead.
 * Only the LATEST counts: a paper changed and then changed back is a new version.
 */
export function sameDocument<T extends IssuedDoc>(docs: readonly T[], bookingId: string | null, snapshot: unknown): T | null {
  const latest = docs
    .filter((d) => !d.revoked_at && (d.booking_id ?? null) === bookingId)
    .reduce<T | null>((a, d) => (!a || d.created_at > a.created_at ? d : a), null);
  return latest && snapshotKey(latest.snapshot_json) === snapshotKey(snapshot) ? latest : null;
}

/**
 * Every client document is out: progress.ts's rule (the one that moves the case
 * to «vouchers_issued» — it also wants every booking of every kind confirmed)
 * AND the one hotel voucher printing every hotel.
 */
export function clientDocumentsOut(data: Docs): boolean {
  const docs = data.documents.filter((d) => !d.revoked_at && CLIENT_DOCUMENT_KINDS.includes(d.kind));
  return (
    derivedExecution(data.bookings, docs) === "vouchers_issued" &&
    documentPlan(data).every((l) => l.kind === "welcome_board" || l.state === "issued")
  );
}

export function documentsState(data: Docs & Pick<WizardCase, "clientToken">): StepState {
  return clientDocumentsOut(data) && data.clientToken ? "done" : "todo";
}

export function documentsReadiness(data: ReadinessCase): ReadinessItem[] {
  return [
    { step: "documents", key: "documents", ok: clientDocumentsOut(data) },
    { step: "documents", key: "link", ok: Boolean(data.clientToken), optional: true },
    { step: "documents", key: "arrival_sign", ok: data.documents.some((d) => !d.revoked_at && d.kind === "welcome_board"), optional: true },
    // the emergency numbers the client's link shows come from the destination's guide
    { step: "documents", key: "guide", ok: Boolean(data.guide?.local_agent_phone || data.guide?.embassy_phone), optional: true },
  ];
}
