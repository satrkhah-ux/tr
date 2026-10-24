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

/** What the offer itself books, by step (offer-pull.ts offerBookingKinds). */
export type OfferKinds = { flight: boolean; hotel: boolean; transport: boolean };

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
  /**
   * What the offer books. A step with no booking of its kind is «لا ينطبق» only
   * when the offer has none either; otherwise the pull has not brought it yet.
   * null (or absent) when it could not be read — the bookings alone decide.
   */
  offerKinds?: OfferKinds | null;
  /** a photo or a scanned PDF can be read here (an OCR service or the vision model); pasted text always can. */
  readsImages?: boolean;
  /** the offer's hotels as the catalogue knows them — what «أكمل بيانات الفندق» checks */
  offerHotels?: { hotel_id: string | null; hotel_name: string }[];
  /** the hotel bookings whose hotel was picked from TBO (hotel_content_cache.internal_hotel_id) — booked there */
  tboBookings?: string[];
  /** operations.book: may commit a booking at the supplier */
  canBook?: boolean;
};

/** What every step screen receives. `canManage`: the manager steps on THIS case (gateCaseManager). */
export type StepProps = {
  data: WizardCase;
  canManage: boolean;
  canReadMrz: boolean;
};

/**
 * What the readiness rules read. The case page passes its whole WizardCase; the
 * morning alerts, with no session, load just this (wizard-case.ts travelBlockers)
 * — so a rule reading anything else is a type error, not a silent «missing».
 */
export type ReadinessCase = Pick<
  WizardCase,
  "travelers" | "bookings" | "documents" | "supplierWork" | "clientToken" | "readyExceptions" | "hasDays" | "today" | "sold" | "guide"
> & {
  operation: Pick<OperationCard, "total" | "travel_start" | "travel_end">;
  payments: Pick<OperationPayment, "amount" | "kind">[];
};

/**
 * Every key each step's readiness may return — ONE convention: a short key,
 * labelled by the i18n key `wz.ready.<step>.<key>` (index.ts readyLabel). A key
 * not listed here does not typecheck, and readiness-keys.test.ts checks each
 * one has its Arabic and English words.
 */
export const READINESS_KEYS = {
  passports: ["passports", "visas", "count"],
  flights: ["pulled", "tickets"],
  hotels: ["pulled", "final", "overlap"],
  transport: ["pulled", "supplier", "confirmed", "driver", "tour_times"],
  payment: ["settled"],
  documents: ["documents", "link", "arrival_sign", "guide"],
} as const satisfies Record<WizardStep, readonly string[]>;

/**
 * One readiness rule's answer before «جاهز للسفر» — `ok` false blocks it unless `optional`.
 * `warning`: something to look at, listed only while it holds (two hotels on the
 * same night, a tour against its flight) — never blocks, and says what it is
 * instead of «(اختياري)».
 */
export type ReadinessItem = {
  [S in WizardStep]: { step: S; key: (typeof READINESS_KEYS)[S][number]; ok: boolean; optional?: boolean; warning?: boolean };
}[WizardStep];
