"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePenLine, Loader2 } from "lucide-react";
import { listEditableFiles, prepareClientEdit, type EditFile, type PrepareResult } from "@/lib/secretary/edit";

/** «نفّذ طلب العميل» (phase ب): pick the conversation, say what the client wants, get a review-ready copy. */
export function SecretaryEditRequest() {
  const [files, setFiles] = useState<EditFile[]>([]);
  const [conversation, setConversation] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrepareResult | null>(null);

  useEffect(() => {
    let active = true;
    listEditableFiles().then((f) => { if (active && f) setFiles(f); }).catch(() => null);
    return () => { active = false; };
  }, []);

  async function run() {
    if (!conversation || !text.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try { setResult(await prepareClientEdit(Number(conversation), text)); }
    catch { setResult({ ok: false, error: "تعذّر الاتصال." }); }
    finally { setBusy(false); }
  }

  if (!files.length) return null;
  return <section className="rounded-2xl border border-[#dfe8e4] bg-white p-4">
    <div className="mb-1 flex items-center gap-2">
      <FilePenLine className="size-4 text-[#557d78]" />
      <h2 className="font-bold">نفّذ طلب العميل على الملف</h2>
    </div>
    <p className="mb-3 text-sm text-[#5b7a71]">اكتب ما طلبه العميل (مثل: «احذف باتومي وأبقِ تبليسي فقط») — أجهّز نسخة جديدة للمراجعة، والملف الأصلي يبقى كما هو، ولا يصل العميل شيء.</p>
    <div className="flex flex-col gap-2">
      <select value={conversation} onChange={(e) => { setConversation(e.target.value); setResult(null); }} disabled={busy}
        className="tv-field w-full max-w-sm rounded-lg border p-2.5 text-sm">
        <option value="">اختر العميل…</option>
        {files.map((f) => <option key={f.conversationId} value={f.conversationId}>{f.client}{f.destination ? ` — ${f.destination}` : ""}</option>)}
      </select>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} disabled={busy}
        placeholder="طلب العميل…" className="tv-field w-full rounded-lg border p-3 text-sm" />
      <button type="button" onClick={() => void run()} disabled={busy || !conversation || !text.trim()}
        className="self-start rounded-lg bg-[var(--tv-brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
        {busy ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> يجهّز النسخة…</span> : "جهّز نسخة للمراجعة"}
      </button>
    </div>
    {result && !result.ok && <p role="alert" className="mt-3 text-sm text-red-700">{result.error}</p>}
    {result?.ok && <div className="mt-3 space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm leading-7 text-emerald-900">
      <p>✅ جهّزت النسخة: {result.summary}</p>
      {result.flags.map((f) => <p key={f}>⚠️ {f}</p>)}
      {result.beyond && <p>🖐 يحتاجك بنفسك: {result.beyond}</p>}
      <Link href={`/basic/${result.draftId}`} className="inline-block rounded-lg bg-[var(--tv-brand)] px-4 py-1.5 font-bold text-white">افتح النسخة وراجع الأسعار</Link>
    </div>}
  </section>;
}
