"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  recordPayment,
  setClientStatus,
  setExecutionStatus,
  type OperationCard,
  type OperationPayment,
  type PaymentKind,
} from "@/lib/data/operations";
import { CLIENT_STATES, EXECUTION_STATES, canAdvanceClient, canAdvanceExecution } from "@/lib/operations/state";
import type { TravelerListItem } from "@/lib/operations/traveler-dto";
import type { TranslationKey } from "@/lib/i18n";
import type { OperationBooking, OperationDocument } from "@/lib/data/operation-bookings";
import type { AssigneeOption, SentRequest } from "@/lib/data/operation-assign";
import { DocumentsPanel } from "./DocumentsPanel";
import { TravelersPanel } from "./TravelersPanel";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition, useSessionField } from "../useSafeTransition";
import { ReadinessPanel } from "./ReadinessPanel";
import { CasePresence } from "./CasePresence";
import { IssuesPanel } from "./IssuesPanel";

const CLIENT_KEY = (s: string) => `ops.client.${s}` as TranslationKey;
const EXEC_KEY = (s: string) => `ops.exec.${s}` as TranslationKey;

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
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
  canReadMrz,
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
  /** the OpenAI key is set: passports can be read from their photo. */
  canReadMrz: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const paid = payments.reduce((s, p) => s + (p.kind === "refund" ? -p.amount : p.amount), 0);

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
              <p className="tv-tnum mt-1 text-[12.5px] font-bold text-[#93aaa3]">
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
              <p className="text-[11.5px] font-bold text-[#93aaa3]">{t("ops.travelWindow")}</p>
              <p className="tv-tnum text-[13px] font-extrabold text-[#0f3d38]">
                <DirText dir="ltr">{`${operation.travel_start ?? "—"} → ${operation.travel_end ?? "—"}`}</DirText>
              </p>
            </div>
          </div>

          {/* the two tracks, advanced independently */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <TrackControl
              title={t("ops.clientTrack")}
              current={operation.client_status}
              states={[...CLIENT_STATES, "cancelled"]}
              labelFor={(s) => t(CLIENT_KEY(s))}
              canAdvance={(to) => canAdvanceClient(operation.client_status, to as never)}
              onPick={async (to) => setClientStatus(operation.id, to as never)}
              onDone={() => router.refresh()}
            />
            <TrackControl
              title={t("ops.executionTrack")}
              current={operation.execution_status}
              states={[...EXECUTION_STATES, "cancelled"]}
              labelFor={(s) => t(EXEC_KEY(s))}
              canAdvance={(to) => canAdvanceExecution(operation.execution_status, to as never)}
              onPick={async (to) => setExecutionStatus(operation.id, to as never)}
              onDone={() => router.refresh()}
            />
          </div>
        </section>

        <CasePresence operationId={operation.id} />
        <ReadinessPanel operationId={operation.id} execution={operation.execution_status} />

        <DocumentsPanel
          operationId={operation.id}
          bookings={bookings}
          documents={documents}
          hasDays={hasDays}
          clientToken={clientToken}
          assignees={assignees}
          sentRequests={sentRequests}
          canBook={canBook}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <TravelersPanel operationId={operation.id} trip={operation} travelers={travelers} canReadMrz={canReadMrz} />
          <PaymentsPanel
            operationId={operation.id}
            payments={payments}
            paid={paid}
            total={operation.total}
            currency={operation.currency ?? "SAR"}
          />
        </div>

        <IssuesPanel operationId={operation.id} />
      </div>
    </TraveliunShell>
  );
}

/** Only legal next states are offered — an illegal move is not a click away. */
function TrackControl({
  title,
  current,
  states,
  labelFor,
  canAdvance,
  onPick,
  onDone,
}: {
  title: string;
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
      <p className="text-[11.5px] font-bold text-[#93aaa3]">{title}</p>
      <p className="mt-1 text-[15px] font-extrabold text-[#0f3d38]">{labelFor(current)}</p>
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

const PAYMENT_KINDS: PaymentKind[] = ["deposit", "installment", "final", "refund"];

function PaymentsPanel({
  operationId,
  payments,
  paid,
  total,
  currency,
}: {
  operationId: string;
  payments: OperationPayment[];
  paid: number;
  total: number | null;
  currency: string;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  // kept in this tab until recorded — a reload after a deploy used to lose it
  const [amount, setAmount] = useSessionField(`pay:${operationId}`, "");
  const [kind, setKind] = useState<PaymentKind>("deposit");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();

  return (
    <section className={card}>
      <h2 className="text-sm font-extrabold text-[#185045]">{t("ops.payments")}</h2>

      <div
        className={`mt-3 rounded-[11px] px-4 py-3 ${
          total != null && paid >= total ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fff8e8] text-[#a86a10]"
        }`}
      >
        <p className="text-[11.5px] font-bold opacity-70">{t("ops.payments")}</p>
        <p className="tv-tnum mt-0.5 text-[17px] font-extrabold">
          <DirText dir="ltr">{`${paid} / ${total ?? "—"} ${currency}`}</DirText>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className={`${label} flex-1`}>
          {t("ops.payment.amount")}
          <input
            type="number"
            min={0}
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${field} tv-tnum text-center`}
          />
        </label>
        <label className={`${label} flex-1`}>
          {t("ops.payment.kind")}
          <select value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)} className={field}>
            {PAYMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`ops.payment.${k}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || !(Number(amount) > 0)}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await recordPayment({ operation_id: operationId, amount: Number(amount), kind, currency });
              if (!res.ok) setError(t(res.error));
              else {
                setAmount("");
                router.refresh();
              }
            })
          }
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
          {t("ops.payment.add")}
        </button>
      </div>
      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}

      {payments.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-[#f0f4f2] pt-3">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-[12px] font-bold">
              <span className="text-[#557d78]">
                {t(`ops.payment.${p.kind}` as TranslationKey)}
                <span className="ms-2 font-semibold text-[#93aaa3]">
                  <DirText dir="ltr">{p.paid_at}</DirText>
                </span>
              </span>
              <span className={`tv-tnum ${p.kind === "refund" ? "text-[#c22850]" : "text-[#0f3d38]"}`}>
                <DirText dir="ltr">{`${p.kind === "refund" ? "-" : ""}${p.amount} ${p.currency}`}</DirText>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
