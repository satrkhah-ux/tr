"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, Phone, Send } from "lucide-react";
import { DirText } from "@/components/DirText";
import { closeFollowup, replyFollowup, type FollowupThread as Thread } from "@/lib/data/sla";
import { useSlaLabels } from "./labels";
import { useWaitText, useWhen } from "./SlaBoard";

type OkThread = Extract<Thread, { ok: true }>;

/**
 * One follow-up: the client's latest messages, the answer written here and sent
 * on their own WhatsApp thread, and «تمت المتابعة». The manager or the employee
 * it was handed to (data/sla.ts checks it again on every action).
 */
export function FollowupThread({ data }: { data: OkThread }) {
  const { tx, kind } = useSlaLabels();
  const wait = useWaitText();
  const when = useWhen();
  const router = useRouter();
  const f = data.followup;
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"send" | "close" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const open = f.status === "open";
  const fromUnix = (s: number) => when(new Date(s * 1000).toISOString());
  const errText = (e: string) => (e === "window" ? tx("window") : e === "forbidden" ? tx("forbidden") : e === "unreachable" ? tx("threadUnreachable") : tx("failed"));

  async function send() {
    setBusy("send");
    setMsg(null);
    try {
      const r = await replyFollowup(f.id, text);
      if (!r.ok) return setMsg(errText(r.error));
      setText("");
      setMsg(tx("sent"));
      router.refresh();
    } catch {
      setMsg(tx("failed"));
    } finally {
      setBusy(null);
    }
  }
  async function close() {
    setBusy("close");
    setMsg(null);
    try {
      const r = await closeFollowup(f.id, note);
      if (!r.ok) return setMsg(errText(r.error));
      setMsg(tx("closed"));
      router.refresh();
    } catch {
      setMsg(tx("failed"));
    } finally {
      setBusy(null);
    }
  }

  const tel = (f.contact_phone ?? "").replace(/[^\d+]/g, "");

  return (
    <div className="grid gap-4">
      <section className="rounded-[12px] border border-[#e3ece8] bg-white p-4">
        <Link href={data.manager ? "/sla" : "/dashboard"} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#557d78] hover:underline">
          <ArrowRight className="size-3.5 rtl:rotate-0 ltr:rotate-180" />
          {tx("back")}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-extrabold text-[#103f37]">{f.contact_name ?? `#${f.conversation_id}`}</h1>
            {f.contact_phone ? <DirText className="text-[12.5px] font-semibold text-tv-text-faint">{f.contact_phone}</DirText> : null}
            <p className="mt-1 text-[12px] font-bold text-[#a86a10]">
              {kind(f.kind)}
              {f.rule_name ? ` · ${f.rule_name}` : ""}
              {f.waited_minutes != null ? ` · ${tx("fuWaited", { w: wait(f.waited_minutes) })}` : ""}
            </p>
            {f.assigned_name ? <p className="text-[11.5px] font-semibold text-[#557d78]">{`${tx("fuAssign")} ${f.assigned_name}`}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {tel ? (
              <a href={`tel:${tel}`} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#185045]">
                <Phone className="size-3.5" />
                {tx("call")}
              </a>
            ) : null}
            {data.teletelLink ? (
              <a href={`${data.teletelLink}${f.conversation_id}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#185045]">
                <ExternalLink className="size-3.5" />
                {tx("openTeletel")}
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-[#e3ece8] bg-white p-4">
        <h2 className="text-[13px] font-extrabold text-[#185045]">{tx("thread")}</h2>
        {data.messages === null ? (
          <p className="mt-2 text-[12.5px] font-bold text-[#c22850]">{tx("threadUnreachable")}</p>
        ) : (
          <ul className="mt-3 grid max-h-[28rem] gap-2 overflow-y-auto">
            {data.messages.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-[10px] px-3 py-2 text-[12.5px] ${m.fromClient ? "justify-self-start bg-[#f2f6f4] text-[#103f37]" : m.isPrivate ? "justify-self-end border border-dashed border-[#e0a92a] bg-[#fffbf1] text-[#7a5a10]" : "justify-self-end bg-[#185045] text-white"}`}>
                <span className="block whitespace-pre-wrap leading-6">{m.text}</span>
                <span className={`tv-tnum mt-1 block text-[10.5px] ${m.fromClient ? "text-tv-text-faint" : m.isPrivate ? "text-[#a8873a]" : "text-white/70"}`}>
                  {m.fromClient ? (f.contact_name ?? "") : m.isPrivate ? tx("note") : (m.sender ?? tx("you"))} · {fromUnix(m.at)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {open ? (
          <div className="mt-4 grid gap-2">
            {data.canReply ? (
              <>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={tx("reply")} className="tv-field w-full rounded-[10px] border p-2.5 text-[13px]" />
                <button type="button" disabled={busy !== null || !text.trim()} onClick={send} className="inline-flex h-9 items-center justify-center gap-1.5 justify-self-start rounded-[8px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60">
                  {busy === "send" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  {tx("send")}
                </button>
              </>
            ) : (
              <p className="rounded-[10px] border border-[#f4d9a6] bg-[#fff8e8] p-3 text-[12.5px] font-bold leading-6 text-[#a86a10]">{tx("window")}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#e6eeea] pt-3">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx("closeNote")} className="tv-field h-9 min-w-48 flex-1 rounded-[8px] border px-2.5 text-[12.5px]" />
              <button type="button" disabled={busy !== null} onClick={close} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0f7a52] px-4 text-[12.5px] font-bold text-white hover:bg-[#0b6140] disabled:opacity-60">
                {busy === "close" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                {tx("close")}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-[12.5px] font-bold text-[#0f7a52]">
            {tx("fuDoneBy", { n: f.done_name ?? "—", t: f.done_at ? when(f.done_at) : "" })}
            {f.note ? <span className="block font-semibold text-[#557d78]">{f.note}</span> : null}
          </p>
        )}
        {msg ? <p className="mt-2 text-[12.5px] font-bold text-[#557d78]">{msg}</p> : null}
      </section>
    </div>
  );
}
