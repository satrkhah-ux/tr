/**
 * «معالج الحجوزات» (owner's order, 2026-10-17): a confirmed case worked in six
 * steps, each its own screen, in any order, each saved on its own; upload the
 * file first, type only what no file holds. The old one-page case stays as
 * «عرض الكل».
 *
 * The shared shape every step reads. Each step owns two things: a pure state
 * function in src/lib/operations/wizard/<step>.ts (what the progress bar and the
 * readiness gate show) and its screen in
 * src/components/traveliun/operations/wizard/<Step>Step.tsx.
 */
import type { OperationBooking, OperationDocument } from "@/lib/data/operation-bookings";
import type { OperationCard, OperationPayment } from "@/lib/data/operations";
import type { InstallmentRow } from "@/lib/data/operation-payments";
import type { TravelerListItem } from "@/lib/operations/traveler-dto";
import type { SupplierWork } from "@/lib/data/supplier-work";

export const WIZARD_STEPS = ["passports", "flights", "hotels", "transport", "payment", "documents"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** done · todo (something to do) · waiting («ينتظر» set) · na (the file has none of it, e.g. no flights) */
export type StepState = "done" | "todo" | "waiting" | "na";

/** «ينتظر»: who the step waits on, and until when (operations.waits, 0084). */
export const WAIT_FROM = ["airline", "supplier", "agent", "client"] as const;
export type WaitFrom = (typeof WAIT_FROM)[number];
export type StepWait = { from: WaitFrom; until: string; note?: string | null; at: string; by?: string | null };
export type CaseWaits = Partial<Record<WizardStep, StepWait>>;

/** A manager's exception to a readiness rule (operations.ready_exceptions, 0084). */
export type ReadyExceptions = { payment?: { by: string | null; at: string; note?: string | null } };

/** What the offer was SOLD for — the passports are counted against it. */
export type SoldTravelers = { adults: number; children: number; infants: number };

/** The destination's emergency guide (/settings, destination_guides) — client-safe fields only. */
export type CaseGuide = {
  country: string;
  local_agent_name: string | null;
  local_agent_phone: string | null;
  embassy_phone: string | null;
  ambulance: string | null;
  police: string | null;
  hospital: string | null;
  notes: string | null;
};

/** Everything a step screen and its state function may read — loaded once by the case page. */
export type WizardCase = {
  operation: OperationCard;
  travelers: TravelerListItem[];
  bookings: OperationBooking[];
  payments: OperationPayment[];
  installments: InstallmentRow[];
  documents: OperationDocument[];
  supplierWork: SupplierWork | null;
  clientToken: string | null;
  waits: CaseWaits;
  readyExceptions: ReadyExceptions;
  hasDays: boolean;
  /** the office's day (Riyadh, YYYY-MM-DD) the case was loaded on — every date rule reads this, never a clock. */
  today: string;
  /** offers.adults / children / infants; null when the offer row could not be read. */
  sold: SoldTravelers | null;
  /** the destination's guide, or null when none is kept for its country. */
  guide: CaseGuide | null;
};

/** What every step screen receives. `canManage`: the manager steps on THIS case (gateCaseManager). */
export type StepProps = {
  data: WizardCase;
  canManage: boolean;
  canReadMrz: boolean;
};

/**
 * One readiness rule's answer before «جاهز للسفر» — `ok` false blocks it unless `optional`.
 * The gate labels it with the i18n key `wz.ready.<step>.<key>` when one exists.
 */
export type ReadinessItem = { step: WizardStep; key: string; ok: boolean; optional?: boolean };
