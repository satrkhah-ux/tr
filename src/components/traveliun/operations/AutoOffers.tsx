"use client";

import { useState } from "react";
import { setReceptionOffers } from "@/lib/data/app-settings";
import { priceOffer, type OfferCountry } from "@/lib/murad/auto-offer";

/**
 * «عروض آلية» (the owner, 2026-10-18): the countries «المستقبل الآلي» prices
 * himself — the route in its proportions, a hotel per city, and the owner's
 * prices — with a worked example so a change is checked before it is saved.
 */

const field = "tv-field min-h-11 w-full min-w-0 rounded-xl border px-3 py-2 text-sm font-semibold";

export function AutoOffers({ initial, usd }: { initial: OfferCountry[]; usd: number }) {
  const [offers, setOffers] = useState<OfferCountry[]>(initial);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<"saved" | "failed" | null>(null);

  const patch = (i: number, p: Partial<OfferCountry>) => setOffers(offers.map((o, k) => (k === i ? { ...o, ...p } : o)));

  async function save() {
    setSaving(true);
    setNote(null);
    const res = await setReceptionOffers(offers).catch(() => ({ ok: false }));
    setSaving(false);
    setNote(res.ok ? "saved" : "failed");
  }

  return (
    <section className="tv-card min-w-0 rounded-2xl border p-4 sm:p-6">
      <h2 className="text-lg font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">بكجات مُراد وأسعارها</h2>
      <p className="mt-1 text-sm leading-6 text-tv-text-faint">
        حدّد الدول التي يجهّز لها مُراد برنامجاً مقترحاً، وأسعار الخدمات والمدن والفنادق. يحفظ البرنامج في بيسك ليؤكده الموظف.
      </p>

      {offers.map((o, i) => {
        const example = priceOffer(o, 10, 2, usd);
        return (
          <div key={i} className="mt-4 min-w-0 rounded-xl border border-[#e3ece8] p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input value={o.country} onChange={(e) => patch(i, { country: e.target.value })} className={`${field} w-40`} aria-label="الدولة" />
              <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#185045]">
                <input type="checkbox" checked={o.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} /> مفعّل
              </label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {(
                [
                  ["carPerDay", "السيارة لليوم"],
                  ["roomPerNight", "الغرفة لليلة"],
                  ["transfer", "الاستقبال/التوديع للمرة"],
                  ["marginPct", "الربح %"],
                  ["maxPeople", "أقصى عدد أشخاص"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="grid min-w-0 gap-1">
                  <span className="text-[11px] font-bold text-[#557d78]">{label}</span>
                  <input type="number" min={0} value={o[k]} onChange={(e) => patch(i, { [k]: Number(e.target.value) } as Partial<OfferCountry>)} className={field} />
                </label>
              ))}
              <label className="grid min-w-0 gap-1">
                <span className="text-[11px] font-bold text-[#557d78]">العملة</span>
                <input value={o.currency} onChange={(e) => patch(i, { currency: e.target.value.toUpperCase().slice(0, 3) })} className={field} dir="ltr" />
              </label>
            </div>

            <p className="mt-3 text-xs leading-6 text-tv-text-faint">السيارة لليوم، والغرفة لليلة لكل شخصين. الاستقبال والتوديع مرتان. الطلبات مع أطفال أو فوق الحد المحدد تُحوّل لموظف.</p>
            <p className="mt-4 text-sm font-bold text-[#557d78]">مسار الرحلة والفنادق</p><p className="text-xs leading-6 text-tv-text-faint">تُوزّع ليالي الرحلة بين المدن وفق النسب المحددة.</p>
            {o.cities.map((c, k) => (
              <div key={k} className="mt-3 grid grid-cols-[minmax(0,1fr)_4rem_2rem] gap-2 rounded-xl bg-[#f5f8f6] p-2 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.6fr)_2rem] dark:bg-[#18372e]">
                <label className="order-1 grid min-w-0 gap-1 text-xs text-[#557d78]">المدينة<input value={c.city} onChange={(e) => patch(i, { cities: o.cities.map((x, j) => (j === k ? { ...x, city: e.target.value } : x)) })} className={field} /></label>
                <label className="order-2 grid min-w-0 gap-1 text-xs text-[#557d78]">الليالي<input type="number" min={1} value={c.nights} onChange={(e) => patch(i, { cities: o.cities.map((x, j) => (j === k ? { ...x, nights: Number(e.target.value) } : x)) })} className={field} /></label>
                <label className="order-4 col-span-3 grid min-w-0 gap-1 text-xs text-[#557d78] sm:order-3 sm:col-span-1">الفندق<input value={c.hotel} onChange={(e) => patch(i, { cities: o.cities.map((x, j) => (j === k ? { ...x, hotel: e.target.value } : x)) })} className={field} dir="auto" /></label>
                <button type="button" aria-label="حذف المدينة" onClick={() => patch(i, { cities: o.cities.filter((_, j) => j !== k) })} className="order-3 min-h-11 self-end text-[#c22850] sm:order-4">
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={() => patch(i, { cities: [...o.cities, { city: "", nights: 1, hotel: "" }] })} className="mt-1 text-[12px] font-bold text-[#185045]">
              + مدينة
            </button>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-[#557d78]">يشمل (سطر لكل بند)</span>
                <textarea rows={3} value={o.includes.join("\n")} onChange={(e) => patch(i, { includes: e.target.value.split("\n") })} className={`${field} h-auto py-1`} />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-[#557d78]">لا يشمل (سطر لكل بند)</span>
                <textarea rows={3} value={o.excludes.join("\n")} onChange={(e) => patch(i, { excludes: e.target.value.split("\n") })} className={`${field} h-auto py-1`} />
              </label>
            </div>
            <p className="mt-2 rounded-[8px] bg-[#f6faf8] px-2 py-1.5 text-[11.5px] font-bold text-[#185045]">
              مثال: 10 أيام لشخصين = {example.cost.toLocaleString("en-US")} {o.currency} + {o.marginPct}% = {example.total.toLocaleString("en-US")} {o.currency} ≈ {example.totalSar.toLocaleString("en-US")} ريال (بسعر {usd}) — {example.route.map((r) => `${r.city} ${r.nights}`).join(" + ")}
            </p>
          </div>
        );
      })}

      <div className="tv-card sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 mt-4 flex flex-wrap items-center gap-2 rounded-xl border p-3 lg:bottom-0">
        <button type="button" onClick={save} disabled={saving} className="tv-btn-primary min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-60">
          حفظ العروض الآلية
        </button>
        {note === "saved" ? <span className="text-[12px] font-bold text-[#0f7a52]">حُفظ.</span> : null}
        {note === "failed" ? <span className="text-[12px] font-bold text-[#c22850]">لم يُحفظ — تأكد من الأرقام والمدن.</span> : null}
      </div>
    </section>
  );
}
