"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ClipboardType,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plane,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { FlightCardDocument } from "@/components/offer-doc/FlightCardDocument";
import type { TranslationKey } from "@/lib/i18n";
import { readFlightTicket, type FlightCardLookups, type TicketReadHow } from "@/lib/data/flight-card";
import {
  MAX_TICKET_BYTES,
  REFUND_STATUSES,
  emptyLeg,
  enrichTicket,
  type LegOrder,
  type ParsedTicket,
  type RefundStatus,
  type TicketLeg,
} from "@/lib/flights/ticket-parse";
import { parseFlightNumber } from "@/lib/offer/flight-number";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { addButtonClass, fieldClass, labelClass, removeButtonClass, sectionClass } from "./stage-props";

const SOURCES = [
  { key: "text", labelKey: "fc.src.text", hintKey: "fc.src.textHint", icon: ClipboardType, accept: "" },
  { key: "image", labelKey: "fc.src.image", hintKey: "fc.src.imageHint", icon: ImageIcon, accept: "image/png,image/jpeg,image/webp" },
  { key: "pdf", labelKey: "fc.src.pdf", hintKey: "fc.src.pdfHint", icon: FileText, accept: "application/pdf,.pdf" },
] as const;
type SourceKey = (typeof SOURCES)[number]["key"];

const HOW_LABEL: Record<TicketReadHow, TranslationKey> = {
  text: "fc.how.text",
  pdf: "fc.how.pdf",
  ocr: "fc.how.ocr",
  vision: "fc.how.vision",
};

const ORDERS: { value: LegOrder | ""; labelKey: TranslationKey }[] = [
  { value: "", labelKey: "fc.order.none" },
  { value: "outbound", labelKey: "fc.order.outbound" },
  { value: "inbound", labelKey: "fc.order.inbound" },
  { value: "internal", labelKey: "fc.order.internal" },
];

const blankTicket = (): ParsedTicket => ({ pnr: "", passengers: [""], legs: [emptyLeg()] });

/**
 * /repackage/flight-card — attach a ticket, confirm what was read, download the
 * card in our identity. The card is drawn ONLY from this form: whatever the
 * parser or the model read lands here first, and the employee corrects it.
 */
export function FlightCardTool({ lookups }: { lookups: FlightCardLookups }) {
  const { t } = useTraveliunUI();
  const [kind, setKind] = useState<SourceKey>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<{ how: TicketReadHow; ai: boolean } | null>(null);
  const [ticket, setTicket] = useState<ParsedTicket | null>(null);
  const [busy, setBusy] = useState<"pdf" | "png" | null>(null);

  const airportName = useMemo(() => new Map(lookups.airports.map((a) => [a.code, a.name])), [lookups.airports]);
  const airlineName = useMemo(() => new Map(lookups.airlines.map((a) => [a.iata, a.name])), [lookups.airlines]);
  const logos = useMemo(
    () => Object.fromEntries(lookups.airlines.filter((a) => a.logo_url).map((a) => [a.iata, a.logo_url as string])),
    [lookups.airlines],
  );

  const ready = kind === "text" ? text.trim().length > 20 : file !== null;
  const cleaned = ticket ? { ...ticket, passengers: ticket.passengers.map((p) => p.trim()).filter(Boolean) } : null;
  const incomplete = !cleaned || cleaned.legs.length === 0 || cleaned.legs.some((l) => !l.from_iata || !l.to_iata || !l.dep_date);

  async function onRead() {
    if (!ready || reading) return;
    if (file && file.size > MAX_TICKET_BYTES) {
      setError(t("fc.err.tooLarge"));
      return;
    }
    setReading(true);
    setError(null);
    try {
      const fd = new FormData();
      if (kind === "text") fd.append("text", text);
      else if (file) fd.append("file", file);
      const res = await readFlightTicket(fd);
      if (!res.ok) {
        setError(t(res.error));
        return;
      }
      const enriched = enrichTicket(res.ticket, lookups.airports, lookups.airlines);
      setTicket({ ...enriched, passengers: enriched.passengers.length ? enriched.passengers : [""] });
      setRead({ how: res.how, ai: res.ai });
    } catch {
      setError(t("fc.err.unreadable"));
    } finally {
      setReading(false);
    }
  }

  function setLeg(index: number, patch: Partial<TicketLeg>) {
    setTicket((cur) => (cur ? { ...cur, legs: cur.legs.map((l, i) => (i === index ? { ...l, ...patch } : l)) } : cur));
  }

  /** A code typed by hand names itself, the way a read ticket does. */
  function setCode(index: number, end: "from" | "to", value: string) {
    const code = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    const name = airportName.get(code);
    setLeg(index, end === "from" ? { from_iata: code, ...(name ? { from_name: name } : {}) } : { to_iata: code, ...(name ? { to_name: name } : {}) });
  }

  function setFlightNo(index: number, value: string) {
    const flight_no = value.toUpperCase().replace(/\s+/g, "").slice(0, 8);
    const parsed = parseFlightNumber(flight_no);
    const iata = parsed?.kind === "iata" ? parsed.carrier : "";
    const name = iata ? airlineName.get(iata) : undefined;
    setLeg(index, { flight_no, ...(iata ? { airline_iata: iata } : {}), ...(name ? { airline: name } : {}) });
  }

  async function download(format: "pdf" | "png") {
    if (!cleaned || incomplete || busy) return;
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(`/repackage/flight-card/render${format === "png" ? "?format=png" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cleaned),
      });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `flight-card-${cleaned.pnr || "traveliun"}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t("fc.err.render"));
    } finally {
      setBusy(null);
    }
  }

  const source = SOURCES.find((s) => s.key === kind)!;

  return (
    <TraveliunShell title="fc.title">
      <div className="tv-fade-up space-y-4">
        <section className="rounded-2xl border border-[#e2ebe7] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <Link href="/repackage" className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-[#557d78] hover:text-[#185045]">
            <ArrowRight className="size-3.5" />
            {t("nav.repackage")}
          </Link>
          <h1 className="text-lg font-extrabold text-[#003c3a]">{t("fc.title")}</h1>
          <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">{t("fc.subtitle")}</p>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-4">
            <section className={`${sectionClass} space-y-3`}>
              <div className="flex flex-wrap gap-1.5">
                {SOURCES.map((s) => {
                  const Icon = s.icon;
                  const active = kind === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      disabled={reading}
                      onClick={() => {
                        setKind(s.key);
                        setFile(null);
                        setError(null);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12.5px] font-bold transition-colors ${
                        active ? "border-[#185045] bg-[#185045] text-white" : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
                      }`}
                    >
                      <Icon className="size-4" />
                      {t(s.labelKey)}
                    </button>
                  );
                })}
              </div>
              <p className="text-[12px] text-tv-text-faint">{t(source.hintKey)}</p>

              {kind === "text" ? (
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={reading}
                  rows={8}
                  dir="auto"
                  aria-label={t("fc.src.text")}
                  placeholder={t("fc.src.textPlaceholder")}
                  className="block w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
                />
              ) : (
                <input
                  // a new node per source, so the browser forgets the other kind's file
                  key={`src-${kind}`}
                  type="file"
                  accept={source.accept}
                  aria-label={t(source.labelKey)}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={reading}
                  className="block w-full cursor-pointer rounded-[10px] border border-dashed border-[#b7d0c7] bg-[#f8fbfa] px-3 py-3 text-sm text-[#185045] file:me-3 file:rounded-md file:border-0 file:bg-[#185045] file:px-3 file:py-1.5 file:text-white"
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onRead()}
                  disabled={!ready || reading}
                  className="tv-btn-primary inline-flex h-11 items-center gap-2 rounded-[10px] px-5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {reading ? t("fc.reading") : t("fc.read")}
                </button>
                {!ticket ? (
                  <button type="button" onClick={() => setTicket(blankTicket())} className={addButtonClass}>
                    {t("fc.manual")}
                  </button>
                ) : null}
              </div>
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-tv-text-faint">
                <ShieldCheck className="size-3.5" />
                {t("fc.privacy")}
              </p>
            </section>

            {error ? (
              <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">
                {error}
              </p>
            ) : null}

            {ticket ? (
              <section className={`${sectionClass} space-y-5`}>
                <div>
                  <h2 className="text-base font-extrabold text-[#003c3a]">{t("fc.booking")}</h2>
                  {read ? (
                    <p className="mt-1 text-[12px] font-semibold text-[#0f7a52]">
                      {t(HOW_LABEL[read.how])}
                      {read.ai ? ` · ${t("fc.how.ai")}` : ""}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[12px] text-[#557d78]">{t("fc.review")}</p>
                </div>

                <label className={labelClass}>
                  {t("fc.pnr")}
                  <input
                    className={fieldClass}
                    dir="ltr"
                    value={ticket.pnr}
                    onChange={(e) => setTicket({ ...ticket, pnr: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) })}
                  />
                </label>

                <label className={labelClass}>
                  {t("fc.refund")}
                  <select
                    className={fieldClass}
                    value={ticket.refund ?? ""}
                    onChange={(e) => setTicket({ ...ticket, refund: e.target.value as RefundStatus | "" })}
                  >
                    <option value="">{t("fc.refund.unset")}</option>
                    {REFUND_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`fc.refund.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {ticket.refund === "partial" || ticket.refund_note ? (
                  <label className={labelClass}>
                    {t("fc.refundNote")}
                    <input
                      className={fieldClass}
                      dir="auto"
                      placeholder={t("fc.refundNote.hint")}
                      value={ticket.refund_note ?? ""}
                      onChange={(e) => setTicket({ ...ticket, refund_note: e.target.value.slice(0, 120) })}
                    />
                  </label>
                ) : null}

                <fieldset className="space-y-2">
                  <legend className="mb-2 text-[13px] font-bold text-[#185045]">{t("fc.passengers")}</legend>
                  {ticket.passengers.map((name, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className={fieldClass}
                        dir="auto"
                        aria-label={t("fc.passenger")}
                        placeholder={t("fc.passenger")}
                        value={name}
                        onChange={(e) =>
                          setTicket({ ...ticket, passengers: ticket.passengers.map((p, j) => (j === i ? e.target.value.slice(0, 80) : p)) })
                        }
                      />
                      <button
                        type="button"
                        aria-label={t("fc.remove")}
                        onClick={() => setTicket({ ...ticket, passengers: ticket.passengers.filter((_, j) => j !== i) })}
                        className={removeButtonClass}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setTicket({ ...ticket, passengers: [...ticket.passengers, ""] })} className={addButtonClass}>
                    <Plus className="size-4" />
                    {t("fc.addPassenger")}
                  </button>
                </fieldset>

                <div className="space-y-3">
                  <h3 className="text-[13px] font-bold text-[#185045]">{t("fc.legs")}</h3>
                  {ticket.legs.map((leg, i) => (
                    <LegEditor
                      key={i}
                      index={i}
                      leg={leg}
                      onPatch={(patch) => setLeg(i, patch)}
                      onCode={(end, value) => setCode(i, end, value)}
                      onFlightNo={(value) => setFlightNo(i, value)}
                      onRemove={() => setTicket({ ...ticket, legs: ticket.legs.filter((_, j) => j !== i) })}
                    />
                  ))}
                  <button type="button" onClick={() => setTicket({ ...ticket, legs: [...ticket.legs, emptyLeg()] })} className={addButtonClass}>
                    <Plus className="size-4" />
                    {t("fc.addLeg")}
                  </button>
                </div>
              </section>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
            <section className={`${sectionClass} space-y-3`}>
              <h2 className="flex items-center gap-2 text-base font-extrabold text-[#003c3a]">
                <Plane className="size-4" />
                {t("fc.preview")}
              </h2>
              {cleaned && cleaned.legs.length > 0 ? (
                <div className="overflow-hidden rounded-[10px] border border-[#e2ebe7]">
                  <div className="[zoom:0.42] sm:[zoom:0.5]">
                    <FlightCardDocument ticket={cleaned} logos={logos} />
                  </div>
                </div>
              ) : (
                <p className="rounded-[10px] border border-dashed border-[#d7e4e0] px-4 py-10 text-center text-[12.5px] text-tv-text-faint">
                  {t("fc.previewEmpty")}
                </p>
              )}
              {ticket && incomplete ? <p className="text-[12px] font-semibold text-[#9a6a12]">{t("fc.incomplete")}</p> : null}
              <div className="grid grid-cols-2 gap-2">
                {(["pdf", "png"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => void download(format)}
                    disabled={incomplete || busy !== null}
                    className={`inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      format === "pdf" ? "bg-[#185045] text-white hover:bg-[#0f4439]" : "border border-[#185045] text-[#185045] hover:bg-[#f0f7f4]"
                    }`}
                  >
                    {busy === format ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {busy === format ? t("fc.downloading") : t(format === "pdf" ? "fc.downloadPdf" : "fc.downloadImage")}
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </TraveliunShell>
  );
}

function LegEditor({
  index,
  leg,
  onPatch,
  onCode,
  onFlightNo,
  onRemove,
}: {
  index: number;
  leg: TicketLeg;
  onPatch: (patch: Partial<TicketLeg>) => void;
  onCode: (end: "from" | "to", value: string) => void;
  onFlightNo: (value: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTraveliunUI();
  /** an empty required box is outlined, so the eye finds what the read missed */
  const need = (value: string) => (value ? fieldClass : `${fieldClass} border-[#e7b65a] bg-[#fffaf0]`);
  return (
    <div className="space-y-3 rounded-[12px] border border-[#e2ebe7] bg-[#fbfdfc] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-extrabold text-[#185045]">{t("fc.leg", { n: index + 1 })}</span>
        <button type="button" onClick={onRemove} className={removeButtonClass}>
          <Trash2 className="me-1 size-3.5" />
          {t("fc.remove")}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          {t("fc.flightNo")}
          <input className={need(leg.flight_no)} dir="ltr" value={leg.flight_no} onChange={(e) => onFlightNo(e.target.value)} />
        </label>
        <label className={labelClass}>
          {t("fc.airline")}
          <input className={fieldClass} dir="auto" value={leg.airline} onChange={(e) => onPatch({ airline: e.target.value.slice(0, 60) })} />
        </label>
        <label className={labelClass}>
          {t("fc.from")}
          <input className={need(leg.from_iata)} dir="ltr" value={leg.from_iata} onChange={(e) => onCode("from", e.target.value)} />
        </label>
        <label className={labelClass}>
          {t("fc.to")}
          <input className={need(leg.to_iata)} dir="ltr" value={leg.to_iata} onChange={(e) => onCode("to", e.target.value)} />
        </label>
        <label className={labelClass}>
          {t("fc.fromName")}
          <input className={fieldClass} dir="auto" value={leg.from_name} onChange={(e) => onPatch({ from_name: e.target.value.slice(0, 60) })} />
        </label>
        <label className={labelClass}>
          {t("fc.toName")}
          <input className={fieldClass} dir="auto" value={leg.to_name} onChange={(e) => onPatch({ to_name: e.target.value.slice(0, 60) })} />
        </label>
        <label className={labelClass}>
          {t("fc.depDate")}
          <input type="date" className={need(leg.dep_date)} value={leg.dep_date} onChange={(e) => onPatch({ dep_date: e.target.value })} />
        </label>
        <label className={labelClass}>
          {t("fc.depTime")}
          <input type="time" className={need(leg.dep_time)} value={leg.dep_time} onChange={(e) => onPatch({ dep_time: e.target.value })} />
        </label>
        <label className={labelClass}>
          {t("fc.arrDate")}
          <input type="date" className={fieldClass} value={leg.arr_date} onChange={(e) => onPatch({ arr_date: e.target.value })} />
        </label>
        <label className={labelClass}>
          {t("fc.arrTime")}
          <input type="time" className={need(leg.arr_time)} value={leg.arr_time} onChange={(e) => onPatch({ arr_time: e.target.value })} />
        </label>
        <label className={labelClass}>
          {t("fc.cabin")}
          <input className={fieldClass} dir="auto" value={leg.cabin} onChange={(e) => onPatch({ cabin: e.target.value.slice(0, 30) })} />
        </label>
        <label className={labelClass}>
          {t("fc.baggage")}
          <input className={fieldClass} dir="auto" value={leg.baggage} onChange={(e) => onPatch({ baggage: e.target.value.slice(0, 40) })} />
        </label>
        <label className={labelClass}>
          {t("fc.legOrder")}
          <select
            className={fieldClass}
            value={leg.leg_order ?? ""}
            onChange={(e) => onPatch({ leg_order: (e.target.value || null) as LegOrder | null })}
          >
            {ORDERS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
