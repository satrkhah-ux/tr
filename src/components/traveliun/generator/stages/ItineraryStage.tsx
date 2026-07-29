"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CloudSun, Coffee, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { FREE_DAY_TITLE, isFreeDay, type DraftDay } from "@/lib/offer/draft-types";
import { daysNeedRebuild, draftDaySkeleton } from "@/lib/offer/itinerary";
import { formatWeatherAr, isWeatherEmpty, weatherSourceAr } from "@/lib/offer/weather-format";
import { itineraryStartDate } from "@/lib/offer/schedule";
import {
  generateItineraryDays,
  getAssistantAvailability,
  refreshItineraryWeather,
} from "@/lib/data/itinerary-actions";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass, sectionClass, type StageFormProps } from "../stage-props";

/**
 * Stage 9 — the day-by-day program.
 *
 * Days are DERIVED (number, date, city) and only the text is authored, so the
 * program can never disagree with the trip. Two assistants sit on top:
 *   • «توليد بالذكاء الاصطناعي» drafts the text — flagged, never auto-published,
 *     and by default it only fills days the agent has not written.
 *   • «تحديث الطقس» attaches a REAL reading per day, labelled forecast vs
 *     climate average so an average is never shown as a forecast.
 */
export function ItineraryStage({ draftId, data, patch, replace }: StageFormProps) {
  const { t, language } = useTraveliunUI();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"ai" | "weather" | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [available, setAvailable] = useState<{ ai: boolean; flightLookup: boolean } | null>(null);
  const days = data.days;

  useEffect(() => {
    void getAssistantAvailability().then(setAvailable);
  }, []);

  // Keep the skeleton in step with the trip/cities. Runs only when something
  // actually moved, so it never fights the agent's typing.
  const tripKey = `${itineraryStartDate(data.trip, data.flights)}|${data.trip.nights}|${data.trip.days}|${data.cities
    .map((c) => `${c.city_name}:${c.nights}`)
    .join(",")}`;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current === tripKey) return;
    lastKey.current = tripKey;
    const trip = { ...data.trip, arrival_date: itineraryStartDate(data.trip, data.flights) };
    if (daysNeedRebuild(trip, data.cities, days, data.trip.destination || data.trip.country)) {
      patch({ days: draftDaySkeleton(data) });
    }
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

      {days.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("pg.itin.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {days.map((day, index) => (
            <article key={day.day_number} className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
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
              </header>

              {/*
                A free day is a real part of a programme, not a gap in it. Left
                blank the day reads as unfinished work — to the agent reviewing
                the draft and to the client reading the document. One press
                writes it as a deliberate choice, and pressing again gives the
                day back rather than trapping it.
              */}
              <button
                type="button"
                onClick={() =>
                  updateDay(
                    index,
                    isFreeDay(day)
                      ? { title: "", activities: [], ai_generated: false }
                      : { title: FREE_DAY_TITLE, activities: [t("pg.freeDayHint")], ai_generated: false },
                  )
                }
                className={`mb-2 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-bold transition-colors ${
                  isFreeDay(day)
                    ? "border-[#185045] bg-[#185045] text-white"
                    : "border-[#b7d0c7] bg-white text-[#185045] hover:bg-[#f0f7f4]"
                }`}
              >
                <Coffee className="size-3.5" />
                {t("pg.freeDay")}
              </button>

              <label className="mb-2 grid gap-1.5 text-[12px] font-bold text-[#185045]">
                {t("pg.itin.dayTitle")}
                <input
                  value={day.title}
                  onChange={(e) => updateDay(index, { title: e.target.value })}
                  placeholder={t("pg.itin.dayTitlePlaceholder")}
                  className={fieldClass}
                />
              </label>

              <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
                {t("pg.itin.activities")}
                <textarea
                  value={day.activities.join("\n")}
                  onChange={(e) =>
                    updateDay(index, { activities: e.target.value.split("\n").map((line) => line.trimStart()) })
                  }
                  onBlur={(e) =>
                    updateDay(index, {
                      activities: e.target.value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={3}
                  placeholder={t("pg.itin.activitiesPlaceholder")}
                  className="w-full rounded-[10px] border border-[#dbe6e1] bg-white p-3 text-sm leading-6 text-[#185045] outline-none transition-colors focus:border-[#2aa87a]"
                />
              </label>
            </article>
          ))}
        </div>
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
