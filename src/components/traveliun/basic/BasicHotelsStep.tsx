"use client";

import { useState } from "react";
import { AlertTriangle, BedDouble, CheckCircle2, Pencil } from "lucide-react";
import { DirText } from "@/components/DirText";
import { cityHotelLines, deriveHotelStays, hotelCoverage, type DraftData, type DraftHotel, type GeneratorLookups } from "@/lib/offer/draft-types";
import { baseRoomName, type BasicCity } from "@/lib/offer/basic";
import { HotelPanel, stayDone } from "./BasicCityCard";
import { useBasicLabels } from "./labels";

/**
 * «١. الفنادق — كل المدن» (an agent's request through the owner, 2026-10-18:
 * «إدخال الفنادق أولاً ثم الجولات، لأن الفنادق فيها ترابط»). Every city's stays
 * in one place, on their chained dates, with what each city's nights still lack
 * or have twice — before the city cards, which then open on the tours. The same
 * editor as the card's hotel tab (HotelPanel), so nothing is entered twice.
 * Folds to a one-line-a-city table once every stay is complete.
 */
export function BasicHotelsStep({
  cities,
  firstDay,
  data,
  lookups,
  onLines,
  onSlice,
}: {
  cities: BasicCity[];
  /** the first city's first day number (after any travel day), as the cards count. */
  firstDay: number;
  data: DraftData;
  lookups: GeneratorLookups;
  onLines: (lines: DraftHotel[]) => void;
  onSlice: (slice: Partial<DraftData>) => void;
}) {
  const tx = useBasicLabels();
  const coverage = hotelCoverage(data.cities, data.hotels);
  const stays = deriveHotelStays(data.cities, data.hotels);
  const linesOf = (i: number) => cityHotelLines(data.cities, data.hotels, i);
  const complete = cities.every((_, i) => stayDone(linesOf(i))) && coverage.every((c) => c.covered - c.extra === c.needed && c.extra === 0);
  const [editing, setEditing] = useState(false);
  const open = editing || !complete;

  /** what a city's nights say: complete, short, or extra / overlapping */
  const nightsBadge = (i: number) => {
    const c = coverage[i];
    if (!c) return null;
    const short = c.needed - (c.covered - c.extra);
    if (c.extra > 0) return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#b42318]"><AlertTriangle className="size-3.5" />{tx("nightsExtra", { n: c.extra })}</span>;
    if (short > 0) return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#a86a10]"><AlertTriangle className="size-3.5" />{tx("nightsShort", { n: short })}</span>;
    return <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0f7a52]"><CheckCircle2 className="size-3.5" />{tx("nightsOk")}</span>;
  };

  // each city's first day, counted as the cards count them
  const starts = cities.map((_, i) => firstDay + cities.slice(0, i).reduce((n, c) => n + c.nights, 0));
  return (
    <section className="rounded-[14px] border border-[#d8e6e0] bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-[#e6eeea] bg-[#eef5f2] px-3 py-2">
        <BedDouble className="size-4 text-[#185045]" />
        <h3 className="text-[13.5px] font-extrabold text-[#0f3d38]">{tx("hotelsStep")}</h3>
        {complete ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[11px] font-bold text-[#0f7a52]">
            <CheckCircle2 className="size-3.5" />
            {tx("hotelsAllDone")}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-[#78948f]">{tx("hotelsStepHint")}</span>
        )}
        {complete ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="ms-auto inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#d3e2dc] bg-white px-2 text-[11px] font-bold text-[#185045] hover:border-[#165749]"
          >
            <Pencil className="size-3.5" />
            {tx("hotelsDoneEdit")}
          </button>
        ) : null}
      </header>

      {open ? (
        <ol className="divide-y divide-[#e6eeea]">
          {cities.map((city, i) => {
            return (
              <li key={`${i}-${city.city_name}`} className="px-3 py-2.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-[#185045] text-[11px] font-extrabold text-white">{i + 1}</span>
                  <span className="text-[13px] font-extrabold text-[#0f3d38]">{city.city_name}</span>
                  <span className="tv-tnum text-[11.5px] font-semibold text-[#557d78]">
                    <DirText>{city.check_in ?? "—"}</DirText> ← <DirText>{city.check_out ?? "—"}</DirText> · {city.nights}
                  </span>
                  <span className="ms-auto">{nightsBadge(i)}</span>
                </div>
                <HotelPanel index={i} city={city} dayFrom={starts[i]} data={data} lookups={lookups} lines={linesOf(i)} onLines={onLines} onSlice={onSlice} />
              </li>
            );
          })}
        </ol>
      ) : (
        // complete: one line a stay — what the tours and transfers below are built on
        <div className="overflow-x-auto px-3 py-2">
          <table className="w-full min-w-[640px] text-start text-[12px]">
            <thead className="text-[10.5px] font-extrabold text-[#78948f]">
              <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:text-start">
                <th>{tx("colCity")}</th>
                <th>{tx("colDates")}</th>
                <th>{tx("colHotel")}</th>
                <th>{tx("colRoom")}</th>
                <th>{tx("colPrice")}</th>
              </tr>
            </thead>
            <tbody>
              {stays.map((s) => {
                const total = s.line.rooms.reduce((sum, r) => sum + (r.price ?? 0), 0);
                return (
                  <tr key={s.line.id} className="border-t border-[#eef3f1] font-semibold text-[#185045] [&>td]:px-2 [&>td]:py-1.5">
                    <td>{s.city_name}</td>
                    <td className="tv-tnum"><DirText>{`${s.check_in ?? "—"} ← ${s.check_out ?? "—"} · ${s.nights}`}</DirText></td>
                    <td>{s.line.hotel_name || "—"}</td>
                    <td>{s.line.rooms.map((r) => baseRoomName(r.room_type_name)).filter(Boolean).join(" + ") || "—"}</td>
                    <td className="tv-tnum"><DirText>{`${total.toLocaleString("en-US")} ${s.line.manual_currency}`}</DirText></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
