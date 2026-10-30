"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ExternalLink,
  ListChecks,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  setClientStatus,
  setExecutionStatus,
  type OperationCard,
  type OperationPayment,
} from "@/lib/data/operations";
import { CLIENT_STATES, canAdvanceClient, canAdvanceExecution } from "@/lib/operations/state";
import type { TravelerListItem } from "@/lib/operations/traveler-dto";
import type { TranslationKey } from "@/lib/i18n";
import type { OperationBooking, OperationDocument } from "@/lib/data/operation-bookings";
import type { AssigneeOption, SentRequest } from "@/lib/data/operation-assign";
import { DocumentsPanel } from "./DocumentsPanel";
import { TravelersPanel } from "./TravelersPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import type { InstallmentRow } from "@/lib/data/operation-payments";
import { SupplierPanel } from "./SupplierPanel";
import type { SupplierWork } from "@/lib/data/supplier-work";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";
import { CasePresence } from "./CasePresence";
import { UnbackedStatus } from "./wizard/PaymentStep";
import { clientStatusUnbacked, shownClientStatus } from "@/lib/operations/wizard/payment";
import { IssuesPanel } from "./IssuesPanel";
import { ClientSend } from "./ClientSend";

const CLIENT_KEY = (s: string) => `ops.client.${s}` as TranslationKey;
const EXEC_KEY = (s: string) => `ops.exec.${s}` as TranslationKey;

const card = "tv-card rounded-2xl border p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "tv-field h-11 w-full rounded-[10px] border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

export function OperationCase({
  operation,
  travelers,
  payments,
  bookings,
  documents,
  hasDays,
  clientToken,
  assignees,
  sentRequests,
  canBook,
  canManage,
  canReadMrz,
  installments,
  drivers,
  management,
  supplierWork,
  money,
  ready,
}: {
  operation: OperationCard;
  travelers: TravelerListItem[];
  payments: OperationPayment[];
  bookings: OperationBooking[];
  documents: OperationDocument[];
  hasDays: boolean;
  clientToken: string | null;
  assignees: AssigneeOption[];
  sentRequests: SentRequest[];
  /** may commit a reservation at the supplier — `operations.book`. */
  canBook: boolean;
  /**
   * The manager's steps on THIS case (cancel it, refunds, correct/erase
   * payments, the schedule, supplier money): operations.write, or
   * operations.manage_own on one's own file (access.ts gateCaseManager). Without
   * it an own-files holder works their file without them; the server refuses
   * them either way.
   */
  canManage: boolean;
  /** the OpenAI key is set: passports can be read from their photo. */
  canReadMrz: boolean;
  installments: InstallmentRow[];
  /** orders 9/10, built by the page: the driver cards, and owner/notes/activity. */
  drivers?: ReactNode;
  management?: ReactNode;
  /** the supplier side of the bookings (order 8); null when it could not load. */
  supplierWork?: SupplierWork | null;
  /** order 11: «ربحية الحالة», built by the page for pricing.internal only. */
  money?: ReactNode;
  /** «جاهز للسفر» — the wizard's six tiles and its gate (wizard/CaseWizardShell ReadyGate), built by the page. */
  ready?: ReactNode;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();

  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/operations"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
          >
            <ArrowRight className="size-4 ltr:rotate-180" />
            {t("ops.backToBoard")}
          </Link>
          <Link
            href={`/operations/${operation.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#185045] bg-white px-3 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            <ListChecks className="size-4" />
            {t("wz.open")}
          </Link>
          <Link
            href={`/client-offer/${operation.serial}`}
            target="_blank"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            <ExternalLink className="size-4" />
            {t("ops.summary")}
          </Link>
        </div>

        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold text-[#003c3a]">{operation.customer_name || "—"}</h1>
              <p className="tv-tnum mt-1 text-[12.5px] font-bold text-tv-text-faint">
                <DirText dir="ltr">{operation.serial}</DirText>
                {operation.destination ? <span className="ms-2 font-semibold">{operation.destination}</span> : null}
                {operation.customer_phone ? (
                  <span className="ms-2">
                    <DirText dir="ltr">{operation.customer_phone}</DirText>
                  </span>
                ) : null}
                {operation.partner_name ? (
              <span className="ms-2 rounded-full bg-[#f0e9f9] px-2 py-0.5 text-[10.5px] font-bold text-[#6a3fa0]">
                {t("ops.partnerTag", { name: operation.partner_name })}
              </span>
            ) : null}
              </p>
            </div>
            <div className="text-end">
              <p className="text-[11.5px] font-bold text-tv-text-faint">{t("ops.travelWindow")}</p>
              <p className="tv-tnum text-[13px] font-extrabold text-[#0f3d38]">
                <DirText dir="ltr">{`${operation.travel_start ?? "—"} → ${operation.travel_end ?? "—"}`}</DirText>
              </p>
            </div>
          </div>

          {/* a partner's client hears from the partner, never from us */}
          {operation.partner_name ? null : (
            <div className="mt-3">
              <ClientSend operationId={operation.id} />
            </div>
          )}

          {/* «مسدّد» picked by hand while the recorded payments say otherwise — said, not blocked */}
          {clientStatusUnbacked(operation.client_status, operation.total, operation.paid) ? (
            <div className="mt-3">
              <UnbackedStatus status={operation.client_status} />
            </div>
          ) : null}

          {/* the two tracks, apart — the paid rungs and the whole execution ladder are DERIVED */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <TrackControl
              title={t("ops.clientTrack")}
              current={shownClientStatus(operation.client_status, operation.total, operation.paid)}
              // «مسدّد جزئياً / مسدّد» come from the recorded payments (operation-sync), never a click
              states={(canManage ? [...CLIENT_STATES, "cancelled"] : CLIENT_STATES).filter((s) => s !== "paid_partial" && s !== "paid_full")}
              labelFor={(s) => t(CLIENT_KEY(s))}
              canAdvance={(to) => canAdvanceClient(operation.client_status, to as never)}
              onPick={async (to) => setClientStatus(operation.id, to as never)}
              onDone={() => router.refresh()}
            />
            <TrackControl
              title={t("ops.executionTrack")}
              hint={t("ops.execTrackDerived")}
              current={operation.execution_status}
              // each rung follows the steps (operation-sync), «جاهز للسفر» its gate below, «سافر» the
              // calendar (daily.ts) — what is left by hand is the manager's cancel
              states={canManage ? ["cancelled"] : []}
              labelFor={(s) => t(EXEC_KEY(s))}
              canAdvance={(to) => canAdvanceExecution(operation.execution_status, to as never)}
              onPick={async (to) => setExecutionStatus(operation.id, to as never)}
              onDone={() => router.refresh()}
            />
          </div>
        </section>

        <CasePresence operationId={operation.id} />
        {ready ? <section className={card}>{ready}</section> : null}

        <DocumentsPanel
          operationId={operation.id}
          bookings={bookings}
          documents={documents}
          hasDays={hasDays}
          clientToken={clientToken}
          assignees={assignees}
          partnerId={operation.partner_id}
          sentRequests={sentRequests}
          canBook={canBook}
          canManage={canManage}
        />

        {drivers}
        {supplierWork ? <SupplierPanel operationId={operation.id} bookings={bookings} work={supplierWork} /> : null}
        {money}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <TravelersPanel operationId={operation.id} trip={operation} travelers={travelers} canReadMrz={canReadMrz} />
          <PaymentsPanel operation={operation} payments={payments} installments={installments} canManage={canManage} />
        </div>

        <IssuesPanel operationId={operation.id} />
        {management}
      </div>
    </TraveliunShell>
  );
}

/**
 * Another employee's file opened by its URL (an own-files holder): said
 * plainly, with the way back to their board — not a 404, not a crash.
 */
export function OperationRefused({ reason }: { reason: TranslationKey }) {
  const { t } = useTraveliunUI();
  return (
    <TraveliunShell title="nav.operations">
      <section className={`${card} tv-fade-up`}>
        <p className="text-[14px] font-extrabold text-[#c22850]">{t(reason)}</p>
        <Link
          href="/operations"
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
        >
          <ArrowRight className="size-4 ltr:rotate-180" />
          {t("ops.backToBoard")}
        </Link>
      </section>
    </TraveliunShell>
  );
}

/** Only legal next states are offered — an illegal move is not a click away. */
function TrackControl({
  title,
  hint,
  current,
  states,
  labelFor,
  canAdvance,
  onPick,
  onDone,
}: {
  title: string;
  /** said under the state — why there is nothing (or little) to pick. */
  hint?: string;
  current: string;
  states: readonly string[];
  labelFor: (s: string) => string;
  canAdvance: (to: string) => boolean;
  onPick: (to: string) => Promise<{ ok: true } | { ok: false; error: TranslationKey }>;
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const next = states.filter(canAdvance);

  return (
    <div className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      <p className="text-[11.5px] font-bold text-tv-text-faint">{title}</p>
      <p className="mt-1 text-[15px] font-extrabold text-[#0f3d38]">{labelFor(current)}</p>
      {hint ? <p className="mt-0.5 text-[11px] font-semibold text-tv-text-faint">{hint}</p> : null}
      {error ? <p className="mt-1 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      {next.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {next.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await onPick(s);
                  if (!res.ok) setError(t(res.error));
                  else onDone();
                })
              }
              className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors disabled:opacity-60 ${
                s === "cancelled"
                  ? "border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1]"
                  : "border-[#b7d0c7] text-[#185045] hover:bg-[#f0f7f4]"
              }`}
            >
              {labelFor(s)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
