"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Paperclip, Pencil, Store, Wallet, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import {
  attachSupplierConfirmation,
  confirmSupplierBookings,
  declineSupplierRequest,
  getSupplierConfirmationUrl,
  getSupplierReceiptUrl,
  recordSupplierPayment,
  setBookingCost,
  type CaseBookingSupplier,
  type CaseSupplier,
  type CaseSupplierPayment,
  type SupplierWork,
} from "@/lib/data/supplier-work";
import { hoursSince, type Money } from "@/lib/operations/supplier-request";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";
import { OpsLinkButton } from "./OpsLinkButton";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[11.5px] font-bold text-[#185045]";
const chipBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";
const primary =
  "inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60";

type Fail = { ok: false; error: TranslationKey };

export const money = (m: Money) => `${m.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${m.currency}`;

/** Sum per currency — never across. */
export function totals(list: (Money | null)[]): Money[] {
  const by = new Map<string, number>();
  for (const m of list) if (m) by.set(m.currency, Math.round(((by.get(m.currency) ?? 0) + m.amount) * 100) / 100);
  return [...by.entries()].map(([currency, amount]) => ({ amount, currency }));
}

/** Open a signed link to a paper in the private bucket, in a new tab. */
export function useOpenPaper() {
  const { t } = useTraveliunUI();
  const [pending, start] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const open = (load: () => Promise<{ ok: true; url: string } | Fail>) =>
    start(async () => {
      setError(null);
      const res = await load();
      if (!res.ok) setError(t(res.error));
      else window.open(res.url, "_blank", "noopener");
    });
  return { open, pending, error };
}

/**
 * «الموردون» on a case: each supplier the bookings were handed to, where its
 * request stands (and how long it has been silent), its confirmation on file,
 * «تأكيد الكل» for one answer covering several bookings — and, for a viewer
 * with pricing.internal only, what each booking costs and what we paid.
 *
 * The request itself is prepared and sent from the booking row («ينفّذه» →
 * «تجهيز الطلب»): one composer for everyone, in the supplier's language.
 */
export function SupplierPanel({
  operationId,
  bookings,
  work,
}: {
  operationId: string;
  bookings: OperationBooking[];
  work: SupplierWork;
}) {
  const { t } = useTraveliunUI();
  const byId = new Map(work.bookings.map((b) => [b.booking_id, b]));
  const live = bookings.filter((b) => b.status !== "cancelled");
  const unassigned = live.filter((b) => !byId.get(b.id)?.supplier_id);

  return (
    <section id="suppliers" className={`${card} scroll-mt-24`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
          <Store className="size-4" />
          {t("ops.sup.title")}
        </h2>
        {work.canOpenAccounts ? (
          <Link href="/operations/suppliers" className={chipBtn}>
            <Wallet className="size-3.5" />
            {t("ops.sup.accounts")}
          </Link>
        ) : null}
      </div>
      <p className="mb-3 text-[11.5px] font-semibold text-tv-text-faint">{t("ops.sup.hint")}</p>

      <div className="space-y-3">
        {work.suppliers.map((s) => (
          <SupplierGroup
            key={s.id}
            operationId={operationId}
            supplier={s}
            bookings={live.filter((b) => byId.get(b.id)?.supplier_id === s.id)}
            info={byId}
            payments={work.payments.filter((p) => p.supplier_id === s.id)}
            work={work}
          />
        ))}
      </div>

      {work.canSeeCost && live.length > 0 ? (
        <div className="mt-4 border-t border-[#f0f4f2] pt-3">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-extrabold text-[#185045]">
            {t("ops.sup.caseCost")}
            {totals(live.map((b) => byId.get(b.id)?.cost ?? null)).map((m) => (
              <span key={m.currency} className="tv-tnum rounded-full bg-[#eef4f1] px-2.5 py-0.5 text-[11.5px] text-[#0f3d38]">
                <DirText dir="ltr">{money(m)}</DirText>
              </span>
            ))}
          </p>
          {unassigned.length > 0 ? (
            <>
              <p className="mb-1.5 text-[11.5px] font-bold text-tv-text-faint">{t("ops.sup.unassigned")}</p>
              <ul className="space-y-1.5">
                {unassigned.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] border border-[#eef3f1] px-3 py-2">
                    <span className="min-w-0 truncate text-[12.5px] font-bold text-[#0f3d38]">{b.title}</span>
                    <CostCell bookingId={b.id} cost={byId.get(b.id)?.cost ?? null} editable={work.canManageMoney} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SupplierGroup({
  operationId,
  supplier,
  bookings,
  info,
  payments,
  work,
}: {
  operationId: string;
  supplier: CaseSupplier;
  bookings: OperationBooking[];
  info: Map<string, CaseBookingSupplier>;
  payments: CaseSupplierPayment[];
  work: SupplierWork;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [paying, setPaying] = useState(false);

  const open = bookings.filter((b) => b.status !== "confirmed");
  const unpaid = bookings.filter((b) => b.status === "confirmed" && !b.is_paid);
  const paidHere = totals(payments.map((p) => ({ amount: p.kind === "refund" ? -p.amount : p.amount, currency: p.currency })));

  /** One answer, many bookings: the number on each, the paper filed once for all. */
  function confirmAll() {
    startTransition(async () => {
      setError(null);
      const res = await confirmSupplierBookings({ supplier_id: supplier.id, booking_ids: open.map((b) => b.id), confirmation_number: ref.trim() });
      if (!res.ok) return setError(t(res.error));
      if (file) {
        const fd = new FormData();
        fd.append("booking_ids", open.map((b) => b.id).join(","));
        fd.append("file", file);
        const up = await attachSupplierConfirmation(fd);
        if (!up.ok) return setError(t(up.error));
      }
      setRef("");
      setFile(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-extrabold text-[#0f3d38]">
            {work.canOpenAccounts ? (
              <Link href={`/operations/suppliers/${supplier.id}`} className="hover:underline">
                {supplier.name}
              </Link>
            ) : (
              supplier.name
            )}
            <span className="ms-2 rounded-full bg-[#eaf1ff] px-2 py-0.5 text-[10.5px] font-bold text-[#2b57c4]">
              {t(supplier.lang === "en" ? "ops.sup.lang.en" : "ops.sup.lang.ar")}
            </span>
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-bold text-[#557d78]">
            {supplier.contact_name ? <span>{supplier.contact_name}</span> : null}
            {supplier.phone ? <DirText dir="ltr">{supplier.phone}</DirText> : null}
            {supplier.email ? <DirText dir="ltr">{supplier.email}</DirText> : null}
          </p>
        </div>
        {work.canSeeCost ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
            {totals(bookings.map((b) => info.get(b.id)?.cost ?? null)).map((m) => (
              <span key={m.currency} className="tv-tnum rounded-full bg-white px-2.5 py-0.5 text-[#0f3d38]">
                {t("ops.sup.cost")} <DirText dir="ltr">{money(m)}</DirText>
              </span>
            ))}
            {paidHere.map((m) => (
              <span key={m.currency} className="tv-tnum rounded-full bg-[#e9f7f0] px-2.5 py-0.5 text-[#0f7a52]">
                {t("ops.sup.paidTotal")} <DirText dir="ltr">{money(m)}</DirText>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <ul className="mt-2 space-y-1.5">
        {bookings.map((b) => (
          <SupplierBookingRow key={b.id} booking={b} info={info.get(b.id)} work={work} />
        ))}
      </ul>

      {open.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className={label}>
            {t("ops.sup.confirmNo")}
            <input dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} className={`${field} tv-tnum text-start`} />
          </label>
          <label className={label}>
            {t("ops.sup.attach")}
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[11.5px] font-semibold text-[#557d78] file:me-2 file:rounded-[8px] file:border file:border-[#dbe6e1] file:bg-white file:px-2 file:py-1"
            />
          </label>
          <button type="button" disabled={pending || !ref.trim()} onClick={confirmAll} className={primary}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {open.length > 1 ? t("ops.sup.confirmAll", { n: open.length }) : t("ops.sup.confirmOne")}
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}

      {work.canSeeCost ? (
        <div className="mt-3 border-t border-[#e8efec] pt-2">
          {/* paying a supplier is the manager's step (supplier-work.ts) — without it, what was paid is shown */}
          {work.canManageMoney ? (
            <button type="button" onClick={() => setPaying((v) => !v)} className={chipBtn}>
              <Wallet className="size-3.5" />
              {t("ops.sup.pay")}
            </button>
          ) : null}
          {paying && work.canManageMoney ? (
            <SupplierPaymentForm
              supplierId={supplier.id}
              operationId={operationId}
              unpaid={unpaid.map((b) => ({ id: b.id, title: b.title, cost: info.get(b.id)?.cost ?? null }))}
              onDone={() => {
                setPaying(false);
                router.refresh();
              }}
            />
          ) : null}
          {payments.length > 0 ? <PaymentList payments={payments} /> : null}
        </div>
      ) : null}
    </div>
  );
}

const STATE_STYLE: Record<CaseBookingSupplier["state"], string> = {
  none: "bg-[#eef4f1] text-[#557d78]",
  sent: "bg-[#fff8e8] text-[#a86a10]",
  overdue: "bg-[#fdecef] text-[#c22850]",
  confirmed: "bg-[#e9f7f0] text-[#0f7a52]",
  declined: "bg-[#fdecef] text-[#c22850]",
};

function SupplierBookingRow({ booking, info, work }: { booking: OperationBooking; info: CaseBookingSupplier | undefined; work: SupplierWork }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const paper = useOpenPaper();
  const state = info?.state ?? "none";
  const hours = info?.sent_at ? hoursSince(info.sent_at, new Date(work.now)) : 0;

  function attach(file: File) {
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("booking_ids", booking.id);
      fd.append("file", file);
      const res = await attachSupplierConfirmation(fd);
      if (!res.ok) setError(t(res.error));
      else router.refresh();
    });
  }

  return (
    <li className="rounded-[9px] border border-[#e8efec] bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-extrabold text-[#0f3d38]">{booking.title}</p>
          <p className="tv-tnum mt-0.5 flex flex-wrap items-center gap-2 text-[11px] font-bold text-tv-text-faint">
            {booking.start_date ? <DirText dir="ltr">{booking.start_date}</DirText> : null}
            <span className={`rounded-full px-2 py-0.5 ${STATE_STYLE[state]}`}>{t(`ops.sup.state.${state}`, { h: hours })}</span>
            {booking.status === "confirmed" ? (
              <span className={booking.is_paid ? "text-[#0f7a52]" : "text-[#a86a10]"}>
                {t(booking.is_paid ? "ops.sup.paid" : "ops.sup.unpaid")}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {work.canSeeCost ? <CostCell bookingId={booking.id} cost={info?.cost ?? null} editable={work.canManageMoney} /> : null}
          {state === "sent" || state === "overdue" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await declineSupplierRequest(booking.id);
                  if (!res.ok) setError(t(res.error));
                  else router.refresh();
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f2c7c7] px-2.5 text-[11.5px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
            >
              <XCircle className="size-3.5" />
              {t("ops.sup.decline")}
            </button>
          ) : null}
          {booking.status !== "confirmed" ? <OpsLinkButton kind="supplier" bookingId={booking.id} /> : null}
          {info?.has_confirmation ? (
            <button type="button" disabled={paper.pending} onClick={() => paper.open(() => getSupplierConfirmationUrl(booking.id))} className={chipBtn}>
              <ExternalLink className="size-3.5" />
              {t("ops.sup.openConfirmation")}
            </button>
          ) : (
            <label className={`${chipBtn} cursor-pointer border-dashed`}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
              {t("ops.sup.attach")}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attach(f);
                }}
              />
            </label>
          )}
        </div>
      </div>
      {error || paper.error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error ?? paper.error}</p> : null}
    </li>
  );
}

/** A booking's cost, and what the supplier actually charged when it differs. pricing.internal only. */
function CostCell({ bookingId, cost, editable }: { bookingId: string; cost: Money | null; editable: boolean }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(cost ? String(cost.amount) : "");
  const [currency, setCurrency] = useState(cost?.currency ?? "SAR");
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);

  // what a booking costs us is the manager's to set (supplier-work.ts setBookingCost)
  if (!editable) {
    return <span className="tv-tnum text-[11.5px] font-bold text-[#557d78]">{cost ? <DirText dir="ltr">{money(cost)}</DirText> : t("ops.sup.costNone")}</span>;
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          // start from the figure on screen, not the one this cell first mounted with
          setAmount(cost ? String(cost.amount) : "");
          setCurrency(cost?.currency ?? "SAR");
          setEditing(true);
        }}
        title={t("ops.sup.costEdit")}
        className={`${chipBtn} tv-tnum`}
      >
        <Pencil className="size-3" />
        {cost ? <DirText dir="ltr">{money(cost)}</DirText> : t("ops.sup.costNone")}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input type="number" min={0} dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className="tv-tnum h-8 w-24 rounded-[8px] border border-[#dbe6e1] px-2 text-[12px]" />
      <input dir="ltr" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} className="h-8 w-14 rounded-[8px] border border-[#dbe6e1] px-2 text-[12px] uppercase" />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await setBookingCost({ booking_id: bookingId, amount: amount === "" ? null : Number(amount), currency });
            if (!res.ok) setError(t(res.error));
            else {
              setEditing(false);
              router.refresh();
            }
          })
        }
        className="inline-flex h-8 items-center rounded-[8px] bg-[#185045] px-2.5 text-[11.5px] font-bold text-white disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : t("save")}
      </button>
      {error ? <span className="text-[11px] font-bold text-[#c22850]">{error}</span> : null}
    </span>
  );
}

const METHODS = ["bank_transfer", "cash", "card", "other"] as const;

/**
 * «صدرت/سُددت» as money: amount, day (the Riyadh day by default), method,
 * reference and receipt. By default it settles the supplier's confirmed, unpaid
 * bookings on this case and offers their cost as the amount.
 */
export function SupplierPaymentForm({
  supplierId,
  operationId,
  unpaid,
  onDone,
}: {
  supplierId: string;
  operationId?: string;
  unpaid: { id: string; title: string; cost: Money | null }[];
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const due = totals(unpaid.map((b) => b.cost));
  const [form, setForm] = useState({
    kind: "payment",
    amount: due.length === 1 ? String(due[0].amount) : "",
    currency: due[0]?.currency ?? "SAR",
    paid_on: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
    method: "bank_transfer",
    reference: "",
    note: "",
    covers: unpaid.length > 0 ? "unpaid" : "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function save() {
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("supplier_id", supplierId);
      if (operationId) fd.append("operation_id", operationId);
      for (const k of ["kind", "amount", "currency", "paid_on", "method", "reference", "note"] as const) fd.append(k, form[k]);
      fd.append("booking_ids", form.covers === "unpaid" ? unpaid.map((b) => b.id).join(",") : form.covers);
      if (file) fd.append("file", file);
      const res = await recordSupplierPayment(fd);
      if (!res.ok) setError(t(res.error));
      else onDone();
    });
  }

  return (
    <div className="mt-2 grid gap-2 rounded-[10px] border border-[#e2ebe7] bg-white p-3 sm:grid-cols-3">
      <label className={label}>
        {t("ops.sup.pay.kind")}
        <select value={form.kind} onChange={set("kind")} className={field}>
          <option value="payment">{t("ops.sup.pay.kind.payment")}</option>
          <option value="refund">{t("ops.sup.pay.kind.refund")}</option>
        </select>
      </label>
      <label className={label}>
        {t("ops.sup.pay.amount")}
        <input type="number" min={0} dir="ltr" value={form.amount} onChange={set("amount")} className={`${field} tv-tnum text-center`} />
      </label>
      <label className={label}>
        {t("ops.sup.pay.currency")}
        <input dir="ltr" maxLength={3} value={form.currency} onChange={set("currency")} className={`${field} uppercase`} />
      </label>
      <label className={label}>
        {t("ops.sup.pay.date")}
        <input type="date" dir="ltr" value={form.paid_on} onChange={set("paid_on")} className={`${field} tv-tnum`} />
      </label>
      <label className={label}>
        {t("ops.sup.pay.method")}
        <select value={form.method} onChange={set("method")} className={field}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`ops.sup.pay.method.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("ops.sup.pay.reference")}
        <input dir="ltr" value={form.reference} onChange={set("reference")} className={field} />
      </label>
      <label className={label}>
        {t("ops.sup.pay.covers")}
        <select value={form.covers} onChange={set("covers")} className={field}>
          <option value="">{t("ops.sup.pay.coversNone")}</option>
          {unpaid.length > 0 ? <option value="unpaid">{t("ops.sup.pay.coversUnpaid")}</option> : null}
          {unpaid.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("ops.sup.pay.note")}
        <input value={form.note} onChange={set("note")} className={field} />
      </label>
      <label className={label}>
        {t("ops.sup.pay.receipt")}
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-[11.5px] font-semibold text-[#557d78] file:me-2 file:rounded-[8px] file:border file:border-[#dbe6e1] file:bg-white file:px-2 file:py-1"
        />
      </label>
      <div className="sm:col-span-3">
        <button type="button" disabled={pending || !(Number(form.amount) > 0)} onClick={save} className={primary}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
          {t("ops.sup.pay.save")}
        </button>
        {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      </div>
    </div>
  );
}

export function PaymentList({ payments }: { payments: CaseSupplierPayment[] }) {
  const { t } = useTraveliunUI();
  const paper = useOpenPaper();
  return (
    <>
      <ul className="mt-2 space-y-1">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] font-bold">
            <span className="text-[#557d78]">
              {t(`ops.sup.pay.kind.${p.kind}`)} · {t(`ops.sup.pay.method.${p.method as (typeof METHODS)[number]}`)}
              <span className="tv-tnum ms-2 font-semibold text-tv-text-faint">
                <DirText dir="ltr">{`${p.paid_on}${p.reference ? ` · ${p.reference}` : ""}`}</DirText>
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`tv-tnum ${p.kind === "refund" ? "text-[#c22850]" : "text-[#0f3d38]"}`}>
                <DirText dir="ltr">{`${p.kind === "refund" ? "-" : ""}${money(p)}`}</DirText>
              </span>
              {p.has_receipt ? (
                <button type="button" disabled={paper.pending} onClick={() => paper.open(() => getSupplierReceiptUrl(p.id))} className={chipBtn}>
                  <ExternalLink className="size-3" />
                  {t("ops.sup.pay.receipt")}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {paper.error ? <p className="mt-1 text-[11.5px] font-bold text-[#c22850]">{paper.error}</p> : null}
    </>
  );
}
