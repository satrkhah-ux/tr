"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { whenText } from "@/lib/developer/health";
import { setReceptionScope } from "@/lib/data/app-settings";

/**
 * «المستقبل الآلي» on /developer: on or off is its switch in «خدمات النظام»;
 * here its scope (the owner's two test numbers, or everyone — the owner's
 * call), today's count, the latest turns, and the webhook URL to put in
 * Teletel (Settings → Integrations → Webhooks, event «Message created»).
 */

export type ReceptionPanelData = {
  on: boolean;
  scope: "test" | "all";
  webhookUrl: string | null;
  today: { routed: number; asked: number; other: number; recent: { at: string; phone: string; reason: string; reply: string }[] };
};

const REASON: Record<string, string> = { asked: "سؤال توضيح", send_failed: "تعذّر الإرسال", unreadable: "تعذّرت القراءة", error: "خطأ" };
const reasonText = (r: string) =>
  r.startsWith("routed:") ? `حُوّل — ${r.slice(7)}` : r.startsWith("none:") ? { "none:routed": "حُوّل سابقاً", "none:staff": "ردّ موظف", "none:window": "خارج 24 ساعة" }[r] ?? r : REASON[r] ?? r;

export function ReceptionPanel({ data }: { data: ReceptionPanelData }) {
  const router = useRouter();
  const [scope, setScope] = useState(data.scope);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function change(next: "test" | "all") {
    if (next === "all" && !window.confirm("تشغيل المستقبل الآلي على كل العملاء؟ سيُرسل الترحيب لكل محادثة جديدة.")) return;
    setBusy(true);
    const res = await setReceptionScope(next).catch(() => ({ ok: false }));
    setBusy(false);
    if (res.ok) {
      setScope(next);
      router.refresh();
    }
  }

  return (
    <section className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
      <h2 className="text-[14px] font-extrabold text-[#185045]">مُراد — المستقبل الآلي</h2>
      <p className="mt-1 text-[12px] font-semibold text-[#93aaa3]">
        يرحّب بالعميل الجديد باسمه ويحوّله إلى قسمه في Teletel لحظة وصول رسالته. جدول الأقسام والدوام في «رسائل العميل». {data.on ? "" : "متوقف الآن من «خدمات النظام»."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#557d78]">
        <span>النطاق:</span>
        {(["test", "all"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy || scope === k}
            onClick={() => void change(k)}
            className={`h-8 rounded-full px-3 text-[12px] font-bold ${scope === k ? "bg-[#185045] text-white" : "border border-[#dbe6e1] text-[#185045] hover:bg-[#f4f8f6]"}`}
          >
            {k === "test" ? "رقما التجربة فقط" : "كل العملاء"}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[12.5px] font-extrabold text-[#0f3d38]">
        اليوم: حُوّلت {data.today.routed} · سؤال توضيح {data.today.asked} · لم يُتدخّل {data.today.other}
      </p>
      {data.today.recent.length ? (
        <ul className="mt-1.5 grid gap-1 text-[11.5px] font-semibold text-[#557d78]">
          {data.today.recent.map((r, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="tv-tnum">{whenText(r.at, true)}</span>
              <span dir="ltr">{r.phone}</span>
              <span className="font-bold text-[#185045]">{reasonText(r.reason)}</span>
              {r.reply ? <span className="truncate text-[#93aaa3]">«{r.reply}»</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 border-t border-dashed border-[#dce7e2] pt-3">
        <p className="text-[12px] font-extrabold text-[#557d78]">رابط الـWebhook في Teletel (الإعدادات ← التكاملات ← Webhooks، الحدث «Message created»):</p>
        {data.webhookUrl ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code dir="ltr" className="max-w-full break-all rounded-[8px] bg-[#f6faf8] px-2 py-1 text-[11px] text-[#185045]">
              {data.webhookUrl}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(data.webhookUrl ?? "");
                setCopied(true);
              }}
              className="h-7 rounded-[8px] border border-[#dbe6e1] px-2 text-[11.5px] font-bold text-[#185045]"
            >
              {copied ? "نُسخ" : "نسخ"}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-[12px] font-bold text-[#c22850]">ADMIN_API_SECRET غير مضبوط على الخادم — لا رابط.</p>
        )}
        <p className="mt-1 text-[11px] font-semibold text-[#93aaa3]">بدونه يعمل احتياطاً من مهمة الدقيقة (حتى دقيقة تأخير).</p>
      </div>
    </section>
  );
}
