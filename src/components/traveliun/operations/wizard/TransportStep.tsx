"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Car, Check, CheckCircle2, Copy, ExternalLink, Loader2, Mail, MapPin, Paperclip, Send, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { RequestDraft } from "@/lib/data/operation-assign";
import { updateBooking } from "@/lib/data/operation-bookings";
import { getSupplierConfirmationUrl } from "@/lib/data/supplier-work";
import {
  assignCitySupplier,
  attachCityConfirmation,
  confirmCity,
  confirmCityWithoutSupplier,
  draftCityRequest,
  sendCityRequest,
  setTripsDriver,
  transportSuppliers,
  type TransportSetup,
} from "@/lib/data/wizard-transport";
import { carText, timeKey, waNumber } from "@/lib/operations/drivers";
import { LATER } from "@/lib/operations/seed-plan";
import { hoursSince } from "@/lib/operations/supplier-request";
import {
  driverDiffers,
  driverTargets,
  requestTrips,
  tourClashes,
  transportCities,
  type Driver,
  type TourClash,
  type TransportCity,
  type TransportTrip,
} from "@/lib/operations/wizard/transport";
import { notPulled } from "@/lib/operations/wizard/pull";
import type { StepProps } from "@/lib/operations/wizard/types";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";
import { DriverSend } from "../DriversPanel";
import { PullNotice } from "./FlightsStep";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "tv-field h-10 w-full rounded-[10px] border px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
const label = "grid gap-1.5 text-[11.5px] font-bold text-[#185045]";
const primary =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-45";
const secondary =
  "inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

type Result = { ok: true } | { ok: false; error: TranslationKey };

/**
 * «المواصلات» — one card per city: its trips, its one supplier (the city's
 * usual agent offered first), one request, one confirmation, one driver.
 * Every button runs one action over the city's bookings (wizard-transport.ts);
 * the page then reloads the case, and the card reads the bookings again.
 */
export function TransportStep({ data }: StepProps) {
  const { t } = useTraveliunUI();
  const cities = transportCities(data);
  const clashes = tourClashes(data.bookings);
  const operationId = data.operation.id;
  const names = cities.map((c) => c.name).join("|");
  const [setup, setSetup] = useState<TransportSetup | null>(null);
  // a finished city reopened by «تعديل»
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!names) return;
    let live = true;
    transportSuppliers(operationId, names.split("|"))
      .then((s) => live && setSetup(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [operationId, names]);

  if (cities.length === 0) {
    // the offer has drives or tours the case does not hold yet — pull them, never «لا ينطبق»
    if (notPulled(data, "transport")) return <PullNotice operationId={operationId} />;
    return <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-tv-text-faint">{t("wz.transport.none")}</p>;
  }
  // the server's clock, as the supplier panel reads it — the same hours on both renders (no work, no request to time)
  const now = new Date(data.supplierWork?.now ?? 0);
  // the trips whose supplier's paper is on file (one paper is filed on every trip it covers)
  const filed = new Set((data.supplierWork?.bookings ?? []).filter((b) => b.has_confirmation).map((b) => b.booking_id));
  // like the hotels (the owner, 2026-10-29: «نفس فكرة صفوف الفنادق التي تُطوى عند الحفظ»): a finished
  // city folds to one green line, the first one still open is the only one unfolded
  const done = (c: TransportCity) => c.supplied && c.confirmed;
  const openKey = picked ?? cities.find((c) => !done(c))?.key ?? null;
  return (
    <section className="space-y-2">
      <p className="text-[12px] font-semibold text-[#557d78]">{t("wz.transport.hint")}</p>
      {cities.map((c) =>
        c.key === openKey ? (
          <CityCard
            key={c.key || "-"}
            city={c}
            clashes={clashes}
            operationId={operationId}
            setup={setup}
            now={now}
            filedId={c.trips.find((x) => filed.has(x.booking.id))?.booking.id ?? null}
            onClose={done(c) ? () => setPicked(null) : undefined}
          />
        ) : (
          <FoldedCity key={c.key || "-"} city={c} done={done(c)} supplierLabel={supplierLabel(c, setup)} onOpen={() => setPicked(c.key)} />
        ),
      )}
    </section>
  );
}

/** The supplier's name as the folded line says it — or «بدون مورد». */
function supplierLabel(c: TransportCity, setup: TransportSetup | null): string | null {
  if (c.noSupplier) return null;
  return setup?.suppliers.find((s) => s.id === c.supplierId)?.label ?? c.trips.find((x) => x.booking.assignee_supplier_id === c.supplierId)?.booking.assignee_label ?? null;
}

/**
 * A city not being worked: finished → one green line (who runs it, its
 * reference, how many trips) with «تعديل»; still open → one quiet line saying
 * what it lacks. A press unfolds it.
 */
function FoldedCity({ city, done, supplierLabel, onOpen }: { city: TransportCity; done: boolean; supplierLabel: string | null; onOpen: () => void }) {
  const { t } = useTraveliunUI();
  const ref = city.trips.find((x) => x.booking.confirmation_number)?.booking.confirmation_number ?? null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border px-3 py-2.5 text-start ${
        done ? "border-[#cfe9dc] bg-[#f3faf6]" : "border-[#e2ebe7] bg-white hover:bg-[#f8fbf9]"
      }`}
    >
      {done ? <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" /> : <MapPin className="size-4 shrink-0 text-tv-text-faint" />}
      <span className="text-[13px] font-extrabold text-[#0f3d38]">{city.name || t("wz.transport.noCity")}</span>
      <span className="text-[11.5px] font-semibold text-tv-text-faint">{t("wz.transport.trips", { n: String(city.trips.length) })}</span>
      {done ? (
        <span className="text-[11.5px] font-bold text-[#0f7a52]">
          {city.noSupplier ? t("wz.transport.noSupplierDone") : (supplierLabel ?? "")}
          {ref && !city.noSupplier ? <DirText dir="ltr" className="tv-tnum ms-1.5">{ref}</DirText> : null}
        </span>
      ) : (
        <span className="text-[11.5px] font-bold text-[#a86a10]">{t(city.supplied ? "wz.transport.lacksConfirm" : "wz.transport.lacksSupplier")}</span>
      )}
      <span className="ms-auto text-[11px] font-bold text-[#557d78] underline">{t(done ? "edit" : "wz.transport.open")}</span>
    </button>
  );
}

function CityCard({
  city,
  clashes,
  operationId,
  setup,
  now,
  filedId,
  onClose,
}: {
  city: TransportCity;
  /** the tours whose time fights their flight (transport.ts tourClashes). */
  clashes: Map<string, TourClash>;
  operationId: string;
  setup: TransportSetup | null;
  now: Date;
  /** a trip of the city with the supplier's paper on file — what «فتح الورقة» opens. */
  filedId: string | null;
  /** a finished city reopened for an edit folds back unchanged */
  onClose?: () => void;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const ids = city.trips.map((x) => x.booking.id);
  const asked = requestTrips(city);

  // the supplier: what the trips already have, else the city's usual agent — saved only on «اعتمد»
  const usual = setup?.usual[city.key] ?? null;
  const [pick, setPick] = useState("");
  const chosen = pick || city.supplierId || usual || "";
  const current = city.trips.find((x) => x.booking.assignee_supplier_id === city.supplierId)?.booking.assignee_label;
  const options = [
    ...(setup?.suppliers ?? []),
    // a supplier the picker does not list (not marked for transfers) still shows as the current one
    ...(city.supplierId && !setup?.suppliers.some((s) => s.id === city.supplierId) ? [{ id: city.supplierId, label: current ?? "—" }] : []),
  ];
  const mixed = new Set(city.trips.map((x) => x.booking.assignee_supplier_id ?? "")).size > 1;

  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const [number, setNumber] = useState("");
  const [paper, setPaper] = useState<File | null>(null);
  // remounts the file input once its paper is filed
  const [paperKey, setPaperKey] = useState(0);
  const [driver, setDriver] = useState<Driver | null>(null);
  // «بأقل الإدخالات» (the owner, 2026-10-26): a city with no driver yet offers the one
  // the office last used there — shown in the fields, saved only when the clerk presses save
  const remembered = !city.driver.name && !city.driver.phone ? (setup?.usualDriver[city.key] ?? null) : null;
  const drv = driver ?? (remembered ?? city.driver);
  const targets = driverTargets(city);
  // worth saving: a new name or number, or the city's driver not yet on one of its trips
  const driverChanged = drv.name !== city.driver.name || drv.phone !== city.driver.phone;
  const driverMissing = Boolean(drv.name || drv.phone) && city.trips.some((x) => !x.driver.name && !x.driver.phone);

  const act = (fn: () => Promise<Result>, after?: () => void) =>
    run(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(t(res.error));
      else {
        after?.();
        router.refresh();
      }
    });

  function prepare() {
    if (!asked) return;
    run(async () => {
      setError(null);
      const res = await draftCityRequest({ operation_id: operationId, booking_ids: asked.ids });
      if (!res.ok) setError(t(res.error));
      else {
        setDraft(res.draft);
        setBody(res.draft.body);
      }
    });
  }

  // the paper, with the number typed above if any — the server reads it off the paper otherwise
  function attachPaper() {
    if (!paper) return;
    const fd = new FormData();
    fd.set("operation_id", operationId);
    fd.set("booking_ids", ids.join(","));
    fd.set("confirmation_number", number);
    fd.set("file", paper);
    act(
      () => attachCityConfirmation(fd),
      () => {
        setPaper(null);
        setPaperKey((k) => k + 1);
        setNumber("");
      },
    );
  }

  function openPaper() {
    if (!filedId) return;
    run(async () => {
      const res = await getSupplierConfirmationUrl(filedId);
      if (res.ok) window.open(res.url, "_blank", "noopener");
      else setError(t(res.error));
    });
  }

  const send = (channel: "whatsapp" | "manual") =>
    draft &&
    asked &&
    act(
      () => sendCityRequest({ operation_id: operationId, booking_ids: asked.ids, channel, to_label: draft.to_label, to_phone: draft.to_phone, body }),
      () => setDraft(null),
    );

  return (
    <article className={card}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[14px] font-extrabold text-[#0f3d38]">
          <MapPin className="size-4 text-[#2aa87a]" />
          {city.name || t("wz.transport.noCity")}
        </h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            city.request === "confirmed"
              ? "bg-[#e1f3e9] text-[#0f7a52]"
              : city.request === "sent"
                ? "bg-[#eaf1ff] text-[#2b57c4]"
                : "bg-[#fff4e0] text-[#a86a10]"
          }`}
        >
          {t(`ops.sup.state.${city.request}` as TranslationKey, { h: String(city.sentAt ? hoursSince(city.sentAt, now) : 0) })}
        </span>
        {onClose ? (
          <button type="button" onClick={onClose} className="text-[11.5px] font-bold text-[#557d78] underline">
            {t("wz.transport.fold")}
          </button>
        ) : null}
      </header>

      <ul className="mt-3 space-y-1.5">
        {city.trips.map((trip) => (
          <TripRow key={trip.booking.id} trip={trip} city={city} clash={clashes.get(trip.booking.id) ?? null} operationId={operationId} />
        ))}
      </ul>

      {/* the supplier */}
      <div className="mt-3 grid gap-2 border-t border-[#f0f4f2] pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className={label}>
          {t("wz.transport.supplier")}
          <select value={chosen} onChange={(e) => setPick(e.target.value)} disabled={pending} className={field}>
            <option value="" disabled>
              {t("wz.transport.pick")}
            </option>
            {options.map((s) => (
              <option key={s.id ?? ""} value={s.id ?? ""}>
                {s.label}
                {s.id === usual ? ` — ${t("wz.transport.usual")}` : ""}
              </option>
            ))}
          </select>
        </label>
        {chosen && (chosen !== city.supplierId || !city.supplied) ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => assignCitySupplier({ operation_id: operationId, booking_ids: ids, supplier_id: chosen }), () => setPick(""))}
            className={primary}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t("wz.transport.assign")}
          </button>
        ) : null}
        {mixed ? <p className="text-[11px] font-semibold text-[#a86a10] sm:col-span-2">{t("wz.transport.mixed")}</p> : null}
        {/* «بدون مورد» (the owner, 2026-10-29): no supplier and maybe no driver yet — the city is done in one press */}
        {city.confirmed && city.noSupplier ? (
          <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#0f7a52] sm:col-span-2">
            <CheckCircle2 className="size-3.5" />
            {t("wz.transport.noSupplierDone")}
          </p>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => confirmCityWithoutSupplier({ operation_id: operationId, booking_ids: ids }), () => setPick(""))}
            className={`${secondary} justify-self-start sm:col-span-2`}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t("wz.transport.noSupplier")}
          </button>
        )}
      </div>

      {/* one request, one confirmation */}
      {!city.confirmed ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <button type="button" disabled={pending || !asked} onClick={() => (draft ? setDraft(null) : prepare())} className={primary}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {t("wz.transport.request")}
          </button>
          <label className={`${label} min-w-[10rem] flex-1`}>
            {t("wz.transport.confirmNo")}
            <input value={number} onChange={(e) => setNumber(e.target.value)} dir="ltr" className={field} />
          </label>
          <button
            type="button"
            disabled={pending || !number.trim()}
            onClick={() => act(() => confirmCity({ operation_id: operationId, booking_ids: ids, confirmation_number: number }), () => setNumber(""))}
            className={primary}
          >
            <CheckCircle2 className="size-3.5" />
            {t("wz.transport.confirmAll")}
          </button>
        </div>
      ) : null}

      {/* the supplier's confirmation — one paper for every trip of the city */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className={`${label} min-w-[12rem] flex-1`}>
          {t("wz.transport.paper")}
          <input
            key={paperKey}
            type="file"
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
            disabled={pending}
            onChange={(e) => setPaper(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] text-[#185045] file:me-3 file:rounded-md file:border-0 file:bg-[#185045] file:px-3 file:py-1 file:text-white"
          />
        </label>
        <button type="button" disabled={pending || !paper} onClick={attachPaper} className={secondary}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
          {t("wz.transport.paperAttach")}
        </button>
        {filedId ? (
          <button type="button" disabled={pending} onClick={openPaper} className={secondary}>
            <ExternalLink className="size-3.5" />
            {t("wz.transport.paperOpen")}
          </button>
        ) : null}
        <p className="w-full text-[11px] font-semibold text-tv-text-faint">{t(city.confirmed ? "wz.transport.paperHintDone" : "wz.transport.paperHint")}</p>
      </div>

      {draft ? (
        <div className="mt-3 rounded-[9px] border border-[#d6eadf] bg-[#f8fbf9] p-3">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#0f7a52]">
            {draft.to_label}
            {draft.to_phone ? <DirText dir="ltr" className="font-semibold text-tv-text-faint">{draft.to_phone}</DirText> : null}
          </p>
          <p className="mb-2 text-[11px] font-semibold text-tv-text-faint">{t("ops.request.review")}</p>
          {/* editable on purpose — what is stored is what actually went out */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !draft.canSendWhatsapp}
              title={draft.canSendWhatsapp ? undefined : t("ops.err.noConversation")}
              onClick={() => send("whatsapp")}
              className={primary}
            >
              <Send className="size-3.5" />
              {t("ops.request.sendWhatsapp")}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(body);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
              className={secondary}
            >
              <Copy className="size-3.5" />
              {copied ? t("copied") : t("ops.dispatch.copy")}
            </button>
            {draft.to_email ? (
              <a href={`mailto:${draft.to_email}?subject=${encodeURIComponent(draft.subject ?? "")}&body=${encodeURIComponent(body)}`} className={secondary}>
                <Mail className="size-3.5" />
                {t("ops.sup.email")}
              </a>
            ) : null}
            {draft.to_phone ? (
              <a href={`https://wa.me/${waNumber(draft.to_phone)}?text=${encodeURIComponent(body)}`} target="_blank" rel="noopener" className={secondary}>
                {t("ops.dispatch.openWhatsapp")}
              </a>
            ) : null}
            <button type="button" disabled={pending} onClick={() => send("manual")} className={secondary}>
              <Check className="size-3.5" />
              {t("ops.request.markSent")}
            </button>
          </div>
        </div>
      ) : null}

      {/* the driver, typed once for the city */}
      <div className="mt-3 grid gap-2 border-t border-[#f0f4f2] pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-[#185045] sm:col-span-3">
          <UserRound className="size-3.5" />
          {t("wz.transport.driver")}
          {remembered && !driver ? (
            <span className="rounded-full bg-[#eef5f2] px-2 py-0.5 text-[10.5px] font-bold text-[#2a7d66]">{t("wz.transport.driverUsual")}</span>
          ) : null}
        </p>
        <DriverFields value={drv} onChange={setDriver} />
        <button
          type="button"
          disabled={pending || targets.length === 0 || !(driverChanged || driverMissing)}
          onClick={() => act(() => setTripsDriver({ operation_id: operationId, booking_ids: targets, name: drv.name, phone: drv.phone }), () => setDriver(null))}
          className={primary}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {t("wz.transport.driverSave", { n: String(targets.length) })}
        </button>
        {/* the programme and the hotels for this city's driver — or its agent, before a driver is named */}
        <div className="flex flex-wrap items-center gap-1.5 sm:col-span-3">
          <DriverSend bookingId={city.trips[0].booking.id} onSent={() => router.refresh()} />
        </div>
      </div>

      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </article>
  );
}

function DriverFields({ value, onChange }: { value: Driver; onChange: (d: Driver) => void }) {
  const { t } = useTraveliunUI();
  return (
    <>
      <label className={label}>
        {t("ops.drv.driver")}
        <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} className={field} />
      </label>
      <label className={label}>
        {t("ops.drv.phone")}
        <input value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} dir="ltr" inputMode="tel" className={`${field} tv-tnum`} />
      </label>
    </>
  );
}

/** One trip: when, what, where to where — and its own driver only when it differs from the city's. */
function TripRow({ trip, city, clash, operationId }: { trip: TransportTrip; city: TransportCity; clash: TourClash | null; operationId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [own, setOwn] = useState<Driver | null>(null);
  const [error, setError] = useState<string | null>(null);
  const b = trip.booking;
  const differs = driverDiffers(trip, city);
  const car = carText(b.detail);

  return (
    <li className="rounded-[10px] border border-[#eef3f1] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        <DirText dir="ltr" className="tv-tnum font-bold text-[#557d78]">
          {b.start_date ?? "—"}
        </DirText>
        <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">{t(`ops.drv.kind.${trip.kind}` as TranslationKey)}</span>
        <span className="min-w-0 break-words font-extrabold text-[#0f3d38]">{b.title}</span>
        {trip.time ? (
          <DirText dir="ltr" className="tv-tnum font-bold text-[#185045]">
            {trip.time}
          </DirText>
        ) : (
          <span className="text-[11px] font-bold text-[#a86a10]">{t("ops.drv.timeLater")}</span>
        )}
        {car ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#557d78]">
            <Car className="size-3" />
            {car}
          </span>
        ) : null}
        {b.status === "confirmed" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0f7a52]">
            <CheckCircle2 className="size-3" />
            {b.confirmation_number ? <DirText dir="ltr">{b.confirmation_number}</DirText> : null}
          </span>
        ) : (
          <span className="text-[11px] font-bold text-[#a86a10]">{t("ops.drv.unconfirmed")}</span>
        )}
        {differs ? (
          <span className="rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">
            {t("wz.transport.driverDiffers")}: {[trip.driver.name, trip.driver.phone].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        {clash ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">
            <AlertTriangle className="size-3" />
            <span title={t(`wz.transport.clash.${clash}`)}>{t("wz.transport.clash")}</span>
            {/* the user's own act: the time is cleared through the usual edit, never rewritten silently */}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  setError(null);
                  const res = await updateBooking({ id: b.id, detail: { ...b.detail, [timeKey(trip.kind)]: LATER } });
                  if (!res.ok) setError(t(res.error));
                  else router.refresh();
                })
              }
              className="rounded-full border border-[#e0c58a] bg-white px-2 text-[10.5px] font-bold text-[#185045] hover:bg-[#fffaf0] disabled:opacity-60"
            >
              {LATER}
            </button>
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOwn(own ? null : trip.driver)}
          aria-expanded={own !== null}
          className="ms-auto text-[11px] font-bold text-[#2b57c4] hover:underline"
        >
          {t("wz.transport.ownDriver")}
        </button>
      </div>
      {own ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <DriverFields value={own} onChange={setOwn} />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                setError(null);
                const res = await setTripsDriver({ operation_id: operationId, booking_ids: [b.id], name: own.name, phone: own.phone });
                if (!res.ok) setError(t(res.error));
                else {
                  setOwn(null);
                  router.refresh();
                }
              })
            }
            className={primary}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t("save")}
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </li>
  );
}
