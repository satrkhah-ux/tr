"use client";

import { useState } from "react";
import { createManagementDecision, getManagementDecisions, updateManagementDecision, type ManagementDecision } from "@/lib/data/management-decisions";
type Data = NonNullable<Awaited<ReturnType<typeof getManagementDecisions>>>;
const field = "w-full rounded-lg border border-[#dbe6e1] bg-white p-3 text-sm";
const states = { open: "بانتظار التنفيذ", in_progress: "قيد التنفيذ", done: "مكتمل" };
export function ManagementDecisions({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [title, setTitle] = useState("");
  const [ownerId, setOwner] = useState("");
  const [dueOn, setDue] = useState("");
  const [sourceKey, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initial.error ?? "");
  async function load() { const fresh = await getManagementDecisions(); if (fresh) { setData(fresh); if (fresh.error) setMessage(fresh.error); } }
  async function save() {
    setBusy(true); setMessage("");
    try {
      const r = await createManagementDecision({ title, ownerId, dueOn, sourceKey });
      if (r.ok) { setTitle(""); setSource(""); setMessage("تم تسجيل القرار"); await load(); }
      else setMessage(r.error ?? "تعذّر الحفظ");
    } catch { setMessage("تعذّر الاتصال"); } finally { setBusy(false); }
  }
  async function status(row: ManagementDecision, next: ManagementDecision["status"]) {
    setBusy(true);
    try { const r = await updateManagementDecision(row.id, next, row.updated_at); setMessage(r.ok ? "تم تحديث حالة القرار" : r.error ?? "تعذّر التحديث"); await load(); }
    catch { setMessage("تعذّر الاتصال"); } finally { setBusy(false); }
  }
  return <div dir="rtl" className="space-y-5 text-[#185045]">
    <header><h1 className="text-2xl font-extrabold">قرارات الإدارة</h1><p className="mt-2 text-sm">حوّل مؤشرات شاشة المدير إلى إجراء محدّد، ومسؤول، وموعد تنفيذ.</p></header>
    <section className="rounded-2xl border bg-white p-5"><h2 className="mb-3 font-bold">مؤشرات تحتاج إجراء</h2>
      <div className="grid gap-3 md:grid-cols-2">{data.signals.map((s) => <button disabled={busy} key={`${s.panel}:${s.key}`} onClick={() => { setSource(`${s.panel}:${s.key}`); setTitle(s.action); }} className={`rounded-xl border p-4 text-right ${s.status === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <strong>{s.panelTitle} · {s.label}</strong><p className="my-2">{s.value} — {s.reason}</p><span className="text-sm font-bold">تسجيل قرار: {s.action}</span>
      </button>)}</div>
      {!data.signals.length && <p>لا توجد مؤشرات متاحة الآن. يمكنك تسجيل قرار يدوي.</p>}
    </section>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="rounded-2xl border bg-white p-5">
      <fieldset disabled={busy || !!data.error} className="grid gap-4 md:grid-cols-2">
        <label className="md:col-span-2">الإجراء المطلوب<textarea required maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
        {sourceKey && <p className="md:col-span-2 text-sm">مرتبط بمؤشر من شاشة المدير. <button type="button" onClick={() => setSource("")} className="underline">إلغاء الربط</button></p>}
        <label>المسؤول<select required value={ownerId} onChange={(e) => setOwner(e.target.value)} className={field}><option value="">اختر الموظف</option>{data.employees.map((e) => <option key={e.id} value={e.id}>{e.arabic_name}</option>)}</select></label>
        <label>موعد التنفيذ<input required type="date" value={dueOn} onChange={(e) => setDue(e.target.value)} className={field} /></label>
        <button className="rounded-lg bg-[#185045] p-3 font-bold text-white">{busy ? "جارٍ الحفظ…" : "تسجيل القرار"}</button>
      </fieldset>
    </form>
    <p role="status">{message}</p>
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-bold">متابعة القرارات ({data.rows.length})</h2><button disabled={busy} onClick={() => void load().catch(() => setMessage("تعذّر التحديث"))} className="underline">تحديث</button></div>
      {data.rows.map((r) => <article key={r.id} className="rounded-xl border bg-white p-5">
        <h3 className="font-bold">{r.title}</h3><p className="my-2 text-sm">{r.evidence}</p>
        <div className="flex flex-wrap items-center gap-4 text-sm"><span>المسؤول: {data.employees.find((e) => e.id === r.owner_id)?.arabic_name ?? "موظف غير نشط"}</span><span>الموعد: {r.due_on}</span>
          <select aria-label={`حالة ${r.title}`} disabled={busy} value={r.status} onChange={(e) => void status(r, e.target.value as ManagementDecision["status"])} className="rounded-lg border p-2">{Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
      </article>)}
      {!data.rows.length && !data.error && <p>لم تُسجّل قرارات بعد.</p>}
    </section>
  </div>;
}
