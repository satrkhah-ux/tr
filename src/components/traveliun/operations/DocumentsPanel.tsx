"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, Plus, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  addBooking,
  confirmBookingManually,
  issueDocument,
  revokeDocument,
  type BookingKind,
  type OperationBooking,
  type OperationDocument,
} from "@/lib/data/operation-bookings";
import type { VoucherKind } from "@/lib/operations/voucher-dto";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

const BOOKING_KINDS: BookingKind[] = ["hotel", "flight", "transport", "visa", "service"];
const DOC_KINDS: VoucherKind[] = ["hotel_voucher", "flight_ticket", "itinerary", "booking_summary"];

/**
 * Bookings and the documents issued from them.
 *
 * The panel answers the two questions an ops agent actually has open at once:
 * what is still unconfirmed, and what has already been handed to the traveller.
 * A voucher button stays disabled until something is confirmed to put on it —
 * handing someone a document for a room nobody booked is worse than handing
 * them nothing, because they stop chasing it and find out at the desk.
 */
export function DocumentsPanel({
  operationId,
  bookings,
  documents,
  hasDays,
}: {
  operationId: string;
  bookings: OperationBooking[];
  documents: OperationDocument[];
  hasDays: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const outstanding = bookings.filter((b) => b.status !== "confirmed" && b.status !== "cancelled");

  const live = documents.filter((d) => !d.revoked_at);
  const issuedKinds = new Set(live.map((d) => d.kind));

  /** Can a document of this kind be issued right now, and why not. */
  function availability(kind: VoucherKind): { can: boolean; reason: TranslationKey | null } {
    if (kind === "itinerary") return hasDays ? { can: true, reason: null } : { can: false, reason: "ops.err.nothingToIssue" };
    const pool =
      kind === "hotel_voucher"
        ? confirmed.filter((b) => b.kind === "hotel")
        : kind === "flight_ticket"
          ? confirmed.filter((b) => b.kind === "flight")
          : confirmed;
    return pool.length > 0 ? { can: true, reason: null } : { can: false, reason: "ops.err.nothingToIssue" };
  }

  function issue(kind: VoucherKind) {
    startTransition(async () => {
      setError(null);
      const res = await issueDocument({ operation_id: operationId, kind });
      if (!res.ok) setError(t(res.error));
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- bookings ---- */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-[#185045]">{t("ops.bookings")}</h2>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            <Plus className="size-3.5" />
            {t("ops.booking.add")}
          </button>
        </div>

        {/* the two counts an ops agent is actually tracking */}
        <div className="mb-3 flex flex-wrap gap-2 text-[11.5px] font-bold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7f0] px-3 py-1 text-[#0f7a52]">
            <CheckCircle2 className="size-3.5" />
            {t("ops.booking.status.confirmed")} <DirText dir="ltr">{String(confirmed.length)}</DirText>
          </span>
          {outstanding.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff8e8] px-3 py-1 text-[#a86a10]">
              {t("ops.booking.status.pending")} <DirText dir="ltr">{String(outstanding.length)}</DirText>
            </span>
          ) : null}
        </div>

        {adding ? <AddBooking operationId={operationId} onDone={() => { setAdding(false); router.refresh(); }} /> : null}

        {bookings.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">
            {t("ops.booking.noApiHint")}
          </p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b) => (
              <BookingRow key={b.id} booking={b} onDone={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>

      {/* ---- documents ---- */}
      <section className={card}>
        <h2 className="mb-3 text-sm font-extrabold text-[#185045]">{t("ops.documents")}</h2>
        {error ? <p className="mb-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}

        <div className="mb-3 flex flex-wrap gap-2">
          {DOC_KINDS.map((kind) => {
            const av = availability(kind);
            const already = issuedKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                disabled={pending || !av.can}
                title={av.reason ? t(av.reason) : undefined}
                onClick={() => issue(kind)}
                className={`inline-flex h-10 items-center gap-1.5 rounded-[10px] border px-3.5 text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  already
                    ? "border-[#bfe5d4] bg-[#e9f7f0] text-[#0f7a52]"
                    : "border-[#b7d0c7] bg-white text-[#185045] hover:bg-[#f0f7f4]"
                }`}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                {t(`ops.doc.${kind}` as TranslationKey)}
                {already ? <CheckCircle2 className="size-3.5" /> : null}
              </button>
            );
          })}
        </div>

        {live.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">
            {t("ops.doc.issue")}
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-[11px] border px-4 py-2.5 ${
                  d.revoked_at ? "border-[#f0c7c7] bg-[#fdf6f7]" : "border-[#e2ebe7]"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-extrabold text-[#0f3d38]">
                    {t(`ops.doc.${d.kind}` as TranslationKey)}
                    <span className="tv-tnum ms-2 text-[11px] font-bold text-[#93aaa3]">
                      <DirText dir="ltr">{`v${d.version}`}</DirText>
                    </span>
                    {d.revoked_at ? <span className="ms-2 text-[11px] font-bold text-[#c22850]">{t("ops.doc.revoked")}</span> : null}
                  </p>
                  <p className="tv-tnum mt-0.5 text-[11px] font-semibold text-[#93aaa3]">
                    <DirText dir="ltr">{d.created_at.slice(0, 10)}</DirText>
                  </p>
                </div>
                {!d.revoked_at ? (
                  <div className="flex items-center gap-1.5">
                    <a
                      href={`/voucher/${d.token}/pdf`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#185045] px-3 text-[11.5px] font-bold text-white hover:bg-[#0f4439]"
                    >
                      <ExternalLink className="size-3.5" />
                      {t("ops.doc.open")}
                    </a>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await revokeDocument(d.id);
                          router.refresh();
                        })
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f2c7c7] px-2.5 text-[11.5px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
                    >
                      <XCircle className="size-3.5" />
                      {t("ops.doc.revoke")}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddBooking({ operationId, onDone }: { operationId: string; onDone: () => void }) {
  const { t } = useTraveliunUI();
  const [kind, setKind] = useState<BookingKind>("hotel");
  const [title, setTitle] = useState("");
  const [city, setCity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mb-3 grid gap-2 rounded-[11px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 sm:grid-cols-2">
      <label className={label}>
        {t("ops.booking.add")}
        <select value={kind} onChange={(e) => setKind(e.target.value as BookingKind)} className={field}>
          {BOOKING_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`ops.booking.${k}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {t("pg.desc")}
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
      </label>
      <label className={label}>
        {t("pg.city")}
        <input value={city} onChange={(e) => setCity(e.target.value)} className={field} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          {t("pg.checkIn")}
          <input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} tv-tnum`} />
        </label>
        <label className={label}>
          {t("pg.checkOut")}
          <input type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} className={`${field} tv-tnum`} />
        </label>
      </div>
      {error ? <p className="text-[12px] font-bold text-[#c22850] sm:col-span-2">{error}</p> : null}
      <div className="sm:col-span-2">
        <button
          type="button"
          disabled={pending || !title.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await addBooking({
                operation_id: operationId,
                kind,
                title: title.trim(),
                city_name: city.trim(),
                start_date: from || null,
                end_date: to || null,
              });
              if (!res.ok) setError(t(res.error));
              else onDone();
            })
          }
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("add")}
        </button>
      </div>
    </div>
  );
}

function BookingRow({ booking, onDone }: { booking: OperationBooking; onDone: () => void }) {
  const { t } = useTraveliunUI();
  const [confirming, setConfirming] = useState(false);
  const [ref, setRef] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const done = booking.status === "confirmed";

  return (
    <li className={`rounded-[11px] border p-3 ${done ? "border-[#bfe5d4] bg-[#f6fdfa]" : "border-[#e2ebe7]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-extrabold text-[#0f3d38]">
            {booking.title}
            {booking.city_name ? <span className="font-semibold text-[#557d78]"> — {booking.city_name}</span> : null}
          </p>
          <p className="tv-tnum mt-0.5 flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#93aaa3]">
            <span>{t(`ops.booking.${booking.kind}` as TranslationKey)}</span>
            {booking.start_date ? (
              <DirText dir="ltr">{`${booking.start_date} → ${booking.end_date ?? "—"}`}</DirText>
            ) : null}
            {booking.confirmation_number ? (
              <span className="text-[#0f7a52]">
                {t("ops.booking.confirmationNo")} <DirText dir="ltr">{booking.confirmation_number}</DirText>
              </span>
            ) : null}
          </p>
        </div>
        {!done ? (
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            {t("ops.booking.manual")}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7f0] px-2.5 py-1 text-[11px] font-bold text-[#0f7a52]">
            <CheckCircle2 className="size-3.5" />
            {t("ops.booking.status.confirmed")}
          </span>
        )}
      </div>

      {confirming && !done ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className={`${label} flex-1`}>
            {t("ops.booking.confirmationNo")}
            <input dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} className={`${field} tv-tnum text-start`} />
          </label>
          <button
            type="button"
            disabled={pending || !ref.trim()}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await confirmBookingManually({ booking_id: booking.id, confirmation_number: ref.trim() });
                if (!res.ok) setError(t(res.error));
                else onDone();
              })
            }
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {t("ops.booking.confirmAction")}
          </button>
          {error ? <p className="w-full text-[12px] font-bold text-[#c22850]">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
