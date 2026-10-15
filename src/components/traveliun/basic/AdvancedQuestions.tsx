"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { deriveTransportRows, TRANSPORT_AIRPORT, type DraftCity, type TransportPlan } from "@/lib/offer/draft-types";
import {
  ARRIVE_BY_AR,
  POINT_AR,
  advancedGaps,
  advancedLines,
  emptyAdvanced,
  hopKey,
  setAdvancedDate,
  withAdvancedTransport,
  type AdvancedDateKey,
  type ArriveBy,
  type DraftAdvanced,
  type PointKind,
  type ServicePoint,
} from "@/lib/offer/advanced";
import { basicCard, basicField } from "./styles";

const chip = (on: boolean) =>
  `h-8 rounded-full px-3 text-[12px] font-bold transition-colors ${on ? "bg-[#185045] text-white" : "border border-[#dbe6e1] bg-white text-[#557d78] hover:bg-[#f4f8f6]"}`;
const small = `${basicField} h-8 text-[12px]`;
const qTitle = "text-[12px] font-extrabold text-[#185045]";

/** what the agent picks places from — the catalogue, never a blank box first. */
export type AdvancedPickLists = {
  /** the airports table — airports AND stations / ports, each with its country. */
  stops: { label: string; country: string; station: boolean }[];
  cities: { name: string; country: string }[];
  hotels: string[];
  countries: string[];
};

/** what to offer for «arrives / leaves at»: by flight the airports, by train or ferry the stations and ports, by road a city or a station — in the chosen country. */
function placesFor(lists: AdvancedPickLists, by: ArriveBy, country: string): string[] {
  const inCountry = <T extends { country: string }>(xs: T[]) => (country ? xs.filter((x) => x.country === country) : xs);
  const stops = inCountry(lists.stops);
  if (by === "flight") return stops.filter((s) => !s.station).map((s) => s.label);
  if (by === "rail_sea") return stops.filter((s) => s.station).map((s) => s.label);
  return [...new Set([...inCountry(lists.cities).map((c) => c.name), ...stops.filter((s) => s.station).map((s) => s.label)])];
}

/**
 * «بكج متقدم»: four short questions inside the basic file — nothing else changes.
 * Nothing is pre-chosen; dates come from Basic. «تطبيق» folds it to one line.
 */
export function AdvancedQuestions({
  value,
  cities,
  plan,
  transportOn,
  tripCountry,
  lists,
  onChange,
}: {
  value: DraftAdvanced | undefined;
  cities: DraftCity[];
  plan: TransportPlan;
  transportOn: boolean;
  tripCountry: string;
  lists: AdvancedPickLists;
  onChange: (next: DraftAdvanced) => void;
}) {
  const id = useId();
  const adv = value ?? { ...emptyAdvanced(), on: true };
  const set = (patch: Partial<DraftAdvanced>) => onChange({ ...adv, ...patch });
  const setDate = (k: AdvancedDateKey, v: string) => onChange(setAdvancedDate(adv, k, v));
  const gaps = advancedGaps(adv);
  const [editing, setEditing] = useState(gaps.length > 0);
  // the hops that change country — the only ones a border question belongs to
  const hops = cities
    .slice(1)
    .map((c, i) => ({ from: cities[i], to: c }))
    .filter(({ from, to }) => (from.country || tripCountry) !== (to.country || tripCountry));

  // what the answers do to the file, worked out exactly as the offer will be
  const lines = advancedLines(adv);
  const before = transportOn ? deriveTransportRows(plan, cities) : [];
  const rows = transportOn ? withAdvancedTransport(before, adv, TRANSPORT_AIRPORT) : [];
  const rowText = (r: { from_place: string; to_place: string; date: string | null; note: string }) =>
    `${r.from_place} ← ${r.to_place}${r.date ? ` — ${r.date}` : ""}${r.note ? ` (${r.note})` : ""}`;
  const changed = rows.filter((r) => !before.some((b) => rowText(b) === rowText(r)));

  const choices: Record<string, string[]> = {
    arrive: placesFor(lists, adv.arrive_by, adv.arrive_country),
    leave: placesFor(lists, adv.leave_by, adv.leave_country),
    hotels: lists.hotels,
    crossings: [],
  };
  const pick = (list: keyof typeof choices, value: string, put: (v: string) => void, placeholder: string) => (
    <input className={small} list={`${id}-${list}`} value={value} placeholder={placeholder} onChange={(e) => put(e.target.value)} />
  );
  const datalists = Object.entries(choices).map(([k, values]) => (
    <datalist key={k} id={`${id}-${k}`}>
      {values.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  ));
  const countryQ = (value: string, put: (v: string) => void, label: string) => (
    <select className={small} value={value} onChange={(e) => put(e.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {lists.countries.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
  const dateIn = (k: AdvancedDateKey, value: string, title: string) => (
    <label className="grid gap-0.5 text-[10.5px] font-bold text-[#557d78]">
      <span>
        {title}
        {adv.auto.includes(k) ? <span className="font-normal text-[#2aa87a]"> · من البيسك</span> : null}
      </span>
      <input type="date" className={small} value={value} onChange={(e) => setDate(k, e.target.value)} />
    </label>
  );
  const timeIn = (value: string, put: (v: string) => void, title: string) => (
    <label className="grid gap-0.5 text-[10.5px] font-bold text-[#557d78]">
      {title}
      <input type="time" className={small} value={value} onChange={(e) => put(e.target.value)} />
    </label>
  );

  const byQ = (value: ArriveBy, put: (v: ArriveBy) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(ARRIVE_BY_AR) as Exclude<ArriveBy, "">[]).map((k) => (
        <button key={k} type="button" className={chip(value === k)} onClick={() => put(k)}>
          {ARRIVE_BY_AR[k]}
        </button>
      ))}
    </div>
  );

  const pointQ = (label: string, p: ServicePoint, put: (p: ServicePoint) => void, selfWord: string, dateKey: AdvancedDateKey, timeWord: string) => (
    <div className="grid gap-1.5">
      <span className={qTitle}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(POINT_AR) as Exclude<PointKind, "">[]).map((k) => (
          <button key={k} type="button" className={chip(p.kind === k)} onClick={() => put({ ...p, kind: k })}>
            {k === "self" ? selfWord : POINT_AR[k]}
          </button>
        ))}
      </div>
      {p.kind && p.kind !== "self" ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {p.kind === "hotel" ? pick("hotels", p.place, (v) => put({ ...p, place: v }), "اختر الفندق") : null}
          {p.kind === "border" ? pick("crossings", p.place, (v) => put({ ...p, place: v }), "اسم المعبر") : null}
          {p.kind === "border" ? (
            <select className={small} value={p.side} onChange={(e) => put({ ...p, side: e.target.value })}>
              <option value="">أي جانب؟</option>
              {lists.countries.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : null}
          {dateIn(dateKey, p.date, "التاريخ")}
          {timeIn(p.time, (time) => put({ ...p, time }), timeWord)}
        </div>
      ) : null}
    </div>
  );

  const result = (
    <div className="grid gap-2 rounded-[12px] border border-[#cfe8dc] bg-[#f3fbf7] p-3 text-[12px] text-[#185045]">
      <b className="text-[12.5px]">هكذا سيظهر في العرض</b>
      {changed.length ? (
        <div>
          <span className="font-bold">التوصيلات بعد التعديل:</span>
          <ul className="list-disc ps-5">
            {changed.map((r) => (
              <li key={rowText(r)}>{rowText(r)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {lines.includes.length ? (
        <div>
          <span className="font-bold">يشمل:</span>
          <ul className="ps-1">
            {lines.includes.map((l) => (
              <li key={l}>✓ {l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {lines.excludes.length ? (
        <div>
          <span className="font-bold">لا يشمل:</span>
          <ul className="ps-1">
            {lines.excludes.map((l) => (
              <li key={l}>✗ {l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!changed.length && !lines.includes.length && !lines.excludes.length ? <span>لا تغيير على البيسك بعد — أجب عن الأسئلة أعلاه.</span> : null}
    </div>
  );

  if (!editing) {
    const summary = [...lines.includes, ...(lines.excludes.length ? [`${lines.excludes.length} بند غير مشمول`] : [])].join(" · ");
    return (
      <section className={`${basicCard} flex flex-wrap items-center gap-2 border-[#2aa87a]`}>
        <Check className="size-4 text-[#0f7a52]" />
        <b className="text-[13px] text-[#003c3a]">بكج متقدم مطبّق</b>
        <span className="text-[12px] text-[#557d78]">{summary || "بدون تغيير على البيسك"}</span>
        <button type="button" onClick={() => setEditing(true)} className="ms-auto inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045]">
          <Pencil className="size-3.5" /> تعديل
        </button>
      </section>
    );
  }

  const block = (children: ReactNode) => <div className="grid gap-2 rounded-[12px] border border-[#e6efeb] p-2.5">{children}</div>;

  return (
    <section className={`${basicCard} space-y-3 border-[#2aa87a]`}>
      {datalists}
      <h2 className="text-[14px] font-extrabold text-[#003c3a]">بكج متقدم</h2>

      {/* 1 */}
      <div className="grid gap-2 sm:grid-cols-2">
        {block(
          <>
            <span className={qTitle}>١. إلى أي دولة يصل العميل؟ وكيف؟</span>
            {countryQ(adv.arrive_country, (arrive_country) => set({ arrive_country, arrive_at: "" }), "دولة الوصول")}
            {byQ(adv.arrive_by, (arrive_by) => set({ arrive_by }))}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {adv.arrive_by && adv.arrive_by !== "already" ? <span className="col-span-2">{pick("arrive", adv.arrive_at, (arrive_at) => set({ arrive_at }), "إلى أين يصل؟")}</span> : null}
              {dateIn("arrive_date", adv.arrive_date, "تاريخ الوصول")}
              {timeIn(adv.arrive_time, (v) => onChange(setAdvancedDate(adv, "arrive_time", v)), "وقت الوصول")}
              {dateIn("checkin_date", adv.checkin_date, "الدخول لأول فندق")}
            </div>
          </>,
        )}
        {block(
          <>
            <span className={qTitle}>ومن أي دولة يغادر؟ وكيف؟</span>
            {countryQ(adv.leave_country, (leave_country) => set({ leave_country, leave_from: "" }), "دولة المغادرة")}
            {byQ(adv.leave_by, (leave_by) => set({ leave_by }))}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {adv.leave_by && adv.leave_by !== "already" ? <span className="col-span-2">{pick("leave", adv.leave_from, (leave_from) => set({ leave_from }), "من أين يغادر؟")}</span> : null}
              {dateIn("leave_date", adv.leave_date, "تاريخ المغادرة")}
              {timeIn(adv.leave_time, (v) => onChange(setAdvancedDate(adv, "leave_time", v)), "وقت المغادرة")}
            </div>
          </>,
        )}
      </div>

      {/* 2 */}
      <div className="grid gap-2 sm:grid-cols-2">
        {block(pointQ("٢. من أين نستقبله؟", adv.reception, (reception) => set({ reception }), "يصل بنفسه", "reception_date", "موعد اللقاء"))}
        {block(pointQ("وأين نودّعه؟", adv.farewell, (farewell) => set({ farewell }), "يغادر بنفسه", "farewell_date", "موعد الانطلاق"))}
      </div>

      {/* 3 */}
      {block(
        <>
          <span className={qTitle}>٣. ما يرتّبه العميل بنفسه (لا يدخل السعر)</span>
          {adv.self_items.map((item, i) => (
            <span key={i} className="flex gap-1.5">
              <input className={small} value={item} placeholder="مثل: ليلة في فندق بريزا" onChange={(e) => set({ self_items: adv.self_items.map((x, k) => (k === i ? e.target.value : x)) })} />
              <button type="button" aria-label="حذف" className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[#c22850] hover:bg-[#fdeef2]" onClick={() => set({ self_items: adv.self_items.filter((_, k) => k !== i) })}>
                <X className="size-4" />
              </button>
            </span>
          ))}
          <button type="button" className="inline-flex h-8 w-fit items-center gap-1 rounded-[8px] border border-dashed border-[#2aa87a] px-2.5 text-[11.5px] font-bold text-[#0f7a52]" onClick={() => set({ self_items: [...adv.self_items, ""] })}>
            <Plus className="size-3.5" /> إضافة
          </button>
        </>,
      )}

      {/* 4 */}
      {hops.length
        ? block(
            <>
              <span className={qTitle}>٤. الانتقال بين دولتين</span>
              {hops.map(({ from, to }) => {
                const key = hopKey(from.city_name, to.city_name);
                const hop = adv.borders[key] ?? { drivers: 1 as const, crossing: "", side_from: from.country || tripCountry, side_to: to.country || tripCountry };
                const put = (patch: Partial<typeof hop>) => set({ borders: { ...adv.borders, [key]: { ...hop, ...patch } } });
                return (
                  <div key={key} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] text-[#185045]">
                      {from.city_name} ← {to.city_name}
                    </span>
                    <button type="button" className={chip(!!adv.borders[key] && hop.drivers === 1)} onClick={() => put({ drivers: 1 })}>
                      سائق واحد
                    </button>
                    <button type="button" className={chip(!!adv.borders[key] && hop.drivers === 2)} onClick={() => put({ drivers: 2 })}>
                      سائقان وعبور ذاتي
                    </button>
                    {adv.borders[key] ? <span className="w-44">{pick("crossings", hop.crossing, (crossing) => put({ crossing }), "اسم المعبر")}</span> : null}
                  </div>
                );
              })}
            </>,
          )
        : null}

      {result}

      {gaps.length ? (
        <ul className="list-disc space-y-0.5 rounded-[10px] bg-[#fff8e8] p-2 ps-6 text-[11.5px] text-[#8a5a0c]">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setEditing(false)} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]">
          <Check className="size-4" /> تطبيق
        </button>
        <span className="text-[11px] text-[#557d78]">{gaps.length ? "يمكن التطبيق والنواقص تبقى ظاهرة للإكمال لاحقاً." : "كل شيء مكتمل."} الإجابات محفوظة في الملف.</span>
      </div>
    </section>
  );
}
