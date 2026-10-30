"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import { getSecretaryBoard, type SecretaryBoard } from "@/lib/data/my-followups";
import { SecretaryChat } from "./SecretaryChat";
import { SecretaryDayBoard } from "./SecretaryDayBoard";

/**
 * The panel مُراد's floating button opens (SecretaryFab.tsx): the day board («خطتي») with a chat tab beside it.
 */

export function SecretaryPanel({ close }: { close: () => void }) {
  const [tab, setTab] = useState<"plan" | "chat">("plan");
  const [board, setBoard] = useState<SecretaryBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getSecretaryBoard().then((b) => live && setBoard(b)).catch(() => null).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  return (
    <div dir="rtl" className="flex max-h-[78vh] flex-col overflow-hidden">
      <div className="flex items-center gap-2 bg-[var(--tv-brand)] px-4 py-2.5 text-white">
        <span className="flex size-8 items-center justify-center rounded-full bg-white/15 text-[13px] font-extrabold">مُراد</span>
        <strong className="flex-1 text-sm">سكرتيرك الخاص</strong>
        <Link href="/secretary" onClick={close} className="text-xs underline">الصفحة الكاملة</Link>
        <button type="button" onClick={close} aria-label="أغلق" className="rounded p-1 hover:bg-white/10"><X className="size-4" /></button>
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
        : <SecretaryChat tall />}
    </div>
  );
}
