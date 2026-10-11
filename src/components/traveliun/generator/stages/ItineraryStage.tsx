"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  BookOpen,
  Bus,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Coffee,
  Loader2,
  PlaneLanding,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { FREE_DAY_TITLE, isFreeDay, type DraftDay } from "@/lib/offer/draft-types";
import {
  draftDaysNeedRebuild,
  draftDaySkeleton,
  fillDaysFromPrograms,
  programDayText,
  transportNoteForDay,
  type TourProgram,
} from "@/lib/offer/itinerary";
import { formatWeatherAr, isWeatherEmpty, weatherSourceAr } from "@/lib/offer/weather-format";
import { arrivalDayNoteAr, dayOneIsUsable } from "@/lib/offer/timezones";
import { FieldIssue } from "../FieldIssue";
import { itineraryStartDate } from "@/lib/offer/schedule";
import {
  generateItineraryDays,
  getAssistantAvailability,
  refreshItineraryWeather,
} from "@/lib/data/itinerary-actions";
import { getTourPrograms } from "@/lib/data/tour-programs";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, sectionClass, type StageFormProps } from "../stage-props";

/**
 * Stage 9 — the day-by-day program.
 *
 * Days are DERIVED (number, date, city) and only the text is authored, so the
 * program can never disagree with the trip. Three helpers sit on top:
 *   • the old system's ready-made tours (tour_programs) — per day, or every
 *     empty touring day at once, in the order the agency always sold them;
 *   • «توليد بالذكاء الاصطناعي» drafts the text — flagged, never auto-published,
 *     and by default it only fills days the agent has not written;
 *   • «تحديث الطقس» attaches a REAL reading per day, labelled forecast vs
 *     climate average so an average is never shown as a forecast.
 *
 * The days are a row of chips over ONE open card. A ten-day programme as ten
 * stacked forms was a scroll the agent got lost in.
 */
export function ItineraryStage({ draftId, data, patch, replace }: StageFormProps) {
  const { t, language } = useTraveliunUI();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"ai" | "weather" | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [available, setAvailable] = useState<{ ai: boolean; flightLookup: boolean } | null>(null);
  const days = data.days;

  // What the outbound flight actually does to day one. The LOCAL landing time,
  // which is the only version of it the group experiences.
  const landing = data.flights.find((f) => f.leg_order === "outbound")?.arrival_at ?? null;
  const arrivalNote = arrivalDayNoteAr(landing);
  const dayOneUsable = dayOneIsUsable(landing);

  useEffect(() => {
    void getAssistantAvailability().then(setAvailable);
  }, []);

  // Keep the skeleton in step with the trip/cities. Runs only when something
  // actually moved, so it never fights the agent's typing.
  const tripKey = `${itineraryStartDate(data.trip, data.flights)}|${data.flights.map((f) => f.departure_at).join(",")}|${data.trip.nights}|${data.trip.days}|${data.cities
    .map((c) => `${c.city_name}:${c.nights}`)
    .join(",")}`;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current === tripKey) return;
    lastKey.current = tripKey;
    if (draftDaysNeedRebuild(data)) patch({ days: draftDaySkeleton(data) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripKey]);

  function updateDay(index: number, slice: Partial<DraftDay>) {
    patch({
      days: days.map((day, i) =>
        // any human edit clears the AI flag — the badge means "unreviewed"
        i === index ? { ...day, ...slice, ai_generated: false } : day,
      ),
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

  // ---------- ready-made programmes ----------
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
  const [filledNote, setFilledNote] = useState<number | null>(null);

  function fillFromPrograms() {
    const result = fillDaysFromPrograms(days, programs);
    setFilledNote(result.filled);
    if (result.filled > 0) patch({ days: result.days });
  }

  // ---------- one day at a time ----------
  // Opens on the first day still without a title.
  const [open, setOpen] = useState(() => {
    const first = days.findIndex((d) => !d.title.trim());
    return first >= 0 ? first : 0;
  });
  const current = Math.min(Math.max(open, 0), Math.max(days.length - 1, 0));
  const day = days[current];
  const dayPrograms = day ? programs.filter((p) => p.city_name === day.city_name) : [];
  const transportNote = day && data.scope.transport ? transportNoteForDay(data.transport_plan, days, current, data.flights) : null;
  // the landing note goes on the day the group lands, after any travel day
  const arrivalIndex = days.findIndex((d) => d.kind !== "travel");

  const dateFormatter = new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <section className={sectionClass}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.itin.title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {programs.some((p) => !p.is_free_day) ? (
            <button
              type="button"
              onClick={fillFromPrograms}
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
        <p
          role="status"
          className="mb-3 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-2 text-[12px] font-bold text-[#0f7a52]"
        >
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
          <div role="tablist" aria-label={t("pg.itin.title")} className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map((d, index) => {
              const written = Boolean(d.title.trim());
              const active = index === current;
              return (
                <button
                  key={d.day_number}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setOpen(index)}
                  className={`flex min-w-[118px] shrink-0 flex-col items-start gap-0.5 rounded-[11px] border px-3 py-2 text-start transition-colors ${
                    active
                      ? "border-[#185045] bg-[#185045] text-white"
                      : "border-[#e2ebe7] bg-white text-[#185045] hover:bg-[#f4f8f6]"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[12px] font-extrabold">
                    <span
                      className={`size-2 rounded-full ${written ? "bg-[#2aa87a]" : active ? "bg-white/50" : "bg-[#d8e3de]"}`}
                    />
                    {t("pg.itin.dayN", { n: d.day_number })}
                  </span>
                  <span className={`text-[10.5px] font-bold ${active ? "text-[#bfe9d9]" : "text-[#93aaa3]"}`}>
                    {d.date ? dateFormatter.format(new Date(`${d.date}T00:00:00`)) : "—"}
                  </span>
                  <span className={`max-w-[140px] truncate text-[10.5px] font-bold ${active ? "text-white" : "text-[#557d78]"}`}>
                    {d.city_name || "—"}
                  </span>
                </button>
              );
            })}
          </div>

          <article key={day.day_number} className="tv-fade-up rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
            <header className="mb-2.5 flex flex-wrap items-center gap-2">
              <span className="tv-tnum inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#185045] px-2 text-[12px] font-extrabold text-white">
                <DirText dir="ltr">{String(day.day_number)}</DirText>
              </span>
              <span className="text-[12.5px] font-extrabold text-[#185045]">{day.city_name || "—"}</span>
              {day.date ? (
                <span className="text-[11.5px] font-bold text-[#93aaa3]">
                  {dateFormatter.format(new Date(`${day.date}T00:00:00`))}
                </span>
              ) : null}
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
                onClick={() =>
                  updateDay(
                    current,
                    isFreeDay(day)
                      ? { title: "", activities: [], ai_generated: false }
                      : { title: FREE_DAY_TITLE, activities: [t("pg.freeDayHint")], ai_generated: false },
                  )
                }
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-bold transition-colors ${
                  isFreeDay(day)
                    ? "border-[#185045] bg-[#185045] text-white"
                    : "border-[#b7d0c7] bg-white text-[#185045] hover:bg-[#f0f7f4]"
                }`}
              >
                <Coffee className="size-3.5" />
                {t("pg.freeDay")}
              </button>

              {/* The old system's tours for THIS city, in their order — the
                  agency's own wording, one choice away. */}
              {dayPrograms.length > 0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    const program = dayPrograms.find((p) => p.id === e.target.value);
                    if (program) updateDay(current, programDayText(program));
                  }}
                  aria-label={t("pg.itin.pickTour", { city: day.city_name })}
                  className="h-9 min-w-0 max-w-full flex-1 rounded-full border border-[#b7d0c7] bg-white px-3 text-[11.5px] font-bold text-[#185045] sm:max-w-[380px]"
                >
                  <option value="">{t("pg.itin.pickTour", { city: day.city_name })}</option>
                  {dayPrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.title} — ${p.description.slice(0, 60)}${p.description.length > 60 ? "…" : ""}`}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

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
                onChange={(e) =>
                  updateDay(current, { activities: e.target.value.split("\n").map((line) => line.trimStart()) })
                }
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
                onClick={() => setOpen(current - 1)}
                disabled={current === 0}
                className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6] disabled:invisible"
              >
                <ChevronRight className="size-4 ltr:rotate-180 rtl:rotate-0" />
                {t("pg.itin.prevDay")}
              </button>
              {current < days.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setOpen(current + 1)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-[#0f4439]"
                >
                  {t("pg.itin.nextDay")}
                  <ChevronLeft className="size-4 ltr:rotate-180 rtl:rotate-0" />
                </button>
              ) : null}
            </div>
          </article>
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
