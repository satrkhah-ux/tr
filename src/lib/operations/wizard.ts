import { derivedExecution } from "./progress";

/**
 * «من التأكيد إلى السفر» (operations order 11, suggestion 1): the six steps a
 * confirmed case walks, each read from what the case already holds — pure.
 * The wizard shows where the case is and offers the one action that moves it;
 * the agent reviews, the system does the typing.
 */

export type WizardStepKey = "pull" | "travelers" | "assign" | "requests" | "confirm" | "documents";

export type WizardStep = { key: WizardStepKey; done: boolean; /** how many items still hold it back */ left: number };

export type WizardInput = {
  bookings: { id: string; kind: string; status: string; assignee_kind: string }[];
  travelers: number;
  documents: { kind: string; revoked_at?: string | null }[];
  clientToken: string | null;
  /** order 8: where each booking's request stands */
  requests: { booking_id: string; state: string }[];
};

const live = (b: { status: string }) => b.status !== "cancelled" && b.status !== "failed";

export function wizardSteps(input: WizardInput): WizardStep[] {
  const bookings = input.bookings.filter(live);
  const open = bookings.filter((b) => b.status !== "confirmed");
  // «ops» is the default — nobody chose who books it yet (a supplier, a colleague, a partner)
  const unassigned = open.filter((b) => b.assignee_kind === "ops");
  const stateOf = new Map(input.requests.map((r) => [r.booking_id, r.state]));
  const unsent = open.filter((b) => b.assignee_kind !== "ops" && !["sent", "overdue", "confirmed"].includes(stateOf.get(b.id) ?? "none"));
  const documentsOut = derivedExecution(input.bookings, input.documents.filter((d) => !d.revoked_at)) === "vouchers_issued";

  return [
    { key: "pull", done: bookings.length > 0, left: bookings.length > 0 ? 0 : 1 },
    { key: "travelers", done: input.travelers > 0, left: input.travelers > 0 ? 0 : 1 },
    { key: "assign", done: bookings.length > 0 && unassigned.length === 0, left: unassigned.length },
    { key: "requests", done: bookings.length > 0 && unassigned.length === 0 && unsent.length === 0, left: unsent.length },
    { key: "confirm", done: bookings.length > 0 && open.length === 0, left: open.length },
    { key: "documents", done: documentsOut && Boolean(input.clientToken), left: (documentsOut ? 0 : 1) + (input.clientToken ? 0 : 1) },
  ];
}

/** The step to work on now: the first not done. */
export const currentStep = (steps: WizardStep[]) => steps.find((s) => !s.done) ?? null;
