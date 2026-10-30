"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { previewAutoclose, saveAutoclose, saveLatenessExempt, saveTravellersClose, type ConversationsAdmin as Data } from "@/lib/data/conversation-settings";
import type { LatenessExempt } from "@/lib/leads/lateness";
import { durationText } from "@/lib/leads/lifecycle-rules";
import { TraveliunShell } from "../TraveliunShell";

/**
 * «الإدارة ← إدارة المحادثات» (the user, 2026-10-22): the system's closing of
 * Teletel conversations nobody answers, and the closings themselves — who
 * closed each one and where it went when the client wrote again.
 */
const FIELD = "h-9 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]";
const CARD = "rounded-[14px] border border-[#cfe0d9] bg-white p-4";
const H = "text-[14px] font-extrabold text-[#0f3d38]";
const BTN = "inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-bold disabled:opacity-50";

const WHO = { employee: "موظف", system: "النظام", murad: "مُراد" } as const;
const BACK = { returned_to_employee: "عادت للموظف الذي أغلقها", returned_to_file_owner: "عادت لصاحب الرحلة", unassigned: "عادت طلباً جديداً", kept: "فتحها موظف" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export function ConversationsAdmin({ initial }: { initial: Data }) {
  const router = useRouter();
  const [unit, setUnit] = useState<"day" | "hour">(initial.hours && initial.hours % 24 ? "hour" : "day");
  const [amount, setAmount] = useState(initial.hours ? (initial.hours % 24 ? initial.hours : initial.hours / 24) : 7);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ close: number; waiting: number; open: number } | null>(null);
  const hours = Math.round(amount * (unit === "day" ? 24 : 1));
  const [exempt, setExempt] = useState<LatenessExempt>(initial.exempt);
  const toggle = <K extends keyof LatenessExempt>(k: K, v: LatenessExempt[K][number]) =>
    setExempt((x) => ({ ...x, [k]: (x[k] as (typeof v)[]).includes(v) ? (x[k] as (typeof v)[]).filter((y) => y !== v) : [...(x[k] as (typeof v)[]), v] }));
  const saveExempt = async () => {
    setBusy("exempt");
    setMsg(null);
    const r = await saveLatenessExempt(exempt);
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: "حُفظ — لا يُحسب عليهم تأخير من الآن" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  };

  const check = async () => {
    setBusy("preview");
    setMsg(null);
    const r = await previewAutoclose(hours);
    setBusy(null);
    if (r.ok) setPreview(r);
    else setMsg({ ok: false, text: r.error });
  };
  const save = async (next: number | null) => {
    setBusy(next ? "save" : "off");
    setMsg(null);
    const r = await saveAutoclose(next);
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: next ? `حُفظ — يبدأ الإغلاق خلال 5 دقائق: بعد ${durationText(next)} بلا رد` : "أُوقف الإغلاق التلقائي" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  };
  const toggleTravellers = async (on: boolean) => {
    setBusy("travellers");
    setMsg(null);
    const r = await saveTravellersClose(on);
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: on ? "شُغّل تصنيف المسافرين" : "أُوقف تصنيف المسافرين" } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  };

  return (
    <TraveliunShell title="nav.conversations">
      <div className="space-y-4">
        {msg ? <div className={`rounded-[10px] px-3 py-2 text-[12.5px] font-bold ${msg.ok ? "bg-[#e8f6ef] text-[#185045]" : "bg-[#fdecef] text-[#a3263f]"}`}>{msg.text}</div> : null}

        <section className={CARD}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className={H}>الإغلاق التلقائي للمحادثات</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${initial.hours ? "bg-[#e8f6ef] text-[#185045]" : "bg-[#f2f4f3] text-[#557d78]"}`}>
              {initial.hours ? `يعمل: بعد ${durationText(initial.hours)} بلا رد` : "متوقف"}
            </span>
          </div>
          <p className="mb-3 text-[12.5px] leading-6 text-[#335f59]">
            يغلق النظام المحادثة في تيلي تيل إذا مرّت هذه المدة دون أي رسالة وكانت آخر رسالة منّا. لا يُغلق أبداً عميلاً ينتظر رداً، ولا محادثة عميل اشترى منّا وهي مع موظف. إذا كتب العميل بعد ذلك تعود طلباً جديداً غير مسند ويستقبلها الاستقبال كأي طلب جديد. كل محادثة يغلقها تُسجّل هنا مع موظفها.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
              المدة بلا رد
              <input type="number" min={1} max={unit === "day" ? 90 : 2160} value={amount} onChange={(e) => { setAmount(Number(e.target.value)); setPreview(null); }} className={`${FIELD} w-24`} />
            </label>
            <select value={unit} onChange={(e) => { setUnit(e.target.value as "day" | "hour"); setPreview(null); }} className={FIELD} aria-label="الوحدة">
              <option value="day">أيام</option>
              <option value="hour">ساعات</option>
            </select>
            <button type="button" onClick={check} disabled={busy !== null} className={`${BTN} border border-[#cfe0d9] bg-white text-[#185045]`}>
              {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : null} احسب كم سيُغلق
            </button>
            <button type="button" onClick={() => save(hours)} disabled={busy !== null} className={`${BTN} bg-[#2aa87a] text-white`}>
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} حفظ وتشغيل
            </button>
            {initial.hours ? (
              <button type="button" onClick={() => save(null)} disabled={busy !== null} className={`${BTN} border border-[#f1c5ce] bg-white text-[#a3263f]`}>
                {busy === "off" ? <Loader2 className="size-4 animate-spin" /> : null} إيقاف
              </button>
            ) : null}
          </div>
          {preview ? (
            <p className="mt-3 rounded-[10px] bg-[#f4f8f6] px-3 py-2 text-[12.5px] leading-6 text-[#185045]">
              من {preview.open} محادثة مفتوحة الآن سيُغلق <b>{preview.close}</b> (حتى 20 كل 5 دقائق)، ولن يُمس <b>{preview.waiting}</b> عميلاً ينتظر رداً.
            </p>
          ) : null}
        </section>

        <section className={CARD}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className={H}>مؤكد — مسافر قريباً</h2>
            <button type="button" onClick={() => toggleTravellers(!initial.travellers)} disabled={busy !== null} className={`${BTN} ${initial.travellers ? "border border-[#f1c5ce] bg-white text-[#a3263f]" : "bg-[#2aa87a] text-white"}`}>
              {busy === "travellers" ? <Loader2 className="size-4 animate-spin" /> : null} {initial.travellers ? "إيقاف" : "تشغيل"}
            </button>
          </div>
          <p className="text-[12.5px] leading-6 text-[#335f59]">
            {initial.travellers ? "يعمل: " : "متوقف: "}
            محادثة العميل الذي له رحلة مؤكدة — ملف عمليات أو مُدخل في «المؤكدون خارج النظام» — تُغلق بتصنيف «مسافر-قريبا» بعد ساعة من آخر رسالة منّا، فقط إذا لم تكن مع موظف (ولا تُغلق إذا كان العميل ينتظر رداً). إذا كتب العميل حتى ثلاثة أيام بعد عودته تذهب مباشرة لصاحب الرحلة وليس كطلب جديد، وبعدها القواعد العادية. الربط برقم الجوال؛ من ليس له رحلة مسجلة يتبع القواعد العادية.
          </p>
        </section>

        <section className={CARD}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className={H}>لا يُحسب عليهم تأخير</h2>
            <button type="button" onClick={saveExempt} disabled={busy !== null} className={`${BTN} bg-[#2aa87a] text-white`}>
              {busy === "exempt" ? <Loader2 className="size-4 animate-spin" /> : null} حفظ
            </button>
          </div>
          <p className="mb-3 text-[12.5px] leading-6 text-[#335f59]">
            من تختاره هنا لا يُحسب عليه أي تأخير في الشاشات والتقارير والتذكيرات والأداء، ولا يسحب مُراد محادثاته بسبب التأخير — النظام مساعد له. القسم يشمل كل موظفيه، وفريق تيلي تيل يشمل محادثاته.
          </p>
          {(
            [
              ["employees", "الموظفون", initial.choices.employees],
              ["roles", "الأقسام", initial.choices.roles],
              ["teams", "فرق تيلي تيل", initial.choices.teams],
            ] as const
          ).map(([k, label, list]) => (
            <div key={k} className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="w-24 text-[11.5px] font-bold text-[#185045]">{label}</span>
              {list.map((o) => {
                const on = (exempt[k] as (string | number)[]).includes(o.id);
                return (
                  <button key={o.id} type="button" aria-pressed={on} onClick={() => toggle(k, o.id as never)} className={`h-7 rounded-full border px-2.5 text-[11.5px] font-bold max-sm:min-h-10 ${on ? "border-[#2aa87a] bg-[#e8f6ef] text-[#185045]" : "border-[#dbe6e1] bg-white text-[#557d78]"}`}>
                    {o.name}
                  </button>
                );
              })}
            </div>
          ))}
        </section>

        <section className={CARD}>
          <h2 className={`${H} mb-2`}>إغلاق الموظف</h2>
          <p className="text-[12.5px] leading-6 text-[#335f59]">
            المحادثة التي يغلقها الموظف في تيلي تيل تعود إليه هو إذا كتب العميل مرة أخرى، ولا تُعامل كطلب جديد ولا يتدخل فيها مُراد. ومحادثة عميل اشترى منّا (رحلة مؤكدة أو «خدمة مكتملة» في تيلي تيل) لا يغلقها النظام ولا يرفع إسنادها ولا ينقلها مُراد ما دامت مع موظف.
          </p>
        </section>

        <section className={CARD}>
          <h2 className={`${H} mb-3`}>آخر الإغلاقات</h2>
          {initial.closures.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-right text-[12.5px]">
                <thead className="text-[11.5px] text-[#557d78]">
                  <tr>
                    <th className="py-1.5 font-bold">المحادثة</th>
                    <th className="font-bold">أغلقها</th>
                    <th className="font-bold">متى</th>
                    <th className="font-bold">السبب</th>
                    <th className="font-bold">عند عودة العميل</th>
                  </tr>
                </thead>
                <tbody>
                  {initial.closures.map((c) => (
                    <tr key={`${c.conversation_id}-${c.closed_at}`} className="border-t border-[#eef3f1] text-[#0f3d38]">
                      <td className="py-1.5">
                        {initial.teletelBase ? (
                          <a href={`${initial.teletelBase}/${c.conversation_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1f7f5c] hover:underline">
                            #{c.conversation_id} <ExternalLink className="size-3" />
                          </a>
                        ) : `#${c.conversation_id}`}
                      </td>
                      <td>{c.closed_by_name ?? WHO[c.closed_by_kind]}{c.closed_by_name ? <span className="text-[#557d78]"> · {WHO[c.closed_by_kind]}</span> : null}</td>
                      <td dir="ltr" className="text-right">{when(c.closed_at)}</td>
                      <td className="text-[#335f59]">{c.reason ?? "—"}</td>
                      <td>{c.reopen_action ? `${BACK[c.reopen_action]}${c.reopened_at ? ` (${when(c.reopened_at)})` : ""}` : "لم يكتب بعد"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12.5px] text-[#557d78]">لا إغلاقات مسجّلة بعد — تُسجّل من الآن كل محادثة تُغلق في تيلي تيل.</p>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
