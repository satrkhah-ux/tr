"use client";

import { useState } from "react";
import { setReceptionRoutes, type ReceptionSetup } from "@/lib/data/app-settings";
import { DEPARTMENT, ROUTE_KEYS, type RouteKey, type Routes } from "@/lib/murad/reception";

/**
 * «المستقبل الآلي»: which Teletel team each kind of request goes to, and the
 * working day the off-hours line is written from (the owner, 2026-10-18). The
 * teams are the account's own, read live; until saved, the table shown is a
 * suggestion from their names.
 */

const LABEL: Record<RouteKey | "fallback", string> = {
  بكج: "بكج سياحي",
  تأشيرات: "تأشيرات",
  طيران: "طيران",
  فنادق: "فنادق",
  مواصلات: "مواصلات",
  موظف: "طلب التحدث مع موظف",
  "غير واضح": "طلب غير واضح بعد السؤال",
  fallback: "الفريق العام (ما لا فريق له)",
};

const field = "h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-[12.5px] font-semibold text-[#185045] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]";

export function ReceptionRoutes({ setup }: { setup: ReceptionSetup | null }) {
  const [routes, setRoutes] = useState<Routes>(setup?.routes ?? {});
  const [hours, setHours] = useState(setup?.hours ?? "");
  const [minWait, setMinWait] = useState(Number(setup?.delay.split("-")[0] ?? 20));
  const [maxWait, setMaxWait] = useState(Number(setup?.delay.split("-")[1] ?? 60));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<"saved" | "failed" | null>(null);
  if (!setup) return null;

  const teamName = (id: number | null | undefined) => setup.teams.find((t) => t.id === id)?.name ?? null;
  const unrouted = ROUTE_KEYS.filter((k) => routes[k] == null);

  async function save() {
    setSaving(true);
    setNote(null);
    const res = await setReceptionRoutes(routes, hours, `${minWait}-${maxWait}`).catch(() => ({ ok: false }));
    setSaving(false);
    setNote(res.ok ? "saved" : "failed");
  }

  return (
    <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
      <h2 className="text-[15px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">المستقبل الآلي — إلى أي قسم يُحوَّل كل طلب</h2>
      <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">
        يرحّب «مُراد» بالعميل الجديد ويقول له «سيتم تحويل طلبك إلى …» ثم يسند المحادثة في Teletel إلى الفريق المختار هنا. الفرق هي فرق حسابكم في Teletel كما هي الآن.
        {setup.scope === "test" ? " يعمل الآن على رقمي التجربة فقط." : " يعمل الآن على كل العملاء."}
      </p>
      {!setup.saved ? (
        <p className="mt-2 rounded-[8px] border border-[#f0e2c4] bg-[#fdf9ee] px-3 py-2 text-[12px] font-bold text-[#8a6d1f]">
          هذا الجدول مقترح من أسماء الفرق ولم يُحفظ بعد — راجعه واضغط «حفظ».
        </p>
      ) : null}
      {setup.teams.length === 0 ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">تعذّرت قراءة فرق Teletel الآن.</p> : null}

      <div className="mt-3 grid gap-2">
        {([...ROUTE_KEYS, "fallback"] as const).map((k) => (
          <label key={k} className="grid items-center gap-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <span className="text-[12.5px] font-bold text-[#185045] dark:text-[#d6e5df]">
              {LABEL[k]}
              {k !== "fallback" ? <span className="block text-[11px] font-semibold text-tv-text-faint">يُقال للعميل: «{DEPARTMENT[k]}»</span> : null}
            </span>
            <select value={routes[k] ?? ""} onChange={(e) => setRoutes({ ...routes, [k]: e.target.value ? Number(e.target.value) : null })} className={field}>
              <option value="">{k === "fallback" ? "— بدون —" : `— الفريق العام${teamName(routes.fallback) ? ` (${teamName(routes.fallback)})` : ""} —`}</option>
              {setup.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {unrouted.length && routes.fallback == null ? (
        <p className="mt-2 text-[12px] font-bold text-[#c22850]">
          بلا فريق ولا فريق عام: {unrouted.map((k) => LABEL[k]).join("، ")} — يُرحَّب بالعميل ولا تُسند المحادثة لأحد.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 gap-1">
          <span className="text-[11.5px] font-bold text-[#557d78]">أوقات دوام المكتب</span>
          <input dir="rtl" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="السبت-الخميس 10:30-12:30 16:00-00:00 | الجمعة 16:00-00:00" className={`${field} w-full`} />
        </label>
        <span className="basis-full pb-1 text-[11.5px] font-semibold text-tv-text-faint">بتوقيت الرياض: الأيام ثم فترات «من-إلى» (00:00 = منتصف الليل)، ويفصل بين المجموعات الخط العمودي |. خارجها ولا أحد متصل يُضاف «وسيتواصل معك الموظف عند بداية الدوام الساعة …» بأقرب فتح. الفارغ = أوقات المكتب الأصلية.</span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-[11.5px] font-bold text-[#557d78]">ينتظر قبل الرد من (ثانية)</span>
          <input type="number" min={0} max={90} value={minWait} onChange={(e) => setMinWait(Number(e.target.value))} className={`${field} w-28`} />
        </label>
        <label className="grid gap-1">
          <span className="text-[11.5px] font-bold text-[#557d78]">إلى (ثانية)</span>
          <input type="number" min={0} max={90} value={maxWait} onChange={(e) => setMaxWait(Number(e.target.value))} className={`${field} w-28`} />
        </label>
        <span className="pb-2 text-[11.5px] font-semibold text-tv-text-faint">
          «تأخير بشري»: مدة عشوائية بينهما. إن كتب العميل مرة ثانية أثناء الانتظار يُعاد العد مرة واحدة ويُقرأ كلامه كله، ولا يتجاوز الانتظار 90 ثانية. إن ردّ موظف أو أسندها أحد أثناء الانتظار يُلغى الرد الآلي.
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={save} disabled={saving} className="h-9 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60">
          حفظ
        </button>
        {note === "saved" ? <span className="text-[12px] font-bold text-[#0f7a52]">حُفظ.</span> : null}
        {note === "failed" ? <span className="text-[12px] font-bold text-[#c22850]">لم يُحفظ.</span> : null}
      </div>
    </section>
  );
}
