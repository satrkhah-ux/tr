"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import type { AlmatarMessage } from "@/lib/almatar/server";

/**
 * «مخاطبة المورد» (0102) — one thread between Almatar and Traveliun, drawn the
 * same on both sides: my messages on one side in `mine` colours, theirs on the
 * other. `send` is the side's own action (sendAlmatarMessage / replyAlmatarMessage).
 */
export function AlmatarThread({
  messages,
  me,
  theirName,
  send,
  mine,
}: {
  messages: AlmatarMessage[];
  me: "partner" | "staff";
  theirName: string;
  send: (body: string) => Promise<{ ok: boolean; message?: string }>;
  /** tailwind classes for my bubbles */
  mine: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    start(async () => {
      try {
        const r = await send(body);
        if (!r.ok) return setError(r.message ?? "تعذّر الإرسال.");
        setBody("");
        router.refresh();
      } catch {
        setError("تعذّر الاتصال بالخادم — حدّث الصفحة وأعد المحاولة.");
      }
    });
  }

  return (
    <div className="grid gap-3">
      <div className="grid max-h-[55vh] gap-2 overflow-y-auto rounded-xl border border-[#ececf1] bg-[#fafafb] p-3">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] font-semibold text-[#92939e]">لا توجد رسائل بعد — اكتب أول رسالة.</p>
        ) : (
          messages.map((m) => {
            const own = m.sender === me;
            return (
              <div key={m.id} className={`flex ${own ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-6 ${own ? mine : "border border-[#e7e5ef] bg-white text-[#1b1a1f]"}`}>
                  {!own ? <div className="text-[11px] font-bold opacity-70">{theirName}</div> : null}
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <div className="mt-0.5 text-[10.5px] opacity-60" dir="ltr">
                    {m.request_ref ? `${m.request_ref} · ` : ""}
                    {m.created_at.slice(0, 16).replace("T", " ")}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="اكتب رسالتك…"
          className="min-h-[44px] flex-1 rounded-[10px] border border-[#d9d9de] bg-white px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus"
        />
        <button type="submit" disabled={pending || !body.trim()} className={`inline-flex h-11 items-center gap-1.5 rounded-[10px] px-4 text-[13px] font-bold disabled:opacity-50 ${mine}`}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} إرسال
        </button>
      </form>
      {error ? <p className="text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
