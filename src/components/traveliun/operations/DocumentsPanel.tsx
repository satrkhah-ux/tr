"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BedDouble,
  Car,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  ListChecks,
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
  cancelBooking,
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
import { ROOM_SPEC_KEY, type VoucherKind } from "@/lib/operations/voucher-dto";
import { roomDetailsOpen } from "@/lib/operations/room-details";
import { carFields, carText, DRV } from "@/lib/operations/drivers";
import type { TranslationKey } from "@/lib/i18n";
import type { AssigneeOption, SentRequest } from "@/lib/data/operation-assign";
import { BOARD_AR } from "@/components/offer-doc/labels";
import { BOARD_LABEL_KEYS, BOARD_TYPES } from "@/lib/offer/draft-types";
import { roomSuggestions } from "@/lib/offer/basic";
import { awaitingConfirmation } from "@/lib/operations/confirm-all";
import { isUnassigned } from "@/lib/operations/wizard";
import type { BoardType } from "@/lib/types";
import { AssignBooking, AssigneeChip } from "./AssignBooking";
import { SupplierBooking } from "./SupplierBooking";
import { CatalogHotelPick, useCaseHotels } from "./CaseHotelPicker";
import { ConfirmAllBookings } from "./ConfirmAllBookings";
import { RoomDetails } from "./RoomDetails";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition, useSessionField } from "../useSafeTransition";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

const BOOKING_KINDS: BookingKind[] = ["hotel", "flight", "transport", "visa", "service"];
const DOC_KINDS: VoucherKind[] = ["hotel_voucher", "flight_ticket", "itinerary", "booking_summary", "welcome_board"];

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
  canBook,
  canManage,
}: {
  operationId: string;
  bookings: OperationBooking[];
  documents: OperationDocument[];
  hasDays: boolean;
  clientToken: string | null;
  assignees: AssigneeOption[];
  sentRequests: SentRequest[];
  canBook: boolean;
  /** the manager's step on this case (access.ts gateCaseManager) — «تأكيد الكل» takes the net charged from it only. */
  canManage: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  // what the last pull added — 0 says the case already holds everything the offer has
  const [seeded, setSeeded] = useState<number | null>(null);
  // one voucher per hotel, each desk its own page (the owner, 2026-10-17)
  const [perHotel, setPerHotel] = useState(true);
  const [welcomeName, setWelcomeName] = useState("");

  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const outstanding = bookings.filter((b) => b.status !== "confirmed" && b.status !== "cancelled");
  const waiting = bookings.filter((b) => awaitingConfirmation(b.status));

  const live = documents.filter((d) => !d.revoked_at);
  const issuedKinds = new Set(live.map((d) => d.kind));

  /** Can a document of this kind be issued right now, and why not. */
  function availability(kind: VoucherKind): { can: boolean; reason: TranslationKey | null } {
    if (kind === "itinerary") return hasDays ? { can: true, reason: null } : { can: false, reason: "ops.err.nothingToIssue" };
    // A welcome board needs nothing confirmed — it is a name on a sheet, and it
    // is wanted EARLY, often before the first hotel comes back.
    if (kind === "welcome_board") return { can: true, reason: null };
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
            setError(t(res.error, res.params));
            return;
          }
        }
        router.refresh();
        return;
      }
      const res = await issueDocument({ operation_id: operationId, kind, welcome_name: kind === "welcome_board" ? welcomeName : null });
      if (!res.ok) setError(t(res.error, res.params));
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- bookings ---- */}
      <section id="bookings" className={`${card} scroll-mt-24`}>
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
                  else {
                    setSeeded(res.added);
                    router.refresh();
                  }
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
            {waiting.length > 0 ? (
              <button
                type="button"
                onClick={() => setConfirmingAll((v) => !v)}
                aria-expanded={confirmingAll}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
              >
                <ListChecks className="size-3.5" />
                {t("ops.confirmAll")}
              </button>
            ) : null}
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
          {seeded != null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef4f2] px-3 py-1 text-[#557d78]">
              <Download className="size-3.5" />
              {t("ops.seeded", { n: seeded })}
            </span>
          ) : null}
        </div>

        {adding ? <AddBooking operationId={operationId} onDone={() => { setAdding(false); router.refresh(); }} /> : null}
        {confirmingAll && waiting.length > 0 ? (
          <ConfirmAllBookings operationId={operationId} bookings={waiting} canSetNet={canManage} onDone={() => router.refresh()} />
        ) : null}

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
                canBook={canBook}
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

        {/* The one field on this panel that is a CHOICE rather than a fact.
            Clients ask for a specific spelling, a title, or the name of whoever
            is actually meeting the driver — so it is typed here, at the moment
            of issuing, and frozen into that board's snapshot. */}
        <div className="mt-3 max-w-md">
          <label className={label}>
            {t("ops.doc.welcomeName")}
            <input
              value={welcomeName}
              onChange={(e) => setWelcomeName(e.target.value)}
              placeholder="Mr. Ahmed Ali"
              className={field}
            />
          </label>
          <p className="mt-1 text-[11px] font-semibold text-[#93aaa3]">{t("ops.doc.welcomeHint")}</p>
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
export function ClientLinkBlock({ operationId, token }: { operationId: string; token: string | null }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useSafeTransition();
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

/** «غرفة مزدوجة — إفطار»: the room line the pull writes, so a typed hotel reads like a pulled one. */
function roomLine(room: string, board: BoardType | ""): string {
  return [room.trim(), board ? BOARD_AR[board] : ""].filter(Boolean).join(" — ");
}

const nightsBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function AddBooking({ operationId, onDone }: { operationId: string; onDone: () => void }) {
  const { t } = useTraveliunUI();
  const [kind, setKind] = useState<BookingKind>("hotel");
  const [title, setTitle] = useState("");
  const [city, setCity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // a hotel: picked from the catalogue (its city comes with it), its room, board and rooms
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [room, setRoom] = useState("");
  const [board, setBoard] = useState<BoardType | "">("");
  const [rooms, setRooms] = useState(1);
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const hotel = kind === "hotel";
  const catalog = useCaseHotels(operationId, hotel);
  const roomList = `ops-rooms-${operationId}`;

  function hotelDetail(): Record<string, string> {
    const detail: Record<string, string> = {};
    if (roomLine(room, board)) detail["الغرفة"] = roomLine(room, board);
    detail["عدد الغرف"] = String(rooms);
    const nights = from && to ? nightsBetween(from, to) : 0;
    if (nights > 0) detail["عدد الليالي"] = String(nights);
    return detail;
  }

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
      {hotel ? (
        <CatalogHotelPick
          catalog={catalog}
          valueId={hotelId}
          onPick={(h) => {
            setHotelId(h?.id ?? null);
            if (!h) return;
            setTitle(h.name);
            if (h.city) setCity(h.city);
          }}
        />
      ) : null}
      <label className={label}>
        {t("pg.desc")}
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            // a typed name is the agent's own, not the catalogue's
            setHotelId(null);
          }}
          className={field}
        />
      </label>
      <label className={label}>
        {t("pg.city")}
        <input value={city} onChange={(e) => setCity(e.target.value)} className={field} />
      </label>
      {hotel ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] gap-2 sm:col-span-2">
          <label className={label}>
            {t("pg.roomType")}
            <input
              list={roomList}
              value={room}
              onChange={(e) => {
                setRoom(e.target.value);
                // a room the catalogue knows brings its board
                const known = catalog?.roomTypes.find((r) => r.hotel_id === hotelId && r.name.trim() === e.target.value.trim());
                if (known?.default_board) setBoard(known.default_board);
              }}
              className={field}
            />
            <datalist id={roomList}>
              {roomSuggestions(catalog?.roomTypes ?? [], hotelId).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className={label}>
            {t("pg.board")}
            <select value={board} onChange={(e) => setBoard(e.target.value as BoardType | "")} className={field}>
              <option value="">—</option>
              {BOARD_TYPES.map((b) => (
                <option key={b} value={b}>
                  {t(BOARD_LABEL_KEYS[b])}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {t("pg.roomsCount")}
            <input
              type="number"
              min={1}
              max={50}
              dir="ltr"
              inputMode="numeric"
              value={rooms}
              onChange={(e) => setRooms(Math.min(Math.max(Math.trunc(Number(e.target.value)) || 1, 1), 50))}
              className={`${field} tv-tnum`}
            />
          </label>
        </div>
      ) : null}
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
                ...(hotel ? { detail: hotelDetail() } : {}),
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

/**
 * What a booking of each kind is run with, beyond its title and dates: a
 * transfer needs its time, flight, meeting point and driver; a tour its start
 * time and car. Shown as fields in the edit form even before they are filled.
 */
const KIND_FIELDS: Partial<Record<OperationBooking["kind"], string[]>> = {
  transport: ["الوقت", "الرحلة", "نقطة الالتقاء", "السيارة", "رقم السيارة", "السائق", "جوال السائق"],
  service: ["وقت الانطلاق", "السيارة", "رقم السيارة", "السائق", "جوال السائق"],
};

/**
 * The detail as the edit form lays it out: every key the booking has plus its
 * kind's, the car as its model with «عدد السيارات» right after it — so typing a
 * model into «السيارة» keeps the «× 2» (carFields).
 */
function detailForm(booking: OperationBooking): Record<string, string> {
  const d = { ...(booking.detail ?? {}), ...carFields(booking.detail) };
  // the room details are «تفاصيل الغرفة»'s, not a field to type JSON into
  const keys = [...new Set([...Object.keys(d), ...(KIND_FIELDS[booking.kind] ?? [])])].filter((k) => k !== DRV.cars && k !== ROOM_SPEC_KEY);
  const car = keys.indexOf(DRV.car);
  if (car >= 0) keys.splice(car + 1, 0, DRV.cars);
  return Object.fromEntries(keys.map((k) => [k, d[k] ?? ""]));
}

/** A single-day booking (a transfer, a tour, a visa) has a date, not a range. */
const singleDay = (kind: OperationBooking["kind"]) => kind === "transport" || kind === "service" || kind === "visa";

function BookingRow({
  booking,
  operationId,
  assignees,
  canBook,
  onDone,
}: {
  booking: OperationBooking;
  operationId: string;
  assignees: AssigneeOption[];
  canBook: boolean;
  onDone: () => void;
}) {
  const { t } = useTraveliunUI();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rooming, setRooming] = useState(false);
  // kept in this tab until sent — a reload after a deploy used to lose it
  const [ref, setRef, forgetRef] = useSessionField(`ref:${booking.id}`, booking.confirmation_number ?? "");
  const [form, setForm] = useState({
    title: booking.title,
    city_name: booking.city_name,
    start_date: booking.start_date ?? "",
    end_date: booking.end_date ?? "",
    detail: detailForm(booking),
  });
  const when = booking.detail?.["الوقت"] || booking.detail?.["وقت الانطلاق"] || "";
  // a hotel pulled before it was chosen («فندق بالي — يُحدَّد لاحقاً») is named from the catalogue here
  const catalog = useCaseHotels(operationId, editing && booking.kind === "hotel");
  const [pending, startTransition] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);

  const done = booking.status === "confirmed";
  // what a supplier holds is cancelled, never deleted (the server refuses it):
  // a manual one here, an API one through «ألغِ لدى المورّد»
  const held = done || booking.status === "in_flight";

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
              <DirText dir="ltr">
                {singleDay(booking.kind) || !booking.end_date ? `${booking.start_date}${when ? ` · ${when}` : ""}` : `${booking.start_date} → ${booking.end_date}`}
              </DirText>
            ) : null}
            {/* a tour's car and how many — «فان × 2» — without opening the edit form */}
            {carText(booking.detail) ? (
              <span className="inline-flex items-center gap-1 text-[#557d78]" title={t("ops.drv.car")}>
                <Car className="size-3" />
                {carText(booking.detail)}
              </span>
            ) : null}
            {booking.confirmation_number ? (
              <span className="text-[#0f7a52]">
                {t("ops.booking.confirmationNo")} <DirText dir="ltr">{booking.confirmation_number}</DirText>
              </span>
            ) : null}
            <AssigneeChip kind={booking.assignee_kind} label={booking.assignee_label} unset={isUnassigned(booking)} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* what the hotel confirmed about the room — only once it is confirmed */}
          {roomDetailsOpen(booking) ? (
            <button
              type="button"
              onClick={() => setRooming((v) => !v)}
              aria-expanded={rooming}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <BedDouble className="size-3.5" />
              {t("ops.room.details")}
            </button>
          ) : null}
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
          {!held || booking.source === "manual" ? (
            <button
              type="button"
              disabled={pending}
              aria-label={held ? t("ops.booking.cancel") : t("delete")}
              title={held ? t("ops.booking.cancel") : undefined}
              onClick={() =>
                startTransition(async () => {
                  if (held && !window.confirm(t("ops.booking.cancelAsk"))) return;
                  const res = held ? await cancelBooking(booking.id, "") : await deleteBooking(booking.id);
                  if (!res.ok) setError(t(res.error));
                  else onDone();
                })
              }
              className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
            >
              {held ? <XCircle className="size-3.5" /> : <Trash2 className="size-3.5" />}
            </button>
          ) : null}
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

      {/* Hotels only — TBO is a hotel API, and flights/visas stay manual. */}
      <SupplierBooking booking={booking} canBook={canBook} onDone={onDone} />

      {rooming && roomDetailsOpen(booking) ? (
        <RoomDetails
          booking={booking}
          onDone={() => {
            setRooming(false);
            onDone();
          }}
        />
      ) : null}

      {editing ? (
        <div className="mt-2 grid gap-2 rounded-[9px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 sm:grid-cols-2">
          {booking.kind === "hotel" ? (
            <CatalogHotelPick
              catalog={catalog}
              valueId={catalog?.hotels.find((h) => h.name === form.title.trim())?.id ?? null}
              onPick={(h) => {
                if (h) setForm((f) => ({ ...f, title: h.name, city_name: h.city || f.city_name }));
              }}
            />
          ) : null}
          <label className={label}>
            {t("pg.desc")}
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={field} />
          </label>
          <label className={label}>
            {booking.kind === "flight" ? t("ops.booking.route") : t("pg.city")}
            <input value={form.city_name} onChange={(e) => setForm((f) => ({ ...f, city_name: e.target.value }))} className={field} />
          </label>
          <label className={label}>
            {booking.kind === "hotel" ? t("pg.checkIn") : booking.kind === "flight" ? t("ops.booking.goDate") : t("ops.booking.date")}
            <input
              type="date"
              dir="ltr"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              className={`${field} tv-tnum`}
            />
          </label>
          {singleDay(booking.kind) ? null : (
            <label className={label}>
              {booking.kind === "hotel" ? t("pg.checkOut") : t("ops.booking.backDate")}
              <input
                type="date"
                dir="ltr"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                className={`${field} tv-tnum`}
              />
            </label>
          )}
          {/* the booking's own details — the time, the flight, the driver … — each editable */}
          {Object.keys(form.detail).length > 0 ? (
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <span className="text-[11.5px] font-extrabold text-[#185045] sm:col-span-2">{t("ops.booking.details")}</span>
              {Object.entries(form.detail).map(([key, value]) => (
                <label key={key} className={label}>
                  {key}
                  <input
                    value={value}
                    onChange={(e) => setForm((f) => ({ ...f, detail: { ...f.detail, [key]: e.target.value } }))}
                    {...(key === DRV.cars ? { type: "number", min: 1, max: 50, inputMode: "numeric" as const, dir: "ltr" } : {})}
                    className={field}
                  />
                </label>
              ))}
            </div>
          ) : null}
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
                    end_date: singleDay(booking.kind) ? null : form.end_date || null,
                    // empty fields are left out — a blank «السائق» is not a driver; the room details ride along
                    detail: {
                      ...Object.fromEntries(Object.entries(form.detail).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
                      ...(booking.detail?.[ROOM_SPEC_KEY] ? { [ROOM_SPEC_KEY]: booking.detail[ROOM_SPEC_KEY] } : {}),
                    },
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
                else {
                  forgetRef();
                  onDone();
                }
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
