"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Eye, Loader2, MapPin, Plus, Wand2, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import { suggestPricingForDraft } from "@/lib/data/pricing-suggest";
import {
  AGE_BANDS,
  currencyOptions,
  emptyFlight,
  findLookupCountry,
  inheritBoard,
  MEAL_PLAN_BOARD,
  MEAL_PLAN_LABEL_KEYS,
  MEAL_PLANS,
  moveTripCountry,
  resizeAges,
  resizeRooms,
  stageHref,
  STAGES,
  type DraftData,
  type DraftFlight,
  type DraftHotel,
  type DraftTrip,
  type GeneratorLookups,
  type MealPlan,
  type TransportMode,
} from "@/lib/offer/draft-types";
import { addCity, basicDays, chainCities, remainingNights, removeCity, setCityNights, type BasicCity } from "@/lib/offer/basic";
import { validateDraft } from "@/lib/offer/draft-validation";
import { computeOfferPricing, rebase } from "@/lib/offer/pricing";
import { mergeSuggestions } from "@/lib/offer/pricing-suggest";
import { syncDepartureDates } from "@/lib/offer/schedule";
import { useRole } from "@/lib/roles/RoleContext";
import type { FlightLegOrder } from "@/lib/types";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { fieldClass } from "../generator/stage-props";
import { SupplierPrice } from "../generator/SupplierPrice";
import { useDraftState } from "../generator/useDraftState";
import { BasicCityCard } from "./BasicCityCard";
import { airportDisplay, BasicFlightRow } from "./BasicFlightRow";
import { useBasicLabels } from "./labels";

const label = "grid gap-1 text-[11px] font-bold text-[#557d78]";
const card = "rounded-[16px] border border-[#d8e6e0] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * «النظام بيسك» — the whole file on one page, the way the company's own system
 * asks for it: the booking on top, a bar at the bottom that adds a city with its
 * nights and tours, and inside each city its hotel and the flight that brings
 * the group there. Everything else (dates, day titles, transfers) follows.
 *
 * It edits the same draft as the full generator, through the same auto-save, so
 * either screen can pick the file up where the other left it.
 */
export function BasicEditor({
  draftId,
  initialData,
  lookups,
}: {
  draftId: string;
  initialData: DraftData;
  lookups: GeneratorLookups;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  const { data, patch, replace, flush, saveState } = useDraftState(draftId, initialData);
  const trip = data.trip;
  const country = findLookupCountry(lookups.countries, trip.country);
  const currency = country?.default_currency || "SAR";
  const cities = data.cities as BasicCity[];
  const plan = data.transport_plan;

  /**
   * Every change goes through here: the flights take the trip's dates, the
   * cities chain from where the group lands, the transfers follow the cities,
   * and the programme is rewritten from all of it — in ONE patch.
   */
  function commit(slice: Partial<DraftData>) {
    const merged = { ...data, ...slice };
    const flights = syncDepartureDates(merged.trip, merged.flights);
    const chained = chainCities({ trip: merged.trip, flights }, merged.cities);
    const p = merged.transport_plan;
    const transport_plan = {
      ...p,
      tours: { ...p.tours, enabled: (chained as BasicCity[]).some((c) => (c.tours ?? 0) > 0) },
      intercity: { ...p.intercity, enabled: chained.length > 1 },
    };
    const next = { ...merged, flights, cities: chained, transport_plan };
    patch({ ...slice, flights, cities: chained, transport_plan, days: basicDays(next) });
  }

  function setTrip(slice: Partial<DraftTrip>) {
    const next = { ...trip, ...slice };
    if (next.arrival_date && next.nights > 0) next.departure_date = addDaysIso(next.arrival_date, next.nights);
    commit({ trip: { ...next, days: next.nights > 0 ? next.nights + 1 : next.days } });
  }

  function setCountry(name: string) {
    patch(moveTripCountry(data, lookups, { ...trip, country: name, destination: name }));
  }

  function setRoomsCount(rooms: number) {
    // lines still booking the trip's count follow it; a city the agent changed keeps its own
    const hotels = data.hotels.map((h) => (h.rooms.length === trip.rooms ? resizeRooms(h, rooms) : h));
    commit({ trip: { ...trip, rooms }, hotels });
  }

  function setMeals(meal: MealPlan | "") {
    const meal_plan = meal || null;
    const board = meal_plan ? MEAL_PLAN_BOARD[meal_plan] : null;
    const hotels = data.hotels.map((h) => inheritBoard(h, trip.default_board, board));
    commit({ trip: { ...trip, meal_plan, default_board: board }, hotels });
  }

  function setCar(leg: "airport" | "tours", car_type: string) {
    const next = { ...plan, [leg]: { ...plan[leg], car_type } };
    // between cities rides the transfer car unless it is a flight or a train
    if (leg === "airport") next.intercity = { ...next.intercity, car_type };
    commit({ transport_plan: next });
  }

  function setMode(mode: TransportMode) {
    commit({
      transport_plan: { ...plan, intercity: { ...plan.intercity, mode } },
      scope: { ...data.scope, flights_domestic: mode === "flight" },
    });
  }

  function setHotel(line: DraftHotel) {
    commit({ hotels: data.hotels.map((h) => (h.id === line.id ? line : h)) });
  }

  // ---------- flights: which leg belongs to which card ----------
  /** The airport that serves a city — what a new leg is pre-filled with. */
  function airportOf(cityName: string | undefined) {
    const serving = cityName ? lookups.airports.filter((x) => x.city === cityName) : [];
    // a real IATA code first: the list also holds legacy rows with made-up codes
    const a = serving.find((x) => /^[A-Z]{3}$/.test(x.code ?? "")) ?? serving[0];
    return a ? { value: airportDisplay(a), tz: a.timezone, city: a.city ?? "" } : null;
  }

  function addLeg(order: FlightLegOrder, cityIndex: number) {
    const leg: DraftFlight = { ...emptyFlight(order, trip), cabin_class: data.flight_booking.cabin };
    const here = airportOf(cities[cityIndex]?.city_name);
    const before = airportOf(cities[cityIndex - 1]?.city_name);
    if (order !== "inbound" && here) Object.assign(leg, { to_airport: here.value, to_tz: here.tz, to_city: here.city });
    if (order === "inbound" && here) Object.assign(leg, { from_airport: here.value, from_tz: here.tz, from_city: here.city });
    if (order === "internal" && before) Object.assign(leg, { from_airport: before.value, from_tz: before.tz, from_city: before.city });
    if (order === "internal" && cities[cityIndex]?.check_in) {
      Object.assign(leg, { departure_at: `${cities[cityIndex].check_in}T12:00`, date_user_set: true });
    }
    commit({ flights: [...data.flights, leg] });
  }

  function setLeg(index: number, slice: Partial<DraftFlight>) {
    commit({ flights: data.flights.map((f, i) => (i === index ? { ...f, ...slice } : f)) });
  }

  function removeLeg(index: number) {
    commit({ flights: data.flights.filter((_, i) => i !== index) });
  }

  const legs = data.flights.map((f, index) => ({ f, index }));
  const outbound = legs.filter((l) => l.f.leg_order === "outbound");
  const inbound = legs.filter((l) => l.f.leg_order === "inbound");
  const internal = legs.filter((l) => l.f.leg_order === "internal");
  const intl = data.scope.flights_intl;
  const byFlight = plan.intercity.mode === "flight";

  function legRows(rows: typeof legs, title: string) {
    return rows.map(({ f, index }) => (
      <BasicFlightRow
        key={index}
        title={title}
        leg={f}
        lookups={lookups}
        onChange={(slice) => setLeg(index, slice)}
        onRemove={() => removeLeg(index)}
      />
    ));
  }

  function addLegButton(order: FlightLegOrder, cityIndex: number, title: string) {
    return (
      <button
        type="button"
        onClick={() => addLeg(order, cityIndex)}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-dashed border-[#e1bdd1] px-3 text-[12px] font-bold text-[#8a3a64] hover:bg-[#fdf2f7]"
      >
        {title} {tx("addLeg")}
      </button>
    );
  }

  // ---------- the add bar ----------
  const left = remainingNights(data);
  const [newCity, setNewCity] = useState("");
  const [newNights, setNewNights] = useState(0);
  const [newTours, setNewTours] = useState(0);
  const nightsChoice = newNights || Math.max(left, 1);

  function onAdd() {
    if (!newCity) return;
    commit(addCity(data, { name: newCity, nights: nightsChoice, tours: newTours }, currency));
    setNewCity("");
    setNewNights(0);
    setNewTours(0);
  }

  const used = data.cities.reduce((sum, c) => sum + c.nights, 0);
  const nightsNote =
    trip.nights > 0 && left === 0 ? tx("complete") : used > trip.nights ? tx("over", { n: used - trip.nights }) : tx("remaining", { n: left });
  const nightsTone = trip.nights > 0 && left === 0 ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-white text-[#a86a10]";

  // day numbers on each card: after any travel day, one city after another
  const travelDays = data.days.filter((d) => d.kind === "travel").length;
  let dayCursor = travelDays + 1;

  // ---------- pricing (sell side only) ----------
  const canPricing = can("pricing.view");
  const display = data.pricing.display_currency || "SAR";
  const [pricingBusy, setPricingBusy] = useState(false);
  const summary = useMemo(
    () =>
      computeOfferPricing(
        data.pricing.items.map((i) => ({
          quantity: i.quantity,
          buy_price: i.buy_price,
          buy_currency: i.buy_currency || display,
          sell_price: i.sell_price,
          sell_currency: i.sell_currency || display,
          profit_pct: i.profit_pct,
          profit_amount: i.profit_amount,
        })),
        rebase(lookups.sarPer ?? { SAR: 1 }, display) ?? {},
        display,
      ),
    [data.pricing.items, display, lookups.sarPer],
  );

  async function calculate() {
    setPricingBusy(true);
    // the server prices the SAVED draft
    await flush();
    const res = await suggestPricingForDraft(draftId, { hotel: t("pg.hotel"), airline: t("pg.airline") });
    setPricingBusy(false);
    if (!res.ok) return;
    patch({ pricing: { ...data.pricing, items: mergeSuggestions(data.pricing.items, res.items).items } });
  }

  function setItem(index: number, slice: Partial<DraftData["pricing"]["items"][number]>) {
    patch({ pricing: { ...data.pricing, items: data.pricing.items.map((it, i) => (i === index ? { ...it, ...slice } : it)) } });
  }

  // ---------- what is still missing ----------
  const gated = new Set(STAGES.filter((s) => s.gated).map((s) => s.key));
  const blocking = validateDraft(data).blocking.filter((i) => canPricing || !gated.has(i.stage));
  // «hotels» has no rail entry of its own (its stays live in the city card)
  const stageLabel = (key: string) => {
    const meta = STAGES.find((s) => s.key === key);
    return meta ? t(meta.labelKey) : key === "hotels" ? t("pg.stage.hotels") : key;
  };

  const partner = data.customer.partner_company_id;
  const visaOn = data.scope.visas;

  return (
    <TraveliunShell title="nav.basic">
      <div className="tv-fade-up space-y-4">
        {/* top bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/basic" className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]">
            <ArrowRight className="size-4 ltr:rotate-180" />
            {tx("back")}
          </Link>
          <span
            role="status"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${
              saveState === "error" ? "bg-[#fdeef2] text-[#c22850]" : saveState === "saving" ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#e9f7f0] text-[#0f7a52]"
            }`}
          >
            {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : saveState === "error" ? <XCircle className="size-3.5" /> : <Check className="size-3.5" />}
            {saveState === "saving" ? t("pg.saving") : saveState === "error" ? t("pg.saveFailed") : t("pg.saved")}
          </span>
          <div className="ms-auto flex flex-wrap gap-2">
            <Link href={stageHref(draftId, "trip")} onClick={() => void flush()} className="inline-flex h-9 items-center rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]">
              {tx("fullGenerator")}
            </Link>
            <Link href={stageHref(draftId, "preview")} onClick={() => void flush()} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12.5px] font-bold text-white hover:bg-[#0f4439]">
              <Eye className="size-4" />
              {tx("preview")}
            </Link>
          </div>
        </div>

        {/* booking details */}
        <section className={card}>
          <h2 className="mb-3 text-[14px] font-extrabold text-[#003c3a]">{tx("booking")}</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <label className={label}>
              {tx("country")}
              <select value={country?.name ?? trip.country} onChange={(e) => setCountry(e.target.value)} className={fieldClass}>
                <option value="">{tx("choose")}</option>
                {lookups.countries.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              {tx("agent")}
              <select
                value={partner ?? ""}
                onChange={(e) => {
                  const p = lookups.partners.find((x) => x.id === e.target.value);
                  patch({ customer: { ...data.customer, partner_company_id: p?.id ?? null, company: p?.name ?? "" } });
                }}
                className={fieldClass}
              >
                <option value="">{tx("direct")}</option>
                {lookups.partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              {tx("customer")}
              <input value={data.customer.customer_name} onChange={(e) => patch({ customer: { ...data.customer, customer_name: e.target.value } })} className={fieldClass} />
            </label>
            <label className={label}>
              {tx("phone")}
              <input dir="ltr" value={data.customer.customer_phone} onChange={(e) => patch({ customer: { ...data.customer, customer_phone: e.target.value } })} className={fieldClass} />
            </label>
            <label className={label}>
              {tx("start")}
              <input type="date" dir="ltr" value={trip.arrival_date ?? ""} onChange={(e) => setTrip({ arrival_date: e.target.value || null })} className={`${fieldClass} tv-tnum px-2`} />
            </label>
            <label className={label}>
              {tx("nights")}
              <div className="flex items-center gap-2">
                <select value={trip.nights} onChange={(e) => setTrip({ nights: Number(e.target.value) })} className={fieldClass}>
                  {range(0, 45).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                {trip.departure_date ? (
                  <span className="tv-tnum shrink-0 text-[11px] font-bold text-[#93aaa3]" title={tx("end")}>
                    <DirText>{trip.departure_date}</DirText>
                  </span>
                ) : null}
              </div>
            </label>
            {(["adults", "children", "infants"] as const).map((k) => (
              <label key={k} className={label}>
                {tx(k)}
                <select
                  value={trip[k]}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const ages =
                      k === "children"
                        ? { children_ages: resizeAges(trip.children_ages, n, AGE_BANDS.children.fallback) }
                        : k === "infants"
                          ? { infant_ages: resizeAges(trip.infant_ages, n, AGE_BANDS.infants.fallback) }
                          : {};
                    setTrip({ [k]: n, ...ages } as Partial<DraftTrip>);
                  }}
                  className={fieldClass}
                >
                  {range(k === "adults" ? 1 : 0, 20).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className={label}>
              {tx("rooms")}
              <select value={trip.rooms} onChange={(e) => setRoomsCount(Number(e.target.value))} className={fieldClass}>
                {range(1, 10).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              {tx("meals")}
              <select value={trip.meal_plan ?? ""} onChange={(e) => setMeals(e.target.value as MealPlan | "")} className={fieldClass}>
                <option value="">{tx("choose")}</option>
                {MEAL_PLANS.map((m) => (
                  <option key={m} value={m}>{t(MEAL_PLAN_LABEL_KEYS[m])}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              {tx("visa")}
              <select
                value={visaOn ? "yes" : ""}
                onChange={(e) => {
                  const on = e.target.value === "yes";
                  patch({
                    scope: { ...data.scope, visas: on },
                    visas: on ? [{ country: trip.country, visa_type: "سياحية", count: trip.adults + trip.children + trip.infants, note: "" }] : [],
                  });
                }}
                className={fieldClass}
              >
                <option value="">{tx("noVisa")}</option>
                <option value="yes">{tx("touristVisa")}</option>
              </select>
            </label>
            {(["airport", "tours"] as const).map((leg) => (
              <label key={leg} className={label}>
                {tx(leg === "airport" ? "transferCar" : "tourCar")}
                <select value={plan[leg].car_type} onChange={(e) => setCar(leg, e.target.value)} className={fieldClass}>
                  <option value="">{tx("choose")}</option>
                  {lookups.carTypes.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                      {c.pax ? ` (${c.pax})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className={label}>
              {tx("between")}
              <select value={plan.intercity.mode} onChange={(e) => setMode(e.target.value as TransportMode)} className={fieldClass}>
                <option value="car">{tx("byCar")}</option>
                <option value="flight">{tx("byFlight")}</option>
                <option value="train">{tx("byTrain")}</option>
              </select>
            </label>
            <label className="col-span-2 flex items-center gap-2 self-end pb-3 text-[12px] font-bold text-[#185045] sm:col-span-1">
              <input
                type="checkbox"
                checked={intl}
                onChange={(e) => commit({ scope: { ...data.scope, flights_intl: e.target.checked } })}
                className="size-4 accent-[#185045]"
              />
              {tx("flightsIntl")}
            </label>
          </div>
        </section>

        {/* the cities */}
        {cities.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-[#cfe0d9] px-4 py-8 text-center text-[13px] font-semibold text-[#93aaa3]">{tx("noCities")}</p>
        ) : (
          cities.map((city, i) => {
            const dayFrom = dayCursor;
            dayCursor += city.nights;
            const last = i === cities.length - 1;
            const hop = internal[i - 1];
            return (
              <BasicCityCard
                key={`${i}-${city.city_name}`}
                index={i}
                city={city}
                dayFrom={dayFrom}
                dayTo={dayFrom + city.nights}
                draftId={draftId}
                data={data}
                lookups={lookups}
                flush={flush}
                replace={replace}
                onNights={(n) => commit(setCityNights(data, i, n))}
                onTours={(n) => commit({ cities: cities.map((c, k) => (k === i ? { ...c, tours: n } : c)) })}
                onHotel={setHotel}
                onRemove={() => {
                  if (window.confirm(tx("confirmRemove", { city: city.city_name }))) commit(removeCity(data, i));
                }}
              >
                {i === 0 && intl ? (outbound.length > 0 ? legRows(outbound, tx("outbound")) : addLegButton("outbound", i, tx("outbound"))) : null}
                {i > 0 && byFlight
                  ? hop
                    ? legRows([hop], tx("domestic", { city: city.city_name }))
                    : addLegButton("internal", i, tx("domestic", { city: city.city_name }))
                  : null}
                {last && intl ? (inbound.length > 0 ? legRows(inbound, tx("inbound")) : addLegButton("inbound", i, tx("inbound"))) : null}
              </BasicCityCard>
            );
          })
        )}

        {/* the add bar — always at hand, like the company's system; one row even on a phone */}
        <div className="sticky bottom-3 z-20 rounded-[16px] border border-[#cfe0d9] bg-[#e9f3ef]/95 px-2.5 py-2 shadow-[0_8px_24px_rgba(0,60,58,0.12)] backdrop-blur max-lg:bottom-[80px] sm:px-3">
          <div className="flex items-end gap-1.5 sm:gap-2">
            <label className={`${label} min-w-0 flex-1`}>
              {tx("city")}
              <select value={newCity} onChange={(e) => setNewCity(e.target.value)} disabled={!country} className={fieldClass}>
                <option value="">{country ? tx("choose") : tx("country")}</option>
                {(country?.cities ?? []).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className={`${label} w-16 shrink-0 sm:w-20`}>
              {tx("nights")}
              <select value={nightsChoice} onChange={(e) => setNewNights(Number(e.target.value))} className={`${fieldClass} px-2`}>
                {range(1, 30).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className={`${label} w-16 shrink-0 sm:w-20`}>
              {tx("tours")}
              <select value={Math.min(newTours, nightsChoice - 1)} onChange={(e) => setNewTours(Number(e.target.value))} className={`${fieldClass} px-2`}>
                {range(0, Math.max(nightsChoice - 1, 0)).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onAdd}
              disabled={!newCity}
              aria-label={tx("add")}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#185045] px-3 text-[13px] font-extrabold text-white disabled:opacity-50 sm:px-4"
            >
              <Plus className="size-4" />
              <span className="max-sm:hidden">{tx("add")}</span>
            </button>
            <span
              className={`tv-tnum hidden h-11 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[12px] font-bold sm:inline-flex ${nightsTone}`}
            >
              <MapPin className="size-4" />
              {nightsNote}
            </span>
          </div>
          <p className={`tv-tnum mt-1.5 rounded-[8px] px-2 py-1 text-[11px] font-bold sm:hidden ${nightsTone}`}>{nightsNote}</p>
        </div>

        {/* one price per flight booking, and who it was booked through */}
        {outbound.length + inbound.length + internal.length > 0 ? (
          <section className={card}>
            <h2 className="mb-3 text-[14px] font-extrabold text-[#003c3a]">{tx("flightPrices")}</h2>
            <div className="space-y-3">
              {outbound.length + inbound.length > 0 ? (
                <SupplierPrice
                  label={t("pg.fb.intlPrice")}
                  price={data.flight_booking.intl_price}
                  currency={data.flight_booking.intl_currency}
                  supplier={data.flight_booking.intl_supplier}
                  category="طيران"
                  lookups={lookups}
                  countries={lookups.countries}
                  onChange={(v) =>
                    patch({
                      flight_booking: {
                        ...data.flight_booking,
                        ...(v.price !== undefined ? { intl_price: v.price } : {}),
                        ...(v.currency !== undefined ? { intl_currency: v.currency } : {}),
                        ...(v.supplier !== undefined ? { intl_supplier: v.supplier } : {}),
                      },
                    })
                  }
                />
              ) : null}
              {internal.length > 0 ? (
                <SupplierPrice
                  label={t("pg.fb.domPrice")}
                  price={data.flight_booking.dom_price}
                  currency={data.flight_booking.dom_currency}
                  supplier={data.flight_booking.dom_supplier}
                  category="طيران"
                  lookups={lookups}
                  countries={lookups.countries}
                  onChange={(v) =>
                    patch({
                      flight_booking: {
                        ...data.flight_booking,
                        ...(v.price !== undefined ? { dom_price: v.price } : {}),
                        ...(v.currency !== undefined ? { dom_currency: v.currency } : {}),
                        ...(v.supplier !== undefined ? { dom_supplier: v.supplier } : {}),
                      },
                    })
                  }
                />
              ) : null}
            </div>
          </section>
        ) : null}

        {/* pricing — the sell side only, for whoever may see prices */}
        {canPricing ? (
          <section className={card}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-extrabold text-[#003c3a]">{tx("pricing")}</h2>
              <label className="ms-auto inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
                {tx("quote")}
                <select
                  value={display}
                  onChange={(e) => patch({ pricing: { ...data.pricing, display_currency: e.target.value } })}
                  className="h-8 rounded-[8px] border border-[#cfe0d9] bg-white px-1.5 text-[12px] font-bold"
                >
                  {currencyOptions(lookups.countries, display).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void calculate()}
                disabled={pricingBusy}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60"
              >
                {pricingBusy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {tx("calc")}
              </button>
            </div>
            {data.pricing.items.length === 0 ? (
              <p className="text-[12.5px] font-semibold text-[#93aaa3]">{tx("noLines")}</p>
            ) : (
              <div className="divide-y divide-[#edf3f0]">
                {data.pricing.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-2 sm:grid-cols-[1fr_60px_130px_90px]">
                    <span className="min-w-0 truncate text-[12.5px] font-bold text-[#185045]">{item.description}</span>
                    <span className="tv-tnum hidden text-center text-[12px] font-bold text-[#557d78] sm:block">× {item.quantity}</span>
                    <input
                      type="number"
                      min={0}
                      dir="ltr"
                      aria-label={tx("sell")}
                      value={item.sell_price ?? ""}
                      onChange={(e) => setItem(i, { sell_price: e.target.value === "" ? null : Number(e.target.value) })}
                      className={`${fieldClass} tv-tnum h-9 text-center`}
                    />
                    <select
                      value={item.sell_currency || display}
                      onChange={(e) => setItem(i, { sell_currency: e.target.value })}
                      className={`${fieldClass} h-9 px-2`}
                    >
                      {currencyOptions(lookups.countries, item.sell_currency || display).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-3">
                  <span className="text-[13px] font-extrabold text-[#003c3a]">{tx("total")}</span>
                  <span className="tv-tnum text-[16px] font-extrabold text-[#0f7a52]">
                    <DirText>{`${summary.total_sell.toLocaleString("en-US")} ${display}`}</DirText>
                  </span>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {/* what stands between this file and the client */}
        <section className={card}>
          {blocking.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-[13px] font-bold text-[#0f7a52]">
              <CheckCircle2 className="size-4" />
              {tx("allGood")}
            </p>
          ) : (
            <>
              <h2 className="mb-2 inline-flex items-center gap-2 text-[14px] font-extrabold text-[#a86a10]">
                <AlertTriangle className="size-4" />
                {tx("missing")}
              </h2>
              <ul className="space-y-1.5">
                {blocking.map((issue, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-[#5b4a2a]">
                    <span className="rounded-full bg-[#fff3d6] px-2 py-0.5 text-[11px] font-bold text-[#a86a10]">{stageLabel(issue.stage)}</span>
                    <span className="min-w-0 flex-1">
                      {issue.invariant ? (language === "ar" ? issue.invariant.message_ar : issue.invariant.message_en) : issue.key ? t(issue.key) : ""}
                    </span>
                    <Link href={stageHref(draftId, issue.stage)} onClick={() => void flush()} className="text-[11.5px] font-bold text-[#185045] underline">
                      {tx("fix")}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

      </div>

      <datalist id="basic-airports">
        {lookups.airports.map((a) => (
          <option key={a.id} value={airportDisplay(a)} />
        ))}
      </datalist>
    </TraveliunShell>
  );
}
