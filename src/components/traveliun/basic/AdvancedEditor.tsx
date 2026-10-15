"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, CircleHelp, Loader2, Plus, Route, Trash2, XCircle } from "lucide-react";
import type { DraftData, GeneratorLookups } from "@/lib/offer/draft-types";
import {
  MODE_AR,
  MOVING,
  PARTY_AR,
  PLACE_KIND_AR,
  SERVICE_AR,
  STATUS_AR,
  TAG_AR,
  addAirportReception,
  addBorderTransferOneDriver,
  addBorderTransferTwoDrivers,
  addGroupArrivalReceptions,
  addPlaceReception,
  addSelfArrival,
  blockingFor,
  checkJourney,
  clientLines,
  diffJourney,
  emptyJourney,
  journeyCost,
  journeyFromDraft,
  newId,
  newPlace,
  newSegment,
  newService,
  newStay,
  opsLines,
  placeLabel,
  reviewAffected,
  roomNights,
  spans,
  stayNights,
  timeline,
  type AdvancedJourney,
  type ItemStatus,
  type MoveMode,
  type Party,
  type Place,
  type PlaceKind,
  type Segment,
  type Service,
  type ServiceKind,
  type Stay,
  type Tag,
  type TravellerKind,
} from "@/lib/offer/advanced";
import { TraveliunShell } from "../TraveliunShell";
import { useDraftState } from "../generator/useDraftState";
import { basicCard, basicField, basicLabel, typedNumber } from "./styles";

/**
 * «البكج المتقدم» — the basic file's inner section for composite trips.
 *
 * Same draft, one more slice (`journey`). Seven folds in the order the company
 * asked for; each list is rows of small fields, like the basic screen. Every
 * shortcut only adds rows to these same lists.
 */

const STEPS = [
  ["people", "١. المسافرون والمجموعات"],
  ["dest", "٢. الوجهات والمواقع"],
  ["path", "٣. مسار السفر المعروف"],
  ["window", "٤. بداية خدمات الشركة ونهايتها"],
  ["moves", "٥. الاستقبال والانتقالات"],
  ["stays", "٦. الإقامات والجولات"],
  ["review", "٧. الأسعار والمراجعة"],
] as const;
type StepKey = (typeof STEPS)[number][0];

const TAG_STYLE: Record<Tag, string> = {
  included: "bg-[#e9f7f0] text-[#0f7a52]",
  optional: "bg-[#eef3ff] text-[#2f5bd3]",
  self: "bg-[#f4f4f2] text-[#5b6660]",
  third_party: "bg-[#f6efff] text-[#7a3fc2]",
  missing: "bg-[#fff8e8] text-[#a86a10]",
  review: "bg-[#fdeef2] text-[#c22850]",
};
const SEV_STYLE = { error: "border-[#f2b8c6] bg-[#fdeef2] text-[#c22850]", warning: "border-[#f4d9a6] bg-[#fff8e8] text-[#8a5a0c]", missing: "border-[#dbe6e1] bg-[#f6f9f8] text-[#557d78]" };
const SEV_AR = { error: "خطأ يمنع الاعتماد", warning: "تنبيه يحتاج مراجعة", missing: "معلومة ناقصة (مسموحة في المسودة)" };

const small = `${basicField} h-8 text-[12px]`;
const PARTIES = Object.keys(PARTY_AR) as Party[];
const STATUSES = Object.keys(STATUS_AR) as ItemStatus[];

export function AdvancedEditor({ draftId, initialData, savedAt, lookups }: { draftId: string; initialData: DraftData; savedAt: string; lookups: GeneratorLookups }) {
  const { data, patch, flush, saveState } = useDraftState(draftId, initialData, savedAt);
  const [open, setOpen] = useState<StepKey>("people");
  const [notice, setNotice] = useState<string | null>(null);
  const j = data.journey;
  const issues = useMemo(() => (j ? checkJourney(j) : []), [j]);

  /** every edit: the same «يحتاج مراجعة» rule the server applies, so the screen never disagrees with it. */
  function set(next: AdvancedJourney) {
    setNotice(null);
    patch({ journey: reviewAffected(j, next).journey });
  }
  const edit = <K extends "places" | "segments" | "services" | "stays">(key: K, id: string, change: Partial<AdvancedJourney[K][number]>) =>
    j && set({ ...j, [key]: (j[key] as { id: string }[]).map((x) => (x.id === id ? { ...x, ...change } : x)) });
  const drop = (key: "places" | "segments" | "services" | "stays", id: string) => j && set({ ...j, [key]: (j[key] as { id: string }[]).filter((x) => x.id !== id) });

  /** approving an item is refused while it carries a blocking error. */
  function setStatus(key: "segments" | "services" | "stays", id: string, status: ItemStatus) {
    if (status === "confirmed" && j) {
      const block = blockingFor(checkJourney(j), id);
      if (block.length) {
        setNotice(`لا يمكن الاعتماد: ${block.map((b) => b.message).join(" — ")}`);
        return;
      }
    }
    edit(key, id, { status } as never);
  }

  const shell = (body: ReactNode) => (
    <TraveliunShell title="nav.basic">
      <div className="tv-fade-up space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/basic/${draftId}`} onClick={() => void flush()} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12px] font-bold text-[#557d78] hover:bg-[#f4f8f6]">
            <ArrowRight className="size-4 ltr:rotate-180" />
            العودة إلى الملف
          </Link>
          <h1 className="inline-flex items-center gap-1.5 text-[15px] font-extrabold text-[#003c3a]">
            <Route className="size-4" /> البكج المتقدم
          </h1>
          <span className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold ${saveState === "error" ? "bg-[#fdeef2] text-[#c22850]" : saveState === "saving" ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#e9f7f0] text-[#0f7a52]"}`}>
            {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : saveState === "error" ? <XCircle className="size-3.5" /> : <Check className="size-3.5" />}
            {saveState === "saving" ? "جارٍ الحفظ" : saveState === "error" ? "تعذّر الحفظ" : "محفوظ"}
          </span>
          {j ? (
            <label className="ms-auto inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
              <input type="checkbox" checked={j.enabled} onChange={(e) => set({ ...j, enabled: e.target.checked })} />
              مفعّل في العرض (يحل محل توصيلات بيسك)
            </label>
          ) : null}
        </div>
        {notice ? <p className="rounded-[10px] border border-[#f2b8c6] bg-[#fdeef2] p-2 text-[12px] font-bold text-[#c22850]">{notice}</p> : null}
        {body}
      </div>
    </TraveliunShell>
  );

  if (!j) {
    return shell(
      <div className={`${basicCard} space-y-3`}>
        <p className="text-[13px] leading-6 text-[#185045]">
          للرحلات المركبة: وصول إلى دولة والبكج في أخرى، استقبال من حدود أو فندق، عدة رحلات وصول ومغادرة، مجموعات تتفرق وتجتمع. يُحفظ في نفس الملف، ولا يغيّر شيئاً حتى تفعّله.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="h-9 rounded-[9px] bg-[#185045] px-3 text-[12.5px] font-bold text-white" onClick={() => set(journeyFromDraft(data, lookups))}>
            ابدأ من بيانات الملف الحالية
          </button>
          <button type="button" className="h-9 rounded-[9px] border border-[#d8e3de] px-3 text-[12.5px] font-bold text-[#185045]" onClick={() => set({ ...emptyJourney(), enabled: true, main_country: data.trip.country })}>
            ابدأ فارغاً
          </button>
        </div>
        <p className="text-[11.5px] text-[#557d78]">عند البدء من الملف: الرحلات تُنقل كمعلومة سفر، والفنادق كإقامات مسعّرة من بيسك. لا يُفترض أن المطار نقطة استقبال؛ أي استقبال مباع يُنقل بحالة «يحتاج مراجعة».</p>
      </div>,
    );
  }

  const placeSelect = (value: string | null, onChange: (id: string | null) => void, kinds?: PlaceKind[]) => (
    <select className={small} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— اختر موقعاً —</option>
      {j.places.filter((p) => !kinds || kinds.includes(p.kind)).map((p) => (
        <option key={p.id} value={p.id}>
          {PLACE_KIND_AR[p.kind]}: {placeLabel(p)}
        </option>
      ))}
    </select>
  );

  /** who this row is for: everyone (empty) or picked travellers; a group chip picks its people. */
  const paxPicker = (pax: string[], onChange: (pax: string[]) => void) => (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => onChange([])} className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${pax.length ? "bg-[#f4f4f2] text-[#5b6660]" : "bg-[#185045] text-white"}`}>
        الجميع
      </button>
      {j.groups.length > 1
        ? j.groups.map((g) => {
            const ids = j.travellers.filter((t) => t.group === g.id).map((t) => t.id);
            return (
              <button key={g.id} type="button" onClick={() => onChange(ids)} className="rounded-full border border-[#dbe6e1] px-2 py-0.5 text-[10.5px] font-bold text-[#185045]">
                {g.name}
              </button>
            );
          })
        : null}
      {j.travellers.map((t) => {
        const on = pax.includes(t.id);
        return (
          <button key={t.id} type="button" onClick={() => onChange(on ? pax.filter((x) => x !== t.id) : [...pax, t.id])} className={`rounded-full px-2 py-0.5 text-[10.5px] ${on ? "bg-[#2aa87a] text-white" : "bg-[#f6f9f8] text-[#557d78]"}`}>
            {t.name || "مسافر"}
          </button>
        );
      })}
    </div>
  );

  const statusSelect = (key: "segments" | "services" | "stays", row: { id: string; status: ItemStatus }) => (
    <select className={small} value={row.status} onChange={(e) => setStatus(key, row.id, e.target.value as ItemStatus)}>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_AR[s]}
        </option>
      ))}
    </select>
  );
  const partySelect = (value: Party, onChange: (p: Party) => void) => (
    <select className={small} value={value} onChange={(e) => onChange(e.target.value as Party)}>
      {PARTIES.map((p) => (
        <option key={p} value={p}>
          {PARTY_AR[p]}
        </option>
      ))}
    </select>
  );
  const rowIssues = (id: string) => {
    const mine = issues.filter((i) => i.refs.includes(id));
    return mine.length ? (
      <ul className="col-span-full space-y-0.5">
        {mine.map((i, k) => (
          <li key={k} className={`rounded-[6px] border px-2 py-0.5 text-[11px] ${SEV_STYLE[i.severity]}`}>
            {i.message}
          </li>
        ))}
      </ul>
    ) : null;
  };
  const removeBtn = (onClick: () => void) => (
    <button type="button" aria-label="حذف" onClick={onClick} className="inline-flex size-8 items-center justify-center rounded-[8px] text-[#c22850] hover:bg-[#fdeef2]">
      <Trash2 className="size-4" />
    </button>
  );
  const addBtn = (label: string, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-dashed border-[#2aa87a] px-2.5 text-[11.5px] font-bold text-[#0f7a52] hover:bg-[#e9f7f0]">
      <Plus className="size-3.5" /> {label}
    </button>
  );

  // ---------- 1. people ----------
  const people = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {j.groups.map((g) => (
          <span key={g.id} className="inline-flex items-center gap-1">
            <input className={`${small} w-32`} value={g.name} onChange={(e) => set({ ...j, groups: j.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })} />
            {j.groups.length > 1 ? removeBtn(() => set({ ...j, groups: j.groups.filter((x) => x.id !== g.id), travellers: j.travellers.map((t) => (t.group === g.id ? { ...t, group: j.groups[0].id } : t)) })) : null}
          </span>
        ))}
        {addBtn("مجموعة", () => set({ ...j, groups: [...j.groups, { id: newId("gr"), name: `مجموعة ${j.groups.length + 1}` }] }))}
      </div>
      {j.travellers.map((t) => (
        <div key={t.id} className="grid grid-cols-[1fr_7rem_9rem_auto] items-center gap-1.5">
          <input className={small} value={t.name} placeholder="الاسم" onChange={(e) => set({ ...j, travellers: j.travellers.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)) })} />
          <select className={small} value={t.kind} onChange={(e) => set({ ...j, travellers: j.travellers.map((x) => (x.id === t.id ? { ...x, kind: e.target.value as TravellerKind } : x)) })}>
            <option value="adult">بالغ</option>
            <option value="child">طفل</option>
            <option value="infant">رضيع</option>
          </select>
          <select className={small} value={t.group} onChange={(e) => set({ ...j, travellers: j.travellers.map((x) => (x.id === t.id ? { ...x, group: e.target.value } : x)) })}>
            {j.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {removeBtn(() => set({ ...j, travellers: j.travellers.filter((x) => x.id !== t.id) }))}
        </div>
      ))}
      {addBtn("مسافر", () => {
        const groups = j.groups.length ? j.groups : [{ id: newId("gr"), name: "المجموعة" }];
        set({ ...j, groups, travellers: [...j.travellers, { id: newId("tr"), name: "", kind: "adult", group: groups[0].id }] });
      })}
    </div>
  );

  // ---------- 2. destinations + places ----------
  const addAirport = (code: string) => {
    const a = lookups.airports.find((x) => (x.code ?? "").toUpperCase() === code.trim().toUpperCase());
    if (!a) return setNotice(`لا يوجد مطار بالرمز ${code}`);
    set({ ...j, places: [...j.places, newPlace({ kind: "airport", name: `${a.name}${a.code ? ` (${a.code})` : ""}`, city: a.city ?? "", country: a.country ?? "", tz: a.timezone })] });
  };
  const countryTz = (name: string) => lookups.countries.find((c) => c.name === name)?.timezone ?? null;
  const dest = (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={basicLabel}>
          الدولة الرئيسية للبكج
          <select className={basicField} value={j.main_country} onChange={(e) => set({ ...j, main_country: e.target.value })}>
            <option value="">—</option>
            {lookups.countries.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className={basicLabel}>
          وجهات إضافية
          <select className={basicField} value="" onChange={(e) => e.target.value && set({ ...j, extra_countries: [...new Set([...j.extra_countries, e.target.value])] })}>
            <option value="">+ أضف دولة</option>
            {lookups.countries.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="flex flex-wrap gap-1">
            {j.extra_countries.map((c) => (
              <button key={c} type="button" onClick={() => set({ ...j, extra_countries: j.extra_countries.filter((x) => x !== c) })} className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[11px] text-[#0f7a52]">
                {c} ×
              </button>
            ))}
          </span>
        </label>
      </div>
      <p className="text-[11.5px] text-[#557d78]">المواقع: كل نقطة يمر بها العميل أو نخدمه منها. المعبر الحدودي يُسجَّل لكل جانب على حدة.</p>
      {j.places.map((p) => (
        <div key={p.id} className="grid grid-cols-2 gap-1.5 rounded-[10px] border border-[#e6efeb] p-2 sm:grid-cols-[8rem_1fr_8rem_8rem_auto]">
          <select className={small} value={p.kind} onChange={(e) => edit("places", p.id, { kind: e.target.value as PlaceKind })}>
            {(Object.keys(PLACE_KIND_AR) as PlaceKind[]).map((k) => (
              <option key={k} value={k}>
                {PLACE_KIND_AR[k]}
              </option>
            ))}
          </select>
          <input className={small} value={p.name} placeholder="الاسم" onChange={(e) => edit("places", p.id, { name: e.target.value })} />
          <select className={small} value={p.country} onChange={(e) => edit("places", p.id, { country: e.target.value, tz: p.tz ?? countryTz(e.target.value) })}>
            <option value="">الدولة</option>
            {lookups.countries.map((c) => (
              <option key={c.id}>{c.name}</option>
            ))}
          </select>
          <input className={small} value={p.city} placeholder="المدينة/المنطقة (اختياري)" onChange={(e) => edit("places", p.id, { city: e.target.value })} />
          {removeBtn(() => drop("places", p.id))}
          {p.kind === "border" ? (
            <select className={small} value={p.side} onChange={(e) => edit("places", p.id, { side: e.target.value })}>
              <option value="">أي جانب؟</option>
              {lookups.countries.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
          ) : p.kind === "airport" ? (
            <input className={small} value={p.terminal} placeholder="الصالة" onChange={(e) => edit("places", p.id, { terminal: e.target.value })} />
          ) : (
            <input className={small} value={p.address} placeholder="العنوان" onChange={(e) => edit("places", p.id, { address: e.target.value })} />
          )}
          <input className={`${small} sm:col-span-2`} value={p.meeting} placeholder="تعليمات اللقاء" onChange={(e) => edit("places", p.id, { meeting: e.target.value })} />
          <input className={small} value={p.tz ?? ""} placeholder="المنطقة الزمنية" title="مثل Asia/Tbilisi" onChange={(e) => edit("places", p.id, { tz: e.target.value || null })} />
          <input
            className={small}
            placeholder="الإحداثيات lat,lng"
            defaultValue={p.lat != null ? `${p.lat},${p.lng}` : ""}
            onBlur={(e) => {
              const [lat, lng] = e.target.value.split(",").map((x) => Number(x.trim()));
              edit("places", p.id, Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: null, lng: null });
            }}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <AirportAdd onAdd={addAirport} />
        {(["hotel", "border", "train", "bus", "port", "address", "landmark", "tbd"] as PlaceKind[]).map((k) =>
          addBtn(PLACE_KIND_AR[k], () => set({ ...j, places: [...j.places, newPlace({ kind: k, name: "", country: j.main_country, tz: countryTz(j.main_country) })] })),
        )}
      </div>
    </div>
  );

  // ---------- 3. known travel path ----------
  const segRow = (s: Segment) => (
    <div key={s.id} className="grid grid-cols-2 gap-1.5 rounded-[10px] border border-[#e6efeb] p-2 sm:grid-cols-[7rem_1fr_1fr_10rem_10rem_auto]">
      <select className={small} value={s.mode} onChange={(e) => edit("segments", s.id, { mode: e.target.value as MoveMode })}>
        {(Object.keys(MODE_AR) as MoveMode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_AR[m]}
          </option>
        ))}
      </select>
      {placeSelect(s.from, (id) => edit("segments", s.id, { from: id ?? "" }))}
      {placeSelect(s.to, (id) => edit("segments", s.id, { to: id ?? "" }))}
      <input type="datetime-local" className={small} value={s.dep ?? ""} title="الانطلاق (توقيت نقطة الانطلاق)" onChange={(e) => edit("segments", s.id, { dep: e.target.value || null })} />
      <input type="datetime-local" className={small} value={s.arr ?? ""} title="الوصول (توقيت نقطة الوصول)" onChange={(e) => edit("segments", s.id, { arr: e.target.value || null })} />
      {removeBtn(() => drop("segments", s.id))}
      <input className={small} value={s.ref} placeholder={s.mode === "flight" ? "رقم الرحلة" : "رقم/مرجع"} onChange={(e) => edit("segments", s.id, { ref: e.target.value })} />
      <input className={small} value={s.ticket} placeholder="رقم التذكرة/الحجز" onChange={(e) => edit("segments", s.id, { ticket: e.target.value })} />
      <label className="flex items-center gap-1 text-[11px] text-[#557d78]">
        يرتبه {partySelect(s.arranged_by, (p) => edit("segments", s.id, { arranged_by: p }))}
      </label>
      <input className={small} value={s.operated_by} placeholder="الناقل/المنفذ" onChange={(e) => edit("segments", s.id, { operated_by: e.target.value })} />
      {statusSelect("segments", s)}
      <select className={small} value={s.service_id ?? ""} title="الخدمة المرتبطة" onChange={(e) => edit("segments", s.id, { service_id: e.target.value || null })}>
        <option value="">معلومة فقط</option>
        {j.services.map((v) => (
          <option key={v.id} value={v.id}>
            ضمن: {v.title || SERVICE_AR[v.kind]}
          </option>
        ))}
      </select>
      <label className="col-span-2 flex items-center gap-1 text-[11px] text-[#557d78]">
        <input type="checkbox" checked={s.details_unknown} onChange={(e) => edit("segments", s.id, { details_unknown: e.target.checked })} />
        ترتيب ذاتي، التفاصيل غير معروفة
      </label>
      <input type="number" className={small} value={s.estimate_minutes ?? ""} placeholder="مدة تقديرية (د)" onChange={(e) => edit("segments", s.id, { estimate_minutes: typedNumber(e.currentTarget) })} />
      <input className={small} value={s.estimate_source} placeholder="مصدر التقدير" onChange={(e) => edit("segments", s.id, { estimate_source: e.target.value })} />
      <input className={`${small} col-span-2`} value={s.notes} placeholder="ملاحظات تشغيلية" onChange={(e) => edit("segments", s.id, { notes: e.target.value })} />
      <div className="col-span-full">{paxPicker(s.pax, (pax) => edit("segments", s.id, { pax }))}</div>
      {rowIssues(s.id)}
    </div>
  );
  const path = (
    <div className="space-y-2">
      <p className="text-[11.5px] text-[#557d78]">كل تحرك معروف للعميل — حجزناه أو حجزه بنفسه. وجوده هنا لا يعني أنه مشمول بالسعر.</p>
      {j.segments.map(segRow)}
      <div className="flex flex-wrap gap-1.5">
        {(["flight", "self", "border", "train", "ferry", "car", "bus"] as MoveMode[]).map((m) =>
          addBtn(MODE_AR[m], () => {
            const last = j.segments.at(-1);
            set({ ...j, segments: [...j.segments, newSegment({ mode: m, from: last?.to ?? "", to: "" })] });
          }),
        )}
      </div>
    </div>
  );

  // ---------- 4. service window ----------
  const groupSpans = (j.groups.length ? j.groups : [{ id: "", name: "الجميع" }]).map((g) => ({
    g,
    s: spans(j, g.id ? j.travellers.filter((t) => t.group === g.id).map((t) => t.id) : undefined),
  }));
  const route = clientLines(j);
  const windowCard = (
    <div className="space-y-2 text-[12.5px] text-[#185045]">
      {groupSpans.map(({ g, s }) => (
        <div key={g.id || "all"} className="grid gap-1 rounded-[10px] border border-[#e6efeb] p-2 sm:grid-cols-2">
          <b className="sm:col-span-2">{g.name}</b>
          <span>سفر العميل الكامل: {s.travel.from ?? "؟"} ← {s.travel.to ?? "؟"}</span>
          <span>فترة خدماتنا: {s.services.from ?? "؟"} ← {s.services.to ?? "؟"}</span>
          <span>الليالي المشمولة: {s.includedNights} (ليالي الغرف للتكلفة: {s.roomNights})</span>
          <span>إقامات خارجية غير مشمولة: {s.externalNights} ليلة</span>
        </div>
      ))}
      <ul className="list-disc space-y-0.5 ps-5">
        {route.includes.filter((l) => l.includes("تبدأ خدماتنا") || l.includes("تنتهي خدماتنا")).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="text-[11.5px] text-[#557d78]">البداية والنهاية تُستخرجان من أول وآخر خدمة مشمولة — عدّل الخدمات في الخطوتين ٥ و٦.</p>
    </div>
  );

  // ---------- 5 + 6. services and stays ----------
  const svcRow = (s: Service) => (
    <div key={s.id} className="grid grid-cols-2 gap-1.5 rounded-[10px] border border-[#e6efeb] p-2 sm:grid-cols-[7rem_1fr_1fr_10rem_auto]">
      <select className={small} value={s.kind} onChange={(e) => edit("services", s.id, { kind: e.target.value as ServiceKind })}>
        {(Object.keys(SERVICE_AR) as ServiceKind[]).map((k) => (
          <option key={k} value={k}>
            {SERVICE_AR[k]}
          </option>
        ))}
      </select>
      {s.use_arrival_airport ? (
        <span className="flex h-8 items-center rounded-[8px] bg-[#f6f9f8] px-2 text-[11.5px] text-[#557d78]">من: مطار وصول الرحلة المرتبطة</span>
      ) : (
        placeSelect(s.from, (id) => edit("services", s.id, { from: id }))
      )}
      {placeSelect(s.to, (id) => edit("services", s.id, { to: id }))}
      <input type="datetime-local" className={small} value={s.at ?? ""} title="موعد لقاء السائق — ليس وقت الهبوط" onChange={(e) => edit("services", s.id, { at: e.target.value || null })} />
      {removeBtn(() => drop("services", s.id))}
      <input className={small} value={s.title} placeholder="الوصف" onChange={(e) => edit("services", s.id, { title: e.target.value })} />
      <select className={small} value={s.depends_on ?? ""} title="يعتمد على" onChange={(e) => edit("services", s.id, { depends_on: e.target.value || null, use_arrival_airport: e.target.value ? s.use_arrival_airport : false })}>
        <option value="">لا يعتمد على رحلة</option>
        {j.segments.map((g) => (
          <option key={g.id} value={g.id}>
            يعتمد على: {MODE_AR[g.mode]} {g.ref} {g.arr ? `(وصول ${g.arr.slice(5, 16).replace("T", " ")})` : ""}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-[11px] text-[#557d78]">
        <input type="checkbox" disabled={!s.depends_on} checked={s.use_arrival_airport} onChange={(e) => edit("services", s.id, { use_arrival_airport: e.target.checked })} />
        استخدام مطار وصول الرحلة كنقطة استقبال
      </label>
      <input className={small} value={s.operated_by} placeholder="المنفذ / المورد" onChange={(e) => edit("services", s.id, { operated_by: e.target.value })} />
      {statusSelect("services", s)}
      <label className="flex items-center gap-1 text-[11px] text-[#557d78]">حجزها {partySelect(s.booked_by, (p) => edit("services", s.id, { booked_by: p }))}</label>
      <label className="flex items-center gap-1 text-[11px] text-[#557d78]">يدفع {partySelect(s.paid_by, (p) => edit("services", s.id, { paid_by: p }))}</label>
      <span className="flex items-center gap-2 text-[11px] text-[#557d78]">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.included} onChange={(e) => edit("services", s.id, { included: e.target.checked })} /> ضمن السعر
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={s.optional} onChange={(e) => edit("services", s.id, { optional: e.target.checked })} /> اختيارية
        </label>
      </span>
      <span className="flex gap-1">
        <input type="number" className={small} value={s.price ?? ""} placeholder="السعر (مرة واحدة)" onChange={(e) => edit("services", s.id, { price: typedNumber(e.currentTarget) })} />
        <select className={`${small} w-20`} value={s.currency} onChange={(e) => edit("services", s.id, { currency: e.target.value })}>
          {["SAR", "USD", "EUR", "TRY", "GEL", "MYR", "IDR", "AED"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </span>
      <input className={small} value={s.commitment} placeholder="حدود التزامنا" onChange={(e) => edit("services", s.id, { commitment: e.target.value })} />
      <input className={small} value={s.notes} placeholder="ملاحظات تشغيلية" onChange={(e) => edit("services", s.id, { notes: e.target.value })} />
      {MOVING.has(s.kind) ? (
        <div className="col-span-full space-y-1">
          {s.stops.map((stop, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1 rounded-[8px] bg-[#f6f9f8] p-1">
              <span className="text-[11px] font-bold text-[#557d78]">توقف {i + 1}</span>
              <span className="w-56">{placeSelect(stop.place, (id) => edit("services", s.id, { stops: s.stops.map((x, k) => (k === i ? { ...x, place: id ?? "" } : x)) }))}</span>
              <span className="text-[11px] text-[#557d78]">ركوب:</span>
              {paxPicker(stop.pick, (pick) => edit("services", s.id, { stops: s.stops.map((x, k) => (k === i ? { ...x, pick } : x)) }))}
              <span className="text-[11px] text-[#557d78]">نزول:</span>
              {paxPicker(stop.drop, (d) => edit("services", s.id, { stops: s.stops.map((x, k) => (k === i ? { ...x, drop: d } : x)) }))}
              {removeBtn(() => edit("services", s.id, { stops: s.stops.filter((_, k) => k !== i) }))}
            </div>
          ))}
          {addBtn("نقطة توقف", () => edit("services", s.id, { stops: [...s.stops, { place: "", pick: [], drop: [] }] }))}
        </div>
      ) : null}
      <div className="col-span-full">{paxPicker(s.pax, (pax) => edit("services", s.id, { pax }))}</div>
      {rowIssues(s.id)}
    </div>
  );

  // shortcuts: they add rows to these same lists, nothing more
  const firstStay = j.stays.find((s) => s.status !== "cancelled")?.place ?? null;
  const tbd = (kind: PlaceKind, extra: Partial<Place> = {}) => newPlace({ kind, name: "", country: j.main_country, tz: countryTz(j.main_country), ...extra });
  const arrivals = j.segments.filter((s) => s.mode === "flight");
  const shortcuts: [string, () => void][] = [
    ["استقبال من مطار", () => (arrivals.at(-1) ? set(addAirportReception(j, arrivals.at(-1)!.id, firstStay)) : setNotice("سجّل رحلة الوصول أولاً في «مسار السفر المعروف»"))],
    ["استقبال من فندق", () => { const p = tbd("hotel"); set(addPlaceReception({ ...j, places: [...j.places, p] }, p.id, firstStay)); }],
    ["استقبال من الحدود", () => { const p = tbd("border", { side: j.main_country }); set(addPlaceReception({ ...j, places: [...j.places, p] }, p.id, firstStay)); }],
    ["العميل يصل بنفسه", () => { const from = j.segments.at(-1)?.to; const to = firstStay; if (!from || !to) return setNotice("حدد آخر نقطة يصلها العميل وأول إقامة أولاً"); set(addSelfArrival(j, from, to)); }],
    ["نقل عبر الحدود بسائق واحد", () => { const b = tbd("border"); const to = tbd("tbd"); set(addBorderTransferOneDriver({ ...j, places: [...j.places, b, to] }, j.segments.at(-1)?.to ?? firstStay ?? "", b.id, to.id)); }],
    ["نقل عبر الحدود بسائقين", () => { const a = tbd("border"); const b = tbd("border", { side: j.main_country }); const to = tbd("tbd"); set(addBorderTransferTwoDrivers({ ...j, places: [...j.places, a, b, to] }, j.segments.at(-1)?.to ?? firstStay ?? "", a.id, b.id, to.id)); }],
    ["مجموعة متعددة رحلات الوصول", () => set(addGroupArrivalReceptions(j, firstStay))],
    ["مسار مخصص", () => set({ ...j, services: [...j.services, newService({ kind: "transfer" })] })],
  ];
  const moves = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {shortcuts.map(([label, run]) => (
          <button key={label} type="button" onClick={run} className="h-8 rounded-[8px] bg-[#e9f7f0] px-2.5 text-[11.5px] font-bold text-[#0f7a52] hover:bg-[#d6f0e3]">
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-[#557d78]">الاختصارات تضيف سجلات عادية تعدّلها كما تشاء. وقت الهبوط يُقرأ من الرحلة، وموعد لقاء السائق يُكتب هنا مستقلاً.</p>
      {j.services.filter((s) => MOVING.has(s.kind)).map(svcRow)}
    </div>
  );

  const stayRow = (s: Stay) => (
    <div key={s.id} className="grid grid-cols-2 gap-1.5 rounded-[10px] border border-[#e6efeb] p-2 sm:grid-cols-[1fr_9rem_9rem_5rem_auto]">
      {placeSelect(s.place, (id) => edit("stays", s.id, { place: id ?? "" }), ["hotel", "address", "tbd", "landmark"])}
      <input type="date" className={small} value={s.check_in ?? ""} title="الدخول" onChange={(e) => edit("stays", s.id, { check_in: e.target.value || null })} />
      <input type="date" className={small} value={s.check_out ?? ""} title="الخروج" onChange={(e) => edit("stays", s.id, { check_out: e.target.value || null })} />
      <input type="number" min={1} className={small} value={s.rooms} title="الغرف" onChange={(e) => edit("stays", s.id, { rooms: Math.max(typedNumber(e.currentTarget) ?? 1, 1) })} />
      {removeBtn(() => drop("stays", s.id))}
      <span className="flex items-center gap-1 text-[11px] text-[#557d78]">
        دخول <input type="time" className={`${small} w-24`} value={s.check_in_time} onChange={(e) => edit("stays", s.id, { check_in_time: e.target.value })} />
      </span>
      <span className="flex items-center gap-1 text-[11px] text-[#557d78]">
        خروج <input type="time" className={`${small} w-24`} value={s.check_out_time} onChange={(e) => edit("stays", s.id, { check_out_time: e.target.value })} />
      </span>
      <span className="text-[11.5px] font-bold text-[#185045]">
        {stayNights(s) ?? "؟"} ليلة · {roomNights(s) ?? "؟"} ليلة-غرفة
      </span>
      {statusSelect("stays", s)}
      <label className="flex items-center gap-1 text-[11px] text-[#557d78]">حجزها {partySelect(s.booked_by, (p) => edit("stays", s.id, { booked_by: p, included: p === "company" ? s.included : false, paid_by: p === "company" ? s.paid_by : p }))}</label>
      <label className="flex items-center gap-1 text-[11px] text-[#557d78]">
        <input type="checkbox" checked={s.included} onChange={(e) => edit("stays", s.id, { included: e.target.checked })} /> مشمولة بالسعر
      </label>
      {s.hotel_ref ? (
        <span className="text-[11px] text-[#557d78]">تُسعَّر من فندق بيسك المرتبط</span>
      ) : (
        <span className="flex gap-1">
          <input type="number" className={small} value={s.price ?? ""} placeholder="سعر الإقامة كاملة" onChange={(e) => edit("stays", s.id, { price: typedNumber(e.currentTarget) })} />
          <select className={`${small} w-20`} value={s.currency} onChange={(e) => edit("stays", s.id, { currency: e.target.value })}>
            {["SAR", "USD", "EUR", "TRY", "GEL", "MYR", "IDR", "AED"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </span>
      )}
      <input className={small} value={s.ref} placeholder="رقم الحجز" onChange={(e) => edit("stays", s.id, { ref: e.target.value })} />
      <div className="col-span-full">{paxPicker(s.pax, (pax) => edit("stays", s.id, { pax }))}</div>
      {rowIssues(s.id)}
    </div>
  );
  const stays = (
    <div className="space-y-2">
      <p className="text-[11.5px] text-[#557d78]">الليالي تُحسب من دخول وخروج كل إقامة. العودة لنفس الفندق لاحقاً = إقامة جديدة. لا تُضاف ليلة تلقائياً لرحلة ليلية أو بحرية.</p>
      {j.stays.map(stayRow)}
      <div className="flex flex-wrap gap-1.5">
        {addBtn("إقامة", () => set({ ...j, stays: [...j.stays, newStay({ place: firstStay ?? "", check_in: j.stays.at(-1)?.check_out ?? null })] }))}
        {addBtn("جولة", () => set({ ...j, services: [...j.services, newService({ kind: "tour" })] }))}
        {addBtn("تذاكر", () => set({ ...j, services: [...j.services, newService({ kind: "ticket" })] }))}
      </div>
      {j.services.filter((s) => !MOVING.has(s.kind)).map(svcRow)}
    </div>
  );

  // ---------- 7. review ----------
  const before = initialData.journey ? journeyCost(initialData.journey) : {};
  const now = journeyCost(j);
  const sessionChanges = diffJourney(initialData.journey, j, "هذه الجلسة", "");
  const ops = opsLines(j);
  const review = (
    <div className="space-y-3 text-[12.5px] text-[#185045]">
      {(["error", "warning", "missing"] as const).map((sev) => {
        const list = issues.filter((i) => i.severity === sev);
        return list.length ? (
          <div key={sev} className={`rounded-[10px] border p-2 ${SEV_STYLE[sev]}`}>
            <b className="inline-flex items-center gap-1">
              {sev === "missing" ? <CircleHelp className="size-4" /> : <AlertTriangle className="size-4" />} {SEV_AR[sev]} ({list.length})
            </b>
            <ul className="mt-1 list-disc ps-5">
              {list.map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
            </ul>
          </div>
        ) : null;
      })}

      <div>
        <h3 className="mb-1 font-extrabold">الخط الزمني لكل مجموعة</h3>
        {(j.groups.length ? j.groups : [{ id: "", name: "الجميع" }]).map((g) => {
          const first = g.id ? j.travellers.find((t) => t.group === g.id) : j.travellers[0];
          const rows = timeline(j, first?.id ?? "", issues);
          return (
            <div key={g.id || "all"} className="mb-2 rounded-[10px] border border-[#e6efeb] p-2">
              <b>{g.name}</b>
              <ol className="mt-1 space-y-1">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-32 shrink-0 text-[11px] text-[#557d78]">{r.start?.replace("T", " ") ?? "؟"}</span>
                    <span>{r.title}</span>
                    {r.tags.map((t) => (
                      <span key={t} className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${TAG_STYLE[t]}`}>
                        {TAG_AR[t]}
                      </span>
                    ))}
                    <span className="text-[10.5px] text-[#557d78]">· {STATUS_AR[r.status]}</span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>

      <div className="rounded-[10px] border border-[#e6efeb] p-2">
        <h3 className="mb-1 font-extrabold">التكلفة والسعر</h3>
        <p>خدمات وإقامات البكج المتقدم الآن: {fmtMoney(now)} — عند فتح الصفحة: {fmtMoney(before)}</p>
        <p className="text-[11.5px] text-[#557d78]">
          السعر المتفق عليه ({data.pricing.final_total ?? "غير محدد"} {data.pricing.display_currency}) لا يتغير تلقائياً. الأسطر تدخل ورقة التسعير عند «احسب الأسعار» في بيسك، كل خدمة مرة واحدة مهما تعدد المسافرون أو المقاطع.
        </p>
      </div>

      <div className="rounded-[10px] border border-[#e6efeb] p-2">
        <h3 className="mb-1 font-extrabold">ما سيظهر للعميل</h3>
        <ul className="list-disc ps-5">
          {route.includes.map((l) => (
            <li key={l}>✓ {l}</li>
          ))}
          {route.excludes.map((l) => (
            <li key={l} className="text-[#7a5c5c]">✗ {l}</li>
          ))}
          {route.pending.map((l) => (
            <li key={l} className="text-[#a86a10]">⏳ {l}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-[10px] border border-[#e6efeb] p-2">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="font-extrabold">تعليمات التشغيل</h3>
          <span className="text-[11px] text-[#557d78]">{j.ops_issued_at ? `آخر نسخة معتمدة: ${j.ops_issued_at.slice(0, 16).replace("T", " ")}` : "لم تُعتمد نسخة بعد"}</span>
          <button type="button" onClick={() => set({ ...j, ops_issued_at: new Date().toISOString() })} className="ms-auto h-8 rounded-[8px] bg-[#185045] px-2.5 text-[11.5px] font-bold text-white">
            اعتماد نسخة جديدة للعمليات
          </button>
        </div>
        <ol className="space-y-1.5">
          {ops.map((o) => (
            <li key={o.id} className={`rounded-[8px] border p-2 ${o.changed ? "border-[#f4d9a6] bg-[#fff8e8]" : "border-[#e6efeb]"}`}>
              {o.changed ? <b className="text-[#a86a10]">معدّل بعد آخر نسخة — </b> : null}
              <b>{o.when}</b> · {o.kind} · {o.status}
              <div>من: {o.from}{o.meeting ? ` (اللقاء: ${o.meeting})` : ""} ← إلى: {o.to}</div>
              {o.stops.length ? <div>التوقفات: {o.stops.join(" / ")}</div> : null}
              <div>{o.pax} · المنفذ: {o.operator}</div>
              {o.depends ? <div>{o.depends}</div> : null}
              {o.notes ? <div>ملاحظات: {o.notes}</div> : null}
            </li>
          ))}
        </ol>
        <p className="mt-1 text-[11px] text-[#557d78]">لا يُرسل شيء للعميل أو للمورد من هنا — الإرسال عبر إجراء الإرسال المعتمد.</p>
      </div>

      <details className="rounded-[10px] border border-[#e6efeb] p-2">
        <summary className="cursor-pointer font-extrabold">سجل التعديلات ({j.log.length + sessionChanges.length})</summary>
        <table className="mt-1 w-full text-[11.5px]">
          <tbody>
            {[...sessionChanges.map((c) => ({ ...c, at: "الآن" })), ...[...j.log].reverse()].slice(0, 200).map((c, i) => (
              <tr key={i} className="border-t border-[#eef3f1]">
                <td className="py-0.5 pe-2 text-[#557d78]">{c.at.slice(0, 16).replace("T", " ")}</td>
                <td className="pe-2">{c.by}</td>
                <td className="pe-2">{c.label}</td>
                <td className="pe-2">{c.field}</td>
                <td className="pe-2 text-[#c22850] line-through">{c.before}</td>
                <td className="text-[#0f7a52]">{c.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );

  const body: Record<StepKey, ReactNode> = { people, dest, path, window: windowCard, moves, stays, review };
  const counts: Partial<Record<StepKey, string>> = {
    people: `${j.travellers.length} مسافر`,
    dest: [j.main_country, ...j.extra_countries].filter(Boolean).join("، "),
    path: `${j.segments.length} مقطع`,
    moves: `${j.services.filter((s) => MOVING.has(s.kind)).length} خدمة`,
    stays: `${j.stays.length} إقامة`,
    review: `${issues.filter((i) => i.severity === "error").length} خطأ · ${issues.filter((i) => i.severity === "warning").length} تنبيه · ${issues.filter((i) => i.severity === "missing").length} ناقص`,
  };

  return shell(
    <>
      {STEPS.map(([key, label]) => (
        <section key={key} className={basicCard}>
          <button type="button" onClick={() => setOpen(open === key ? ("" as StepKey) : key)} className="flex w-full items-center gap-2 text-start">
            <span className="text-[13.5px] font-extrabold text-[#003c3a]">{label}</span>
            <span className="text-[11.5px] text-[#557d78]">{counts[key]}</span>
            <ChevronDown className={`ms-auto size-4 text-[#557d78] transition-transform ${open === key ? "rotate-180" : ""}`} />
          </button>
          {open === key ? <div className="mt-3">{body[key]}</div> : null}
        </section>
      ))}
    </>,
  );
}

function fmtMoney(m: Record<string, number>): string {
  const parts = Object.entries(m).map(([c, v]) => `${Math.round(v).toLocaleString("en")} ${c}`);
  return parts.length ? parts.join(" + ") : "0";
}

/** an airport by its code, from the catalogue — name, city, country and zone come with it. */
function AirportAdd({ onAdd }: { onAdd: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <input className={`${small} w-24`} value={code} placeholder="رمز المطار" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code && (onAdd(code), setCode(""))} />
      <button type="button" onClick={() => code && (onAdd(code), setCode(""))} className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-dashed border-[#2aa87a] px-2.5 text-[11.5px] font-bold text-[#0f7a52]">
        <Plus className="size-3.5" /> مطار
      </button>
    </span>
  );
}
