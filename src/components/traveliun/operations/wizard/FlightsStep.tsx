"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, Download, Loader2, Pencil, Plane, Plus, Sparkles, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { seedBookingsFromOffer } from "@/lib/data/operation-seed";
import { listWizardAirports } from "@/lib/data/operation-wizard";
import { readBookingTicket, saveBookingTicket, type TicketRead } from "@/lib/data/wizard-tickets";
import { MAX_TICKET_BYTES } from "@/lib/flights/ticket-parse";
import { airportDisplay, findAirport } from "@/lib/offer/basic";
import type { LookupAirport } from "@/lib/offer/draft-types";
import { flightTicketed } from "@/lib/operations/client-booking-state";
import { airportCode, flightBookings, landingDay, plannedLegs, plannedLine, type LegInput, type NameCheck } from "@/lib/operations/wizard/flights";
import { notPulled } from "@/lib/operations/wizard/pull";
import type { StepProps } from "@/lib/operations/wizard/types";
import { SuggestInput } from "../../SuggestInput";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";

export const wzCard = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
export const wzField =
  "h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]";
export const wzLabel = "grid gap-1.5 text-[11.5px] font-bold text-[#185045]";
export const wzPrimary =
  "inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-60";
export const wzSecondary =
  "inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#dbe6e1] bg-white px-3.5 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

const HOW: Record<TicketRead["how"], TranslationKey> = { text: "fc.how.text", pdf: "fc.how.pdf", ocr: "fc.how.ocr", vision: "fc.how.vision" };

/**
 * The paper first (the owner's order): a PDF or a photo, or its text pasted —
 * and «لا أملك الملف — أدخل يدوياً» to type it instead. Shared with HotelsStep.
 * `onRead` gets the form data to send and the file, which a hotel files on save.
 */
export function PaperReader({
  labels,
  busy,
  readsImages = true,
  onRead,
  onManual,
}: {
  labels: { file: TranslationKey; paste: TranslationKey; read: TranslationKey; manual: TranslationKey };
  busy: boolean;
  /** false: no OCR service and no AI key on the server — a photo or a scan cannot be read, and the screen says so up front. */
  readsImages?: boolean;
  onRead: (fd: FormData, file: File | null) => void;
  onManual: () => void;
}) {
  const { t } = useTraveliunUI();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ready = file !== null || text.trim().length > 10;

  function read() {
    if (file && file.size > MAX_TICKET_BYTES) return setError(t("fc.err.tooLarge"));
    setError(null);
    const fd = new FormData();
    if (file) fd.append("file", file);
    else fd.append("text", text);
    onRead(fd, file);
  }

  return (
    <div className="grid gap-2.5 rounded-[12px] border border-dashed border-[#b7d0c7] bg-[#f8fbfa] p-3">
      <label className={wzLabel}>
        {t(labels.file)}
        <input
          type="file"
          accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full cursor-pointer rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] text-[#185045] file:me-3 file:rounded-md file:border-0 file:bg-[#185045] file:px-3 file:py-1 file:text-white"
        />
      </label>
      {/* said before the upload, not after a failed read: what is off, why, and what still works */}
      {readsImages ? null : <p className="rounded-[9px] bg-[#fff8ea] px-3 py-2 text-[11.5px] font-semibold text-[#7a4e0c]">{t("wz.paper.noImages")}</p>}
      {file ? null : (
        <label className={wzLabel}>
          {t(labels.paste)}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            rows={4}
            dir="auto"
            className="block w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
        </label>
      )}
      {error ? <p className="text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!ready || busy} onClick={read} className={wzPrimary}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {busy ? t("wz.flights.reading") : t(labels.read)}
        </button>
        <button type="button" disabled={busy} onClick={onManual} className={wzSecondary}>
          {t(labels.manual)}
        </button>
      </div>
    </div>
  );
}

/**
 * «مطلوب — لم تُسحب الحجوزات»: the offer books this step's kind and the case
 * holds none of it (notPulled) — one press pulls what the offer has. Shared
 * with HotelsStep and TransportStep.
 */
export function PullNotice({ operationId }: { operationId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid justify-items-center gap-2 rounded-[10px] border border-[#f1dfb8] bg-[#fff8ea] px-4 py-5 text-center">
      <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#a86a10]">
        <AlertTriangle className="size-4" />
        {t("wz.pull.needed")}
      </p>
      <p className="text-[11.5px] font-semibold text-[#7a4e0c]">{t("wz.pull.hint")}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(async () => {
            setError(null);
            const res = await seedBookingsFromOffer(operationId);
            if (!res.ok) return setError(t(res.error));
            if (res.failed.length > 0) setError(t("ops.seedFailed", { list: res.failed.join("، ") }));
            router.refresh();
          })
        }
        className={wzPrimary}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {t("ops.seedFromOffer")}
      </button>
      {error ? <p className="text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}

/** A name on the paper against the passports: green, amber (check by eye), red. */
export function NameRow({ check }: { check: NameCheck }) {
  const { t } = useTraveliunUI();
  const tone =
    check.status === "ok" ? "border-[#cfe9dc] bg-[#eef8f3] text-[#0f7a52]" : check.status === "likely" ? "border-[#f1dfb8] bg-[#fff8ea] text-[#a86a10]" : "border-[#f4c9d4] bg-[#fdeef2] text-[#c22850]";
  return (
    <li className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[9px] border px-3 py-1.5 text-[12px] font-bold ${tone}`}>
      {check.status === "mismatch" ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />}
      <DirText dir="auto">{check.name}</DirText>
      {check.traveler ? <span className="font-semibold opacity-80">← {check.traveler}</span> : null}
      <span className="ms-auto text-[11px]">{t(`wz.flights.name.${check.status}` as TranslationKey)}</span>
    </li>
  );
}

type Form = { pnr: string; tickets: string; legs: LegInput[]; baggage: string };

const blankLeg = (): LegInput => ({ flight_no: "", from_iata: "", to_iata: "", dep_date: "", dep_time: "", arr_date: "", arr_time: "", pnr: "" });

/** A ticketed booking back into the form, for an edit. */
function formOf(b: OperationBooking): Form {
  return {
    pnr: b.pnr ?? "",
    tickets: (b.ticket_numbers ?? []).join("\n"),
    baggage: b.baggage ?? "",
    legs: (b.flight_legs ?? []).map((l) => ({
      flight_no: l.flight_no,
      from_iata: l.from,
      to_iata: l.to,
      dep_date: l.departs_at?.slice(0, 10) ?? "",
      dep_time: l.departs_at?.slice(11, 16) ?? "",
      arr_date: l.arrives_at?.slice(0, 10) ?? "",
      arr_time: l.arrives_at?.slice(11, 16) ?? "",
      pnr: l.pnr ?? "",
    })),
  };
}

/** «تذاكر الطيران» — a card per flight booking: read its ticket, check the names, save and confirm. */
export function FlightsStep({ data }: StepProps) {
  const { t } = useTraveliunUI();
  const flights = flightBookings(data);
  // «من» / «إلى» by city, name or code — the airports loaded once for the step
  const [airports, setAirports] = useState<LookupAirport[]>([]);
  const any = flights.length > 0;
  useEffect(() => {
    if (!any) return;
    let live = true;
    listWizardAirports()
      .then((list) => live && setAirports(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [any]);
  return (
    <section className={wzCard}>
      <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[#185045]">
        <Plane className="size-4" />
        {t("wz.flights.title")}
      </h2>
      <p className="mb-3 mt-1 text-[11.5px] font-semibold text-tv-text-faint">{t("wz.flights.hint")}</p>
      {flights.length > 0 ? (
        <ul className="grid gap-3">
          {flights.map((b) => (
            <FlightCard key={b.id} booking={b} travelers={data.travelers.length} readsImages={data.readsImages ?? true} airports={airports} />
          ))}
        </ul>
      ) : notPulled(data, "flight") ? (
        <PullNotice operationId={data.operation.id} />
      ) : (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-tv-text-faint">{t("wz.flights.none")}</p>
      )}
    </section>
  );
}

function FlightCard({
  booking,
  travelers,
  readsImages,
  airports,
}: {
  booking: OperationBooking;
  travelers: number;
  readsImages: boolean;
  airports: LookupAirport[];
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  // the one flight-done rule — a flight confirmed by hand in «عرض الكل» is done here too
  const done = flightTicketed(booking);
  // the offer's own legs — shown before the ticket, and what a form starts from (the owner, 2026-10-22)
  const planned = plannedLegs(booking.detail ?? {});
  const startLegs = () => (planned.length > 0 ? planned : [blankLeg()]);
  const place = (code: string) => {
    const a = findAirport(code, airports);
    return a?.code ? `${a.city || a.name} (${a.code})` : code;
  };
  const zoneOf = (code: string) => airports.find((a) => a.code?.toUpperCase() === code)?.timezone ?? null;
  const airportItems = airports.map((a) => ({ value: airportDisplay(a), hint: a.city ?? undefined, keywords: [a.city, a.country, a.code, a.name_en].filter(Boolean).join(" ") }));
  const [form, setForm] = useState<Form | null>(null);
  const [read, setRead] = useState<TicketRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useSafeTransition();

  function onRead(fd: FormData) {
    startTransition(async () => {
      setError(null);
      fd.append("booking_id", booking.id);
      const res = await readBookingTicket(fd);
      if (!res.ok) return setError(t(res.error));
      setRead(res.read);
      setForm({
        pnr: res.read.pnr,
        tickets: res.read.ticket_numbers.join("\n"),
        baggage: res.read.baggage,
        legs: res.read.legs.length > 0 ? res.read.legs : startLegs(),
      });
    });
  }

  function save() {
    if (!form) return;
    // a city or an airport's name is sent as its code; one we do not know is said by name, not as «أكمل كل رحلة»
    const coded = form.legs.map((l) => ({ ...l, from_iata: airportCode(l.from_iata, airports), to_iata: airportCode(l.to_iata, airports) }));
    const unknown = form.legs
      .flatMap((l, i) => [
        [l.from_iata, coded[i].from_iata],
        [l.to_iata, coded[i].to_iata],
      ])
      .find(([typed, code]) => typed.trim() && !code);
    if (unknown) return setError(t("wz.flights.err.airport", { name: unknown[0] }));
    // one PNR per leg is allowed (a domestic hop bought alone): the booking's is the one typed, else the first leg's
    const pnr = (form.pnr || coded.find((l) => l.pnr?.trim())?.pnr || "").trim().toUpperCase();
    const legs = coded.map((l) => ({ ...l, pnr: l.pnr?.trim().toUpperCase() === pnr ? "" : l.pnr }));
    startTransition(async () => {
      setError(null);
      const res = await saveBookingTicket({
        booking_id: booking.id,
        pnr,
        ticket_numbers: form.tickets.split(/\n/),
        legs,
        baggage: form.baggage,
      });
      if (!res.ok) return setError(t(res.error));
      setForm(null);
      setRead(null);
      setSaved(true);
      router.refresh();
    });
  }

  const multi = (form?.legs.length ?? 0) > 1;
  /** the airport a «من» / «إلى» resolves to (a code or a city typed), under the field — nothing when it names none or is that airport already */
  const known = (value: string) => {
    const hit = value.trim() ? findAirport(value, airports) : null;
    return hit && airportDisplay(hit) !== value.trim() ? airportDisplay(hit) : null;
  };
  /** «يصل 2026-11-29» under a landing that falls on another day than the take-off (landingDay) */
  const landsOn = (l: LegInput) => {
    if (l.arr_date || !l.dep_date || !l.dep_time || !l.arr_time) return null;
    const day = landingDay({ ...l, from_iata: airportCode(l.from_iata, airports), to_iata: airportCode(l.to_iata, airports) }, zoneOf);
    return day !== l.dep_date ? t("wz.flights.landsOn", { date: day }) : null;
  };
  const setLeg = (i: number, patch: Partial<LegInput>) => setForm((f) => (f ? { ...f, legs: f.legs.map((l, k) => (k === i ? { ...l, ...patch } : l)) } : f));
  const ticketCount = form ? form.tickets.split(/\n/).filter((s) => s.trim()).length : 0;

  return (
    <li className="rounded-[12px] border border-[#e2ebe7] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-extrabold text-[#0f3d38]">{booking.title}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-tv-text-faint">
            {t("wz.flights.ourRef")}: <DirText>{booking.company_ref ?? "—"}</DirText>
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${done ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fff4e0] text-[#a86a10]"}`}>
          {done ? t("wz.flights.ticketed") : t("wz.flights.waiting")}
        </span>
      </div>

      {done && !form ? (
        <div className="mt-2 grid gap-1.5 text-[12px] font-semibold text-[#185045]">
          <p>
            {t("wz.flights.pnr")}: <DirText className="font-extrabold">{booking.pnr || booking.confirmation_number}</DirText>
          </p>
          {booking.ticket_numbers.length > 0 ? (
            <p className="flex flex-wrap gap-x-3">
              {t("wz.flights.tickets")}:
              {booking.ticket_numbers.map((n) => (
                <DirText key={n} className="tv-tnum">{n}</DirText>
              ))}
            </p>
          ) : null}
          <ul className="grid gap-1">
            {booking.flight_legs.map((l, i) => (
              <li key={i} className="tv-tnum rounded-[8px] bg-[#f4f8f6] px-2.5 py-1">
                <DirText>{`${l.flight_no} · ${l.from} → ${l.to} · ${l.departs_at?.slice(0, 16).replace("T", " ") ?? "—"} → ${l.arrives_at?.slice(0, 16).replace("T", " ") ?? "—"}${l.pnr ? ` · PNR ${l.pnr}` : ""}`}</DirText>
              </li>
            ))}
          </ul>
          {booking.baggage ? <p>{t("wz.flights.baggage")}: {booking.baggage}</p> : null}
          {saved ? <p className="font-bold text-[#0f7a52]">{t("wz.flights.saved")}</p> : null}
          <div>
            <button type="button" onClick={() => setForm(formOf(booking))} className={wzSecondary}>
              <Pencil className="size-3.5" />
              {t("wz.flights.edit")}
            </button>
          </div>
        </div>
      ) : null}

      {!done && planned.length > 0 ? (
        <div className="mt-2 grid gap-1">
          <p className="text-[11px] font-bold text-[#557d78]">{t("wz.flights.planned")}</p>
          <ul className="grid gap-1">
            {planned.map((l, i) => (
              <li key={i} className="tv-tnum rounded-[8px] bg-[#f4f8f6] px-2.5 py-1 text-[12px] font-semibold text-[#185045]">
                <DirText>{plannedLine(l, place)}</DirText>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!done && !form ? (
        <div className="mt-2">
          <PaperReader
            labels={{ file: "wz.flights.file", paste: "wz.flights.paste", read: "wz.flights.read", manual: "wz.flights.manual" }}
            busy={pending}
            readsImages={readsImages}
            onRead={onRead}
            onManual={() => setForm({ pnr: "", tickets: "", baggage: "", legs: startLegs() })}
          />
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}

      {form ? (
        <div className="mt-3 grid gap-3">
          {read ? (
            <p className="text-[11.5px] font-semibold text-[#0f7a52]">
              {t(HOW[read.how])}
              {read.ai ? ` · ${t("fc.how.ai")}` : ""}
            </p>
          ) : null}

          {read && (read.names.length > 0 || read.missing.length > 0) ? (
            <div className="grid gap-1.5">
              <p className="text-[11.5px] font-bold text-[#185045]">{t("wz.flights.names")}</p>
              <ul className="grid gap-1">
                {read.names.map((n, i) => (
                  <NameRow key={i} check={n} />
                ))}
                {read.missing.map((name, i) => (
                  <li key={`m${i}`} className="flex items-center gap-2 rounded-[9px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-1.5 text-[12px] font-bold text-[#c22850]">
                    <AlertTriangle className="size-3.5" />
                    <DirText dir="auto">{name || t("wz.flights.unnamed")}</DirText>
                    <span className="ms-auto text-[11px]">{t("wz.flights.name.missing")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={wzLabel}>
              {t("wz.flights.pnr")}
              <input value={form.pnr} onChange={(e) => setForm({ ...form, pnr: e.target.value.toUpperCase() })} dir="ltr" className={`${wzField} tv-tnum`} />
            </label>
            <label className={wzLabel}>
              {t("wz.flights.baggage")}
              <input value={form.baggage} onChange={(e) => setForm({ ...form, baggage: e.target.value })} className={wzField} />
            </label>
            <label className={`${wzLabel} sm:col-span-2`}>
              {t("wz.flights.tickets")}
              <textarea
                value={form.tickets}
                onChange={(e) => setForm({ ...form, tickets: e.target.value })}
                rows={Math.max(2, travelers)}
                dir="ltr"
                placeholder="065-2400000001"
                className="tv-tnum block w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 text-[13px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
              />
              <span className="font-semibold text-tv-text-faint">{t("wz.flights.ticketsHint")}</span>
              {travelers > 0 && ticketCount !== travelers ? (
                <span className="font-bold text-[#a86a10]">{t("wz.flights.countWarn", { tickets: String(ticketCount), travelers: String(travelers) })}</span>
              ) : null}
            </label>
          </div>

          <div className="grid gap-2">
            <p className="text-[11.5px] font-bold text-[#185045]">{t("wz.flights.legs")}</p>
            {form.legs.map((l, i) => (
              <div
                key={i}
                className={`grid grid-cols-2 gap-2 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbf9] p-2.5 sm:grid-cols-4 ${multi ? "lg:grid-cols-9" : "lg:grid-cols-8"}`}
              >
                <Cell label={t("wz.flights.flightNo")}>
                  <input value={l.flight_no} onChange={(e) => setLeg(i, { flight_no: e.target.value.toUpperCase().replace(/\s+/g, "") })} dir="ltr" className={wzField} />
                </Cell>
                <Cell label={t("wz.flights.from")} note={known(l.from_iata)}>
                  <SuggestInput
                    value={l.from_iata}
                    items={airportItems}
                    onChange={(v) => setLeg(i, { from_iata: v })}
                    placeholder={t("wz.flights.airportHint")}
                    ariaLabel={t("wz.flights.from")}
                    className={wzField}
                  />
                </Cell>
                <Cell label={t("wz.flights.to")} note={known(l.to_iata)}>
                  <SuggestInput
                    value={l.to_iata}
                    items={airportItems}
                    onChange={(v) => setLeg(i, { to_iata: v })}
                    placeholder={t("wz.flights.airportHint")}
                    ariaLabel={t("wz.flights.to")}
                    className={wzField}
                  />
                </Cell>
                <Cell label={t("wz.flights.depDate")}>
                  <input type="date" value={l.dep_date} onChange={(e) => setLeg(i, { dep_date: e.target.value })} className={wzField} />
                </Cell>
                <Cell label={t("wz.flights.depTime")}>
                  <input type="time" value={l.dep_time} onChange={(e) => setLeg(i, { dep_time: e.target.value })} className={wzField} />
                </Cell>
                <Cell label={t("wz.flights.arrDate")}>
                  <input type="date" value={l.arr_date} onChange={(e) => setLeg(i, { arr_date: e.target.value })} className={wzField} />
                </Cell>
                <Cell label={t("wz.flights.arrTime")} note={landsOn(l)}>
                  <input type="time" value={l.arr_time} onChange={(e) => setLeg(i, { arr_time: e.target.value })} className={wzField} />
                </Cell>
                {multi ? (
                  <Cell label={t("wz.flights.legPnr")}>
                    <input
                      value={l.pnr ?? ""}
                      onChange={(e) => setLeg(i, { pnr: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                      placeholder={t("wz.flights.legPnrHint")}
                      dir="ltr"
                      className={`${wzField} tv-tnum`}
                    />
                  </Cell>
                ) : null}
                <div className="flex items-end">
                  <button
                    type="button"
                    aria-label={t("wz.flights.removeLeg")}
                    disabled={form.legs.length === 1}
                    onClick={() => setForm({ ...form, legs: form.legs.filter((_, k) => k !== i) })}
                    className="inline-flex size-10 items-center justify-center rounded-[10px] border border-[#dbe6e1] text-[#c22850] hover:bg-[#fdeef2] disabled:opacity-40"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
            <div>
              <button type="button" onClick={() => setForm({ ...form, legs: [...form.legs, blankLeg()] })} className={wzSecondary}>
                <Plus className="size-3.5" />
                {t("wz.flights.addLeg")}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={save} className={wzPrimary}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {t("wz.flights.save")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setForm(null);
                setRead(null);
                setError(null);
              }}
              className={wzSecondary}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Cell({ label, note, children }: { label: string; note?: string | null; children: ReactNode }) {
  return (
    <label className="grid content-start gap-1 text-[10.5px] font-bold text-[#557d78]">
      {label}
      {children}
      {note ? <span className="truncate text-[10px] font-semibold text-[#2aa87a]">{note}</span> : null}
    </label>
  );
}
