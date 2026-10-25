"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { adminSecretaryView, type AdminSecretaryView, type SecretaryMsg } from "@/lib/secretary/chat";

/**
 * «مشاهدة الإدارة» (the owner, 2026-10-26): pick an employee, see their
 * secretary for real — day plan, tasks, thread — read-only. No input exists
 * here on purpose: the administration never writes in an employee's name.
 */
export function AdminSecretaryViewer({ employees }: { employees: { id: string; name: string }[] }) {
  const [picked, setPicked] = useState("");
  const [view, setView] = useState<(AdminSecretaryView & { ok: true }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open(id: string) {
    setPicked(id);
    setView(null);
    setError("");
    if (!id) return;
    setBusy(true);
    try {
      const r = await adminSecretaryView(id);
      if (r.ok) setView(r);
      else setError(r.error);
    } catch { setError("تعذّر الاتصال."); } finally { setBusy(false); }
  }

  const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" });
  const who = (m: SecretaryMsg) => (m.role === "user" ? "الموظف" : m.role === "plan" ? "🗂 خطة اليوم" : "السكرتير");

  return <section className="rounded-2xl border border-[#dfe8e4] bg-white p-4">
    <div className="mb-1 flex items-center gap-2">
      <Eye className="size-4 text-[#557d78]" />
      <h2 className="font-bold">مشاهدة الإدارة — سكرتير موظف</h2>
    </div>
    <p className="mb-3 text-sm text-[#5b7a71]">قراءة فقط: ترى يومه ومحادثته مع سكرتيره كما هي، ولا يمكنك الكتابة باسمه. كل فتح يُسجَّل.</p>
    <select value={picked} onChange={(e) => void open(e.target.value)} disabled={busy}
      className="w-full max-w-sm rounded-lg border border-[#dbe6e1] bg-white p-2.5 text-sm">
      <option value="">اختر موظفاً…</option>
      {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
    </select>
    {busy && <p className="mt-3 flex items-center gap-2 text-sm text-[#557d78]"><Loader2 className="size-4 animate-spin" /> يقرأ بياناته…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {view && <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
        <p className="mb-1 text-xs font-bold text-[#8a5a00]">يوم {view.name} الآن</p>
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#5a4300]">{view.today}</p>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold text-[#557d78]">محادثته مع سكرتيره ({view.messages.length})</p>
        {!view.messages.length && <p className="text-sm text-[#5b7a71]">لا رسائل بعد.</p>}
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {view.messages.map((m) => <div key={m.id} className={`rounded-xl border p-3 text-sm leading-7 ${m.role === "user" ? "border-[#cfe0db] bg-[#f4f8f6]" : m.role === "plan" ? "border-amber-200 bg-amber-50" : "border-[#e7eceb] bg-white"}`}>
            <p className="mb-1 text-[10px] font-bold text-[#8ba09b]">{who(m)} · {when(m.created_at)}</p>
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
          </div>)}
        </div>
      </div>
    </div>}
  </section>;
}
