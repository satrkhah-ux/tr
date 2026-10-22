"use client";

import { useEffect, useState } from "react";
import { getFollowupSettings, saveFollowupMapping, saveFollowupTeam } from "@/lib/data/followups";
import type { WorkResult } from "@/lib/followups/rules";
const input = "w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900";
const errors: Record<string,string> = { failed: "تعذر حفظ إعدادات الفريق.", forbidden: "تحتاج صلاحية إدارة الموظفين والأقسام.", invalid: "اختر موظفًا مخولًا وحسابًا صحيحًا من القائمة." };

export function FollowupTeamSettings() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getFollowupSettings>>>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void getFollowupSettings().then((v) => { if (live) setData(v); }).catch(() => { if (live) setNotice(errors.failed); }); return () => { live = false; }; }, []);
  async function save(work: () => Promise<WorkResult>) {
    setBusy(true);
    try { const r = await work(); setNotice(r.ok ? "تم الحفظ." : errors[r.error] ?? r.error); if (r.ok) setData(await getFollowupSettings()); }
    catch { setNotice(errors.failed); } finally { setBusy(false); }
  }
  if (!data) return <p>{notice || "تحميل إعدادات الفريق…"}</p>;
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-extrabold">ربط فريق المتابعة</h2><p className="text-sm text-slate-500">حدد أعضاء الفريق من جدول الموظفين أعلاه، واختر لهم دور «موظف المتابعة» أو «مشرف المتابعة». ربط الحسابات هنا يعتمد على معرّفاتها، ولا يمنح صلاحيات إضافية.</p>
    <label className="block max-w-md text-sm">فريق Teletel الذي يستقبل التحويلات<select disabled={busy} className={input} value={data.teamId} onChange={(e) => void save(() => saveFollowupTeam(Number(e.target.value)))}>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <h3 className="font-bold">ربط موظفي Teletel بموظفي النظام</h3><p className="text-xs text-slate-500">الحساب غير المربوط يدخل قائمة «غير مسند» حتى يستلمه الفريق أو يسنده المشرف.</p>
    <div className="grid gap-3 md:grid-cols-2">{data.agents.map((a) => <label key={a.id} className="rounded-xl border border-slate-100 p-3 text-sm">{a.name} <span className="text-xs text-slate-400">#{a.id}</span><select disabled={busy} className={`${input} mt-2`} value={data.mappings.find((m) => m.agent_id === a.id)?.employee_id ?? ""} onChange={(e) => void save(() => saveFollowupMapping(a.id, e.target.value || null))}><option value="">غير مربوط</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}</div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
