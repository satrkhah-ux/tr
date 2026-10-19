"use client";

import { useState } from "react";
import { setReceptionOffers } from "@/lib/data/app-settings";
import { priceOffer, type OfferCountry } from "@/lib/murad/auto-offer";

/**
 * «عروض آلية» (the owner, 2026-10-18): the countries «المستقبل الآلي» prices
 * himself — the route in its proportions, a hotel per city, and the owner's
 * prices — with a worked example so a change is checked before it is saved.
 */

const field = "h-8 w-full rounded-[7px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-semibold text-[#185045] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]";

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
    <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
      <h2 className="text-[15px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">المستقبل الآلي — عروض آلية</h2>
      <p className="mt-1 text-[12.5px] font-semibold text-[#78948f]">
        حين يطلب العميل رحلة إلى دولة مفعّلة هنا، يسأله «مُراد» عن الناقص (الاسم، تاريخ الوصول، عدد الأيام، عدد الأشخاص)، ثم يرسل له برنامجاً مقترحاً بسعره ويحفظ الملف في بيسك ليؤكده الموظف.
        الأسعار للسيارة في اليوم وللغرفة في الليلة (غرفة لكل شخصين)، والاستقبال والتوديع مرتان. أكثر من الحد أو مع أطفال: يُحوَّل لموظف.
      </p>

      {offers.map((o, i) => {
        const example = priceOffer(o, 10, 2, usd);
        return (
          <div key={i} className="mt-3 rounded-[10px] border border-[#e3ece8] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input value={o.country} onChange={(e) => patch(i, { country: e.target.value })} className={`${field} w-40`} aria-label="الدولة" />
              <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#185045]">
                <input type="checkbox" checked={o.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} /> مفعّل
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
              {(
                [
                  ["carPerDay", "السيارة لليوم"],
                  ["roomPerNight", "الغرفة لليلة"],
                  ["transfer", "الاستقبال/التوديع للمرة"],
                  ["marginPct", "الربح %"],
                  ["maxPeople", "أقصى عدد أشخاص"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="grid gap-1">
                  <span className="text-[11px] font-bold text-[#557d78]">{label}</span>
                  <input type="number" min={0} value={o[k]} onChange={(e) => patch(i, { [k]: Number(e.target.value) } as Partial<OfferCountry>)} className={field} />
                </label>
              ))}
              <label className="grid gap-1">
                <span className="text-[11px] font-bold text-[#557d78]">العملة</span>
                <input value={o.currency} onChange={(e) => patch(i, { currency: e.target.value.toUpperCase().slice(0, 3) })} className={field} dir="ltr" />
              </label>
            </div>

            <p className="mt-3 text-[11.5px] font-extrabold text-[#557d78]">المدن بترتيبها، وليالي كل مدينة كنسبة (تُوزَّع على ليالي الرحلة)، وفندقها:</p>
            {o.cities.map((c, k) => (
              <div key={k} className="mt-1 grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.6fr)_2rem] gap-2">
                <input value={c.city} onChange={(e) => patch(i, { cities: o.cities.map((x, j) => (j === k ? { ...x, city: e.target.value } : x)) })} className={field} aria-label="المدينة" />
                <input type="number" min={1} value={c.nights} onChange={(e) => patch(i, { cities: o.cities.map((x, j) => (j === k ? { ...x, nights: Number(e.target.value) } : x)) })} className={field} aria-label="الليالي" />
                <input value={c.hotel} onChange={(e) => patch(i, { cities: o.cities.map((x, j) => (j === k ? { ...x, hotel: e.target.value } : x)) })} className={field} aria-label="الفندق" dir="auto" />
                <button type="button" aria-label="حذف المدينة" onClick={() => patch(i, { cities: o.cities.filter((_, j) => j !== k) })} className="text-[#c22850]">
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

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={save} disabled={saving} className="h-9 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60">
          حفظ العروض الآلية
        </button>
        {note === "saved" ? <span className="text-[12px] font-bold text-[#0f7a52]">حُفظ.</span> : null}
        {note === "failed" ? <span className="text-[12px] font-bold text-[#c22850]">لم يُحفظ — تأكد من الأرقام والمدن.</span> : null}
      </div>
    </section>
  );
}
