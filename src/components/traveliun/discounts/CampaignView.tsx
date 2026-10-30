"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowRight, ExternalLink, Send, Square } from "lucide-react";
import { sendBatch, setExcluded } from "@/lib/data/discounts-actions";
import { couponState, discountLabel, lastNine } from "@/lib/discounts/rules";
import type { Campaign, Coupon } from "@/lib/data/discounts";
import { card, field } from "./Campaigns";

/**
 * One campaign: the message as the client reads it, «أرسل» (one first to try, then the rest in batches
 * the screen keeps calling until done or «أوقف»), and every coupon — sent, opened, used, by whom.
 */

const STATE = { valid: "ساري", used: "مستخدم", expired: "منتهي" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" });

export function CampaignView({ campaign, coupons, names, preview }: { campaign: Campaign; coupons: Coupon[]; names: Record<string, string>; preview: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const [pending, start] = useTransition();

  const live = coupons.filter((c) => !c.excluded);
  const sent = live.filter((c) => c.sent_at).length;
  const left = live.length - sent;
  const opened = live.filter((c) => c.opened_at).length;
  const used = live.filter((c) => c.redeemed_at).length;

  const send = async (all: boolean) => {
    if (!all && !window.confirm("إرسال الكوبون لعميل واحد للتجربة؟")) return;
    if (all && !window.confirm(`إرسال الكوبونات إلى ${left} عميل على واتساب؟`)) return;
    stop.current = false;
    setRunning(true);
    let total = 0;
    let failed = 0;
    for (;;) {
      const r = await sendBatch(campaign.id, all ? 20 : 1);
      if (!r.ok) {
        setLog(r.error);
        break;
      }
      total += r.sent;
      failed += r.failed;
      setLog(`أُرسل ${total}${failed ? ` · تعذّر ${failed} (آخر سبب: ${r.last})` : ""} · المتبقي ${r.left}`);
      if (!all || r.left === 0 || stop.current || r.sent + r.failed === 0) break;
      if (r.sent === 0 && r.failed > 0 && failed >= 20) break;
    }
    setRunning(false);
    router.refresh();
  };

  const toggle = (c: Coupon) => start(async () => {
    const r = await setExcluded(c.id, !c.excluded);
    if (!r.ok) setLog(r.error);
    router.refresh();
  });

  const needle = q.trim();
  const shown = needle
    ? coupons.filter((c) => (c.client_name ?? "").includes(needle) || c.code.includes(needle.toUpperCase()) || (lastNine(needle).length >= 4 && lastNine(c.phone).includes(lastNine(needle))))
    : coupons;
  const sample = live[0];

  return (
    <div dir="rtl" className="tv-fade-up mx-auto max-w-5xl space-y-4">
      <Link href="/discounts" className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-tv-border-default bg-tv-surface-raised px-3 text-[12.5px] font-bold text-tv-text-muted">
        <ArrowRight className="size-4" />الخصومات
      </Link>

      <section className={card}>
        <h1 className="text-lg font-extrabold text-tv-text-strong">{campaign.title}</h1>
        <p className="mt-1 text-[13px] font-semibold text-tv-text-faint">
          خصم {discountLabel(campaign.kind, campaign.value)} · {campaign.applies_to === "package" ? "على طلب باقة فقط" : "على أي طلب"} · صالح {campaign.valid_days} يوماً من وصوله
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[["الكوبونات", live.length], ["أُرسل", sent], ["لم يُرسل", left], ["فتح الكوبون", opened], ["استُخدم", used]].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-tv-surface-sunken px-3 py-2">
              <dt className="text-[11.5px] font-bold text-tv-text-faint">{k}</dt>
              <dd className="text-xl font-extrabold text-tv-text-strong tabular-nums">{Number(v).toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-[15px] font-extrabold text-tv-text-strong">الرسالة كما تصل العميل</h2>
        {preview && <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-tv-surface-sunken p-3 font-sans text-[13px] leading-7 text-tv-text-strong">{preview}</pre>}
        {sample && (
          <a href={`/coupon/${sample.token}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-bold text-tv-text-brand underline">
            <ExternalLink className="size-4" />شاهد كوبون «{sample.client_name ?? "عميل"}» كما يراه
          </a>
        )}
        <p className="mt-3 text-[12px] font-semibold text-tv-text-faint">
          الإرسال على واتساب عبر تيلي تيل بالقالب المعتمد «traveliun_coupon_card»: صورة الكوبون بالعرض أعلى الرسالة ثم النص والرابط. كل كوبون يُرسل مرة واحدة، ورد العميل يصل لمحادثته كالمعتاد.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={running || left === 0} onClick={() => void send(false)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-tv-action-primary px-5 text-[13px] font-extrabold text-tv-text-brand disabled:opacity-50">
            <Send className="size-4" />أرسل لعميل واحد (تجربة)
          </button>
          <button type="button" disabled={running || left === 0} onClick={() => void send(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-tv-action-primary px-5 text-[13px] font-extrabold text-tv-action-on-primary disabled:opacity-50">
            <Send className="size-4" />أرسل للجميع ({left.toLocaleString("en-US")})
          </button>
          {running && (
            <button type="button" onClick={() => { stop.current = true; }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-tv-status-danger px-5 text-[13px] font-extrabold text-tv-status-danger">
              <Square className="size-4" />أوقف
            </button>
          )}
        </div>
        {log && <p role="status" className="mt-2 text-[13px] font-bold text-tv-text-muted">{running ? "جارٍ الإرسال… " : ""}{log}</p>}
      </section>

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-extrabold text-tv-text-strong">العملاء ({coupons.length.toLocaleString("en-US")})</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم أو الكود" className={`${field} max-w-xs`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="text-start text-tv-text-faint">
                {["العميل", "الجوال", "الكود", "الإرسال", "فُتح", "الحالة", ""].map((h) => <th key={h} className="px-2 py-1.5 text-start font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-tv-border-default">
              {shown.slice(0, 300).map((c) => {
                const state = couponState(c);
                return (
                  <tr key={c.id} className={c.excluded ? "opacity-45" : ""}>
                    <td className="px-2 py-1.5 font-bold text-tv-text-strong">{c.client_name ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums" dir="ltr">{c.phone}</td>
                    <td className="px-2 py-1.5 font-mono" dir="ltr">{c.code}</td>
                    <td className="px-2 py-1.5">{c.sent_at ? day(c.sent_at) : c.send_result ?? "لم يُرسل"}</td>
                    <td className="px-2 py-1.5">{c.opened_at ? day(c.opened_at) : "—"}</td>
                    <td className="px-2 py-1.5">
                      {c.redeemed_at ? (
                        <span className="font-bold text-tv-text-brand">مستخدم {day(c.redeemed_at)} · {names[c.redeemed_by ?? ""] ?? ""} · {c.redeemed_ref}</span>
                      ) : c.sent_at ? STATE[state] : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {!c.sent_at && (
                        <button type="button" disabled={pending || running} onClick={() => toggle(c)} className="text-[12px] font-bold text-tv-text-brand underline disabled:opacity-50">
                          {c.excluded ? "أعده" : "استبعد"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length > 300 && <p className="mt-2 text-[12px] text-tv-text-faint">يظهر أول 300 — ابحث لتجد عميلاً بعينه.</p>}
        </div>
      </section>
    </div>
  );
}
