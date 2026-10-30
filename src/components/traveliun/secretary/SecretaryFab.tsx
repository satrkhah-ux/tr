"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Loader2, X } from "lucide-react";
import { getSecretaryBoard, type SecretaryBoard } from "@/lib/data/my-followups";
import { SecretaryChat } from "./SecretaryChat";
import { SecretaryDayBoard } from "./SecretaryDayBoard";
import { StatusButtons } from "@/components/traveliun/presence/StatusButtons";
import type { ErrorReport } from "@/lib/secretary/error-core";
import { ErrorWatch } from "./ErrorWatch";
import { MURAD_ASK_EVENT, MURAD_ERROR_EVENT } from "./send-error";

/** Permanent side handle with an accessible drawer. */
export function SecretaryFab() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"plan" | "chat">("plan");
  const [board, setBoard] = useState<SecretaryBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingError, setPendingError] = useState<ErrorReport | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next && !loading) {
      setLoading(true);
      getSecretaryBoard().then(setBoard).catch(() => setBoard(null)).finally(() => setLoading(false));
    }
  }

  const [statusOpen, setStatusOpen] = useState(false);
  // on a phone the round button steps aside while the page scrolls down (it stood over prices), back on the way up
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setTucked(y > last && y > 80);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const clearPending = useCallback(() => setPendingError(null), []);
  const clearQuestion = useCallback(() => setPendingQuestion(null), []);
  // «أرسل الخطأ لمُراد» from anywhere on the page: open the chat with it
  useEffect(() => {
    const take = (e: Event) => {
      e.preventDefault();
      setPendingError((e as CustomEvent<ErrorReport>).detail);
      setTab("chat");
      setOpen(true);
    };
    const ask = (e: Event) => {
      e.preventDefault();
      setPendingQuestion((e as CustomEvent<string>).detail);
      setTab("chat");
      setOpen(true);
    };
    window.addEventListener(MURAD_ERROR_EVENT, take);
    window.addEventListener(MURAD_ASK_EVENT, ask);
    return () => {
      window.removeEventListener(MURAD_ERROR_EVENT, take);
      window.removeEventListener(MURAD_ASK_EVENT, ask);
    };
  }, []);

  return <Sheet open={open} onOpenChange={changeOpen}>
    {!open && <ErrorWatch />}
    {/* a full-height strip on a computer; on a phone a round button over the tab bar, the status buttons one tap
        behind «حالتي» so the page keeps its whole width (the owner, 2026-10-30: «الاستخدام اليسير للموظف على الموبايل») */}
    <div className={`fixed end-2 bottom-[84px] z-[100] flex flex-col-reverse items-center gap-2 transition-[translate,opacity] duration-200 ${tucked && !statusOpen ? "max-lg:pointer-events-none max-lg:translate-y-24 max-lg:opacity-0" : ""} lg:end-0 lg:top-[74px] lg:bottom-0 lg:w-10 lg:flex-col lg:justify-center lg:gap-3 lg:border-s lg:border-[#dfe8e4] lg:bg-[#eef3f1]`}>
      <SheetTrigger aria-label="استدعاء مُراد — سكرتيري الخاص" className="flex size-12 items-center justify-center rounded-full bg-[var(--tv-brand)] text-[12px] font-extrabold text-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 lg:h-24 lg:w-10 lg:rounded-none lg:rounded-s-xl lg:text-[13px] lg:shadow-md">
        مُراد
      </SheetTrigger>
      <button type="button" onClick={() => setStatusOpen((v) => !v)} aria-expanded={statusOpen} className="rounded-full border border-[#dfe8e4] bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-[var(--tv-brand)] shadow-md lg:hidden">
        حالتي
      </button>
      {/* the status buttons (presence, 2026-10-29): in مُراد's own strip, so they never stand over a button or a field;
          hidden by CSS only — their away screen is a portal and must outlive the closed list */}
      <div className={statusOpen ? "rounded-xl bg-[#eef3f1]/95 p-1 shadow-lg lg:bg-transparent lg:p-0 lg:shadow-none" : "max-lg:hidden"}>
        <StatusButtons />
      </div>
    </div>
    <SheetContent side="inline-end" dir="rtl" aria-describedby={undefined} className="w-[420px] max-w-[calc(100vw/var(--tv-zoom))] overflow-hidden bg-[#fbfdfc]">
      <div className="flex items-center gap-2 bg-[var(--tv-brand)] px-4 py-2.5 text-white">
        <span className="flex size-8 items-center justify-center rounded-full bg-white/15 text-[13px] font-extrabold">مُراد</span>
        <Dialog.Title className="flex-1 text-sm font-bold">مُراد — سكرتيرك الخاص</Dialog.Title>
        <Link href="/secretary" onClick={() => setOpen(false)} className="text-xs underline">الصفحة الكاملة</Link>
        <button type="button" onClick={() => setOpen(false)} aria-label="أغلق" className="rounded p-1 hover:bg-white/10"><X className="size-4" /></button>
      </div>
      <div className="flex border-b border-[#dfe8e4] bg-white text-sm font-bold">
        {([["plan", "خطتي"], ["chat", "اسأل مُراد"]] as const).map(([k, label]) => <button key={k} type="button" onClick={() => setTab(k)}
          className={`flex-1 px-3 py-2 ${tab === k ? "border-b-2 border-[var(--tv-brand)] text-[var(--tv-brand)]" : "text-tv-text-faint"}`}>{label}</button>)}
      </div>
      {tab === "plan"
        ? <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && <p className="flex items-center gap-2 p-2 text-sm text-[#557d78]"><Loader2 className="size-4 animate-spin" /> يقرأ يومك…</p>}
            {!loading && board && <SecretaryDayBoard board={board} compact />}
            {!loading && !board && <p className="p-2 text-sm text-[#557d78]">تعذّر قراءة خطتك الآن — افتح الصفحة الكاملة.</p>}
          </div>
        : <SecretaryChat pendingError={pendingError} onPendingTaken={clearPending} pendingQuestion={pendingQuestion} onQuestionTaken={clearQuestion} />}
    </SheetContent>
  </Sheet>;
}
