"use client";

import { Plus, X } from "lucide-react";
import type { DraftCity } from "@/lib/offer/draft-types";
import {
  ARRIVE_BY_AR,
  POINT_AR,
  advancedGaps,
  emptyAdvanced,
  hopKey,
  type ArriveBy,
  type DraftAdvanced,
  type PointKind,
  type ServicePoint,
} from "@/lib/offer/advanced";
import { basicCard, basicField, basicLabel } from "./styles";

const chip = (on: boolean) =>
  `h-8 rounded-full px-3 text-[12px] font-bold transition-colors ${on ? "bg-[#185045] text-white" : "border border-[#dbe6e1] bg-white text-[#557d78] hover:bg-[#f4f8f6]"}`;

/**
 * «بكج متقدم»: four short questions inside the basic file — nothing else changes.
 * Each answer only rewords the transfers and the «يشمل / لا يشمل» lines.
 */
export function AdvancedQuestions({
  value,
  cities,
  tripCountry,
  countries,
  onChange,
}: {
  value: DraftAdvanced | undefined;
  cities: DraftCity[];
  tripCountry: string;
  countries: string[];
  onChange: (next: DraftAdvanced) => void;
}) {
  const adv = value ?? { ...emptyAdvanced(), on: true };
  const set = (patch: Partial<DraftAdvanced>) => onChange({ ...adv, ...patch });
  const gaps = advancedGaps(adv);
  // the hops that change country — the only ones a border question belongs to
  const hops = cities
    .slice(1)
    .map((c, i) => ({ from: cities[i], to: c }))
    .filter(({ from, to }) => (from.country || tripCountry) !== (to.country || tripCountry));

  const pointQ = (label: string, p: ServicePoint, put: (p: ServicePoint) => void, selfWord: string) => (
    <div className="grid gap-1.5">
      <span className="text-[12px] font-extrabold text-[#185045]">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(POINT_AR) as PointKind[]).map((k) => (
          <button key={k} type="button" className={chip(p.kind === k)} onClick={() => put({ ...p, kind: k })}>
            {k === "self" ? selfWord : POINT_AR[k]}
          </button>
        ))}
      </div>
      {p.kind === "hotel" || p.kind === "border" ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <input className={basicField} value={p.place} placeholder={p.kind === "hotel" ? "اسم الفندق" : "اسم المعبر"} onChange={(e) => put({ ...p, place: e.target.value })} />
          {p.kind === "border" ? (
            <select className={basicField} value={p.side} onChange={(e) => put({ ...p, side: e.target.value })}>
              <option value="">أي جانب؟</option>
              {countries.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : null}
          <input type="time" className={basicField} value={p.time} title="موعد اللقاء" onChange={(e) => put({ ...p, time: e.target.value })} />
        </div>
      ) : null}
    </div>
  );

  const byQ = (value: ArriveBy, put: (v: ArriveBy) => void) => (
    <select className={basicField} value={value} onChange={(e) => put(e.target.value as ArriveBy)}>
      {(Object.keys(ARRIVE_BY_AR) as ArriveBy[]).map((k) => (
        <option key={k} value={k}>
          {ARRIVE_BY_AR[k]}
        </option>
      ))}
    </select>
  );

  return (
    <section className={`${basicCard} space-y-3 border-[#2aa87a]`}>
      <h2 className="text-[14px] font-extrabold text-[#003c3a]">بكج متقدم</h2>

      {/* 1 */}
      <div className="grid gap-1.5 sm:grid-cols-2">
        <label className={basicLabel}>
          ١. كيف يصل العميل؟ وإلى أين؟
          <span className="grid grid-cols-[8rem_1fr] gap-1.5">
            {byQ(adv.arrive_by, (v) => set({ arrive_by: v }))}
            {adv.arrive_by !== "already" ? <input className={basicField} value={adv.arrive_at} placeholder="مثل: مطار طرابزون" onChange={(e) => set({ arrive_at: e.target.value })} /> : null}
          </span>
        </label>
        <label className={basicLabel}>
          وكيف يغادر؟ ومن أين؟
          <span className="grid grid-cols-[8rem_1fr] gap-1.5">
            {byQ(adv.leave_by, (v) => set({ leave_by: v }))}
            {adv.leave_by !== "already" ? <input className={basicField} value={adv.leave_from} placeholder="مثل: مطار تبليسي" onChange={(e) => set({ leave_from: e.target.value })} /> : null}
          </span>
        </label>
      </div>

      {/* 2 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {pointQ("٢. من أين نستقبله؟", adv.reception, (reception) => set({ reception }), "يصل بنفسه")}
        {pointQ("وأين نودّعه؟", adv.farewell, (farewell) => set({ farewell }), "يغادر بنفسه")}
      </div>

      {/* 3 */}
      <div className="grid gap-1.5">
        <span className="text-[12px] font-extrabold text-[#185045]">٣. ما يرتّبه العميل بنفسه (لا يدخل السعر)</span>
        {adv.self_items.map((item, i) => (
          <span key={i} className="flex gap-1.5">
            <input className={basicField} value={item} placeholder="مثل: ليلة في فندق بريزا" onChange={(e) => set({ self_items: adv.self_items.map((x, k) => (k === i ? e.target.value : x)) })} />
            <button type="button" aria-label="حذف" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] text-[#c22850] hover:bg-[#fdeef2]" onClick={() => set({ self_items: adv.self_items.filter((_, k) => k !== i) })}>
              <X className="size-4" />
            </button>
          </span>
        ))}
        <button type="button" className="inline-flex h-8 w-fit items-center gap-1 rounded-[8px] border border-dashed border-[#2aa87a] px-2.5 text-[11.5px] font-bold text-[#0f7a52]" onClick={() => set({ self_items: [...adv.self_items, ""] })}>
          <Plus className="size-3.5" /> إضافة
        </button>
      </div>

      {/* 4 */}
      {hops.length ? (
        <div className="grid gap-1.5">
          <span className="text-[12px] font-extrabold text-[#185045]">٤. الانتقال بين دولتين</span>
          {hops.map(({ from, to }) => {
            const key = hopKey(from.city_name, to.city_name);
            const hop = adv.borders[key] ?? { drivers: 1 as const, crossing: "", side_from: from.country || tripCountry, side_to: to.country || tripCountry };
            const put = (patch: Partial<typeof hop>) => set({ borders: { ...adv.borders, [key]: { ...hop, ...patch } } });
            return (
              <div key={key} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-[#185045]">
                  {from.city_name} ← {to.city_name}
                </span>
                <button type="button" className={chip(hop.drivers === 1)} onClick={() => put({ drivers: 1 })}>
                  سائق واحد
                </button>
                <button type="button" className={chip(hop.drivers === 2)} onClick={() => put({ drivers: 2 })}>
                  سائقان وعبور ذاتي
                </button>
                <input className={`${basicField} w-44`} value={hop.crossing} placeholder="اسم المعبر" onChange={(e) => put({ crossing: e.target.value })} />
              </div>
            );
          })}
        </div>
      ) : null}

      {gaps.length ? (
        <ul className="list-disc space-y-0.5 rounded-[10px] bg-[#fff8e8] p-2 ps-6 text-[11.5px] text-[#8a5a0c]">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
