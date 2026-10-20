"use client";

import { useState } from "react";
import { saveMuradControl, type getMuradControl } from "@/lib/data/murad-control";
import { TASK_LABELS } from "@/lib/murad/control";
import { ROUTE_KEYS, DEPARTMENT } from "@/lib/murad/reception";

type Setup = NonNullable<Awaited<ReturnType<typeof getMuradControl>>>;
const field = "w-full rounded-lg border border-[#dbe6e1] bg-white p-3 text-sm text-[#185045]";
export function MuradSettings({ setup }: { setup: Setup }) {
  const [c, setC] = useState(setup.control);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try { const r = await saveMuradControl(c); setMessage(r.ok ? "تم حفظ إعدادات مُراد" : r.error ?? "تعذّر الحفظ"); }
    catch { setMessage("تعذّر الاتصال. أعد المحاولة."); }
    finally { setBusy(false); }
  }
  return <section dir="rtl" className="space-y-6 rounded-2xl border border-[#dbe6e1] bg-white p-6 text-[#185045]">
    <div><h1 className="text-2xl font-extrabold">إعدادات مُراد</h1><p className="mt-2 text-sm">حدّد مهامه وأماكن الرد والتحويل. تبقى مفاتيح تشغيل الخدمات ونطاق أرقام التجربة الحالية مطبّقة.</p></div>
    <fieldset disabled={busy} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries(TASK_LABELS).map(([key, label]) => <label key={key} className="flex items-center gap-3 rounded-xl bg-[#f0f7f4] p-4">
        <input type="checkbox" checked={c.tasks[key as keyof typeof c.tasks]} onChange={(e) => setC({ ...c, tasks: { ...c.tasks, [key]: e.target.checked } })} />{label}
      </label>)}</div>
      <label className="flex items-center gap-3 font-bold"><input type="checkbox" checked={c.includePrice} onChange={(e) => setC({ ...c, includePrice: e.target.checked })} />تتضمن الإجابة السعر</label>
      <p className="text-sm">عند إلغاء السعر، تُرسل تفاصيل البرنامج فقط، ولا يُرسل ملف عرض أو رابط يحتوي على السعر.</p>
      {(["inboxIds", "teamIds"] as const).map((key) => <fieldset key={key} className="rounded-xl border p-4">
        <legend className="px-2 font-bold">{key === "inboxIds" ? "أين يتواجد — صناديق المحادثات" : "في أي قسم يرد"}</legend>
        <p className="mb-3 text-sm">بدون تحديد = جميع {key === "inboxIds" ? "الصناديق" : "الأقسام"} ضمن نطاق التشغيل الحالي.</p>
        <div className="flex flex-wrap gap-4">{(key === "inboxIds" ? setup.inboxes : setup.teams).map((x) => <label key={x.id} className="flex gap-2">
          <input type="checkbox" checked={c[key].includes(x.id)} onChange={(e) => setC({ ...c, [key]: e.target.checked ? [...c[key], x.id] : c[key].filter((id) => id !== x.id) })} />{x.name}
        </label>)}</div>
        {!(key === "inboxIds" ? setup.inboxes : setup.teams).length && <p role="alert">تعذّر تحميل القائمة من تليتيل.</p>}
      </fieldset>)}
      <div className="space-y-3"><h2 className="font-bold">إلى أين يحوّل كل طلب</h2><p className="text-sm">يمكن تحديد قسم أو موظف أو الاثنين. تركهما فارغين يستخدم جدول التحويل الحالي أدناه.</p>
        {ROUTE_KEYS.map((key) => { const h = c.handoffs[key] ?? { teamId: null, agentId: null }; return <div key={key} className="grid items-center gap-3 rounded-xl bg-[#f0f7f4] p-3 md:grid-cols-3">
          <strong>{DEPARTMENT[key]}</strong>
          <select aria-label={`قسم تحويل ${key}`} className={field} value={h.teamId ?? ""} onChange={(e) => setC({ ...c, handoffs: { ...c.handoffs, [key]: { ...h, teamId: e.target.value ? Number(e.target.value) : null } } })}><option value="">التحويل الحالي</option>{setup.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select aria-label={`موظف تحويل ${key}`} className={field} value={h.agentId ?? ""} onChange={(e) => setC({ ...c, handoffs: { ...c.handoffs, [key]: { ...h, agentId: e.target.value ? Number(e.target.value) : null } } })}><option value="">موظفو القسم</option>{setup.agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </div>; })}
      </div>
      <button onClick={save} className="rounded-lg bg-[#185045] px-6 py-3 font-bold text-white">{busy ? "جارٍ الحفظ…" : "حفظ إعدادات مُراد"}</button>
    </fieldset>
    <p role="status">{message}</p>
  </section>;
}
