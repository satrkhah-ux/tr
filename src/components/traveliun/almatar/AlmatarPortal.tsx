"use client";

import { useMemo, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Car, FileText, KeyRound, Loader2, LogOut, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cancelAlmatarBooking, createAlmatarBooking } from "@/lib/almatar/actions";
import { cancelFeePct, KIND_LABEL, MAX_UNITS, STATUS_LABEL, TERMS, unitPrice, VEHICLES, vehicleLabel, type Vehicle } from "@/lib/almatar/rules";
import type { AlmatarBooking, AlmatarService, AlmatarSession } from "@/lib/almatar/server";
import { ChangePasswordDialog } from "../ChangePasswordDialog";

const card = "rounded-2xl border border-[#e7e5ef] bg-white p-5 shadow-[0_1px_2px_rgba(27,26,31,0.04)]";
const field = "h-10 w-full rounded-[10px] border border-[#d9d9de] bg-white px-3 text-[13px] text-[#1b1a1f] outline-none focus:border-[var(--am)]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#46455a]";
const sar = (n: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)} ر.س`;

const STATUS_TONE: Record<string, string> = {
  pending: "bg-[#fff8e8] text-[#a86a10]",
  confirmed: "bg-[#e8f6ef] text-[#17795a]",
  rejected: "bg-[#fff0f3] text-[#c22850]",
  cancelled: "bg-[#f1f1f4] text-[#747583]",
};

/** «المطار»'s own screen: book a line of its transport list, follow it, carry its voucher. Its identity, not ours. */
export function AlmatarPortal({ session, services, bookings }: { session: AlmatarSession; services: AlmatarService[]; bookings: AlmatarBooking[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  // the page's own clock, read once: a booking past its time offers no cancel
  const [now] = useState(() => Date.now());

  const countries = useMemo(() => [...new Map(services.map((s) => [s.country_code, s.country_ar])).entries()], [services]);
  const [country, setCountry] = useState(countries[0]?.[0] ?? "");
  const inCountry = services.filter((s) => s.country_code === country);
  const [serviceId, setServiceId] = useState("");
  const service = services.find((s) => s.id === serviceId) ?? null;
  const [vehicle, setVehicle] = useState<Vehicle>("small");
  const [units, setUnits] = useState(1);
  const total = service ? unitPrice(service, vehicle) * units : 0;
  const byId = new Map(services.map((s) => [s.id, s]));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const v = (k: string) => String(f.get(k) ?? "");
    start(async () => {
      const r = await createAlmatarBooking({
        service_id: serviceId,
        vehicle,
        units,
        date: v("date"),
        time: v("time"),
        passengers: Number(v("passengers")),
        lead_name: v("lead_name"),
        lead_phone: v("lead_phone"),
        flight_no: v("flight_no"),
        pickup: v("pickup"),
        dropoff: v("dropoff"),
        notes: v("notes"),
      });
      setNotice({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) {
        form.reset();
        setServiceId("");
        setUnits(1);
        router.refresh();
      }
    });
  }

  function cancel(b: AlmatarBooking) {
    const fee = cancelFeePct(new Date(b.service_at), new Date());
    const ask = fee
      ? `الخدمة بعد أقل من 12 ساعة — الإلغاء الآن برسوم 100% (${sar(Number(b.total_sar))}). هل تلغي الحجز ${b.ref}؟`
      : `إلغاء الحجز ${b.ref} دون رسوم؟`;
    if (!window.confirm(ask)) return;
    start(async () => {
      const r = await cancelAlmatarBooking(b.id);
      setNotice({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) router.refresh();
    });
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/b2b");
    router.refresh();
  }

  return (
    <main className="min-h-dvh bg-[#f7f7f8] pb-12" dir="rtl" style={{ "--am": session.brand_color, "--am2": session.accent_color } as CSSProperties}>
      <header className="border-b border-[#e7e5ef] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {session.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.logo_url} alt={session.name_latin ?? session.name} className="h-9 w-auto" />
            ) : (
              <span className="text-xl font-extrabold text-[var(--am)]">{session.name}</span>
            )}
            <span className="rounded-full bg-[var(--am)]/10 px-2.5 py-0.5 text-[11.5px] font-bold text-[var(--am)]">حجوزات المواصلات</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setChangeOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#d9d9de] px-3 text-[12px] font-bold text-[#46455a] hover:bg-[#f7f7f8]">
              <KeyRound className="size-4" /> تغيير كلمة المرور
            </button>
            <button type="button" onClick={signOut} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#d9d9de] px-3 text-[12px] font-bold text-[#46455a] hover:bg-[#f7f7f8]">
              <LogOut className="size-4" /> خروج
            </button>
          </div>
        </div>
      </header>
      <ChangePasswordDialog open={changeOpen} onOpenChange={setChangeOpen} />

      <div className="mx-auto grid max-w-6xl gap-4 px-4 pt-5">
        {notice ? (
          <p className={`${card} flex items-center justify-between text-[13px] font-bold ${notice.ok ? "text-[#17795a]" : "text-[#c22850]"}`}>
            {notice.text}
            <button type="button" aria-label="إغلاق" onClick={() => setNotice(null)}>
              <X className="size-4" />
            </button>
          </p>
        ) : null}

        <form onSubmit={submit} className={card}>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#1b1a1f]">
            <Car className="size-5 text-[var(--am)]" /> حجز جديد
          </h1>
          <p className="mt-1 text-[12px] font-semibold text-[#747583]">
            الحجز قبل 24 ساعة على الأقل من وقت الخدمة بتوقيت الوجهة. الأسعار بالريال السعودي، صافية، وسارية حتى ديسمبر 2027.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={label}>
              الدولة
              <select className={field} value={country} onChange={(e) => {
                  setCountry(e.target.value);
                  setServiceId("");
                }}>
                {countries.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${label} sm:col-span-2 lg:col-span-3`}>
              الخدمة
              <select className={field} value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                <option value="">اختر الخدمة…</option>
                {Object.entries(KIND_LABEL).map(([kind, kindLabel]) => {
                  const list = inCountry.filter((s) => s.kind === kind);
                  return list.length ? (
                    <optgroup key={kind} label={kindLabel}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name_ar} — {s.scope_ar}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
          </div>

          <fieldset className="mt-3 grid gap-2 sm:grid-cols-3">
            <legend className="mb-1.5 text-[12px] font-bold text-[#46455a]">فئة المركبة</legend>
            {VEHICLES.map((v) => (
              <label
                key={v.id}
                className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 text-[13px] font-bold ${vehicle === v.id ? "border-[var(--am)] bg-[var(--am)]/5 text-[var(--am)]" : "border-[#d9d9de] text-[#46455a]"}`}
              >
                <span className="flex items-center gap-2">
                  <input type="radio" name="vehicle" value={v.id} checked={vehicle === v.id} onChange={() => setVehicle(v.id)} className="accent-[var(--am)]" />
                  {v.label}
                </span>
                <span className="tv-tnum">{service ? sar(unitPrice(service, v.id)) : "—"}</span>
              </label>
            ))}
          </fieldset>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={label}>
              عدد المركبات
              <input className={field} type="number" min={1} max={MAX_UNITS} value={units} onChange={(e) => setUnits(Math.max(1, Math.min(MAX_UNITS, Number(e.target.value) || 1)))} dir="ltr" />
            </label>
            <label className={label}>
              عدد الركاب
              <input className={field} name="passengers" type="number" min={1} defaultValue={1} required dir="ltr" />
            </label>
            <label className={label}>
              تاريخ الخدمة
              <input className={field} name="date" type="date" required dir="ltr" />
            </label>
            <label className={label}>
              الوقت (بتوقيت الوجهة)
              <input className={field} name="time" type="time" required dir="ltr" />
            </label>
            <label className={label}>
              اسم المسافر الرئيسي
              <input className={field} name="lead_name" required maxLength={120} />
            </label>
            <label className={label}>
              جوال المسافر
              <input className={field} name="lead_phone" type="tel" dir="ltr" maxLength={40} />
            </label>
            <label className={label}>
              رقم الرحلة
              <input className={field} name="flight_no" dir="ltr" maxLength={40} placeholder="SV 846" />
            </label>
            <div className="grid content-end">
              <p className="text-[11.5px] font-semibold text-[#747583]">الانتظار المجاني 60 دقيقة في الاستقبال والتوديع.</p>
            </div>
            <label className={`${label} sm:col-span-2`}>
              مكان الانطلاق
              <input className={field} name="pickup" maxLength={200} placeholder="المطار / اسم الفندق" />
            </label>
            <label className={`${label} sm:col-span-2`}>
              الوجهة
              <input className={field} name="dropoff" maxLength={200} placeholder="اسم الفندق / المطار" />
            </label>
            <label className={`${label} sm:col-span-2 lg:col-span-4`}>
              ملاحظات
              <textarea className={`${field} h-auto min-h-[64px] py-2`} name="notes" maxLength={1000} />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#efeff2] pt-4">
            <div className="text-[13px] font-bold text-[#46455a]">
              الإجمالي: <span className="tv-tnum text-lg font-extrabold text-[#1b1a1f]">{service ? sar(total) : "—"}</span>
              {units >= MAX_UNITS ? <span className="ms-2 text-[11.5px] text-[#a86a10]">8 مركبات أو أكثر = حجز جماعي باتفاق منفصل</span> : null}
            </div>
            <button
              type="submit"
              disabled={pending || !service}
              className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[var(--am)] px-6 text-[13px] font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              إرسال الحجز
            </button>
          </div>
        </form>

        <section className={card}>
          <h2 className="text-base font-extrabold text-[#1b1a1f]">حجوزاتي</h2>
          {bookings.length === 0 ? (
            <p className="mt-2 text-[12.5px] font-semibold text-[#747583]">لا توجد حجوزات بعد.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#efeff2] text-start text-[11px] text-[#92939e]">
                    {["الرقم", "الخدمة", "الموعد", "المركبة", "المسافر", "المبلغ", "الحالة", ""].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 text-start font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const s = byId.get(b.service_id);
                    const open = (b.status === "pending" || b.status === "confirmed") && new Date(b.service_at).getTime() > now;
                    return (
                      <tr key={b.id} className="border-b border-[#f4f4f6] align-top font-semibold text-[#1b1a1f]">
                        <td className="whitespace-nowrap px-2 py-2 font-bold" dir="ltr">{b.ref}</td>
                        <td className="px-2 py-2">
                          {s ? `${s.name_ar} — ${s.scope_ar}` : b.service_id}
                          <div className="text-[11px] text-[#92939e]">{s?.country_ar}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2" dir="ltr">
                          {b.service_date} {b.service_time.slice(0, 5)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          {vehicleLabel(b.vehicle)} × {b.units}
                        </td>
                        <td className="px-2 py-2">
                          {b.lead_name}
                          <div className="text-[11px] text-[#92939e]">{b.passengers} راكب{b.flight_no ? ` · ${b.flight_no}` : ""}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 tv-tnum">
                          {sar(Number(b.total_sar))}
                          {b.cancel_fee_pct ? <div className="text-[11px] text-[#c22850]">رسوم إلغاء {sar(Number(b.cancel_fee_sar))}</div> : null}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_TONE[b.status] ?? ""}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                          {b.status_note ? <div className="mt-1 text-[11px] text-[#c22850]">{b.status_note}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <div className="flex gap-1.5">
                            {b.status === "confirmed" && b.voucher_token ? (
                              <a
                                href={`/b2b/transport-voucher/${b.voucher_token}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--am)] px-2.5 text-[11.5px] font-bold text-white"
                              >
                                <FileText className="size-3.5" /> الفوتشر
                              </a>
                            ) : null}
                            {open ? (
                              <button type="button" disabled={pending} onClick={() => cancel(b)} className="h-8 rounded-lg border border-[#f3c7d2] px-2.5 text-[11.5px] font-bold text-[#c22850] disabled:opacity-50">
                                إلغاء
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <details className={card}>
          <summary className="cursor-pointer text-[13px] font-extrabold text-[#1b1a1f]">الشروط والأحكام</summary>
          <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-[12.5px] font-semibold leading-6 text-[#46455a]">
            {TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </details>
      </div>
    </main>
  );
}
