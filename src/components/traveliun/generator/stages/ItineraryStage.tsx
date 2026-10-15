"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import {
  BookOpen,
  Bus,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Coffee,
  Loader2,
  PlaneLanding,
  Plus,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { FREE_DAY_TITLE, isFreeDay, tourVehicle, type DraftDay, type TourPick } from "@/lib/offer/draft-types";
import {
  dayTours,
  daysFromTours,
  draftDaysNeedRebuild,
  fillCityTours,
  isTouringDay,
  transportNoteForDay,
  withDayPick,
  withDayTour,
  type TourProgram,
} from "@/lib/offer/itinerary";
import { tripCountries } from "@/lib/offer/basic";
import type { TourPrice } from "@/lib/offer/pricing-suggest";
import { formatWeatherAr, isWeatherEmpty, weatherSourceAr } from "@/lib/offer/weather-format";
import { arrivalDayNoteAr, dayOneIsUsable } from "@/lib/offer/timezones";
import { FieldIssue } from "../FieldIssue";
import { finalOutbound, itineraryStartDate } from "@/lib/offer/schedule";
import {
  generateItineraryDays,
  getAssistantAvailability,
  refreshItineraryWeather,
} from "@/lib/data/itinerary-actions";
import { getTourPrices, getTourPrograms } from "@/lib/data/tour-programs";
import type { TranslationKey } from "@/lib/i18n";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { TourChoices, TourRow, tourField, type TourCatalog } from "../../tours/TourRow";
import { fieldClass, sectionClass, type StageFormProps } from "../stage-props";

/** Arabic counts: «يوم واحد / يومان / 3 أيام / 11 يوماً». */
const plural = (n: number): "one" | "two" | "few" | "many" => (n === 1 ? "one" : n === 2 ? "two" : n <= 10 ? "few" : "many");

/**
 * Stage 9 — the day-by-day programme and its tours («البرنامج اليومي والجولات»).
 *
 * Days are DERIVED (number, date, city) and only the text is authored, so the
 * programme can never disagree with the trip. The days are grouped by city —
 * «كوالالمبور — يومان (20–21 أكتوبر) · جولة واحدة · فان × 2» — and a day holds
 * its tour the way the basic screen's city card does (TourRow, shared): the
 * service from this city's programmes or the price list, the car, how many,
 * the price per car and the total (pricing.view only), and its wording. A tour
 * written in the basic screen opens here already on its day, and the other way
 * round: both edit the same picks.
 *
 * On top: «تعبئة الأيام من البرامج الجاهزة» (all cities, or one from its
 * header — real tours, priced), «صياغة بالذكاء الاصطناعي» (activities only: a
 * tour, its car and its price are never its to change), and «تحديث الطقس» —
 * a REAL reading per day, labelled forecast vs climate average.
 *
 * The days are a row of chips over the cities; only the open day's city is
 * unfolded, and the open day spans it — a ten-day programme as ten stacked
 * forms was a scroll the agent got lost in.
 */
export function ItineraryStage({ draftId, data, patch, replace, lookups }: StageFormProps) {
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"ai" | "weather" | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [available, setAvailable] = useState<{ ai: boolean; flightLookup: boolean } | null>(null);
  const days = data.days;
  const plan = data.transport_plan;
  const tripCar = plan.tours.car_type.trim();

  // What the outbound flight actually does to day one. The LOCAL landing time,
  // which is the only version of it the group experiences.
  const landing = finalOutbound(data.flights)?.arrival_at ?? null;
  const arrivalNote = arrivalDayNoteAr(landing);
  const dayOneUsable = dayOneIsUsable(landing);

  useEffect(() => {
    void getAssistantAvailability().then(setAvailable);
  }, []);

  // Keep the days in step with the trip, the cities and their tours. Runs only
  // when something actually moved, so it never fights the agent's typing; a
  // tour entered on the basic screen is on its day when the programme opens.
  const tripKey = `${itineraryStartDate(data.trip, data.flights)}|${data.flights.map((f) => f.departure_at).join(",")}|${data.trip.nights}|${data.trip.days}|${data.cities
    .map((c) => `${c.city_name}:${c.nights}`)
    .join(",")}`;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current === tripKey) return;
    lastKey.current = tripKey;
    const empty = (d: DraftDay) => !d.title.trim() && d.activities.every((a) => !a.trim());
    const unwritten = days.some((d, i) => empty(d) && dayTours(data, i)?.picks.some((p) => !p.free));
    if (draftDaysNeedRebuild(data) || unwritten) patch({ days: daysFromTours(data) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripKey]);

  function updateDay(index: number, slice: Partial<DraftDay>) {
    patch({
      days: days.map((day, i) => {
        if (i !== index) return day;
        // any human edit clears the AI flag — the badge means "unreviewed"
        const next = { ...day, ...slice, ai_generated: false };
        // a day the agent rewrote is theirs: its tour no longer writes it (daysFromTours)
        const rewritten = next.title !== day.title || next.activities.join("\n") !== day.activities.join("\n");
        return rewritten ? { ...next, auto_title: undefined } : next;
      }),
    });
  }

  function runAssistant(kind: "ai" | "weather") {
    setError(null);
    setBusy(kind);
    startTransition(async () => {
      // `days` goes WITH the request: the shell saves on a debounce, so text
      // typed seconds ago may not be in the database yet and reading it back
      // would silently discard it.
      const result =
        kind === "ai"
          ? await generateItineraryDays(draftId, true, days)
          : await refreshItineraryWeather(draftId, days);
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // the action already persisted — swap local state WITHOUT re-saving
      replace({ ...data, days: result.days });
    });
  }

  // ---------- ready-made programmes, and the tours price list ----------
  const cityKey = [...new Set(days.map((d) => d.city_name).filter(Boolean))].join("|");
  const [programs, setPrograms] = useState<TourProgram[]>([]);
  useEffect(() => {
    let live = true;
    void getTourPrograms(cityKey ? cityKey.split("|") : []).then((rows) => {
      if (live) setPrograms(rows);
    });
    return () => {
      live = false;
    };
  }, [cityKey]);
  const countryKey = tripCountries(data).sort().join("|");
  const [tourPrices, setTourPrices] = useState<TourPrice[]>([]);
  useEffect(() => {
    if (!countryKey) return;
    let live = true;
    void getTourPrices(countryKey.split("|")).then((rows) => {
      if (live) setTourPrices(rows);
    });
    return () => {
      live = false;
    };
  }, [countryKey]);
  const [filledNote, setFilledNote] = useState<number | null>(null);

  /** Every city's empty touring days, or one city's, from its programmes — each a real tour of its day. */
  function fillFromPrograms(city?: string) {
    const result = fillCityTours(data, programs, city);
    setFilledNote(result.filled);
    if (result.filled > 0) patch({ cities: result.cities, days: result.days });
  }

  /** One tour of a day changed in place; a tour field emptied is no tour. */
  function setDayPick(index: number, k: number, slice: Partial<TourPick> | null) {
    const none = slice !== null && "title" in slice && !slice.title?.trim() && !slice.free;
    const next = withDayPick(data, index, k, none ? null : slice);
    if (next) patch(next);
  }

  /** No tours car yet: the first chosen is the trip's, and the days say it. */
  function setTripCar(car: string) {
    const transport_plan = { ...plan, tours: { ...plan.tours, car_type: car } };
    patch({ transport_plan, days: daysFromTours({ ...data, transport_plan }) });
  }

  const catalogFor = (city: string): TourCatalog => ({
    city,
    programs: programs.filter((p) => p.city_name === city),
    prices: tourPrices,
    sarPer: lookups.sarPer ?? { SAR: 1 },
    carTypes: lookups.carTypes,
    tripCar,
    // one open day at a time — one list
    listId: "itin-tours",
    showPrice: can("pricing.view"),
  });

  // ---------- the cities, one group of days each ----------
  type Group = { key: string; city: string; travel: boolean; days: number[] };
  const groups: Group[] = [];
  days.forEach((d, i) => {
    const travel = d.kind === "travel";
    const last = groups.at(-1);
    if (last && last.travel === travel && last.city === d.city_name) last.days.push(i);
    else groups.push({ key: `${groups.length}-${d.city_name}`, city: d.city_name, travel, days: [i] });
  });
  const toursOf = (i: number) => dayTours(data, i)?.picks.filter((p) => !p.free) ?? [];
  const cars = (picks: TourPick[]) => [...new Set(picks.map((p) => tourVehicle(p, tripCar)).filter(Boolean))].join("، ");
  const rangeFormatter = new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  /** «كوالالمبور — يومان (20–21 أكتوبر) · جولة واحدة · فان × 2» */
  const groupTitle = (g: Group) => {
    if (g.travel) return days[g.days[0]].title || "—";
    const dates = g.days.map((i) => days[i].date).filter((d): d is string => Boolean(d));
    const range = dates.length > 0 ? rangeFormatter.formatRange(new Date(`${dates[0]}T00:00:00Z`), new Date(`${dates[dates.length - 1]}T00:00:00Z`)) : "";
    const tours = g.days.flatMap(toursOf);
    return [
      `${g.city || "—"} — ${t(`pg.itin.days.${plural(g.days.length)}`, { n: g.days.length })}${range ? ` (${range})` : ""}`,
      tours.length > 0 ? t(`pg.itin.tours.${plural(tours.length)}`, { n: tours.length }) : "",
      cars(tours),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  // ---------- one day at a time ----------
  // Opens on the first day still without a title.
  const [open, setOpen] = useState(() => {
    const first = days.findIndex((d) => !d.title.trim());
    return first >= 0 ? first : 0;
  });
  /** true = folded; a city not touched yet is open while it holds the open day. */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  /** the arrival day whose «جولة بعد الوصول» was pressed — its tour row shows. */
  const [afterArrival, setAfterArrival] = useState<number | null>(null);
  const current = Math.min(Math.max(open, 0), Math.max(days.length - 1, 0));
  const day = days[current];
  const groupOf = (i: number) => groups.find((g) => g.days.includes(i))?.key ?? "";
  function select(i: number) {
    setOpen(i);
    const key = groupOf(i);
    setFolded((f) => (f[key] ? { ...f, [key]: false } : f));
  }

  const onDay = day ? dayTours(data, current) : null;
  const dayPicks = onDay?.picks ?? [];
  // the day's tour rows: its tours, else one to fill — an arrival day asks first («جولة بعد الوصول»)
  const blank: TourPick = { program_id: null, title: "", text: "", price: null, cars: plan.tours.cars };
  const tourRows = !onDay ? [] : dayPicks.length > 0 ? dayPicks : isTouringDay(days, current) || afterArrival === current ? [blank] : [];
  const showPrice = can("pricing.view");
  const transportNote = day && data.scope.transport ? transportNoteForDay(data.transport_plan, days, current, data.flights) : null;
  // the landing note goes on the day the group lands, after any travel day
  const arrivalIndex = days.findIndex((d) => d.kind !== "travel");

  const dateFormatter = new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const dateOf = (d: DraftDay) => (d.date ? dateFormatter.format(new Date(`${d.date}T00:00:00`)) : "—");

  const openDay = day ? (
    <article key={day.day_number} className="tv-fade-up bg-[#f8fbf9] p-3">
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="tv-tnum inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#185045] px-2 text-[12px] font-extrabold text-white">
          <DirText dir="ltr">{String(day.day_number)}</DirText>
        </span>
        <span className="text-[12.5px] font-extrabold text-[#185045]">{day.city_name || "—"}</span>
        {day.date ? <span className="text-[11.5px] font-bold text-[#93aaa3]">{dateOf(day)}</span> : null}
        {day.ai_generated ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#efe7fb] px-2 py-0.5 text-[10.5px] font-extrabold text-[#6b3fa0]">
            <Sparkles className="size-3" />
            {t("pg.itin.aiBadge")}
          </span>
        ) : null}
        {!isWeatherEmpty(day.weather) && day.weather ? (
          <span
            className={`tv-tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${
              day.weather.source === "forecast" ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#eef2fb] text-[#3c5a9a]"
            }`}
            title={`${weatherSourceAr(day.weather.source)} · ${day.weather.fetched_at.slice(0, 10)}`}
          >
            <CloudSun className="size-3" />
            {formatWeatherAr(day.weather)}
            <span className="opacity-70">({weatherSourceAr(day.weather.source)})</span>
          </span>
        ) : null}
        {/* Day one is worth what is LEFT of it. A 04:00 landing buys a
            bed and an afternoon; a 23:40 landing buys nothing — and both
            used to read as a full first day with tours planned on it. */}
        {current === arrivalIndex && arrivalNote ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${
              dayOneUsable ? "bg-[#eef2fb] text-[#3c5a9a]" : "bg-[#fff8e8] text-[#a86a10]"
            }`}
          >
            <PlaneLanding className="size-3" />
            {arrivalNote}
          </span>
        ) : null}
        {/* The vehicle for THIS day, derived from the transport plan — a
            fact about the day, printed on the same day in the PDF. */}
        {transportNote ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-extrabold text-[#557d78]">
            <Bus className="size-3" />
            {transportNote}
          </span>
        ) : null}
      </header>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* A free day is a real part of a programme, not a gap in it. One
            press writes it as a deliberate choice; pressing again gives
            the day back rather than trapping it. */}
        <button
          type="button"
          onClick={() => {
            const text = isFreeDay(day) ? { title: "", activities: [] } : { title: FREE_DAY_TITLE, activities: [t("pg.freeDayHint")] };
            // a free day holds no tour: one picked for it goes, so it is neither priced nor booked
            const untoured = !isFreeDay(day) && dayPicks.length > 0 ? withDayTour(data, current, null) : null;
            if (untoured) patch({ cities: untoured.cities, days: untoured.days.map((d, i) => (i === current ? { ...d, ...text } : d)) });
            else updateDay(current, { ...text, ai_generated: false });
          }}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-bold transition-colors ${
            isFreeDay(day) ? "border-[#185045] bg-[#185045] text-white" : "border-[#b7d0c7] bg-white text-[#185045] hover:bg-[#f0f7f4]"
          }`}
        >
          <Coffee className="size-3.5" />
          {t("pg.freeDay")}
        </button>
        {/* the group lands (or moves) and still tours: the reception stays, the tour follows it */}
        {onDay && tourRows.length === 0 ? (
          <button
            type="button"
            onClick={() => setAfterArrival(current)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-[#b7d0c7] bg-white px-3 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
          >
            <Plus className="size-3.5" />
            {t("pg.itin.tourAfterArrival")}
          </button>
        ) : null}
      </div>

      {/* the day's tour — the same row as the basic screen's city card */}
      {tourRows.length > 0 ? (
        <div className="mb-2 space-y-2 rounded-[10px] border border-[#e2ebe7] bg-white p-2.5">
          <TourChoices catalog={catalogFor(day.city_name)} />
          {tourRows.map((pick, k) => (
            <TourRow
              key={k}
              pick={pick}
              catalog={catalogFor(day.city_name)}
              onChange={(slice) => setDayPick(current, k, slice)}
              onTripCar={setTripCar}
              onRemove={dayPicks[k] ? () => setDayPick(current, k, null) : undefined}
              describe
              labelled
              field={tourField}
              className={`grid grid-cols-2 items-start gap-2 ${
                showPrice
                  ? "sm:grid-cols-[minmax(12rem,2fr)_minmax(9rem,1fr)_5rem_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_2.25rem]"
                  : "sm:grid-cols-[minmax(12rem,2fr)_minmax(9rem,1fr)_5rem_2.25rem]"
              }`}
            />
          ))}
        </div>
      ) : null}

      <label className="mb-2 grid gap-1.5 text-[12px] font-bold text-[#185045]">
        {t("pg.itin.dayTitle")}
        <input
          value={day.title}
          onChange={(e) => updateDay(current, { title: e.target.value })}
          placeholder={t("pg.itin.dayTitlePlaceholder")}
          className={fieldClass}
        />
      </label>

      <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
        {t("pg.itin.activities")}
        <textarea
          value={day.activities.join("\n")}
          onChange={(e) => updateDay(current, { activities: e.target.value.split("\n").map((line) => line.trimStart()) })}
          onBlur={(e) =>
            updateDay(current, {
              activities: e.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
          rows={4}
          placeholder={t("pg.itin.activitiesPlaceholder")}
          className="w-full rounded-[10px] border border-[#dbe6e1] bg-white p-3 text-sm leading-6 text-[#185045] outline-none transition-colors focus:border-[#2aa87a]"
        />
      </label>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => select(current - 1)}
          disabled={current === 0}
          className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6] disabled:invisible"
        >
          <ChevronRight className="size-4 ltr:rotate-180 rtl:rotate-0" />
          {t("pg.itin.prevDay")}
        </button>
        {current < days.length - 1 ? (
          <button
            type="button"
            onClick={() => select(current + 1)}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0f4439]"
          >
            {t("pg.itin.nextDay")}
            <ChevronLeft className="size-4 ltr:rotate-180 rtl:rotate-0" />
          </button>
        ) : null}
      </div>
    </article>
  ) : null;

  return (
    <section className={sectionClass}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.itin.title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {programs.some((p) => !p.is_free_day) ? (
            <button
              type="button"
              onClick={() => fillFromPrograms()}
              disabled={days.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#185045] bg-white px-3.5 text-[12.5px] font-bold text-[#185045] transition-colors hover:bg-[#f0f7f4] disabled:opacity-50"
            >
              <BookOpen className="size-4" />
              {t("pg.itin.fillFromPrograms")}
            </button>
          ) : null}
          {available?.ai ? (
            <button
              type="button"
              onClick={() => runAssistant("ai")}
              disabled={pending || days.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-3.5 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0f3d38] disabled:opacity-50"
            >
              {busy === "ai" ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {t("pg.itin.generate")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => runAssistant("weather")}
            disabled={pending || days.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-3.5 text-[12.5px] font-bold text-[#185045] transition-colors hover:bg-[#f4f8f6] disabled:opacity-50"
          >
            {busy === "weather" ? <Loader2 className="size-4 animate-spin" /> : <CloudSun className="size-4" />}
            {t("pg.itin.refreshWeather")}
          </button>
        </div>
      </div>

      {available && !available.ai ? (
        <p className="mb-3 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbf9] px-3 py-2 text-[12px] font-bold text-[#557d78]">
          {t("pg.itin.aiUnavailable")}
        </p>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-[10px] border border-[#f2c7c7] bg-[#fff1f1] px-3 py-2 text-[12px] font-bold text-[#c43d3d]">
          {t(error)}
        </p>
      ) : null}

      {filledNote !== null ? (
        <p role="status" className="mb-3 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-2 text-[12px] font-bold text-[#0f7a52]">
          {filledNote > 0 ? t("pg.itin.filledN", { n: filledNote }) : t("pg.itin.filledNone")}
        </p>
      ) : null}

      <FieldIssue field="itinerary" className="mb-3" />

      {!day ? (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("pg.itin.empty")}
        </p>
      ) : (
        <>
          {/* every day at a glance, a line between one city and the next */}
          <div role="tablist" aria-label={t("pg.itin.title")} className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {groups.map((g, gi) => (
              <Fragment key={g.key}>
                {gi > 0 ? <span aria-hidden className="w-px shrink-0 self-stretch bg-[#cfe0d9]" /> : null}
                {g.days.map((index) => {
                  const d = days[index];
                  const written = Boolean(d.title.trim());
                  const active = index === current;
                  return (
                    <button
                      key={d.day_number}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => select(index)}
                      className={`flex min-w-[118px] shrink-0 flex-col items-start gap-0.5 rounded-[11px] border px-3 py-2 text-start transition-colors ${
                        active ? "border-[#185045] bg-[#185045] text-white" : "border-[#e2ebe7] bg-white text-[#185045] hover:bg-[#f4f8f6]"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[12px] font-extrabold">
                        <span className={`size-2 rounded-full ${written ? "bg-[#2aa87a]" : active ? "bg-white/50" : "bg-[#d8e3de]"}`} />
                        {t("pg.itin.dayN", { n: d.day_number })}
                      </span>
                      <span className={`text-[10.5px] font-bold ${active ? "text-[#bfe9d9]" : "text-[#93aaa3]"}`}>{dateOf(d)}</span>
                      <span className={`max-w-[140px] truncate text-[10.5px] font-bold ${active ? "text-white" : "text-[#557d78]"}`}>{d.city_name || "—"}</span>
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>

          {/* the cities: a header each, its days under it, the open day across it */}
          <div className="space-y-2">
            {groups.map((g) => {
              const expanded = folded[g.key] === undefined ? g.days.includes(current) : !folded[g.key];
              const cityPrograms = !g.travel && programs.some((p) => p.city_name === g.city && !p.is_free_day);
              return (
                <div key={g.key} className="overflow-hidden rounded-[12px] border border-[#e2ebe7]">
                  <div className="flex flex-wrap items-center gap-2 bg-[#f4f8f6] px-3 py-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      title={t("pg.itin.fold")}
                      onClick={() => setFolded((f) => ({ ...f, [g.key]: expanded }))}
                      className="flex min-w-0 flex-1 items-center gap-2 text-start"
                    >
                      <ChevronDown className={`size-4 shrink-0 text-[#557d78] transition-transform ${expanded ? "" : "ltr:-rotate-90 rtl:rotate-90"}`} />
                      <span className="tv-tnum min-w-0 text-[12.5px] font-extrabold text-[#0f3d38]">{groupTitle(g)}</span>
                    </button>
                    {cityPrograms ? (
                      <button
                        type="button"
                        onClick={() => fillFromPrograms(g.city)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#b7d0c7] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                      >
                        <BookOpen className="size-3.5" />
                        {t("pg.itin.fillCity")}
                      </button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <ol className="divide-y divide-[#eef3f1]">
                      {g.days.map((index) => {
                        if (index === current) return <li key={index}>{openDay}</li>;
                        const d = days[index];
                        const tours = toursOf(index);
                        return (
                          <li key={index}>
                            <button type="button" onClick={() => select(index)} className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-[#f7fbf9]">
                              <span className="tv-tnum inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef4f1] text-[11px] font-extrabold text-[#185045]">
                                {d.day_number}
                              </span>
                              <span className="shrink-0 text-[11px] font-bold text-[#93aaa3]">{dateOf(d)}</span>
                              <span className={`min-w-0 flex-1 truncate text-[12.5px] font-bold ${d.title.trim() ? "text-[#185045]" : "text-[#b9c9c4]"}`}>
                                {d.title.trim() || "—"}
                              </span>
                              {tours.length > 0 ? (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-extrabold text-[#557d78]">
                                  <Camera className="size-3" />
                                  {cars(tours) || tours.length}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {days.length > 0 ? (
        <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-5 text-[#93aaa3]">
          <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
          {t("pg.itin.hint")}
        </p>
      ) : null}
    </section>
  );
}
