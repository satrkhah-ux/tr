"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { askSecretary, getSecretaryThread, type SecretaryMsg } from "@/lib/secretary/chat";

/** «سكرتيري الخاص» — the chat itself, used by the floating panel and /secretary. */
const QUICK = ["ما حال محادثاتي؟", "ما مهامي اليوم؟", "من الساخن؟"];

export function SecretaryChat({ tall = false }: { tall?: boolean }) {
  const [messages, setMessages] = useState<SecretaryMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getSecretaryThread()
      .then((r) => { if (!active) return; if (r.ok) setMessages(r.messages); else setError(r.error); })
      .catch(() => { if (active) setError("تعذّر الاتصال."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);

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

  return <div dir="rtl" className={`flex ${tall ? "h-[70vh]" : "h-full"} min-h-0 flex-col`}>
    <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-3">
      {loading && <p className="text-sm text-[#557d78]">يحمّل المحادثة…</p>}
      {!loading && !messages.length && !error && <div className="rounded-xl border border-[#dfe8e4] bg-[#f4f8f6] p-4 text-sm leading-7 text-[#185045]">
        أهلاً! أنا سكرتيرك الخاص — أعرف محادثاتك وملفات متابعتك أنت فقط. اسألني عن يومك، أو اختر سؤالاً جاهزاً بالأسفل.
      </div>}
      {messages.map((m) => <div key={m.id} className={`max-w-[88%] rounded-xl border p-3 text-sm leading-7 ${
        m.role === "user" ? "ms-auto border-[var(--tv-brand)] bg-[var(--tv-brand)] text-white"
        : m.role === "plan" ? "border-amber-300 bg-amber-50 text-[#5a4300]"
        : "border-[#dfe8e4] bg-white text-[#185045]"}`}>
        {m.role === "plan" && <p className="mb-1 text-xs font-bold">🗂 خطة اليوم</p>}
        <p className="whitespace-pre-wrap break-words">{m.content}</p>
        <p className={`mt-1 text-[10px] ${m.role === "user" ? "text-white/70" : "text-[#8ba09b]"}`}>{when(m.created_at)}</p>
      </div>)}
      {busy && <p className="flex items-center gap-2 text-sm text-[#557d78]"><Loader2 className="size-4 animate-spin" /> سكرتيرك يكتب…</p>}
      <div ref={endRef} />
    </div>
    {error && <p role="alert" className="px-3 pb-1 text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2 px-3 pb-2">
      {QUICK.map((q) => <button key={q} type="button" disabled={busy || loading} onClick={() => void send(q)}
        className="rounded-full border border-[#dfe8e4] bg-white px-3 py-1 text-xs font-semibold text-[#185045] hover:bg-[#f4f8f6]">{q}</button>)}
    </div>
    <form className="flex gap-2 border-t border-[#dfe8e4] p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="اسأل سكرتيرك…"
        className="min-w-0 flex-1 rounded-lg border border-[#dfe8e4] bg-white p-2.5 text-sm" />
      <button type="submit" disabled={busy || loading || !text.trim()} aria-label="أرسل"
        className="rounded-lg bg-[var(--tv-brand)] px-4 text-white disabled:opacity-60">
        <Send className="size-4 -scale-x-100" />
      </button>
    </form>
  </div>;
}
