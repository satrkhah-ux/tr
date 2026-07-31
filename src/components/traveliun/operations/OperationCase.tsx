"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Lock,
  Plus,
  ShieldAlert,
  Upload,
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
import {
  getPassportScanUrl,
  getTravelerPassport,
  upsertTraveler,
  uploadPassportScan,
} from "@/lib/data/operation-travelers";
import { CLIENT_STATES, EXECUTION_STATES, canAdvanceClient, canAdvanceExecution } from "@/lib/operations/state";
import type { PassportRead, TravelerListItem } from "@/lib/operations/traveler-dto";
import type { TranslationKey } from "@/lib/i18n";
import type { OperationBooking, OperationDocument } from "@/lib/data/operation-bookings";
import type { AssigneeOption, SentRequest } from "@/lib/data/operation-assign";
import { DocumentsPanel } from "./DocumentsPanel";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";

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
          <TravelersPanel operationId={operation.id} travelers={travelers} />
          <PaymentsPanel
            operationId={operation.id}
            payments={payments}
            paid={paid}
            total={operation.total}
            currency={operation.currency ?? "SAR"}
          />
        </div>
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
  const [pending, startTransition] = useTransition();
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

function TravelersPanel({ operationId, travelers }: { operationId: string; travelers: TravelerListItem[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <section className={card}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-[#185045]">{t("ops.travelers")}</h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
        >
          <Plus className="size-3.5" />
          {t("ops.traveler.add")}
        </button>
      </div>
      <p className="mb-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#93aaa3]">
        <Lock className="size-3.5" />
        {t("ops.passport.audited")}
      </p>

      {adding ? (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-[11px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
          <label className={`${label} flex-1`}>
            {t("ops.traveler.name")}
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await upsertTraveler({ operation_id: operationId, display_name: name.trim() });
                if (res.ok) {
                  setName("");
                  setAdding(false);
                  router.refresh();
                }
              })
            }
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("add")}
          </button>
        </div>
      ) : null}

      {travelers.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("ops.traveler.add")}
        </p>
      ) : (
        <ul className="space-y-2">
          {travelers.map((tr) => (
            <TravelerRow key={tr.id} traveler={tr} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TravelerRow({ traveler }: { traveler: TravelerListItem }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [passport, setPassport] = useState<PassportRead | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ full_name: "", number: "", nationality: "", expiry: traveler.passport_expiry ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function savePassport() {
    startTransition(async () => {
      setError(null);
      const res = await upsertTraveler({
        id: traveler.id,
        operation_id: "",
        display_name: traveler.display_name,
        passport: {
          full_name: form.full_name.trim(),
          number: form.number.trim(),
          nationality: form.nationality.trim(),
        },
        passport_expiry: form.expiry || null,
      });
      if (!res.ok) setError(t(res.error));
      else {
        setEditing(false);
        setPassport(null);
        router.refresh();
      }
    });
  }

  function reveal() {
    startTransition(async () => {
      setError(null);
      const res = await getTravelerPassport(traveler.id);
      if ("ok" in res && res.ok === false) setError(t(res.error));
      else setPassport(res as PassportRead);
    });
  }

  function openScan() {
    startTransition(async () => {
      setError(null);
      const res = await getPassportScanUrl(traveler.id);
      if (!res.ok) setError(t(res.error));
      else window.open(res.url, "_blank", "noopener");
    });
  }

  function upload(file: File) {
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadPassportScan(traveler.id, fd);
      if (!res.ok) setError(t(res.error));
      else router.refresh();
    });
  }

  return (
    <li className="rounded-[11px] border border-[#e2ebe7] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-extrabold text-[#0f3d38]">{traveler.display_name || "—"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#93aaa3]">
            <span>{t(`ops.traveler.${traveler.traveler_kind}` as TranslationKey)}</span>
            {traveler.passport_expiry ? (
              <span className="tv-tnum">
                {t("ops.passport.expiry")} <DirText dir="ltr">{traveler.passport_expiry}</DirText>
              </span>
            ) : null}
            {traveler.has_passport ? <span className="text-[#0f7a52]">{t("ops.passport.onFile")}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4] disabled:opacity-60"
          >
            <Plus className="size-3.5" />
            {t("ops.passport")}
          </button>
          {traveler.has_passport ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => (passport ? setPassport(null) : reveal())}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
            >
              {passport ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {passport ? t("ops.passport.hide") : t("ops.passport.reveal")}
            </button>
          ) : null}
          {traveler.has_scan ? (
            <button
              type="button"
              disabled={pending}
              onClick={openScan}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
            >
              <ExternalLink className="size-3.5" />
              {t("ops.passport.openScan")}
            </button>
          ) : (
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]">
              <Upload className="size-3.5" />
              {t("ops.passport.upload")}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
              />
            </label>
          )}
        </div>
      </div>

      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}

      {editing ? (
        <div className="mt-2 grid gap-2 rounded-[9px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 sm:grid-cols-2">
          <label className={label}>
            {t("ops.passport.fullName")}
            <input
              dir="ltr"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className={`${field} text-start`}
              placeholder="IBTIHAL BUKHARI"
            />
          </label>
          <label className={label}>
            {t("ops.passport.number")}
            <input
              dir="ltr"
              value={form.number}
              onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
              className={`${field} tv-tnum text-start`}
            />
          </label>
          <label className={label}>
            {t("ops.passport.nationality")}
            <input
              value={form.nationality}
              onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}
              className={field}
            />
          </label>
          <label className={label}>
            {t("ops.passport.expiry")}
            <input
              type="date"
              dir="ltr"
              value={form.expiry}
              onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))}
              className={`${field} tv-tnum`}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={pending || !form.number.trim()}
              onClick={savePassport}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {t("save")}
            </button>
          </div>
        </div>
      ) : null}

      {passport ? (
        passport.state === "ok" ? (
          <div className="mt-2 grid gap-1 rounded-[9px] bg-[#f4f8f6] px-3 py-2 text-[12px] font-bold text-[#0f3d38] sm:grid-cols-3">
            <span>{passport.passport.full_name}</span>
            <span className="tv-tnum">
              <DirText dir="ltr">{passport.passport.number}</DirText>
            </span>
            <span>{passport.passport.nationality}</span>
          </div>
        ) : passport.state === "unavailable" ? (
          // NOT "no passport on file" — a config error and a missing record are
          // different facts, and conflating them hides a real incident.
          <p className="mt-2 flex items-start gap-1.5 rounded-[9px] bg-[#fff8e8] px-3 py-2 text-[11.5px] font-bold text-[#a86a10]">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            {t("ops.passport.unavailable")}
          </p>
        ) : (
          <p className="mt-2 text-[11.5px] font-bold text-[#93aaa3]">{t("ops.passport.none")}</p>
        )
      ) : null}
    </li>
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
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<PaymentKind>("deposit");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
