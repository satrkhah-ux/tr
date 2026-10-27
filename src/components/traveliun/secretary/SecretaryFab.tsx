"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Loader2, X } from "lucide-react";
import { getSecretaryBoard, type SecretaryBoard } from "@/lib/data/my-followups";
import { SecretaryChat } from "./SecretaryChat";
import { SecretaryDayBoard } from "./SecretaryDayBoard";

/** Permanent side handle with an accessible drawer. */
export function SecretaryFab() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"plan" | "chat">("plan");
  const [board, setBoard] = useState<SecretaryBoard | null>(null);
  const [loading, setLoading] = useState(false);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next && !loading) {
      setLoading(true);
      getSecretaryBoard().then(setBoard).catch(() => setBoard(null)).finally(() => setLoading(false));
    }
  }

  return <Sheet open={open} onOpenChange={changeOpen}>
    <div className="fixed end-0 top-[74px] bottom-20 z-[100] flex w-10 items-center justify-center border-s border-[#dfe8e4] bg-[#eef3f1] md:bottom-0">
      <SheetTrigger aria-label="استدعاء مُراد — سكرتيري الخاص" className="flex h-24 w-10 items-center justify-center rounded-s-xl bg-[var(--tv-brand)] text-[13px] font-extrabold text-white shadow-md focus-visible:outline-2 focus-visible:outline-offset-2">
        مُراد
      </SheetTrigger>
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
          className={`flex-1 px-3 py-2 ${tab === k ? "border-b-2 border-[var(--tv-brand)] text-[var(--tv-brand)]" : "text-[#8ba09b]"}`}>{label}</button>)}
      </div>
      {tab === "plan"
        ? <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && <p className="flex items-center gap-2 p-2 text-sm text-[#557d78]"><Loader2 className="size-4 animate-spin" /> يقرأ يومك…</p>}
            {!loading && board && <SecretaryDayBoard board={board} compact />}
            {!loading && !board && <p className="p-2 text-sm text-[#557d78]">تعذّر قراءة خطتك الآن — افتح الصفحة الكاملة.</p>}
          </div>
        : <SecretaryChat tall />}
    </SheetContent>
  </Sheet>;
}
