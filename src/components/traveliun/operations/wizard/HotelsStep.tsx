"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, BedDouble, CheckCircle2, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { deleteBooking, type OperationBooking } from "@/lib/data/operation-bookings";
import { listAssignees, type AssigneeOption } from "@/lib/data/operation-assign";
import { readHotelConfirmation, saveHotelConfirmation, type HotelRead } from "@/lib/data/wizard-tickets";
import { getSupplierConfirmationUrl } from "@/lib/data/supplier-work";
import { refreshSupplierBooking } from "@/lib/data/supplier-booking";
import { hotelBookings, hotelOverlaps, isFinal, roomLines } from "@/lib/operations/wizard/hotels";
import { notPulled } from "@/lib/operations/wizard/pull";
import type { StepProps } from "@/lib/operations/wizard/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";
import { AssignBooking } from "../AssignBooking";
import { AddBooking } from "../DocumentsPanel";
import { NameRow, PaperReader, PullNotice, wzCard, wzField, wzLabel, wzPrimary, wzSecondary } from "./FlightsStep";
import { IssueGuardNotice } from "../../IssueGuardNotice";

const HOW: Record<HotelRead["how"], TranslationKey> = { text: "fc.how.text", pdf: "fc.how.pdf", ocr: "fc.how.ocr", vision: "fc.how.vision" };

/**
 * «الفنادق» — a card per hotel booking: who books it, read its confirmation,
 * see what differs, save the final number; and «إضافة فندق» for a stay the
 * offer did not hold (a second hotel in a city, a night added).
 */
export function HotelsStep({ data }: StepProps) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const hotels = hotelBookings(data);
  const operationId = data.operation.id;
  const filed = new Set((data.supplierWork?.bookings ?? []).filter((b) => b.has_confirmation).map((b) => b.booking_id));
  const overlaps = hotelOverlaps(hotels);
  const [adding, setAdding] = useState(false);
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
          <BedDouble className="size-4" />
          {t("wz.hotels.title")}
        </h2>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding} className={wzSecondary}>
          <Plus className="size-3.5" />
          {t("wz.hotels.add")}
        </button>
      </div>
      <p className="mb-3 mt-1 text-[11.5px] font-semibold text-[#93aaa3]">{t("wz.hotels.hint")}</p>
      {/* «أكمل بيانات الفندق»: what the voucher lacks (address, phone, English name), with «أصلح» — never blocks */}
      {data.offerHotels?.length ? <IssueGuardNotice hotels={data.offerHotels} only="voucher" className="mb-3" /> : null}
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
      {hotels.length > 0 ? (
        <ul className="grid gap-3">
          {hotels.map((b) => (
            <HotelCard
              key={b.id}
              booking={b}
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
    </section>
  );
}

type Form = { number: string; address: string; phone: string };

function HotelCard({
  booking,
  hasFile,
  assignees,
  partnerId,
  overlaps,
  readsImages,
}: {
  booking: OperationBooking;
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
  const done = isFinal(booking);
  const [form, setForm] = useState<Form | null>(null);
  const [result, setResult] = useState<HotelRead | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useSafeTransition();

  function close() {
    setForm(null);
    setResult(null);
    setFile(null);
    setError(null);
  }

  function onRead(fd: FormData, paper: File | null) {
    startTransition(async () => {
      setError(null);
      fd.append("booking_id", booking.id);
      const res = await readHotelConfirmation(fd);
      if (!res.ok) return setError(t(res.error));
      setResult(res.result);
      setFile(paper);
      setForm({ number: res.result.read.confirmation, address: res.result.read.address, phone: res.result.read.phone });
    });
  }

  function save() {
    if (!form) return;
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.append("booking_id", booking.id);
      fd.append("confirmation_number", form.number);
      if (file) fd.append("file", file);
      // only what the hotel's record lacks — the server checks again and never overwrites
      if (result?.fill.address) fd.append("address", form.address);
      if (result?.fill.phone) fd.append("phone", form.phone);
      const res = await saveHotelConfirmation(fd);
      if (!res.ok) return setError(t(res.error));
      close();
      setSaved(true);
      router.refresh();
    });
  }

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

  return (
    <li className="rounded-[12px] border border-[#e2ebe7] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-extrabold text-[#0f3d38]">{booking.title}</p>
          <p className="tv-tnum mt-0.5 text-[11.5px] font-bold text-[#557d78]">
            {booking.city_name ? `${booking.city_name} · ` : ""}
            <DirText>{`${booking.start_date ?? "—"} → ${booking.end_date ?? "—"}`}</DirText>
          </p>
          {rooms.length > 0 ? <p className="mt-0.5 text-[11.5px] font-semibold text-[#557d78]">{rooms.join(" / ")}</p> : null}
          <p className="mt-0.5 text-[11px] font-semibold text-[#93aaa3]">
            {t("wz.hotels.ourRef")}: <DirText>{booking.company_ref ?? "—"}</DirText>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${done ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fff4e0] text-[#a86a10]"}`}>
            {done ? t("wz.hotels.final") : t("wz.hotels.waiting")}
          </span>
          {held ? null : (
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              aria-label={t("delete")}
              className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {overlaps.length > 0 ? (
        <div className="mt-2 grid gap-0.5 rounded-[10px] border border-[#f1dfb8] bg-[#fff8ea] px-3 py-2 text-[11.5px] font-semibold text-[#7a4e0c]">
          <p className="flex items-center gap-1.5 font-bold text-[#a86a10]">
            <AlertTriangle className="size-3.5" />
            {t("wz.hotels.overlap")}
          </p>
          {overlaps.map((o, i) => (
            <p key={i} className="break-words">
              {o.title} · <DirText className="tv-tnum">{`${o.start_date ?? "—"} → ${o.end_date ?? "—"}`}</DirText>
            </p>
          ))}
        </div>
      ) : null}

      {/* «ينفّذه» — who books this hotel, and the request to them (as on «عرض الكل») */}
      <AssignBooking booking={booking} operationId={booking.operation_id} assignees={assignees} partnerId={partnerId} onDone={() => undefined} />

      {done && !form ? (
        <div className="mt-2 grid gap-1.5 text-[12px] font-semibold text-[#185045]">
          <p>
            {t("wz.hotels.number")}: <DirText className="font-extrabold">{booking.confirmation_number}</DirText>
          </p>
          {saved ? <p className="font-bold text-[#0f7a52]">{t("wz.hotels.saved")}</p> : null}
          <div className="flex flex-wrap gap-2">
            {hasFile ? (
              <button type="button" disabled={pending} onClick={openFile} className={wzSecondary}>
                <ExternalLink className="size-3.5" />
                {t("wz.hotels.viewFile")}
              </button>
            ) : null}
            <button type="button" onClick={() => setForm({ number: booking.confirmation_number ?? "", address: "", phone: "" })} className={wzSecondary}>
              <Pencil className="size-3.5" />
              {t("wz.hotels.edit")}
            </button>
          </div>
        </div>
      ) : null}

      {!done && !form ? (
        <div className="mt-2 grid gap-2">
          {booking.source === "api" ? (
            <div>
              <button type="button" disabled={pending} onClick={pullFromSupplier} className={wzSecondary}>
                <RefreshCw className="size-3.5" />
                {t("wz.hotels.api")}
              </button>
            </div>
          ) : null}
          <PaperReader
            labels={{ file: "wz.hotels.file", paste: "wz.hotels.paste", read: "wz.hotels.read", manual: "wz.hotels.manual" }}
            busy={pending}
            readsImages={readsImages}
            onRead={onRead}
            onManual={() => setForm({ number: "", address: "", phone: "" })}
          />
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}

      {form ? (
        <div className="mt-3 grid gap-3">
          {result ? (
            <>
              <p className="text-[11.5px] font-semibold text-[#0f7a52]">{t(HOW[result.how])}</p>
              {result.diffs.length > 0 ? (
                <div className="grid gap-1.5 rounded-[10px] border border-[#f1dfb8] bg-[#fff8ea] p-3 text-[12px] font-semibold text-[#7a4e0c]">
                  <p className="flex items-center gap-1.5 font-bold text-[#a86a10]">
                    <AlertTriangle className="size-3.5" />
                    {t("wz.hotels.diffs")}
                  </p>
                  {result.diffs.map((d, i) => (
                    <p key={i} className="break-words">
                      <span className="font-bold">{t(`wz.hotels.diff.${d.key}` as TranslationKey)}: </span>
                      {d.ours ? (
                        <>
                          {t("wz.hotels.ours")} <DirText dir="auto">{d.ours}</DirText> · {t("wz.hotels.theirs")}{" "}
                        </>
                      ) : null}
                      <DirText dir="auto">{d.theirs}</DirText>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] font-bold text-[#0f7a52]">{t("wz.hotels.noDiffs")}</p>
              )}
              {result.names.length > 0 ? (
                <ul className="grid gap-1">
                  {result.names.map((n, i) => (
                    <NameRow key={i} check={n} />
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={wzLabel}>
              {t("wz.hotels.number")}
              <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} dir="ltr" className={`${wzField} tv-tnum`} />
            </label>
            {result?.fill.address ? (
              <label className={`${wzLabel} sm:col-span-2`}>
                {t("wz.hotels.address")}
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} dir="auto" className={wzField} />
                <span className="font-semibold text-[#93aaa3]">{t("wz.hotels.fillHint")}</span>
              </label>
            ) : null}
            {result?.fill.phone ? (
              <label className={wzLabel}>
                {t("wz.hotels.phone")}
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" className={`${wzField} tv-tnum`} />
                <span className="font-semibold text-[#93aaa3]">{t("wz.hotels.fillHint")}</span>
              </label>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || !form.number.trim()} onClick={save} className={wzPrimary}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {t("wz.hotels.save")}
            </button>
            <button type="button" disabled={pending} onClick={close} className={wzSecondary}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
