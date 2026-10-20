"use client";

import { useEffect, useState } from "react";
import { getFollowupCount, transferClientToFollowup } from "@/lib/data/followups";

export function FollowupBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => getFollowupCount().then((value) => { if (active) setCount(value); }).catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return count ? <span title="متابعات تحتاج إجراء: غير مسندة أو حان موعدها" className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">{count}</span> : null;
}

export function TransferToFollowup({ conversationId }: { conversationId: number }) {
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function transfer() {
    setBusy(true);
    try {
      const result = await transferClientToFollowup(conversationId, reason);
      setNotice(result.ok ? "أضيف العميل إلى قائمة المتابعة." : "تعذر التحويل. تحقق من الصلاحية واتصال Teletel.");
    } catch { setNotice("تعذر تأكيد التحويل. أعد المحاولة؛ لن يُنشأ ملف مكرر."); }
    finally { setBusy(false); }
  }
  return <div className="mb-3 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
    <label className="block text-xs font-bold text-emerald-950">تحويل لفريق المتابعة
      <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-lg border border-emerald-200 bg-white p-2 text-sm" placeholder="سبب التحويل وما المطلوب من الفريق" />
    </label>
    <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void transfer()} className="rounded-lg bg-emerald-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">تحويل إلى المتابعة</button>
    {notice && <p role="status" className="text-xs text-emerald-950">{notice}</p>}
  </div>;
}
