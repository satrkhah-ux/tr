"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Car, Check, CheckCircle2, Copy, Loader2, Mail, MapPin, Send, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { RequestDraft } from "@/lib/data/operation-assign";
import {
  assignCitySupplier,
  confirmCity,
  draftCityRequest,
  sendCityRequest,
  setTripsDriver,
  transportSuppliers,
  type TransportSetup,
} from "@/lib/data/wizard-transport";
import { carText, waNumber } from "@/lib/operations/drivers";
import { hoursSince } from "@/lib/operations/supplier-request";
import {
  driverDiffers,
  driverTargets,
  requestTrips,
  transportCities,
  type Driver,
  type TransportCity,
  type TransportTrip,
} from "@/lib/operations/wizard/transport";
import type { StepProps } from "@/lib/operations/wizard/types";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";
import { DriverSend } from "../DriversPanel";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus:border-[#2aa87a]";
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
  const operationId = data.operation.id;
  const names = cities.map((c) => c.name).join("|");
  const [setup, setSetup] = useState<TransportSetup | null>(null);

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
    return <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-[#93aaa3]">{t("wz.transport.none")}</p>;
  }
  // the server's clock, as the supplier panel reads it — the same hours on both renders (no work, no request to time)
  const now = new Date(data.supplierWork?.now ?? 0);
  return (
    <section className="space-y-3">
      <p className="text-[12px] font-semibold text-[#557d78]">{t("wz.transport.hint")}</p>
      {cities.map((c) => (
        <CityCard key={c.key || "-"} city={c} operationId={operationId} setup={setup} now={now} />
      ))}
    </section>
  );
}

function CityCard({ city, operationId, setup, now }: { city: TransportCity; operationId: string; setup: TransportSetup | null; now: Date }) {
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
  const [driver, setDriver] = useState<Driver | null>(null);
  const drv = driver ?? city.driver;
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
      </header>

      <ul className="mt-3 space-y-1.5">
        {city.trips.map((trip) => (
          <TripRow key={trip.booking.id} trip={trip} city={city} operationId={operationId} />
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

      {draft ? (
        <div className="mt-3 rounded-[9px] border border-[#d6eadf] bg-[#f8fbf9] p-3">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#0f7a52]">
            {draft.to_label}
            {draft.to_phone ? <DirText dir="ltr" className="font-semibold text-[#93aaa3]">{draft.to_phone}</DirText> : null}
          </p>
          <p className="mb-2 text-[11px] font-semibold text-[#93aaa3]">{t("ops.request.review")}</p>
          {/* editable on purpose — what is stored is what actually went out */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            dir="auto"
            className="mb-2 block w-full rounded-[9px] border border-[#dbe6e1] bg-white px-3 py-2 text-[12.5px] leading-relaxed text-[#0f3d38] outline-none focus:border-[#2aa87a]"
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
function TripRow({ trip, city, operationId }: { trip: TransportTrip; city: TransportCity; operationId: string }) {
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
          {error ? <p className="text-[11.5px] font-bold text-[#c22850] sm:col-span-3">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
