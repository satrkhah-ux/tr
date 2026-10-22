"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, BedDouble, Camera, CheckCircle2, ChevronDown, ExternalLink, FileText, Loader2, Pencil, Plus, RefreshCw, Trash2, Type } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { deleteBooking, type OperationBooking } from "@/lib/data/operation-bookings";
import { listAssignees, type AssigneeOption } from "@/lib/data/operation-assign";
import { readHotelConfirmation, saveHotelConfirmation, type HotelRead } from "@/lib/data/wizard-tickets";
import { getSupplierConfirmationUrl } from "@/lib/data/supplier-work";
import { refreshSupplierBooking } from "@/lib/data/supplier-booking";
import { MAX_TICKET_BYTES } from "@/lib/flights/ticket-parse";
import { hotelBookings, hotelOverlaps, isFinal, roomLines } from "@/lib/operations/wizard/hotels";
import { notPulled } from "@/lib/operations/wizard/pull";
import type { StepProps } from "@/lib/operations/wizard/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";
import { AssignBooking } from "../AssignBooking";
import { AddBooking } from "../DocumentsPanel";
import { PullNotice, wzCard, wzField, wzPrimary, wzSecondary } from "./FlightsStep";
import { IssueGuardNotice } from "../../IssueGuardNotice";

/** «الوصول → المغادرة» — on a narrow phone it breaks at the arrow, never inside a date */
function Stay({ b }: { b: Pick<OperationBooking, "start_date" | "end_date"> }) {
  return (
    <DirText className="tv-tnum">
      <span className="whitespace-nowrap">{b.start_date ?? "—"}</span> → <span className="whitespace-nowrap">{b.end_date ?? "—"}</span>
    </DirText>
  );
}
const tool =
  "inline-flex h-10 items-center justify-center gap-1 rounded-[10px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-50 sm:w-[78px] aria-pressed:border-[#185045] aria-pressed:bg-[#eef6f3]";

/**
 * «الفنادق» — one row per hotel in trip order (the owner, 2026-10-22: «المدينة،
 * اسم الفندق، الوصول والمغادرة، رقم حجز الفندق … وعندما يتم الإدخال اطوي
 * الخانة، ثم المدينة التالية»). Only the first hotel without its own number is
 * open: the number, or a file, a photo or the text to read it from. Saved, the
 * row folds to one green line and the next one opens. Who books it, the rooms,
 * our ref, the supplier pull, delete and the filed paper wait under «خيارات».
 */
export function HotelsStep({ data }: StepProps) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const hotels = [...hotelBookings(data)].sort((a, b) => (a.start_date ?? "9").localeCompare(b.start_date ?? "9"));
  const operationId = data.operation.id;
  const filed = new Set((data.supplierWork?.bookings ?? []).filter((b) => b.has_confirmation).map((b) => b.booking_id));
  const overlaps = hotelOverlaps(hotels);
  const [adding, setAdding] = useState(false);
  // a number saved here counts at once, before the refresh brings it back
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const done = (b: OperationBooking) => b.id in saved || isFinal(b);
  const openId = picked ?? hotels.find((b) => !done(b))?.id ?? null;
  const glide = useRef(false);
  useEffect(() => {
    if (!glide.current || !openId) return;
    glide.current = false;
    document.getElementById(`hotel-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openId]);
  // «ينفّذه»: who each hotel can be handed to — loaded once for the step
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  useEffect(() => {
    let live = true;
    listAssignees()
      .then((list) => live && setAssignees(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className={wzCard}>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
        <BedDouble className="size-4" />
        {t("wz.hotels.title")}
      </h2>
      {/* «أكمل بيانات الفندق»: what the voucher lacks (address, phone, English name) — one line that opens, never blocks */}
      {data.offerHotels?.length ? <IssueGuardNotice hotels={data.offerHotels} only="voucher" compact className="mb-3" /> : null}
      {hotels.length > 0 ? (
        <ul className="grid gap-2">
          {hotels.map((b) => (
            <HotelRow
              key={b.id}
              booking={b}
              done={done(b)}
              number={saved[b.id] ?? b.confirmation_number ?? ""}
              open={b.id === openId}
              onOpen={() => setPicked(b.id)}
              onClose={() => setPicked(null)}
              onSaved={(n) => {
                setSaved((s) => ({ ...s, [b.id]: n }));
                setPicked(null);
                glide.current = true;
              }}
              hasFile={filed.has(b.id)}
              assignees={assignees}
              partnerId={data.operation.partner_id}
              overlaps={overlaps.get(b.id) ?? []}
              readsImages={data.readsImages ?? true}
            />
          ))}
        </ul>
      ) : notPulled(data, "hotel") ? (
        <PullNotice operationId={operationId} />
      ) : (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">{t("wz.hotels.none")}</p>
      )}
      <button
        type="button"
        onClick={() => setAdding((v) => !v)}
        aria-expanded={adding}
        className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[#557d78] hover:text-[#185045] hover:underline"
      >
        <Plus className="size-3.5" />
        {t("wz.hotels.add")}
      </button>
      {adding ? (
        <AddBooking
          operationId={operationId}
          only="hotel"
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function HotelRow({
  booking,
  done,
  number,
  open,
  onOpen,
  onClose,
  onSaved,
  hasFile,
  assignees,
  partnerId,
  overlaps,
  readsImages,
}: {
  booking: OperationBooking;
  done: boolean;
  /** the hotel's own number — just saved here, else the booking's */
  number: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSaved: (number: string) => void;
  hasFile: boolean;
  assignees: AssigneeOption[];
  /** the file's partner company (offers.partner_company_id) — the only one «ينفّذه» offers. */
  partnerId: string | null;
  /** the other hotels holding one of its nights (hotels.ts hotelOverlaps). */
  overlaps: Pick<OperationBooking, "title" | "start_date" | "end_date">[];
  readsImages: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [options, setOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();

  function pullFromSupplier() {
    startTransition(async () => {
      setError(null);
      const res = await refreshSupplierBooking(booking.id);
      if (!res.ok) return setError("message" in res ? res.message : t(res.error));
      router.refresh();
    });
  }

  // «عرض الكل»'s rule: what a supplier holds is cancelled there, never deleted (the server refuses it too)
  const held = booking.status === "confirmed" || booking.status === "in_flight";
  function remove() {
    startTransition(async () => {
      if (!window.confirm(t("ops.booking.deleteAsk", { title: booking.title }))) return;
      setError(null);
      const res = await deleteBooking(booking.id);
      if (!res.ok) return setError(t(res.error));
      router.refresh();
    });
  }

  function openFile() {
    startTransition(async () => {
      const res = await getSupplierConfirmationUrl(booking.id);
      if (res.ok) window.open(res.url, "_blank", "noopener");
      else setError(t(res.error));
    });
  }

  const rooms = roomLines(booking.detail);
  const dot = <span className="hidden text-[#b7cac4] sm:inline">·</span>;

  return (
    <li
      id={`hotel-${booking.id}`}
      className={`scroll-mt-24 rounded-[12px] border p-3 transition-colors ${open ? "border-[#9fc4b8] bg-white shadow-[0_2px_8px_rgba(0,60,58,0.06)]" : done ? "border-[#cfe9dc] bg-[#f3faf6]" : "border-[#e2ebe7] bg-white"}`}
    >
      {/* a phone: the city and the buttons on one line, the hotel, the stay and the number under them; wider: all on one line */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5 text-[12.5px] font-bold text-[#557d78] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <button type="button" onClick={onOpen} disabled={open} className="col-start-1 row-start-1 flex items-center gap-1.5 py-1.5 text-start text-[13px] font-extrabold text-[#0f3d38]">
          {done ? <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" /> : <span className="size-2.5 shrink-0 rounded-full bg-[#e3a43a]" />}
          {booking.city_name || "—"}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={onOpen}
          disabled={open}
          className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-start sm:col-span-1 sm:col-start-2 sm:row-start-1"
        >
          {dot}
          <span className="break-words text-[#185045]">{booking.title}</span>
          {dot}
          <Stay b={booking} />
          {done && !open ? (
            <>
              {dot}
              <DirText className="tv-tnum font-extrabold text-[#0f7a52]">{number}</DirText>
            </>
          ) : null}
        </button>
        <div className="col-start-2 row-start-1 flex items-center sm:col-start-3">
          {done && !open ? (
            <button
              type="button"
              onClick={onOpen}
              aria-label={t("wz.hotels.edit")}
              className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[11.5px] font-bold text-[#185045] hover:bg-[#e6f2ed]"
            >
              <Pencil className="size-3" />
              <span className="hidden sm:inline">{t("wz.hotels.edit")}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOptions((v) => !v)}
            aria-expanded={options}
            className="inline-flex h-8 items-center gap-0.5 rounded-[8px] px-2 text-[11.5px] font-bold text-[#557d78] hover:bg-[#f0f5f3]"
          >
            {t("wz.hotels.options")}
            <ChevronDown className={`size-3.5 transition-transform ${options ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {overlaps.length > 0 ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] font-bold text-[#c22850]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">
            {t("wz.hotels.overlap")}{" "}
            {overlaps.map((o, i) => (
              <span key={i}>
                {i > 0 ? "، " : ""}
                {o.title} <Stay b={o} />
              </span>
            ))}
          </span>
        </p>
      ) : null}

      {open ? <HotelEntry booking={booking} initial={done ? number : ""} readsImages={readsImages} onSaved={onSaved} onCancel={done ? onClose : undefined} /> : null}

      {options ? (
        <div className="mt-2 grid gap-2 rounded-[10px] bg-[#f6faf8] p-3 text-[11.5px] font-semibold text-[#557d78] animate-in fade-in slide-in-from-top-1">
          {rooms.length > 0 ? <p>{rooms.join(" / ")}</p> : null}
          <p>
            {t("wz.hotels.ourRef")}: <DirText className="tv-tnum">{booking.company_ref ?? "—"}</DirText>
          </p>
          {/* «ينفّذه» — who books this hotel, and the request to them (as on «عرض الكل») */}
          <AssignBooking booking={booking} operationId={booking.operation_id} assignees={assignees} partnerId={partnerId} onDone={() => undefined} />
          <div className="flex flex-wrap gap-2">
            {booking.source === "api" && !done ? (
              <button type="button" disabled={pending} onClick={pullFromSupplier} className={wzSecondary}>
                <RefreshCw className="size-3.5" />
                {t("wz.hotels.api")}
              </button>
            ) : null}
            {hasFile ? (
              <button type="button" disabled={pending} onClick={openFile} className={wzSecondary}>
                <ExternalLink className="size-3.5" />
                {t("wz.hotels.viewFile")}
              </button>
            ) : null}
            {held ? null : (
              <button type="button" disabled={pending} onClick={remove} className={`${wzSecondary} border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1]`}>
                <Trash2 className="size-3.5" />
                {t("delete")}
              </button>
            )}
          </div>
          {error ? <p className="font-bold text-[#c22850]">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** The open row: the hotel's number — typed, or read off its file, photo or text — then «حفظ». */
function HotelEntry({
  booking,
  initial,
  readsImages,
  onSaved,
  onCancel,
}: {
  booking: OperationBooking;
  initial: string;
  readsImages: boolean;
  onSaved: (number: string) => void;
  /** a saved row reopened for an edit can fold back unchanged */
  onCancel?: () => void;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [number, setNumber] = useState(initial);
  const [result, setResult] = useState<HotelRead | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // null: the paste box is shut
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();
  const [doing, setDoing] = useState<"read" | "save">("read");
  const pdf = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);

  function read(paper: File | null, pasted = "") {
    if (paper && paper.size > MAX_TICKET_BYTES) return setError(t("fc.err.tooLarge"));
    setDoing("read");
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("booking_id", booking.id);
      if (paper) fd.append("file", paper);
      else fd.append("text", pasted);
      const res = await readHotelConfirmation(fd);
      if (!res.ok) return setError(t(res.error));
      setResult(res.result);
      setFile(paper);
      setText(null);
      if (res.result.read.confirmation) setNumber(res.result.read.confirmation);
    });
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const paper = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (paper) read(paper);
  }

  function save() {
    setDoing("save");
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("booking_id", booking.id);
      fd.append("confirmation_number", number.trim());
      if (file) fd.append("file", file);
      // only what the hotel's record lacks — the server checks again and never overwrites
      if (result?.fill.address && result.read.address) fd.append("address", result.read.address);
      if (result?.fill.phone && result.read.phone) fd.append("phone", result.read.phone);
      const res = await saveHotelConfirmation(fd);
      if (!res.ok) return setError(t(res.error));
      onSaved(number.trim());
      router.refresh();
    });
  }

  const fills = result
    ? [result.fill.address && result.read.address ? `${t("wz.hotels.address")}: ${result.read.address}` : "", result.fill.phone && result.read.phone ? `${t("wz.hotels.phone")}: ${result.read.phone}` : ""].filter(Boolean)
    : [];

  return (
    <div className="mt-3 grid gap-2 animate-in fade-in slide-in-from-top-1">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder={t("wz.hotels.number")}
          aria-label={t("wz.hotels.number")}
          dir="ltr"
          className={`${wzField} tv-tnum sm:flex-1`}
        />
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <button type="button" disabled={pending} onClick={() => pdf.current?.click()} className={tool}>
            <FileText className="size-3.5" />
            {t("wz.hotels.pdf")}
          </button>
          <button type="button" disabled={pending || !readsImages} title={readsImages ? undefined : t("wz.paper.noImages")} onClick={() => photo.current?.click()} className={tool}>
            <Camera className="size-3.5" />
            {t("wz.hotels.photo")}
          </button>
          <button type="button" disabled={pending} aria-pressed={text !== null} onClick={() => setText(text === null ? "" : null)} className={tool}>
            <Type className="size-3.5" />
            {t("wz.hotels.text")}
          </button>
        </div>
        <input ref={pdf} type="file" accept="application/pdf,.pdf" hidden onChange={pick} />
        <input ref={photo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
      </div>

      {text !== null ? (
        <div className="grid gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
            rows={4}
            dir="auto"
            autoFocus
            placeholder={t("wz.hotels.paste")}
            className="block w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-[#0f3d38] outline-none focus:border-[#2aa87a]"
          />
          <div>
            <button type="button" disabled={pending || text.trim().length <= 10} onClick={() => read(null, text)} className={wzSecondary}>
              {t("wz.hotels.read")}
            </button>
          </div>
        </div>
      ) : null}

      {pending && doing === "read" ? (
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
          <Loader2 className="size-3.5 animate-spin" />
          {t("wz.flights.reading")}
        </p>
      ) : null}

      {result && result.diffs.length > 0 ? (
        <p className="flex items-start gap-1.5 text-[11.5px] font-bold text-[#a86a10]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">
            {t("wz.hotels.diffs")}:{" "}
            {result.diffs.map((d, i) => (
              <span key={i}>
                {i > 0 ? " · " : ""}
                {t(`wz.hotels.diff.${d.key}` as TranslationKey)} <DirText dir="auto">{d.theirs}</DirText>
              </span>
            ))}
          </span>
        </p>
      ) : null}
      {fills.length > 0 ? (
        <p className="break-words text-[11px] font-semibold text-[#93aaa3]">
          {t("wz.hotels.fill")} <DirText dir="auto">{fills.join(" · ")}</DirText>
        </p>
      ) : null}
      {error ? <p className="text-[12px] font-bold text-[#c22850]">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !number.trim()} onClick={save} className={wzPrimary}>
          {pending && doing === "save" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {t("save")}
        </button>
        {onCancel ? (
          <button type="button" disabled={pending} onClick={onCancel} className={wzSecondary}>
            {t("cancel")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
