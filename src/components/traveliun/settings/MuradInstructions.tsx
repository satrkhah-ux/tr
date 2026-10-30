"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { instructMurad, setLessonActive, type InstructionRow, type LessonRow } from "@/lib/data/murad-control";
import { TOPICS, type Knowledge } from "@/lib/murad/knowledge-topics";

const field = "w-full min-w-0 rounded-xl border border-[#dbe6e1] bg-white p-3 text-sm text-[#185045] dark:border-[#294039] dark:bg-[#12241f] dark:text-[#eaf3ef]";
const STATUS: Record<string, string> = { applied: "نُفّذ", not_understood: "لم يُفهم", undone: "تُراجع عنه", failed: "تعذّر" };
const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** «تعليمات الإدارة لمُراد» (the owner, 2026-10-24): an order or a lesson in words, done at once, said back, undoable. */
export function MuradInstructions({ data }: { data: { instructions: InstructionRow[]; lessons: LessonRow[]; learned: number; read: number; left: number; knowledge: Knowledge } }) {
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
  return <section dir="rtl" className="min-w-0 space-y-5 rounded-2xl border border-[#dbe6e1] bg-white p-4 text-[#185045] sm:p-6 dark:border-[#294039] dark:bg-[#12241f] dark:text-[#eaf3ef]">
    <div><h2 className="text-xl font-extrabold">تعليمات الإدارة لمُراد</h2>
      <p className="mt-2 text-sm leading-6 text-tv-text-faint dark:text-[#9db8ae]">اكتب قراراً أو معلومة يعتمدها مُراد. تُطبّق عند الضغط على «نفّذ»، ويظهر لك ما تغيّر.</p></div>
    <textarea aria-label="تعليمات الإدارة لمُراد" rows={3} maxLength={2000} className={field} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب التعليمات هنا…" disabled={busy} />
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || !text.trim()} onClick={() => send(text)} className="rounded-lg bg-[#185045] px-6 py-3 font-bold text-white disabled:opacity-50">{busy ? "مُراد يقرأ…" : "نفّذ"}</button>
      <button disabled={busy} onClick={() => send("تراجع")} className="rounded-lg border border-[#185045] px-5 py-3 font-bold">تراجع عن آخر قرار</button>
    </div>
    {reply ? <p role="status" className={`whitespace-pre-line rounded-xl p-4 text-sm font-bold ${reply.ok ? "bg-[#e5f4e4]" : "bg-[#fdf3e2] text-[#8a5a00]"}`}>{reply.text}</p> : null}

    <details className="space-y-3 border-t border-[#e2ebe7] pt-4"><summary className="cursor-pointer font-bold">آخر التعليمات ({data.instructions.length})</summary>
      {data.instructions.length ? <ul className="divide-y divide-[#e7efeb] rounded-xl border border-[#dbe6e1]">{data.instructions.map((i) => <li key={i.id} className="space-y-1 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#5c7d75]"><span>{when(i.created_at)}</span><span>{i.source === "whatsapp" ? "واتساب" : "الصفحة"}</span><span className="rounded-full bg-[#f0f7f4] px-2 py-0.5 font-bold">{STATUS[i.status] ?? i.status}</span></div>
        <p className="font-bold">{i.text}</p>
        {i.reply ? <p className="whitespace-pre-line text-[#3d6158]">{i.reply}</p> : null}
      </li>)}</ul> : <p className="text-sm">لا تعليمات بعد.</p>}
    </details>

    <details className="space-y-3 border-t border-[#e2ebe7] pt-4"><summary className="cursor-pointer font-bold">ذاكرة مُراد ({Object.keys(data.knowledge.topics).length} موضوع)</summary>
      <p className="text-sm">ما تعلّمه من محادثات فريقكم، مدموجاً حسب الموضوع بلا تكرار ولا أسعار قديمة — يُحدَّث وحده كلما تجمّعت دروس جديدة. السياسات وقائمة التأشيرات وتعليم الإدارة أولى منه دائماً.</p>
      {Object.keys(data.knowledge.topics).length ? <div className="space-y-2">{(Object.keys(TOPICS) as (keyof typeof TOPICS)[]).filter((t) => data.knowledge.topics[t]).map((t) => { const k = data.knowledge.topics[t]!; return <details key={t} className="rounded-xl border border-[#dbe6e1] p-3 text-sm">
        <summary className="cursor-pointer font-bold">{TOPICS[t]} · {k.items.length} سؤالاً <span className="font-normal text-[#5c7d75]">— {when(k.at)}، من {k.lessons.toLocaleString("en-US")} درساً</span></summary>
        <ul className="mt-2 space-y-2">{k.items.map((i, n) => <li key={n}><p className="font-bold">{i.q}</p><p className="text-[#3d6158]">{i.a}</p></li>)}</ul>
      </details>; })}</div> : <p className="text-sm">تُبنى الذاكرة خلال الساعة الأولى من التعلّم.</p>}
    </details>

    <details className="space-y-3 border-t border-[#e2ebe7] pt-4"><summary className="cursor-pointer font-bold">ما علّمته الإدارة لمُراد ({data.lessons.length})</summary>
      <p className="text-sm">يقرؤها مُراد مع سياسات الشركة وأسئلة التأشيرات في كل رد. أوقف درساً لا تريده. تعلّم أيضاً {data.learned.toLocaleString("en-US")} درساً من {data.read.toLocaleString("en-US")} محادثة قرأها{data.left ? `، وبقي نحو ${data.left.toLocaleString("en-US")}` : ""}.</p>
      {data.lessons.length ? <ul className="space-y-2">{data.lessons.map((l) => <li key={l.id} className={`flex items-start justify-between gap-3 rounded-xl p-3 text-sm ${l.active ? "bg-[#f0f7f4]" : "bg-[#f6f6f4] text-[#8a958f]"}`}>
        <div className="min-w-0 break-words">{l.question ? <p><strong>إذا:</strong> {l.question}</p> : null}<p><strong>يرد:</strong> {l.answer}</p></div>
        <button onClick={() => toggle(l)} className="shrink-0 rounded-lg border px-3 py-1 text-xs font-bold">{l.active ? "إيقاف" : "تشغيل"}</button>
      </li>)}</ul> : <p className="text-sm">لم تُعلّمه شيئاً بعد.</p>}
    </details>
  </section>;
}
