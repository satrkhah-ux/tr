"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { listSupervisors, saveSupervisionSettings, saveSupervisor, type SupervisorEntry } from "@/lib/followups/supervision/actions";
import { PRIORITY_LABEL, type Priority, type SupervisionSettings, type Thresholds } from "@/lib/followups/supervision/core";

/**
 * The management's part of «إشراف المتابعة»: who supervises whom (an employee,
 * a Teletel team, a Teletel inbox, or everyone — primary and backup), and the
 * thresholds per priority, with a team's own override and the holidays.
 */

type Data = NonNullable<Awaited<ReturnType<typeof listSupervisors>>>;
const field = "rounded-lg border border-[#dbe6e1] bg-white p-2 text-sm";
const SCOPE_LABEL = { employee: "موظف", team: "فريق Teletel", inbox: "صندوق Teletel", all: "الجميع" } as const;
const T_LABEL: Record<keyof Thresholds, string> = {
  waitingMinutes: "العميل ينتظر (دقيقة)", dueGraceMinutes: "تأخر موعد المتابعة (دقيقة)", idleHours: "بلا إجراء قادم (ساعة)",
  postponeCount: "عدد التأجيلات", employeeMinutes: "مهلة الموظف (دقيقة)", supervisorMinutes: "مهلة المشرف (دقيقة)",
};

export function SupervisionSetup({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [form, setForm] = useState({ supervisorId: "", scopeKind: "employee" as SupervisorEntry["scope_kind"], scopeRef: "", role: "primary" as SupervisorEntry["role"] });
  const [settings, setSettings] = useState<SupervisionSettings>(initial.settings);
  const [holidays, setHolidays] = useState(initial.settings.holidays.join("\n"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const name = (id: string) => data.people.find((p) => p.id === id)?.name ?? "—";

  async function reload() { const d = await listSupervisors(); if (d) setData(d); }
  async function add() {
    setBusy(true); setMsg("");
    try { const r = await saveSupervisor({ ...form, active: true }); if (r.ok) { setForm({ ...form, scopeRef: "" }); await reload(); } else setMsg(r.error); }
    catch { setMsg("تعذّر الاتصال."); } finally { setBusy(false); }
  }
  async function toggle(r: SupervisorEntry) {
    setBusy(true);
    try { await saveSupervisor({ supervisorId: r.supervisor_id, scopeKind: r.scope_kind, scopeRef: r.scope_ref, role: r.role, active: !r.active }); await reload(); } finally { setBusy(false); }
  }
  async function saveSettings() {
    setBusy(true); setMsg("");
    try {
      const r = await saveSupervisionSettings({ ...settings, holidays: holidays.split(/\s+/).filter(Boolean) });
      setMsg(r.ok ? "حُفظت الإعدادات." : r.error);
    } catch { setMsg("تعذّر الاتصال."); } finally { setBusy(false); }
  }
  const setT = (p: Priority, k: keyof Thresholds, v: number) => setSettings((s) => ({ ...s, thresholds: { ...s.thresholds, [p]: { ...s.thresholds[p], [k]: v } } }));

  if (!data.enabled) return <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-[#5a4300]">الإشراف لم يُفعَّل بعد — ينتظر إنشاء جداوله في قاعدة البيانات.</p>;
  return <div className="space-y-5">
    <section className="rounded-2xl border border-[#dfe8e4] bg-white p-4">
      <h3 className="mb-2 font-bold">مشرفو المتابعة</h3>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={form.supervisorId} onChange={(e) => setForm({ ...form, supervisorId: e.target.value })} className={field} aria-label="المشرف">
          <option value="">المشرف…</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="text-xs">يشرف على</span>
        <select value={form.scopeKind} onChange={(e) => setForm({ ...form, scopeKind: e.target.value as SupervisorEntry["scope_kind"], scopeRef: "" })} className={field} aria-label="النطاق">
          {(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((k) => <option key={k} value={k}>{SCOPE_LABEL[k]}</option>)}
        </select>
        {form.scopeKind === "employee" && <select value={form.scopeRef} onChange={(e) => setForm({ ...form, scopeRef: e.target.value })} className={field} aria-label="الموظف">
          <option value="">الموظف…</option>{data.people.filter((p) => p.id !== form.supervisorId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        {(form.scopeKind === "team" || form.scopeKind === "inbox") && <input value={form.scopeRef} onChange={(e) => setForm({ ...form, scopeRef: e.target.value })} inputMode="numeric" placeholder="رقمه في Teletel" className={`${field} w-28`} />}
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as SupervisorEntry["role"] })} className={field} aria-label="الدور">
          <option value="primary">أساسي</option><option value="backup">بديل عند الغياب</option>
        </select>
        <button type="button" disabled={busy || !form.supervisorId} onClick={() => void add()} className="rounded-lg bg-[var(--tv-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">أضف</button>
      </div>
      {!data.rows.length ? <p className="text-sm text-[#557d78]">لا مشرفين بعد — بدونهم تصل الحالات المتأخرة للإدارة مباشرة.</p> :
        <ul className="space-y-1 text-sm">{data.rows.map((r) => <li key={r.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-[#eef3f1] p-2 ${r.active ? "" : "opacity-50"}`}>
          <strong>{r.name}</strong><span className="text-xs text-[#557d78]">{r.role === "primary" ? "أساسي" : "بديل"} — {SCOPE_LABEL[r.scope_kind]}{r.scope_kind === "employee" ? `: ${name(r.scope_ref)}` : r.scope_ref ? ` #${r.scope_ref}` : ""}</span>
          <span className="flex-1" /><button type="button" disabled={busy} onClick={() => void toggle(r)} className="text-xs font-bold text-[#185045] underline">{r.active ? "إيقاف" : "تفعيل"}</button>
        </li>)}</ul>}
    </section>

    <section className="rounded-2xl border border-[#dfe8e4] bg-white p-4">
      <h3 className="mb-2 font-bold">مدد التنبيه والتصعيد (بأوقات الدوام)</h3>
      <div className="overflow-x-auto"><table className="min-w-[560px] text-sm">
        <thead><tr><th className="p-1 text-start text-xs text-[#557d78]" />{(["high", "normal", "low"] as const).map((p) => <th key={p} className="p-1 text-xs text-[#557d78]">{PRIORITY_LABEL[p]}</th>)}</tr></thead>
        <tbody>{(Object.keys(T_LABEL) as (keyof Thresholds)[]).map((k) => <tr key={k}>
          <td className="p-1 text-xs">{T_LABEL[k]}</td>
          {(["high", "normal", "low"] as const).map((p) => <td key={p} className="p-1"><input type="number" min={1} value={settings.thresholds[p][k]} onChange={(e) => setT(p, k, Number(e.target.value))} className={`${field} w-24 text-center`} aria-label={`${T_LABEL[k]} — ${PRIORITY_LABEL[p]}`} /></td>)}
        </tr>)}</tbody>
      </table></div>
      <label className="mt-3 block text-xs">الإجازات العامة (تاريخ في كل سطر، مثل 2026-12-02)
        <textarea value={holidays} onChange={(e) => setHolidays(e.target.value)} rows={3} dir="ltr" className={`${field} mt-1 block w-full max-w-xs`} />
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.on} onChange={(e) => setSettings({ ...settings, on: e.target.checked })} /> الإشراف يعمل</label>
      <p className="mt-1 text-xs text-[#8ba09b]">مدد خاصة لقسم بعينه (فريق Teletel) تُحفظ في الإعداد نفسه وتعلو على هذه.</p>
      <button type="button" disabled={busy} onClick={() => void saveSettings()} className="mt-3 rounded-lg bg-[var(--tv-brand)] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : "احفظ الإعدادات"}</button>
    </section>
    {msg && <p role="status" className="text-sm text-[#185045]">{msg}</p>}
  </div>;
}
