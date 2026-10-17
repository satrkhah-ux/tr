import type { OperationBooking } from "@/lib/data/operation-bookings";
import { derivedExecution } from "@/lib/operations/progress";
import { CLIENT_DOCUMENT_KINDS, type VoucherKind } from "@/lib/operations/voucher-dto";
import type { ReadinessItem, StepState, WizardCase } from "./types";

/**
 * Step 6 — «المستندات والإرسال»: no «إصدار» button per document. Each one
 * issues by itself the moment what it prints is final (the shell does it on
 * opening the case — DocumentsStep AutoIssue), and this file says which are due,
 * which are out, and what each of the rest still waits for.
 *
 * A hotel voucher waits for the hotel's FINAL confirmation — confirmed AND its
 * confirmation number — one voucher per hotel (the owner, 2026-10-17); the
 * ticket waits for every flight; the itinerary for the authored days; the
 * arrival sign for a transfer to meet the travellers. issueDocument keeps its
 * own checks: a voucher it refuses comes back as an error, never a blank page.
 * (A flight counts as final with its PNR, a ticket number or a confirmation
 * number — the flights step reads them off the uploaded ticket, 0084.)
 */

export type DocWhy = "hotel_final" | "flights" | "days" | "transfer";
export type DocLine = {
  kind: VoucherKind;
  booking_id: string | null;
  /** the hotel's name, for a per-hotel voucher */
  title: string | null;
  state: "issued" | "due" | "waiting";
  why?: DocWhy;
  /** the live document's share token, once issued */
  token?: string;
};

type Docs = Pick<WizardCase, "bookings" | "documents" | "hasDays" | "travelers">;

const live = (b: OperationBooking) => b.status !== "cancelled" && b.status !== "failed";

/** A hotel's confirmation is final once it is confirmed AND carries the hotel's own number. */
export const hotelFinal = (b: Pick<OperationBooking, "status" | "confirmation_number">) => b.status === "confirmed" && Boolean(b.confirmation_number?.trim());

/** A flight is ticketed once confirmed with a record locator, a ticket number or a confirmation number on it. */
export const flightFinal = (b: Pick<OperationBooking, "status" | "confirmation_number" | "pnr" | "ticket_numbers">) =>
  b.status === "confirmed" && Boolean(b.pnr?.trim() || b.ticket_numbers?.length || b.confirmation_number?.trim());

export function documentPlan(data: Docs): DocLine[] {
  const docs = data.documents.filter((d) => !d.revoked_at);
  const out = (kind: VoucherKind, bookingId: string | null = null) =>
    docs.find((d) => d.kind === kind && (bookingId === null || d.booking_id === bookingId));
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
  const lead = data.travelers[0]?.display_name.trim();
  return [
    ...bookings.filter((b) => b.kind === "hotel").map((h) => line("hotel_voucher", hotelFinal(h), "hotel_final", h)),
    ...(flights.length ? [line("flight_ticket", flights.every(flightFinal), "flights")] : []),
    line("itinerary", data.hasDays, "days"),
    line("welcome_board", Boolean(lead) && bookings.some((b) => b.kind === "transport"), "transfer"),
  ];
}

/** What AutoIssue sends to issueDocument now. */
export const dueDocuments = (data: Docs) => documentPlan(data).filter((l) => l.state === "due");

/**
 * Every client document is out: progress.ts's rule (the one that moves the case
 * to «vouchers_issued» — it also wants every booking of every kind confirmed)
 * AND a voucher for each hotel, which that rule counts as one.
 */
export function clientDocumentsOut(data: Docs): boolean {
  const docs = data.documents.filter((d) => !d.revoked_at && CLIENT_DOCUMENT_KINDS.includes(d.kind));
  return (
    derivedExecution(data.bookings, docs) === "vouchers_issued" &&
    documentPlan(data).every((l) => l.kind === "welcome_board" || l.state === "issued")
  );
}

export function documentsState(data: WizardCase): StepState {
  return clientDocumentsOut(data) && data.clientToken ? "done" : "todo";
}

export function documentsReadiness(data: WizardCase): ReadinessItem[] {
  return [
    { step: "documents", key: "documents", ok: clientDocumentsOut(data) },
    { step: "documents", key: "link", ok: Boolean(data.clientToken), optional: true },
    { step: "documents", key: "arrival_sign", ok: data.documents.some((d) => !d.revoked_at && d.kind === "welcome_board"), optional: true },
    // the emergency numbers the client's link shows come from the destination's guide
    { step: "documents", key: "guide", ok: Boolean(data.guide?.local_agent_phone || data.guide?.embassy_phone), optional: true },
  ];
}
