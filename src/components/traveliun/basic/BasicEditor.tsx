"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  BusFront,
  Camera,
  Car,
  Check,
  CheckCircle2,
  Circle,
  CircleCheck,
  ConciergeBell,
  FileText,
  Link2,
  Loader2,
  MapPin,
  Pencil,
  Plane,
  PlaneTakeoff,
  Plus,
  Rocket,
  Ship,
  Stamp,
  TrainFront,
  Wand2,
  XCircle,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { getCountryHotels, getRoomTypeLookups, produceOfferFromDraft } from "@/lib/data/drafts";
import { suggestPricingForDraft } from "@/lib/data/pricing-suggest";
import {
  AGE_BANDS,
  clampAge,
  currencyOptions,
  findLookupCountry,
  hopKey,
  hopMode,
  inheritBoard,
  intercityModes,
  MEAL_PLAN_BOARD,
  MEAL_PLAN_LABEL_KEYS,
  MEAL_PLANS,
  moveTripCountry,
  resizeAges,
  resizeRooms,
  SCOPE_LABEL_KEYS,
  stageHref,
  STAGES,
  type DraftData,
  type DraftHotel,
  type DraftScope,
  type DraftTrip,
  type GeneratorLookups,
  type LookupHotel,
  type MealPlan,
  type TransportMode,
  vehicleText,
} from "@/lib/offer/draft-types";
import { addCity, basicDays, chainCities, remainingNights, removeCity, setCityNights, withHotelLines, withTripDates, type BasicCity } from "@/lib/offer/basic";
import { validateDraft, type DraftIssue } from "@/lib/offer/draft-validation";
import { computeOfferPricing, rebase } from "@/lib/offer/pricing";
import { mergeSuggestions } from "@/lib/offer/pricing-suggest";
import { syncDepartureDates } from "@/lib/offer/schedule";
import { useRole } from "@/lib/roles/RoleContext";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { FieldIssueProvider } from "../generator/FieldIssue";
import { FlightsStage } from "../generator/stages/FlightsStage";
import { useDraftState } from "../generator/useDraftState";
import { BasicCityCard } from "./BasicCityCard";
import { BasicPhoneLookup } from "./BasicPhoneLookup";
import { nightsText, useBasicLabels, type BasicLabel } from "./labels";
import { basicCard, basicField, basicLabel } from "./styles";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Hotels are entered in riyals unless the agent says otherwise. */
const BASE_CURRENCY = "SAR";
const MODE_CHIPS: { mode: TransportMode; label: BasicLabel; icon: typeof Car }[] = [
  { mode: "car", label: "byCar", icon: Car },
  { mode: "flight", label: "byFlight", icon: PlaneTakeoff },
  { mode: "train", label: "byTrain", icon: TrainFront },
  { mode: "ship", label: "byShip", icon: Ship },
];
/** The page's steps, in order; one is open at a time. */
type Step = "client" | "flights" | "cities" | "transport" | "pricing" | "finish";
const STEP_ORDER: Step[] = ["client", "flights", "cities", "transport", "pricing", "finish"];
/** Which step of this page answers a stage's blocking issue. */
const STEP_OF: Partial<Record<string, Step>> = {
  customer: "client",
  trip: "client",
  visas: "client",
  flights: "flights",
  cities: "cities",
  hotels: "cities",
  transport: "transport",
  pricing: "pricing",
};

/** «Booking engine» chip from the program-includes spec: whole chip clickable, state not by colour alone. */
function Chip({ on, icon: Icon, label, onClick }: { on: boolean; icon: typeof Car; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-150 hover:border-[#165749] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#73B7A4] motion-reduce:transition-none max-sm:text-[11px] ${
        on ? "border-[#BCE4D3] bg-[#EAF8F2] text-[#0F4339]" : "border-[#DBE4E2] bg-white text-[#687F7B]"
      }`}
    >
      {on ? <CircleCheck className="size-[13px] fill-[#165749] text-white" /> : <Circle className="size-[13px]" />}
      {label}
      <Icon className="size-[15px]" />
    </button>
  );
}

/**
 * A section that folds to one line once it is done: «التالي» closes it, a press
 * on the line opens it again. Keeps the screen on what is still to be entered.
 */
function Fold({
  id,
  title,
  open,
  onOpen,
  summary,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onOpen: () => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  const tx = useBasicLabels();
  if (open)
    return (
      <section id={id} className={`${basicCard} scroll-mt-20`}>
        <h2 className="mb-2.5 text-[14px] font-extrabold text-[#003c3a]">{title}</h2>
        {children}
      </section>
    );
  return (
    <button
      id={id}
      type="button"
      onClick={onOpen}
      className={`${basicCard} flex w-full scroll-mt-20 items-center gap-2 py-2.5 text-start hover:border-[#a9cbbf]`}
    >
      <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" />
      <span className="shrink-0 text-[13px] font-extrabold text-[#003c3a]">{title}</span>
      <span className="tv-tnum min-w-0 flex-1 truncate text-[12px] font-semibold text-[#557d78]">{summary}</span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-bold text-[#185045]">
        <Pencil className="size-3.5" />
        {tx("edit")}
      </span>
    </button>
  );
}

/** «التالي» with what still stops it, in words. */
function NextButton({ missing, onNext }: { missing: string[]; onNext: () => void }) {
  const tx = useBasicLabels();
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-dashed border-[#DCE9E5] pt-2.5">
      {missing.length > 0 ? <span className="text-[11.5px] font-bold text-[#a86a10]">{tx("needFirst", { list: missing.join("، ") })}</span> : null}
      <button
        type="button"
        onClick={onNext}
        disabled={missing.length > 0}
        className="inline-flex h-9 items-center rounded-[9px] bg-[#185045] px-5 text-[12.5px] font-extrabold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {tx("next")}
      </button>
    </div>
  );
}

/** «SV123 RUH → KUL» — a leg as the folded flights line reads it; the city when the airport has no code. */
function legText(f: DraftData["flights"][number]): string {
  const code = (airport: string, city: string | undefined) => airport.match(/\(([A-Za-z0-9]{3,4})\)/)?.[1] ?? (city || airport);
  return `${f.flight_no || "—"} ${code(f.from_airport, f.from_city)} → ${code(f.to_airport, f.to_city)}`;
}

/**
 * «النظام بيسك» — the whole file on one page, the way the company's own system
 * asks for it: the customer and the trip once, what the programme includes, the
 * flights, then a bar that adds a city with its nights and tours — and inside
 * each city its hotel. Nothing entered once is asked again; what follows from
 * it (dates, rooms, meals, the programme's day titles) is filled in and kept
 * under «معلومات إضافية». The package is issued from here too.
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
  const cities = data.cities as BasicCity[];
  const plan = data.transport_plan;
  const modes = intercityModes(plan);
  const scope = data.scope;
  const toursOn = plan.tours.enabled;

  // Two changes in one tick (the flights card sends some) must both land: each
  // builds on the one before it, not on the render they both started from.
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  }, [data]);

  /**
   * Every change goes through here: the flights take the trip's dates, the
   * cities chain from where the group lands, every city gets its hotel line,
   * and the programme is rewritten from all of it — in ONE patch.
   */
  function commit(slice: Partial<DraftData>) {
    const merged = { ...latest.current, ...slice };
    const flights = syncDepartureDates(merged.trip, merged.flights);
    const chained = chainCities({ trip: merged.trip, flights }, merged.cities);
    const p = merged.transport_plan;
    const transport_plan = { ...p, intercity: { ...p.intercity, enabled: chained.length > 1 } };
    // a domestic flight is one of the ways between cities — the two switches are one fact
    const nextScope = { ...merged.scope, flights_domestic: intercityModes(transport_plan).includes("flight") };
    const shaped = { ...merged, flights, cities: chained, transport_plan, scope: nextScope };
    const hotels = withHotelLines(shaped, BASE_CURRENCY);
    const next = { ...shaped, hotels, days: basicDays({ ...shaped, hotels }) };
    latest.current = next;
    patch({ ...slice, flights, cities: chained, transport_plan, scope: nextScope, hotels, days: next.days });
  }

  const setTrip = (slice: Partial<DraftTrip>) => commit({ trip: withTripDates(trip, slice) });

  function setCountry(name: string) {
    commit(moveTripCountry(data, lookups, { ...trip, country: name, destination: name }));
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

  function setLeg(leg: "airport" | "tours", slice: { car_type?: string; cars?: number }) {
    const next = { ...plan, [leg]: { ...plan[leg], ...slice } };
    // between cities rides the transfer car unless it is a flight, a train or a ship
    if (leg === "airport") next.intercity = { ...next.intercity, ...slice };
    commit({ transport_plan: next });
  }

  function toggleMode(mode: TransportMode) {
    const chosen = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode];
    const list = chosen.length > 0 ? chosen : (["car"] as TransportMode[]);
    commit({ transport_plan: { ...plan, intercity: { ...plan.intercity, modes: list, mode: list[0] } } });
  }

  function setHop(from: string, to: string, mode: TransportMode) {
    commit({ transport_plan: { ...plan, intercity: { ...plan.intercity, hop_modes: { ...plan.intercity.hop_modes, [hopKey(from, to)]: mode } } } });
  }

  function toggleScope(key: keyof DraftScope) {
    const on = !scope[key];
    if (key === "flights_domestic") return toggleMode("flight");
    if (key === "visas") {
      return commit({
        scope: { ...scope, visas: on },
        visas: on ? [{ country: trip.country, visa_type: "سياحية", count: trip.adults + trip.children + trip.infants, note: "" }] : [],
      });
    }
    commit({ scope: { ...scope, [key]: on } });
  }

  const setLines = (lines: DraftHotel[]) => commit({ hotels: data.hotels.map((h) => lines.find((l) => l.id === h.id) ?? h) });

  // ---------- the catalogue, fetched per country ----------
  // The page opens without the 2,300 hotels and 1,300 room types of every
  // country; the hotels of a country arrive when the file first names it, the
  // room types once, in the background.
  const [newCountry, setNewCountry] = useState("");
  const [hotelsByCountry, setHotelsByCountry] = useState<Record<string, Record<string, LookupHotel[]>>>({});
  const [roomTypes, setRoomTypes] = useState(lookups.roomTypes);
  const asked = useRef(new Set<string>());
  const wantedCountries = [...new Set([trip.country, newCountry, ...cities.map((c) => c.country ?? "")])]
    .map((name) => findLookupCountry(lookups.countries, name)?.name ?? "")
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    for (const name of wantedCountries.split("|").filter(Boolean)) {
      if (asked.current.has(name)) continue;
      asked.current.add(name);
      void getCountryHotels(name).then((byCity) => {
        if (byCity) setHotelsByCountry((known) => ({ ...known, [name]: byCity }));
        else asked.current.delete(name);
      });
    }
  }, [wantedCountries]);
  useEffect(() => {
    if (lookups.roomTypes.length === 0) void getRoomTypeLookups().then(setRoomTypes);
  }, [lookups.roomTypes.length]);
  const lk = useMemo<GeneratorLookups>(
    () => ({
      ...lookups,
      roomTypes,
      countries: lookups.countries.map((c) => {
        const byCity = hotelsByCountry[c.name];
        return byCity ? { ...c, cities: c.cities.map((city) => ({ ...city, hotels: byCity[city.id] ?? [] })) } : c;
      }),
    }),
    [lookups, roomTypes, hotelsByCountry],
  );

  // ---------- the add bar ----------
  const left = remainingNights(data);
  const [newCity, setNewCity] = useState("");
  const [newNights, setNewNights] = useState(0);
  const [newTours, setNewTours] = useState(0);
  // the stay, picked on the bar too — one «إضافة» books the city and its hotel
  const [newHotel, setNewHotel] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [newRooms, setNewRooms] = useState(0);
  const nightsChoice = newNights || Math.max(left, 1);
  const roomsChoice = newRooms || Math.max(trip.rooms, 1);
  // the trip's country unless the group crosses into a neighbour
  const barCountry = findLookupCountry(lk.countries, newCountry || trip.country);
  const barHotels = barCountry?.cities.find((c) => c.name === newCity)?.hotels ?? [];
  const barRoomNames = [
    ...new Set(lk.roomTypes.filter((r) => r.hotel_id === null || r.hotel_id === newHotel).map((r) => r.name.trim())),
  ].filter(Boolean);

  function pickCity(name: string) {
    setNewCity(name);
    setNewHotel("");
    setNewRoom("");
  }

  function onAdd() {
    if (!newCity) return;
    const hotel = barHotels.find((h) => h.id === newHotel);
    commit(
      addCity(
        data,
        {
          name: newCity,
          nights: nightsChoice,
          tours: toursOn ? newTours : 0,
          country: barCountry?.name,
          hotel: hotel ? { id: hotel.id, name: hotel.name } : null,
          room: newRoom,
          rooms: roomsChoice,
        },
        BASE_CURRENCY,
      ),
    );
    pickCity("");
    setNewNights(0);
    setNewTours(0);
    setNewRooms(0);
  }

  const used = data.cities.reduce((sum, c) => sum + c.nights, 0);
  // over first: `left` is clamped at 0, so a file one night too long also has none left
  const nightsNote =
    used > trip.nights ? tx("over", { n: used - trip.nights }) : trip.nights > 0 && left === 0 ? tx("complete") : tx("remaining", { n: left });
  const nightsTone = trip.nights > 0 && used === trip.nights ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-white text-[#a86a10]";

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

  const [pricingError, setPricingError] = useState<string | null>(null);
  async function calculate() {
    setPricingBusy(true);
    setPricingError(null);
    try {
      // the server prices the SAVED draft
      await flush();
      const res = await suggestPricingForDraft(draftId, { hotel: t("pg.hotel"), airline: t("pg.airline") });
      if (!res.ok) return setPricingError(t(res.error));
      patch({ pricing: { ...data.pricing, items: mergeSuggestions(data.pricing.items, res.items).items } });
    } catch {
      // offline, or a tab from before a deploy: say so instead of spinning
      setPricingError(tx("serverLost"));
    } finally {
      setPricingBusy(false);
    }
  }

  function setItem(index: number, slice: Partial<DraftData["pricing"]["items"][number]>) {
    patch({ pricing: { ...data.pricing, items: data.pricing.items.map((it, i) => (i === index ? { ...it, ...slice } : it)) } });
  }

  // ---------- what is still missing, and issuing ----------
  const validation = useMemo(() => validateDraft(data), [data]);
  const gated = new Set(STAGES.filter((s) => s.gated).map((s) => s.key));
  const blocking = validation.blocking.filter((i) => canPricing || !gated.has(i.stage));
  // «hotels» has no rail entry of its own (its stays live in the city card)
  const stageLabel = (key: string) => {
    const meta = STAGES.find((s) => s.key === key);
    return meta ? t(meta.labelKey) : key === "hotels" ? t("pg.stage.hotels") : key;
  };
  const issueText = (issue: DraftIssue) =>
    issue.invariant ? (language === "ar" ? issue.invariant.message_ar : issue.invariant.message_en) : issue.key ? t(issue.key) : "";

  const [producing, setProducing] = useState(false);
  const [produceError, setProduceError] = useState<string | null>(null);
  const produced = data.produced_serial;

  async function produce() {
    if (producing || blocking.length > 0) return;
    setProducing(true);
    setProduceError(null);
    try {
      // the server issues the SAVED draft
      await flush();
      const result = await produceOfferFromDraft(draftId);
      if (!result.ok) return setProduceError(t(result.error));
      patch({ produced_serial: result.serial });
    } catch {
      setProduceError(tx("serverLost"));
    } finally {
      setProducing(false);
    }
  }

  // ---------- the steps: one open at a time ----------
  const partner = data.customer.partner_company_id;
  const flightsOn = scope.flights_intl || scope.flights_domestic;
  const missingOf: Record<Step, string[]> = {
    client: [
      !country && tx("country"),
      !partner && !data.customer.customer_name.trim() && tx("customer"),
      !partner && !data.customer.customer_phone.trim() && tx("phone"),
      !trip.arrival_date && tx("start"),
      trip.nights <= 0 && tx("nights"),
      !trip.meal_plan && tx("meals"),
    ].filter((x): x is string => Boolean(x)),
    flights: blocking.some((i) => i.stage === "flights") ? [t("pg.flightsTitle")] : [],
    cities: cities.length === 0 ? [tx("city")] : used !== trip.nights ? [nightsNote] : [],
    transport: [
      !plan.airport.car_type.trim() && tx("transferCar"),
      toursOn && !plan.tours.car_type.trim() && tx("tourCar"),
    ].filter((x): x is string => Boolean(x)),
    pricing: blocking.some((i) => i.stage === "pricing") ? [tx("pricing")] : [],
    finish: [],
  };
  const steps = STEP_ORDER.filter(
    (s) => (s !== "flights" || flightsOn) && (s !== "transport" || scope.transport) && (s !== "pricing" || canPricing),
  );
  // a new file opens on its first step; a file coming back, on the first one not done
  const firstTodo = steps.find((s) => missingOf[s].length > 0) ?? "finish";
  const [open, setOpen] = useState<Step>(firstTodo);
  const [reached, setReached] = useState<Step>(firstTodo);
  const shown = (s: Step) => steps.includes(s) && STEP_ORDER.indexOf(s) <= STEP_ORDER.indexOf(reached);

  function show(step: Step) {
    setOpen(step);
    window.setTimeout(() => document.getElementById(`basic-${step}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function next(from: Step) {
    const to = steps[steps.indexOf(from) + 1] ?? "finish";
    if (STEP_ORDER.indexOf(to) > STEP_ORDER.indexOf(reached)) setReached(to);
    show(to);
  }

  const pax = [
    `${trip.adults} ${tx("adults")}`,
    trip.children > 0 ? `${trip.children} ${tx("children")}` : "",
    trip.infants > 0 ? `${trip.infants} ${tx("infants")}` : "",
  ].filter(Boolean);
  const summaryOf: Record<Step, string> = {
    client: [
      trip.country,
      partner ? data.customer.company : data.customer.customer_name,
      trip.arrival_date && trip.departure_date ? `${trip.arrival_date} → ${trip.departure_date}` : "",
      nightsText(trip.nights, language),
      ...pax,
      tx("roomsN", { n: trip.rooms }),
      trip.meal_plan ? t(MEAL_PLAN_LABEL_KEYS[trip.meal_plan]) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    flights: data.flights.map(legText).join(" · "),
    cities: cities
      .map((c) => {
        const hotel = data.hotels.find((h) => h.city_name === c.city_name)?.hotel_name;
        return `${c.city_name} (${nightsText(c.nights, language)})${hotel ? ` — ${hotel}` : ""}`;
      })
      .join(" · "),
    transport: [
      `${tx("transferCar")}: ${vehicleText(plan.airport) || "—"}`,
      toursOn ? `${tx("tourCar")}: ${vehicleText(plan.tours) || "—"}` : "",
      `${tx("between")}: ${MODE_CHIPS.filter((m) => modes.includes(m.mode)).map((m) => tx(m.label)).join("، ")}`,
    ]
      .filter(Boolean)
      .join(" · "),
    pricing: data.pricing.items.length > 0 ? `${tx("total")}: ${summary.total_sell.toLocaleString("en-US")} ${display}` : tx("noLines"),
    finish: produced ?? (blocking.length > 0 ? tx("missing") : tx("allGood")),
  };
  const titleOf: Record<Step, string> = {
    client: tx("booking"),
    flights: t("pg.flightsTitle"),
    cities: tx("citiesStep"),
    transport: tx("transport"),
    pricing: tx("pricing"),
    finish: tx("finish"),
  };
  const fold = (step: Step, body: ReactNode) =>
    shown(step) ? (
      <Fold key={step} id={`basic-${step}`} title={titleOf[step]} open={open === step} onOpen={() => show(step)} summary={summaryOf[step]}>
        {body}
        {step === "finish" ? null : <NextButton missing={missingOf[step]} onNext={() => next(step)} />}
      </Fold>
    ) : null;

  const includes: { key: keyof DraftScope | "tours"; icon: typeof Car }[] = [
    { key: "hotels", icon: Building2 },
    { key: "flights_intl", icon: Plane },
    { key: "flights_domestic", icon: PlaneTakeoff },
    { key: "transport", icon: BusFront },
    { key: "tours", icon: Camera },
    { key: "services", icon: ConciergeBell },
    { key: "visas", icon: Stamp },
  ];

  const body: Record<Step, ReactNode> = {
    // ---- 1. the customer and the trip, and what the programme includes ----
    client: (
      <>
        {/* who: four equal columns */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <label className={basicLabel}>
            {tx("country")}
            <select value={country?.name ?? trip.country} onChange={(e) => setCountry(e.target.value)} className={basicField}>
              <option value="">{tx("choose")}</option>
              {lookups.countries.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className={basicLabel}>
            {tx("agent")}
            <select
              value={partner ?? ""}
              onChange={(e) => {
                const p = lookups.partners.find((x) => x.id === e.target.value);
                patch({ customer: { ...data.customer, partner_company_id: p?.id ?? null, company: p?.name ?? "" } });
              }}
              className={basicField}
            >
              <option value="">{tx("direct")}</option>
              {lookups.partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {/* the phone first: a few digits find the customer in Teletel and fill the name */}
          <BasicPhoneLookup
            label={tx("phone")}
            phone={data.customer.customer_phone}
            onPhone={(customer_phone) => patch({ customer: { ...data.customer, customer_phone } })}
            onPick={(hit) => patch({ customer: { ...data.customer, customer_name: hit.name, customer_phone: hit.phone } })}
          />
          <label className={basicLabel}>
            {tx("customer")}
            <input value={data.customer.customer_name} onChange={(e) => patch({ customer: { ...data.customer, customer_name: e.target.value } })} className={basicField} />
          </label>
        </div>

        {/* when and how many: the nights sit between the two dates they join */}
        <div className="mt-2 grid grid-cols-3 gap-2 lg:grid-cols-[1.3fr_0.8fr_1.3fr_0.7fr_0.7fr_0.7fr_0.7fr_1.3fr]">
          <label className={basicLabel}>
            {tx("start")}
            <input type="date" dir="ltr" value={trip.arrival_date ?? ""} onChange={(e) => setTrip({ arrival_date: e.target.value || null })} className={`${basicField} tv-tnum px-2`} />
          </label>
          <label className={basicLabel}>
            {tx("nights")}
            <select value={trip.nights} onChange={(e) => setTrip({ nights: Number(e.target.value) })} className={basicField}>
              {range(0, 45).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className={basicLabel}>
            {tx("returnDate")}
            <input
              type="date"
              dir="ltr"
              value={trip.departure_date ?? ""}
              min={trip.arrival_date ?? undefined}
              onChange={(e) => setTrip({ departure_date: e.target.value || null })}
              className={`${basicField} tv-tnum px-2`}
            />
          </label>
          {(["adults", "children", "infants"] as const).map((k) => (
            <label key={k} className={basicLabel}>
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
                className={basicField}
              >
                {range(k === "adults" ? 1 : 0, 20).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          ))}
          <label className={basicLabel}>
            {tx("rooms")}
            <select value={trip.rooms} onChange={(e) => setRoomsCount(Number(e.target.value))} className={basicField}>
              {range(1, 10).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className={`${basicLabel} col-span-2 lg:col-span-1`}>
            {tx("meals")}
            <select value={trip.meal_plan ?? ""} onChange={(e) => setMeals(e.target.value as MealPlan | "")} className={basicField}>
              <option value="">{tx("choose")}</option>
              {MEAL_PLANS.map((m) => (
                <option key={m} value={m}>{t(MEAL_PLAN_LABEL_KEYS[m])}</option>
              ))}
            </select>
          </label>
        </div>

        {/* a child's age changes the hotel and the ticket price — asked as soon as there is a child */}
        {trip.children_ages.length > 0 || trip.infant_ages.length > 0 ? (
          <div className="mt-2 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbf9] px-2.5 py-2">
            <p className="mb-1.5 text-[10.5px] font-bold text-[#557d78]">{t("pg.agesHint")}</p>
            <div className="flex flex-wrap gap-2">
              {(["children_ages", "infant_ages"] as const).flatMap((field) => {
                const kind = field === "children_ages" ? "children" : "infants";
                const band = AGE_BANDS[kind];
                return trip[field].map((age, i) => (
                  <label key={`${field}${i}`} className={`${basicLabel} w-24`}>
                    {t(kind === "children" ? "pg.childAgeN" : "pg.infantAgeN", { n: i + 1 })}
                    <select
                      value={age}
                      onChange={(e) =>
                        setTrip({ [field]: trip[field].map((a, k) => (k === i ? clampAge(kind, Number(e.target.value)) : a)) })
                      }
                      className={`${basicField} tv-tnum px-1.5`}
                    >
                      {range(band.min, band.max).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ));
              })}
            </div>
          </div>
        ) : null}

        {/* «البرنامج يشمل» — small chips, after the program-includes spec; the details come in their own steps */}
        <div className="mt-3 border-t border-dashed border-[#DCE9E5] pt-2.5">
          <h3 className="mb-2 text-[13px] font-bold text-[#15483F]">{tx("includes")}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {includes.map(({ key, icon }) =>
              key === "tours" ? (
                <Chip
                  key={key}
                  on={toursOn}
                  icon={icon}
                  label={t("pg.scope.tours")}
                  onClick={() => commit({ transport_plan: { ...plan, tours: { ...plan.tours, enabled: !toursOn } } })}
                />
              ) : (
                <Chip
                  key={key}
                  on={key === "flights_domestic" ? modes.includes("flight") : scope[key]}
                  icon={icon}
                  label={key === "visas" ? tx("visa") : t(SCOPE_LABEL_KEYS[key])}
                  onClick={() => toggleScope(key)}
                />
              ),
            )}
          </div>
        </div>
      </>
    ),

    // ---- 2. the flights — the generator's own card, with the trip's dates already in it ----
    flights: (
      <div className="-mx-3 -mb-1 [&>section]:border-0 [&>section]:p-3 [&>section]:shadow-none [&_h2]:hidden">
        <FlightsStage draftId={draftId} data={data} patch={commit} replace={replace} flush={flush} lookups={lk} compact />
      </div>
    ),

    // ---- 3. the cities, each with its hotel, and the bar that adds them ----
    cities: (
      <div className="space-y-3">
        {cities.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[12.5px] font-semibold text-[#93aaa3]">{tx("noCities")}</p>
        ) : (
          cities.map((city, i) => {
            const dayFrom = dayCursor;
            dayCursor += city.nights;
            const prev = cities[i - 1]?.city_name;
            // several ways between cities: each arrival says which one it took
            const hop =
              prev && modes.length > 1 ? (
                <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#557d78]">
                  {tx("hop", { city: prev })}
                  <select
                    value={hopMode(plan, prev, city.city_name)}
                    onChange={(e) => setHop(prev, city.city_name, e.target.value as TransportMode)}
                    className="h-7 rounded-[7px] border border-[#cfe0d9] bg-white px-1 text-[12px] font-bold text-[#185045]"
                  >
                    {MODE_CHIPS.filter((m) => modes.includes(m.mode)).map((m) => (
                      <option key={m.mode} value={m.mode}>{tx(m.label)}</option>
                    ))}
                  </select>
                </label>
              ) : undefined;
            return (
              <BasicCityCard
                key={`${i}-${city.city_name}`}
                index={i}
                city={city}
                dayFrom={dayFrom}
                draftId={draftId}
                data={data}
                lookups={lk}
                hotelsOn={scope.hotels}
                toursOn={toursOn}
                hop={hop}
                flush={flush}
                replace={replace}
                onNights={(n) => commit(setCityNights(data, i, n))}
                onTours={(n) => commit({ cities: cities.map((c, k) => (k === i ? { ...c, tours: n } : c)) })}
                onLines={setLines}
                onSlice={commit}
                onRemove={() => {
                  if (window.confirm(tx("confirmRemove", { city: city.city_name }))) commit(removeCity(data, i));
                }}
              />
            );
          })
        )}

        {/* the add bar, like the company's system */}
        <div className="sticky bottom-3 z-20 rounded-[14px] border border-[#cfe0d9] bg-[#e9f3ef]/95 px-2 py-1.5 shadow-[0_8px_24px_rgba(0,60,58,0.12)] backdrop-blur max-lg:bottom-[80px] sm:px-2.5">
          <div className="flex flex-wrap items-end gap-1.5">
            {/* a group may cross into a neighbouring country */}
            <label className={`${basicLabel} w-24 shrink-0 sm:w-32`}>
              {tx("country")}
              <select
                value={barCountry?.name ?? ""}
                onChange={(e) => {
                  setNewCountry(e.target.value);
                  pickCity("");
                }}
                className={`${basicField} px-1.5`}
              >
                <option value="">{tx("choose")}</option>
                {lookups.countries.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className={`${basicLabel} min-w-28 flex-1`}>
              {tx("city")}
              <select value={newCity} onChange={(e) => pickCity(e.target.value)} disabled={!barCountry} className={basicField}>
                <option value="">{tx("choose")}</option>
                {(barCountry?.cities ?? []).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            {/* the city chosen: its hotels, the room and how many — shown only now */}
            {newCity && scope.hotels ? (
              <>
                <label className={`${basicLabel} min-w-36 flex-[1.5]`}>
                  {tx("hotel")}
                  <select value={newHotel} onChange={(e) => setNewHotel(e.target.value)} className={basicField}>
                    <option value="">{tx("choose")}</option>
                    {barHotels.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                        {h.stars ? ` ${"★".repeat(h.stars)}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${basicLabel} w-32 shrink-0 sm:w-40`}>
                  {tx("roomType")}
                  <input list="basic-bar-rooms" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} className={basicField} />
                  <datalist id="basic-bar-rooms">
                    {barRoomNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
                <label className={`${basicLabel} w-14 shrink-0`}>
                  {tx("rooms")}
                  <select value={roomsChoice} onChange={(e) => setNewRooms(Number(e.target.value))} className={`${basicField} px-1.5`}>
                    {range(1, 10).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className={`${basicLabel} w-14 shrink-0`}>
              {tx("nights")}
              <select value={nightsChoice} onChange={(e) => setNewNights(Number(e.target.value))} className={`${basicField} px-1.5`}>
                {range(1, 30).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {toursOn ? (
              <label className={`${basicLabel} w-14 shrink-0`}>
                {tx("tours")}
                <select value={Math.min(newTours, nightsChoice - 1)} onChange={(e) => setNewTours(Number(e.target.value))} className={`${basicField} px-1.5`}>
                  {range(0, Math.max(nightsChoice - 1, 0)).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={onAdd}
              disabled={!newCity}
              aria-label={tx("add")}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[8px] bg-[#185045] px-2.5 text-[12.5px] font-extrabold text-white disabled:opacity-50 sm:px-3.5"
            >
              <Plus className="size-4" />
              <span className="max-sm:hidden">{tx("add")}</span>
            </button>
            <span className={`tv-tnum hidden h-9 shrink-0 items-center gap-1 rounded-[8px] px-2.5 text-[11.5px] font-bold md:inline-flex ${nightsTone}`}>
              <MapPin className="size-3.5" />
              {nightsNote}
            </span>
          </div>
          <p className={`tv-tnum mt-1 rounded-[7px] px-2 py-0.5 text-[10.5px] font-bold md:hidden ${nightsTone}`}>{nightsNote}</p>
        </div>
      </div>
    ),

    // ---- 4. how the group moves ----
    transport: (
      <div className="flex flex-wrap items-end gap-2">
        {(["airport", ...(toursOn ? ["tours" as const] : [])] as ("airport" | "tours")[]).map((leg) => (
          <div key={leg} className="flex items-end gap-1">
            <label className={`${basicLabel} w-40`}>
              {tx(leg === "airport" ? "transferCar" : "tourCar")}
              <select value={plan[leg].car_type} onChange={(e) => setLeg(leg, { car_type: e.target.value })} className={basicField}>
                <option value="">{tx("choose")}</option>
                {lookups.carTypes.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.pax ? ` (${c.pax})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${basicLabel} w-14`}>
              {tx("cars")}
              <select value={plan[leg].cars} onChange={(e) => setLeg(leg, { cars: Number(e.target.value) })} className={`${basicField} px-1.5`}>
                {range(1, 10).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        ))}
        <div className="grid gap-1">
          <span className={basicLabel}>{tx("between")}</span>
          <div className="flex flex-wrap gap-1.5">
            {MODE_CHIPS.map(({ mode, label, icon }) => (
              <Chip key={mode} on={modes.includes(mode)} icon={icon} label={tx(label)} onClick={() => toggleMode(mode)} />
            ))}
          </div>
        </div>
      </div>
    ),

    // ---- 5. the price (sell side only, for whoever may see prices) ----
    pricing: (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="ms-auto inline-flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
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
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60"
              >
                {pricingBusy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {tx("calc")}
              </button>
            </div>
            {pricingError ? <p role="alert" className="mb-2 text-[12px] font-bold text-[#c22850]">{pricingError}</p> : null}
            {data.pricing.items.length === 0 ? (
              <p className="text-[12px] font-semibold text-[#93aaa3]">{tx("noLines")}</p>
            ) : (
              <div className="divide-y divide-[#edf3f0]">
                {data.pricing.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-1.5 sm:grid-cols-[1fr_60px_120px_84px]">
                    <span className="min-w-0 truncate text-[12px] font-bold text-[#185045]">{item.description}</span>
                    <span className="tv-tnum hidden text-center text-[11.5px] font-bold text-[#557d78] sm:block">× {item.quantity}</span>
                    <input
                      type="number"
                      min={0}
                      dir="ltr"
                      aria-label={tx("sell")}
                      value={item.sell_price ?? ""}
                      onChange={(e) => setItem(i, { sell_price: e.target.value === "" ? null : Number(e.target.value) })}
                      className={`${basicField} tv-tnum text-center`}
                    />
                    <select value={item.sell_currency || display} onChange={(e) => setItem(i, { sell_currency: e.target.value })} className={`${basicField} px-1.5`}>
                      {currencyOptions(lookups.countries, item.sell_currency || display).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2.5">
                  <span className="text-[13px] font-extrabold text-[#003c3a]">{tx("total")}</span>
                  <span className="tv-tnum text-[15px] font-extrabold text-[#0f7a52]">
                    <DirText>{`${summary.total_sell.toLocaleString("en-US")} ${display}`}</DirText>
                  </span>
                </div>
              </div>
            )}
          </div>
    ),

    // ---- 6. what is missing, and issuing — here ----
    finish: (
        <div>
          {produced ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#e9f7f0] px-3 py-1.5 text-[12.5px] font-extrabold text-[#0f7a52]">
                <CheckCircle2 className="size-4" />
                {t("pg.producedSerial")}
                <DirText dir="ltr" className="tv-tnum">{produced}</DirText>
              </span>
              <Link href={`/client-offer/${produced}`} target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12.5px] font-bold text-white hover:bg-[#0f4439]">
                <Link2 className="size-4" />
                {t("pg.openClientLink")}
              </Link>
              <a href={`/offer/${produced}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#d8e3de] px-3 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]">
                <FileText className="size-4" />
                {t("pg.viewPdf")}
              </a>
            </div>
          ) : (
            <>
              {blocking.length === 0 ? (
                <p className="inline-flex items-center gap-2 text-[13px] font-bold text-[#0f7a52]">
                  <CheckCircle2 className="size-4" />
                  {tx("allGood")}
                </p>
              ) : (
                <>
                  <h3 className="mb-2 inline-flex items-center gap-2 text-[13px] font-extrabold text-[#a86a10]">
                    <AlertTriangle className="size-4" />
                    {tx("missing")}
                  </h3>
                  <ul className="space-y-1">
                    {blocking.map((issue, i) => {
                      const target = STEP_OF[issue.stage];
                      return (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[#5b4a2a]">
                        <span className="rounded-full bg-[#fff3d6] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">{stageLabel(issue.stage)}</span>
                        <span className="min-w-0 flex-1">{issueText(issue)}</span>
                        {target && steps.includes(target) ? (
                          <button type="button" onClick={() => show(target)} className="text-[11.5px] font-bold text-[#185045] underline">
                            {tx("fix")}
                          </button>
                        ) : (
                          // services lists, terms: only the full generator edits those
                          <Link href={stageHref(draftId, issue.stage)} onClick={() => void flush()} className="text-[11.5px] font-bold text-[#185045] underline">
                            {tx("fix")}
                          </Link>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {produceError ? <p role="alert" className="mt-2 text-[12px] font-bold text-[#c22850]">{produceError}</p> : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void produce()}
                  disabled={producing || blocking.length > 0}
                  title={blocking.length > 0 ? t("pg.err.blockingLeft") : undefined}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-[13px] font-extrabold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {producing ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                  {tx("issue")}
                </button>
              </div>
            </>
          )}
        </div>
    ),
  };

  return (
    <TraveliunShell title="nav.basic">
      <FieldIssueProvider issues={[...validation.blocking, ...validation.warnings]} render={issueText}>
        <div className="tv-fade-up space-y-3">
          {/* top bar */}
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/basic" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12px] font-bold text-[#557d78] hover:bg-[#f4f8f6]">
              <ArrowRight className="size-4 ltr:rotate-180" />
              {tx("back")}
            </Link>
            <span
              role="status"
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-bold ${
                saveState === "error" ? "bg-[#fdeef2] text-[#c22850]" : saveState === "saving" ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#e9f7f0] text-[#0f7a52]"
              }`}
            >
              {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : saveState === "error" ? <XCircle className="size-3.5" /> : <Check className="size-3.5" />}
              {saveState === "saving" ? t("pg.saving") : saveState === "error" ? t("pg.saveFailed") : t("pg.saved")}
            </span>
            {saveState === "error" ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex h-8 items-center rounded-[8px] bg-[#c22850] px-2.5 text-[11.5px] font-bold text-white"
              >
                {tx("reload")}
              </button>
            ) : null}
            <Link
              href={stageHref(draftId, "trip")}
              onClick={() => void flush()}
              className="ms-auto inline-flex h-8 items-center rounded-[8px] px-2 text-[11.5px] font-bold text-[#557d78] underline-offset-2 hover:underline"
            >
              {tx("fullGenerator")}
            </Link>
          </div>

          {/* one step open at a time; the done ones fold to a line, the next ones wait */}
          {steps.map((step) => fold(step, body[step]))}
        </div>
      </FieldIssueProvider>
    </TraveliunShell>
  );
}
