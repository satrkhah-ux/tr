"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setFinancePassword, unlockFinance } from "@/lib/data/finance";

/** «الحسابات المالية»'s door: the first visit sets the password, later visits type it once a session */
export function FinanceLock({ mode }: { mode: "set" | "ask" }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "set" && password !== again) { setError("كلمتا السر غير متطابقتين."); return; }
    setBusy(true); setError("");
    try {
      const r = mode === "set" ? await setFinancePassword(password) : await unlockFinance(password);
      if (r.ok) router.refresh(); else setError(r.error ?? "تعذّر.");
    } catch { setError("تعذّر الاتصال."); } finally { setBusy(false); }
  }

  const field = "tv-field w-full rounded-lg border px-3 py-2 text-base";
  return <form dir="rtl" onSubmit={(e) => void submit(e)} className="mx-auto mt-10 max-w-sm space-y-3 rounded-2xl border border-[#dbe6e1] bg-white p-6 text-[#10231f]">
    <h1 className="text-xl font-extrabold text-[#185045]">الحسابات المالية</h1>
    <p className="text-sm text-[#5b6b66]">{mode === "set"
      ? "ضع كلمة سر للقسم المالي. ستُطلب مرة واحدة في كل جلسة، ولا يمكن تغييرها من هنا."
      : "أدخل كلمة سر القسم المالي."}</p>
    <input type="password" autoFocus autoComplete={mode === "set" ? "new-password" : "current-password"} aria-label="كلمة السر" placeholder="كلمة السر"
      value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
    {mode === "set" && <input type="password" autoComplete="new-password" aria-label="أعد كلمة السر" placeholder="أعد كلمة السر"
      value={again} onChange={(e) => setAgain(e.target.value)} className={field} />}
    {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
    <button type="submit" disabled={busy || !password} className="tv-btn-primary min-h-10 w-full rounded-lg text-sm font-bold disabled:opacity-40">
      {busy ? "لحظة…" : mode === "set" ? "احفظ كلمة السر وافتح" : "افتح"}
    </button>
  </form>;
}
