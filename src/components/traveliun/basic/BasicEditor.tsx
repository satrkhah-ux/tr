"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  BusFront,
  Camera,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
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
  RefreshCw,
  Rocket,
  Ship,
  Stamp,
  TrainFront,
  XCircle,
  ScrollText,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { CatalogAddDialog } from "../CatalogAddDialog";
import { withCatalogAdditions } from "@/lib/catalog/reference-lookups";
import type { DataRow } from "@/lib/data/types";
import { getCountryHotels, produceOfferFromDraft } from "@/lib/data/drafts";
import { getCountryCarCapacities, getTourPrices, getTourPrograms, getTransferCars } from "@/lib/data/tour-programs";
import { autoTourPicks, withTours, type TourProgram } from "@/lib/offer/itinerary";
import { suggestPricingForDraft } from "@/lib/data/pricing-suggest";
import { announceWalkIn } from "@/lib/data/office-screens";
import { displayName, serviceLine, walkInKind } from "@/lib/office-screens/config";
import type { ProfitSettings } from "@/lib/data/app-settings";
import {
  AGE_BANDS,
  cityHotelLines,
  clampAge,
  currencyOptions,
  findLookupCountry,
  fromUnit,
  hopKey,
  hopMode,
  inheritBoard,
  intercityModes,
  MEAL_PLAN_BOARD,
  MEAL_PLAN_LABEL_KEYS,
  MEAL_PLANS,
  moveTripCountry,
  perUnit,
  resizeAges,
  resizeRooms,
  SCOPE_LABEL_KEYS,
  sheetStayUnits,
  stageHref,
  STAGES,
  stayTotal,
  soldHotels,
  totalCityNights,
  type DraftData,
  type DraftHotel,
  type DraftScope,
  type DraftTrip,
  type GeneratorLookups,
  type LookupHotel,
  type MealPlan,
  type TransportMode,
  roomPickName,
  keepNightlyRates,
  flightsLater,
} from "@/lib/offer/draft-types";
import { alignTripToFlights, flightHops, legGaps, withCitiesFromFlights, withLegFares } from "@/lib/offer/basic-flights";
import { domesticMismatches } from "@/lib/offer/flight-cities";
import { ROOM_TYPES } from "@/lib/catalog/room-catalog";
import {
  addCity,
  airportDisplay,
  arrivalAirport,
  basicDays,
  carForGroup,
  withCountryCapacities,
  type CountryCarCapacity,
  cityAirport,
  cityMoves,
  HOME_AIRPORT,
  planInternational,
  withAdvancedAirports,
  findAirport,
  packageProfitFor,
  priceAtSource,
  resizeGroupCars,
  tripCountries,
  withDomesticFlights,
  withGroupCars,
  withPackageProfit,
  typedSheetPrice,
  withScopeLines,
  type FlightPlan,
  chainCities,
  remainingNights,
  removeCity,
  moveCity,
  replaceCity,
  setCityNights,
  setClientBooked,
  setClientHotel,
  setEdge,
  withHotelLines,
  withTripDates,
  priceGroupOf,
  type BasicCity,
  type PriceGroup,
} from "@/lib/offer/basic";
import { citiesWithoutHotel, validateDraft, type DraftIssue } from "@/lib/offer/draft-validation";
import { computeOfferPricing, editedPricing, rebase, roundUpTotal } from "@/lib/offer/pricing";
import { pricesForCity, repricedTour, syncSuggestions, syncTypedPricing, type TourPrice } from "@/lib/offer/pricing-suggest";
import { normAr } from "@/lib/catalog/norm";
import { syncDepartureDates } from "@/lib/offer/schedule";
import { useRole } from "@/lib/roles/RoleContext";
import { useCanOpen } from "@/lib/roles/useCanOpen";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { FieldIssueProvider } from "../generator/FieldIssue";
import { ServicesStage } from "../generator/stages/ServicesStage";
import { TermsStage } from "../generator/stages/TermsStage";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useDraftState } from "../generator/useDraftState";
import { useNewDeploy } from "../useNewDeploy";
import { BasicCityCard } from "./BasicCityCard";
import { BasicFlightPlan } from "./BasicFlightPlan";
import { BasicHopFlight, gapWords } from "./BasicHopFlight";
import { BasicFileStatus } from "./BasicFileStatus";
import { BasicPhoneLookup } from "./BasicPhoneLookup";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import { nightsText, roomsText, useBasicLabels, type BasicLabel } from "./labels";
import { basicCard, basicField, basicLabel, typedNumber } from "./styles";
import { HotelCombobox } from "./HotelCombobox";
import { BasicEdges } from "./BasicEdges";
import { DOM_KEYS, fileSections, SECTION_ORDER, sectionOf, type Section } from "./flow";
import { AdvancedQuestions } from "./AdvancedQuestions";
import { advancedDefaults, advancedTripDates, emptyAdvanced, fillAdvanced, isStation, type DraftAdvanced } from "@/lib/offer/advanced";
import { IssueGuardNotice } from "../IssueGuardNotice";
import { OfferVersions } from "../OfferVersions";
import { ReissueOffer } from "../ReissueOffer";
import { PriceUpdate } from "./PriceUpdate";
import { OverlandHopNotice } from "../OverlandHopNotice";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Hotels are entered in riyals unless the agent says otherwise. */
const BASE_CURRENCY = "SAR";
/** The «يشمل» line the SIM count writes. */
const SIM_LINE = "شريحة اتصال";
/** «الوكيل / الشركة» with the client's answers — hidden for now, every file a direct client (owner, 2026-10-17). */
const SHOW_AGENT = false;
const MODE_CHIPS: { mode: TransportMode; label: BasicLabel; icon: typeof Car }[] = [
  { mode: "car", label: "byCar", icon: Car },
  { mode: "flight", label: "byFlight", icon: PlaneTakeoff },
  { mode: "train", label: "byTrain", icon: TrainFront },
  { mode: "ship", label: "byShip", icon: Ship },
];
/** The pricing sheet's groups, in the order the agency sells in. */
const PRICE_GROUPS: { key: PriceGroup; label: BasicLabel; icon: typeof Car }[] = [
  { key: "flights", label: "groupFlights", icon: Plane },
  { key: "hotels", label: "groupHotels", icon: Building2 },
  { key: "transport", label: "groupTransport", icon: BusFront },
  { key: "tours", label: "groupTours", icon: Camera },
  { key: "services", label: "groupServices", icon: ConciergeBell },
  { key: "visas", label: "groupVisas", icon: Stamp },
  { key: "other", label: "groupOther", icon: Plus },
];

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
 * A section that folds to one line once it is done: «متابعة» closes it, a press
 * on the line opens it again. Keeps the screen on what is still to be entered —
 * a folded section that still lacks something says what, in amber.
 */
function Fold({
  id,
  title,
  open,
  onOpen,
  summary,
  missing,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onOpen: () => void;
  summary: ReactNode;
  missing: string[];
  children: ReactNode;
}) {
  const tx = useBasicLabels();
  // the section being edited stands out in the brand's dark green — the agent sees at once where they are
  // working (the owner, 2026-10-24: «المكان الذي ادخل فيه وابدأ التعديلات يتميز بلون … أخضر غامق»)
  if (open)
    return (
      <section
        id={id}
        aria-current="step"
        className="scroll-mt-20 overflow-hidden rounded-[14px] border-2 border-[#185045] bg-white shadow-[0_8px_24px_rgba(24,80,69,0.16)] dark:bg-[#10201c]"
      >
        <header className="flex items-center gap-2 bg-[#185045] px-3.5 py-2.5 text-white">
          <Pencil className="size-4 shrink-0" aria-hidden />
          <h2 className="text-[14px] font-extrabold">{title}</h2>
          <span className="ms-auto rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold">{tx("editingHere")}</span>
        </header>
        <div className="p-3">{children}</div>
      </section>
    );
  return (
    <button
      id={id}
      type="button"
      onClick={onOpen}
      className={`${basicCard} flex w-full scroll-mt-20 items-center gap-2 py-2.5 text-start hover:border-[#a9cbbf]`}
    >
      {missing.length > 0 ? <AlertTriangle className="size-4 shrink-0 text-[#a86a10]" /> : <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" />}
      <span className="shrink-0 text-[13px] font-extrabold text-[#003c3a]">{title}</span>
      <span className={`tv-tnum min-w-0 flex-1 truncate text-[12px] font-semibold ${missing.length > 0 ? "text-[#a86a10]" : "text-[#557d78]"}`}>
        {missing.length > 0 ? tx("needFirst", { list: missing.join("، ") }) : summary}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-bold text-[#185045]">
        <Pencil className="size-3.5" />
        {tx("edit")}
      </span>
    </button>
  );
}

/**
 * «متابعة» with what still stops it, in words. No «السابق»: the sections above are
 * one line each, and a press on one opens it again (nothing entered is lost).
 */
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
  const route = `${code(f.from_airport, f.from_city)} → ${code(f.to_airport, f.to_city)}`;
  return f.flight_no ? `${f.flight_no} ${route}` : `${route} ${(f.departure_at ?? "").slice(0, 10)}`.trim();
}

/**
 * «النظام بيسك» — the whole file on one page, the way the company's own system
 * asks for it: the customer and the trip once, what the programme includes, the
 * international flights, then the hotels city by city (a bar adds a city with its
 * nights), the domestic flights between them, and each city's programme and
 * tours (the owner, 2026-10-25) — sections that open one after another, never
 * shown as numbered stages. Nothing entered once is asked again; what follows from
 * it (dates, rooms, meals, the programme's day titles) is filled in and kept
 * under «معلومات إضافية». The package is issued from here too.
 *
 * It edits the same draft as the full generator, through the same auto-save, so
 * either screen can pick the file up where the other left it.
 */
/**
 * What the page loaded at once for the file as it opens (app/basic/[draftId]/page.tsx) — the
 * hotels of its countries, the cars and tour prices they price, its cities' ready programmes,
 * the transfers' list prices — so the editor asks the server only for a country or a city added
 * later (the owner, 2026-10-19: «ثقيلة» — seven lookups one after another, 6.4 s before it settled).
 */
export type BasicPreload = {
  hotelsByCountry: Record<string, Record<string, LookupHotel[]>>;
  carsKey: string;
  cars: string[];
  pricesKey: string;
  prices: TourPrice[];
  programsKey: string;
  programs: TourProgram[];
  /** null: not loaded (an issued file — they are not needed to open it) */
  listPrices: Record<string, { price: number; currency: string }> | null;
};

export function BasicEditor({
  draftId,
  initialData,
  savedAt,
  lookups: initialLookups,
  profitSettings,
  preload,
}: {
  draftId: string;
  initialData: DraftData;
  /** the draft's last server save — unsaved edits kept in the browser come back onto an older one. */
  savedAt: string;
  lookups: GeneratorLookups;
  /** who may set the package profit, and the margin a file starts with (settings, by the administration). */
  profitSettings: ProfitSettings;
  preload?: BasicPreload;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  const partnerSession = usePartnerBrand();
  const [addedCountries, setAddedCountries] = useState<DataRow[]>([]);
  const [addedCities, setAddedCities] = useState<DataRow[]>([]);
  const [catalogAdd, setCatalogAdd] = useState<{ table: "cities" | "countries"; target: "trip" | "bar"; countryId?: string } | null>(null);
  const lookups = useMemo(() => withCatalogAdditions(initialLookups, addedCountries, addedCities), [initialLookups, addedCountries, addedCities]);
  // the full generator's pages, while the developer has the legacy generator on
  // (a partner always: it is their «ملفاتي») — off, its addresses only lead back here
  const legacyOpen = useCanOpen()({ href: "/package-generator" });
  const { data, patch, replace, flush, saveState, restored } = useDraftState(draftId, initialData, savedAt);
  const [restoredSeen, setRestoredSeen] = useState(false);
  // a new deploy: what is typed goes up first, then the bar — the agent reloads when ready
  const newDeploy = useNewDeploy();
  const [deployBar, setDeployBar] = useState(false);
  useEffect(() => {
    if (newDeploy) void flush().finally(() => setDeployBar(true));
  }, [newDeploy, flush]);
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
    const transport_plan = withGroupCars(
      { ...p, intercity: { ...p.intercity, enabled: chained.length > 1 } },
      carForGroup(groupCars.current, merged.trip.adults + merged.trip.children),
    );
    // a domestic flight is one of the ways between cities — the two switches are one fact
    const nextScope = { ...merged.scope, flights_domestic: intercityModes(transport_plan).includes("flight") };
    // a move by air becomes its planned domestic leg — the agent never types a route the cities already say
    const domestic = withDomesticFlights({ ...merged, flights, cities: chained, transport_plan }, lookups.airports);
    // a leg's ticket is «للفرد»: the domestic booking follows its legs × the travellers — typed, added, or gone with its hop
    const flight_booking = withLegFares(merged.flight_booking, merged.trip, domestic.flights, latest.current.flights);
    const shaped = { ...merged, cities: chained, scope: nextScope, ...domestic, flight_booking };
    // the night's rate stays what the agent typed whatever moves the nights — split, merge, removal, the city's nights
    const hotels = keepNightlyRates(chained, withHotelLines(shaped, BASE_CURRENCY));
    // «بكج متقدم»: its dates follow Basic's until the agent types their own
    const advanced = merged.advanced?.on ? fillAdvanced(merged.advanced, advancedDefaults({ ...shaped, cities: chained })) : merged.advanced;
    const next = { ...shaped, hotels, advanced, days: basicDays({ ...shaped, hotels, advanced }) };
    const pricing = partnerSession ? next.pricing : syncTypedPricing(next);
    const priceChanged = pricing.items.some((item, i) => {
      const old = latest.current.pricing.items[i];
      return old && (item.sell_price !== old.sell_price || item.sell_currency !== old.sell_currency || item.quantity !== old.quantity);
    });
    next.pricing = priceChanged ? editedPricing(pricing, false) : pricing;
    latest.current = next;
    patch({
      ...slice,
      flights: shaped.flights,
      cities: chained,
      transport_plan: shaped.transport_plan,
      scope: nextScope,
      hotels,
      days: next.days,
      pricing: next.pricing,
      ...(flight_booking !== merged.flight_booking ? { flight_booking } : {}),
      ...(advanced && advanced !== merged.advanced ? { advanced } : {}),
    });
  }

  /**
   * «بكج متقدم» answers, and the dates the agent typed there carried into Basic's
   * trip — the same day is never asked twice. An empty package country takes the
   * country they are met in.
   */
  function setAdvanced(advanced: DraftAdvanced) {
    const d = advancedTripDates(advanced);
    const slice: Partial<DraftTrip> = {};
    if (d.arrival_date && d.arrival_date !== trip.arrival_date) slice.arrival_date = d.arrival_date;
    if (d.departure_date && d.departure_date !== trip.departure_date) slice.departure_date = d.departure_date;
    if (!trip.country && d.country) setCountry(d.country);
    const nextTrip = Object.keys(slice).length ? withTripDates(latest.current.trip, { ...slice, departure_date: slice.departure_date ?? latest.current.trip.departure_date }) : latest.current.trip;
    // the airports chosen here are the planned flights' too
    const flights = withAdvancedAirports({ ...latest.current, trip: nextTrip, advanced }, lookups.airports);
    commit({ advanced, ...(nextTrip !== latest.current.trip ? { trip: nextTrip } : {}), ...(flights ?? {}) });
  }

  /** The trip's answers; a visa line still counting every traveller keeps counting them. */
  function setTrip(slice: Partial<DraftTrip>) {
    const next = withTripDates(trip, slice);
    const pax = (t: DraftTrip) => t.adults + t.children + t.infants;
    const visas = data.visas.map((v) => (v.count === pax(trip) ? { ...v, count: pax(next) } : v));
    const seated = (t: DraftTrip) => carForGroup(groupCars.current, t.adults + t.children);
    commit({
      trip: next,
      ...(pax(next) !== pax(trip) ? { visas, transport_plan: resizeGroupCars(plan, seated(trip), seated(next)) } : {}),
    });
  }

  /** A new country: a flight still only planned (no ticket yet) now lands in it. */
  function setCountry(name: string) {
    const moved = moveTripCountry(data, lookups, { ...trip, country: name, destination: name });
    const out = data.flights.filter((f) => f.leg_order === "outbound");
    const planned = out.length > 0 && data.flights.every((f) => f.leg_order === "internal" || !f.flight_no.trim());
    if (!planned) return commit(moved);
    const next = { ...data, ...moved };
    const back = data.flights.find((f) => f.leg_order === "inbound");
    const to = arrivalAirport(next, lookups.airports, findLookupCountry(lookups.countries, name)?.iso2);
    commit({
      ...moved,
      ...planInternational(next, lookups.airports, {
        from: out[0].from_airport,
        to,
        go: (out[0].departure_at ?? "").slice(0, 10),
        back: (back?.departure_at ?? "").slice(0, 10),
        round: Boolean(back),
      }),
    });
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

  /** The first car chosen anywhere is the trip's car: every car still without one takes it. */
  const withCar = (p: DraftData["transport_plan"], car: string | undefined): DraftData["transport_plan"] =>
    !car
      ? p
      : {
          ...p,
          airport: p.airport.car_type.trim() ? p.airport : { ...p.airport, car_type: car },
          tours: p.tours.car_type.trim() ? p.tours : { ...p.tours, car_type: car },
          intercity: p.intercity.car_type.trim() ? p.intercity : { ...p.intercity, car_type: car },
          ...(p.farewell && !p.farewell.car_type.trim() ? { farewell: { ...p.farewell, car_type: car } } : {}),
        };

  function setLeg(leg: "airport" | "tours", slice: { car_type?: string; cars?: number }) {
    const next = { ...plan, [leg]: { ...plan[leg], ...slice } };
    // between cities rides the transfer car unless it is a flight, a train or a ship
    if (leg === "airport") next.intercity = { ...next.intercity, ...slice };
    commit({ transport_plan: withCar(next, slice.car_type) });
  }

  function setTourCar(slice: { car_type?: string; cars?: number }) {
    const old = plan.tours.car_type.trim();
    const to = slice.car_type?.trim();
    // the tours in the trip's car go in the new one, at its price on the list (a price typed by hand stays)
    const names = cities.map((c) => c.city_name);
    const sarPer = lookups.sarPer ?? { SAR: 1 };
    const follow =
      to !== undefined && to !== old
        ? {
            cities: cities.map((c) =>
              c.tour_picks
                ? {
                    ...c,
                    tour_picks: c.tour_picks.map((p) =>
                      p.car_type?.trim() && p.car_type.trim() !== old
                        ? p
                        : repricedTour({ ...p, car_type: undefined }, old, to, pricesForCity(tourPrices, c.city_name, names, normAr), sarPer),
                    ),
                  }
                : c,
            ),
          }
        : {};
    commit({ transport_plan: withCar({ ...plan, tours: { ...plan.tours, ...slice } }, slice.car_type), ...follow });
  }

  function toggleMode(mode: TransportMode) {
    const chosen = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode];
    const list = chosen.length > 0 ? chosen : (["car"] as TransportMode[]);
    commit({ transport_plan: { ...plan, intercity: { ...plan.intercity, modes: list, mode: list[0] } } });
  }

  /**
   * How one move is made, picked between the two cities' hotels. Every other move keeps the way it
   * goes now — a flight picked for one never sends the rest by air — and the trip's ways are the ones
   * its moves take: no move left by air, no domestic flight (its section goes with it).
   */
  function setHop(from: string, to: string, mode: TransportMode) {
    const p = latest.current.transport_plan;
    const now = { ...Object.fromEntries(cityMoves(latest.current).map((m) => [hopKey(m.from, m.to), hopMode(p, m.from, m.to)])), [hopKey(from, to)]: mode };
    // the road first while a move takes it: a city added later goes as the trip mostly goes
    const used = MODE_CHIPS.map((m) => m.mode).filter((m) => Object.values(now).includes(m));
    commit({ transport_plan: { ...p, intercity: { ...p.intercity, modes: used, mode: used[0], hop_modes: { ...p.intercity.hop_modes, ...now } } } });
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

  /** The SIM cards: one «يشمل» line, rewritten or dropped with the count. */
  function setSims(count: number) {
    const includes = data.services.includes.filter((l) => !l.startsWith(SIM_LINE));
    patch({ services: { ...data.services, includes: count > 0 ? [...includes, `${SIM_LINE} × ${count}`] : includes } });
  }

  // over the newest hotels (latest), not this render's: a TBO pick lands seconds later and must not undo the edits made meanwhile
  const setLines = (lines: DraftHotel[]) => commit({ hotels: latest.current.hotels.map((h) => lines.find((l) => l.id === h.id) ?? h) });

  // ---------- the catalogue, fetched per country ----------
  // The page opens without the 2,300 hotels of every country; the hotels of a
  // country arrive when the file first names it. Room types are the owner's
  // catalogue (src/lib/catalog), in the bundle — nothing to fetch.
  const [newCountry, setNewCountry] = useState("");
  const [hotelsByCountry, setHotelsByCountry] = useState<Record<string, Record<string, LookupHotel[]>>>(() => preload?.hotelsByCountry ?? {});
  const asked = useRef(new Set<string>(Object.keys(preload?.hotelsByCountry ?? {})));
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
  // the trip's countries' capacity rows (loaded with the transfer cars below)
  const [countryCaps, setCountryCaps] = useState<CountryCarCapacity[]>([]);
  const lk = useMemo<GeneratorLookups>(
    () => ({
      ...lookups,
      // the trip's countries' own seat/bag counts over the fleet's general ones (2026-10-26)
      carTypes: withCountryCapacities(lookups.carTypes, countryCaps),
      countries: lookups.countries.map((c) => {
        const byCity = hotelsByCountry[c.name];
        return byCity ? { ...c, cities: c.cities.map((city) => ({ ...city, hotels: byCity[city.id] ?? [] })) } : c;
      }),
    }),
    [lookups, hotelsByCountry, countryCaps],
  );
  // «بكج متقدم» opened on a file whose dates it has not taken yet: take them now
  useEffect(() => {
    const adv = latest.current.advanced;
    if (adv?.on && fillAdvanced(adv, advancedDefaults(latest.current)) !== adv) commit({ advanced: adv });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // «بكج متقدم» against a ticket already entered: never rewritten, said
  const ticketMismatch = (() => {
    const adv = data.advanced;
    if (!adv?.on || !data.flights.some((f) => f.leg_order !== "internal" && f.flight_no.trim())) return [];
    const code = (v: string) => findAirport(v, lookups.airports)?.code ?? "";
    const out = data.flights.filter((f) => f.leg_order === "outbound").at(-1);
    const back = data.flights.find((f) => f.leg_order === "inbound");
    const notes: string[] = [];
    if (adv.parts.arrival && adv.arrive_by === "flight" && adv.arrive_at && out && code(adv.arrive_at) !== code(out.to_airport))
      notes.push(`تذكرة الذهاب تهبط في ${out.to_airport}، وفي «بكج متقدم» الوصول إلى ${adv.arrive_at} — صحّح أحدهما`);
    if (adv.parts.departure && adv.leave_by === "flight" && adv.leave_from && back && code(adv.leave_from) !== code(back.from_airport))
      notes.push(`تذكرة العودة تُقلع من ${back.from_airport}، وفي «بكج متقدم» المغادرة من ${adv.leave_from} — صحّح أحدهما`);
    return notes;
  })();

  // «بكج متقدم» step ③: the first hotel Basic books, by name, city and country
  const firstStayText = (() => {
    const c = data.cities[0];
    if (!c) return "";
    const h = data.hotels.find((x) => x.city_name === c.city_name)?.hotel_name;
    return [h && `فندق ${h.replace(/^فندق\s+/, "")}`, [c.city_name, c.country || trip.country].filter(Boolean).join("، ")].filter(Boolean).join(" — ");
  })();

  // «بكج متقدم» picks its places from the catalogue
  const advancedLists = useMemo(() => {
    const wanted = new Set([trip.country, ...data.cities.map((c) => c.country ?? "")].filter(Boolean));
    const cityCountry = new Map(lk.countries.flatMap((c) => c.cities.map((x) => [x.name, c.name] as const)));
    return {
      stops: lk.airports.map((a) => {
        const label = `${a.name}${a.code ? ` (${a.code})` : ""}`;
        return { label, country: a.country || (a.city ? cityCountry.get(a.city) : undefined) || "", station: isStation(label) };
      }),
      cities: lk.countries.flatMap((c) => c.cities.map((x) => ({ name: x.name, country: c.name }))),
      hotels: Object.fromEntries(lk.countries.map((c) => [c.name, [...new Set(c.cities.flatMap((x) => x.hotels.map((h) => h.name)))]])),
      // the package's own countries first — the usual answer, one tap away
      countries: [...new Set([...wanted, ...lk.countries.map((c) => c.name)])],
      zones: Object.fromEntries(lk.countries.filter((c) => c.timezone).map((c) => [c.name, c.timezone!])),
    };
  }, [lk, trip.country, data.cities]);

  // ---------- the cars a group's default is picked from: those the trip's countries price transfers in ----------
  // (a ref: commit reads it; a country without a list keeps the whole fleet)
  const groupCars = useRef(lookups.carTypes);
  const transferCountries = tripCountries(data).sort().join("|");
  useEffect(() => {
    if (!transferCountries) return;
    let live = true;
    const loaded = preload && preload.carsKey === transferCountries ? Promise.resolve(preload.cars) : getTransferCars(transferCountries.split("|"));
    void Promise.all([loaded, getCountryCarCapacities(transferCountries.split("|")).catch(() => [])]).then(([names, caps]) => {
      if (!live) return;
      setCountryCaps(caps);
      // the countries' own capacities decide the default car too, not just the picker's labels
      const fleet = withCountryCapacities(lookups.carTypes, caps);
      const priced = fleet.filter((c) => names.includes(c.name));
      const was = groupCars.current;
      groupCars.current = priced.length > 0 ? priced : fleet;
      // the cars were filled before the country was chosen (the add bar, a new file): every car the
      // system chose — the group's size from the old set — becomes the country's; one the agent chose
      // stays. A file already issued keeps what it was issued with (the owner's review, 2026-10-18).
      const file = latest.current;
      if (file.produced_serial) return;
      const pax = file.trip.adults + file.trip.children;
      const next = carForGroup(groupCars.current, pax);
      let plan = file.transport_plan;
      for (const before of [carForGroup(was, pax), carForGroup(lookups.carTypes, pax)]) plan = resizeGroupCars(plan, before, next);
      if (plan !== file.transport_plan && JSON.stringify(plan) !== JSON.stringify(file.transport_plan)) commit({ transport_plan: plan });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the trip's countries decide; commit and the file are read when the list arrives
  }, [transferCountries, lookups.carTypes]);

  // ---------- the tours price list of the trip's countries ----------
  const [tourPrices, setTourPrices] = useState<TourPrice[]>(() => preload?.prices ?? []);
  const countryKey = tripCountries(data).sort().join("|");
  const pricesFor = useRef(preload?.pricesKey ?? "");
  useEffect(() => {
    if (!countryKey || countryKey === pricesFor.current) return;
    let live = true;
    void getTourPrices(countryKey.split("|")).then((list) => {
      if (!live) return;
      pricesFor.current = countryKey;
      setTourPrices(list);
    });
    return () => {
      live = false;
    };
  }, [countryKey]);

  // ---------- the ready programmes (tour_programs) of the file's cities ----------
  const [programs, setPrograms] = useState<TourProgram[]>(() => preload?.programs ?? []);
  const cityKey = [...new Set(cities.map((c) => c.city_name))].sort().join("|");
  const programsFor = useRef(preload?.programsKey ?? "");
  useEffect(() => {
    if (!cityKey || cityKey === programsFor.current) return;
    let live = true;
    void getTourPrograms(cityKey.split("|")).then((list) => {
      if (!live) return;
      programsFor.current = cityKey;
      setPrograms(list);
    });
    return () => {
      live = false;
    };
  }, [cityKey]);

  // a city's tours arrive filled: its empty rows take its programmes in order, priced from the list, and the
  // agent edits or swaps them (the owner, 2026-10-18). A file already issued keeps what it was issued with.
  useEffect(() => {
    const file = latest.current;
    if (programs.length === 0 || file.produced_serial || !file.transport_plan.tours.enabled) return;
    let changed = false;
    const next = file.cities.map((c, i) => {
      const picks = withTours(c, c.tours ?? 0, file.transport_plan.tours.cars, i === file.cities.length - 1);
      const filled = autoTourPicks(picks, programs.filter((p) => p.city_name === c.city_name));
      if (filled === picks) return c;
      changed = true;
      return { ...c, tour_picks: filled, tours: filled.length };
    });
    if (changed) commit({ cities: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the programmes arriving (or another city) decide; commit and the file are read then
  }, [programs, data.cities.length]);

  // ---------- the add bar ----------
  const left = remainingNights(data);
  const [newCity, setNewCity] = useState("");
  const [newNights, setNewNights] = useState(0);
  // null = not touched: the bar proposes a tour a day but the arrival day
  const [newTours, setNewTours] = useState<number | null>(null);
  // the stay, picked on the bar too — one «إضافة» books the city and its hotel
  const [newHotel, setNewHotel] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [newRooms, setNewRooms] = useState(0);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const [joinedNote, setJoinedNote] = useState<string | null>(null);
  const nightsChoice = newNights || Math.max(left, 1);
  // the arrival day is spent arriving: four nights hold up to three tours (the city card allows more)
  const maxTours = Math.max(nightsChoice - 1, 0);
  // nights − 1 tours unless the agent picks another number (the owner, 2026-10-26, asking for the 2026-10-15 default back
  // over the 2026-10-18 «one tour»)
  const toursChoice = newTours == null ? maxTours : Math.min(newTours, maxTours);
  const roomsChoice = newRooms || Math.max(trip.rooms, 1);
  // the trip's country unless the group crosses into a neighbour
  const barCountry = findLookupCountry(lk.countries, newCountry || trip.country);
  const barHotels = barCountry?.cities.find((c) => c.name === newCity)?.hotels ?? [];

  function pickCity(name: string) {
    setNewCity(name);
    setNewHotel("");
    setNewRoom("");
  }

  function onAdd() {
    if (!newCity) return;
    const hotel = barHotels.find((h) => h.id === newHotel);
    const { joined, ...added } = addCity(
        data,
        {
          name: newCity,
          nights: nightsChoice,
          tours: toursOn ? toursChoice : 0,
          country: barCountry?.name,
          hotel: hotel ? { id: hotel.id, name: hotel.name } : null,
          room: newRoom ? roomPickName({ room_type_code: newRoom }) : "",
          rooms: roomsChoice,
          price: newPrice,
        },
        BASE_CURRENCY,
      );
    commit(added);
    // the same city twice in a row: say what became of it — never a silent merge
    setJoinedNote(joined === "stay" ? tx("joinedStay", { city: newCity }) : joined === "nights" ? tx("joinedNights", { city: newCity, n: nightsChoice }) : null);
    pickCity("");
    setNewNights(0);
    setNewTours(null);
    setNewRooms(0);
    setNewPrice(null);
  }

  const used = totalCityNights(data.cities);
  // over first: `left` is clamped at 0, so a file one night too long also has none left
  const nightsNote =
    used > trip.nights ? tx("over", { n: used - trip.nights }) : trip.nights > 0 && left === 0 ? tx("complete") : tx("remaining", { n: left });
  const nightsTone = trip.nights > 0 && used === trip.nights ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-white text-[#a86a10]";

  // where the international flights land and leave from — the two ends of the domestic moves
  const intlLegs = data.flights.filter((f) => f.leg_order !== "internal").sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""));
  const landingCity = intlLegs.filter((f) => f.leg_order === "outbound").at(-1)?.to_city?.trim() ?? "";
  const homeCity = intlLegs.find((f) => f.leg_order === "inbound")?.from_city?.trim() ?? "";
  const flies = (a: string, b: string) => Boolean(cityAirport(a, lookups.airports, data.flights) && cityAirport(b, lookups.airports, data.flights));
  // how the group gets from one city to the next — asked between the two cities' hotels, every way on offer
  const hopLine = (a: string, b: string) => {
    const mode = hopMode(plan, a, b);
    const chip = MODE_CHIPS.find((m) => m.mode === mode) ?? MODE_CHIPS[0];
    return (
      <label key={`${a}>${b}`} className="flex flex-wrap items-center justify-center gap-2 px-2 text-[11.5px] font-bold text-[#557d78]">
        <chip.icon className="size-4 shrink-0 text-[#185045]" />
        {tx("hopBetween", { from: a, to: b })}
        <select
          value={mode}
          onChange={(e) => setHop(a, b, e.target.value as TransportMode)}
          className="h-7 rounded-[7px] border border-[#cfe0d9] bg-white px-1 text-[12px] font-bold text-[#185045]"
        >
          {MODE_CHIPS.map((m) => (
            <option key={m.mode} value={m.mode}>{tx(m.label)}</option>
          ))}
        </select>
      </label>
    );
  };

  // day numbers of each city: after any travel day, one city after another
  const travelDays = data.days.filter((d) => d.kind === "travel").length;
  const dayFroms = cities.map((_, i) => travelDays + 1 + cities.slice(0, i).reduce((n, c) => n + c.nights, 0));

  // ---------- pricing (sell side only) ----------
  // a partner company prices its own file: the server hands it our prices at its terms
  const canPricing = can("pricing.view") || partnerSession !== null;
  const canInternal = can("pricing.internal");
  // the agent sets the profit unless the administration keeps it for the managers
  const canSetProfit = canInternal || (profitSettings.by === "staff" && can("pricing.view"));
  const display = data.pricing.display_currency || "SAR";
  const [pricingBusy, setPricingBusy] = useState(false);
  // the profit is applied here for the eye and at issuing on the server — never written onto the lines,
  // so an agent without the cost (its lines arrive as sells) reads the same total the offer will carry
  const shownItems = useMemo(() => {
    const quote = data.pricing.display_currency || "SAR";
    const asCost = data.pricing.items.map((i) => (i.buy_price == null ? { ...i, buy_price: i.sell_price, buy_currency: i.sell_currency } : i));
    return withPackageProfit(asCost, packageProfitFor(data.pricing, profitSettings.default_pct), rebase(lookups.sarPer ?? { SAR: 1 }, quote) ?? {}, quote);
  }, [data.pricing, profitSettings.default_pct, lookups.sarPer]);
  const summary = useMemo(() => {
    const raw = computeOfferPricing(
      shownItems.map((i) => ({
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
    );
    // the total the client is sent: up to the whole unit, the difference is profit (offerTotals)
    const total_sell = roundUpTotal(raw.total_sell);
    const profit = Math.round((total_sell - raw.total_buy) * 100) / 100;
    return { ...raw, total_sell, profit, margin_pct: total_sell ? Math.round((profit / total_sell) * 10000) / 100 : null };
  }, [shownItems, display, lookups.sarPer]);

  // the transfers' list prices, worked out as the sheet would (the way back from the way there) and shown on
  // the city cards before anyone opens the sheet — the owner's review, 2026-10-18: four typed by hand
  const [listPrices, setListPrices] = useState<Record<string, { price: number; currency: string }>>(() => preload?.listPrices ?? {});
  // the hotels too: a city of several hotels has a transfer on each change of hotel
  const transferKey = JSON.stringify([plan, data.flights.map((f) => [f.from_airport, f.to_airport]), cities.map((c) => [c.city_name, c.nights, (c as BasicCity).services]), data.hotels.map((h) => [h.city_key, h.hotel_name, h.nights])]);
  // as it opened: priced by the page already, or an issued file that needs none — only a change prices again
  const openedWith = useRef(preload && (preload.listPrices || initialData.produced_serial) ? transferKey : null);
  useEffect(() => {
    if (!scope.transport || transferKey === openedWith.current) return;
    openedWith.current = null;
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        await flush();
        const res = await suggestPricingForDraft(draftId, { hotel: t("pg.hotel"), airline: t("pg.airline") });
        if (!live || !res.ok) return;
        const next: Record<string, { price: number; currency: string }> = {};
        for (const i of res.items) if (i.item_type === "transport" && i.ref && i.sell_price != null) next[i.ref] = { price: i.sell_price, currency: i.sell_currency || "SAR" };
        setListPrices(next);
      } catch {
        /* offline: the cards keep what they had, the sheet still prices */
      }
    }, 1500);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the road, the cars and the flights decide; the rest of the file does not
  }, [transferKey, scope.transport, draftId]);

  const [pricingError, setPricingError] = useState<string | null>(null);
  const [fareNote, setFareNote] = useState<string | null>(null);
  async function calculate() {
    setPricingBusy(true);
    setPricingError(null);
    try {
      // the server prices the SAVED draft
      await flush();
      const res = await suggestPricingForDraft(draftId, { hotel: t("pg.hotel"), airline: t("pg.airline") });
      if (!res.ok) return setPricingError(t(res.error));
      const pricing = latest.current.pricing;
      patch({ pricing: { ...pricing, items: syncSuggestions(pricing.items, res.items) } });
    } catch {
      // offline, or a tab from before a deploy: say so instead of spinning
      setPricingError(tx("serverLost"));
    } finally {
      setPricingBusy(false);
    }
  }

  /**
   * A price changed here is changed where it was typed — the hotel's rooms, the
   * tour, the flight booking — so the city card says the same. A line with no
   * such place (a transfer from the list, a visa) is the agent's: kept as
   * `overridden` when the prices are worked out again.
   */
  function setItem(index: number, slice: { sell_price?: number | null; sell_currency?: string }) {
    const item = data.pricing.items[index];
    setOpenGroups((o) => ({ ...o, [priceGroupOf(item)]: true }));
    setSavedGroup(null);
    // a «للفرد» flight priced here becomes «إجمالي» — said under its line
    const fare = item.ref === "flight:intl" ? latest.current.flight_booking.intl_fare : item.ref === "flight:dom" ? latest.current.flight_booking.dom_fare : null;
    if (fare?.price_mode === "per_person" && "sell_price" in slice) setFareNote(item.ref ?? null);
    const at = priceAtSource(latest.current, item, { price: slice.sell_price, currency: slice.sell_currency });
    // a typed figure is what we pay and what we sell at — with or without a place to write it back
    const both = typedSheetPrice(slice, Boolean(at));
    const items = data.pricing.items.map((it, i) => (i === index ? { ...it, ...both } : it));
    if (at) commit({ ...at, pricing: editedPricing({ ...data.pricing, items }, Boolean(partnerSession)) });
    else patch({ pricing: editedPricing({ ...data.pricing, items }, Boolean(partnerSession)) });
  }

  function setProfit(profit: NonNullable<DraftData["pricing"]["profit"]>) {
    patch({ pricing: editedPricing({ ...data.pricing, profit }, Boolean(partnerSession)) });
  }
  // what the box shows: the file's own profit, else the administration's default margin
  const profit = packageProfitFor(data.pricing, profitSettings.default_pct) ?? { mode: "pct" as const, value: null };

  // the sheet in groups, each with what it comes to — a flat list of fifteen lines said nothing
  const groups = PRICE_GROUPS.map((g) => {
    const rows = data.pricing.items.map((item, i) => ({ item, i })).filter(({ item }) => priceGroupOf(item) === g.key);
    const subtotal = computeOfferPricing(
      rows.map(({ item }) => ({
        quantity: item.quantity,
        buy_price: item.buy_price,
        buy_currency: item.buy_currency || display,
        sell_price: item.sell_price,
        sell_currency: item.sell_currency || display,
      })),
      rebase(lookups.sarPer ?? { SAR: 1 }, display) ?? {},
      display,
    ).total_sell;
    return { ...g, rows, subtotal, missing: rows.filter(({ item }) => item.sell_price == null).length };
  }).filter((g) => g.rows.length > 0);
  // a card with a price missing opens by itself; a complete one waits to be opened for a review
  const [openGroups, setOpenGroups] = useState<Partial<Record<PriceGroup, boolean>>>({});
  const [savedGroup, setSavedGroup] = useState<PriceGroup | null>(null);

  /** «حفظ» on a card: the sheet is written now, and a complete card folds — the agent sees it is done. */
  async function saveGroup(key: PriceGroup, complete: boolean) {
    try {
      await flush();
      setSavedGroup(key);
      if (complete) setOpenGroups((o) => ({ ...o, [key]: false }));
    } catch {
      setPricingError(tx("serverLost"));
    }
  }

  // ---------- what is still missing, and issuing ----------
  const validation = useMemo(() => validateDraft(data, { partnerFile: partnerSession !== null }), [data, partnerSession]);
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
  const [guardBlocked, setGuardBlocked] = useState(false);
  const produced = data.produced_serial;
  // the file's status (top bar + finish step) reads again after an issue, a send or a confirmation
  const [statusTick, setStatusTick] = useState(0);
  const bumpStatus = () => setStatusTick((n) => n + 1);

  async function produce() {
    if (producing || blocking.length > 0 || guardBlocked) return;
    setProducing(true);
    setProduceError(null);
    try {
      // the server issues the SAVED draft
      await flush();
      const result = await produceOfferFromDraft(draftId);
      if (!result.ok) return setProduceError(t(result.error));
      patch({ produced_serial: result.serial });
      // issued — nothing went to the client: the issuing section offers «أرسل إلى العميل عبر واتساب»
      bumpStatus();
    } catch {
      setProduceError(tx("serverLost"));
    } finally {
      setProducing(false);
    }
  }

  // ---------- the flights: planned first, ticketed later ----------
  const homeAirport = lookups.airports.find((a) => a.code === HOME_AIRPORT);
  const planDefaults: FlightPlan = {
    from: homeAirport ? airportDisplay(homeAirport) : "",
    to: arrivalAirport(data, lookups.airports, country?.iso2),
    go: trip.arrival_date ?? "",
    back: trip.departure_date ?? "",
    round: data.flight_booking.mode !== "oneway",
  };
  // the domestic legs, each on its move between two cities, in their own section — and what each still lacks
  const booking = data.flight_booking;
  const hopsOf = flightHops(data);
  const domIssue = (key: string) => scope.flights_domestic && !booking.later_dom && blocking.some((i) => i.key === key);
  const movedLegs = domIssue("pg.err.domesticMismatch") ? domesticMismatches(data.flights, data.cities) : [];
  const gapsOf = (leg: DraftData["flights"][number]) =>
    scope.flights_domestic && !booking.later_dom ? legGaps(leg, domIssue("pg.err.domFlightUnpriced"), movedLegs) : [];
  /**
   * «ينقص» for the domestic flights, said by leg and field on their own section where they are entered; a reason
   * no leg carries (a hand-typed total gone, say) keeps the check's own words, so «متابعة» never stops unexplained.
   */
  const domMissing = (() => {
    const legs = data.flights.filter((f) => f.leg_order === "internal");
    const dayOf = (leg: DraftData["flights"][number]) => hopsOf.hops.find((h) => h.legs.includes(leg))?.day ?? null;
    const said = legs.flatMap((leg) => {
      const g = gapsOf(leg);
      return g.length > 0 ? [{ g, text: tx("legNeeds", { from: leg.from_city || leg.from_airport || "—", to: leg.to_city || leg.to_airport || "—", list: gapWords(tx, g, dayOf(leg)) }) }] : [];
    });
    const covers: Record<string, (g: string[]) => boolean> = {
      "pg.err.domFlightIncomplete": (g) => g.some((x) => x === "from" || x === "to" || x === "date"),
      "pg.err.domFlightUnpriced": (g) => g.includes("price"),
      "pg.err.domesticMismatch": (g) => g.includes("day"),
    };
    const unsaid = blocking.filter((i) => i.key && DOM_KEYS.includes(i.key) && !said.some((s) => covers[i.key!](s.g)));
    return [...said.map((s) => s.text), ...unsaid.map(issueText)];
  })();
  // «متابعة» from the flights built the cities from them — said once over the hotels
  const [citiesNote, setCitiesNote] = useState<BasicLabel | null>(null);
  const countryOfCity = (name: string) => lk.countries.find((c) => c.cities.some((x) => x.name === name))?.name;

  // ---------- the flights' dates against the client's (the owner, 2026-10-26) ----------
  // Said once, applied only on «اعتمد» — never silently; «أبقِ» hides it until a date moves.
  const dayMonth = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}` : "—");
  const dateFit = scope.flights_intl && !booking.later_intl ? alignTripToFlights(data, countryOfCity) : null;
  const dateFitKey = dateFit ? [dateFit.arrival_date, dateFit.departure_date, trip.arrival_date, trip.departure_date].join("|") : "";
  const [keptDates, setKeptDates] = useState("");
  const [datesNote, setDatesNote] = useState<string | null>(null);
  function adoptFlightDates() {
    const fit = alignTripToFlights(latest.current, countryOfCity);
    if (!fit) return;
    commit(fit.patch);
    const done = tx("datesFitDone", { a: dayMonth(fit.arrival_date), b: dayMonth(fit.departure_date) });
    const moved = fit.lastCity ? ` ${tx(fit.lastCity.delta > 0 ? "datesFitAdded" : "datesFitRemoved", { n: nightsText(Math.abs(fit.lastCity.delta), language), city: fit.lastCity.city })}` : "";
    setDatesNote(done + moved);
  }
  const datesFit = (
    <>
      {dateFit && keptDates !== dateFitKey ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#fff8e8] px-3 py-2 text-[12px] font-bold text-[#a86a10]">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {tx("datesFitAsk", { a: dayMonth(dateFit.arrival_date), b: dayMonth(dateFit.departure_date), c: dayMonth(trip.arrival_date), d: dayMonth(trip.departure_date) })}
          </span>
          <button type="button" onClick={adoptFlightDates} className="h-8 rounded-[8px] bg-[#185045] px-3 text-[12px] font-bold text-white">
            {tx("datesFitYes")}
          </button>
          <button type="button" onClick={() => setKeptDates(dateFitKey)} className="text-[11.5px] font-bold text-[#185045] underline">
            {tx("datesFitKeep")}
          </button>
        </div>
      ) : null}
      {datesNote ? (
        <p role="status" className="flex items-center gap-2 rounded-[10px] bg-[#eef6f2] px-3 py-1.5 text-[12px] font-bold text-[#185045]">
          <Plane className="size-4 shrink-0" />
          <span className="flex-1">{datesNote}</span>
          <button type="button" onClick={() => setDatesNote(null)} aria-label={tx("dismiss")} className="text-[#557d78]">×</button>
        </p>
      ) : null}
    </>
  );

  // ---------- the sections: one open at a time ----------
  // the cities whose stay still lacks a hotel, a room type, a board or a price — «إكمال» opens only these
  // (no hotel at all: the same function the server's issue gate asks)
  const noHotel = citiesWithoutHotel(data);
  // the hotels this file sells: not a city the client booked himself
  const sold = soldHotels(data);
  const hotelGaps = scope.hotels
    ? [...new Set(cities.map((c) => c.city_name))].filter((name) =>
        noHotel.includes(name) ||
        sold.some(
          (h) =>
            h.city_name === name &&
            (h.rooms.some((r) => !(r.room_type_id || r.room_type_name.trim()) || !r.board_type) || (h.hotel_name.trim() && !h.sourcing && stayTotal(h) == null)),
        ),
      )
    : [];
  const [focus, setFocus] = useState<string[] | null>(null);
  // the cities the agent marked «تمت» — folded to their summary line: "part|stop", the hotels apart from the programme
  const [doneCities, setDoneCities] = useState<string[]>([]);
  const stopOf = (done: string) => done.slice(done.indexOf("|") + 1);
  // the city being dragged, and the cities whose dates the new order moved (what they were) — red until «تمت»
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [datesWere, setDatesWere] = useState<Record<string, { check_in: string | null; check_out: string | null; prev: string | undefined }>>({});
  const stopKey = (c: BasicCity, i: number) => c.key ?? `${i}-${c.city_name}`;
  /**
   * A city dragged onto another, or its arrows: every stop whose dates or whose
   * way in (the city before it) changed turns red until «تمت»; one put back
   * where it was is not red any more. A move that would put a city twice in a
   * row is refused, and said.
   */
  function reorder(from: number, to: number) {
    const before = new Map(cities.map((c, i) => [stopKey(c, i), { check_in: c.check_in, check_out: c.check_out, prev: cities[i - 1] ? stopKey(cities[i - 1], i - 1) : undefined }]));
    const moved = moveCity(data, from, to);
    if (moved.cities === data.cities) {
      if (from !== to) window.alert(tx("sameCityTwice"));
      return;
    }
    const next = moved.cities as BasicCity[];
    const now = new Map(next.map((c, i) => [stopKey(c, i), { check_in: c.check_in, check_out: c.check_out, prev: next[i - 1] ? stopKey(next[i - 1], i - 1) : undefined }]));
    const differs = (a: { check_in: string | null; check_out: string | null; prev: string | undefined }, b: typeof a) =>
      a.check_in !== b.check_in || a.check_out !== b.check_out || a.prev !== b.prev;
    // the first state is kept — moved twice it still says where it started — and a stop back there clears
    setDatesWere((w) => {
      const all = { ...Object.fromEntries([...before].filter(([k, was]) => now.has(k) && differs(was, now.get(k)!))), ...w };
      return Object.fromEntries(Object.entries(all).filter(([k, was]) => now.has(k) && differs(was, now.get(k)!)));
    });
    // a stop that changed opens again
    setDoneCities((d) => d.filter((k) => !(before.has(stopOf(k)) && now.has(stopOf(k)) && differs(before.get(stopOf(k))!, now.get(stopOf(k))!))));
    commit(moved);
  }
  const partner = data.customer.partner_company_id;
  // the domestic flights' section: there while a move between the cities is flown (or a leg of the agent's own is left)
  const domLegs = data.flights.filter((f) => f.leg_order === "internal");
  const steps = fileSections({ intl: scope.flights_intl, domestic: scope.flights_domestic && domLegs.length > 0, pricing: canPricing });
  const missingOf: Record<Section, string[]> = {
    client: [
      !country && tx("country"),
      !partner && !data.customer.customer_name.trim() && tx("customer"),
      !partner && !data.customer.customer_phone.trim() && tx("phone"),
      !trip.arrival_date && tx("start"),
      trip.nights <= 0 && tx("nights"),
      !trip.meal_plan && tx("meals"),
    ].filter((x): x is string => Boolean(x)),
    // what stops the international flights, in words — «سعر الطيران الدولي», not just «الطيران»
    flights: [...new Set(blocking.filter((i) => sectionOf(i, steps) === "flights").map(issueText))],
    hotels: [
      cities.length === 0 && tx("city"),
      cities.length > 0 && used !== trip.nights && nightsNote,
      // a stay with no room type, board or price stops here, not at the end
      ...blocking.filter((i) => i.stage === "hotels").map(issueText),
    ].filter((x): x is string => Boolean(x)),
    // each domestic leg's gaps, by leg — cleared on its move
    domestic: domMissing,
    programme: [
      // the reception car and the tours car, on the first city's tours
      scope.transport && cities.length > 0 && !plan.airport.car_type.trim() && tx("transferCar"),
      scope.transport && toursOn && cities.length > 0 && !plan.tours.car_type.trim() && tx("tourCar"),
      // a day with no title, fixed in its city's «البرنامج السياحي»
      ...new Set(blocking.filter((i) => i.stage === "itinerary").map(issueText)),
    ].filter((x): x is string => Boolean(x)),
    services: [...new Set(blocking.filter((i) => i.stage === "services").map(issueText))],
    pricing: [...new Set(blocking.filter((i) => i.stage === "pricing").map(issueText))],
    finish: [],
  };
  // a new file opens on its first section; a file coming back, on the first one not done
  const firstTodo = steps.find((s) => missingOf[s].length > 0) ?? "finish";
  const [open, setOpen] = useState<Section>(firstTodo);
  const [reached, setReached] = useState<Section>(firstTodo);
  /** the walk-in alert: off · on (ticked) · sending · sent · or why it was not shown */
  const [walkIn, setWalkIn] = useState<string>("off");
  // the services ticked in «البرنامج يشمل», as the chips show them — one → that service on the screens, more → «بكج»
  const walkInServices = [
    ...(Object.keys(scope) as (keyof DraftScope)[]).filter((k) => k !== "flights_domestic" && scope[k]),
    ...(modes.includes("flight") ? ["flights_domestic"] : []),
    ...(toursOn ? ["tours"] : []),
  ];
  const shown = (s: Section) => steps.includes(s) && SECTION_ORDER.indexOf(s) <= SECTION_ORDER.indexOf(reached);

  function show(step: Section) {
    setOpen(step);
    // the flights open already planned: no empty box for what the file already says
    if (step === "flights" && scope.flights_intl && !latest.current.flights.some((f) => f.leg_order !== "internal")) {
      const planned = planInternational(latest.current, lookups.airports, planDefaults);
      // «بكج متقدم» already said where they land and leave from
      commit({ ...planned, ...(withAdvancedAirports({ ...latest.current, ...planned }, lookups.airports) ?? {}) });
    }
    if (step !== "hotels") setFocus(null);
    // the prices are worked out as the section opens — no button to remember
    if (step === "pricing" && canPricing) void calculate();
    if (step === "services") commit({ services: withScopeLines(latest.current) });
    window.setTimeout(() => document.getElementById(`basic-${step}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function next(from: Section) {
    // «عميلنا محمد طلب بكج إلى جورجيا» on the office screens, once, after the file is saved
    if (from === "client" && walkIn === "on") {
      setWalkIn("sending");
      void flush()
        .then(() => announceWalkIn(draftId, walkInServices))
        .then((r) => setWalkIn(r.ok ? "sent" : r.error))
        .catch(() => setWalkIn("on"));
    }
    // the cities from the flights' dates (the owner, 2026-10-22: «الإدخال التلقائي وفق التواريخ يقلل الأخطاء») —
    // a part left for later leaves the cities to the agent, as before
    if (from === "flights" && scope.flights_intl && !latest.current.flight_booking.later_intl) {
      const built = withCitiesFromFlights(latest.current, countryOfCity);
      if (built) commit(built);
      setCitiesNote(built ? "flightCities" : "noFlightCities");
    }
    const to = steps[steps.indexOf(from) + 1] ?? "finish";
    if (SECTION_ORDER.indexOf(to) > SECTION_ORDER.indexOf(reached)) setReached(to);
    show(to);
  }

  const pax = [
    `${trip.adults} ${tx("adults")}`,
    trip.children > 0 ? `${trip.children} ${tx("children")}` : "",
    trip.infants > 0 ? `${trip.infants} ${tx("infants")}` : "",
  ].filter(Boolean);
  const summaryOf: Record<Section, string> = {
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
    flights: [booking.later_intl ? tx("laterLine", { part: tx("laterIntl") }) : "", ...data.flights.filter((f) => f.leg_order !== "internal" && !booking.later_intl).map(legText)].filter(Boolean).join(" · "),
    hotels: cities
      .map((c, i) => {
        // each visit of a city with its own hotels — or the one the client booked himself
        const theirs = c.client_hotel?.name.trim();
        const hotel = theirs
          ? tx("clientHotelIs", { hotel: theirs })
          : [...new Set(cityHotelLines(cities, sold, i).map((h) => h.hotel_name.trim()).filter(Boolean))].join(" + ");
        return `${c.city_name} (${nightsText(c.nights, language)})${hotel ? ` — ${hotel}` : ""}`;
      })
      .join(" · "),
    domestic: booking.later_dom ? tx("laterLine", { part: tx("laterDom") }) : domLegs.map(legText).join(" · "),
    // each city with how many tours it has
    programme: cities
      .map((c) => (toursOn ? `${c.city_name} (${tx("toursCount")}: ${(c.tour_picks ?? []).slice(0, c.tours ?? 0).filter((p) => !p.free).length})` : c.city_name))
      .join(" · "),
    services: tx("servicesSummary", { a: data.services.includes.length, b: data.services.excludes.length }),
    pricing: data.pricing.items.length > 0 ? `${tx("total")}: ${summary.total_sell.toLocaleString("en-US")} ${display}` : tx("noLines"),
    finish: produced ?? (blocking.length > 0 ? tx("missing") : tx("allGood")),
  };
  // plain headings — one page to the agent, never numbered stages (the owner, 2026-10-25)
  const titleOf: Record<Section, string> = {
    client: tx("booking"),
    flights: tx("intlFlights"),
    hotels: scope.hotels ? tx("hotelsStep") : tx("citiesOnly"),
    domestic: tx("domFlights"),
    programme: toursOn ? tx("toursStep") : tx("programTab"),
    services: tx("servicesStep"),
    pricing: tx("pricing"),
    finish: tx("finish"),
  };
  /**
   * One city's card: in the hotels its stays and the city itself (order, nights, another city, removal),
   * in the programme its tours and days — the same answers, each «تمت» folding its own place.
   */
  const cityCard = (part: "hotels" | "programme", city: BasicCity, i: number) => {
    const key = stopKey(city, i);
    const done = `${part}|${key}`;
    return (
      <BasicCityCard
        part={part}
        index={i}
        city={city}
        dayFrom={dayFroms[i]}
        data={data}
        lookups={lk}
        programs={programs.filter((p) => p.city_name === city.city_name)}
        tourPrices={pricesForCity(tourPrices, city.city_name, cities.map((c) => c.city_name), normAr)}
        listPrices={listPrices}
        hotelsOn={scope.hotels}
        toursOn={toursOn}
        transportOn={scope.transport}
        isFirst={i === 0}
        isLast={i === cities.length - 1}
        onNights={(n) => commit(setCityNights(data, i, n))}
        onPicks={(tour_picks) => commit({ cities: cities.map((c, k) => (k === i ? { ...c, tour_picks, tours: tour_picks.length } : c)) })}
        onLines={setLines}
        onSlice={commit}
        onCar={(leg, slice) =>
          leg === "airport"
            ? setLeg("airport", slice)
            : leg === "tours"
              ? setTourCar(slice)
              : commit({ transport_plan: withCar({ ...plan, farewell: { ...(plan.farewell ?? plan.airport), ...slice, enabled: true } }, slice.car_type) })
        }
        onRemove={() => {
          if (!window.confirm(tx("confirmRemove", { city: city.city_name }))) return;
          // its key may come back with a new city: nothing of this one may carry over
          setDatesWere((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== key)));
          setDoneCities((d) => d.filter((k) => stopOf(k) !== key));
          commit(removeCity(data, i));
        }}
        onMove={reorder}
        dragFrom={dragFrom}
        onDragFrom={setDragFrom}
        onReplace={(next) => {
          const changed = replaceCity(data, i, next);
          if (changed.cities === data.cities) {
            if (next.name.trim() !== city.city_name) window.alert(tx("sameCityTwice"));
            return;
          }
          // its hotel and tours are to be chosen again: the card opens, and a focus on the old name follows it
          setDoneCities((d) => d.filter((k) => stopOf(k) !== key));
          setFocus((f) => (f ? f.map((n) => (n === city.city_name ? next.name.trim() : n)) : f));
          commit(changed);
        }}
        datesWere={datesWere[key] ?? null}
        // a city «إكمال» brought here is open, whatever was folded
        collapsed={!(part === "hotels" && focus) && doneCities.includes(done)}
        onDone={() => {
          setDoneCities((d) => [...d, done]);
          setDatesWere((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== key)));
          // on to the next city
          window.setTimeout(() => document.getElementById(`basic-${part}-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }}
        onExpand={() => setDoneCities((d) => d.filter((k) => k !== done))}
        onFold={() => setDoneCities((d) => (d.includes(done) ? d : [...d, done]))}
        // the newest cities, not this render's: the catalogue's address lands after the pick
        onClientHotel={(slice) => commit({ cities: setClientHotel(latest.current.cities, i, slice) })}
        onClientBooked={(on) => commit(setClientBooked(latest.current, i, on))}
        onGoHotel={
          part === "programme"
            ? () => {
                // «الفنادق» open, this city's card unfolded, and brought into view
                setDoneCities((d) => d.filter((k) => k !== `hotels|${key}`));
                show("hotels");
                window.setTimeout(() => document.getElementById(`basic-hotels-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 160);
              }
            : undefined
        }
      />
    );
  };
  const fold = (step: Section, body: ReactNode) =>
    shown(step) ? (
      <Fold key={step} id={`basic-${step}`} title={titleOf[step]} open={open === step} onOpen={() => show(step)} summary={summaryOf[step]} missing={missingOf[step]}>
        {body}
        {/* the last section has nothing after it */}
        {step === "finish" ? null : (
          <>
          {step === "client" ? (
            // a client in the office (the user, 2026-10-25): tick, «التالي», and every screen says it
            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-[9px] border border-[#DCE9E5] bg-[#f6faf8] px-3 py-2 text-[12.5px] font-bold text-[#185045]">
              <input
                type="checkbox"
                className="size-4 accent-[#185045]"
                checked={walkIn !== "off"}
                disabled={walkIn === "sending" || walkIn === "sent"}
                onChange={(e) => setWalkIn(e.target.checked ? "on" : "off")}
              />
              <span className="min-w-0 flex-1">
                اعرض على شاشات المكتب: «عميلنا{displayName(data.customer.customer_name) ? ` ${displayName(data.customer.customer_name)}` : ""} طلب {serviceLine(walkInKind(walkInServices), trip.country || trip.destination || "…")}»
              </span>
              {walkIn === "sent" ? <span className="text-[#0f7a52]">✓ ظهر على الشاشات</span> : walkIn === "sending" ? <span className="text-[#557d78]">…</span> : walkIn !== "on" && walkIn !== "off" ? <span className="text-[#a86a10]">{walkIn}</span> : null}
            </label>
          ) : null}
            <NextButton missing={missingOf[step]} onNext={() => next(step)} />
          </>
        )}
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

  // «الشروط والأحكام» — this file's terms: the trip country's own come in by
  // themselves when it is chosen (moveTripCountry); more are picked or typed here
  const termsButton = (
    <Dialog>
      <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]">
        <ScrollText className="size-3.5" />
        {t("pg.terms")} <span className="tv-tnum">({data.services.terms.length})</span>
      </DialogTrigger>
      <DialogContent className="w-[min(720px,calc(100vw/var(--tv-zoom)_-_24px))]" dir={language === "ar" ? "rtl" : "ltr"}>
        <div className="[&>section]:border-0 [&>section]:p-0 [&>section]:shadow-none">
          <TermsStage draftId={draftId} data={data} patch={commit} replace={replace} flush={flush} lookups={lk} />
        </div>
      </DialogContent>
    </Dialog>
  );
  const body: Record<Section, ReactNode> = {
    // ---- the customer and the trip, and what the programme includes ----
    client: (
      <>
        {/* who: equal columns */}
        <div className={`grid grid-cols-2 gap-2 ${SHOW_AGENT && !partnerSession ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          <label className={basicLabel}>
            {tx("country")}
            <select value={country?.name ?? trip.country} onChange={(e) => e.target.value === "__other__" ? setCatalogAdd({ table: "countries", target: "trip" }) : setCountry(e.target.value)} className={basicField}>
              <option value="">{tx("choose")}</option>
              {lookups.countries.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
              {can("data.write") ? <option value="__other__">{t("data.form.otherAdd")}</option> : null}
            </select>
          </label>
          {/* who sells it is ours to choose — a partner's own file is already its own */}
          {partnerSession || !SHOW_AGENT ? null : (
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
          )}
          {/* the phone first: a few digits find the customer in Teletel and fill the name —
              our contacts, so a partner types its client's phone plainly */}
          {partnerSession ? (
            <label className={basicLabel}>
              {tx("phone")}
              <input
                dir="ltr"
                value={data.customer.customer_phone}
                onChange={(e) => patch({ customer: { ...data.customer, customer_phone: e.target.value } })}
                className={`${basicField} text-start`}
              />
            </label>
          ) : (
            <BasicPhoneLookup
              label={tx("phone")}
              phone={data.customer.customer_phone}
              onPhone={(customer_phone) => patch({ customer: { ...data.customer, customer_phone } })}
              onPick={(hit) => patch({ customer: { ...data.customer, customer_name: hit.name, customer_phone: hit.phone } })}
            />
          )}
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

        {/* «البرنامج يشمل» — small chips, after the program-includes spec; the details come in their own sections */}
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

    // ---- the international flights: the number first, fetched; or «أضف لاحقاً» (the domestic ones have their own section) ----
    flights: (
      <div className="space-y-3">
        {datesFit}
        <BasicFlightPlan data={data} lookups={lk} defaults={planDefaults} onChange={commit} current={() => latest.current} />
      </div>
    ),

    // ---- the hotels: city by city, each hotel on its dates, the way between two cities asked between them; the bar adds a city ----
    hotels: (
      <div className="space-y-3">
        {datesFit}
        {citiesNote && !focus ? (
          <p role="status" className={`flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-[12px] font-bold ${citiesNote === "flightCities" ? "bg-[#eef6f2] text-[#185045]" : "bg-[#fff8e8] text-[#a86a10]"}`}>
            <Plane className="size-4 shrink-0" />
            <span className="flex-1">{tx(citiesNote)}</span>
            <button type="button" onClick={() => setCitiesNote(null)} aria-label={tx("dismiss")} className="text-[#557d78]">×</button>
          </p>
        ) : null}
        {/* a road hop nobody would drive (Puncak → Bali): said, never blocked */}
        {cities.length > 1 && !focus ? <OverlandHopNotice data={data} countries={lk.countries} /> : null}
        {focus ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#fff8e8] px-3 py-1.5 text-[12px] font-bold text-[#a86a10]">
            <AlertTriangle className="size-4" />
            {tx("focusNote")}
            <button type="button" onClick={() => setFocus(null)} className="ms-auto text-[11.5px] font-bold text-[#185045] underline">
              {tx("showAll")}
            </button>
          </div>
        ) : null}
        {cities.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[12.5px] font-semibold text-[#93aaa3]">{tx("noCities")}</p>
        ) : (
          cities.map((city, i) => {
            if (focus && !focus.includes(city.city_name)) return null;
            // the group may land in another city and go on — or go from the last city to the flight home
            const from = cities[i - 1]?.city_name ?? (landingCity && landingCity !== city.city_name && flies(landingCity, city.city_name) ? landingCity : "");
            const out = i === cities.length - 1 && homeCity && homeCity !== city.city_name && flies(city.city_name, homeCity) ? homeCity : "";
            return (
              <Fragment key={`${i}-${city.city_name}`}>
                {from && !focus ? hopLine(from, city.city_name) : null}
                {cityCard("hotels", city, i)}
                {out && !focus ? hopLine(city.city_name, out) : null}
              </Fragment>
            );
          })
        )}
        {/* the add bar, like the company's system — gone once every night has its city */}
        {focus || (trip.nights > 0 && used === trip.nights) ? null : (
        <div className="sticky bottom-3 z-20 rounded-[14px] border border-[#cfe0d9] bg-[#e9f3ef]/95 px-2 py-1.5 shadow-[0_8px_24px_rgba(0,60,58,0.12)] backdrop-blur max-lg:bottom-[80px] sm:px-2.5">
          <div className="flex flex-wrap items-end gap-1.5">
            {/* a group may cross into a neighbouring country */}
            <label className={`${basicLabel} w-24 shrink-0 sm:w-32`}>
              {tx("country")}
              <select
                value={barCountry?.name ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__other__") { setCatalogAdd({ table: "countries", target: "bar" }); return; }
                  setNewCountry(e.target.value);
                  pickCity("");
                }}
                className={`${basicField} px-1.5`}
              >
                <option value="">{tx("choose")}</option>
                {lookups.countries.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
                {can("data.write") ? <option value="__other__">{t("data.form.otherAdd")}</option> : null}
              </select>
            </label>
            <label className={`${basicLabel} min-w-28 flex-1`}>
              {tx("city")}
              <select value={newCity} onChange={(e) => e.target.value === "__other__" ? setCatalogAdd({ table: "cities", target: "bar", countryId: barCountry?.id }) : pickCity(e.target.value)} disabled={!barCountry} className={basicField}>
                <option value="">{tx("choose")}</option>
                {(barCountry?.cities ?? []).map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
                {can("data.write") ? <option value="__other__">{t("data.form.otherAdd")}</option> : null}
              </select>
            </label>
            {/* the city chosen: its hotels, the room and how many — shown only now */}
            {newCity && scope.hotels ? (
              <>
                <label className={`${basicLabel} min-w-36 flex-[1.5]`}>
                  {tx("hotel")}
                  <HotelCombobox
                    hotels={barHotels}
                    valueId={newHotel || null}
                    placeholder={tx("choose")}
                    onPick={(h) => setNewHotel(h?.id ?? "")}
                  />
                </label>
                <label className={`${basicLabel} w-32 shrink-0 sm:w-40`}>
                  {tx("roomType")}
                  {/* the type only — its category is chosen on the city's card */}
                  <select aria-label={tx("roomType")} value={newRoom} onChange={(e) => setNewRoom(e.target.value)} className={basicField}>
                    <option value="">{tx("choose")}</option>
                    {ROOM_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>{type.label[language === "en" ? "en" : "ar"]}</option>
                    ))}
                  </select>
                </label>
                <label className={`${basicLabel} w-14 shrink-0`}>
                  {tx("rooms")}
                  <select value={roomsChoice} onChange={(e) => setNewRooms(Number(e.target.value))} className={`${basicField} px-1.5`}>
                    {range(1, 10).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                {/* the price, typed here with the rest: the card arrives priced */}
                <label className={`${basicLabel} w-32 shrink-0`}>
                  {tx("barPrice")}
                  <input
                    type="number"
                    min={0}
                    dir="ltr"
                    value={newPrice ?? ""}
                    placeholder="0"
                    onChange={(e) => setNewPrice(typedNumber(e.target))}
                    className={`${basicField} tv-tnum text-center`}
                  />
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
                <select value={toursChoice} onChange={(e) => setNewTours(Number(e.target.value))} className={`${basicField} px-1.5`}>
                  {range(0, maxTours).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={onAdd}
              disabled={!newCity}
              aria-label={tx("addCity")}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[8px] bg-[#185045] px-2.5 text-[12.5px] font-extrabold text-white disabled:opacity-50 sm:px-3.5"
            >
              <Plus className="size-4" />
              <span className="max-sm:hidden">{tx("addCity")}</span>
            </button>
            <span className={`tv-tnum hidden h-9 shrink-0 items-center gap-1 rounded-[8px] px-2.5 text-[11.5px] font-bold md:inline-flex ${nightsTone}`}>
              <MapPin className="size-3.5" />
              {nightsNote}
            </span>
          </div>
          <p className={`tv-tnum mt-1 rounded-[7px] px-2 py-0.5 text-[10.5px] font-bold md:hidden ${nightsTone}`}>{nightsNote}</p>
          {joinedNote ? (
            <p role="status" className="mt-1.5 flex items-center justify-between gap-2 rounded-[8px] bg-[#E8F6EF] px-2.5 py-1.5 text-[12px] font-bold text-[#0f7a52]">
              {joinedNote}
              <button type="button" onClick={() => setJoinedNote(null)} aria-label={tx("dismiss")} className="text-[#557d78]">×</button>
            </p>
          ) : null}
        </div>
        )}
      </div>
    ),

    // ---- the domestic flights: each move by air between two cities, its leg on the move's day ----
    domestic: booking.later_dom ? (
      // «أضف لاحقاً»: one line for all of them, and the way back
      <BasicHopFlight hop={null} legs={domLegs} data={data} lookups={lk} gaps={gapsOf} onChange={commit} current={() => latest.current} />
    ) : (
      <div className="space-y-3">
        {hopsOf.hops.map((h) => (
          <BasicHopFlight key={`${h.before}-${h.from}`} hop={h} legs={h.legs} data={data} lookups={lk} gaps={gapsOf} onChange={commit} current={() => latest.current} />
        ))}
        {/* a domestic leg no move claims — still here to complete or remove */}
        <BasicHopFlight hop={null} legs={hopsOf.rest} data={data} lookups={lk} gaps={gapsOf} onChange={commit} current={() => latest.current} />
      </div>
    ),

    // ---- the programme: each city's tours, receptions and transfers, and its days as the client reads them ----
    programme: <div className="space-y-3">{cities.map((city, i) => <Fragment key={`${i}-${city.city_name}`}>{cityCard("programme", city, i)}</Fragment>)}</div>,

    // ---- what the programme includes and does not — the generator's own lists, ✓ / ✗ ----
    services: (
      <>
        {/* the SIM lines: a count, written as one «يشمل» line */}
        <label className={`${basicLabel} w-32`}>
          {tx("simLines")}
          <select
            value={Number(data.services.includes.find((l) => l.startsWith(SIM_LINE))?.match(/\d+/)?.[0] ?? 0)}
            onChange={(e) => setSims(Number(e.target.value))}
            className={`${basicField} px-1.5`}
          >
            {range(0, 10).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="-mx-3 -mb-1 [&>section]:border-0 [&>section]:p-3 [&>section]:shadow-none [&_h2]:hidden">
          <ServicesStage draftId={draftId} data={data} patch={commit} replace={replace} flush={flush} lookups={lk} />
        </div>
        {/* without the price step, the terms are reached from here */}
        {canPricing ? null : <div className="mt-2">{termsButton}</div>}
      </>
    ),

    // ---- the price (sell side only, for whoever may see prices) ----
    pricing: (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="ms-auto inline-flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
                {tx("quote")}
                <select
                  value={display}
                  onChange={(e) =>
                    patch({ pricing: { ...data.pricing, display_currency: e.target.value, final_total: null } })
                  }
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
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
              >
                {pricingBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {pricingBusy ? tx("calcBusy") : tx("calc")}
              </button>
              {termsButton}
            </div>
            {pricingError ? <p role="alert" className="mb-2 text-[12px] font-bold text-[#c22850]">{pricingError}</p> : null}
            {data.pricing.items.length === 0 ? (
              <p className="text-[12px] font-semibold text-[#93aaa3]">{tx("noLines")}</p>
            ) : (
              <div className="space-y-2.5">
                {/* one card per section: red while a price is missing, folded once it is complete */}
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {groups.map((g) => {
                  const bad = g.missing > 0;
                  const isOpen = openGroups[g.key] ?? bad;
                  return (
                  <div
                    key={g.key}
                    className={`overflow-hidden rounded-[11px] border ${isOpen ? "sm:col-span-2 xl:col-span-3" : ""} ${bad ? "border-[#f0b4c2]" : "border-[#d8e6e0]"}`}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenGroups((o) => ({ ...o, [g.key]: !isOpen }))}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-start ${bad ? "bg-[#fdeef2] hover:bg-[#fbe3e9]" : "bg-[#eef5f2] hover:bg-[#e6f0ec]"}`}
                    >
                      <g.icon className={`size-4 shrink-0 ${bad ? "text-[#c22850]" : "text-[#185045]"}`} />
                      <span className={`text-[12.5px] font-extrabold ${bad ? "text-[#9c1f40]" : "text-[#0f3d38]"}`}>{tx(g.label)}</span>
                      <span className="rounded-full bg-white px-2 text-[10.5px] font-bold text-[#557d78]">{g.rows.length}</span>
                      {bad ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#c22850] px-2 py-0.5 text-[10.5px] font-bold text-white">
                          <AlertTriangle className="size-3" />
                          {tx("priceMissing", { n: g.missing })}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#e3f4ec] px-2 py-0.5 text-[10.5px] font-bold text-[#0f7a52]">
                          <Check className="size-3" />
                          {tx("priceDone")}
                        </span>
                      )}
                      <span className={`tv-tnum ms-auto text-[12.5px] font-extrabold ${bad ? "text-[#9c1f40]" : "text-[#185045]"}`}>
                        <DirText>{`${g.subtotal.toLocaleString("en-US")} ${display}`}</DirText>
                      </span>
                      <ChevronDown className={`size-4 shrink-0 text-[#557d78] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen ? (
                    <div className="divide-y divide-[#f0f5f3] px-3">
                      {g.rows.map(({ item, i }) => {
                        // a stay is typed a night (and a room) and kept as its whole stay: «× غرفتين × 3 ليالٍ = …»
                        const per = sheetStayUnits(data, item);
                        const units = per ? per.rooms * per.nights : 1;
                        return (
                        <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-1.5 sm:grid-cols-[1fr_52px_8rem_5.5rem]">
                          <span className="min-w-0 truncate text-[12px] font-bold text-[#185045]" title={item.description}>
                            {item.description}
                          </span>
                          <span className="tv-tnum hidden text-center text-[11px] font-bold text-[#7a948f] sm:block">{per ? tx("night") : `× ${item.quantity}`}</span>
                          <input
                            type="number"
                            min={0}
                            dir="ltr"
                            aria-label={per ? tx("night") : tx("sell")}
                            value={(per ? perUnit(item.sell_price, units) : item.sell_price) ?? ""}
                            placeholder="—"
                            onChange={(e) => setItem(i, { sell_price: per ? fromUnit(typedNumber(e.target), units) : typedNumber(e.target) })}
                            className={`${basicField} tv-tnum text-center ${item.sell_price == null ? "border-[#f0b4c2] bg-[#fff5f7]" : ""}`}
                          />
                          <select value={item.sell_currency || display} onChange={(e) => setItem(i, { sell_currency: e.target.value })} className={`${basicField} px-1.5`}>
                            {currencyOptions(lookups.countries, item.sell_currency || display).map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          {per ? (
                            <p className="tv-tnum col-span-full text-[11px] font-bold text-[#0f7a52]">
                              {tx("nightsTimes", {
                                n: [per.rooms > 1 ? roomsText(per.rooms, language) : "", nightsText(per.nights, language)].filter(Boolean).join(" × "),
                                total: item.sell_price == null ? "—" : `${item.sell_price.toLocaleString("en-US")} ${item.sell_currency || display}`,
                              })}
                            </p>
                          ) : null}
                          {fareNote && item.ref === fareNote ? (
                            <p className="col-span-full text-[11px] font-semibold text-[#557d78]">{t("pg.fare.toTotal")}</p>
                          ) : null}
                        </div>
                        );
                      })}
                      <div className="flex items-center justify-end gap-2 py-2">
                        {bad ? <span className="text-[11px] font-bold text-[#c22850]">{tx("priceMissing", { n: g.missing })}</span> : null}
                        {savedGroup === g.key && saveState !== "saving" && saveState !== "error" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0f7a52]">
                            <Check className="size-3.5" />
                            {tx("savedCard")}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void saveGroup(g.key, !bad)}
                          disabled={saveState === "saving"}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#185045] px-4 text-[12px] font-extrabold text-white hover:bg-[#0f4439] disabled:opacity-60"
                        >
                          {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                          {tx("saveCard")}
                        </button>
                      </div>
                    </div>
                    ) : null}
                  </div>
                  );
                })}
                </div>
                {/* the profit, once for the package: a margin or a whole amount — cost and profit are the internal view */}
                {canSetProfit ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[11px] border border-[#d8e6e0] bg-[#f8fbf9] px-3 py-2">
                  <span className="text-[12.5px] font-extrabold text-[#0f3d38]">{tx("profit")}</span>
                  <div role="radiogroup" className="inline-flex rounded-[8px] border border-[#cfe0d9] bg-white p-0.5">
                    {(["pct", "amount"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={profit.mode === mode}
                        onClick={() => setProfit({ mode, value: profit.value })}
                        className={`h-7 rounded-[6px] px-3 text-[11.5px] font-bold ${profit.mode === mode ? "bg-[#185045] text-white" : "text-[#557d78]"}`}
                      >
                        {tx(mode === "pct" ? "profitPct" : "profitAmount")}
                      </button>
                    ))}
                  </div>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      dir="ltr"
                      aria-label={tx("profit")}
                      value={profit.value ?? ""}
                      placeholder="0"
                      onChange={(e) => setProfit({ mode: profit.mode, value: typedNumber(e.target) })}
                      className={`${basicField} tv-tnum w-28 text-center`}
                    />
                    <span className="text-[11.5px] font-bold text-[#557d78]">{profit.mode === "pct" ? "%" : display}</span>
                  </label>
                  <span className="tv-tnum ms-auto text-[12px] font-bold text-[#557d78]">
                    {tx("cost")}: <DirText>{`${summary.total_buy.toLocaleString("en-US")} ${display}`}</DirText>
                  </span>
                  <span className="tv-tnum text-[12px] font-extrabold text-[#0f7a52]">
                    {tx("profit")}: <DirText>{`${summary.profit.toLocaleString("en-US")} ${display}`}</DirText>
                    {/* as the margin was asked: on the cost */}
                    {summary.total_buy > 0 ? ` (${Math.round((summary.profit / summary.total_buy) * 10000) / 100}%)` : ""}
                  </span>
                </div>
                ) : null}
                <div className="flex items-center justify-between rounded-[11px] bg-[#185045] px-3 py-2.5 text-white">
                  {/* for a partner this total is what the package costs IT — our prices at its terms */}
                  <span className="text-[13px] font-extrabold">{partnerSession ? t("pg.partnerCost") : tx("clientTotal")}</span>
                  <span className="tv-tnum text-[16px] font-extrabold">
                    <DirText>{`${(!partnerSession && data.pricing.final_total != null ? data.pricing.final_total : summary.total_sell).toLocaleString("en-US")} ${display}`}</DirText>
                  </span>
                </div>
                {canPricing ? (
                  <label className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-[#d8e6e0] bg-[#f8fbf9] px-3 py-2">
                    <span className="text-[12.5px] font-extrabold text-[#0f3d38]">{t(partnerSession ? "pg.partnerSell" : "pg.finalTotal")}</span>
                    <input
                      type="number"
                      min={0}
                      dir="ltr"
                      value={data.pricing.final_total ?? ""}
                      placeholder={summary.total_sell.toLocaleString("en-US")}
                      onChange={(e) => patch({ pricing: { ...data.pricing, final_total: typedNumber(e.target) } })}
                      className={`${basicField} tv-tnum w-36 text-center`}
                    />
                    {partnerSession && data.pricing.final_total != null && data.pricing.final_total < summary.total_sell ? (
                      <span role="alert" className="basis-full text-[11.5px] font-bold text-[#c22850]">
                        سعرك أقل من تكلفتك علينا بـ {(summary.total_sell - data.pricing.final_total).toLocaleString("en-US")} {display} — تأكد قبل الإصدار.
                      </span>
                    ) : null}
                  </label>
                ) : null}
              </div>
            )}
          </div>
    ),

    // ---- what is missing, and issuing — here ----
    finish: (
        <div>
          {/* an issued file: one panel, the steps in order (BasicFileStatus) — a partner keeps the plain line */}
          {produced && partnerSession ? (
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
          ) : null}
          {blocking.length > 0 ? (
            <>
              <h3 className={`mb-2 inline-flex items-center gap-2 text-[13px] font-extrabold text-[#a86a10] ${produced ? "mt-3" : ""}`}>
                <AlertTriangle className="size-4" />
                {tx("missing")}
              </h3>
              <ul className="space-y-1">
                {blocking.map((issue, i) => {
                  // named by the section that answers it — a domestic leg's by the domestic flights
                  const target = sectionOf(issue, steps);
                  return (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[#5b4a2a]">
                    <span className="rounded-full bg-[#fff3d6] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">{target ? titleOf[target] : stageLabel(issue.stage)}</span>
                    <span className="min-w-0 flex-1">{issueText(issue)}</span>
                    {target ? (
                      <button
                        type="button"
                        onClick={() => {
                          show(target);
                          if (issue.stage === "hotels" && hotelGaps.length > 0) setFocus(hotelGaps);
                        }}
                        className="text-[11.5px] font-bold text-[#185045] underline"
                      >
                        {tx("fix")}
                      </button>
                    ) : legacyOpen ? (
                      // a stage Basic has no section for (none today) — the full generator, while it is on
                      <Link href={stageHref(draftId, issue.stage)} onClick={() => void flush()} className="text-[11.5px] font-bold text-[#185045] underline">
                        {tx("fix")}
                      </Link>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            </>
          ) : produced ? null : (
            <p className="inline-flex items-center gap-2 text-[13px] font-bold text-[#0f7a52]">
              <CheckCircle2 className="size-4" />
              {tx("allGood")}
            </p>
          )}
          {produced ? null : (
            <>
              <IssueGuardNotice hotels={sold} onBlocked={setGuardBlocked} only="blocking" className="mt-2" />
              {produceError ? <p role="alert" className="mt-2 text-[12px] font-bold text-[#c22850]">{produceError}</p> : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void produce()}
                  disabled={producing || blocking.length > 0 || guardBlocked}
                  title={blocking.length > 0 ? t("pg.err.blockingLeft") : undefined}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-[13px] font-extrabold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {producing ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                  {tx("issue")}
                </button>
              </div>
            </>
          )}
          {produced && !partnerSession ? (
            // «تطبيق تحديث السعر»: the price moved since the issue — one button issues the next version at it
            <PriceUpdate draftId={draftId} saved={saveState === "saved" ? data : null} refreshKey={statusTick} blocked={blocking.length > 0} flush={flush} onIssued={bumpStatus} />
          ) : null}
          {produced && !partnerSession ? (
            <BasicFileStatus
              draftId={draftId}
              serial={produced}
              variant="panel"
              refresh={statusTick}
              onChanged={bumpStatus}
              extras={{
                // edited since it was issued: the next version, same serial
                reissue: <ReissueOffer compact draftId={draftId} hotels={data.hotels} blocked={blocking.length > 0} flush={flush} onIssued={bumpStatus} />,
                versions: <OfferVersions serial={produced} draftId={draftId} defaultOpen flush={flush} refreshKey={statusTick} />,
                // the voucher's missing hotel details are operations' to complete, not the sales agent's
                guard: null,
              }}
            />
          ) : null}
        </div>
    ),
  };

  return (
    <TraveliunShell title="nav.basic">
      {catalogAdd ? <CatalogAddDialog table={catalogAdd.table} countryId={catalogAdd.countryId} onClose={() => setCatalogAdd(null)} onCreated={(row, refreshedCountries) => {
        const name = String(row.arabic_name);
        if (catalogAdd.table === "countries") {
          setAddedCountries(prev => [...prev.filter(c => c.id !== row.id), row]);
          if (catalogAdd.target === "trip") setCountry(name);
          else { setNewCountry(name); pickCity(""); }
        } else {
          setAddedCountries(prev => [...prev, ...refreshedCountries.filter(c => !prev.some(p => p.id === c.id))]);
          setAddedCities(prev => [...prev.filter(c => c.id !== row.id), row]);
          const parent = withCatalogAdditions(lookups, refreshedCountries, []).countries.find(c => c.id === row.country_id);
          if (parent) setNewCountry(parent.name);
          pickCity(name);
        }
      }} /> : null}
      <FieldIssueProvider issues={[...validation.blocking, ...validation.warnings]} render={issueText}>
        <div className="tv-fade-up space-y-3">
          {deployBar ? (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[#f2d39a] bg-[#fff8e8] px-3 py-2 text-[12.5px] font-bold text-[#8a5a0c]">
              <span className="min-w-0 flex-1">{tx("newDeploy")}</span>
              <button
                type="button"
                onClick={() => void flush().finally(() => window.location.reload())}
                className="inline-flex h-8 items-center rounded-[8px] bg-[#8a5a0c] px-3 text-[12px] font-bold text-white"
              >
                {tx("reload")}
              </button>
            </div>
          ) : null}
          {/* top bar — no «كل الملفات» and no «فتح في المولّد الكامل»: both led staff astray (the owner, 2026-10-18);
              the files list is the side menu's «النظام بيسك», the generator only answers a «أصلح» */}
          <div className="flex flex-wrap items-center gap-2">
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
            {restored && !restoredSeen ? (
              <button
                type="button"
                onClick={() => setRestoredSeen(true)}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-[#e8f1fb] px-2.5 text-[11.5px] font-bold text-[#1d5fa8]"
              >
                {tx("restored")} ×
              </button>
            ) : null}
            {produced && !partnerSession ? <BasicFileStatus draftId={draftId} serial={produced} variant="chip" refresh={statusTick} /> : null}
            {/* «أضف لاحقاً»: said on the file until the flights are in */}
            {flightsLater(data) ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#fff4dc] px-2.5 text-[11.5px] font-bold text-[#a86a10]">
                <Plane className="size-3.5" />
                {tx("flightsLater")}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const on = !data.advanced?.on;
                // switched off, the edges go with it: the nights and dates come back as Basic has them
                let d = latest.current;
                if (!on) for (const side of ["in", "out"] as const) d = { ...d, ...setEdge(d, side, null) };
                commit({ advanced: { ...(data.advanced ?? emptyAdvanced()), on }, ...(on ? {} : { cities: d.cities, hotels: d.hotels }) });
              }}
              className={`ms-auto inline-flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-[11.5px] font-bold ${data.advanced?.on ? "bg-[#185045] text-white" : "border border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"}`}
            >
              بكج متقدم{data.advanced?.on ? " ✓" : ""}
            </button>
          </div>

          {data.advanced?.on && cities.length > 0 ? <BasicEdges data={data} onEdge={(side, mode) => commit(setEdge(latest.current, side, mode))} /> : null}
          {data.advanced?.on ? (
            <AdvancedQuestions
              value={data.advanced}
              cities={data.cities}
              plan={data.transport_plan}
              transportOn={data.scope.transport}
              tripCountry={trip.country}
              lists={advancedLists}
              firstStay={firstStayText}
              notes={ticketMismatch}
              onChange={setAdvanced}
            />
          ) : null}

          {/* one section open at a time; the done ones fold to a line, the next ones appear as they are reached */}
          {steps.map((step) => fold(step, body[step]))}
        </div>
      </FieldIssueProvider>
    </TraveliunShell>
  );
}
