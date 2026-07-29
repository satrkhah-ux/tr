"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Ticket,
  Trash2,
  XCircle,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  addBooking,
  confirmBookingManually,
  deleteBooking,
  issueDocument,
  markBookingPaid,
  revokeDocument,
  updateBooking,
  type BookingKind,
  type OperationBooking,
  type OperationDocument,
} from "@/lib/data/operation-bookings";
import { seedBookingsFromOffer } from "@/lib/data/operation-seed";
import { ensureClientLink, revokeClientLink } from "@/lib/data/operation-hub";
import type { VoucherKind } from "@/lib/operations/voucher-dto";
import type { TranslationKey } from "@/lib/i18n";
import type { AssigneeOption, SentRequest } from "@/lib/data/operation-assign";
import { AssignBooking, AssigneeChip } from "./AssignBooking";
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
  clientToken,
  assignees,
  sentRequests,
}: {
  operationId: string;
  bookings: OperationBooking[];
  documents: OperationDocument[];
  hasDays: boolean;
  clientToken: string | null;
  assignees: AssigneeOption[];
  sentRequests: SentRequest[];
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [perHotel, setPerHotel] = useState(false);

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

  /**
   * ONE document is the default, deliberately: a client carries a single sheet
   * and a desk is handed a single sheet. Per-hotel is the exception an agent
   * asks for when each property wants its own paper, so it lives behind a
   * switch rather than doubling the buttons.
   */
  function issue(kind: VoucherKind) {
    startTransition(async () => {
      setError(null);
      if (kind === "hotel_voucher" && perHotel) {
        const hotels = confirmed.filter((b) => b.kind === "hotel");
        for (const h of hotels) {
          const res = await issueDocument({ operation_id: operationId, kind, booking_id: h.id });
          if (!res.ok) {
            setError(t(res.error));
            return;
          }
        }
        router.refresh();
        return;
      }
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await seedBookingsFromOffer(operationId);
                  if (!res.ok) setError(t(res.error));
                  else router.refresh();
                })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {t("ops.seedFromOffer")}
            </button>
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <Plus className="size-3.5" />
              {t("ops.booking.add")}
            </button>
          </div>
        </div>
        <p className="mb-3 text-[11.5px] font-semibold text-[#93aaa3]">{t("ops.seedHint")}</p>

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
              <BookingRow
                key={b.id}
                booking={b}
                operationId={operationId}
                assignees={assignees}
                onDone={() => router.refresh()}
              />
            ))}
          </ul>
        )}

        {sentRequests.length > 0 ? (
          <div className="mt-3 border-t border-[#f0f4f2] pt-3">
            <p className="mb-2 text-[11.5px] font-extrabold text-[#557d78]">{t("ops.request.sentLog")}</p>
            <ul className="space-y-1.5">
              {sentRequests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] font-bold text-[#93aaa3]">
                  <span className="text-[#0f3d38]">{r.to_label}</span>
                  <span>
                    {r.channel === "whatsapp" ? t("ops.dispatch.whatsapp") : t("ops.dispatch.manual")}
                    {r.sent_at ? (
                      <span className="tv-tnum ms-2">
                        <DirText dir="ltr">{r.sent_at.slice(0, 16).replace("T", " ")}</DirText>
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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

        {confirmed.some((b) => b.kind === "hotel") ? (
          <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-[#f8fbf9] px-3 py-2 text-[11.5px] font-bold text-[#557d78]">
            <input
              type="checkbox"
              checked={perHotel}
              onChange={(e) => setPerHotel(e.target.checked)}
              className="size-4 accent-[#185045]"
            />
            <Layers className="size-3.5" />
            {t("ops.doc.perHotel")}
          </label>
        ) : null}

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

        <ClientLinkBlock operationId={operationId} token={clientToken} />
      </section>
    </div>
  );
}

/**
 * ONE link the client keeps.
 *
 * Individual documents already have their own share tokens; this is the folder,
 * and it updates itself — issuing a voucher tomorrow makes it appear on the same
 * URL. Without it the agent sends four links over four days and the client loses
 * track of which is current, which is exactly why ops keeps being asked "did the
 * hotel come through?".
 */
function ClientLinkBlock({ operationId, token }: { operationId: string; token: string | null }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const url = token ? `${typeof window === "undefined" ? "" : window.location.origin}/trip/${token}` : "";

  return (
    <div className="mt-4 rounded-[12px] border border-[#d6eadf] bg-[#f2fbf6] p-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#0f7a52]">
        <Link2 className="size-4" />
        {t("ops.clientLink")}
      </p>
      <p className="mt-1 text-[11.5px] font-semibold text-[#557d78]">{t("ops.clientLinkHint")}</p>

      {token ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            readOnly
            dir="ltr"
            value={url}
            className="h-9 min-w-0 flex-1 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] text-[#185045]"
          />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439]"
          >
            <Copy className="size-3.5" />
            {copied ? t("copied") : t("ops.clientLinkCopy")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await revokeClientLink(operationId);
                router.refresh();
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#f2c7c7] px-2.5 text-[12px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
          >
            <XCircle className="size-3.5" />
            {t("ops.clientLinkRevoke")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await ensureClientLink(operationId);
              router.refresh();
            })
          }
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          {t("ops.clientLink")}
        </button>
      )}
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

function BookingRow({
  booking,
  operationId,
  assignees,
  onDone,
}: {
  booking: OperationBooking;
  operationId: string;
  assignees: AssigneeOption[];
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ref, setRef] = useState(booking.confirmation_number ?? "");
  const [form, setForm] = useState({
    title: booking.title,
    city_name: booking.city_name,
    start_date: booking.start_date ?? "",
    end_date: booking.end_date ?? "",
  });
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
            <AssigneeChip kind={booking.assignee_kind} label={booking.assignee_label} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* corrective work is the norm here — a date read wrong off a supplier
              email, a room the hotel downgraded. Without edit the only recourse
              is delete-and-retype, which loses the confirmation number too. */}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-label={t("edit")}
            className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={pending}
            aria-label={t("delete")}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteBooking(booking.id);
                if (!res.ok) setError(t(res.error));
                else onDone();
              })
            }
            className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
          >
            <Trash2 className="size-3.5" />
          </button>
        {!done ? (
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            {t("ops.booking.manual")}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7f0] px-2.5 py-1 text-[11px] font-bold text-[#0f7a52]">
              <CheckCircle2 className="size-3.5" />
              {t("ops.booking.status.confirmed")}
            </span>
            {/* Acknowledged is not ticketed. The voucher prints a warning band
                until this is switched on, so it has to be a deliberate second
                action rather than something that follows from confirmation. */}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markBookingPaid(booking.id, !booking.is_paid);
                  onDone();
                })
              }
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold transition-colors disabled:opacity-60 ${
                booking.is_paid ? "bg-[#185045] text-white" : "border border-[#f2e2b4] bg-[#fff8e8] text-[#a86a10]"
              }`}
            >
              <Ticket className="size-3.5" />
              {booking.is_paid ? t("ops.booking.markPaid") : t("ops.booking.unpaid")}
            </button>
          </div>
        )}
        </div>
      </div>

      <AssignBooking booking={booking} operationId={operationId} assignees={assignees} onDone={onDone} />

      {editing ? (
        <div className="mt-2 grid gap-2 rounded-[9px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 sm:grid-cols-2">
          <label className={label}>
            {t("pg.desc")}
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={field} />
          </label>
          <label className={label}>
            {t("pg.city")}
            <input value={form.city_name} onChange={(e) => setForm((f) => ({ ...f, city_name: e.target.value }))} className={field} />
          </label>
          <label className={label}>
            {t("pg.checkIn")}
            <input
              type="date"
              dir="ltr"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              className={`${field} tv-tnum`}
            />
          </label>
          <label className={label}>
            {t("pg.checkOut")}
            <input
              type="date"
              dir="ltr"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              className={`${field} tv-tnum`}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={pending || !form.title.trim()}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await updateBooking({
                    id: booking.id,
                    title: form.title,
                    city_name: form.city_name,
                    start_date: form.start_date || null,
                    end_date: form.end_date || null,
                  });
                  if (!res.ok) setError(t(res.error));
                  else {
                    setEditing(false);
                    onDone();
                  }
                })
              }
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
              {t("save")}
            </button>
          </div>
        </div>
      ) : null}

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
