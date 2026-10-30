"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { askSecretary, explainErrorToSecretary, getSecretaryThread, reportErrorToAdmin, type SecretaryMsg } from "@/lib/secretary/chat";
import type { ErrorReport } from "@/lib/secretary/error-core";
import { takePendingError } from "./send-error";

/** «سكرتيري الخاص» — the chat itself, used by the floating panel and /secretary. */
const QUICK = ["ما حال محادثاتي؟", "ما مهامي اليوم؟", "من الساخن؟", "كيف أنشئ بكج جديد؟"];

/** pendingError: an error sent with «أرسل الخطأ لمُراد» (SecretaryFab); /secretary reads the one left in sessionStorage */
export function SecretaryChat({ tall = false, active = true, pendingError = null, onPendingTaken, pendingQuestion = null, onQuestionTaken }: { tall?: boolean; active?: boolean; pendingError?: ErrorReport | null; onPendingTaken?: () => void; pendingQuestion?: string | null; onQuestionTaken?: () => void }) {
  const [messages, setMessages] = useState<SecretaryMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const [lastError, setLastError] = useState<ErrorReport | null>(null);
  const [reported, setReported] = useState("");
  // an error explained before the thread loaded: the older thread must not overwrite its answer
  const explaining = useRef(false);

  useEffect(() => {
    let active = true;
    getSecretaryThread()
      .then((r) => { if (!active || explaining.current) return; if (r.ok) setMessages(r.messages); else setError(r.error); })
      .catch(() => { if (active) setError("تعذّر الاتصال."); })
      .finally(() => { if (active) setLoading(false); });
    const left = takePendingError();
    if (left) void explain(left);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pendingError) return;
    void explain(pendingError);
    onPendingTaken?.();
  }, [pendingError, onPendingTaken]);

  // a ready question from a button elsewhere (askMurad): asked once, the older thread must not overwrite its answer
  useEffect(() => {
    if (!pendingQuestion) return;
    explaining.current = true;
    void send(pendingQuestion);
    onQuestionTaken?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send reads the latest state itself; re-running on it would ask twice
  }, [pendingQuestion, onQuestionTaken]);

  async function explain(report: ErrorReport) {
    setError("");
    setReported("");
    setBusy(true);
    setLastError(report);
    explaining.current = true;
    try {
      const r = await explainErrorToSecretary(report);
      if (r.ok) setMessages(r.messages);
      else setError(r.error);
    } catch { setError("تعذّر الاتصال."); } finally { setBusy(false); }
  }

  async function report() {
    if (!lastError) return;
    try {
      const r = await reportErrorToAdmin(lastError);
      setReported(r.ok ? (r.already ? "أُبلغت الإدارة بهذا الخطأ من قبل." : "تم — وصل البلاغ للإدارة.") : r.error);
    } catch { setReported("تعذّر الاتصال."); }
  }

  useEffect(() => {
    const list = messagesRef.current;
    if (list && active) list.scrollTop = list.scrollHeight;
  }, [messages, busy, active]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setText("");
    setError("");
    setBusy(true);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: q, created_at: new Date().toISOString() }]);
    try {
      const r = await askSecretary(q);
      if (r.ok) setMessages(r.messages);
      else setError(r.error);
    } catch { setError("تعذّر الاتصال."); } finally { setBusy(false); }
  }

  const when = (iso: string) => new Date(iso).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" });

  return <div dir="rtl" className={`flex ${tall ? "h-[clamp(280px,calc(100dvh/var(--tv-zoom)-340px),620px)]" : "flex-1"} min-h-0 min-w-0 flex-col`}>
    <div ref={messagesRef} role="log" aria-label="رسائل مُراد" aria-busy={loading || busy} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-[#f5f8f6] p-4 sm:p-5">
      {loading && <p className="text-sm text-[#557d78]">يحمّل المحادثة…</p>}
      {!loading && !messages.length && !error && <div className="rounded-xl border border-[#dfe8e4] bg-[#f4f8f6] p-4 text-sm leading-7 text-[#185045]">
        أهلاً! أنا سكرتيرك الخاص — أعرف محادثاتك وملفات متابعتك أنت فقط. اسألني عن يومك، أو اختر سؤالاً جاهزاً بالأسفل.
      </div>}
      {messages.map((m) => <div key={m.id} className={`w-fit max-w-[92%] rounded-2xl border px-4 py-2.5 text-sm leading-6 sm:max-w-[85%] ${
        m.role === "user" ? "me-auto rounded-ss-sm border-[var(--tv-brand)] bg-[var(--tv-brand)] text-white"
        : m.role === "plan" ? "ms-auto border-[#dddcc4] bg-[#faf9f1] text-[#5a5637]"
        : "ms-auto rounded-se-sm border-[#dfe8e4] bg-white text-[#185045]"}`}>
        <p className={`mb-1 text-[11px] font-bold ${m.role === "user" ? "text-white/70" : "text-[#6c8680]"}`}>{m.role === "user" ? "أنت" : m.role === "plan" ? "مُراد · خطة اليوم" : "مُراد"}</p>
        <p className="whitespace-pre-wrap break-words">{m.content}</p>
        <p className={`mt-1 text-[10px] ${m.role === "user" ? "text-white/70" : "text-[#8ba09b]"}`}>{when(m.created_at)}</p>
      </div>)}
      {busy && <p className="flex items-center gap-2 text-sm text-[#557d78]"><Loader2 className="size-4 animate-spin" /> سكرتيرك يكتب…</p>}
    </div>
    {error && <p role="alert" data-murad-own className="px-3 pb-1 text-sm text-red-700">{error}</p>}
    {lastError && !busy && <div className="flex items-center gap-2 px-3 pt-2 text-xs">
      <button type="button" onClick={() => void report()} disabled={!!reported}
        className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 font-bold text-red-800 hover:bg-red-100 disabled:opacity-60">أبلغ الإدارة</button>
      {reported && <span role="status" className="text-[#557d78]">{reported}</span>}
    </div>}
    <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-[#e7eeeb] px-3 pt-3 pb-1">
      {QUICK.map((q) => <button key={q} type="button" disabled={busy || loading} onClick={() => void send(q)}
        className="shrink-0 rounded-full border border-[#dfe8e4] bg-white px-3 py-1.5 text-xs font-semibold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-50">{q}</button>)}
    </div>
    <form className="flex shrink-0 items-end gap-2 bg-white p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="اكتب لمُراد…" aria-label="رسالتك إلى مُراد"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!loading) void send(text); } }}
        className="min-w-0 flex-1 resize-none rounded-xl border border-[#dfe8e4] bg-[#f8faf9] p-3 text-sm leading-6 outline-none focus:border-[#557d78] focus:ring-2 focus:ring-[#185045]/10" />
      <button type="submit" disabled={busy || loading || !text.trim()} aria-label="أرسل"
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--tv-brand)] text-white disabled:opacity-40">
        <Send className="size-4 -scale-x-100" />
      </button>
    </form>
  </div>;
}
