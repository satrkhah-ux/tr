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
import { getCountryHotels, getRoomTypeLookups, produceOfferFromDraft } from "@/lib/data/drafts";
import { getTourPrices, getTourPrograms } from "@/lib/data/tour-programs";
import type { TourProgram } from "@/lib/offer/itinerary";
import { suggestPricingForDraft } from "@/lib/data/pricing-suggest";
import type { ProfitSettings } from "@/lib/data/app-settings";
import {
  AGE_BANDS,
  cityHotelLines,
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
  stayTotal,
  type DraftData,
  type DraftHotel,
  type DraftScope,
  type DraftTrip,
  type GeneratorLookups,
  type LookupHotel,
  type MealPlan,
  type TransportMode,
} from "@/lib/offer/draft-types";
import {
  addCity,
  airportDisplay,
  arrivalAirport,
  basicDays,
  carForGroup,
  cityAirport,
  HOME_AIRPORT,
  planInternational,
  packageProfitFor,
  priceAtSource,
  resizeGroupCars,
  roomSuggestions,
  tripCountries,
  withDomesticFlights,
  withGroupCars,
  withPackageProfit,
  withScopeLines,
  type FlightPlan,
  chainCities,
  remainingNights,
  removeCity,
  setCityNights,
  withHotelLines,
  withTripDates,
  priceGroupOf,
  type BasicCity,
  type PriceGroup,
} from "@/lib/offer/basic";
import { validateDraft, type DraftIssue } from "@/lib/offer/draft-validation";
import { computeOfferPricing, rebase } from "@/lib/offer/pricing";
import { syncSuggestions, type TourPrice } from "@/lib/offer/pricing-suggest";
import { syncDepartureDates } from "@/lib/offer/schedule";
import { useRole } from "@/lib/roles/RoleContext";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { FieldIssueProvider } from "../generator/FieldIssue";
import { FlightsStage } from "../generator/stages/FlightsStage";
import { ServicesStage } from "../generator/stages/ServicesStage";
import { TermsStage } from "../generator/stages/TermsStage";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useDraftState } from "../generator/useDraftState";
import { BasicCityCard } from "./BasicCityCard";
import { BasicFlightPlan } from "./BasicFlightPlan";
import { BasicPhoneLookup } from "./BasicPhoneLookup";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import { nightsText, useBasicLabels, type BasicLabel } from "./labels";
import { basicCard, basicField, basicLabel, typedNumber } from "./styles";
import { HotelCombobox } from "./HotelCombobox";
import { IssueGuardNotice } from "../IssueGuardNotice";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Hotels are entered in riyals unless the agent says otherwise. */
const BASE_CURRENCY = "SAR";
/** The «يشمل» line the SIM count writes. */
const SIM_LINE = "شريحة اتصال";
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

/** The page's steps, in order; one is open at a time. */
type Step = "client" | "flights" | "cities" | "services" | "pricing" | "finish";
const STEP_ORDER: Step[] = ["client", "flights", "cities", "services", "pricing", "finish"];
/** Which step of this page answers a stage's blocking issue. */
const STEP_OF: Partial<Record<string, Step>> = {
  customer: "client",
  trip: "client",
  visas: "client",
  flights: "flights",
  cities: "cities",
  hotels: "cities",
  transport: "cities",
  services: "services",
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

/** «التالي» with what still stops it, in words — and «السابق» back to the step before (nothing entered is lost). */
function NextButton({ missing, onNext, onPrev }: { missing: string[]; onNext: () => void; onPrev?: () => void }) {
  const tx = useBasicLabels();
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-dashed border-[#DCE9E5] pt-2.5">
      {onPrev ? (
        <button
          type="button"
          onClick={onPrev}
          className="me-auto inline-flex h-9 items-center rounded-[9px] border border-[#cfe0d9] px-4 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
        >
          {tx("prev")}
        </button>
      ) : null}
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
  savedAt,
  lookups,
  profitSettings,
}: {
  draftId: string;
  initialData: DraftData;
  /** the draft's last server save — unsaved edits kept in the browser come back onto an older one. */
  savedAt: string;
  lookups: GeneratorLookups;
  /** who may set the package profit, and the margin a file starts with (settings, by the administration). */
  profitSettings: ProfitSettings;
}) {
  const tx = useBasicLabels();
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  const { data, patch, replace, flush, saveState } = useDraftState(draftId, initialData, savedAt);
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
      carForGroup(lookups.carTypes, merged.trip.adults + merged.trip.children),
    );
    // a domestic flight is one of the ways between cities — the two switches are one fact
    const nextScope = { ...merged.scope, flights_domestic: intercityModes(transport_plan).includes("flight") };
    // a move by air becomes its planned domestic leg — the agent never types a route the cities already say
    const shaped = { ...merged, cities: chained, scope: nextScope, ...withDomesticFlights({ ...merged, flights, cities: chained, transport_plan }, lookups.airports) };
    const hotels = withHotelLines(shaped, BASE_CURRENCY);
    const next = { ...shaped, hotels, days: basicDays({ ...shaped, hotels }) };
    latest.current = next;
    patch({ ...slice, flights: shaped.flights, cities: chained, transport_plan: shaped.transport_plan, scope: nextScope, hotels, days: next.days });
  }

  /** The trip's answers; a visa line still counting every traveller keeps counting them. */
  function setTrip(slice: Partial<DraftTrip>) {
    const next = withTripDates(trip, slice);
    const pax = (t: DraftTrip) => t.adults + t.children + t.infants;
    const visas = data.visas.map((v) => (v.count === pax(trip) ? { ...v, count: pax(next) } : v));
    const seated = (t: DraftTrip) => carForGroup(lookups.carTypes, t.adults + t.children);
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
    const old = plan.tours.car_type;
    const follow = slice.car_type !== undefined && old
      ? { cities: cities.map((c) => (c.tour_picks ? { ...c, tour_picks: c.tour_picks.map((p) => (p.car_type === old ? { ...p, car_type: undefined } : p)) } : c)) }
      : {};
    commit({ transport_plan: withCar({ ...plan, tours: { ...plan.tours, ...slice } }, slice.car_type), ...follow });
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

  /** The SIM cards: one «يشمل» line, rewritten or dropped with the count. */
  function setSims(count: number) {
    const includes = data.services.includes.filter((l) => !l.startsWith(SIM_LINE));
    patch({ services: { ...data.services, includes: count > 0 ? [...includes, `${SIM_LINE} × ${count}`] : includes } });
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

  // ---------- the tours price list of the trip's countries ----------
  const [tourPrices, setTourPrices] = useState<TourPrice[]>([]);
  const countryKey = tripCountries(data).sort().join("|");
  useEffect(() => {
    if (!countryKey) return;
    let live = true;
    void getTourPrices(countryKey.split("|")).then((list) => {
      if (live) setTourPrices(list);
    });
    return () => {
      live = false;
    };
  }, [countryKey]);

  // ---------- the ready programmes (tour_programs) of the file's cities ----------
  const [programs, setPrograms] = useState<TourProgram[]>([]);
  const cityKey = [...new Set(cities.map((c) => c.city_name))].sort().join("|");
  useEffect(() => {
    if (!cityKey) return;
    let live = true;
    void getTourPrograms(cityKey.split("|")).then((list) => {
      if (live) setPrograms(list);
    });
    return () => {
      live = false;
    };
  }, [cityKey]);

  // ---------- the add bar ----------
  const left = remainingNights(data);
  const [newCity, setNewCity] = useState("");
  const [newNights, setNewNights] = useState(0);
  const [newTours, setNewTours] = useState(0);
  // the stay, picked on the bar too — one «إضافة» books the city and its hotel
  const [newHotel, setNewHotel] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [newRooms, setNewRooms] = useState(0);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const nightsChoice = newNights || Math.max(left, 1);
  // the arrival day is spent arriving: four nights hold up to three tours (the city card allows more)
  const maxTours = Math.max(nightsChoice - 1, 0);
  const toursChoice = Math.min(newTours, maxTours);
  const roomsChoice = newRooms || Math.max(trip.rooms, 1);
  // the trip's country unless the group crosses into a neighbour
  const barCountry = findLookupCountry(lk.countries, newCountry || trip.country);
  const barHotels = barCountry?.cities.find((c) => c.name === newCity)?.hotels ?? [];
  const barRoomNames = roomSuggestions(lk.roomTypes, newHotel);

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
          tours: toursOn ? toursChoice : 0,
          country: barCountry?.name,
          hotel: hotel ? { id: hotel.id, name: hotel.name } : null,
          room: newRoom,
          rooms: roomsChoice,
          price: newPrice,
        },
        BASE_CURRENCY,
      ),
    );
    pickCity("");
    setNewNights(0);
    setNewTours(0);
    setNewRooms(0);
    setNewPrice(null);
  }

  const used = data.cities.reduce((sum, c) => sum + c.nights, 0);
  // over first: `left` is clamped at 0, so a file one night too long also has none left
  const nightsNote =
    used > trip.nights ? tx("over", { n: used - trip.nights }) : trip.nights > 0 && left === 0 ? tx("complete") : tx("remaining", { n: left });
  const nightsTone = trip.nights > 0 && used === trip.nights ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-white text-[#a86a10]";

  // where the international flights land and leave from — the two ends of the domestic moves
  const intlLegs = data.flights.filter((f) => f.leg_order !== "internal").sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""));
  const landingCity = intlLegs.filter((f) => f.leg_order === "outbound").at(-1)?.to_city?.trim() ?? "";
  const homeCity = intlLegs.find((f) => f.leg_order === "inbound")?.from_city?.trim() ?? "";
  const flies = (a: string, b: string) => Boolean(cityAirport(a, lookups.airports, data.flights) && cityAirport(b, lookups.airports, data.flights));
  const hopSelect = (a: string, b: string, label: string) => (
    <label key={`${a}>${b}`} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#557d78]">
      {label}
      <select
        value={hopMode(plan, a, b)}
        onChange={(e) => setHop(a, b, e.target.value as TransportMode)}
        className="h-7 rounded-[7px] border border-[#cfe0d9] bg-white px-1 text-[12px] font-bold text-[#185045]"
      >
        {MODE_CHIPS.filter((m) => modes.includes(m.mode)).map((m) => (
          <option key={m.mode} value={m.mode}>{tx(m.label)}</option>
        ))}
      </select>
    </label>
  );

  // day numbers on each card: after any travel day, one city after another
  const travelDays = data.days.filter((d) => d.kind === "travel").length;
  let dayCursor = travelDays + 1;

  // ---------- pricing (sell side only) ----------
  // a partner company prices its own file: the server hands it our prices at its terms
  const partnerSession = usePartnerBrand();
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
  const summary = useMemo(
    () =>
      computeOfferPricing(
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
      ),
    [shownItems, display, lookups.sarPer],
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
    const at = priceAtSource(latest.current, item, { price: slice.sell_price, currency: slice.sell_currency });
    // the source's figure is what we pay and what we sell at, as the sheet writes it
    const both = at
      ? {
          ...slice,
          ...("sell_price" in slice ? { buy_price: slice.sell_price ?? null } : {}),
          ...(slice.sell_currency ? { buy_currency: slice.sell_currency } : {}),
          overridden: false,
        }
      : { ...slice, overridden: true };
    const items = data.pricing.items.map((it, i) => (i === index ? { ...it, ...both } : it));
    if (at) commit({ ...at, pricing: { ...data.pricing, items } });
    else patch({ pricing: { ...data.pricing, items } });
  }

  function setProfit(profit: NonNullable<DraftData["pricing"]["profit"]>) {
    patch({ pricing: { ...data.pricing, profit } });
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
    await flush();
    setSavedGroup(key);
    if (complete) setOpenGroups((o) => ({ ...o, [key]: false }));
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
  const [guardBlocked, setGuardBlocked] = useState(false);
  const produced = data.produced_serial;

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
  const hasTickets = data.flights.some((f) => f.leg_order !== "internal" && f.flight_no.trim());
  const [flightView, setFlightView] = useState<"plan" | "final">(() => (hasTickets ? "final" : "plan"));

  // ---------- the steps: one open at a time ----------
  // the cities whose stay still lacks a room type, a board or a price — «إكمال» opens only these
  const hotelGaps = scope.hotels
    ? [...new Set(cities.map((c) => c.city_name))].filter((name) =>
        data.hotels.some(
          (h) =>
            h.city_name === name &&
            (h.rooms.some((r) => !(r.room_type_id || r.room_type_name.trim()) || !r.board_type) || (h.hotel_name.trim() && !h.sourcing && stayTotal(h) == null)),
        ),
      )
    : [];
  const [focus, setFocus] = useState<string[] | null>(null);
  // the cities the agent marked «تمت» — folded to their summary line
  const [doneCities, setDoneCities] = useState<string[]>([]);
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
    // what stops the flights, in words — «سعر الطيران الداخلي», not just «الطيران»
    flights: [...new Set(blocking.filter((i) => i.stage === "flights").map(issueText))],
    cities: [
      cities.length === 0 && tx("city"),
      cities.length > 0 && used !== trip.nights && nightsNote,
      // the reception car and the tours car, on the first city's tours tab
      scope.transport && cities.length > 0 && !plan.airport.car_type.trim() && tx("transferCar"),
      scope.transport && toursOn && cities.length > 0 && !plan.tours.car_type.trim() && tx("tourCar"),
      // a stay with no room type, board or price stops here, not at the end
      ...blocking.filter((i) => i.stage === "hotels").map(issueText),
    ].filter((x): x is string => Boolean(x)),
    services: [...new Set(blocking.filter((i) => i.stage === "services").map(issueText))],
    pricing: [...new Set(blocking.filter((i) => i.stage === "pricing").map(issueText))],
    finish: [],
  };
  const steps = STEP_ORDER.filter(
    (s) => (s !== "flights" || flightsOn) && (s !== "pricing" || canPricing),
  );
  // a new file opens on its first step; a file coming back, on the first one not done
  const firstTodo = steps.find((s) => missingOf[s].length > 0) ?? "finish";
  const [open, setOpen] = useState<Step>(firstTodo);
  const [reached, setReached] = useState<Step>(firstTodo);
  const shown = (s: Step) => steps.includes(s) && STEP_ORDER.indexOf(s) <= STEP_ORDER.indexOf(reached);

  function show(step: Step) {
    setOpen(step);
    // the flights step opens already planned: no empty box for what the file already says
    if (step === "flights" && scope.flights_intl && !latest.current.flights.some((f) => f.leg_order !== "internal")) {
      commit(planInternational(latest.current, lookups.airports, planDefaults));
    }
    if (step !== "cities") setFocus(null);
    // the prices are worked out as the step opens — no button to remember
    if (step === "pricing" && canPricing) void calculate();
    if (step === "services") commit({ services: withScopeLines(latest.current) });
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
      .map((c, i) => {
        // each visit of a city with its own hotels
        const hotel = [...new Set(cityHotelLines(cities, data.hotels, i).map((h) => h.hotel_name.trim()).filter(Boolean))].join(" + ");
        return `${c.city_name} (${nightsText(c.nights, language)})${hotel ? ` — ${hotel}` : ""}`;
      })
      .join(" · "),
    services: tx("servicesSummary", { a: data.services.includes.length, b: data.services.excludes.length }),
    pricing: data.pricing.items.length > 0 ? `${tx("total")}: ${summary.total_sell.toLocaleString("en-US")} ${display}` : tx("noLines"),
    finish: produced ?? (blocking.length > 0 ? tx("missing") : tx("allGood")),
  };
  const titleOf: Record<Step, string> = {
    client: tx("booking"),
    flights: t("pg.flightsTitle"),
    cities: tx("citiesStep"),
    services: tx("servicesStep"),
    pricing: tx("pricing"),
    finish: tx("finish"),
  };
  const fold = (step: Step, body: ReactNode) =>
    shown(step) ? (
      <Fold key={step} id={`basic-${step}`} title={titleOf[step]} open={open === step} onOpen={() => show(step)} summary={summaryOf[step]}>
        {body}
        {step === "finish" ? (
          // the last step has nothing after it — only the way back
          <div className="mt-3 border-t border-dashed border-[#DCE9E5] pt-2.5">
            <button
              type="button"
              onClick={() => show(steps[steps.indexOf(step) - 1])}
              className="inline-flex h-9 items-center rounded-[9px] border border-[#cfe0d9] px-4 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
            >
              {tx("prev")}
            </button>
          </div>
        ) : (
          <NextButton missing={missingOf[step]} onNext={() => next(step)} onPrev={steps.indexOf(step) > 0 ? () => show(steps[steps.indexOf(step) - 1]) : undefined} />
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
          {/* who sells it is ours to choose — a partner's own file is already its own */}
          {partnerSession ? null : (
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
    // first the route as planned (cities, days, a rough price); the tickets later, under «الرحلة النهائية»
    flights:
      flightView === "final" || !scope.flights_intl ? (
        <div className="space-y-2">
          {scope.flights_intl && !hasTickets ? (
            <button
              type="button"
              onClick={() => setFlightView("plan")}
              className="inline-flex h-7 items-center gap-1 text-[11.5px] font-bold text-[#557d78] hover:text-[#185045]"
            >
              <ArrowRight className="size-3.5 ltr:rotate-180" />
              {tx("backToPlan")}
            </button>
          ) : null}
          <div className="-mx-3 -mb-1 [&>section]:border-0 [&>section]:p-3 [&>section]:shadow-none [&_h2]:hidden">
            <FlightsStage draftId={draftId} data={data} patch={commit} replace={replace} flush={flush} lookups={lk} compact />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <BasicFlightPlan data={data} lookups={lk} defaults={planDefaults} onChange={commit} onFinal={() => setFlightView("final")} />
          {/* the domestic hops are entered as they always were */}
          {scope.flights_domestic ? (
            <div className="-mx-3 -mb-1 border-t border-dashed border-[#DCE9E5] [&>section]:border-0 [&>section]:p-3 [&>section]:shadow-none [&_h2]:hidden">
              <FlightsStage draftId={draftId} data={data} patch={commit} replace={replace} flush={flush} lookups={lk} compact only="domestic" />
            </div>
          ) : null}
        </div>
      ),

    // ---- 3. the cities, each with its hotel, and the bar that adds them ----
    cities: (
      <div className="space-y-3">
        {/* how the group moves between cities — the transport step's only question left */}
        {cities.length > 1 && !focus ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={basicLabel}>{tx("between")}</span>
            {MODE_CHIPS.map(({ mode, label, icon }) => (
              <Chip key={mode} on={modes.includes(mode)} icon={icon} label={tx(label)} onClick={() => toggleMode(mode)} />
            ))}
          </div>
        ) : null}
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
            const dayFrom = dayCursor;
            dayCursor += city.nights;
            if (focus && !focus.includes(city.city_name)) return null;
            // the group may land in another city and fly on — or fly from the last city to the flight home
            const from = cities[i - 1]?.city_name ?? (landingCity && landingCity !== city.city_name && flies(landingCity, city.city_name) ? landingCity : "");
            const out = i === cities.length - 1 && homeCity && homeCity !== city.city_name && flies(city.city_name, homeCity) ? homeCity : "";
            // several ways between cities: each move says which one it takes
            const hop =
              modes.length > 1 && (from || out) ? (
                <>
                  {from ? hopSelect(from, city.city_name, tx("hop", { city: from })) : null}
                  {out ? hopSelect(city.city_name, out, tx("hopOut", { city: out })) : null}
                </>
              ) : undefined;
            return (
              <BasicCityCard
                key={`${i}-${city.city_name}`}
                index={i}
                city={city}
                dayFrom={dayFrom}
                data={data}
                lookups={lk}
                programs={programs.filter((p) => p.city_name === city.city_name)}
                tourPrices={tourPrices}
                hotelsOn={scope.hotels}
                toursOn={toursOn}
                transportOn={scope.transport}
                isFirst={i === 0}
                isLast={i === cities.length - 1}
                hop={hop}
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
                onFlights={() => (steps.includes("flights") ? show("flights") : undefined)}
                onRemove={() => {
                  if (window.confirm(tx("confirmRemove", { city: city.city_name }))) commit(removeCity(data, i));
                }}
                collapsed={doneCities.includes(`${i}-${city.city_name}`)}
                onDone={() => {
                  setDoneCities((d) => [...d, `${i}-${city.city_name}`]);
                  // on to the next city
                  window.setTimeout(() => document.getElementById(`basic-city-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
                }}
                onExpand={() => setDoneCities((d) => d.filter((k) => k !== `${i}-${city.city_name}`))}
              />
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
                  <HotelCombobox
                    hotels={barHotels}
                    valueId={newHotel || null}
                    placeholder={tx("choose")}
                    onPick={(h) => setNewHotel(h?.id ?? "")}
                  />
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
        )}
      </div>
    ),

    // ---- 4. what the programme includes and does not — the generator's own lists, ✓ / ✗ ----
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

    // ---- 5. the price (sell side only, for whoever may see prices) ----
    pricing: (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="ms-auto inline-flex items-center gap-1.5 text-[11px] font-bold text-[#557d78]">
                {tx("quote")}
                <select
                  value={display}
                  onChange={(e) =>
                    patch({ pricing: { ...data.pricing, display_currency: e.target.value } })
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
                      {g.rows.map(({ item, i }) => (
                        <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-1.5 sm:grid-cols-[1fr_52px_8rem_5.5rem]">
                          <span className="min-w-0 truncate text-[12px] font-bold text-[#185045]" title={item.description}>
                            {item.description}
                          </span>
                          <span className="tv-tnum hidden text-center text-[11px] font-bold text-[#7a948f] sm:block">× {item.quantity}</span>
                          <input
                            type="number"
                            min={0}
                            dir="ltr"
                            aria-label={tx("sell")}
                            value={item.sell_price ?? ""}
                            placeholder="—"
                            onChange={(e) => setItem(i, { sell_price: typedNumber(e.target) })}
                            className={`${basicField} tv-tnum text-center ${item.sell_price == null ? "border-[#f0b4c2] bg-[#fff5f7]" : ""}`}
                          />
                          <select value={item.sell_currency || display} onChange={(e) => setItem(i, { sell_currency: e.target.value })} className={`${basicField} px-1.5`}>
                            {currencyOptions(lookups.countries, item.sell_currency || display).map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      ))}
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
                    <DirText>{`${summary.total_sell.toLocaleString("en-US")} ${display}`}</DirText>
                  </span>
                </div>
                {partnerSession ? (
                  <label className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-[#d8e6e0] bg-[#f8fbf9] px-3 py-2">
                    <span className="text-[12.5px] font-extrabold text-[#0f3d38]">{t("pg.partnerSell")}</span>
                    <input
                      type="number"
                      min={0}
                      dir="ltr"
                      value={data.pricing.final_total ?? ""}
                      placeholder={summary.total_sell.toLocaleString("en-US")}
                      onChange={(e) => patch({ pricing: { ...data.pricing, final_total: typedNumber(e.target) } })}
                      className={`${basicField} tv-tnum w-36 text-center`}
                    />
                    {data.pricing.final_total != null && data.pricing.final_total < summary.total_sell ? (
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
              <IssueGuardNotice hotels={data.hotels} onBlocked={setGuardBlocked} className="mt-2" />
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
