"use client";

import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CircleAlert, Pencil, Plus, X } from "lucide-react";
import { deriveTransportRows, TRANSPORT_AIRPORT, type DraftCity, type TransportPlan } from "@/lib/offer/draft-types";
import {
  ARRIVE_BY_AR,
  POINT_AR,
  advancedLines,
  advancedSteps,
  emptyAdvanced,
  pointCountry,
  hopKey,
  setAdvancedDate,
  withAdvancedTransport,
  type AdvancedDateKey,
  type AdvancedStep,
  type ArriveBy,
  type DraftAdvanced,
  type PointKind,
  type ServicePoint,
  type StepKey,
} from "@/lib/offer/advanced";
import { basicCard, basicField } from "./styles";

const chip = (on: boolean) =>
  `h-8 rounded-full px-3 text-[12px] font-bold transition-colors ${on ? "bg-[#185045] text-white" : "border border-[#dbe6e1] bg-white text-[#557d78] hover:bg-[#f4f8f6]"}`;
const small = `${basicField} h-8 text-[12px]`;

/** what the agent picks from — the catalogue, never a blank box first. */
export type AdvancedPickLists = {
  /** the airports table — airports AND stations / ports, each with its country. */
  stops: { label: string; country: string; station: boolean }[];
  cities: { name: string; country: string }[];
  /** hotels by country — the catalogue's, for the countries whose hotels are loaded. */
  hotels: Record<string, string[]>;
  countries: string[];
  /** country → IANA zone, so every clock is read where it happens. */
  zones: Record<string, string>;
};

/** «arrives / leaves at»: by flight the airports, by train or ferry the stations and ports, by road a city or a station — in the chosen country. */
function placesFor(lists: AdvancedPickLists, by: ArriveBy, country: string): string[] {
  const inCountry = <T extends { country: string }>(xs: T[]) => (country ? xs.filter((x) => x.country === country) : xs);
  const stops = inCountry(lists.stops);
  if (by === "flight") return stops.filter((s) => !s.station).map((s) => s.label);
  if (by === "rail_sea") return stops.filter((s) => s.station).map((s) => s.label);
  return [...new Set([...inCountry(lists.cities).map((c) => c.name), ...stops.filter((s) => s.station).map((s) => s.label)])];
}

const STEP_NO: Record<StepKey, string> = { arrive: "١", reception: "٢", checkin: "٣", farewell: "٤", leave: "٥" };

/**
 * «بكج متقدم»: the trip told in its own order — arrive, met, first night, left,
 * leave — one sentence per step, with what contradicts or is missing right under
 * it. Nothing pre-chosen; dates come from Basic. «تطبيق» folds it to one line.
 */
export function AdvancedQuestions({
  value,
  cities,
  plan,
  transportOn,
  tripCountry,
  lists,
  firstStay = "",
  notes = [],
  onChange,
}: {
  value: DraftAdvanced | undefined;
  cities: DraftCity[];
  plan: TransportPlan;
  transportOn: boolean;
  tripCountry: string;
  lists: AdvancedPickLists;
  /** «فندق X — مدينة، دولة»: the first hotel Basic books, said in step ③. */
  firstStay?: string;
  /** what the rest of the file says against these answers (a ticket that lands elsewhere). */
  notes?: string[];
  onChange: (next: DraftAdvanced) => void;
}) {
  const id = useId();
  const adv = value ?? { ...emptyAdvanced(), on: true };
  const set = (patch: Partial<DraftAdvanced>) => onChange({ ...adv, ...patch });
  const setDate = (k: AdvancedDateKey, v: string) => onChange(setAdvancedDate(adv, k, v));
  const tzOf = (country: string) => lists.zones[country] ?? null;
  // the first night's country — where a pickup in another country has to cross to
  const firstCountry = cities[0]?.country || tripCountry;
  const steps = advancedSteps(adv, tzOf, firstCountry, firstStay);
  const stepOf = (k: StepKey) => steps.find((s) => s.key === k);
  const hopGaps = Object.values(adv.borders).filter((h) => !h.crossing.trim()).length;
  const errors = steps.reduce((n, s) => n + s.errors.length, 0);
  const noPart = !adv.parts.arrival && !adv.parts.departure;
  const missing = steps.reduce((n, s) => n + s.missing.length, 0) + hopGaps + (noPart ? 1 : 0);
  const [editing, setEditing] = useState(errors + missing > 0);
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
    rxAirports: lists.stops.filter((x) => !x.station && (!adv.reception.country || x.country === adv.reception.country)).map((x) => x.label),
    fwAirports: lists.stops.filter((x) => !x.station && (!adv.farewell.country || x.country === adv.farewell.country)).map((x) => x.label),
    rxHotels: adv.reception.country ? lists.hotels[adv.reception.country] ?? [] : Object.values(lists.hotels).flat(),
    fwHotels: adv.farewell.country ? lists.hotels[adv.farewell.country] ?? [] : Object.values(lists.hotels).flat(),
    crossings: [],
  };
  const pick = (list: keyof typeof choices, value: string, put: (v: string) => void, placeholder: string) => (
    <input className={small} list={`${id}-${list}`} value={value} placeholder={placeholder} onChange={(e) => put(e.target.value)} />
  );
  const country = (value: string, put: (v: string) => void, label: string) => (
    <select className={small} value={value} onChange={(e) => put(e.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {lists.countries.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
  const field = (label: string, input: ReactNode, note?: ReactNode) => (
    <label className="grid gap-0.5 text-[10.5px] font-bold text-[#557d78]">
      <span>
        {label}
        {note}
      </span>
      {input}
    </label>
  );
  const fromBasic = (k: AdvancedDateKey) => (adv.auto.includes(k) ? <span className="font-normal text-[#2aa87a]"> · من البيسك</span> : null);
  const dateIn = (k: AdvancedDateKey, value: string, label: string) =>
    field(label, <input type="date" className={small} value={value} onChange={(e) => setDate(k, e.target.value)} />, fromBasic(k));
  /** a clock, read in the zone of the place it happens in. */
  const timeIn = (value: string, put: (v: string) => void, label: string, zoneCountry: string) =>
    field(label, <input type="time" className={small} value={value} onChange={(e) => put(e.target.value)} />, zoneCountry ? <span className="font-normal"> · بتوقيت {zoneCountry}</span> : null);
  const byQ = (value: ArriveBy, put: (v: ArriveBy) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(ARRIVE_BY_AR) as Exclude<ArriveBy, "">[]).map((k) => (
        <button key={k} type="button" className={chip(value === k)} onClick={() => put(k)}>
          {ARRIVE_BY_AR[k]}
        </button>
      ))}
    </div>
  );
  /** the country first, then what kind of place — a border's side is that country. */
  const pointChips = (p: ServicePoint, put: (p: ServicePoint) => void, selfWord: string, countryLabel: string) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {p.kind !== "self" ? (
        <span className="w-44">{country(p.country, (c) => put({ ...p, country: c, place: "", side: p.kind === "border" ? c : p.side }), countryLabel)}</span>
      ) : null}
      {(Object.keys(POINT_AR) as Exclude<PointKind, "">[]).map((k) => (
        <button key={k} type="button" className={chip(p.kind === k)} onClick={() => put({ ...p, kind: k, place: k === p.kind ? p.place : "", side: k === "border" ? p.country : "" })}>
          {k === "self" ? selfWord : POINT_AR[k]}
        </button>
      ))}
    </div>
  );
  const pointPlace = (p: ServicePoint, put: (p: ServicePoint) => void, which: "rx" | "fw") =>
    p.kind === "airport" ? (
      pick(`${which}Airports`, p.place, (v) => put({ ...p, place: v }), "المطار (اختياري — وإلا مطار الرحلة)")
    ) : p.kind === "hotel" ? (
      pick(`${which}Hotels`, p.place, (v) => put({ ...p, place: v }), "اختر الفندق")
    ) : p.kind === "border" ? (
      pick("crossings", p.place, (v) => put({ ...p, place: v }), p.country ? `اسم المعبر — جانب ${p.country}` : "اسم المعبر")
    ) : null;

  /** one step of the trip: its number, its sentence, its state, then its fields and what is wrong with them. */
  const stepCard = (s: AdvancedStep | undefined, body: ReactNode) => {
    if (!s) return null;
    const state = s.errors.length ? "error" : s.missing.length ? "missing" : "ok";
    return (
      <li key={s.key} className={`grid gap-2 rounded-[12px] border p-2.5 ${state === "error" ? "border-[#f2b8c6] bg-[#fffafb]" : state === "missing" ? "border-[#f4d9a6]" : "border-[#cfe8dc]"}`}>
        <div className="flex items-start gap-2">
          <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold text-white ${state === "error" ? "bg-[#c22850]" : state === "missing" ? "bg-[#d89a2b]" : "bg-[#0f7a52]"}`}>
            {state === "ok" ? <Check className="size-3.5" /> : STEP_NO[s.key]}
          </span>
          <div className="grid gap-0.5">
            <b className="text-[12.5px] text-[#003c3a]">{s.title}</b>
            <span className="text-[12.5px] text-[#185045]">{s.sentence}</span>
          </div>
        </div>
        {body}
        {s.errors.map((e) => (
          <p key={e} className="flex items-start gap-1 text-[11.5px] font-bold text-[#c22850]">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {e}
          </p>
        ))}
        {s.missing.map((m) => (
          <p key={m} className="flex items-start gap-1 text-[11.5px] text-[#8a5a0c]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {m}
          </p>
        ))}
      </li>
    );
  };
  const grid = (children: ReactNode) => <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{children}</div>;

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
      {!changed.length && !lines.includes.length && !lines.excludes.length ? <span>لا تغيير على البيسك بعد — أجب عن الخطوات أعلاه.</span> : null}
    </div>
  );

  if (!editing) {
    const summary = [...lines.includes, ...(lines.excludes.length ? [`${lines.excludes.length} بند غير مشمول`] : [])].join(" · ");
    return (
      <section className={`${basicCard} flex flex-wrap items-center gap-2 border-[#2aa87a]`}>
        <Check className="size-4 text-[#0f7a52]" />
        <b className="text-[13px] text-[#003c3a]">بكج متقدم مطبّق</b>
        <span className="text-[12px] text-[#557d78]">{summary || "بدون تغيير على البيسك"}</span>
        {errors + missing ? (
          <span className="text-[11.5px] font-bold text-[#a86a10]">
            {errors ? `${errors} تعارض · ` : ""}
            {missing ? `${missing} ناقص` : ""}
          </span>
        ) : null}
        <button type="button" onClick={() => setEditing(true)} className="ms-auto inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045]">
          <Pencil className="size-3.5" /> تعديل
        </button>
      </section>
    );
  }

  const rx = adv.reception;
  const fw = adv.farewell;
  const rxCountry = pointCountry(rx, adv.arrive_country);
  const fwCountry = pointCountry(fw, adv.leave_country);

  return (
    <section className={`${basicCard} space-y-3 border-[#2aa87a]`}>
      {Object.entries(choices).map(([k, values]) => (
        <datalist key={k} id={`${id}-${k}`}>
          {values.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}
      <div className="grid gap-0.5">
        <h2 className="text-[14px] font-extrabold text-[#003c3a]">بكج متقدم</h2>
        <span className="text-[11.5px] text-[#557d78]">الرحلة بترتيبها الفعلي. كل وقت يُكتب بتوقيت مكانه كما في التذكرة، والنظام يقارن الأوقات بعد احتساب فرق التوقيت.</span>
      </div>

      {notes.map((n) => (
        <p key={n} className="flex items-start gap-1 rounded-[10px] border border-[#f2b8c6] bg-[#fdeef2] p-2 text-[12px] font-bold text-[#c22850]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {n}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-[#e6efeb] p-2.5">
        <span className="text-[12.5px] font-extrabold text-[#185045]">ما المختلف في هذه الرحلة؟</span>
        {(
          [
            ["arrival", "الوصول والاستقبال"],
            ["departure", "المغادرة والتوديع"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={chip(adv.parts[k])} onClick={() => set({ parts: { ...adv.parts, [k]: !adv.parts[k] } })}>
            {adv.parts[k] ? "✓ " : ""}
            {label}
          </button>
        ))}
        <span className="text-[11px] text-[#557d78]">
          {noPart ? "اختر واحداً أو الاثنين — الجهة غير المختارة تبقى كما في البيسك (المطار)." : !adv.parts.arrival ? "الوصول كما في البيسك: استقبال من المطار." : !adv.parts.departure ? "المغادرة كما في البيسك: توديع إلى المطار." : ""}
        </span>
      </div>

      <ol className="grid gap-2">
        {stepCard(
          stepOf("arrive"),
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-44">{country(adv.arrive_country, (arrive_country) => set({ arrive_country, arrive_at: "" }), "دولة الوصول")}</span>
              {byQ(adv.arrive_by, (arrive_by) => set({ arrive_by }))}
            </div>
            {adv.arrive_by && adv.arrive_by !== "already"
              ? grid(
                  <>
                    <span className="col-span-2">{field("مكان الوصول", pick("arrive", adv.arrive_at, (arrive_at) => set({ arrive_at }), "اختر من القائمة"))}</span>
                    {dateIn("arrive_date", adv.arrive_date, "تاريخ الوصول")}
                    {timeIn(adv.arrive_time, (v) => setDate("arrive_time", v), "وقت الوصول", adv.arrive_country)}
                  </>,
                )
              : null}
          </>,
        )}

        {stepCard(
          stepOf("reception"),
          <>
            {pointChips(rx, (reception) => set({ reception }), "يصل بنفسه", "دولة الاستقبال")}
            {rx.kind && rx.kind !== "self"
              ? grid(
                  <>
                    {pointPlace(rx, (reception) => set({ reception }), "rx")}
                    {dateIn("reception_date", rx.date, "يوم الاستقبال")}
                    {timeIn(rx.time, (time) => set({ reception: { ...rx, time } }), "موعد لقاء السائق", rxCountry)}
                  </>,
                )
              : null}
            {rx.kind && rx.kind !== "self" && rx.kind !== "border" && rxCountry && firstCountry && rxCountry !== firstCountry ? (
              <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] bg-[#f6f9f8] p-2">
                <span className="text-[12px] font-bold text-[#185045]">
                  من {rxCountry} إلى أول فندق في {firstCountry} — كيف يعبر الحدود؟
                </span>
                {([1, 2] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={chip(adv.reception_cross?.drivers === d)}
                    onClick={() => set({ reception_cross: { crossing: adv.reception_cross?.crossing ?? "", side_from: rxCountry, side_to: firstCountry, drivers: d } })}
                  >
                    {d === 1 ? "سائق واحد يعبر" : "سائقان وعبور ذاتي بينهما"}
                  </button>
                ))}
                {adv.reception_cross ? (
                  <span className="w-48">{pick("crossings", adv.reception_cross.crossing, (crossing) => set({ reception_cross: { ...adv.reception_cross!, crossing } }), "اسم المعبر")}</span>
                ) : null}
              </div>
            ) : null}
          </>,
        )}

        {stepCard(stepOf("checkin"), grid(dateIn("checkin_date", adv.checkin_date, "الدخول لأول فندق")))}

        {stepCard(
          stepOf("farewell"),
          <>
            {pointChips(fw, (farewell) => set({ farewell }), "يغادر بنفسه", "دولة التوديع")}
            {fw.kind && fw.kind !== "self"
              ? grid(
                  <>
                    {pointPlace(fw, (farewell) => set({ farewell }), "fw")}
                    {dateIn("farewell_date", fw.date, "يوم التوديع")}
                    {timeIn(fw.time, (time) => set({ farewell: { ...fw, time } }), "موعد الانطلاق", fwCountry)}
                  </>,
                )
              : null}
          </>,
        )}

        {stepCard(
          stepOf("leave"),
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-44">{country(adv.leave_country, (leave_country) => set({ leave_country, leave_from: "" }), "دولة المغادرة")}</span>
              {byQ(adv.leave_by, (leave_by) => set({ leave_by }))}
            </div>
            {adv.leave_by && adv.leave_by !== "already"
              ? grid(
                  <>
                    <span className="col-span-2">{field("مكان المغادرة", pick("leave", adv.leave_from, (leave_from) => set({ leave_from }), "اختر من القائمة"))}</span>
                    {dateIn("leave_date", adv.leave_date, "تاريخ المغادرة")}
                    {timeIn(adv.leave_time, (v) => setDate("leave_time", v), "وقت الإقلاع", adv.leave_country)}
                  </>,
                )
              : null}
          </>,
        )}
      </ol>

      <div className="grid gap-1.5 rounded-[12px] border border-[#e6efeb] p-2.5">
        <span className="text-[12px] font-extrabold text-[#185045]">ما يرتّبه العميل بنفسه (لا يدخل السعر)</span>
        {adv.self_items.map((item, i) => (
          <span key={i} className="flex gap-1.5">
            <input className={small} value={item} placeholder="مثل: ليلة في فندق بريزا، الانتقال إلى الحدود" onChange={(e) => set({ self_items: adv.self_items.map((x, k) => (k === i ? e.target.value : x)) })} />
            <button type="button" aria-label="حذف" className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[#c22850] hover:bg-[#fdeef2]" onClick={() => set({ self_items: adv.self_items.filter((_, k) => k !== i) })}>
              <X className="size-4" />
            </button>
          </span>
        ))}
        <button type="button" className="inline-flex h-8 w-fit items-center gap-1 rounded-[8px] border border-dashed border-[#2aa87a] px-2.5 text-[11.5px] font-bold text-[#0f7a52]" onClick={() => set({ self_items: [...adv.self_items, ""] })}>
          <Plus className="size-3.5" /> إضافة
        </button>
      </div>

      {hops.length ? (
        <div className="grid gap-1.5 rounded-[12px] border border-[#e6efeb] p-2.5">
          <span className="text-[12px] font-extrabold text-[#185045]">الانتقال بين دولتين</span>
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
        </div>
      ) : null}

      {result}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setEditing(false)} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]">
          <Check className="size-4" /> تطبيق
        </button>
        <span className={`text-[11.5px] ${errors ? "font-bold text-[#c22850]" : "text-[#557d78]"}`}>
          {errors ? `${errors} تعارض — راجع الخطوات المعلّمة بالأحمر. ` : missing ? `${missing} معلومة ناقصة — يمكن إكمالها لاحقاً. ` : "الرحلة مكتملة ومتسقة. "}
          الإجابات محفوظة في الملف.
        </span>
      </div>
    </section>
  );
}
