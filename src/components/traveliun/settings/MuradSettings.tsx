"use client";

import { useState } from "react";
import { saveMuradControl, type getMuradControl } from "@/lib/data/murad-control";
import { KIND_MODES, TASK_LABELS, kindMode, visaForAll, type KindMode } from "@/lib/murad/control";
import { ROUTE_KEYS, DEPARTMENT } from "@/lib/murad/reception";

type Setup = NonNullable<Awaited<ReturnType<typeof getMuradControl>>>;
const field = "w-full rounded-lg border border-[#dbe6e1] bg-white p-3 text-sm text-[#185045]";
const lines = (v: string) => v.split(/[\n,،]+/).map((x) => x.trim()).filter(Boolean);
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
      {/* what is in force now, said plainly (visaForAll: both switches) — the form below may differ until saved */}
      {visaForAll(setup.control) ? (
        <p role="status" className="rounded-xl border border-[#f0c4cf] bg-[#fdeef2] p-4 font-bold text-[#a3263f]">مُراد يرد الآن على أسئلة التأشيرات لجميع العملاء الحقيقيين — وليس أرقام التجربة فقط.</p>
      ) : (
        <p role="status" className="rounded-xl bg-[#f0f7f4] p-4 text-sm font-bold">ردود التأشيرات الآن: أرقام التجربة فقط.</p>
      )}
      <label className="flex items-center gap-3 font-bold"><input type="checkbox" checked={c.visaAll === true} onChange={(e) => setC({ ...c, visaAll: e.target.checked })} />استقبال التأشيرات لجميع العملاء ومتابعة النواقص والصور</label>
      {c.visaAll && !c.tasks.visas ? <p className="text-sm font-bold text-[#a86a10]">لا يعمل ما دامت «{TASK_LABELS.visas}» متوقفة — يلزم المفتاحان معاً.</p> : null}
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
      <div className="space-y-3"><h2 className="text-lg font-bold">مسار المحادثات</h2><p className="text-sm">لكل نوع طلب: ماذا يفعل مُراد، وإلى أي قسم وموظف يحوّله. ترك القسم والموظف فارغين يستخدم جدول التحويل أدناه، والموظف الفارغ = المتصل في القسم.</p>
        {ROUTE_KEYS.map((key) => { const h = c.handoffs[key] ?? { teamId: null, agentId: null }; return <div key={key} className="grid items-center gap-3 rounded-xl bg-[#f0f7f4] p-3 md:grid-cols-4">
          <strong>{DEPARTMENT[key]}</strong>
          <select aria-label={`ماذا يفعل مُراد مع ${key}`} className={field} value={kindMode(c, key)} onChange={(e) => setC({ ...c, kinds: { ...c.kinds, [key]: e.target.value as KindMode } })}>{Object.entries(KIND_MODES).map(([m, label]) => <option key={m} value={m}>{label}</option>)}</select>
          <select aria-label={`قسم تحويل ${key}`} className={field} value={h.teamId ?? ""} onChange={(e) => setC({ ...c, handoffs: { ...c.handoffs, [key]: { ...h, teamId: e.target.value ? Number(e.target.value) : null } } })}><option value="">التحويل الحالي</option>{setup.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select aria-label={`موظف تحويل ${key}`} className={field} value={h.agentId ?? ""} onChange={(e) => setC({ ...c, handoffs: { ...c.handoffs, [key]: { ...h, agentId: e.target.value ? Number(e.target.value) : null } } })}><option value="">موظفو القسم</option>{setup.agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </div>; })}
      </div>
      <fieldset className="rounded-xl border p-4"><legend className="px-2 font-bold">موظفون لا يحوّل لهم مُراد</legend>
        <p className="mb-3 text-sm">موقوف مؤقتاً (إجازة، ضغط): لا يُسند له مُراد أي محادثة، ويأخذها القسم.</p>
        <div className="flex flex-wrap gap-4">{setup.agents.map((x) => <label key={x.id} className="flex gap-2">
          <input type="checkbox" checked={(c.paused ?? []).includes(x.id)} onChange={(e) => setC({ ...c, paused: e.target.checked ? [...(c.paused ?? []), x.id] : (c.paused ?? []).filter((id) => id !== x.id) })} />{x.name}
        </label>)}</div>
      </fieldset>
      <fieldset className="rounded-xl border p-4"><legend className="px-2 font-bold">الرسائل المتأخرة</legend>
        <p className="mb-3 text-sm">إذا لم يرد أي موظف على العميل بعد تحويل مُراد خلال المدة، تُحوّل المحادثة لهذا الموظف مع ملاحظة.</p>
        <div className="grid items-center gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2">بعد<input type="number" min={1} max={1440} className={field} value={c.late?.minutes ?? ""} placeholder="15" onChange={(e) => { const minutes = Number(e.target.value); setC({ ...c, late: c.late && minutes ? { ...c.late, minutes } : c.late }); }} />دقيقة</label>
          <select aria-label="موظف الرسائل المتأخرة" className={field} value={c.late?.agentId ?? ""} onChange={(e) => setC({ ...c, late: e.target.value ? { minutes: c.late?.minutes ?? 15, agentId: Number(e.target.value) } : null })}><option value="">متوقف — لا تحويل</option>{setup.agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </div>
      </fieldset>
      <fieldset className="rounded-xl border p-4"><legend className="px-2 font-bold">أرقام الإدارة والتجربة</legend>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm"><span className="font-bold">أرقام الإدارة</span><span className="block">ما يُكتب منها قرار إداري أو تعليم لمُراد، وتُستخدم للتجربة.</span><textarea dir="ltr" rows={3} className={field} defaultValue={(c.admins ?? []).join("\n")} onBlur={(e) => setC({ ...c, admins: lines(e.target.value) })} /></label>
          <label className="space-y-1 text-sm"><span className="font-bold">لا تُحوّل أبداً</span><span className="block">مُراد يرد عليها ولا يحوّلها لأي موظف.</span><textarea dir="ltr" rows={3} className={field} defaultValue={(c.noHandoff ?? []).join("\n")} onBlur={(e) => setC({ ...c, noHandoff: lines(e.target.value) })} /></label>
          <label className="space-y-1 text-sm"><span className="font-bold">رمز بدء تجربة جديدة</span><span className="block">يُكتب من رقم إدارة لبدء محادثة تجربة من جديد.</span><input dir="ltr" inputMode="numeric" className={field} value={c.resetCode ?? ""} placeholder="11223344" onChange={(e) => setC({ ...c, resetCode: e.target.value.replace(/\D/g, "") || undefined })} /></label>
        </div>
      </fieldset>
      <button onClick={save} className="rounded-lg bg-[#185045] px-6 py-3 font-bold text-white">{busy ? "جارٍ الحفظ…" : "حفظ إعدادات مُراد"}</button>
    </fieldset>
    <p role="status">{message}</p>
  </section>;
}
