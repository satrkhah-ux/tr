"use client";

import { Camera, Car, RotateCcw } from "lucide-react";
import { FREE_DAY_TITLE, type DraftData, type DraftDay } from "@/lib/offer/draft-types";
import { dayTours, draftTransportNote, programDayText, tourService, withDayPick } from "@/lib/offer/itinerary";
import { advancedDayNote } from "@/lib/offer/advanced";
import type { BasicCity } from "@/lib/offer/basic";
import { SuggestInput } from "../SuggestInput";
import { chosenTour, tourChoices, type TourCatalog } from "../tours/TourRow";
import { basicField } from "./styles";
import { useBasicLabels } from "./labels";

/**
 * «البرنامج السياحي» of one city: its days as the client will read them — the
 * same days the document prints (data.days, written by daysFromTours) — for the
 * agent to check against the tours and the moves, and to reword. A day edited
 * here is the agent's: the screen no longer rewrites it (auto_title ""), until
 * «إعادة النص التلقائي» hands it back. The title box also opens the city's
 * tours — the same list as the tours tab (its programmes, the price list, «يوم
 * حر»): picking one puts that tour on the day (its title and text, priced from
 * the list like a tour picked on the tours tab), right here. A title typed is
 * just the day's title.
 */
export function BasicCityProgram({
  city,
  data,
  dayLabel,
  onSlice,
  onTours,
  catalog,
}: {
  /** this stop, with its dates chained. */
  city: BasicCity;
  data: DraftData;
  dayLabel: (iso: string) => string;
  onSlice: (slice: Partial<DraftData>) => void;
  /** open the tours tab. */
  onTours: () => void;
  /** the city's tours, as the tours tab offers them. */
  catalog: TourCatalog;
}) {
  const tx = useBasicLabels();
  if (!city.check_in) return <p className="text-[12px] font-semibold text-tv-text-faint">{tx("noCityDays")}</p>;
  // the city's days: from its check-in to the day it leaves (the evening of an overnight flight, or the day home)
  const own = data.days.flatMap((d, i) =>
    d.kind !== "travel" && d.city_name === city.city_name && d.date && d.date >= city.check_in! && d.date <= (city.check_out ?? d.date) ? [i] : [],
  );
  // auto_title "" — not undefined: Basic reads an unmarked day by its title, and «يوم حر» would be taken back
  const setDay = (i: number, slice: Partial<DraftDay>) =>
    onSlice({ days: data.days.map((d, k) => (k === i ? { ...d, ...slice, ai_generated: false, auto_title: "" } : d)) });
  const choices = tourChoices(catalog);
  // the arrival, a move or the day home keeps its own title; a tour joins its lines — never «يوم حر»
  const joining = choices.filter((c) => c.value !== FREE_DAY_TITLE);
  // with the tours switched off a day takes no tour, only a programme's words — every programme's, priced or not
  const words = data.transport_plan.tours.enabled
    ? []
    : [...new Set(catalog.programs.map((p) => programDayText(p).title))].map((value) => ({ value }));
  /** a title typed is the day's title; a tour picked from the list becomes the day's tour, in place of the one it had */
  const setTitle = (i: number, title: string, picked: boolean) => {
    if (!picked) return setDay(i, { title });
    const on = dayTours(data, i);
    if (!on) {
      const program = catalog.programs.find((p) => programDayText(p).title === title);
      return setDay(i, program ? programDayText(program) : { title });
    }
    const s = tourService(title, catalog.programs);
    // the day's own tour picked again changes nothing — its price, its car, the day's words stay
    const had = on.picks[0];
    if (had && Boolean(had.free) === Boolean(s.free) && had.title === s.title) return;
    // priced as on the tours tab: for the tours car, or the car the list prices it in
    const next = withDayPick(data, i, 0, chosenTour(catalog, title, { free: false, price: null }));
    if (next) onSlice(next);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11.5px] font-semibold text-[#557d78]">{tx("programHint")}</p>
      {own.map((i) => {
        const day = data.days[i];
        const mine = day.auto_title !== undefined && day.title !== day.auto_title;
        const note = data.scope.transport ? advancedDayNote(draftTransportNote(data, data.days, i), data.advanced) : null;
        const tours = dayTours(data, i)?.picks.filter((p) => !p.free && p.title.trim()) ?? [];
        return (
          <div key={day.date} className="grid gap-1.5 rounded-[9px] border border-[#DCE9E5] p-2 xl:grid-cols-[9.5rem_1fr]">
            <div className="flex flex-wrap items-center gap-1.5 xl:flex-col xl:items-start">
              <span className="rounded-full bg-[#185045] px-2 py-0.5 text-[10.5px] font-extrabold text-white">{`${day.day_number}`}</span>
              <span className="tv-tnum text-[11.5px] font-bold text-[#185045]">{dayLabel(day.date!)}</span>
              {mine ? (
                <button
                  type="button"
                  onClick={() => setDay(i, { title: "", activities: [] })}
                  className="inline-flex items-center gap-1 text-[10.5px] font-bold text-[#a86a10] hover:text-[#185045]"
                  title={tx("dayReset")}
                >
                  <RotateCcw className="size-3" />
                  {tx("dayOwn")}
                </button>
              ) : null}
            </div>
            <div className="min-w-0 space-y-1">
              <SuggestInput
                ariaLabel={tx("dayTitle")}
                items={dayTours(data, i) ? (day.date === city.check_in || i === data.days.length - 1 ? joining : choices) : words}
                value={day.title}
                placeholder={tx("dayTitleHint")}
                onChange={(title, picked) => setTitle(i, title, picked)}
                className={`${basicField} font-bold`}
              />
              {/* written whole on leaving the field: typing a new line must not lose it to the blank-line clean-up */}
              <textarea
                key={day.activities.join("\n")}
                aria-label={tx("dayText")}
                placeholder={tx("dayText")}
                defaultValue={day.activities.join("\n")}
                rows={Math.max(day.activities.length, 1)}
                onBlur={(e) => {
                  const activities = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
                  if (activities.join("\n") !== day.activities.join("\n")) setDay(i, { activities });
                }}
                className={`${basicField} h-auto min-h-9 resize-y py-1.5 leading-6`}
              />
              {note || tours.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  {note ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#eef4f1] px-2 py-0.5 text-[#557d78]">
                      <Car className="size-3" />
                      {note}
                    </span>
                  ) : null}
                  {tours.length > 0 ? (
                    <button
                      type="button"
                      onClick={onTours}
                      className="inline-flex items-center gap-1 rounded-full border border-[#cfe0d9] px-2 py-0.5 text-[#185045] hover:bg-[#f0f7f4]"
                    >
                      <Camera className="size-3" />
                      {tx("changeTour")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
