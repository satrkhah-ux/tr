"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { Car, Loader2, Plus, Trash2 } from "lucide-react";
import { createAlmatarRequest } from "@/lib/almatar/actions";
import { LINE_KINDS, MAX_LINES, MAX_UNITS, outsideProgram, REQUEST_KINDS, unitPrice, VEHICLES, type LineKind, type Vehicle } from "@/lib/almatar/rules";
import type { AlmatarService } from "@/lib/almatar/server";

const card = "rounded-2xl border border-[#e7e5ef] bg-white p-5 shadow-[0_1px_2px_rgba(27,26,31,0.04)]";
const field = "h-10 w-full rounded-[10px] border border-[#d9d9de] bg-white px-3 text-[13px] text-[#1b1a1f] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[var(--am)]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#46455a]";
const sar = (n: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)} ر.س`;

type Line = { key: number; kind: LineKind; service_id: string; date: string; time: string; flight_no: string; pickup: string; dropoff: string };

const PLACES: Record<LineKind, [string, string]> = {
  arrival: ["المطار", "اسم الفندق"],
  departure: ["اسم الفندق", "المطار"],
  tour: ["اسم الفندق", "—"],
  transfer: ["من فندق / مدينة", "إلى فندق / مدينة"],
};

let nextKey = 1;

/** The opening line: an arrival, its service picked when the country has only one. */
function firstArrival(services: AlmatarService[], country: string): Line {
  const options = services.filter((s) => s.country_code === country && s.kind === "arrival");
  return { key: nextKey++, kind: "arrival", service_id: options.length === 1 ? options[0].id : "", date: "", time: "", flight_no: "", pickup: "", dropoff: "" };
}

/**
 * «حجز جديد» — one request, several services (the owner, 2026-10-18): the kind
 * lays the lines out (arrival, departure, both, tours, transfers, a program from
 * one day to another) and more are added by hand. The group, the car and the
 * traveller are shared; each line has its own service, day, time and places.
 */
export function AlmatarRequestForm({ services, onDone }: { services: AlmatarService[]; onDone: (ok: boolean, message: string, requestRef?: string) => void }) {
  const [pending, start] = useTransition();
  const countries = useMemo(() => [...new Map(services.map((s) => [s.country_code, s.country_ar])).entries()], [services]);
  const [country, setCountry] = useState(countries[0]?.[0] ?? "");
  // the form opens ready (the owner, 2026-10-18): «استقبال» picked, its line laid out
  const [kind, setKind] = useState("arrival");
  const [lines, setLines] = useState<Line[]>(() => [firstArrival(services, countries[0]?.[0] ?? "")]);
  const [vehicle, setVehicle] = useState<Vehicle>("small");
  const [units, setUnits] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const optionsFor = (k: LineKind, c = country) => services.filter((s) => s.country_code === c && (LINE_KINDS[k].kinds as readonly string[]).includes(s.kind));
  const newLine = (k: LineKind, c = country, date = ""): Line => {
    const options = optionsFor(k, c);
    return { key: nextKey++, kind: k, service_id: options.length === 1 ? options[0].id : "", date, time: "", flight_no: "", pickup: "", dropoff: "" };
  };
  const byId = new Map(services.map((s) => [s.id, s]));
  const total = lines.reduce((n, l) => {
    const s = byId.get(l.service_id);
    return n + (s ? unitPrice(s, vehicle) * units : 0);
  }, 0);
  const program = kind === "program";

  function pickKind(id: string) {
    const k = REQUEST_KINDS.find((x) => x.id === id);
    setKind(id);
    setError(null);
    setLines(k ? k.lines.map((lk) => newLine(lk, country, id === "program" ? (lk === "arrival" ? from : lk === "departure" ? to : "") : "")) : []);
  }
  function pickCountry(c: string) {
    setCountry(c);
    setLines((ls) => ls.map((l) => ({ ...l, service_id: optionsFor(l.kind, c).length === 1 ? optionsFor(l.kind, c)[0].id : "" })));
  }
  const edit = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (k: LineKind) => setLines((ls) => (ls.length >= MAX_LINES ? ls : [...ls, newLine(k)]));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? "");
    setError(null);
    if (!kind) return setError("اختر نوع الحجز.");
    if (lines.length === 0) return setError("أضف خدمة واحدة على الأقل.");
    const missing = lines.findIndex((l) => !l.service_id || !l.date || !l.time);
    if (missing >= 0) return setError(`الخدمة ${missing + 1}: اختر الخدمة وتاريخها ووقتها.`);
    if (program) {
      if (!from || !to || to < from) return setError("حدد بداية البرنامج ونهايته.");
      const out = lines.findIndex((l) => outsideProgram(from, to, l.date));
      if (out >= 0) return setError(`الخدمة ${out + 1}: تاريخها خارج أيام البرنامج.`);
    }
    start(async () => {
      try {
        const r = await createAlmatarRequest({
          kind,
          vehicle,
          units,
          passengers: Number(v("passengers")),
          lead_name: v("lead_name"),
          lead_phone: v("lead_phone"),
          notes: v("notes"),
          lines: lines.map(({ service_id, date, time, flight_no, pickup, dropoff }) => ({ service_id, date, time, flight_no, pickup, dropoff })),
        });
        if (!r.ok) return setError(r.message ?? "تعذّر حفظ الحجز.");
        form.reset();
        setKind("arrival");
        setLines([newLine("arrival")]);
        setUnits(1);
        setFrom("");
        setTo("");
        onDone(true, r.message ?? "", r.request_ref);
      } catch {
        setError("تعذّر الاتصال بالخادم — حدّث الصفحة وأعد المحاولة.");
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className={card}>
      <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#1b1a1f]">
        <Car className="size-5 text-[var(--am)]" /> حجز جديد
      </h1>
      <p className="mt-1 text-[12px] font-semibold text-[#747583]">
        طلب واحد بعدة خدمات. كل خدمة تُحجز قبل 24 ساعة على الأقل من وقتها بتوقيت الوجهة. الأسعار بالريال السعودي، صافية، وسارية حتى ديسمبر 2027.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className={label}>
          اسم العميل
          <input className={field} name="lead_name" maxLength={120} />
        </label>
        <label className={label}>
          رقم العميل
          <input className={field} name="lead_phone" type="tel" dir="ltr" maxLength={40} placeholder="+9665…" />
        </label>
        <label className={label}>
          الدولة
          <select className={field} value={country} onChange={(e) => pickCountry(e.target.value)}>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1.5 sm:col-span-3">
          <span className="text-[12px] font-bold text-[#46455a]">نوع الخدمة</span>
          <div className="flex flex-wrap gap-2">
            {REQUEST_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => pickKind(k.id)}
                className={`h-10 rounded-[10px] border px-3.5 text-[12.5px] font-bold ${kind === k.id ? "border-[var(--am)] bg-[var(--am)] text-white" : "border-[#d9d9de] text-[#46455a] hover:border-[var(--am)]"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {kind ? (
        <>
          {program ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <label className={label}>
                بداية البرنامج
                <input className={field} type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className={label}>
                نهاية البرنامج
                <input className={field} type="date" dir="ltr" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          ) : null}

          <fieldset className="mt-3 grid gap-2 sm:grid-cols-3">
            <legend className="mb-1.5 text-[12px] font-bold text-[#46455a]">فئة المركبة (لكل الخدمات)</legend>
            {VEHICLES.map((v) => (
              <label
                key={v.id}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-bold ${vehicle === v.id ? "border-[var(--am)] bg-[var(--am)]/5 text-[var(--am)]" : "border-[#d9d9de] text-[#46455a]"}`}
              >
                <input type="radio" name="vehicle" value={v.id} checked={vehicle === v.id} onChange={() => setVehicle(v.id)} className="accent-[var(--am)]" />
                {v.label}
              </label>
            ))}
          </fieldset>

          <div className="mt-4 grid gap-3">
            {lines.map((l, i) => {
              const options = optionsFor(l.kind);
              const s = byId.get(l.service_id);
              const flight = l.kind === "arrival" || l.kind === "departure";
              return (
                <div key={l.key} className="rounded-xl border border-[#e7e5ef] bg-[#fbfbfd] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12.5px] font-extrabold text-[var(--am)]">
                      {i + 1}. {LINE_KINDS[l.kind].label}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="tv-tnum text-[12.5px] font-bold text-[#1b1a1f]">{s ? sar(unitPrice(s, vehicle) * units) : "—"}</span>
                      <button type="button" aria-label="حذف الخدمة" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-[#c22850]">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
                    <label className={`${label} sm:col-span-2 lg:col-span-6`}>
                      الخدمة
                      <select className={field} value={l.service_id} onChange={(e) => edit(l.key, { service_id: e.target.value })}>
                        <option value="">{options.length ? "اختر…" : "لا توجد خدمة من هذا النوع في هذه الدولة"}</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name_ar} — {o.scope_ar}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={label}>
                      التاريخ
                      <input className={field} type="date" dir="ltr" value={l.date} min={program ? from || undefined : undefined} max={program ? to || undefined : undefined} onChange={(e) => edit(l.key, { date: e.target.value })} />
                    </label>
                    <label className={label}>
                      الوقت (محلي)
                      <input className={field} type="time" dir="ltr" value={l.time} onChange={(e) => edit(l.key, { time: e.target.value })} />
                    </label>
                    {flight ? (
                      <label className={label}>
                        رقم الرحلة
                        <input className={field} dir="ltr" maxLength={40} placeholder="SV 846" value={l.flight_no} onChange={(e) => edit(l.key, { flight_no: e.target.value })} />
                      </label>
                    ) : null}
                    <label className={`${label} ${flight ? "" : "lg:col-span-2"}`}>
                      مكان الانطلاق
                      <input className={field} maxLength={200} placeholder={PLACES[l.kind][0]} value={l.pickup} onChange={(e) => edit(l.key, { pickup: e.target.value })} />
                    </label>
                    <label className={`${label} lg:col-span-2`}>
                      الوجهة
                      <input className={field} maxLength={200} placeholder={PLACES[l.kind][1]} value={l.dropoff} onChange={(e) => edit(l.key, { dropoff: e.target.value })} />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(LINE_KINDS) as LineKind[]).map((k) => (
              <button
                key={k}
                type="button"
                disabled={lines.length >= MAX_LINES}
                onClick={() => add(k)}
                className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-dashed border-[var(--am)] px-3 text-[12px] font-bold text-[var(--am)] disabled:opacity-40"
              >
                <Plus className="size-3.5" /> {LINE_KINDS[k].label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={label}>
              عدد المركبات
              <input className={field} type="number" min={1} max={MAX_UNITS} value={units} onChange={(e) => setUnits(Math.max(1, Math.min(MAX_UNITS, Number(e.target.value) || 1)))} dir="ltr" />
            </label>
            <label className={label}>
              عدد الركاب
              <input className={field} name="passengers" type="number" min={1} defaultValue={1} dir="ltr" />
            </label>
            <label className={`${label} sm:col-span-2`}>
              ملاحظات
              <textarea className={`${field} h-auto min-h-[56px] py-2`} name="notes" maxLength={1000} />
            </label>
          </div>
          <p className="mt-2 text-[11.5px] font-semibold text-[#747583]">
            الانتظار المجاني 60 دقيقة في الاستقبال والتوديع. 8 مركبات أو أكثر حجز جماعي باتفاق منفصل.
          </p>
        </>
      ) : null}

      {error ? <p role="alert" className="mt-3 rounded-[10px] bg-[#fff0f3] px-3 py-2 text-[13px] font-bold text-[#c22850]">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#efeff2] pt-4">
        <div className="text-[13px] font-bold text-[#46455a]">
          الإجمالي ({lines.length} خدمة): <span className="tv-tnum text-lg font-extrabold text-[#1b1a1f]">{total ? sar(total) : "—"}</span>
        </div>
        <button
          type="submit"
          disabled={pending || !kind || lines.length === 0}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[var(--am)] px-6 text-[13px] font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          إرسال الطلب
        </button>
      </div>
    </form>
  );
}
