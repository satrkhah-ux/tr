"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setFinancePassword, unlockFinance } from "@/lib/data/finance";

/** The finance password's door — «الحسابات المالية» and «الحسابات» share it: the owner sets it once, then it is typed when the unlock has run out */
export function FinanceLock({ mode, title = "الحسابات المالية" }: { mode: "set" | "ask"; title?: string }) {
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
  return <form dir="rtl" onSubmit={(e) => void submit(e)} className="tv-card mx-auto mt-10 max-w-sm space-y-3 rounded-2xl border p-6 text-tv-text-strong">
    <h1 className="text-xl font-extrabold text-tv-text-brand">{title}</h1>
    <p className="text-sm text-tv-text-muted">{mode === "set"
      ? "ضع كلمة سر للقسم المالي. تُطلب بعد 30 دقيقة بلا استخدام، ولا يمكن تغييرها من هنا."
      : "أدخل كلمة سر القسم المالي. تبقى مفتوحة ما دمت تعمل، وتُقفل بعد 30 دقيقة بلا استخدام."}</p>
    <input type="password" autoFocus autoComplete={mode === "set" ? "new-password" : "current-password"} aria-label="كلمة السر" placeholder="كلمة السر"
      value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
    {mode === "set" && <input type="password" autoComplete="new-password" aria-label="أعد كلمة السر" placeholder="أعد كلمة السر"
      value={again} onChange={(e) => setAgain(e.target.value)} className={field} />}
    {error && <p role="alert" className="text-sm text-tv-status-danger">{error}</p>}
    <button type="submit" disabled={busy || !password} className="tv-btn-primary min-h-10 w-full rounded-lg text-sm font-bold disabled:opacity-40">
      {busy ? "لحظة…" : mode === "set" ? "احفظ كلمة السر وافتح" : "افتح"}
    </button>
  </form>;
}
