"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { instructMurad, setLessonActive, type InstructionRow, type LessonRow } from "@/lib/data/murad-control";

const field = "w-full rounded-lg border border-[#dbe6e1] bg-white p-3 text-sm text-[#185045]";
const STATUS: Record<string, string> = { applied: "نُفّذ", not_understood: "لم يُفهم", undone: "تُراجع عنه", failed: "تعذّر" };
const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** «تعليمات الإدارة لمُراد» (the owner, 2026-10-24): an order or a lesson in words, done at once, said back, undoable. */
export function MuradInstructions({ data }: { data: { instructions: InstructionRow[]; lessons: LessonRow[]; learned: number; read: number; left: number } }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(order: string) {
    setBusy(true); setReply(null);
    try {
      const r = await instructMurad(order);
      setReply({ ok: r.ok, text: r.reply });
      if (r.ok) { setText(""); router.refresh(); }
    } catch { setReply({ ok: false, text: "تعذّر الاتصال. أعد المحاولة." }); }
    finally { setBusy(false); }
  }
  async function toggle(l: LessonRow) {
    if ((await setLessonActive(l.id, !l.active).catch(() => ({ ok: false }))).ok) router.refresh();
  }
  return <section dir="rtl" className="space-y-5 rounded-2xl border border-[#dbe6e1] bg-white p-6 text-[#185045]">
    <div><h2 className="text-xl font-extrabold">تعليمات الإدارة لمُراد</h2>
      <p className="mt-2 text-sm">اكتب لمُراد قراراً أو درساً بكلامك، فينفّذه فوراً ويقول لك ماذا غيّر. أمثلة: «لا تستلم أي طلب يخص التأشيرات»، «لا تحوّل لفلان»، «إذا لم يرد أحد خلال 15 دقيقة حوّلها لفلان»، «إذا سأل العميل عن التقسيط فقل…»، «تدرب على المحادثة 40317». ويمكن كتابتها أيضاً من أرقام الإدارة على واتساب.</p></div>
    <textarea rows={3} className={field} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب التعليمات هنا…" disabled={busy} />
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || !text.trim()} onClick={() => send(text)} className="rounded-lg bg-[#185045] px-6 py-3 font-bold text-white disabled:opacity-50">{busy ? "مُراد يقرأ…" : "نفّذ"}</button>
      <button disabled={busy} onClick={() => send("تراجع")} className="rounded-lg border border-[#185045] px-5 py-3 font-bold">تراجع عن آخر قرار</button>
    </div>
    {reply ? <p role="status" className={`whitespace-pre-line rounded-xl p-4 text-sm font-bold ${reply.ok ? "bg-[#e5f4e4]" : "bg-[#fdf3e2] text-[#8a5a00]"}`}>{reply.text}</p> : null}

    <div className="space-y-2"><h3 className="font-bold">آخر التعليمات</h3>
      {data.instructions.length ? <ul className="divide-y divide-[#e7efeb] rounded-xl border border-[#dbe6e1]">{data.instructions.map((i) => <li key={i.id} className="space-y-1 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#5c7d75]"><span>{when(i.created_at)}</span><span>{i.source === "whatsapp" ? "واتساب" : "الصفحة"}</span><span className="rounded-full bg-[#f0f7f4] px-2 py-0.5 font-bold">{STATUS[i.status] ?? i.status}</span></div>
        <p className="font-bold">{i.text}</p>
        {i.reply ? <p className="whitespace-pre-line text-[#3d6158]">{i.reply}</p> : null}
      </li>)}</ul> : <p className="text-sm">لا تعليمات بعد.</p>}
    </div>

    <div className="space-y-2"><h3 className="font-bold">ما علّمته الإدارة لمُراد</h3>
      <p className="text-sm">يقرؤها مُراد مع سياسات الشركة وأسئلة التأشيرات في كل رد. أوقف درساً لا تريده. تعلّم أيضاً {data.learned.toLocaleString("en-US")} درساً من {data.read.toLocaleString("en-US")} محادثة قرأها{data.left ? `، وبقي نحو ${data.left.toLocaleString("en-US")}` : ""}.</p>
      {data.lessons.length ? <ul className="space-y-2">{data.lessons.map((l) => <li key={l.id} className={`flex items-start justify-between gap-3 rounded-xl p-3 text-sm ${l.active ? "bg-[#f0f7f4]" : "bg-[#f6f6f4] text-[#8a958f]"}`}>
        <div>{l.question ? <p><strong>إذا:</strong> {l.question}</p> : null}<p><strong>يرد:</strong> {l.answer}</p></div>
        <button onClick={() => toggle(l)} className="shrink-0 rounded-lg border px-3 py-1 text-xs font-bold">{l.active ? "إيقاف" : "تشغيل"}</button>
      </li>)}</ul> : <p className="text-sm">لم تُعلّمه شيئاً بعد.</p>}
    </div>
  </section>;
}
